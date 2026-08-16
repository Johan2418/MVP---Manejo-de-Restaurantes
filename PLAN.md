# Plan — Sistema de Automatización de Reservas para Restaurantes

> Documento vivo: definición del producto, stack tecnológico, arquitectura y roadmap.

## 1. Visión

Sistema integral que gestiona las reservas de un restaurante a través de múltiples canales
(llamadas telefónicas automatizadas, SMS/WhatsApp, formulario web), centraliza la agenda de
reservas, se integra con calendarios (Google Calendar, CalDAV/Outlook) y CRM, y reduce la
carga manual del personal. Arquitectura preparada desde el día 1 para incorporar agentes de
IA en el futuro (voz, chat, reasignación automática de mesas).

## 2. Stack tecnológico recomendado

| Capa | Tecnología | Justificación |
|---|---|---|
| Backend | NestJS (TypeScript) | Estructura modular (reservas, canales, automatizaciones, integraciones), DI, soporte nativo de WebSockets, integración BullMQ, manejo limpio de webhooks |
| Frontend | Next.js + React + Tailwind | Dashboard de agenda (día/semana), panel de conversaciones, configuración |
| Base de datos | PostgreSQL + Prisma ORM | Integridad relacional (mesas, franjas, reservas), JSONB para flexibilidad, Prisma acelera el desarrollo |
| Colas / jobs | Redis + BullMQ | Recordatorios, reintentos, flujos asíncronos de telefonía |
| Tiempo real | WebSockets (Socket.io) | Agenda en vivo en todos los dispositivos |
| Telefonía + mensajería | Twilio (Voz/IVR, SMS, WhatsApp Business API) | Un solo proveedor para los tres canales; soporta Media Streams (audio por WebSocket) para IA de voz futura |
| Calendario | Adaptador (Google Calendar API + CalDAV) | 2-way sync, proveedor intercambiable |
| CRM | Adaptador (HubSpot / Zoho / CRM propio) | Misma interfaz, integración opcional |
| Infraestructura | Docker Compose (Postgres, Redis, app) | Entorno de desarrollo reproducible; despliegue posterior a Fly.io/Railway/VPS |

### Alternativas consideradas
- **Python (FastAPI):** ecosistema de IA más maduro, pero el sistema es intensivo en I/O y
  tiempo real (webhooks, WebSockets, colas) donde Node sobresale; mantener un solo lenguaje
  reduce la fricción del equipo. La IA futura se cubre con LangChain.js o, si hace falta
  algo muy pesado, un microservicio Python aislado.
- **Vite + React SPA** en vez de Next.js: válido si se quiere máxima simplicidad; Next.js
  añade estructura y rutas útiles a futuro.

## 3. Arquitectura

**Monolito modular** (no microservicios): bounded contexts bien separados en un solo
deployable. Extraer servicios después es posible sin reescritura si los módulos respetan
sus límites.

```
┌────────────────────────────────────────────────────────────┐
│  Clientes                                              UI   │
│  (llamada, SMS/WhatsApp, web)       Dashboard Next.js       │
└───────────────┬──────────────────────────────┬──────────────┘
                │                              │
┌───────────────▼──────────────────────────────▼──────────────┐
│                    NESTJS (monolito modular)                 │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌───────────┐ │
│  │ Reservas   │ │ Canales    │ │ Automati-  │ │Integra-   │ │
│  │ (núcleo)   │ │ (voz/SMS/  │ │ zaciones   │ │ciones     │ │
│  │            │ │ WhatsApp)  │ │ (jobs)     │ │(Calendar/ │ │
│  └────────────┘ └────────────┘ └────────────┘ │ CRM)      │ │
│              Event Bus (dominio)              └───────────┘ │
└───────────────┬──────────────────────────────┬──────────────┘
                │                              │
      PostgreSQL + Prisma               Redis + BullMQ
                 (esquema Prisma)             (colas, cache, pub/sub)
```

### Principio clave: canales → eventos → (futuro) agentes IA

Todo canal (llamada, SMS, WhatsApp, web) emite **eventos de dominio** a un bus central:

- `reservation.requested`
- `reservation.confirmed` / `reservation.cancelled` / `reservation.rescheduled`
- `guest.replied` (con canal y contenido normalizado)
- `call.received` / `call.ended` (con transcripción/audio si aplica)
- `reservation.reminder.sent`
- `reservation.no_show`

Los agentes de IA del futuro serán **consumidores nuevos del bus** y productores de
acciones a través de los **mismos adaptadores de canal** (enviar SMS, hacer llamada, mover
una mesa). Esto convierte la incorporación de IA en un cambio incremental, no en un
rediseño.

La capa de voz se diseña desde el día 1 con **Twilio Media Streams** (audio en streaming
por WebSocket): es el punto exacto donde se enchufa un agente de voz con IA (p. ej. OpenAI
Realtime) más adelante.

## 4. Modelo de dominio inicial (Fase 1)

- **Restaurant:** datos del establecimiento, franjas de apertura, políticas de reserva
  (anticipación mínima, duración por defecto, tamaño máximo de grupo).
- **Table:** capacidad, zona, combinable.
- **TimeSlot / disponibilidad:** franjas generadas según apertura, duración y mesas libres.
- **Reservation:** estado (solicitada, confirmada, cancelada, reprogramada, no-show,
  completada), canal de origen, datos de contacto, notas, nº de comensales.
- **Guest:** perfil del cliente (teléfono, historial, preferencias, nº de visitas) —
  base para el CRM y para los agentes IA.
- **Channel / Conversation:** hilo de interacción por canal (registro de mensajes/llamadas).

## 5. Roadmap

| Fase | Alcance | Duración aprox. |
|---|---|---|
| **0 — Fundación** | Monorepo, NestJS + Next.js, Postgres + Prisma, Redis + BullMQ, Docker Compose, CI básico | 1–2 semanas |
| **1 — Núcleo de reservas** | Modelo de dominio, CRUD de reservas, agenda UI (día/semana ✅, drag & drop ✅), detección de conflictos de mesas, estados y transiciones | 2–4 semanas |
| **2 — Canales** | IVR de llamadas (recibir llamada → opciones → reserva), SMS/WhatsApp bidireccional, webhooks → eventos de dominio, panel de conversaciones | 4–6 semanas |
| **3 — Automatización** | Recordatorios programados (SMS/llamada N horas antes), confirmación por respuesta del cliente ("1 para confirmar"), cancelación/reprogramación por mensaje, gestión de no-shows, idempotencia y reintentos | 6–8 semanas |
| **4 — Integraciones** | Google Calendar 2-way sync ✅, CalDAV ✅, CRM propio ✅ (HubSpot/Zoho quedan opcionales) | 8–10 semanas |
| **5 — Futuro: IA y analítica** | Analítica ✅ (ocupación + canales), reasignación automática de mesas ✅, chatbot WhatsApp/SMS ✅, agente de voz (Media Streams + OpenAI Realtime) ✅ | más adelante |

**Estado actual: Fases 1–5 completadas (2026-08).**

- ✅ **Fase 0 — Fundación**: monorepo (NestJS + Next.js + `@reservas/shared`),
  Prisma/PostgreSQL + Redis/BullMQ en Docker Compose, health check en `/api/health`.
- ✅ **Fase 1 — Núcleo de reservas**: modelo de dominio multi-tenant
  (`Tenant` → `Restaurant` → `Table`/`OpeningHour`/`Guest`/`Reservation`), CRUD de
  reservas con detección de conflictos de mesa (409) y transiciones de estado,
  disponibilidad por franjas, agenda en la web con vista **día** (rejilla por
  mesa/franja) y **semana** (lunes–domingo) y **drag & drop** de reservas entre
  mesas/franjas (los conflictos se validan en el servidor).
- ✅ **Fase 2 — Canales**: webhooks Twilio para SMS/WhatsApp y voz (IVR con menú
  por tonos), modelo `Conversation`/`Message`, panel de conversaciones con
  respuesta saliente, eventos `guest.replied`/`call.received`/`call.ended`.
  *Pendiente: activar con credenciales reales de Twilio y webhooks de estado de
  entrega.*
- ✅ **Fase 3 — Automatización**: recordatorios programados (BullMQ,
  `reminderHoursBefore` por restaurante) por SMS/WhatsApp o llamada IVR
  (`reminderChannel` en el restaurante; las reservas por teléfono siempre se
  recuerdan por llamada), confirmación/cancelación por respuesta del cliente
  ("1"/"2" por SMS/WhatsApp y por teclas en la llamada), auto no-show /
  auto-cancelación al final del turno, idempotencia de webhooks (`providerSid`
  único) con reintentos y backoff exponencial, y outbox persistido de eventos.
  *Pendiente: activar con credenciales reales de Twilio y webhooks de estado de
  entrega de mensajería.*
- ✅ **Fase 4 — Integraciones**: modelo `Integration` por restaurante
  (credenciales en JSON privado, nunca expuestas), adaptadores Google Calendar
  (OAuth2 con refresh automático) y **CalDAV** (URL + usuario/contraseña, con
  REPORT calendar-query, PUT/DELETE e iCalendar RFC 5545) bajo la interfaz
  intercambiable `CalendarAdapter`; sync 2-way: reservas confirmadas → eventos
  (upsert por `reservationId` / `X-RESERVATION-ID`) y cambios externos → agenda
  (reprogramación/cancelación), limpieza de eventos huérfanos, sync por eventos
  (BullMQ `calendar-sync`) + cron cada 15 min (Job Scheduler); **CRM propio**:
  perfil de comensal en `Guest` (preferencias, notas, visitas, consentimiento
  LOPDP) con listado del restaurante y perfil con historial en el panel, bajo
  el contrato `CrmAdapter` (HubSpot/Zoho se enchufan después).
  *HubSpot/Zoho quedan como integración opcional futura.*
- ✅ **Fase 5 — IA y analítica**: analítica en `.../analitica` — previsión de
  ocupación (comensales vs. capacidad por día, próximos 14 días), informe de
  canales (reservas por canal con desglose por estado y conversaciones,
  últimos 30 días) y tasas de confirmación, cancelación y no-show
  (`GET .../analytics/overview?days=14`). **Reasignación automática de mesas**:
  al confirmar una reserva sin mesa se le asigna la mesa más pequeña libre que
  quepa al grupo; al cancelar/completar/no-show se libera la mesa y se barre el
  restaurante recolocando reservas activas sin mesa (greedy por hora de inicio;
  botón "Auto-asignar" y `POST .../reservations/auto-assign`). **Chatbot
  WhatsApp/SMS**: bot conversacional en español (saludos, horarios, flujo de
  reserva guiado: comensales → fecha → hora → nombre) con estado persistido en
  `Conversation.metadata`, integrado al webhook de mensajería y con el
  confirmar/cancelar automático ya existente. **Agente de voz con IA**: puente
  Twilio Media Streams ⇄ OpenAI Realtime (WebSocket en
  `/api/channels/twilio/voice/ai-stream`, g711_ulaw 8 kHz, prompt del conserje
  con los horarios reales del restaurante); sin `OPENAI_API_KEY` cae al IVR
  clásico. *Para activar en producción: `OPENAI_API_KEY` (y las credenciales
  Twilio ya existentes).*

## 6. Consideraciones operativas

- **Costos de Twilio:** minutos de llamada y SMS tienen costo; definir presupuesto y umbrales
  (p. ej. límite de recordatorios por reserva). WhatsApp Business API requiere cuenta
  empresarial en Meta.
- **Twilio en Ecuador:** Twilio ofrece números locales y cobertura de voz en Ecuador (con
  guías de cumplimiento propias). En SMS, los sender IDs numéricos se sobrescriben con
  short/long codes, por lo que la vía confiable para mensajes es WhatsApp Business API o
  long codes.
- **Privacidad (Ecuador):** aplica la Ley Orgánica de Protección de Datos Personales (LOPDP,
  vigente desde 2023). Los datos de clientes (teléfonos, transcripciones de llamadas)
  requieren política de retención y consentimiento explícito; registrar el consentimiento
  en el modelo de Guest.
- **Fiabilidad:** los webhooks de Twilio reintentan; el sistema debe ser idempotente (clave
  de idempotencia por evento) y persistir eventos con patrón *outbox* para no perder
  reservas.
- **Multi-tenant:** si a futuro se vende el sistema a varios restaurantes, incluir `tenantId`
  desde el día 1 en el esquema.

## 7. Decisiones tomadas

- [x] **SaaS multi-tenant** — todo modelo de negocio lleva `tenantId`; el esquema Prisma ya
  incluye `Tenant` y `Restaurant`.
- [x] **País objetivo: Ecuador** — Twilio con cobertura de voz; SMS vía WhatsApp Business /
  long codes; privacidad según LOPDP.
- [x] **Identificadores de código en inglés**, UI en español.

## 8. Decisiones pendientes

- [x] **CRM propio integrado en Guest** — resuelto en Fase 4; HubSpot/Zoho
  quedan como integración opcional detrás del contrato `CrmAdapter`.
- [ ] ¿Pagos en línea para garantizar reservas (depósito/adelanto) en el alcance base?
  (Decisión de producto: implementar con Stripe/PayPal + gravity cuando se defina.)
- [ ] ¿Despliegue inicial (Fly.io / Railway / VPS propio)?
  (Decisión de producto/infra; el monorepo ya está listo para dockerizar.)
