/**
 * Contrato de adaptadores de calendario (Fase 4 — Integraciones).
 *
 * El objetivo del plan es un proveedor intercambiable: Google Calendar y
 * CalDAV hoy, Outlook mañana, con la misma interfaz. La sincronización 2-way
 * usa solo estos métodos.
 */

/**
 * Credenciales guardadas en `Integration.credentials` (JSON privado, nunca se
 * exponen por la API REST).
 *
 * - OAuth (Google): `accessToken` + `refreshToken` + `expiresAt`.
 * - Acceso directo (CalDAV): `calendarUrl` + `username` + `password`.
 */
export interface CalendarCredentials {
  accessToken?: string;
  /** Solo presente si el proveedor entregó refresh token (offline access). */
  refreshToken?: string;
  /** Epoch ms en que expira `accessToken`. */
  expiresAt?: number;

  /** URL del calendario CalDAV (ej. https://dav.example.com/calendars/x/). */
  calendarUrl?: string;
  /** Usuario del servidor CalDAV. */
  username?: string;
  /** Contraseña o app-password del servidor CalDAV. */
  password?: string;
}

/** Evento normalizado de calendario (independiente del proveedor). */
export interface CalendarEvent {
  /** Id del evento en el proveedor (undefined al crear). */
  id?: string;
  /** URL del recurso en el proveedor (CalDAV usa PUT/DELETE sobre el href). */
  href?: string;
  summary: string;
  description?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  status: 'confirmed' | 'cancelled';
  /** Vinculación con la reserva (metadatos privados del proveedor). */
  reservationId?: string;
}

/** Contexto de una operación de sync (credenciales + configuración). */
export interface CalendarSyncContext {
  credentials: CalendarCredentials;
  /** Configuración del usuario (ej. { calendarId: "primary" }). */
  config: Record<string, unknown>;
}

/**
 * Contrato de un proveedor de calendario.
 *
 * `getAuthUrl`/`exchangeCode` solo existen en proveedores OAuth (Google);
 * CalDAV se conecta directamente con URL + usuario/contraseña y omite ambos.
 */
export interface CalendarAdapter {
  /** URL de autorización OAuth (solo proveedores OAuth). */
  getAuthUrl?(state: string): string;

  /** Intercambia el code de OAuth por credenciales (solo OAuth). */
  exchangeCode?(code: string): Promise<{
    credentials: CalendarCredentials;
    config: Record<string, unknown>;
  }>;

  /** Renueva el access token si está por expirar; devuelve credenciales nuevas. */
  refreshIfExpired(credentials: CalendarCredentials): Promise<CalendarCredentials>;

  /** Eventos del calendario en la ventana [timeMin, timeMax) (ISO). */
  listEvents(
    ctx: CalendarSyncContext,
    timeMin: string,
    timeMax: string,
  ): Promise<CalendarEvent[]>;

  /**
   * Inserta o actualiza el evento vinculado a la reserva (busca por
   * `reservationId`). Devuelve el evento con su id/href.
   */
  upsertEvent(ctx: CalendarSyncContext, event: CalendarEvent): Promise<CalendarEvent>;

  /** Elimina el evento del calendario. */
  deleteEvent(ctx: CalendarSyncContext, eventId: string): Promise<void>;
}

/** Token de inyección: mapa proveedor → adaptador (factory de Nest). */
export const CALENDAR_ADAPTERS = 'CALENDAR_ADAPTERS';

/** Proveedores de calendario soportados por la sincronización. */
export const CALENDAR_PROVIDERS = ['GOOGLE_CALENDAR', 'CALDAV'] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];
