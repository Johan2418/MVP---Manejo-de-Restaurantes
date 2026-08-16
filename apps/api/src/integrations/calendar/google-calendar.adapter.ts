import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CalendarAdapter,
  CalendarCredentials,
  CalendarEvent,
  CalendarSyncContext,
} from './calendar.adapter';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_URL = 'https://www.googleapis.com/calendar/v3';

/** Alcance mínimo: eventos de un calendario (lectura/escritura). */
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

interface GoogleEvent {
  id?: string;
  summary?: string;
  description?: string;
  status?: string;
  start?: { dateTime?: string; timeZone?: string; date?: string };
  end?: { dateTime?: string; timeZone?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

/**
 * Adaptador de Google Calendar (Fase 4).
 *
 * Implementa el contrato `CalendarAdapter` usando la REST API de Calendar v3
 * con `fetch` nativo (sin dependencias nuevas). OAuth2 con `access_type=offline`
 * para obtener refresh token y renovar sin intervención del usuario.
 */
@Injectable()
export class GoogleCalendarAdapter implements CalendarAdapter {
  constructor(private readonly config: ConfigService) {}

  private get clientId(): string {
    return this.config.get<string>('GOOGLE_CLIENT_ID', '');
  }

  private get clientSecret(): string {
    return this.config.get<string>('GOOGLE_CLIENT_SECRET', '');
  }

  /** URL de redirección registrada en Google Cloud Console. */
  private get redirectUri(): string {
    const base = this.config.get<string>(
      'WEBHOOK_BASE_URL',
      'http://localhost:3001',
    );
    return (
      this.config.get<string>('GOOGLE_REDIRECT_URI', '') ||
      `${base}/api/integrations/google/callback`
    );
  }

  getAuthUrl(state: string): string {
    if (!this.clientId) {
      throw new ServiceUnavailableException(
        'Google Calendar no configurado: añade GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en las API Keys.',
      );
    }
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{
    credentials: CalendarCredentials;
    config: Record<string, unknown>;
  }> {
    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
    });
    if (!tokens.access_token) {
      throw new ServiceUnavailableException(
        'Google no devolvió un access token (revisa GOOGLE_CLIENT_ID/SECRET y la redirect URI).',
      );
    }
    return {
      credentials: this.toCredentials(tokens),
      config: { calendarId: 'primary' },
    };
  }

  async refreshIfExpired(
    credentials: CalendarCredentials,
  ): Promise<CalendarCredentials> {
    if (credentials.expiresAt > Date.now() + 60_000) return credentials;
    if (!credentials.refreshToken) return credentials; // sin refresh: se reintentará y fallará con 401

    const tokens = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    return {
      accessToken: tokens.access_token,
      refreshToken: credentials.refreshToken,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    };
  }

  async listEvents(
    ctx: CalendarSyncContext,
    timeMin: string,
    timeMax: string,
  ): Promise<CalendarEvent[]> {
    const calendarId = this.calendarId(ctx);
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    const data = await this.calendarRequest<{ items?: GoogleEvent[] }>(
      ctx.credentials.accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    );
    return (data.items ?? []).map(this.fromGoogleEvent);
  }

  async upsertEvent(
    ctx: CalendarSyncContext,
    event: CalendarEvent,
  ): Promise<CalendarEvent> {
    const calendarId = this.calendarId(ctx);
    // Busca el evento existente por reservationId (la API no filtra por
    // extendedProperties, así que se listan los del día y se comparan).
    const existing = await this.findByReservationId(ctx, event);
    const google: GoogleEvent = {
      summary: event.summary,
      description: event.description,
      status: event.status === 'cancelled' ? 'cancelled' : 'confirmed',
      start: { dateTime: event.start.dateTime, timeZone: event.start.timeZone },
      end: { dateTime: event.end.dateTime, timeZone: event.end.timeZone },
      extendedProperties: {
        private: { reservationId: event.reservationId ?? '' },
      },
    };
    if (existing?.id) {
      await this.calendarRequest(
        ctx.credentials.accessToken,
        `/calendars/${encodeURIComponent(calendarId)}/events/${existing.id}`,
        'PUT',
        google,
      );
      return { ...event, id: existing.id };
    }
    const created = await this.calendarRequest<GoogleEvent>(
      ctx.credentials.accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      'POST',
      google,
    );
    return { ...event, id: created.id };
  }

  async deleteEvent(ctx: CalendarSyncContext, eventId: string): Promise<void> {
    const calendarId = this.calendarId(ctx);
    await this.calendarRequest(
      ctx.credentials.accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      'DELETE',
    );
  }

  // ---------- Internos ----------

  private calendarId(ctx: CalendarSyncContext): string {
    const id = ctx.config.calendarId;
    return typeof id === 'string' && id.trim() ? id : 'primary';
  }

  private toCredentials(tokens: TokenResponse): CalendarCredentials {
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    };
  }

  private async findByReservationId(
    ctx: CalendarSyncContext,
    event: CalendarEvent,
  ): Promise<GoogleEvent | null> {
    if (!event.reservationId) return null;
    // Ventana amplia alrededor del evento para tolerar cambios de hora.
    const start = new Date(event.start.dateTime);
    const timeMin = new Date(start.getTime() - 2 * 3_600_000).toISOString();
    const timeMax = new Date(start.getTime() + 26 * 3_600_000).toISOString();
    const events = await this.listEvents(ctx, timeMin, timeMax);
    return (
      events.find((e) => e.reservationId === event.reservationId) ??
      null
    );
  }

  private fromGoogleEvent(e: GoogleEvent): CalendarEvent {
    const reservationId =
      e.extendedProperties?.private?.reservationId ?? undefined;
    return {
      id: e.id,
      summary: e.summary ?? '',
      description: e.description,
      start: {
        dateTime: e.start?.dateTime ?? e.start?.date ?? '',
        timeZone: e.start?.timeZone ?? '',
      },
      end: {
        dateTime: e.end?.dateTime ?? e.end?.date ?? '',
        timeZone: e.end?.timeZone ?? '',
      },
      status: e.status === 'cancelled' ? 'cancelled' : 'confirmed',
      reservationId,
    };
  }

  private async tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
    if (!this.clientId || !this.clientSecret) {
      throw new ServiceUnavailableException(
        'Google Calendar no configurado: añade GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en las API Keys.',
      );
    }
    return this.request(TOKEN_URL, 'POST', undefined, body, 'application/x-www-form-urlencoded');
  }

  private async calendarRequest<T = GoogleEvent>(
    accessToken: string,
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: GoogleEvent,
  ): Promise<T> {
    return this.request(
      `${CALENDAR_URL}${path}`,
      method,
      { Authorization: `Bearer ${accessToken}` },
      body,
      'application/json',
    );
  }

  private async request<T>(
    url: string,
    method: string,
    headers: Record<string, string> | undefined,
    body: unknown,
    contentType: string,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...(contentType ? { 'Content-Type': contentType } : {}),
          ...headers,
        },
        body:
          method === 'GET' || method === 'DELETE'
            ? undefined
            : contentType === 'application/json'
              ? JSON.stringify(body)
              : new URLSearchParams(body as Record<string, string>).toString(),
      });
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo contactar con Google (revisa la red y WEBHOOK_BASE_URL).',
      );
    }
    if (!res.ok) {
      let message = `Google API ${res.status}`;
      try {
        const data = (await res.json()) as { error?: { message?: string } };
        if (data.error?.message) message = `${message}: ${data.error.message}`;
      } catch {
        // sin cuerpo JSON
      }
      throw new ServiceUnavailableException(message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
