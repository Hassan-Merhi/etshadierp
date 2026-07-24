# Contributing

## Project Structure

```
├── client/src/
│   ├── pages/          # Full page components (one file per page)
│   ├── components/     # Shared and feature components
│   ├── hooks/          # Custom React hooks
│   └── lib/            # Utilities and query client setup
├── server/
│   ├── routes.ts       # All API route handlers
│   ├── storage.ts      # Database access layer (IStorage interface)
│   └── index.ts        # Server entry point + DB migrations
├── shared/
│   └── schema.ts       # Drizzle ORM schema + Zod insert types (shared between client & server)
└── docs/               # Documentation
```

---

## Adding a New Feature

### 1. Update the schema (if needed)
Edit `shared/schema.ts`. Add columns to existing tables or define new tables. The server auto-migrates on startup.

### 2. Update the storage layer
Add the necessary CRUD methods to the `IStorage` interface and `MemStorage` / DB implementation in `server/storage.ts`.

### 3. Add API routes
Add route handlers in `server/routes.ts`. Keep routes thin — validation with Zod, then delegate to storage.

### 4. Build the frontend
Add pages to `client/src/pages/` and register them in `client/src/App.tsx`. Use TanStack Query for data fetching, `react-hook-form` + Zod for forms, and shadcn/ui components for UI.

### 5. Update the sidebar
- ERP: update `client/src/components/AppSidebar.tsx`
- Factory: update `client/src/components/FactorySidebar.tsx`
- Command palette: update `client/src/components/CommandPalette.tsx` (hardcoded — keep in sync manually)

---

## Code Conventions

- **TypeScript everywhere** — no plain JS files.
- **No `any` types** unless truly unavoidable.
- **Shared types** live in `shared/schema.ts` — import from there in both client and server.
- **Factory routes** use `/api/factory/` prefix and are defined in `server/factoryRoutes.ts`.
- **No direct DB calls in routes** — always go through the storage interface.
- Use `data-testid` attributes on all interactive and meaningful display elements.

---

## Running Locally

```bash
npm install
npm run dev
```

The server starts on port 5000 and serves both the API and the Vite frontend.

---

## Git Hooks (type-check gate)

`npm install` runs a `prepare` step (`scripts/setup-git-hooks.mjs`) that points
git at the committed hooks in `scripts/git-hooks/`. The **pre-push** hook runs
`npm run check` (`tsc --noEmit`) and blocks the push if the type-check fails,
keeping the 0-error baseline enforced locally even when CI cannot run.

Bypass once for a WIP branch (avoid on `main`):

```bash
SKIP_TSC_CHECK=1 git push …
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Secret key for session signing |

Copy from `.env.example` if present, or set these in your environment before starting.
