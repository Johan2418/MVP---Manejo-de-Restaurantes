import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Channel, ReservationStatus } from '@prisma/client';
import { DOMAIN_EVENTS, TenantId } from '@reservas/shared';
import { ChannelsService } from '../channels/channels.service';
import { TwilioService } from '../channels/twilio.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';

/**
 * Worker de la cola `reminders` (Fase 3).
 * - `send-reminder`: envía el recordatorio por SMS/WhatsApp o por llamada IVR
 *   (según `reminderChannel` del restaurante), registra el mensaje/llamada en
 *   la conversación y marca `reminderSentAt`.
 * - `auto-no-show`: al terminar el turno, NO_SHOW si seguía confirmada o
 *   auto-cancelación si seguía sin confirmar.
 */
@Processor('reminders')
export class RemindersProcessor extends WorkerHost {
  private readonly logger = new Logger(RemindersProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
    private readonly twilio: TwilioService,
    private readonly reservations: ReservationsService,
    private readonly domainEvents: DomainEventsService,
  ) {
    super();
  }

  async process(job: Job<{ reservationId: string }>): Promise<void> {
    switch (job.name) {
      case 'send-reminder':
        return this.sendReminder(job);
      case 'auto-no-show':
        return this.autoNoShow(job);
      default:
        this.logger.warn(`Job desconocido: ${job.name}`);
    }
  }

  private async sendReminder(job: Job<{ reservationId: string }>) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: job.data.reservationId },
      include: { guest: true, restaurant: true },
    });
    if (!reservation || !reservation.guestId || !reservation.guest) return;
    if (
      reservation.status !== ReservationStatus.REQUESTED &&
      reservation.status !== ReservationStatus.CONFIRMED
    ) {
      return; // ya no está activa: nada que recordar
    }
    if (reservation.reminderSentAt) return; // ya se recordó

    if (!this.twilio.isConfigured) {
      this.logger.warn(
        `Recordatorio ${reservation.id} omitido: Twilio no configurado`,
      );
      return;
    }

    const channel = this.reminderChannelFor(
      reservation.restaurant,
      reservation,
    );
    const text = this.buildReminderText(
      reservation,
      reservation.guest.name,
      reservation.restaurant.name,
      reservation.restaurant.timezone,
    );

    if (channel === Channel.PHONE) {
      // Recordatorio por llamada (IVR): 1 para confirmar, 2 para cancelar.
      await this.channels.sendVoiceReminder(
        reservation.restaurant,
        reservation.guest,
        text,
      );
    } else {
      await this.channels.sendToGuest(
        reservation.restaurantId,
        reservation.guestId,
        channel,
        text,
      );
    }

    await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: { reminderSentAt: new Date() },
    });

    this.domainEvents.emit(
      DOMAIN_EVENTS.RESERVATION_REMINDER_SENT,
      reservation.tenantId as TenantId,
      {
        reservationId: reservation.id,
        channel,
        scheduledFor: reservation.startsAt.toISOString(),
      },
    );
  }

  private async autoNoShow(job: Job<{ reservationId: string }>) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: job.data.reservationId },
    });
    if (!reservation) return;

    if (reservation.status === ReservationStatus.CONFIRMED) {
      await this.reservations.transition(
        reservation.tenantId,
        reservation.restaurantId,
        reservation.id,
        { status: ReservationStatus.NO_SHOW },
      );
      this.logger.log(`Reserva ${reservation.id} marcada como no-show`);
    } else if (reservation.status === ReservationStatus.REQUESTED) {
      await this.reservations.transition(
        reservation.tenantId,
        reservation.restaurantId,
        reservation.id,
        { status: ReservationStatus.CANCELLED },
      );
      this.logger.log(`Reserva ${reservation.id} auto-cancelada (sin confirmar)`);
    }
    // Otros estados: ya resuelta, no hacer nada.
  }

  /**
   * Canal del recordatorio: PHONE si el restaurante lo configuró así o si la
   * reserva llegó por teléfono; si no, SMS/WhatsApp según la preferencia del
   * restaurante (o el canal de origen de la reserva).
   */
  private reminderChannelFor(
    restaurant: { reminderChannel: Channel },
    reservation: { channel: Channel },
  ): Channel {
    if (
      restaurant.reminderChannel === Channel.PHONE ||
      reservation.channel === Channel.PHONE
    ) {
      return Channel.PHONE;
    }
    if (
      restaurant.reminderChannel === Channel.SMS ||
      restaurant.reminderChannel === Channel.WHATSAPP
    ) {
      return restaurant.reminderChannel;
    }
    return reservation.channel === Channel.SMS ? Channel.SMS : Channel.WHATSAPP;
  }

  private buildReminderText(
    reservation: {
      startsAt: Date;
      durationMinutes: number;
      partySize: number;
      status: ReservationStatus;
    },
    guestName: string,
    restaurantName: string,
    timezone: string,
  ): string {
    const when = reservation.startsAt.toLocaleString('es-EC', {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
    const state =
      reservation.status === ReservationStatus.CONFIRMED
        ? 'confirmada'
        : 'solicitada';
    return (
      `Estimado/a ${guestName}, le recordamos su reserva en ` +
      `${restaurantName} para el ${when} ` +
      `(${reservation.partySize} persona${reservation.partySize === 1 ? '' : 's'}). ` +
      `Estado: ${state}. Responda 1 para confirmar o 2 para cancelar.`
    );
  }
}
