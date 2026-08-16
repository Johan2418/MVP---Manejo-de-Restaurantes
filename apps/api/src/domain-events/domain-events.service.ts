import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import {
  DomainEvent,
  DomainEventName,
  TenantId,
} from '@reservas/shared';

/**
 * Bus de eventos de dominio (Fase 1: en memoria con EventEmitter2).
 *
 * Principio del plan: todos los canales emiten eventos a este bus; los futuros
 * agentes de IA serán consumidores adicionales. Cuando llegue la fase de
 * integraciones se podrá sustituir por un outbox persistente sin cambiar los
 * emisores.
 */
@Injectable()
export class DomainEventsService {
  constructor(private readonly emitter: EventEmitter2) {}

  emit<T>(name: DomainEventName, tenantId: TenantId, payload: T): void {
    const event: DomainEvent<T> = {
      name,
      id: randomUUID(),
      tenantId,
      occurredAt: new Date().toISOString(),
      payload,
    };
    this.emitter.emit(name, event);
  }
}
