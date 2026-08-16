import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Integration, IntegrationStatus, ReservationStatus } from '@prisma/client';
import { ACTIVE_RESERVATION_STATUSES } from '@reservas/shared';
import { addMinutes, toLocalDateTime } from '../../common/dates';
import { PrismaService } from '../../prisma/prisma.service';
import { ReservationsService } from '../../reservations/reservations.service';
import {
  CalendarCredentials,
  CalendarEvent,
  CalendarSyncContext,
} from './calendar.adapter';
import { CalendarAdapterFactory } from './calendar-adapter.factory';

/** Ventana de sincronización: desde ahora hasta N días. */
const SYNC_HORIZON_DAYS = 45;

/** Tolerancia para considerar que un evento cambió de hora (minutos). */
const START_TOLERANCE_MS = 2 * 60_000;

const ACTIVE = [...ACTIVE_RESERVATION_STATUSES];

export interface SyncResult {
  pushed: number;
  pulled: number;
  deleted: number;
}

/**
 * Sincronización 2-way con el calendario del proveedor (Fase 4):
 * - Push: cada reserva CONFIRMADA en la ventana se refleja como evento
 *   (upsert por `reservationId` en extendedProperties).
 * - Pull: eventos con `reservationId` del proveedor actualizan la reserva
 *   (reprogramación si cambió la hora, cancelación si el evento se canceló) y
 *   elimina eventos huérfanos de reservas ya cerradas.
 *
 * Es idempotente y seguro de ejecutar tanto por eventos como por cron.
 */
@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: CalendarAdapterFactory,
    private readonly reservations: ReservationsService,
  ) {}

  /**
   * Sincroniza el restaurante con su calendario conectado (si existe).
   * Busca la integración de CUALQUIER proveedor de calendario (Google/CalDAV).
   */
  async syncRestaurant(restaurantId: string): Promise<SyncResult> {
    const integration = await this.prisma.integration.findFirst({
      where: {
        restaurantId,
        provider: { in: ['GOOGLE_CALENDAR', 'CALDAV'] },
      },
    });
    if (!integration || integration.status !== IntegrationStatus.CONNECTED) {
      return { pushed: 0, pulled: 0, deleted: 0 };
    }

    try {
      const result = await this.performSync(integration);
      await this.prisma.integration.update({
        where: { id: integration.id },
        data: {
          status: IntegrationStatus.CONNECTED,
          lastSyncedAt: new Date(),
          lastError: null,
        },
      });
      return result;
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Sync de ${restaurantId} falló: ${message}`);
      await this.prisma.integration
        .update({
          where: { id: integration.id },
          data: { status: IntegrationStatus.ERROR, lastError: message },
        })
        .catch(() => undefined);
      throw err;
    }
  }

  private async performSync(integration: Integration): Promise<SyncResult> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: integration.restaurantId },
    });
    if (!restaurant) return { pushed: 0, pulled: 0, deleted: 0 };

    const creds = integration.credentials as unknown as
      | CalendarCredentials
      | null;
    const adapter = this.adapters.get(integration.provider);
    if (!hasValidCredentials(integration.provider, creds)) {
      throw new ServiceUnavailableException(
        'La integración no tiene credenciales válidas. Reconecta el calendario.',
      );
    }

    // Renueva el token si está por expirar (no-op en CalDAV) y persiste el refresco.
    const fresh = await adapter.refreshIfExpired(creds!);
    const ctx: CalendarSyncContext = {
      credentials: fresh,
      config: (integration.config as Record<string, unknown>) ?? {},
    };
    if (fresh.accessToken && fresh.accessToken !== creds!.accessToken) {
      await this.prisma.integration.update({
        where: { id: integration.id },
        data: { credentials: fresh as unknown as object },
      });
    }

    const now = new Date();
    const horizon = new Date(
      now.getTime() + SYNC_HORIZON_DAYS * 24 * 3_600_000,
    );

    const reservations = await this.prisma.reservation.findMany({
      where: {
        restaurantId: integration.restaurantId,
        startsAt: { gte: now, lt: horizon },
      },
      include: { guest: true },
    });

    let pushed = 0;
    let pulled = 0;
    let deleted = 0;

    // --- Push: reservas confirmadas → eventos ---
    for (const r of reservations) {
      if (r.status !== ReservationStatus.CONFIRMED || !r.guestId) continue;
      await adapter.upsertEvent(ctx, this.buildEvent(r, restaurant.timezone));
      pushed++;
    }

    // --- Pull: eventos del proveedor → reservas ---
    const events = await adapter.listEvents(
      ctx,
      now.toISOString(),
      horizon.toISOString(),
    );
    const byReservation = new Map(
      events
        .filter((e) => e.reservationId)
        .map((e) => [e.reservationId as string, e]),
    );

    for (const [reservationId, event] of byReservation) {
      const res = reservations.find((r) => r.id === reservationId);
      if (!res || !ACTIVE.includes(res.status)) {
        // Reserva cerrada o inexistente: limpiar el evento del calendario.
        if (event.id) {
          await adapter.deleteEvent(ctx, event.id);
          deleted++;
        }
        continue;
      }

      if (event.status === 'cancelled') {
        await this.reservations.transition(
          res.tenantId,
          res.restaurantId,
          res.id,
          { status: ReservationStatus.CANCELLED },
        );
        pulled++;
        continue;
      }

      const newStart = parseEventDateTime(event);
      if (
        newStart &&
        Math.abs(newStart.getTime() - res.startsAt.getTime()) >
          START_TOLERANCE_MS
      ) {
        await this.reservations.update(
          res.tenantId,
          res.restaurantId,
          res.id,
          { startsAt: newStart.toISOString() },
        );
        pulled++;
      }
    }

    return { pushed, pulled, deleted };
  }

  private buildEvent(
    r: {
      id: string;
      startsAt: Date;
      durationMinutes: number;
      partySize: number;
      guest: { name: string; phone: string | null } | null;
      customerNotes: string | null;
    },
    timeZone: string,
  ): CalendarEvent {
    const notes = [
      r.guest?.phone ? `Tel: ${r.guest.phone}` : null,
      r.customerNotes ? `Notas: ${r.customerNotes}` : null,
    ].filter(Boolean);
    return {
      summary: `Reserva: ${r.guest?.name ?? 'Comensal'} (${r.partySize})`,
      description: notes.length > 0 ? notes.join('\n') : undefined,
      start: {
        dateTime: toLocalDateTime(r.startsAt, timeZone),
        timeZone,
      },
      end: {
        dateTime: toLocalDateTime(
          addMinutes(r.startsAt, r.durationMinutes),
          timeZone,
        ),
        timeZone,
      },
      status: 'confirmed',
      reservationId: r.id,
    };
  }
}

/**
 * Parsea la fecha del evento del proveedor a Date. Google devuelve
 * dateTime con offset (RFC3339); si llegara sin offset se asume UTC.
 */
function parseEventDateTime(event: CalendarEvent): Date | null {
  const raw = event.start.dateTime;
  if (!raw || !raw.includes('T')) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Valida las credenciales mínimas según el proveedor. */
function hasValidCredentials(
  provider: string,
  creds: CalendarCredentials | null,
): creds is CalendarCredentials {
  if (!creds) return false;
  if (provider === 'GOOGLE_CALENDAR') return Boolean(creds.accessToken);
  if (provider === 'CALDAV') return Boolean(creds.calendarUrl);
  return false;
}
