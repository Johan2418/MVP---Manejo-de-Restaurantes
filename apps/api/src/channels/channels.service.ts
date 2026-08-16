import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Channel,
  Conversation,
  Guest,
  Message,
  Restaurant,
  ReservationStatus,
} from '@prisma/client';
import {
  DOMAIN_EVENTS,
  TenantId,
} from '@reservas/shared';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';
import { ChatbotService } from './chatbot.service';
import { reminderCallTwiML } from './twiml';
import { TwilioService } from './twilio.service';

/** Quita el prefijo de canal de un número (ej. "whatsapp:+593..." → "+593..."). */
export function stripChannelPrefix(raw: string): string {
  return raw.replace(/^(whatsapp|sms|voice|messenger):/, '');
}

/** Canal a partir del número tal como lo envía Twilio. */
export function channelFromAddress(raw: string): Channel {
  return /^whatsapp:/.test(raw) ? Channel.WHATSAPP : Channel.SMS;
}

/** Prefijo de canal para envíos salientes. */
export function addressWithPrefix(channel: Channel, e164: string): string {
  return channel === Channel.WHATSAPP ? `whatsapp:${e164}` : e164;
}

/** Normaliza texto para comparar intenciones (minúsculas, sin tildes). */
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Intención de una respuesta del cliente (Fase 3):
 * "1" / confirmar / sí → confirmar; "2" / cancelar / no → cancelar.
 */
function parseReplyIntent(body: string): 'confirm' | 'cancel' | null {
  const tokens = new Set(
    normalizeText(body)
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  if (
    tokens.has('1') ||
    tokens.has('confirmo') ||
    tokens.has('confirmar') ||
    tokens.has('confirmada') ||
    tokens.has('si') ||
    tokens.has('acepto')
  ) {
    return 'confirm';
  }
  if (
    tokens.has('2') ||
    tokens.has('cancelo') ||
    tokens.has('cancelar') ||
    tokens.has('cancelada') ||
    tokens.has('no')
  ) {
    return 'cancel';
  }
  return null;
}

export interface InboundMessagePayload {
  /** Número del cliente tal como lo envía Twilio (con o sin prefijo). */
  from: string;
  /** Número del restaurante (Twilio) tal como lo envía Twilio. */
  to: string;
  body?: string;
  /** Número de medios adjuntos. */
  numMedia?: string | number;
  /** Primera URL de medio (si aplica). */
  mediaUrl?: string;
  /** Twilio MessageSid. */
  messageSid?: string;
}

export interface InboundCallPayload {
  callSid: string;
  from: string;
  to: string;
}

/**
 * Núcleo de la Fase 2/3: traduce interacciones entrantes (SMS/WhatsApp/llamadas)
 * en conversaciones + mensajes persistidos, eventos de dominio e intenciones
 * automáticas (confirmar/cancelar reservas por mensaje).
 */
@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEvents: DomainEventsService,
    private readonly twilio: TwilioService,
    private readonly reservations: ReservationsService,
    private readonly config: ConfigService,
    private readonly chatbot: ChatbotService,
  ) {}

  // ---------- Resolución de restaurante por número Twilio ----------

  /** El número Twilio debe estar asignado a un restaurante (campo twilioPhoneNumber). */
  async resolveRestaurantByTwilioNumber(to: string): Promise<Restaurant | null> {
    const normalized = stripChannelPrefix(to);
    return this.prisma.restaurant.findUnique({
      where: { twilioPhoneNumber: normalized },
    });
  }

  // ---------- Mensajería entrante (SMS / WhatsApp) ----------

  /**
   * Webhook de mensajería de Twilio. Crea/actualiza comensal y conversación,
   * persiste el mensaje entrante, emite `guest.replied` y aplica la intención
   * automática (confirmar/cancelar) si el texto lo indica.
   * Idempotente: si el MessageSid ya se procesó (reintento de Twilio), devuelve
   * el resultado existente sin volver a procesar.
   */
  async handleInboundMessage(
    payload: InboundMessagePayload,
  ): Promise<{
    restaurant: Restaurant;
    conversation: Conversation;
    message: Message;
  } | null> {
    const restaurant = await this.resolveRestaurantByTwilioNumber(payload.to);
    if (!restaurant) return null;

    const from = stripChannelPrefix(payload.from);
    const channel = channelFromAddress(payload.from);

    // Idempotencia: Twilio reintenta webhooks con el mismo MessageSid.
    if (payload.messageSid) {
      const existing = await this.prisma.message.findUnique({
        where: { providerSid: payload.messageSid },
      });
      if (existing) {
        const conversation = await this.prisma.conversation.findUnique({
          where: { id: existing.conversationId },
        });
        if (!conversation) return null;
        return { restaurant, conversation, message: existing };
      }
    }

    const guest = await this.upsertGuest(restaurant.tenantId, from, channel);
    const conversation = await this.getOrCreateConversation({
      restaurant,
      guest,
      channel,
      channelAddress: stripChannelPrefix(payload.to),
      peerAddress: from,
    });

    const mediaUrl =
      Number(payload.numMedia ?? 0) > 0 ? payload.mediaUrl : undefined;
    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        body: payload.body?.trim() || '(mensaje sin texto / adjunto)',
        mediaUrl,
        providerSid: payload.messageSid,
      },
    });

    await this.touchConversation(conversation.id, 1);

    this.domainEvents.emit(DOMAIN_EVENTS.GUEST_REPLIED, restaurant.tenantId as TenantId, {
      conversationId: conversation.id,
      messageId: message.id,
      channel,
      body: message.body,
      from,
    });

    // Fase 3: confirmar/cancelar reservas por mensaje ("1" / "2").
    const intentReply = await this.processIntent(
      restaurant,
      guest,
      channel,
      message.body,
    ).catch((err) => {
      this.logger.warn(
        `Intención no aplicada (${message.body}): ${(err as Error).message}`,
      );
      return null;
    });

    // Fase 5: si no era confirmar/cancelar, el chatbot conversacional responde.
    if (!intentReply) {
      const botReply = await this.chatbot
        .handle({
          restaurant,
          guest,
          conversation,
          channel,
          body: message.body,
        })
        .catch((err) => {
          this.logger.warn(
            `Chatbot falló (${message.body}): ${(err as Error).message}`,
          );
          return null;
        });
      if (botReply) {
        try {
          await this.sendToGuest(restaurant.id, guest.id, channel, botReply);
        } catch (err) {
          this.logger.warn(
            `Respuesta del chatbot no enviada: ${(err as Error).message}`,
          );
        }
      }
    }

    return { restaurant, conversation, message };
  }

  // ---------- Voz (IVR) ----------

  /** Llamada entrante: registra la conversación y emite `call.received`. */
  async handleInboundCall(
    payload: InboundCallPayload,
  ): Promise<{ restaurant: Restaurant; conversation: Conversation } | null> {
    const restaurant = await this.resolveRestaurantByTwilioNumber(payload.to);
    if (!restaurant) return null;

    const from = stripChannelPrefix(payload.from);
    const guest = await this.upsertGuest(restaurant.tenantId, from, Channel.PHONE);
    const conversation = await this.getOrCreateConversation({
      restaurant,
      guest,
      channel: Channel.PHONE,
      channelAddress: stripChannelPrefix(payload.to),
      peerAddress: from,
    });

    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        body: `Llamada entrante (IVR) — ${payload.callSid}`,
        providerSid: payload.callSid,
      },
    });
    await this.touchConversation(conversation.id, 1);

    this.domainEvents.emit(DOMAIN_EVENTS.CALL_RECEIVED, restaurant.tenantId as TenantId, {
      conversationId: conversation.id,
      callSid: payload.callSid,
      from,
    });

    return { restaurant, conversation };
  }

  /**
   * Opción del menú IVR: persiste la selección como mensaje entrante y emite
   * `guest.replied`. El controlador decide el TwiML según `digits`.
   */
  async recordVoiceMenu(
    payload: InboundCallPayload & { digits?: string },
  ): Promise<{ restaurant: Restaurant; conversation: Conversation } | null> {
    const restaurant = await this.resolveRestaurantByTwilioNumber(payload.to);
    if (!restaurant) return null;

    const from = stripChannelPrefix(payload.from);
    const guest = await this.upsertGuest(restaurant.tenantId, from, Channel.PHONE);
    const conversation = await this.getOrCreateConversation({
      restaurant,
      guest,
      channel: Channel.PHONE,
      channelAddress: stripChannelPrefix(payload.to),
      peerAddress: from,
    });

    const option = this.menuOptionLabel(payload.digits);
    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        body: option,
        providerSid: payload.callSid,
      },
    });
    await this.touchConversation(conversation.id, 1);

    this.domainEvents.emit(DOMAIN_EVENTS.GUEST_REPLIED, restaurant.tenantId as TenantId, {
      conversationId: conversation.id,
      messageId: message.id,
      channel: Channel.PHONE,
      body: message.body,
      from,
    });
    this.domainEvents.emit(DOMAIN_EVENTS.CALL_ENDED, restaurant.tenantId as TenantId, {
      conversationId: conversation.id,
      callSid: payload.callSid,
    });

    return { restaurant, conversation };
  }

  private menuOptionLabel(digits?: string): string {
    switch (digits) {
      case '1':
        return 'IVR: solicitó hacer una reserva (opción 1)';
      case '2':
        return 'IVR: consultó confirmación/cancelación (opción 2)';
      case '3':
        return 'IVR: solicitó hablar con recepción (opción 3)';
      default:
        return 'IVR: sin opción válida / colgó';
    }
  }

  // ---------- Fase 3: intención automática por mensaje ----------

  /**
   * Aplica confirmación/cancelación a la próxima reserva activa del comensal.
   * Devuelve el texto de confirmación/cancelación (o null si no aplicó).
   * En mensajería (SMS/WhatsApp) el texto se envía solo; en voz (PHONE) el
   * llamador lo escucha por el TwiML del webhook de menú.
   */
  private async processIntent(
    restaurant: Restaurant,
    guest: Guest,
    channel: Channel,
    body: string,
  ): Promise<string | null> {
    const intent = parseReplyIntent(body);
    if (!intent) return null;

    const reservation = await this.findUpcomingReservation(restaurant.id, guest.id);
    if (!reservation) return null;

    let replyText: string | null = null;

    if (intent === 'cancel') {
      if (reservation.status === ReservationStatus.CANCELLED) return null;
      await this.reservations.transition(
        restaurant.tenantId,
        restaurant.id,
        reservation.id,
        { status: ReservationStatus.CANCELLED },
      );
      replyText = `Hemos cancelado su reserva en ${restaurant.name}. ¡Esperamos verle pronto!`;
    } else {
      if (reservation.status === ReservationStatus.CONFIRMED) {
        replyText =
          `¡Confirmado! Su reserva en ${restaurant.name} para ${this.formatSlot(
            reservation,
            restaurant,
          )} sigue vigente. ¡Le esperamos!`;
      } else if (reservation.status === ReservationStatus.REQUESTED) {
        await this.reservations.transition(
          restaurant.tenantId,
          restaurant.id,
          reservation.id,
          { status: ReservationStatus.CONFIRMED },
        );
        replyText =
          `¡Gracias! Su reserva en ${restaurant.name} para ${this.formatSlot(
            reservation,
            restaurant,
          )} quedó confirmada.`;
      } else {
        return null;
      }
    }

    if (channel === Channel.PHONE) return replyText;

    try {
      await this.sendToGuest(restaurant.id, guest.id, channel, replyText);
    } catch (err) {
      // El mensaje fallido ya quedó registrado en la conversación (panel).
      this.logger.warn(
        `Auto-respuesta no enviada: ${(err as Error).message}`,
      );
    }
    return replyText;
  }

  /** Próxima reserva activa (solicitada/confirmada) del comensal en 48 h. */
  private async findUpcomingReservation(restaurantId: string, guestId: string) {
    const now = new Date();
    const horizon = new Date(now.getTime() + 48 * 3_600_000);
    return this.prisma.reservation.findFirst({
      where: {
        restaurantId,
        guestId,
        status: {
          in: [ReservationStatus.REQUESTED, ReservationStatus.CONFIRMED],
        },
        startsAt: { gte: now, lte: horizon },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  private formatSlot(
    reservation: { startsAt: Date; partySize: number },
    restaurant: Restaurant,
  ): string {
    return new Date(reservation.startsAt).toLocaleString('es-EC', {
      timeZone: restaurant.timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // ---------- Panel de conversaciones (REST) ----------

  async listConversations(tenantId: string, restaurantId: string) {
    await this.assertRestaurantInTenant(tenantId, restaurantId);
    const conversations = await this.prisma.conversation.findMany({
      where: { restaurantId, tenantId },
      include: {
        guest: true,
        messages: { orderBy: { sentAt: 'desc' }, take: 1 },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
    return conversations.map((c) => ({
      id: c.id,
      channel: c.channel,
      guest: c.guest,
      status: c.status,
      unread: c.unread,
      lastMessageAt: c.lastMessageAt,
      lastMessage: c.messages[0] ?? null,
    }));
  }

  async listMessages(
    tenantId: string,
    restaurantId: string,
    conversationId: string,
  ) {
    const conversation = await this.getConversation(
      tenantId,
      restaurantId,
      conversationId,
    );
    return this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { sentAt: 'asc' },
    });
  }

  async markRead(
    tenantId: string,
    restaurantId: string,
    conversationId: string,
  ) {
    const conversation = await this.getConversation(
      tenantId,
      restaurantId,
      conversationId,
    );
    return this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { unread: 0 },
    });
  }

  /**
   * Respuesta saliente desde el panel. Envía vía Twilio y persiste el mensaje.
   * Si Twilio no está configurado, persiste el mensaje como FAILED y lanza 503.
   */
  async reply(
    tenantId: string,
    restaurantId: string,
    conversationId: string,
    body: string,
  ) {
    const conversation = await this.getConversation(
      tenantId,
      restaurantId,
      conversationId,
    );
    return this.sendOutbound(conversation, body);
  }

  /**
   * Envío saliente a un comensal (recordatorios, auto-respuestas).
   * Crea la conversación si aún no existe y registra el mensaje.
   */
  async sendToGuest(
    restaurantId: string,
    guestId: string,
    channel: Channel,
    body: string,
  ) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!restaurant?.twilioPhoneNumber) {
      throw new NotFoundException(
        `El restaurante ${restaurantId} no tiene twilioPhoneNumber asignado`,
      );
    }
    const guest = await this.prisma.guest.findUnique({
      where: { id: guestId },
    });
    if (!guest) {
      throw new NotFoundException(`Comensal ${guestId} no encontrado`);
    }
    const conversation = await this.getOrCreateConversation({
      restaurant,
      guest,
      channel,
      channelAddress: restaurant.twilioPhoneNumber,
      peerAddress: guest.phone,
    });
    return this.sendOutbound(conversation, body);
  }

  /** Envía por Twilio y persiste el mensaje OUTBOUND (FAILED si falla). */
  private async sendOutbound(conversation: Conversation, body: string) {
    const from = addressWithPrefix(conversation.channel, conversation.channelAddress);
    const to = addressWithPrefix(conversation.channel, conversation.peerAddress);

    let providerSid: string | undefined;
    let status: Message['status'] = 'SENT';
    try {
      providerSid = await this.twilio.sendMessage({ from, to, body });
    } catch (err) {
      status = 'FAILED';
      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          body,
          status,
        },
      });
      await this.touchConversation(conversation.id, 0);
      throw new ServiceUnavailableException(
        `No se pudo enviar el mensaje: ${(err as Error).message}`,
      );
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        body,
        status,
        providerSid,
      },
    });
    await this.touchConversation(conversation.id, 0);
    return message;
  }

  // ---------- Utilidades ----------

  private async upsertGuest(
    tenantId: string,
    phone: string,
    channel: Channel,
  ): Promise<Guest> {
    const existing = await this.prisma.guest.findUnique({
      where: { tenantId_phone: { tenantId, phone } },
    });
    if (existing) return existing;

    // Contacto entrante = el cliente inició la interacción ⇒ consentimiento
    // explícito para responder en el mismo hilo (LOPDP).
    return this.prisma.guest.create({
      data: {
        tenantId,
        phone,
        name: phone,
        consent: true,
        notes: `Contacto entrante por ${channel === Channel.PHONE ? 'teléfono' : 'mensaje'}. Actualizar nombre desde el panel.`,
      },
    });
  }

  private async getOrCreateConversation(opts: {
    restaurant: Restaurant;
    guest: Guest;
    channel: Channel;
    channelAddress: string;
    peerAddress: string;
  }) {
    const unique = {
      restaurantId_channel_channelAddress_peerAddress: {
        restaurantId: opts.restaurant.id,
        channel: opts.channel,
        channelAddress: opts.channelAddress,
        peerAddress: opts.peerAddress,
      },
    };
    const existing = await this.prisma.conversation.findUnique({
      where: unique,
    });
    if (existing) return existing;
    return this.prisma.conversation.create({
      data: {
        tenantId: opts.restaurant.tenantId,
        restaurantId: opts.restaurant.id,
        guestId: opts.guest.id,
        channel: opts.channel,
        channelAddress: opts.channelAddress,
        peerAddress: opts.peerAddress,
      },
    });
  }

  private async touchConversation(conversationId: string, unreadDelta: number) {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        ...(unreadDelta > 0
          ? { unread: { increment: unreadDelta } }
          : { unread: 0 }),
      },
    });
  }

  // ---------- Fase 3: recordatorios por llamada (voz) ----------

  /**
   * Inicia la llamada de recordatorio (IVR) al comensal.
   * Registra la conversación y un mensaje OUTBOUND con el CallSid como
   * `providerSid` (trazabilidad + idempotencia del status callback).
   * Devuelve el CallSid de Twilio.
   */
  async sendVoiceReminder(
    restaurant: Restaurant,
    guest: Guest,
    text: string,
  ): Promise<string> {
    if (!restaurant.twilioPhoneNumber) {
      throw new NotFoundException(
        `El restaurante ${restaurant.id} no tiene twilioPhoneNumber asignado`,
      );
    }

    const conversation = await this.getOrCreateConversation({
      restaurant,
      guest,
      channel: Channel.PHONE,
      channelAddress: restaurant.twilioPhoneNumber,
      peerAddress: guest.phone,
    });

    const menuUrl = `${this.webhookBaseUrl}/api/channels/twilio/voice/reminder/menu`;
    const callSid = await this.twilio.makeCall({
      from: restaurant.twilioPhoneNumber,
      to: guest.phone,
      twiml: reminderCallTwiML(text, menuUrl),
      statusCallback: `${this.webhookBaseUrl}/api/channels/twilio/voice/reminder/status`,
    });

    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        body: `Recordatorio por llamada (IVR) — CallSid ${callSid}`,
        providerSid: callSid,
        status: 'SENT',
      },
    });
    await this.touchConversation(conversation.id, 0);

    return callSid;
  }

  /**
   * Dígitos del <Gather> de la llamada de recordatorio: persiste la selección
   * como mensaje entrante, aplica confirmar/cancelar y devuelve el texto que
   * el TwiML debe pronunciar (o null si no aplica).
   */
  async handleReminderMenu(
    payload: InboundCallPayload & { digits?: string },
  ): Promise<{ restaurant: Restaurant; replyText: string | null } | null> {
    const restaurant = await this.resolveRestaurantByTwilioNumber(payload.to);
    if (!restaurant) return null;

    const from = stripChannelPrefix(payload.from);
    const guest = await this.upsertGuest(restaurant.tenantId, from, Channel.PHONE);
    const conversation = await this.getOrCreateConversation({
      restaurant,
      guest,
      channel: Channel.PHONE,
      channelAddress: stripChannelPrefix(payload.to),
      peerAddress: from,
    });

    const option = this.reminderMenuOptionLabel(payload.digits);
    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        body: option,
        providerSid: payload.callSid,
      },
    });
    await this.touchConversation(conversation.id, 1);

    this.domainEvents.emit(DOMAIN_EVENTS.GUEST_REPLIED, restaurant.tenantId as TenantId, {
      conversationId: conversation.id,
      messageId: message.id,
      channel: Channel.PHONE,
      body: message.body,
      from,
    });
    this.domainEvents.emit(DOMAIN_EVENTS.CALL_ENDED, restaurant.tenantId as TenantId, {
      conversationId: conversation.id,
      callSid: payload.callSid,
    });

    const replyText = await this.processIntent(
      restaurant,
      guest,
      Channel.PHONE,
      payload.digits ?? '',
    );
    return { restaurant, replyText };
  }

  /**
   * Status callback de Twilio para llamadas salientes: refleja el desenlace
   * de la llamada en el mensaje OUTBOUND registrado (DELIVERED si se completó,
   * FAILED si no hubo respuesta/falló). Idempotente por CallSid.
   */
  async handleCallStatus(payload: {
    callSid?: string;
    status?: string;
  }): Promise<void> {
    const { callSid, status } = payload;
    if (!callSid || !status) return;

    const failed = ['busy', 'failed', 'no-answer', 'canceled'].includes(status);
    const done = failed || status === 'completed';
    if (!done) return; // initiated/ringing/answered: aún en curso

    await this.prisma.message.updateMany({
      where: { providerSid: callSid, direction: 'OUTBOUND' },
      data: { status: failed ? 'FAILED' : 'DELIVERED' },
    });
  }

  private reminderMenuOptionLabel(digits?: string): string {
    switch (digits) {
      case '1':
        return 'Recordatorio por llamada: confirmó (opción 1)';
      case '2':
        return 'Recordatorio por llamada: canceló (opción 2)';
      default:
        return 'Recordatorio por llamada: sin respuesta';
    }
  }

  /** URL pública base para webhooks salientes (variable WEBHOOK_BASE_URL). */
  private get webhookBaseUrl(): string {
    return this.config.get<string>('WEBHOOK_BASE_URL', 'http://localhost:3001');
  }

  private async getConversation(
    tenantId: string,
    restaurantId: string,
    conversationId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, restaurantId, tenantId },
    });
    if (!conversation) {
      throw new NotFoundException(
        `Conversación ${conversationId} no encontrada en este restaurante`,
      );
    }
    return conversation;
  }

  private async assertRestaurantInTenant(tenantId: string, restaurantId: string) {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
    });
    if (!restaurant) {
      throw new NotFoundException(
        `Restaurante ${restaurantId} no encontrado en este tenant`,
      );
    }
    return restaurant;
  }
}
