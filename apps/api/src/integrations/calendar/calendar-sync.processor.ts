import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { IntegrationStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { CalendarSyncService } from './calendar-sync.service';
import { CALENDAR_PROVIDERS } from './calendar.adapter';

/**
 * Worker de la cola `calendar-sync` (Fase 4 — Integraciones).
 * - `sync-restaurant`: sincroniza un restaurante concreto (eventos del bus).
 * - `sync-all`: barrido periódico (cron cada 15 min) de todos los restaurantes
 *   con calendario conectado.
 */
@Processor('calendar-sync')
export class CalendarSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(CalendarSyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: CalendarSyncService,
  ) {
    super();
  }

  async process(job: Job<{ restaurantId?: string }>): Promise<void> {
    switch (job.name) {
      case 'sync-restaurant':
        return this.syncRestaurant(job.data.restaurantId);
      case 'sync-all':
        return this.syncAll();
      default:
        this.logger.warn(`Job desconocido: ${job.name}`);
    }
  }

  private async syncRestaurant(restaurantId?: string) {
    if (!restaurantId) return;
    try {
      const { pushed, pulled, deleted } = await this.sync.syncRestaurant(restaurantId);
      if (pushed + pulled + deleted > 0) {
        this.logger.log(
          `Sync ${restaurantId}: ${pushed} push, ${pulled} pull, ${deleted} borrados`,
        );
      }
    } catch (err) {
      // El estado ERROR ya quedó registrado por CalendarSyncService.
      this.logger.warn(`Sync de ${restaurantId} falló: ${(err as Error).message}`);
    }
  }

  private async syncAll() {
    const integrations = await this.prisma.integration.findMany({
      where: {
        provider: { in: [...CALENDAR_PROVIDERS] },
        status: IntegrationStatus.CONNECTED,
      },
      select: { restaurantId: true },
    });
    const ids = integrations.map((i) => i.restaurantId);
    if (ids.length === 0) return;
    this.logger.log(`Cron: sincronizando ${ids.length} calendario(s)`);
    await Promise.allSettled(ids.map((id) => this.sync.syncRestaurant(id)));
  }
}
