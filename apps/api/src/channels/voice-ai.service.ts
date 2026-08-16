import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Restaurant } from '@prisma/client';
import type { Server } from 'node:http';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { PrismaService } from '../prisma/prisma.service';
import { esc, say, twiml } from './twiml';

/**
 * Agente de voz con IA (Fase 5 — Twilio Media Streams + OpenAI Realtime).
 *
 * Twilio conecta el audio de la llamada a un WebSocket propio
 * (`/api/channels/twilio/voice/ai-stream`); este servicio hace de puente
 * bidireccional con la Realtime API de OpenAI (g711_ulaw a 8 kHz, igual que
 * Media Streams):
 *
 *   Llamador ⇄ Twilio ⇄ (WS) este servicio ⇄ (WS) OpenAI Realtime
 *
 * El prompt del conserje se construye en el webhook de llamada (nombre del
 * restaurante + horarios reales) y se entrega como parámetro del stream.
 *
 * Sin `OPENAI_API_KEY`, `isConfigured` es false y el IVR clásico sigue activo.
 */
@Injectable()
export class VoiceAiService {
  private readonly logger = new Logger(VoiceAiService.name);
  private wss: WebSocketServer | null = null;
  /** Conexiones activas: socket de Twilio → puente con OpenAI. */
  private readonly bridges = new Map<WebSocket, Bridge>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.config.get<string>('OPENAI_API_KEY'));
  }

  /** Conecta el servidor WebSocket al HTTP server de la app (llamar en bootstrap). */
  attach(server: Server) {
    this.wss = new WebSocketServer({
      server,
      path: '/api/channels/twilio/voice/ai-stream',
    });
    this.wss.on('connection', (socket) => {
      socket.on('message', (data) => this.handleTwilioMessage(socket, data));
      socket.on('close', () => {
        this.bridges.get(socket)?.openai?.close();
        this.bridges.delete(socket);
        this.logger.debug('Stream de Twilio cerrado');
      });
      socket.on('error', (err) =>
        this.logger.warn(`Stream error: ${(err as Error).message}`),
      );
    });
  }

  /**
   * TwiML de llamada entrante con IA: <Connect><Stream> + despedida si el
   * stream no se pudo establecer. El prompt se enriquece con los horarios
   * reales del restaurante.
   */
  async streamTwiML(opts: {
    restaurant: Restaurant;
    callSid: string;
    baseUrl: string;
  }): Promise<string> {
    const { restaurant, callSid, baseUrl } = opts;
    const hours = await this.prisma.openingHour.findMany({
      where: { restaurantId: restaurant.id, enabled: true },
      orderBy: [{ dayOfWeek: 'asc' }, { openTime: 'asc' }],
    });
    const hoursText =
      hours.length > 0
        ? hours
            .map(
              (h) =>
                `${DAY_NAMES[h.dayOfWeek]}: ${h.openTime} a ${h.closeTime}`,
            )
            .join('; ')
        : 'no publicados todavía';

    const instructions =
      `Eres el conserje telefónico de ${restaurant.name}. Hablas español, de forma breve y natural. ` +
      `Horarios de apertura: ${hoursText}. ` +
      'Ayudas a los clientes a hacer reservas: pregunta día, hora y número de personas, y confirma los datos ' +
      'al final diciendo que la reserva quedará confirmada por WhatsApp. Si te preguntan por algo que no sabes, ' +
      'deriva a hablar con recepción o indica que recibirán un mensaje. Saluda al inicio de la llamada.';

    const wsUrl = this.wsUrl(baseUrl);
    return twiml(`
      <Connect>
        <Stream url="${esc(wsUrl)}">
          <Parameter name="callSid" value="${esc(callSid)}" />
          <Parameter name="restaurantId" value="${esc(restaurant.id)}" />
          <Parameter name="instructions" value="${esc(instructions)}" />
        </Stream>
      </Connect>
      ${say('Lo sentimos, el servicio no está disponible en este momento. Hasta luego.')}
    `);
  }

  private wsUrl(baseUrl: string): string {
    const wsBase = baseUrl.replace(/^http/, 'ws');
    return `${wsBase.replace(/\/$/, '')}/api/channels/twilio/voice/ai-stream`;
  }

  // ---------- Puente Twilio ⇄ OpenAI ----------

  private handleTwilioMessage(socket: WebSocket, data: RawData) {
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (msg.event) {
      case 'connected':
        return;
      case 'start': {
        const start = msg.start ?? {};
        const params = (start.customParameters ?? {}) as Record<string, string>;
        this.openBridge(socket, params, start.streamSid as string);
        return;
      }
      case 'media': {
        const media = msg.media;
        const payload = (media?.payload as string) ?? '';
        const bridge = this.bridges.get(socket);
        if (bridge?.openai && bridge.openai.readyState === WebSocket.OPEN && payload) {
          bridge.openai.send(
            JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: payload,
            }),
          );
        }
        return;
      }
      case 'stop': {
        const bridge = this.bridges.get(socket);
        bridge?.openai?.close();
        return;
      }
      default:
        return;
    }
  }

  /** Abre la conexión con OpenAI Realtime y encola los eventos del audio. */
  private openBridge(socket: WebSocket, params: Record<string, string>, streamSid: string) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      socket.close();
      return;
    }
    const instructions = params.instructions ?? '';
    const bridge: Bridge = { socket, streamSid, openai: null };
    this.bridges.set(socket, bridge);

    let openai: WebSocket;
    try {
      openai = new WebSocket(REALTIME_URL, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });
    } catch (err) {
      this.logger.error(`No se pudo abrir OpenAI Realtime: ${(err as Error).message}`);
      this.bridges.delete(socket);
      return;
    }
    bridge.openai = openai;

    openai.on('open', () => {
      this.logger.log(`Realtime conectado para ${params.callSid ?? streamSid}`);
      openai.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['audio', 'text'],
            instructions,
            voice: 'alloy',
            input_audio_format: 'g711_ulaw',
            output_audio_format: 'g711_ulaw',
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: { type: 'server_vad' },
          },
        }),
      );
      // Saludo inicial del agente.
      openai.send(JSON.stringify({ type: 'response.create', response: {} }));
    });

    openai.on('message', (data) => this.handleOpenAiMessage(bridge, data.toString()));
    openai.on('error', (err) =>
      this.logger.warn(`Realtime error: ${(err as Error).message}`),
    );
    openai.on('close', () => {
      this.bridges.delete(socket);
      // Si OpenAI cierra, terminamos el stream para que Twilio siga el TwiML.
      if (socket.readyState === WebSocket.OPEN) socket.close();
    });
  }

  private handleOpenAiMessage(bridge: Bridge, raw: string) {
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'response.audio.delta': {
        const payload = msg.delta as string | undefined;
        if (payload && bridge.socket.readyState === WebSocket.OPEN) {
          bridge.socket.send(
            JSON.stringify({
              event: 'media',
              streamSid: bridge.streamSid,
              media: { payload, track: 'outbound' },
            }),
          );
        }
        return;
      }
      case 'error':
        this.logger.warn(`Realtime API: ${msg.error?.message ?? 'error'}`);
        return;
      default:
        return;
    }
  }
}

interface Bridge {
  socket: WebSocket;
  streamSid: string;
  openai: WebSocket | null;
}

const REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview';

const DAY_NAMES = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];
