/**
 * @reservas/shared — Tipos y constantes de dominio compartidos entre API y Web.
 *
 * Fase 0: contiene los tipos base (multi-tenant, canales, estados de reserva) y el
 * contrato de nombres de eventos de dominio. Este contrato es la clave para que los
 * futuros agentes de IA se integren como consumidores del bus de eventos.
 */

/** Identificador de un tenant (SaaS multi-tenant). */
export type TenantId = string & { readonly __brand: 'TenantId' };

/** Identificador de un restaurante. */
export type RestaurantId = string & { readonly __brand: 'RestaurantId' };

/** Canal por el que un cliente interactúa con el sistema. */
export const CHANNELS = ['phone', 'sms', 'whatsapp', 'web'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Ciclo de vida de una reserva. */
export const RESERVATION_STATUSES = [
  'requested',
  'confirmed',
  'cancelled',
  'rescheduled',
  'no_show',
  'completed',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/**
 * Contrato de eventos de dominio (Fase 0: definición).
 * Todo canal emite estos eventos al bus; los agentes de IA del futuro serán
 * consumidores adicionales del mismo bus.
 */
export const DOMAIN_EVENTS = {
  RESERVATION_REQUESTED: 'reservation.requested',
  RESERVATION_CONFIRMED: 'reservation.confirmed',
  RESERVATION_CANCELLED: 'reservation.cancelled',
  RESERVATION_RESCHEDULED: 'reservation.rescheduled',
  RESERVATION_REMINDER_SENT: 'reservation.reminder.sent',
  RESERVATION_NO_SHOW: 'reservation.no_show',
  GUEST_REPLIED: 'guest.replied',
  CALL_RECEIVED: 'call.received',
  CALL_ENDED: 'call.ended',
} as const;
export type DomainEventName = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

/** Estructura mínima de un evento de dominio emitido al bus. */
export interface DomainEvent<T = unknown> {
  /** Nombre del evento (ver DOMAIN_EVENTS). */
  name: DomainEventName;
  /** Identificador único del evento (clave de idempotencia). */
  id: string;
  /** Tenant al que pertenece el evento. */
  tenantId: TenantId;
  /** Marca de tiempo ISO 8601 de emisión. */
  occurredAt: string;
  /** Carga útil específica del evento. */
  payload: T;
}
