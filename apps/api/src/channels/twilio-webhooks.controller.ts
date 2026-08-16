import {
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import type { Conversation, Restaurant } from '@prisma/client';
import type { Request } from 'express';
import { esc, say, twiml } from './twiml';
import { ChannelsService } from './channels.service';
import { VoiceAiService } from './voice-ai.service';

/**
 * Webhooks públicos que Twilio invoca (SMS, WhatsApp y voz).
 * Configurar en la consola de Twilio:
 *   - Messaging → número → "A message comes in": POST {base}/api/channels/twilio/messages
 *   - Phone Numbers → número → "A call comes in":     POST {base}/api/channels/twilio/voice
 */
@Controller('channels/twilio')
export class TwilioWebhooksController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly voiceAi: VoiceAiService,
  ) {}

  /** Webhook de mensajería (SMS y WhatsApp). Twilio espera un 2xx. */
  @Post('messages')
  @HttpCode(200)
  async messages(@Body() body: Record<string, any>) {
    const result = await this.channels.handleInboundMessage({
      from: body.From ?? '',
      to: body.To ?? '',
      body: body.Body,
      numMedia: body.NumMedia,
      mediaUrl: body.MediaUrl0,
      messageSid: body.MessageSid,
    });
    if (!result) {
      return { ok: false, reason: 'unknown_restaurant_number' };
    }
    return { ok: true, conversationId: (result.conversation as Conversation).id };
  }

  /**
   * Llamada entrante: agente de voz con IA (OpenAI Realtime vía Media Streams)
   * si está configurado; si no, saludo + menú IVR clásico (Gather por tonos).
   */
  @Post('voice')
  @Header('Content-Type', 'text/xml')
  async voice(@Req() req: Request, @Body() body: Record<string, any>) {
    const result = await this.channels.handleInboundCall({
      callSid: body.CallSid ?? '',
      from: body.From ?? '',
      to: body.To ?? '',
    });
    if (!result) {
      return twiml(say('Lo sentimos, este número no está asociado a un restaurante.'));
    }
    const base = `${req.protocol}://${req.get('host')}`;
    const restaurant = result.restaurant as Restaurant;

    // Fase 5 — agente de voz con IA (requiere OPENAI_API_KEY en las API Keys).
    if (this.voiceAi.isConfigured) {
      return this.voiceAi.streamTwiML({
        restaurant,
        callSid: body.CallSid ?? '',
        baseUrl: base,
      });
    }

    return twiml(`
      ${say(
        `Gracias por llamar a ${restaurant.name}. Presione 1 para hacer una reserva. Presione 2 para confirmar o cancelar una reserva. Presione 3 para hablar con recepción.`,
      )}
      <Gather numDigits="1" action="${esc(base)}/api/channels/twilio/voice/menu" method="POST" timeout="8" />
      ${say('No recibimos ninguna opción. Hasta luego.')}
    `);
  }

  /**
   * Dígitos del <Gather> de una llamada de recordatorio saliente (Fase 3):
   * persiste la respuesta y confirma/cancela la reserva automáticamente.
   */
  @Post('voice/reminder/menu')
  @Header('Content-Type', 'text/xml')
  async voiceReminderMenu(@Body() body: Record<string, any>) {
    const result = await this.channels.handleReminderMenu({
      callSid: body.CallSid ?? '',
      from: body.From ?? '',
      to: body.To ?? '',
      digits: body.Digits,
    });
    if (!result) {
      return twiml(say('Lo sentimos, este número no está asociado a un restaurante.'));
    }
    const reply = result.replyText
      ? say(result.replyText)
      : body.Digits
        ? say('No encontramos ninguna reserva pendiente. Hasta luego.')
        : say('No recibimos ninguna opción. Gracias por su atención. Hasta luego.');
    return twiml(`${reply}${say('Gracias por su atención. Hasta luego.')}`);
  }

  /**
   * Status callback de llamadas salientes: refleja si la llamada de
   * recordatorio se completó o falló en la conversación (trazabilidad).
   */
  @Post('voice/reminder/status')
  @HttpCode(200)
  async voiceReminderStatus(@Body() body: Record<string, any>) {
    await this.channels.handleCallStatus({
      callSid: body.CallSid,
      status: body.CallStatus,
    });
    return { ok: true };
  }

  /** Resultado del menú IVR: persiste la selección y responde según la opción. */
  @Post('voice/menu')
  @Header('Content-Type', 'text/xml')
  async voiceMenu(@Body() body: Record<string, any>) {
    const result = await this.channels.recordVoiceMenu({
      callSid: body.CallSid ?? '',
      from: body.From ?? '',
      to: body.To ?? '',
      digits: body.Digits,
    });
    if (!result) {
      return twiml(say('Lo sentimos, este número no está asociado a un restaurante.'));
    }
    const restaurant = result.restaurant as Restaurant;
    switch (body.Digits) {
      case '1':
        return twiml(
          say(
            'Su solicitud de reserva quedó registrada. Le contactaremos por WhatsApp para confirmar los detalles. Hasta luego.',
          ),
        );
      case '2':
        return twiml(
          say(
            'Para confirmar o cancelar su reserva, escríbanos por WhatsApp. Hasta luego.',
          ),
        );
      case '3':
        if (restaurant.phone) {
          return twiml(
            `${say('Un momento, le transferimos con recepción.')}<Dial>${esc(
              restaurant.phone,
            )}</Dial>`,
          );
        }
        return twiml(say('La recepción no está disponible en este momento. Hasta luego.'));
      default:
        return twiml(say('No entendimos su opción. Hasta luego.'));
    }
  }
}
