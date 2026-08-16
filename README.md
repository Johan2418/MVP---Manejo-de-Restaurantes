# Reservas — SaaS de automatización de reservas para restaurantes

Sistema integral multi-tenant (país objetivo: Ecuador) para gestionar reservas a través de
múltiples canales: llamadas telefónicas automatizadas, SMS/WhatsApp y formulario web.
Arquitectura preparada para incorporar agentes de IA en el futuro (ver `PLAN.md`).

## Stack

| Capa | Tecnología |
|---|---|
| Backend | NestJS (TypeScript) |
| Frontend | Next.js + React + Tailwind |
| Base de datos | PostgreSQL + Prisma ORM |
| Colas / jobs | Redis + BullMQ |
| Telefonía / mensajería | Twilio (Fase 2) |

## Requisitos

- Node.js ≥ 20
- Docker (para PostgreSQL y Redis locales)

## Puesta en marcha

```bash
npm install            # instala todos los workspaces
docker compose up -d   # levanta PostgreSQL (puerto 5433) y Redis (6379)
npm run db:migrate     # aplica las migraciones de Prisma
```

En dos terminales:

```bash
npm run dev:api   # API en http://localhost:3001/api  (health: /api/health)
npm run dev:web   # Web en http://localhost:3000
```

## Scripts principales

| Script | Descripción |
|---|---|
| `npm run dev:api` / `dev:web` | Servidores de desarrollo |
| `npm run build` | Build de todos los workspaces |
| `npm run typecheck` | Typecheck de todos los workspaces |
| `npm run db:up` / `db:down` | Levantar / parar infraestructura Docker |
| `npm run db:migrate` | Nueva migración Prisma (dev) |
| `npm run db:seed` | Datos demo (tenant, restaurante, mesas, reservas) |
| `npm run db:studio` | Prisma Studio (navegador de datos) |

## API (Fase 1 — núcleo de reservas)

Todas las rutas de negocio están aisladas por tenant: `/api/tenants/:tenantId/...`.

| Endpoint | Descripción |
|---|---|
| `GET/POST /api/tenants` | Listar / crear tenant |
| `GET/POST/PATCH/DELETE /api/tenants/:tenantId/restaurants[/:id]` | CRUD restaurantes |
| `GET/POST/PATCH/DELETE .../restaurants/:restaurantId/tables[/:tableId]` | CRUD mesas |
| `GET/POST/PATCH .../tenants/:tenantId/guests[/:guestId]` | Comensales (búsqueda `?q=`) |
| `GET .../restaurants/:restaurantId/guests` + `GET .../guests/:guestId` | CRM propio: comensales del restaurante y perfil completo (historial) |
| `GET/POST/PATCH .../restaurants/:restaurantId/reservations[/:id]` | Reservas del día (`?date=YYYY-MM-DD`) y CRUD |
| `POST .../reservations/:id/transition` | Cambio de estado (solicitada→confirmada→completada/cancelada/no-show) |
| `POST .../reservations/auto-assign` | Asignación automática de mesas (Fase 5) a reservas activas sin mesa |
| `GET .../availability?date=&partySize=&duration=` | Franjas libres por mesa |
| `GET/POST .../restaurants/:restaurantId/conversations[/:id/...]` | Hilos de conversación, mensajes, marcar leído, responder |
| `POST /api/channels/twilio/messages` | Webhook Twilio: SMS/WhatsApp entrante → conversación + evento `guest.replied` |
| `POST /api/channels/twilio/voice` + `/voice/menu` | Webhook Twilio: llamada entrante con IVR (menú por tonos) |
| `GET/POST .../integrations` | Integraciones del restaurante (listar, sync manual) |
| `POST .../integrations/google/connect` + `GET /api/integrations/google/callback` | OAuth de Google Calendar (conectar calendario) |
| `POST .../integrations/caldav/connect` + `/caldav/disconnect` | Conectar/desconectar CalDAV (URL + credenciales) |
| `GET .../analytics/overview?days=14` | Analítica: previsión de ocupación + informe de canales |

Comportamiento clave: las reservas activas (solicitada/confirmada) bloquean su mesa;
intentar asignar una mesa ocupada devuelve **409** con el detalle del conflicto.

## Canales (Fase 2)

Los webhooks de Twilio (SMS, WhatsApp y voz) convierten cada interacción en una
`Conversation` + `Message` persistidas y emiten eventos de dominio
(`guest.replied`, `call.received`, `call.ended`). El panel de conversaciones vive
en `/tenants/:tenantId/restaurants/:restaurantId/conversaciones`.

- Cada restaurante tiene un `twilioPhoneNumber` (número Twilio) y un `phone`
  (teléfono real para reenvío del IVR).
- Webhooks a configurar en Twilio → `POST {base}/api/channels/twilio/messages`
  (mensajería) y `POST {base}/api/channels/twilio/voice` (llamadas).
- El envío saliente (responder desde el panel) requiere `TWILIO_ACCOUNT_SID` +
  `TWILIO_AUTH_TOKEN`; sin ellas la respuesta se registra como `FAILED` y el API
  responde 503.
- **Idempotencia**: los webhooks se deduplican por `providerSid` (MessageSid),
  así los reintentos de Twilio no procesan dos veces el mismo mensaje.
- Webhooks adicionales de voz (Fase 3): `POST {base}/api/channels/twilio/voice/reminder/menu`
  (dígitos de la llamada de recordatorio) y `.../voice/reminder/status` (estado
  de la llamada saliente). Twilio debe poder alcanzar `{base}` desde internet
  → usa la variable `WEBHOOK_BASE_URL` (ver Notas de entorno).

## Automatización (Fase 3)

- **Recordatorios programados**: al crear/confirmar/reprogramar una reserva se
  programa un recordatorio `reminderHoursBefore` horas antes (por defecto 2,
  configurable por restaurante) en la cola BullMQ `reminders`, con reintentos y
  backoff exponencial. El canal depende del campo `reminderChannel` del
  restaurante (`PHONE` = llamada IVR, `SMS`/`WHATSAPP` = mensaje); las reservas
  originadas por teléfono siempre se recuerdan por llamada.
- **Confirmación/cancelación por respuesta del cliente**: "1" confirma
  (`REQUESTED → CONFIRMED`) y "2" cancela, tanto por SMS/WhatsApp como por
  teclas en la llamada de recordatorio (IVR). El sistema responde
  automáticamente por el mismo canal.
- **Auto no-show / auto-cancelación**: al final del turno (+30 min) un trabajo
  marca `NO_SHOW` la reserva confirmada que no se presentó o auto-cancela la
  que seguía sin confirmar.
- **Outbox**: cada evento de dominio se persiste en `outbox_events` (no
  bloqueante) para trazabilidad y reproceso.

## Integraciones (Fase 4)

- **Google Calendar 2-way sync**: las reservas **confirmadas** se reflejan como
  eventos en el calendario del restaurante (upsert por `reservationId` en
  `extendedProperties`), y los cambios externos se aplican a la agenda:
  reprogramación si el evento se movió (+2 min de tolerancia) y cancelación
  automática si el evento se canceló en Google. Los eventos huérfanos (reservas
  canceladas/completadas) se limpian.
- **CalDAV 2-way sync** (Nextcloud, iCloud, Zimbra…): misma sincronización a
  través de la interfaz `CalendarAdapter`, conectando por URL + usuario/
  contraseña (sin OAuth). El vínculo con la reserva se guarda en la propiedad
  `X-RESERVATION-ID` del VEVENT. Implementado con REPORT `calendar-query`,
  PUT/DELETE y parseo iCalendar (RFC 5545) — sin dependencias nuevas.
- Se sincroniza ante cada evento de reserva (confirmada/reprogramada/cancelada)
  vía BullMQ (cola `calendar-sync`, job deduplicado por restaurante) y con un
  barrido periódico cada 15 minutos (Job Scheduler). Los tokens OAuth se
  renuevan automáticamente y las credenciales NUNCA se exponen por la API.
- Conectar desde el panel: `.../integraciones` (botón "Conectar Google
  Calendar" o formulario CalDAV). Google requiere `GOOGLE_CLIENT_ID` +
  `GOOGLE_CLIENT_SECRET` en las API Keys y una redirect URI registrada en
  Google Cloud Console (ver Notas de entorno). Los adaptadores viven en
  `apps/api/src/integrations/calendar/` y son intercambiables: Outlook se
  enchufa implementando la misma interfaz.

## CRM propio (Fase 4)

El adaptador CRM del plan se resuelve hoy con el **CRM propio**: el perfil del
comensal vive en `Guest` (nombre, teléfono, email, notas, preferencias,
`visits`, consentimiento LOPDP) y se consume desde el panel:

- `.../comensales`: listado del restaurante con búsqueda (`?q=`), visitas,
  última reserva y badge de consentimiento.
- Perfil completo: historial de reservas, conversaciones recientes y edición de
  notas/preferencias/consentimiento (PATCH `/api/tenants/:tenantId/guests/:id`).
- El contrato `CrmAdapter` (`apps/api/src/crm/crm.adapter.ts`) deja la puerta
  abierta a HubSpot/Zoho: el token `CRM_ADAPTER` se resuelve hoy a
  `GuestsService` (el CRM propio); una implementación nueva basta para
  cambiar de proveedor sin tocar el panel.

## Analítica (Fase 5)

- **Previsión de ocupación**: comensales reservados por día (próximos 14 días)
  frente a la capacidad total de mesas, en `.../analitica`.
- **Informe de canales**: reservas por canal de origen (últimos 30 días) con
  desglose por estado y conversaciones por canal, más tasas de confirmación,
  cancelación y no-show.

## Agentes IA (Fase 5)

**Chatbot WhatsApp/SMS** — bot conversacional en español integrado al webhook de
mensajería: saludos, horarios de apertura, y un flujo de reserva guiado
(comensales → fecha → hora → nombre) que crea la reserva como `REQUESTED` en el
canal de origen. El estado del flujo vive en `Conversation.metadata`
(migración `20260816160000_ai_agents`), así que sobrevive reinicios. Las
respuestas "1"/"2"/confirmar/cancelar siguen gestionando la confirmación de
reservas existentes.

**Agente de voz con IA (Twilio Media Streams + OpenAI Realtime)** — cuando
`OPENAI_API_KEY` está definida, las llamadas entrantes se atienden con un
conserje conversacional: Twilio envía el audio de la llamada por WebSocket a
`/api/channels/twilio/voice/ai-stream` y el servicio lo puentea bidireccional-
mente con la Realtime API de OpenAI (g711_ulaw a 8 kHz), con el prompt
construido con el nombre y los horarios reales del restaurante. Sin la key, la
llamada cae automáticamente al IVR clásico por tonos. Requiere `WEBHOOK_BASE_URL`
accesible desde internet (ws/wss según el esquema).

## Reasignación automática de mesas (Fase 5)

- Al **confirmar** una reserva sin mesa se intenta asignarle ya la mesa más
  pequeña que quepa al grupo y esté libre en su horario (también al crear
  directamente una reserva confirmada).
- Al **cancelar/completar/no-show** se libera una mesa y el sistema barre el
  restaurante para recolocar reservas activas que antes no cabían.
- Botón "Auto-asignar" en la agenda y endpoint `POST .../reservations/auto-assign`
  para lanzar el barrido manualmente. La asignación nunca pisa una mesa
  ocupada (misma lógica de conflictos que el resto del sistema).

## Agenda (Fase 1)

- Vista **día** (rejilla por mesa y franja) y vista **semana** (lunes a
  domingo) con el conmutador en la cabecera.
- **Drag & drop** en la vista día: arrastra una reserva a otra mesa/franja
  (o a la fila "Sin asignar" para liberar la mesa); los conflictos de mesa
  se validan en el servidor y se muestran como error.

## Estructura

```
apps/
  api/          # NestJS — módulos: prisma, health, domain-events, restaurants,
                #   tables, guests (CRM propio), reservations, channels, reminders,
                #   integrations (Google + CalDAV), analytics
  web/          # Next.js — agenda diaria, conversaciones, comensales, analítica, integraciones
packages/
  shared/       # @reservas/shared — tipos de dominio, etiquetas UI y contrato de eventos
docker-compose.yml
PLAN.md         # Plan completo, decisiones y roadmap
```

## Notas de entorno

- PostgreSQL de Docker usa el puerto **5433** (el 5432 suele estar ocupado por un
  PostgreSQL local). Ajusta `apps/api/.env` si lo necesitas.
- `PORT` del API se valida con `Number(process.env.PORT) || 3001` porque algunas máquinas
  tienen `PORT` definido en el entorno del sistema.
- `WEBHOOK_BASE_URL` (p. ej. `https://api.midominio.com`): URL pública de la API
  usada por los recordatorios por llamada (Fase 3) para que Twilio reenvíe los
  dígitos del IVR, y por el callback OAuth de Google (Fase 4). En desarrollo
  local usa un túnel tipo ngrok; si no se define, se usa `http://localhost:3001`
  (solo válido para pruebas locales sin Twilio).
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (Fase 4): credenciales OAuth de
  Google Cloud Console (alcance `calendar.events`). `GOOGLE_REDIRECT_URI`
  opcional; por defecto `{WEBHOOK_BASE_URL}/api/integrations/google/callback`
  — esa URL debe estar registrada como redirect URI autorizada en la consola.
- `WEB_ORIGIN` (por defecto `http://localhost:3000`): origen del frontend al que
  se redirige tras completar el OAuth de Google.
- `OPENAI_API_KEY` (Fase 5): clave de la plataforma OpenAI para el agente de
  voz (Realtime API, modelo `gpt-4o-realtime-preview`). Sin ella, las llamadas
  entrantes usan el IVR clásico por tonos y el resto del sistema funciona igual.
