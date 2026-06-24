# Deployment

## Local Development

```bash
# Install dependencies
npm install

# Start development server (Express + Vite hot reload)
npm run dev
```

The dev server runs on port `5000` (configurable). Vite serves the frontend at the same port via Express middleware (`server/vite.ts`). No separate frontend dev server is needed.

---

## Build

```bash
# Verify build tools are available, then build
npm run build
```

This runs two steps (see `package.json` `build` script):
1. `vite build` — compiles and bundles the React frontend into `dist/public/`
2. `esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist` — bundles the Express server into `dist/index.js`

The `prebuild` script asserts `vite` and `esbuild` are resolvable before the build starts.

---

## Production Start

```bash
node dist/index.js
```

The server reads env vars at startup. Missing required vars (especially `DATABASE_URL` or the PG* set) cause an immediate crash with a clear error message.

---

## Required Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Required (or PG* set) | PostgreSQL connection string. Takes priority over individual PG vars. |
| `PGHOST` | Alternative to DATABASE_URL | PostgreSQL host |
| `PGPORT` | Alternative | PostgreSQL port |
| `PGUSER` | Alternative | PostgreSQL user |
| `PGPASSWORD` | Alternative | PostgreSQL password |
| `PGDATABASE` | Alternative | PostgreSQL database name |
| `SESSION_SECRET` | Required in production | Express session encryption key. Missing in production logs a critical error. |
| `NODE_ENV` | Recommended | `"production"` enables secure cookies and production-mode Vite serving. Defaults to development behavior. |
| `CSRF_ENFORCE` | Optional | Set to `"0"` for warn-only CSRF mode. Default = enforcing (hard 403 on mismatch). |
| `PG_POOL_MAX` | Optional | PostgreSQL connection pool max size. Default = `10`. |
| `PGSSLMODE` | Optional | Set to `"disable"` to turn off SSL for the DB connection. Auto-disabled for Replit local DB (`helium` host). |
| `BUILD_VERSION` | Optional | Display version string shown in the UI header. Falls back to `RENDER_GIT_COMMIT` (first 8 chars) or `"dev"`. |
| `RENDER_GIT_COMMIT` | Optional | Set automatically by Render. Used to derive `BUILD_VERSION`. |
| `REPL_ID` | Optional | Set automatically by Replit. Enables secure cookies on Replit. |
| `CAPACITOR_ENABLED` | Optional | Enables Capacitor WebView origins for CSRF and secure cookies. |
| `MASTER_PASSWORD` | Optional | Enables a master admin login. If unset, master login is disabled. |

**Note**: `OPENAI_API_KEY` or similar AI service keys may be needed for the AI chatbot and agent features. (Needs verification — check `server/aiAgentTools.ts` and `server/routes/aiAgentRoutes.ts` for exact key names.)

**WhatsApp**: the WhatsApp service (`server/services/whatsappService.ts`) likely requires API credentials. (Needs verification — check for `WHATSAPP_*` env vars.)

---

## Render Deployment Notes

The app is designed to run on [Render](https://render.com). Key points:

- Use `DATABASE_URL` env var (Render provides it automatically for PostgreSQL add-ons).
- Set `SESSION_SECRET` to a strong random string in Render's environment settings.
- Set `NODE_ENV=production`.
- Pool size: the default of `PG_POOL_MAX=10` means two zero-downtime instances use up to 22 connections total (10×2 + session store connections). Render's free PostgreSQL tier allows 97 connections — well within limit. Raise `PG_POOL_MAX` if more concurrency is needed and the DB plan allows it.
- SSL is auto-enabled for non-Replit, non-`PGSSLMODE=disable` connections. Render's internal PostgreSQL may need `PGSSLMODE=disable` if SSL certificates are not required (Needs verification).
- `BUILD_VERSION` is auto-populated from `RENDER_GIT_COMMIT` if not set explicitly.

**Zero-downtime deploy**: Render's rolling deploy starts a new instance before draining the old one. The PostgreSQL session store handles sessions across instances. Ensure `SESSION_SECRET` is stable across deploys.

---

## GitHub Actions CI

Workflow file: `.github/workflows/ci.yml`

Triggers on `push` and `pull_request` to `main`.

Steps:
1. `actions/checkout@v4`
2. `actions/setup-node@v4` with Node 20 and npm cache
3. `npm ci` (uses `package-lock.json`)
4. `npm run check` — TypeScript type-check (can take 2–5 minutes on large codebases)
5. `npm run build` — full frontend + backend build
6. `npm run lint` — ESLint across `client/src/`, `server/`, `shared/`
7. `npm run format:check` — Prettier check

No database or environment variables are required for CI — build and type-check are compile-time only.

**Note**: `npm run check` (tsc) takes over 2 minutes in resource-constrained environments (documented gotcha). On a standard GitHub Actions runner it completes normally within the 30-minute job timeout.

---

## Database Migrations

Schema migrations are **not** managed via `drizzle-kit push` (currently blocked by schema drift). Instead:

- Runtime migrations are defined as an array of SQL statements in `server/index.ts`.
- Each migration is idempotent (uses `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc.).
- Migrations run automatically on server startup before the app begins serving requests.

To add a new column or table:
1. Update `shared/schema/` with the new Drizzle definition.
2. Add an idempotent `ALTER TABLE` / `CREATE TABLE` SQL statement to the migration array in `server/index.ts`.
3. Do **not** run `drizzle-kit push` — it will fail due to schema drift.
