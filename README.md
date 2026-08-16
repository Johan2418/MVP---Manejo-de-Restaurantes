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
| `npm run db:studio` | Prisma Studio (navegador de datos) |

## Estructura

```
apps/
  api/          # NestJS — módulos: prisma, health (bullmq listo para Fase 3)
  web/          # Next.js — panel de gestión
packages/
  shared/       # @reservas/shared — tipos de dominio y contrato de eventos
docker-compose.yml
PLAN.md         # Plan completo, decisiones y roadmap
```

## Notas de entorno

- PostgreSQL de Docker usa el puerto **5433** (el 5432 suele estar ocupado por un
  PostgreSQL local). Ajusta `apps/api/.env` si lo necesitas.
- `PORT` del API se valida con `Number(process.env.PORT) || 3001` porque algunas máquinas
  tienen `PORT` definido en el entorno del sistema.
