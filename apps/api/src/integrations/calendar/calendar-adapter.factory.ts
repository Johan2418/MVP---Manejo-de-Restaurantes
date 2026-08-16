import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';
import {
  CalendarAdapter,
  CalendarProvider,
  CALENDAR_PROVIDERS,
} from './calendar.adapter';
import { CalDavCalendarAdapter } from './caldav.adapter';
import { GoogleCalendarAdapter } from './google-calendar.adapter';

/**
 * Resuelve el adaptador correcto según el proveedor de la integración
 * (Fase 4): Google Calendar y CalDAV comparten el contrato `CalendarAdapter`,
 * de modo que la sincronización no sabe con quién habla.
 */
@Injectable()
export class CalendarAdapterFactory {
  constructor(
    private readonly google: GoogleCalendarAdapter,
    private readonly caldav: CalDavCalendarAdapter,
  ) {}

  get(provider: IntegrationProvider | string): CalendarAdapter {
    if (provider === IntegrationProvider.GOOGLE_CALENDAR) return this.google;
    if (provider === IntegrationProvider.CALDAV) return this.caldav;
    throw new ServiceUnavailableException(
      `Proveedor de calendario no soportado: ${provider}`,
    );
  }

  isCalendarProvider(provider: IntegrationProvider | string): boolean {
    return (CALENDAR_PROVIDERS as readonly string[]).includes(provider);
  }

  /** El proveedor usa flujo OAuth (vs. credenciales directas). */
  usesOAuth(provider: IntegrationProvider | string): boolean {
    return (provider as CalendarProvider) === 'GOOGLE_CALENDAR';
  }
}
