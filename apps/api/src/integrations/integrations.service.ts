import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { IntegrationProvider, IntegrationStatus } from '@prisma/client';
import { DOMAIN_EVENTS, TenantId } from '@reservas/shared';
import type { DomainEvent } from '@reservas/shared';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { CalendarSyncService, SyncResult } from './calendar/calendar-sync.service';
import { GoogleCalendarAdapter } from './calendar/google-calendar.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectCalDavDto } from './dto/connect-caldav.dto';

/** Delay tras un evento de reserva antes de sincronizar (espera al commit). */
const EVENT_SYNC_DELAY_MS = 5_000;

interface ConnectState {
  tenantId: string;
  restaurantId: string;
}

/**
 * Fase 4 — Integraciones.
 *
 * Orquesta la conexión OAuth con los proveedores (Google Calendar) y lanza la
 * sincronización 2-way: por eventos de reserva (confirmada/reprogramada/
 * cancelada) y por el cron periódico (BullMQ repeatable).
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    @InjectQueue('calendar-sync') private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly adapter: GoogleCalendarAdapter,
    private readonly sync: CalendarSyncService,
    private readonly config: ConfigService,
  ) {}

  // ---------- Listado (nunca expone credenciales) ----------

  async list(tenantId: string, restaurantId: string) {
    await this.assertRestaurantInTenant(tenantId, restaurantId);
    const rows = await this.prisma.integration.findMany({
      where: { tenantId, restaurantId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      status: r.status,
      config: r.config,
      lastSyncedAt: r.lastSyncedAt,
      lastError: r.lastError,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  // ---------- Google Calendar: conexión OAuth ----------

  /** URL de autorización de Google para conectar el calendario. */
  async getGoogleAuthUrl(
    tenantId: string,
    restaurantId: string,
  ): Promise<{ url: string }> {
    await this.assertRestaurantInTenant(tenantId, restaurantId);
    const state = Buffer.from(
      JSON.stringify({ tenantId, restaurantId } satisfies ConnectState),
    ).toString('base64url');
    return { url: this.adapter.getAuthUrl(state) };
  }

  /**
   * Callback OAuth de Google: intercambia el code, guarda las credenciales y
   * devuelve la URL a la que redirigir el navegador (página de integraciones).
   */
  async handleGoogleCallback(
    code?: string,
    state?: string,
  ): Promise<{ redirectUrl: string }> {
    if (!code || !state) {
      throw new BadRequestException('Faltan code o state en el callback OAuth');
    }
    let connectState: ConnectState;
    try {
      connectState = JSON.parse(
        Buffer.from(state, 'base64url').toString('utf8'),
      ) as ConnectState;
    } catch {
      throw new BadRequestException('State OAuth inválido');
    }

    const { credentials, config } = await this.adapter.exchangeCode(code);
    await this.prisma.integration.upsert({
      where: {
        restaurantId_provider: {
          restaurantId: connectState.restaurantId,
          provider: IntegrationProvider.GOOGLE_CALENDAR,
        },
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        credentials: credentials as unknown as object,
        config: config as unknown as object,
        lastError: null,
      },
      create: {
        tenantId: connectState.tenantId,
        restaurantId: connectState.restaurantId,
        provider: IntegrationProvider.GOOGLE_CALENDAR,
        status: IntegrationStatus.CONNECTED,
        credentials: credentials as unknown as object,
        config: config as unknown as object,
      },
    });

    this.logger.log(
      `Google Calendar conectado para ${connectState.restaurantId}`,
    );
    // Sincronización inicial inmediata (no bloquea la respuesta del callback).
    await this.enqueueRestaurantSync(connectState.restaurantId, 0);

    const webOrigin = this.config.get<string>('WEB_ORIGIN', 'http://localhost:3000');
    return {
      redirectUrl:
        `${webOrigin}/tenants/${connectState.tenantId}` +
        `/restaurants/${connectState.restaurantId}/integraciones?connected=google`,
    };
  }

  /** Desconecta la integración (borra credenciales y config). */
  async disconnect(
    tenantId: string,
    restaurantId: string,
    provider: IntegrationProvider,
  ) {
    await this.assertRestaurantInTenant(tenantId, restaurantId);
    await this.prisma.integration.deleteMany({
      where: { tenantId, restaurantId, provider },
    });
  }

  // ---------- CalDAV: conexión directa (URL + credenciales) ----------

  /**
   * Conecta un calendario CalDAV (Nextcloud, iCloud, Zimbra...). A diferencia
   * de Google, no hay OAuth: se guardan URL + usuario/contraseña y se valida
   * con un primer REPORT al guardar.
   */
  async connectCalDav(
    tenantId: string,
    restaurantId: string,
    dto: ConnectCalDavDto,
  ) {
    await this.assertRestaurantInTenant(tenantId, restaurantId);
    try {
      const url = new URL(dto.url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new BadRequestException(
          'La URL CalDAV debe usar http o https',
        );
      }
    } catch {
      throw new BadRequestException('URL CalDAV inválida');
    }

    await this.prisma.integration.upsert({
      where: {
        restaurantId_provider: {
          restaurantId,
          provider: IntegrationProvider.CALDAV,
        },
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        credentials: {
          calendarUrl: dto.url.trim(),
          username: dto.username?.trim() ?? '',
          password: dto.password ?? '',
        } as unknown as object,
        config: {} as unknown as object,
        lastError: null,
      },
      create: {
        tenantId,
        restaurantId,
        provider: IntegrationProvider.CALDAV,
        status: IntegrationStatus.CONNECTED,
        credentials: {
          calendarUrl: dto.url.trim(),
          username: dto.username?.trim() ?? '',
          password: dto.password ?? '',
        } as unknown as object,
        config: {} as unknown as object,
      },
    });

    this.logger.log(`CalDAV conectado para ${restaurantId}`);
    // Sincronización inicial (valida la conexión real contra el servidor).
    await this.enqueueRestaurantSync(restaurantId, 0);
    return { ok: true };
  }

  /** Sincronización manual (endpoint). */
  async syncNow(
    tenantId: string,
    restaurantId: string,
    integrationId: string,
  ): Promise<SyncResult> {
    await this.assertRestaurantInTenant(tenantId, restaurantId);
    const integration = await this.prisma.integration.findFirst({
      where: { id: integrationId, tenantId, restaurantId },
    });
    if (!integration) {
      throw new NotFoundException(`Integración ${integrationId} no encontrada`);
    }
    return this.sync.syncRestaurant(restaurantId);
  }

  // ---------- Reacción a eventos del bus ----------

  @OnEvent(DOMAIN_EVENTS.RESERVATION_CONFIRMED)
  @OnEvent(DOMAIN_EVENTS.RESERVATION_RESCHEDULED)
  @OnEvent(DOMAIN_EVENTS.RESERVATION_CANCELLED)
  async onReservationChanged(
    event: DomainEvent<{ reservationId: string; restaurantId?: string }>,
  ) {
    try {
      const reservation = await this.prisma.reservation.findUnique({
        where: { id: event.payload.reservationId },
        select: { restaurantId: true },
      });
      if (!reservation) return;
      await this.enqueueRestaurantSync(reservation.restaurantId);
    } catch (err) {
      // La programación no debe romper la transición de la reserva.
      this.logger.error(
        `No se pudo encolar sync: ${(err as Error).message}`,
      );
    }
  }

  /** Encola la sincronización de un restaurante (job deduplicado por restaurantId). */
  async enqueueRestaurantSync(restaurantId: string, delay = EVENT_SYNC_DELAY_MS) {
    await this.queue.add(
      'sync-restaurant',
      { restaurantId },
      {
        jobId: `sync-${restaurantId}`,
        delay,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: 500,
      },
    );
  }

  private async assertRestaurantInTenant(tenantId: string, restaurantId: string) {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
    });
    if (!restaurant) {
      throw new NotFoundException(
        `Restaurante ${restaurantId} no encontrado en este tenant`,
      );
    }
    return restaurant;
  }
}
