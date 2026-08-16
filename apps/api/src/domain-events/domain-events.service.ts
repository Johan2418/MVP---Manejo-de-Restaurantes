import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  DomainEvent,
  DomainEventName,
  TenantId,
} from '@reservas/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Bus de eventos de dominio (en memoria con EventEmitter2 + outbox persistido).
 *
 * Principio del plan: todos los canales emiten eventos a este bus; los futuros
 * agentes de IA serán consumidores adicionales. Cada evento también se persiste
 * en `outbox_events` (Fase 3) de forma no bloqueante para garantizar
 * trazabilidad y permitir reprocesar sin perder eventos si el proceso se
 * reinicia.
 */
@Injectable()
export class DomainEventsService {
  private readonly logger = new Logger(DomainEventsService.name);

  constructor(
    private readonly emitter: EventEmitter2,
    private readonly prisma: PrismaService,
  ) {}

  emit<T>(name: DomainEventName, tenantId: TenantId, payload: T): void {
    const event: DomainEvent<T> = {
      name,
      id: randomUUID(),
      tenantId,
      occurredAt: new Date().toISOString(),
      payload,
    };
    this.emitter.emit(name, event);

    // Outbox: persistencia no bloqueante (fire-and-forget) del evento.
    this.persist(event).catch((err) => {
      this.logger.error(
        `[outbox] no se pudo persistir ${event.name}: ${(err as Error).message}`,
      );
    });
  }

  private async persist(event: DomainEvent): Promise<void> {
    await this.prisma.outboxEvent.create({
      data: {
        name: event.name,
        tenantId: event.tenantId,
        payload: event.payload as Prisma.InputJsonValue,
      },
    });
  }
}
