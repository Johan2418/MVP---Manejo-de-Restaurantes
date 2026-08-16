import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';

/**
 * Cliente Twilio (Fase 2 — Canales).
 *
 * Solo se activa cuando existen TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN en el
 * entorno. Sin credenciales, los webhooks entrantes siguen funcionando (se
 * registran conversaciones/mensajes), pero el envío saliente responde 503 con
 * un mensaje claro.
 */
@Injectable()
export class TwilioService {
  private readonly client: twilio.Twilio | null = null;

  constructor(config: ConfigService) {
    const accountSid = config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = config.get<string>('TWILIO_AUTH_TOKEN');
    if (accountSid && authToken) {
      this.client = twilio(accountSid, authToken);
    }
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Envía un mensaje saliente. `from`/`to` deben llevar el prefijo del canal
   * cuando corresponda (ej. `whatsapp:+593...`).
   * Devuelve el MessageSid de Twilio.
   */
  async sendMessage(opts: {
    from: string;
    to: string;
    body: string;
  }): Promise<string> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Twilio no está configurado: añade TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN en las API Keys.',
      );
    }
    const message = await this.client.messages.create({
      from: opts.from,
      to: opts.to,
      body: opts.body,
    });
    return message.sid;
  }

  /**
   * Inicia una llamada saliente con TwiML inline (Fase 3 — recordatorios por
   * voz). El TwiML incluye el <Gather> que apunta a nuestro webhook de menú.
   * Devuelve el CallSid de Twilio.
   */
  async makeCall(opts: {
    from: string;
    to: string;
    twiml: string;
    statusCallback?: string;
  }): Promise<string> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Twilio no está configurado: añade TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN en las API Keys.',
      );
    }
    const call = await this.client.calls.create({
      from: opts.from,
      to: opts.to,
      twiml: opts.twiml,
      ...(opts.statusCallback
        ? {
            statusCallback: opts.statusCallback,
            statusCallbackEvent: [
              'initiated',
              'ringing',
              'answered',
              'completed',
              'busy',
              'failed',
              'no-answer',
              'canceled',
            ],
          }
        : {}),
    });
    return call.sid;
  }
}
