/**
 * Contrato de adaptadores de calendario (Fase 4 — Integraciones).
 *
 * El objetivo del plan es un proveedor intercambiable: Google Calendar hoy,
 * CalDAV/Outlook mañana, con la misma interfaz. La sincronización 2-way usa
 * solo estos métodos.
 */

/** Credenciales OAuth guardadas en `Integration.credentials` (JSON privado). */
export interface CalendarCredentials {
  accessToken: string;
  /** Solo presente si el proveedor entregó refresh token (offline access). */
  refreshToken?: string;
  /** Epoch ms en que expira `accessToken`. */
  expiresAt: number;
}

/** Evento normalizado de calendario (independiente del proveedor). */
export interface CalendarEvent {
  /** Id del evento en el proveedor (undefined al crear). */
  id?: string;
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

export interface CalendarAdapter {
  /** URL de autorización OAuth para conectar el calendario del restaurante. */
  getAuthUrl(state: string): string;

  /** Intercambia el code de OAuth por credenciales y configuración inicial. */
  exchangeCode(code: string): Promise<{
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
   * `reservationId`). Devuelve el evento con su id.
   */
  upsertEvent(ctx: CalendarSyncContext, event: CalendarEvent): Promise<CalendarEvent>;

  /** Elimina el evento del calendario. */
  deleteEvent(ctx: CalendarSyncContext, eventId: string): Promise<void>;
}
