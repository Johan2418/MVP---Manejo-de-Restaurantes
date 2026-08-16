import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReservationStatus } from '@prisma/client';
import {
  ACTIVE_RESERVATION_STATUSES,
  DOMAIN_EVENTS,
  TenantId,
} from '@reservas/shared';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { TablesService } from '../tables/tables.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { TransitionReservationDto } from './dto/transition-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import {
  addMinutes,
  combineDateAndTime,
  endOfDay,
  formatHHMM,
  parseLocalDate,
} from '../common/dates';

/** Estados que ocupan mesa y bloquean disponibilidad. */
const ACTIVE = [...ACTIVE_RESERVATION_STATUSES];

/** Transiciones de estado permitidas (máquina de estados). */
const TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  REQUESTED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED', 'COMPLETED', 'NO_SHOW'],
  CANCELLED: [],
  NO_SHOW: [],
  COMPLETED: [],
};

const CREATABLE_STATUSES: ReservationStatus[] = ['REQUESTED', 'CONFIRMED'];

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tables: TablesService,
    private readonly domainEvents: DomainEventsService,
  ) {}

  // ---------- Consultas ----------

  /** Reservas del día (rango local) con comensal y mesa. */
  async listByDate(tenantId: string, restaurantId: string, date: string) {
    await this.tables.assertRestaurantInTenant(tenantId, restaurantId);
    const start = parseLocalDate(date);
    const end = endOfDay(start);
    return this.prisma.reservation.findMany({
      where: { restaurantId, startsAt: { gte: start, lt: end } },
      include: { guest: true, table: true },
      orderBy: { startsAt: 'asc' },
    });
  }

  async get(tenantId: string, restaurantId: string, reservationId: string) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id: reservationId, restaurantId, tenantId },
      include: { guest: true, table: true },
    });
    if (!reservation) {
      throw new NotFoundException(
        `Reserva ${reservationId} no encontrada`,
      );
    }
    return reservation;
  }

  // ---------- Creación ----------

  async create(
    tenantId: string,
    restaurantId: string,
    dto: CreateReservationDto,
  ) {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
    });
    if (!restaurant) {
      throw new NotFoundException(`Restaurante ${restaurantId} no encontrado`);
    }

    const status = dto.status ?? ReservationStatus.REQUESTED;
    if (!CREATABLE_STATUSES.includes(status)) {
      throw new BadRequestException(
        `No se puede crear una reserva en estado ${status}`,
      );
    }

    const guestId = await this.resolveGuest(tenantId, dto);
    const startsAt = new Date(dto.startsAt);
    const durationMinutes =
      dto.durationMinutes ?? restaurant.defaultDurationMinutes;
    // "" desde el formulario ⇒ sin mesa asignada
    const tableId = dto.tableId?.trim() || undefined;

    if (tableId) {
      await this.assertTableAvailable(
        restaurantId,
        tableId,
        startsAt,
        durationMinutes,
      );
    }

    const reservation = await this.prisma.reservation.create({
      data: {
        tenantId,
        restaurantId,
        guestId,
        tableId,
        startsAt,
        durationMinutes,
        partySize: dto.partySize,
        status,
        channel: dto.channel ?? 'WEB',
        customerNotes: dto.customerNotes,
        internalNotes: dto.internalNotes,
      },
      include: { guest: true, table: true },
    });

    this.domainEvents.emit(
      status === ReservationStatus.CONFIRMED
        ? DOMAIN_EVENTS.RESERVATION_CONFIRMED
        : DOMAIN_EVENTS.RESERVATION_REQUESTED,
      tenantId as TenantId,
      { reservationId: reservation.id, restaurantId },
    );

    // Fase 5: confirmada sin mesa → asignación automática (no rompe la creación).
    if (status === ReservationStatus.CONFIRMED && !tableId) {
      await this.tryAutoAssign(tenantId, restaurantId, reservation.id);
    }

    return reservation;
  }

  /** Comensal existente o creación por nombre+teléfono. */
  private async resolveGuest(
    tenantId: string,
    dto: CreateReservationDto,
  ): Promise<string | undefined> {
    if (dto.guestId) {
      const guest = await this.prisma.guest.findFirst({
        where: { id: dto.guestId, tenantId },
      });
      if (!guest) {
        throw new NotFoundException(
          `Comensal ${dto.guestId} no encontrado en este tenant`,
        );
      }
      return guest.id;
    }

    if (!dto.guestName || !dto.guestPhone) {
      throw new BadRequestException(
        'Se requiere guestId o guestName + guestPhone',
      );
    }

    const existing = await this.prisma.guest.findUnique({
      where: { tenantId_phone: { tenantId, phone: dto.guestPhone } },
    });
    if (existing) return existing.id;

    const created = await this.prisma.guest.create({
      data: {
        tenantId,
        name: dto.guestName,
        phone: dto.guestPhone,
        consent: false, // LOPDP: pedir consentimiento explícito en Fase 3
      },
    });
    return created.id;
  }

  // ---------- Reprogramación ----------

  async update(
    tenantId: string,
    restaurantId: string,
    reservationId: string,
    dto: UpdateReservationDto,
  ) {
    const current = await this.get(tenantId, restaurantId, reservationId);

    if (!ACTIVE.includes(current.status)) {
      throw new BadRequestException(
        `No se puede modificar una reserva en estado ${current.status}`,
      );
    }

    const nextStartsAt = dto.startsAt ? new Date(dto.startsAt) : current.startsAt;
    const nextDuration = dto.durationMinutes ?? current.durationMinutes;
    // "" ⇒ liberar la mesa (null)
    const nextTableId =
      dto.tableId !== undefined
        ? (dto.tableId.trim() || null)
        : current.tableId;

    const rescheduled =
      nextStartsAt.getTime() !== current.startsAt.getTime() ||
      nextDuration !== current.durationMinutes ||
      nextTableId !== current.tableId;

    if (rescheduled && nextTableId) {
      await this.assertTableAvailable(
        restaurantId,
        nextTableId,
        nextStartsAt,
        nextDuration,
        reservationId,
      );
    }

    const updated = await this.prisma.reservation.update({
      where: { id: reservationId },
      data: {
        startsAt: nextStartsAt,
        durationMinutes: nextDuration,
        tableId: nextTableId,
        partySize: dto.partySize,
        customerNotes: dto.customerNotes,
        internalNotes: dto.internalNotes,
      },
      include: { guest: true, table: true },
    });

    if (rescheduled) {
      this.domainEvents.emit(
        DOMAIN_EVENTS.RESERVATION_RESCHEDULED,
        tenantId as TenantId,
        { reservationId, startsAt: updated.startsAt.toISOString() },
      );
    }

    return updated;
  }

  // ---------- Transiciones de estado ----------

  async transition(
    tenantId: string,
    restaurantId: string,
    reservationId: string,
    dto: TransitionReservationDto,
  ) {
    const current = await this.get(tenantId, restaurantId, reservationId);
    const target = dto.status;

    if (!TRANSITIONS[current.status].includes(target)) {
      throw new BadRequestException(
        `Transición inválida: ${current.status} → ${target}`,
      );
    }

    const data: Prisma.ReservationUpdateInput = { status: target };
    if (target === ReservationStatus.CANCELLED) {
      data.cancelledAt = new Date();
    }
    if (
      target === ReservationStatus.COMPLETED ||
      target === ReservationStatus.NO_SHOW
    ) {
      data.completedAt = new Date();
    }

    const updated = await this.prisma.reservation.update({
      where: { id: reservationId },
      data,
      include: { guest: true, table: true },
    });

    // Métrica simple: visita completada suma al historial del comensal.
    if (target === ReservationStatus.COMPLETED && current.guestId) {
      await this.prisma.guest.update({
        where: { id: current.guestId },
        data: { visits: { increment: 1 } },
      });
    }

    // Fase 5 — reasignación automática:
    // - Al confirmar sin mesa → intenta asignársela ya.
    // - Al cancelar/completar/no-show se libera una mesa → barre el
    //   restaurante para recolocar reservas que antes no cabían.
    if (target === ReservationStatus.CONFIRMED && !current.tableId) {
      await this.tryAutoAssign(tenantId, restaurantId, reservationId);
    } else if (
      (
        [
          ReservationStatus.CANCELLED,
          ReservationStatus.COMPLETED,
          ReservationStatus.NO_SHOW,
        ] as ReservationStatus[]
      ).includes(target)
    ) {
      await this.tryAutoAssign(tenantId, restaurantId);
    }

    const event =
      target === ReservationStatus.CONFIRMED
        ? DOMAIN_EVENTS.RESERVATION_CONFIRMED
        : target === ReservationStatus.CANCELLED
          ? DOMAIN_EVENTS.RESERVATION_CANCELLED
          : target === ReservationStatus.NO_SHOW
            ? DOMAIN_EVENTS.RESERVATION_NO_SHOW
            : null;
    if (event) {
      this.domainEvents.emit(event, tenantId as TenantId, { reservationId });
    }

    return updated;
  }

  // ---------- Asignación automática de mesas (Fase 5) ----------

  /**
   * Asigna automáticamente la mesa más pequeña que quepa al grupo y esté
   * libre en el horario de cada reserva activa sin mesa (Fase 5).
   *
   * Greedy por hora de inicio: procesa en orden cronológico para que las
   * reservas más tempranas no pierdan la mesa. Si `onlyReservationId` llega,
   * solo se intenta asignar esa reserva.
   */
  async autoAssign(
    tenantId: string,
    restaurantId: string,
    onlyReservationId?: string,
  ): Promise<{ assigned: number }> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
    });
    if (!restaurant) {
      throw new NotFoundException(
        `Restaurante ${restaurantId} no encontrado en este tenant`,
      );
    }

    const unassigned = await this.prisma.reservation.findMany({
      where: {
        restaurantId,
        status: { in: ACTIVE },
        tableId: null,
        ...(onlyReservationId ? { id: onlyReservationId } : {}),
      },
      orderBy: [{ startsAt: 'asc' }, { partySize: 'desc' }],
    });
    if (unassigned.length === 0) return { assigned: 0 };

    // Mesas activas de menor a mayor capacidad (el mejor ajuste primero).
    const tables = await this.prisma.table.findMany({
      where: { restaurantId, isActive: true },
      orderBy: [{ capacity: 'asc' }, { name: 'asc' }],
    });

    // Franjas ocupadas por mesa de las reservas ya asignadas (activas).
    const assigned = await this.prisma.reservation.findMany({
      where: { restaurantId, status: { in: ACTIVE }, tableId: { not: null } },
      select: { tableId: true, startsAt: true, durationMinutes: true },
    });
    const occupied = new Map<string, Array<[number, number]>>();
    for (const r of assigned) {
      if (!r.tableId) continue;
      const list = occupied.get(r.tableId) ?? [];
      list.push([
        r.startsAt.getTime(),
        r.startsAt.getTime() + r.durationMinutes * 60_000,
      ]);
      occupied.set(r.tableId, list);
    }

    let assignedCount = 0;
    for (const res of unassigned) {
      const start = res.startsAt.getTime();
      const end = start + res.durationMinutes * 60_000;
      const candidate = tables.find((t) => {
        if (t.capacity < res.partySize) return false;
        const busy = occupied.get(t.id) ?? [];
        return !busy.some(([s, e]) => s < end && e > start);
      });
      if (!candidate) continue;
      await this.prisma.reservation.update({
        where: { id: res.id },
        data: { tableId: candidate.id },
      });
      const list = occupied.get(candidate.id) ?? [];
      list.push([start, end]);
      occupied.set(candidate.id, list);
      assignedCount++;
    }
    return { assigned: assignedCount };
  }

  /** Asignación automática con fallo silencioso (no debe romper la operación). */
  private async tryAutoAssign(
    tenantId: string,
    restaurantId: string,
    reservationId?: string,
  ) {
    try {
      const { assigned } = await this.autoAssign(
        tenantId,
        restaurantId,
        reservationId,
      );
      if (assigned > 0) {
        this.logger.log(
          `Auto-asignación: ${assigned} mesa(s) asignadas en ${restaurantId}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Auto-asignación falló: ${(err as Error).message}`,
      );
    }
  }

  // ---------- Conflictos y disponibilidad ----------

  /**
   * Comprueba que la mesa esté libre en la franja [startsAt, startsAt+duration).
   * Lanza 409 si se solapa con otra reserva activa (REQUESTED/CONFIRMED).
   */
  async assertTableAvailable(
    restaurantId: string,
    tableId: string,
    startsAt: Date,
    durationMinutes: number,
    excludeReservationId?: string,
  ) {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, restaurantId, isActive: true },
    });
    if (!table) {
      throw new NotFoundException(`Mesa ${tableId} no encontrada o inactiva`);
    }

    const start = startsAt.getTime();
    const end = start + durationMinutes * 60_000;

    const overlapping = await this.prisma.reservation.findMany({
      where: {
        restaurantId,
        tableId,
        status: { in: ACTIVE },
        ...(excludeReservationId
          ? { id: { not: excludeReservationId } }
          : {}),
        startsAt: { lt: new Date(end) },
      },
      include: { guest: true },
    });

    const clash = overlapping.find(
      (r) => r.startsAt.getTime() + r.durationMinutes * 60_000 > start,
    );
    if (clash) {
      const from = formatHHMM(clash.startsAt);
      const to = formatHHMM(
        addMinutes(clash.startsAt, clash.durationMinutes),
      );
      throw new ConflictException(
        `La mesa ${table.name} ya está reservada de ${from} a ${to}${clash.guest ? ` (${clash.guest.name})` : ''}`,
      );
    }
  }

  /**
   * Franjas libres por mesa para una fecha, número de comensales y duración.
   * Combina horarios de apertura del día y reservas activas.
   */
  async getAvailability(
    tenantId: string,
    restaurantId: string,
    date: string,
    partySize: number,
    duration?: number,
  ) {
    const day = parseLocalDate(date);
    const restaurant = await this.tables.assertRestaurantInTenant(
      tenantId,
      restaurantId,
    );
    const effectiveDuration = duration ?? restaurant.defaultDurationMinutes;

    const tables = await this.prisma.table.findMany({
      where: { restaurantId, isActive: true, capacity: { gte: partySize } },
      orderBy: [{ zone: 'asc' }, { name: 'asc' }],
    });

    const openings = await this.prisma.openingHour.findMany({
      where: { restaurantId, dayOfWeek: day.getDay(), enabled: true },
      orderBy: { openTime: 'asc' },
    });
    if (tables.length === 0 || openings.length === 0) {
      return { date, partySize, durationMinutes: effectiveDuration, slots: [] };
    }

    const dayEnd = endOfDay(day);
    const reservations = await this.prisma.reservation.findMany({
      where: {
        restaurantId,
        status: { in: ACTIVE },
        tableId: { not: null },
        startsAt: { gte: day, lt: dayEnd },
      },
    });

    // Franjas ocupadas por mesa: pares [inicio, fin) en milisegundos.
    const occupied = new Map<string, Array<[number, number]>>();
    for (const r of reservations) {
      if (!r.tableId) continue;
      if (!occupied.has(r.tableId)) occupied.set(r.tableId, []);
      occupied
        .get(r.tableId)!
        .push([r.startsAt.getTime(), r.startsAt.getTime() + r.durationMinutes * 60_000]);
    }

    const STEP_MINUTES = 30;
    const slots: Array<{
      tableId: string;
      tableName: string;
      zone: string | null;
      capacity: number;
      startsAt: string;
    }> = [];

    for (const table of tables) {
      const busy = occupied.get(table.id) ?? [];
      for (const opening of openings) {
        let cursor = combineDateAndTime(day, opening.openTime);
        const close = combineDateAndTime(day, opening.closeTime);
        while (cursor.getTime() + effectiveDuration * 60_000 <= close.getTime()) {
          const slotStart = cursor.getTime();
          const slotEnd = slotStart + effectiveDuration * 60_000;
          const clashes = busy.some(([s, e]) => s < slotEnd && e > slotStart);
          if (!clashes) {
            slots.push({
              tableId: table.id,
              tableName: table.name,
              zone: table.zone,
              capacity: table.capacity,
              startsAt: new Date(slotStart).toISOString(),
            });
          }
          cursor = new Date(slotStart + STEP_MINUTES * 60_000);
        }
      }
    }

    return { date, partySize, durationMinutes: effectiveDuration, slots };
  }
}
