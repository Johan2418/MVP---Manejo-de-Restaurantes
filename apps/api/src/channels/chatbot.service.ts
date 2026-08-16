import { Injectable, Logger } from '@nestjs/common';
import { Channel, Conversation, Guest, Prisma, Restaurant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';

/**
 * Chatbot por mensaje (Fase 5 — agente de chat WhatsApp/SMS).
 *
 * Bot conversacional en español, sin IA: saludos, horarios de apertura y un
 * flujo guiado para crear una reserva (comensales → fecha → hora → nombre),
 * con el estado persistido en `Conversation.metadata` (sobrevive reinicios).
 *
 * El flujo es determinista y barato; deja la puerta abierta a sustituirlo por
 * un LLM detrás de la misma interfaz (`handle`).
 */

interface BookingDraft {
  partySize?: number;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  name?: string;
}

interface ChatbotState {
  flow?: 'booking';
  step?: 'party' | 'date' | 'time' | 'name';
  draft?: BookingDraft;
}

const MENU =
  'Puedo ayudarte con:\n' +
  '• "Horario" — horarios de apertura\n' +
  '• "Reservar" — crear una reserva (te guío paso a paso)\n' +
  '• "Confirmar" / "Cancelar" — confirma o cancela tu próxima reserva\n' +
  '• Escribe "Menú" para ver estas opciones de nuevo.';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: ReservationsService,
  ) {}

  /**
   * Procesa un mensaje entrante y devuelve el texto de respuesta (o null si
   * el bot no tiene nada que decir). El emisor (ChannelsService) envía la
   * respuesta por el mismo canal y la persiste en la conversación.
   */
  async handle(params: {
    restaurant: Restaurant;
    guest: Guest;
    conversation: Conversation;
    channel: Channel;
    body: string;
  }): Promise<string | null> {
    const { restaurant, guest, conversation, channel, body } = params;
    if (channel === Channel.PHONE) return null;
    if (!body.trim() || body.startsWith('(mensaje sin texto')) return null;

    const state = (conversation.metadata as ChatbotState | null) ?? {};

    // ---- Flujo de reserva en curso ----
    if (state.flow === 'booking') {
      return this.continueBooking(params, state);
    }

    const text = normalize(body);

    // Saludos
    if (/(^|\s)(hola|holi|buenas|buenos dias|buenas tardes|buenas noches|hey|hi|hello)(\s|$|!)/.test(text)) {
      return `¡Hola! Bienvenido a ${restaurant.name}. ${MENU}`;
    }

    // Horarios
    if (/\b(horario|horarios|abierto|abren|abre|cierra|cierran)\b/.test(text)) {
      return this.openingHoursText(restaurant.id);
    }

    // Reserva
    if (/\b(reservar|reserva|mesa|reservacion|reservación|reservas)\b/.test(text) && !/\b(cancelar|cancelo)\b/.test(text)) {
      return this.startBooking(conversation);
    }

    // Ayuda / menú
    if (/\b(menu|ayuda|opciones|que puedes hacer|qué puedes hacer)\b/.test(text)) {
      return MENU;
    }

    // Cualquier otra cosa: menú con sugerencia.
    return MENU;
  }

  // ---------- Flujo de reserva ----------

  private async startBooking(conversation: Conversation): Promise<string> {
    await this.saveState(conversation.id, {
      flow: 'booking',
      step: 'party',
      draft: {},
    });
    return 'Claro, vamos a crear tu reserva. ¿Para cuántas personas?';
  }

  private async continueBooking(
    params: {
      restaurant: Restaurant;
      guest: Guest;
      conversation: Conversation;
      channel: Channel;
      body: string;
    },
    state: ChatbotState,
  ): Promise<string> {
    const { restaurant, guest, conversation, channel, body } = params;
    const draft: BookingDraft = state.draft ?? {};
    const step = state.step ?? 'party';

    if (step === 'party') {
      const partySize = parsePartySize(body);
      if (!partySize) {
        return '¿Para cuántas personas? (responde solo el número, ej. "4")';
      }
      draft.partySize = partySize;
      await this.saveState(conversation.id, {
        flow: 'booking',
        step: 'date',
        draft,
      });
      return `Perfecto, ${partySize} personas. ¿Para qué día? (ej. "20/08", "mañana" o "hoy")`;
    }

    if (step === 'date') {
      const date = parseDate(body);
      if (!date) {
        return 'No entendí la fecha. Escríbela como "20/08", "hoy" o "mañana".';
      }
      draft.date = date;
      await this.saveState(conversation.id, {
        flow: 'booking',
        step: 'time',
        draft,
      });
      return '¿A qué hora? (ej. "19:30")';
    }

    if (step === 'time') {
      const time = parseTime(body);
      if (!time) {
        return 'No entendí la hora. Escríbela como "19:30".';
      }
      draft.time = time;
      // Nombre: si el comensal ya tiene nombre real, se omite el paso.
      const hasRealName = guest.name && guest.name !== guest.phone;
      if (hasRealName) {
        draft.name = guest.name;
        return this.finishBooking(params, draft, conversation);
      }
      await this.saveState(conversation.id, {
        flow: 'booking',
        step: 'name',
        draft,
      });
      return '¿A nombre de quién hago la reserva?';
    }

    // step === 'name'
    draft.name = body.trim().slice(0, 120);
    return this.finishBooking(params, draft, conversation);
  }

  /** Crea la reserva (REQUESTED) y limpia el estado del flujo. */
  private async finishBooking(
    params: {
      restaurant: Restaurant;
      guest: Guest;
      channel: Channel;
    },
    draft: BookingDraft,
    conversation: Conversation,
  ): Promise<string> {
    const { restaurant, guest, channel } = params;
    if (!draft.partySize || !draft.date || !draft.time) {
      await this.clearState(conversation.id);
      return MENU;
    }

    const [y, m, d] = draft.date.split('-').map(Number);
    const [hh, mm] = draft.time.split(':').map(Number);
    const startsAt = new Date(y, m - 1, d, hh, mm).toISOString();

    try {
      await this.reservations.create(restaurant.tenantId, restaurant.id, {
        guestName: draft.name ?? guest.name,
        guestPhone: guest.phone,
        startsAt,
        partySize: draft.partySize,
        channel: channel === Channel.WHATSAPP ? Channel.WHATSAPP : Channel.SMS,
        status: 'REQUESTED',
        customerNotes: 'Creada por chatbot (WhatsApp/SMS)',
      });
    } catch (err) {
      await this.clearState(conversation.id);
      this.logger.warn(
        `Chatbot: reserva no creada: ${(err as Error).message}`,
      );
      return 'No pude crear la reserva con esos datos. Revisa la fecha/hora (no debe estar en el pasado) y vuelve a intentarlo con "Reservar".';
    }

    await this.clearState(conversation.id);
    const when = new Date(startsAt).toLocaleString('es-EC', {
      timeZone: restaurant.timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
    return (
      `¡Listo! Tu reserva para ${draft.partySize} personas quedó solicitada ` +
      `el ${when} en ${restaurant.name}. Te confirmaremos por este mismo canal. ` +
      'Responde "1" para confirmar cuando te avisemos.'
    );
  }

  // ---------- Estado persistido ----------

  private async saveState(conversationId: string, state: ChatbotState) {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { metadata: state as unknown as object },
    });
  }

  private async clearState(conversationId: string) {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { metadata: Prisma.JsonNull },
    });
  }

  // ---------- Horarios ----------

  private async openingHoursText(restaurantId: string): Promise<string> {
    const hours = await this.prisma.openingHour.findMany({
      where: { restaurantId, enabled: true },
      orderBy: [{ dayOfWeek: 'asc' }, { openTime: 'asc' }],
    });
    if (hours.length === 0) return 'Lo sentimos, no tenemos horarios publicados todavía.';

    const byDay = new Map<number, string[]>();
    for (const h of hours) {
      const list = byDay.get(h.dayOfWeek) ?? [];
      list.push(`${h.openTime} a ${h.closeTime}`);
      byDay.set(h.dayOfWeek, list);
    }
    const lines = [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, ranges]) => `${DAY_NAMES[day]}: ${ranges.join(', ')}`);
    return `Horarios de apertura:\n${lines.join('\n')}`;
  }
}

const DAY_NAMES = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];

// ---------- Helpers ----------

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function parsePartySize(body: string): number | null {
  const n = Number(body.replace(/[^\d]/g, '').trim());
  if (Number.isInteger(n) && n >= 1 && n <= 50) return n;
  return null;
}

/** "hoy", "mañana", "20/08", "20/08/2026", "20-08" → YYYY-MM-DD. */
function parseDate(body: string): string | null {
  const text = normalize(body).trim();
  if (/\b(hoy|hoy mismo)\b/.test(text)) return toKey(new Date());
  if (/\b(manana|mañana)\b/.test(text)) {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return toKey(t);
  }
  const match = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "19:30", "19", "7:30pm", "7 pm" → HH:MM. */
function parseTime(body: string): string | null {
  const text = normalize(body).trim();
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/.exec(text);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  if (meridiem) {
    if (hour > 12 || hour < 1) return null;
    if (meridiem.startsWith('p') && hour !== 12) hour += 12;
    if (meridiem.startsWith('a') && hour === 12) hour = 0;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function toKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
