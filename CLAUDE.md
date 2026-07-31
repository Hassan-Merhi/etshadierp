# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this is

A multi-company **ERP + POS platform** (warehouse/inventory, accounting,
container tracking, factory production, property rentals, offline POS, AI
chatbot). Full-stack TypeScript: React 18 frontend + Express API + PostgreSQL,
served by a single Node process. Also packaged as mobile (Capacitor) and
desktop (Electron) apps.

Node **20** (`.node-version`: 20.19.2). Package manager: **npm** (`package-lock.json`
is authoritative; a `pnpm-lock.yaml` also exists but CI uses `npm ci`).

## Commands

```bash
npm ci                    # install (runs `prepare` → installs git hooks)
npm run dev               # dev server, client + API on :5000
npm run build             # vite build + esbuild server bundle + bundle verification
npm start                 # run dist/index.js (production)

npm run check             # tsc --noEmit  (SLOW: 2–5 min; gates pre-push and CI)
npm run lint              # eslint over client/src, server, shared
npm run format            # prettier --write
npm run format:check      # prettier --check

npm test                  # backend then frontend suites
npm run test:backend      # vitest, node env, tests/*.test.ts
npm run test:frontend     # vitest, jsdom, tests/ui/*
npm run test:smoke-sweep  # API smoke sweep (separate CI signal)
npm run test:watch
```

Verification/audit scripts (used by CI, runnable locally): `verify:lockfile`,
`verify:server-bundle`, `verify:production-dependencies`,
`verify:final-production-readiness`, `verify:program1-observability`,
`verify:bandwidth`, `audit:god-files`, `audit:exports`, `audit:heavy-apis`,
`check:program-6-security`. ~110 more one-off scripts live in `scripts/`.

Env: copy `.env.example` → `.env`. Required: `DATABASE_URL`, `SESSION_SECRET`.
Others: `NODE_ENV`, `PORT` (default 5000), `CSRF_ENFORCE` (`0` = warn-only,
otherwise hard 403), `ENABLE_SCHEDULERS`.

## Layout

```
client/src/
  App.tsx            entry route tree; app/, routes/ hold the shells
  app/               AuthenticatedApp + ErpShell / FactoryShell / PosShell / PropertiesShell
  routes/            AppRoutes, ErpRoutes, PosRoutes
  pages/             ~138 page files + domain subdirs (factory/, pos/, properties/, sp/, containers/, vouchers/, …)
  components/        shared components; components/ui/ = shadcn/ui primitives
  api/               typed per-domain API clients (accountsApi, inventoryApi, …)
  lib/               queryClient, queryKeys, offline/sync (Dexie), pagination clients, guards
  contexts/ hooks/ contracts/ types/
server/
  index.ts           bootstrap: express, session, CSRF, startup migrations, health endpoints
  routes.ts          30-line barrel → routes/applicationRoutes.ts
  routes/            ~120 modules + subdirs (factory/, containers/, admin/, payroll/, rental/, stock/, stats/, vouchers/, …)
  services/          domain services (accounting/, factory/, containers/, reports/, payroll/, audit/, …)
  storage/           DB access layer, composed into one `storage` object
  middleware/        company scoping, permissions, request logging, observability
  lib/               logger/serverLog, permissionMiddleware, dateUtils, requestContext, …
  startup-schema/    idempotent startup migration statements (001–010 + index.ts)
  *.mjs              runtime bridges preloaded via --import (see `dev`/`start` scripts)
shared/
  schema.ts          re-export barrel — ALWAYS import from `@shared/schema`
  schema/            split Drizzle tables: common, accounting, erp, inventory, pos, factory, containers, properties, sp, users, security
  permissionConfig.ts  PERMISSION_CATALOG
migrations/          versioned SQL + meta/_journal.json (drizzle)
config/              CI guardrail baselines (route-manifest, god-file-boundaries, ratchet allowances, …)
tests/               224 backend suites; tests/ui/ = jsdom suites
docs/                ~100 architecture / flow / program docs
```

Path aliases: `@/*` → `client/src/*`, `@shared/*` → `shared/*` (tsconfig, vite,
and all vitest configs).

## Architecture essentials

- **Types flow from the schema.** `shared/schema/` defines Drizzle tables, Zod
  insert schemas, and TS types. Server queries and client form validation both
  consume them. Import from `@shared/schema`, never from an individual file
  under `shared/schema/`.
- **Routes are thin.** Validate with Zod, delegate to `server/storage/*` or a
  service in `server/services/*`. No direct DB calls in route handlers.
- **Route registration** is a tree: `server/routes.ts` → `routes/applicationRoutes.ts`
  → per-domain `register*Routes(app)`. A new route file must be wired into that
  chain or its sub-barrel `index.ts`.
- **Multi-tenancy is application-level only.** Every query must be scoped by
  `companyId` from the session (`req.session.currentCompanyId`, or
  `resolveActiveCompanyId` for factory/SP domains). There is no row-level
  security in Postgres — a missing filter is a cross-tenant data leak.
  `server/middleware/companyResourceScope.ts` and
  `server/services/security/companyIsolationPolicy.ts` enforce this for
  classified routes.
- **Company types**: `erp`, `factory`, `factory_v2`, `properties`,
  `supplier_partner` — isolated data and API namespaces sharing one accounting core.
- **Auth** (`server/auth.ts`): `requireAuth`, `requireRole(...)`, `canDelete`,
  `requireNonPOS`, `checkPOSLocation`, `canModifyDate`. Permission keys
  (`page_*`, `act_*`) live in `shared/permissionConfig.ts` and are enforced by
  `server/lib/permissionMiddleware.ts` (`requireModuleAccess`,
  `requireActionAccess`, `requireExportAccess`). Developer/Admin bypass
  role-feature rows but the role is still re-read from storage per company.
- **All inventory mutations go through `server/inventoryHelper.ts`**
  (`adjustInventory`, `reverseInventoryByExactValue`) — row-level locking and
  cost calculation live there. Do not write inventory rows directly.
- **Accounting postings** go through `server/services/accounting/centralPostingEngine.ts`
  and the domain posting modules beside it. Entries must balance (DR = CR).
- **Frontend data**: TanStack Query v5. Query keys come from
  `client/src/lib/queryKeys.ts` — the first key element must be the real URL the
  shared fetcher will call, filters are normalized, and keys are company-scoped
  via `companyQueryScope`/`frontendDataArchitecture`. Mutations use `apiRequest`
  from `client/src/lib/queryClient.ts` (handles CSRF token, offline queueing,
  session-expiry redirect). Forms: `react-hook-form` + `zodResolver`.
- **Offline**: Dexie (IndexedDB) + `syncEngine.ts`/`offlineQueue.ts`, draft
  autosave, conflict resolution. POS is the primary offline surface.

## Database & migrations

Two mechanisms coexist — know which one applies:

1. **Startup migrations** (`server/startup-schema/`) — idempotent
   `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … IF NOT EXISTS` statements run
   by `server/index.ts` on boot against a dedicated client, non-blocking
   (`/api/health/db` reports progress). This is the active path for schema
   changes shipped to production.
2. **Versioned SQL** (`migrations/` + `meta/_journal.json`) — applied by
   `scripts/run-versioned-migrations.mjs --apply` (requires an explicit
   confirmation flag). `scripts/verify-migration-registry.mjs` checks the
   journal matches the files; CI runs it.

`npm run db:push` (`drizzle-kit push`) is used **only** against disposable CI /
local databases; historically it has been blocked against real databases by
schema drift. Don't run it against production data.

When you change `shared/schema/`, add the matching idempotent statement to
`server/startup-schema/` and confirm the server boots with the migration log
clean.

## CI guardrails (these will fail your PR)

GitHub Actions (`.github/workflows/ci.yml`, on push/PR to `main`): install →
type-check → build → lint → prettier check of **changed** files → drizzle push
on a throwaway Postgres → boot `dist/index.js` and wait for `/api/health/db` →
backend tests → smoke sweep → backend coverage thresholds → frontend tests →
frontend coverage thresholds. `security.yml` runs a production dependency audit
and TruffleHog. CircleCI (`.circleci/config.yml`) runs a parallel
`static-build` / `postgres-regression` / `security-readiness` workflow with the
same gates plus the repository safety contracts.

Snapshot/ratchet tests in `tests/` that fail on architectural drift:

| Test | Guards |
|---|---|
| `route-manifest.test.ts` | Exact set of registered routes + their middleware chains, against `config/route-manifest.json`. Regenerate deliberately: `UPDATE_ROUTE_MANIFEST=1 npm run test:backend -- route-manifest` |
| `god-file-boundaries.test.ts` | `config/god-file-boundaries.json`: per-file `maxLines` + forbidden patterns for barrels, plus a repo-wide 900-line soft cap with 143 grandfathered files frozen at their recorded size (they may shrink, never grow) |
| `source-text-assertions.test.ts` | One-way count of tests that assert on literal source text. Regenerate: `UPDATE_SOURCE_TEXT_BASELINE=1 npm run test:backend -- source-text-assertions` |
| `legacy-route-boundaries.test.ts`, `duplicate-route-ownership.test.ts`, `inventory-route-ownership.test.ts`, `operations-route-ownership.test.ts` | Route ownership stays in focused domain modules |
| `company-access-boundary-contract.test.ts`, `company-isolation-policy.test.ts`, `*-scope-policy.test.ts` | Tenant isolation contracts |

Reviewed, intentional deltas go in `config/ci-ratchet-allowances.json` (exact
entries only — unrelated growth still fails). Prefer splitting a file over
baselining it.

**Local pre-push hook** (`scripts/git-hooks/pre-push`, installed by `npm ci`)
runs `npm run check` and blocks the push on any type error. Bypass only for WIP
branches: `SKIP_TSC_CHECK=1 git push …`.

## Conventions

- TypeScript everywhere; `strict: true`. `no-explicit-any` is off in ESLint but
  avoid `any` in new code.
- Prettier: 2 spaces, double quotes, semicolons, `printWidth: 120`, ES5 trailing
  commas, LF. Run `npm run format` before pushing — CI checks changed files.
- Use `data-testid` on interactive and meaningful display elements.
- Server logging: use `logger` / `serverLog` (`server/lib/`), not `console.log`
  (a lot of legacy `console.log` remains; don't add more).
- New page → register in `client/src/routes/*` (or the relevant shell), add to
  `AppSidebar.tsx` / `FactorySidebar.tsx`, and update `CommandPalette.tsx`
  (hardcoded, kept in sync manually). Consider whether it needs a `page_*`
  permission key.
- Backend tests run serially in a single fork against one shared database
  (`fileParallelism: false`, `singleFork: true`) — tests must not assume
  isolation, and process-global settings leak between suites if you parallelize.
- Coverage thresholds are low repo-wide (lines/statements 8) but strict for
  specific modules (`routes/helpers/passwordHelpers.ts` 95%,
  `services/accounting/centralPostingEngine.ts` 45%). Don't drop those.

## Gotchas

- `npm run check` takes minutes and can OOM on small containers; CI sets
  `NODE_OPTIONS=--max-old-space-size=4096`.
- `npm run dev` / `npm start` preload several `.mjs` bridges via `--import`
  (schema, supplier scope, export buffer, pagination). Running
  `tsx server/index.ts` bare will behave differently — use the npm scripts.
- Several foreign keys exist as `NOT VALID` due to historical orphaned rows.
- The repository owner's stated preference: **do not add new test files unless
  necessary**; update existing tests only when a change breaks them, and verify
  via type-check/build plus an explicit description of what was checked.
- `replit.md` is stale in places (it references a non-existent `npm run typecheck`
  and `shared/schema.ts` as a monolith). Prefer this file, `README.md`, and
  `docs/architecture.md`.

## Deployment

Render (`render.yaml`): `npm ci && npm run build` → `npm start`, health check at
`/api/health/ready`, `SESSION_SECRET` generated, `DATABASE_URL` from the managed
Postgres. The port opens immediately and startup migrations run in the
background so deploys aren't held. Also `.replit` (Replit), `desktop/`
(Electron, `build-windows.yml`), and `android/` + `ios/` via Capacitor
(`npm run cap:sync`, `cap:android`, `cap:ios`).

## Further reading (`docs/`)

`architecture.md`, `onboarding.md`, `core-concepts.md`, `testing.md`,
`development-checklist.md`, `contributing.md`, `deployment.md`,
`permissions-security.md`, and per-domain flows: `accounting-flow.md`,
`inventory-flow.md`, `pos-flow.md`, `containers-flow.md`, `factory-flow.md`,
`vouchers-flow.md`. The `program-*` and `engineering/phase*` docs record the
history and rules of the ongoing god-file split, bandwidth, and security
hardening programs.
