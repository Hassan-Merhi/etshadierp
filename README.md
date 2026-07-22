# ERP / POS System

A comprehensive, multi-company **ERP and POS platform** for warehouse
management, inventory, and financials — with container tracking, factory
production, property rentals, offline-capable point of sale, and an AI
chatbot for querying ERP data.

It is a full-stack TypeScript application (React frontend + Express API +
PostgreSQL) that also ships as native mobile apps via Capacitor.

## Tech stack

| Layer | Technologies |
|-------|--------------|
| Frontend | React 18, TypeScript, Vite, TanStack Query, react-hook-form + Zod, wouter, shadcn/ui (Tailwind + Radix) |
| Backend | Express.js, TypeScript, Drizzle ORM, `pg`, Zod validation |
| Database | PostgreSQL |
| Auth / security | Passport (local), WebAuthn, Helmet, CSRF enforcement, rate limiting, per-tenant isolation |
| Offline | Dexie.js (IndexedDB) with a sync engine and draft autosave |
| Mobile / desktop | Capacitor (Android/iOS), Electron desktop |

## Prerequisites

- Node.js **20** (see `.node-version`)
- A PostgreSQL database

## Getting started

```bash
# 1. Install dependencies
npm ci

# 2. Configure environment
cp .env.example .env
# then edit .env and set DATABASE_URL and SESSION_SECRET

# 3. Push the database schema
npm run db:push

# 4. Start the dev server (client + API on http://localhost:5000)
npm run dev
```

### Environment variables

See `.env.example` for the full list. The essentials:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `SESSION_SECRET` | Secret used to sign sessions (required in production) |
| `NODE_ENV` | `development` or `production` |
| `PORT` | Server port (default `5000`) |
| `CSRF_ENFORCE` | `0` = warn-only, otherwise hard 403 (default) |

## Common scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Run client + server in development |
| `npm run build` | Production build (client bundle + server bundle) |
| `npm start` | Run the production build |
| `npm run check` | TypeScript type-check (`tsc --noEmit`) |
| `npm run lint` | ESLint over `client/`, `server/`, `shared/` |
| `npm run format` | Prettier write |
| `npm test` | Backend + frontend test suites (Vitest) |
| `npm run test:backend` / `npm run test:frontend` | Run one suite |
| `npm run db:push` | Apply the Drizzle schema to the database |

## Project layout

```
client/src/        Frontend
  pages/           Screens, grouped by domain (factory/, pos/, properties/, …)
  components/      Shared UI primitives (shadcn/ui)
  contexts/        React contexts (company, currency, mode, …)
  hooks/           Reusable hooks
  lib/             API clients, utilities, offline logic
server/            Express API
  routes/          HTTP routes, grouped by domain (factory/, containers/, …)
  services/        Domain services (accounting, audit, security, …)
  lib/             Helpers (PDF, dates, request context, …)
  middleware/      Request logging, security, bandwidth diagnostics
shared/            Code shared between client and server
  schema/          Drizzle database schema — source of truth for DB + types
migrations/        SQL migrations
tests/             Vitest suites (backend + tests/ui frontend)
docs/              Architecture, flows, and audit documentation
```

## Architecture notes

- **Full-stack TypeScript** — types flow from the Drizzle schema in
  `shared/schema/` through the API to the frontend.
- **Multi-tenancy** — `erp`, `factory`, and `properties` company types with
  isolated data and API namespaces, sharing a common accounting core.
- **Offline-first POS** — IndexedDB via Dexie with conflict resolution and
  autosaved drafts.
- **Centralized inventory mutations** — all stock changes route through a
  single `adjustInventory` helper with row-level locking and cost
  calculation for integrity.

## Continuous integration

GitHub Actions runs on every push / PR to `main`:

- **CI** (`.github/workflows/ci.yml`): type-check → build → lint → format →
  DB schema push → startup-migration smoke test → backend & frontend tests
  with coverage thresholds.
- **Security** (`.github/workflows/security.yml`): production dependency
  audit and TruffleHog secret scanning.

## More documentation

The `docs/` directory contains deeper references — architecture, accounting
and inventory flows, deployment, and security. Start with
`docs/architecture.md` and `docs/onboarding.md`.
