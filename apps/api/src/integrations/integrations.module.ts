import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { CalendarAdapterFactory } from './calendar/calendar-adapter.factory';
import { CalendarSyncProcessor } from './calendar/calendar-sync.processor';
import { CalendarSyncService } from './calendar/calendar-sync.service';
import { CalDavCalendarAdapter } from './calendar/caldav.adapter';
import { GoogleCalendarAdapter } from './calendar/google-calendar.adapter';
import {
  GoogleOAuthCallbackController,
  IntegrationsController,
} from './integrations.controller';
import { IntegrationsService } from './integrations.service';

/** Cada cuánto se barre la sincronización de todos los calendarios (ms). */
const CRON_EVERY_MS = 15 * 60_000;

@Module({
  imports: [
    BullModule.registerQueue({ name: 'calendar-sync' }),
    DomainEventsModule,
    PrismaModule,
    ReservationsModule,
  ],
  controllers: [IntegrationsController, GoogleOAuthCallbackController],
  providers: [
    IntegrationsService,
    GoogleCalendarAdapter,
    CalDavCalendarAdapter,
    CalendarAdapterFactory,
    CalendarSyncService,
    CalendarSyncProcessor,
  ],
  exports: [IntegrationsService],
})
export class IntegrationsModule implements OnApplicationBootstrap {
  constructor(@InjectQueue('calendar-sync') private readonly queue: Queue) {}

  /** Cron periódico (Job Scheduler de BullMQ v6): sincroniza todos los calendarios. */
  async onApplicationBootstrap() {
    await this.queue
      .upsertJobScheduler(
        'calendar-sync-cron',
        { every: CRON_EVERY_MS },
        { name: 'sync-all', data: {} },
      )
      .catch((err) => {
        // Sin Redis no hay cron, pero el resto del módulo sigue operativo.
        console.warn(
          `[integrations] no se pudo programar el cron: ${(err as Error).message}`,
        );
      });
  }
}
