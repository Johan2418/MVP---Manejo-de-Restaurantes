import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  CalendarAdapter,
  CalendarCredentials,
  CalendarEvent,
  CalendarSyncContext,
} from './calendar.adapter';

/**
 * Adaptador CalDAV (Fase 4 — Integraciones).
 *
 * Implementa el contrato `CalendarAdapter` contra cualquier servidor CalDAV
 * (Nextcloud, iCloud, Zimbra, etc.) con `fetch` nativo y Basic Auth:
 * - Push: PUT del VEVENT (crea si no existe por UID, actualiza por href).
 * - Pull: REPORT `calendar-query` con time-range.
 * - El vínculo con la reserva se guarda en la propiedad X-RESERVATION-ID.
 *
 * CalDAV no usa OAuth: la conexión es URL + usuario/contraseña, por lo que
 * omite getAuthUrl/exchangeCode (opcionales en la interfaz).
 */

interface ParsedCalDavEvent {
  uid: string;
  summary: string;
  description?: string;
  /** ISO UTC ("" si no se pudo parsear). */
  dtStart: string;
  dtEnd: string;
  status: 'confirmed' | 'cancelled';
  reservationId?: string;
}

interface MultistatusResponse {
  href: string;
  ical?: string;
}

/** TTL del cache de listados (evita N REPORTs por sync dentro de una corrida). */
const LIST_CACHE_TTL_MS = 30_000;
/** Ventana usada para buscar el evento existente en el upsert (horizonte de sync). */
const UPSERT_WINDOW_DAYS = 60;

@Injectable()
export class CalDavCalendarAdapter implements CalendarAdapter {
  private listCache: { key: string; at: number; events: CalendarEvent[] } | null =
    null;

  /** CalDAV no expira: las credenciales son válidas hasta que cambien. */
  async refreshIfExpired(
    credentials: CalendarCredentials,
  ): Promise<CalendarCredentials> {
    return credentials;
  }

  async listEvents(
    ctx: CalendarSyncContext,
    timeMin: string,
    timeMax: string,
  ): Promise<CalendarEvent[]> {
    const { calendarUrl } = ctx.credentials;
    if (!calendarUrl) {
      throw new ServiceUnavailableException(
        'CalDAV sin URL de calendario. Reconecta la integración.',
      );
    }
    const cacheKey = `${calendarUrl}|${timeMin}|${timeMax}`;
    if (
      this.listCache &&
      this.listCache.key === cacheKey &&
      Date.now() - this.listCache.at < LIST_CACHE_TTL_MS
    ) {
      return this.listCache.events;
    }

    const query = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">',
      '  <d:prop>',
      '    <d:getetag/>',
      '    <c:calendar-data/>',
      '  </d:prop>',
      '  <c:filter>',
      '    <c:comp-filter name="VCALENDAR">',
      '      <c:comp-filter name="VEVENT">',
      `        <c:time-range start="${toICalUtc(timeMin)}" end="${toICalUtc(timeMax)}"/>`,
      '      </c:comp-filter>',
      '    </c:comp-filter>',
      '  </c:filter>',
      '</c:calendar-query>',
    ].join('\n');

    const xml = await this.davRequest(
      ctx,
      calendarUrl,
      'REPORT',
      query,
      'application/xml; charset=utf-8',
    );

    const events: CalendarEvent[] = [];
    for (const response of parseMultistatus(xml)) {
      if (!response.ical) continue;
      for (const ev of parseICal(response.ical)) {
        events.push({
          id: ev.uid,
          href: resolveHref(calendarUrl, response.href),
          summary: ev.summary,
          description: ev.description,
          start: { dateTime: ev.dtStart, timeZone: 'UTC' },
          end: { dateTime: ev.dtEnd, timeZone: 'UTC' },
          status: ev.status,
          reservationId: ev.reservationId,
        });
      }
    }

    this.listCache = { key: cacheKey, at: Date.now(), events };
    return events;
  }

  async upsertEvent(
    ctx: CalendarSyncContext,
    event: CalendarEvent,
  ): Promise<CalendarEvent> {
    const { calendarUrl } = ctx.credentials;
    if (!calendarUrl) {
      throw new ServiceUnavailableException(
        'CalDAV sin URL de calendario. Reconecta la integración.',
      );
    }

    // Busca el evento existente por X-RESERVATION-ID en una ventana amplia:
    // el push recorre reservas de hasta ~45 días, así que el listado debe
    // cubrir ese horizonte para no duplicar eventos en syncs repetidas.
    const existing = event.reservationId
      ? (await this.listEvents(
          ctx,
          new Date(Date.now() - 24 * 3_600_000).toISOString(),
          new Date(
            Date.now() + UPSERT_WINDOW_DAYS * 24 * 3_600_000,
          ).toISOString(),
        )).find((e) => e.reservationId === event.reservationId)
      : undefined;

    const uid = `reserva-${event.reservationId ?? event.id ?? 'nuevo'}`;
    const ical = buildICalendar(event, uid);

    if (existing?.href) {
      await this.davRequest(ctx, existing.href, 'PUT', ical, 'text/calendar; charset=utf-8');
      return { ...event, id: uid, href: existing.href };
    }

    // Recurso nuevo: <calendar>/reserva-<id>.ics
    const href = `${calendarUrl.replace(/\/?$/, '/')}${uid}.ics`;
    await this.davRequest(ctx, href, 'PUT', ical, 'text/calendar; charset=utf-8');
    return { ...event, id: uid, href };
  }

  async deleteEvent(ctx: CalendarSyncContext, eventId: string): Promise<void> {
    const { calendarUrl } = ctx.credentials;
    if (!calendarUrl) {
      throw new ServiceUnavailableException(
        'CalDAV sin URL de calendario. Reconecta la integración.',
      );
    }
    // Si viene un href, se borra directamente; si es un UID, se busca.
    if (/^https?:\/\//.test(eventId)) {
      await this.davRequest(ctx, eventId, 'DELETE');
      return;
    }
    const events = await this.listEvents(
      ctx,
      new Date(Date.now() - 365 * 24 * 3_600_000).toISOString(),
      new Date(Date.now() + 365 * 24 * 3_600_000).toISOString(),
    );
    const target = events.find((e) => e.id === eventId);
    if (target?.href) {
      await this.davRequest(ctx, target.href, 'DELETE');
    }
  }

  // ---------- HTTP ----------

  private async davRequest(
    ctx: CalendarSyncContext,
    url: string,
    method: string,
    body?: string,
    contentType?: string,
  ): Promise<string> {
    const { username, password } = ctx.credentials;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${username ?? ''}:${password ?? ''}`,
          ).toString('base64')}`,
          ...(contentType ? { 'Content-Type': contentType } : {}),
          // Depth 1 solo es relevante para REPORT/PROPFIND.
          ...(method === 'REPORT' || method === 'PROPFIND'
            ? { Depth: '1' }
            : {}),
        },
        body,
      });
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo contactar con el servidor CalDAV (revisa la URL y la red).',
      );
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      throw new ServiceUnavailableException(
        `CalDAV ${res.status}${detail ? `: ${detail}` : ''}`,
      );
    }
    return res.text();
  }
}

// ---------- iCalendar (RFC 5545) ----------

/** Serializa un evento normalizado a VCALENDAR con una sola VEVENT (UTC). */
function buildICalendar(event: CalendarEvent, uid: string): string {
  const start = utcFromLocal(event.start.dateTime, event.start.timeZone);
  const end = utcFromLocal(event.end.dateTime, event.end.timeZone);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Reservas//Restaurantes//ES',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toICalDate(new Date())}`,
    `DTSTART:${toICalDate(start)}`,
    `DTEND:${toICalDate(end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    `STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(event.description
      ? [`DESCRIPTION:${escapeText(event.description)}`]
      : []),
    ...(event.reservationId
      ? [`X-RESERVATION-ID:${event.reservationId}`]
      : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

/** Parsea un VCALENDAR y devuelve sus VEVENTs (fechas normalizadas a UTC ISO). */
function parseICal(text: string): ParsedCalDavEvent[] {
  // Despliegue de líneas (RFC 5545 §3.1): una línea que empieza con espacio
  // o tab continúa la anterior.
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const events: ParsedCalDavEvent[] = [];
  const re = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(unfolded)) !== null) {
    const props = new Map<string, string[]>();
    for (const line of match[1].split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim().toUpperCase();
      const value = line.slice(idx + 1).trim();
      const list = props.get(key) ?? [];
      list.push(value);
      props.set(key, list);
    }
    const pick = (k: string) => props.get(k)?.[0];
    const uid = pick('UID') ?? '';
    if (!uid) continue;
    events.push({
      uid,
      summary: pick('SUMMARY') ?? '',
      description: pick('DESCRIPTION'),
      dtStart: parseICalDate(pick('DTSTART')) ?? '',
      dtEnd: parseICalDate(pick('DTEND')) ?? '',
      status:
        (pick('STATUS') ?? '').toLowerCase() === 'cancelled'
          ? 'cancelled'
          : 'confirmed',
      reservationId: pick('X-RESERVATION-ID'),
    });
  }
  return events;
}

/** "20260816T150000Z" (o flotante) → ISO UTC. Devuelve undefined si no parsea. */
function parseICalDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(raw);
  if (!m) return undefined;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || 'Z'}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Date → "20260816T150000Z". */
function toICalDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}

/** ISO (con offset o Z) → "20260816T150000Z". */
function toICalUtc(iso: string): string {
  return toICalDate(new Date(iso));
}

/**
 * Fecha/hora local "YYYY-MM-DDTHH:mm:ss" en `timeZone` → Date UTC.
 * La sincronización genera eventos con hora local sin offset (ver dates.ts),
 * así que aquí se convierte usando la zona IANA del restaurante.
 */
function utcFromLocal(dateTime: string, timeZone: string): Date {
  const asUtc = new Date(`${dateTime}Z`);
  if (Number.isNaN(asUtc.getTime())) return asUtc;
  if (!timeZone) return asUtc;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(asUtc);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const clock = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second),
  );
  // T = 2·asUtc − clock (desplaza el instante proxy por el offset de la zona).
  return new Date(asUtc.getTime() - (clock - asUtc.getTime()));
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

// ---------- Multistatus (DAV) ----------

/** Parsea la respuesta XML de un REPORT calendar-query (regex, sin XML parser). */
function parseMultistatus(xml: string): MultistatusResponse[] {
  const responses: MultistatusResponse[] = [];
  const responseRe = /<(?:\w+:)?response\b[\s\S]*?<\/(?:\w+:)?response>/g;
  let match: RegExpExecArray | null;
  while ((match = responseRe.exec(xml)) !== null) {
    const block = match[0];
    const href = /<(?:\w+:)?href>([\s\S]*?)<\/(?:\w+:)?href>/.exec(block)?.[1];
    const data = /<(?:\w+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:\w+:)?calendar-data>/.exec(
      block,
    )?.[1];
    if (!href) continue;
    responses.push({
      href: decodeXmlEntities(href),
      ical: data ? decodeXmlEntities(data) : undefined,
    });
  }
  return responses;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Combina un href relativo con la URL base del calendario. */
function resolveHref(baseUrl: string, href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}
