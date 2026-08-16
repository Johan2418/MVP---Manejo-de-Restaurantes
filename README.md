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
| `GET/POST/PATCH .../restaurants/:restaurantId/reservations[/:id]` | Reservas del día (`?date=YYYY-MM-DD`) y CRUD |
| `POST .../reservations/:id/transition` | Cambio de estado (solicitada→confirmada→completada/cancelada/no-show) |
| `GET .../availability?date=&partySize=&duration=` | Franjas libres por mesa |
| `GET/POST .../restaurants/:restaurantId/conversations[/:id/...]` | Hilos de conversación, mensajes, marcar leído, responder |
| `POST /api/channels/twilio/messages` | Webhook Twilio: SMS/WhatsApp entrante → conversación + evento `guest.replied` |
| `POST /api/channels/twilio/voice` + `/voice/menu` | Webhook Twilio: llamada entrante con IVR (menú por tonos) |
| `GET/POST .../integrations` | Integraciones del restaurante (listar, sync manual) |
| `POST .../integrations/google/connect` + `GET /api/integrations/google/callback` | OAuth de Google Calendar (conectar calendario) |

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

- **Google Calendar 2-way sync** (`reminderChannel` no aplica aquí): las reservas
  **confirmadas** se reflejan como eventos en el calendario del restaurante
  (upsert por `reservationId` en `extendedProperties`), y los cambios externos
  se aplican a la agenda: reprogramación si el evento se movió (+2 min de
  tolerancia) y cancelación automática si el evento se canceló en Google.
  Los eventos huérfanos (reservas canceladas/completadas) se limpian.
- Se sincroniza ante cada evento de reserva (confirmada/reprogramada/cancelada)
  vía BullMQ (cola `calendar-sync`, job deduplicado por restaurante) y con un
  barrido periódico cada 15 minutos (Job Scheduler). Los tokens OAuth se
  renuevan automáticamente y NUNCA se exponen por la API.
- Conectar desde el panel: `.../integraciones` (botón "Conectar Google
  Calendar"). Requiere `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` en las API
  Keys y una redirect URI registrada en Google Cloud Console (ver Notas de
  entorno). El adaptador (`apps/api/src/integrations/calendar/`) es
  intercambiable: CalDAV/Outlook se enchufan implementando la misma interfaz.

## Estructura

```
apps/
  api/          # NestJS — módulos: prisma, health, domain-events, restaurants,
                #   tables, guests, reservations (+ availability); bullmq listo Fase 3
  web/          # Next.js — agenda diaria (tenant → restaurante → día)
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
