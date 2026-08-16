/**
 * @reservas/shared — Tipos y constantes de dominio compartidos entre API y Web.
 *
 * Fase 1: enums alineados con los de Prisma (mismos valores en mayúsculas),
 * etiquetas en español para la UI y el contrato de eventos de dominio.
 * El contrato de eventos es la clave para que los futuros agentes de IA se
 * integren como consumidores del bus.
 */

/** Identificador de un tenant (SaaS multi-tenant). */
export type TenantId = string & { readonly __brand: 'TenantId' };

/** Identificador de un restaurante. */
export type RestaurantId = string & { readonly __brand: 'RestaurantId' };

/** Canal por el que un cliente interactúa con el sistema (alineado con Prisma). */
export const CHANNELS = ['PHONE', 'SMS', 'WHATSAPP', 'WEB'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  PHONE: 'Teléfono',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  WEB: 'Web',
};

/** Ciclo de vida persistido de una reserva (alineado con Prisma). */
export const RESERVATION_STATUSES = [
  'REQUESTED',
  'CONFIRMED',
  'CANCELLED',
  'NO_SHOW',
  'COMPLETED',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  REQUESTED: 'Solicitada',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No asistió',
  COMPLETED: 'Completada',
};

/** Estados activos: ocupan mesa y bloquean franjas de disponibilidad. */
export const ACTIVE_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  'REQUESTED',
  'CONFIRMED',
];

/**
 * Contrato de eventos de dominio.
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
