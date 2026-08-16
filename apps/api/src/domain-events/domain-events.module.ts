import { Injectable, Module } from '@nestjs/common';
import { EventEmitterModule, OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '@reservas/shared';
import { DomainEventsService } from './domain-events.service';

/**
 * Logger de observabilidad: demuestra el bus en acción. Los consumidores reales
 * (recordatorios, integraciones, agentes IA) se suscribirán de la misma forma.
 */
@Injectable()
export class DomainEventLogger {
  @OnEvent('reservation.*')
  @OnEvent('call.*')
  @OnEvent('guest.*')
  handle(event: DomainEvent) {
    console.log(
      `[evento] ${event.name} id=${event.id} tenant=${event.tenantId} en ${event.occurredAt}`,
    );
  }
}

@Module({
  imports: [EventEmitterModule.forRoot({ wildcard: true })],
  providers: [DomainEventsService, DomainEventLogger],
  exports: [DomainEventsService],
})
export class DomainEventsModule {}
