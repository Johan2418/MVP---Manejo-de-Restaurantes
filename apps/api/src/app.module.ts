import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { DomainEventsModule } from './domain-events/domain-events.module';
import { RestaurantsModule } from './restaurants/restaurants.module';
import { TablesModule } from './tables/tables.module';
import { GuestsModule } from './guests/guests.module';
import { ReservationsModule } from './reservations/reservations.module';
import { ChannelsModule } from './channels/channels.module';
import { RemindersModule } from './reminders/reminders.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    // Variables de entorno globales (.env)
    ConfigModule.forRoot({ isGlobal: true }),

    // Redis + colas (BullMQ). La cola 'reminders' se usará en Fase 3
    // para recordatorios de reservas (SMS/llamadas programadas).
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL', 'redis://localhost:6379'),
        },
      }),
    }),
    BullModule.registerQueue({ name: 'reminders' }),
    BullModule.registerQueue({ name: 'calendar-sync' }),

    PrismaModule,
    HealthModule,
    DomainEventsModule,
    RestaurantsModule,
    TablesModule,
    GuestsModule,
    ReservationsModule,
    // Fase 2 — Canales: webhooks Twilio (SMS/WhatsApp/voz) y panel de conversaciones.
    ChannelsModule,
    // Fase 3 — Automatización: recordatorios y no-shows (cola BullMQ 'reminders').
    RemindersModule,
    // Fase 4 — Integraciones: Google Calendar + CalDAV 2-way sync (cola 'calendar-sync').
    IntegrationsModule,
    // Fase 5 — Analítica: previsión de ocupación e informe de canales.
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
