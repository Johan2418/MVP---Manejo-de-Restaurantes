import { Injectable, NotFoundException } from '@nestjs/common';
import { Channel, ReservationStatus } from '@prisma/client';
import { ACTIVE_RESERVATION_STATUSES } from '@reservas/shared';
import { endOfDay, parseLocalDate, toDateKey } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';

const ACTIVE = [...ACTIVE_RESERVATION_STATUSES];

/** Ventana del informe de canales (días). */
const CHANNEL_WINDOW_DAYS = 30;

export interface ChannelReportRow {
  channel: Channel;
  total: number;
  requested: number;
  confirmed: number;
  cancelled: number;
  noShow: number;
  completed: number;
  /** % de las reservas del canal sobre el total del período. */
  sharePct: number;
}

/**
 * Fase 5 — Analítica.
 *
 * - Previsión de ocupación: comensales confirmados/solicitados por día frente
 *   a la capacidad total de mesas del restaurante (siguientes N días).
 * - Informe de canales: reservas y conversaciones por canal de origen en los
 *   últimos 30 días, con tasas de conversión, cancelación y no-show.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(tenantId: string, restaurantId: string, days = 14) {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
    });
    if (!restaurant) {
      throw new NotFoundException(
        `Restaurante ${restaurantId} no encontrado en este tenant`,
      );
    }

    const tables = await this.prisma.table.findMany({
      where: { restaurantId, isActive: true },
      select: { capacity: true },
    });
    const capacity = tables.reduce((sum, t) => sum + t.capacity, 0);

    const now = new Date();
    const horizonDays = Math.min(Math.max(days, 1), 60);

    // ---- Previsión de ocupación (días locales del servidor) ----
    const occupancy: Array<{
      date: string;
      label: string;
      count: number;
      covers: number;
      occupancyPct: number;
    }> = [];
    for (let i = 0; i < horizonDays; i++) {
      const day = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + i,
      );
      const dateKey = toDateKey(day);
      const start = parseLocalDate(dateKey);
      const end = endOfDay(start);
      const reservations = await this.prisma.reservation.findMany({
        where: {
          restaurantId,
          status: { in: ACTIVE },
          startsAt: { gte: start, lt: end },
        },
        select: { partySize: true },
      });
      const covers = reservations.reduce((s, r) => s + r.partySize, 0);
      occupancy.push({
        date: dateKey,
        label: day.toLocaleDateString('es-EC', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }),
        count: reservations.length,
        covers,
        occupancyPct: capacity > 0 ? Math.round((covers / capacity) * 100) : 0,
      });
    }

    // ---- Informe de canales (últimos 30 días) ----
    const since = new Date(now.getTime() - CHANNEL_WINDOW_DAYS * 24 * 3_600_000);
    const resRows = await this.prisma.reservation.findMany({
      where: { restaurantId, createdAt: { gte: since } },
      select: { channel: true, status: true },
    });

    const total = resRows.length;
    const byChannel = new Map<Channel, ChannelReportRow>();
    for (const row of resRows) {
      let entry = byChannel.get(row.channel);
      if (!entry) {
        entry = {
          channel: row.channel,
          total: 0,
          requested: 0,
          confirmed: 0,
          cancelled: 0,
          noShow: 0,
          completed: 0,
          sharePct: 0,
        };
        byChannel.set(row.channel, entry);
      }
      entry.total++;
      switch (row.status) {
        case ReservationStatus.REQUESTED:
          entry.requested++;
          break;
        case ReservationStatus.CONFIRMED:
          entry.confirmed++;
          break;
        case ReservationStatus.CANCELLED:
          entry.cancelled++;
          break;
        case ReservationStatus.NO_SHOW:
          entry.noShow++;
          break;
        case ReservationStatus.COMPLETED:
          entry.completed++;
          break;
      }
    }
    const channels: ChannelReportRow[] = [...byChannel.values()].map((c) => ({
      ...c,
      sharePct: total > 0 ? Math.round((c.total / total) * 100) : 0,
    }));
    channels.sort((a, b) => b.total - a.total);

    const conversations = await this.prisma.conversation.groupBy({
      by: ['channel'],
      where: { restaurantId, createdAt: { gte: since } },
      _count: { _all: true },
    });

    // ---- Métricas del día y próximas ----
    const todayKey = toDateKey(now);
    const todayStart = parseLocalDate(todayKey);
    const tomorrowStart = endOfDay(todayStart);
    const in7 = new Date(tomorrowStart.getTime() + 7 * 24 * 3_600_000);
    const [todayRows, upcomingRows] = await Promise.all([
      this.prisma.reservation.findMany({
        where: {
          restaurantId,
          status: { in: ACTIVE },
          startsAt: { gte: todayStart, lt: tomorrowStart },
        },
        select: { partySize: true },
      }),
      this.prisma.reservation.findMany({
        where: {
          restaurantId,
          status: { in: ACTIVE },
          startsAt: { gte: tomorrowStart, lt: in7 },
        },
        select: { partySize: true },
      }),
    ]);

    const confirmed = resRows.filter(
      (r) => r.status === ReservationStatus.CONFIRMED,
    ).length;
    const completed = resRows.filter(
      (r) => r.status === ReservationStatus.COMPLETED,
    ).length;
    const noShow = resRows.filter(
      (r) => r.status === ReservationStatus.NO_SHOW,
    ).length;
    const cancelled = resRows.filter(
      (r) => r.status === ReservationStatus.CANCELLED,
    ).length;

    return {
      generatedAt: now.toISOString(),
      capacity,
      today: {
        count: todayRows.length,
        covers: todayRows.reduce((s, r) => s + r.partySize, 0),
      },
      upcoming: {
        count: upcomingRows.length,
        covers: upcomingRows.reduce((s, r) => s + r.partySize, 0),
      },
      occupancy,
      channels,
      conversationsByChannel: conversations.map((c) => ({
        channel: c.channel,
        count: c._count._all,
      })),
      rates: {
        confirmationRate:
          total > 0 ? Math.round((confirmed / total) * 100) : 0,
        cancellationRate:
          total > 0 ? Math.round((cancelled / total) * 100) : 0,
        noShowRate:
          completed + noShow > 0
            ? Math.round((noShow / (completed + noShow)) * 100)
            : 0,
      },
    };
  }
}
