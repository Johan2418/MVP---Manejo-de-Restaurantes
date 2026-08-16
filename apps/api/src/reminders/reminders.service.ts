import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { Reservation } from '@prisma/client';
import {
  ACTIVE_RESERVATION_STATUSES,
  DOMAIN_EVENTS,
} from '@reservas/shared';
import type { DomainEvent } from '@reservas/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Margen tras el fin del turno antes de declarar no-show (minutos). */
export const NO_SHOW_GRACE_MINUTES = 30;

const ACTIVE = [...ACTIVE_RESERVATION_STATUSES];

/**
 * Fase 3 — Automatización.
 *
 * Reacciona a los eventos del bus (`reservation.*`) para programar trabajos en
 * BullMQ:
 *   - `send-reminder`: recordatorio SMS/WhatsApp `reminderHoursBefore` horas
 *     antes de la reserva.
 *   - `auto-no-show`: al final del turno (+margen) marca NO_SHOW si sigue
 *     confirmada, o auto-cancela si seguía sin confirmar.
 *
 * El scheduler es orientado a eventos (no acopla ReservationsService con la
 * cola): crear, confirmar o reprogramar una reserva re-programa sus trabajos
 * automáticamente vía `reservation.requested/confirmed/rescheduled`.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @InjectQueue('reminders') private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  // ---------- Reacción a eventos del bus ----------

  @OnEvent(DOMAIN_EVENTS.RESERVATION_REQUESTED)
  @OnEvent(DOMAIN_EVENTS.RESERVATION_CONFIRMED)
  @OnEvent(DOMAIN_EVENTS.RESERVATION_RESCHEDULED)
  async onReservationActive(
    event: DomainEvent<{ reservationId: string; restaurantId?: string }>,
  ) {
    try {
      const reservation = await this.prisma.reservation.findUnique({
        where: { id: event.payload.reservationId },
      });
      if (!reservation) return;
      await this.scheduleForReservation(reservation);
    } catch (err) {
      // La programación no debe romper la transición de la reserva: si Redis
      // está caído, se reintentará con el siguiente evento.
      this.logger.error(
        `No se pudo programar recordatorio: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent(DOMAIN_EVENTS.RESERVATION_CANCELLED)
  @OnEvent(DOMAIN_EVENTS.RESERVATION_NO_SHOW)
  async onReservationFinished(event: DomainEvent<{ reservationId: string }>) {
    try {
      await this.removeForReservation(event.payload.reservationId);
    } catch (err) {
      this.logger.warn(
        `No se pudieron limpiar trabajos: ${(err as Error).message}`,
      );
    }
  }

  // ---------- Programación ----------

  /**
   * Programa recordatorio y auto-no-show para una reserva activa.
   * Idempotente: el jobId es estable (`reminder-{id}` / `no-show-{id}`), así
   * que re-programar reemplaza el trabajo existente sin duplicar.
   */
  async scheduleForReservation(reservation: Reservation) {
    if (!ACTIVE.includes(reservation.status)) return;
    if (reservation.reminderSentAt) return; // ya se recordó

    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: reservation.restaurantId },
    });
    if (!restaurant) return;

    const now = Date.now();
    const remindAt =
      reservation.startsAt.getTime() -
      restaurant.reminderHoursBefore * 3_600_000;

    await this.queue.add(
      'send-reminder',
      { reservationId: reservation.id },
      this.jobOptions(`reminder-${reservation.id}`, Math.max(0, remindAt - now)),
    );

    const noShowAt =
      reservation.startsAt.getTime() +
      reservation.durationMinutes * 60_000 +
      NO_SHOW_GRACE_MINUTES * 60_000;

    await this.queue.add(
      'auto-no-show',
      { reservationId: reservation.id },
      this.jobOptions(`no-show-${reservation.id}`, Math.max(0, noShowAt - now) + 1_000),
    );
  }

  /** Elimina trabajos pendientes de una reserva (cancelada, no-show, etc.). */
  async removeForReservation(reservationId: string) {
    await Promise.all([
      this.queue.remove(`reminder-${reservationId}`),
      this.queue.remove(`no-show-${reservationId}`),
    ]);
  }

  /** Opciones comunes de job: reintentos con backoff exponencial. */
  private jobOptions(jobId: string, delay: number) {
    return {
      jobId,
      delay,
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 60_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 86_400 },
    };
  }
}
