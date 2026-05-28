# HMD International Group — ERP & POS System

A comprehensive, full-stack business management platform built for multi-company warehouse and factory operations. Covers inventory, accounting, payroll, POS, factory production, container tracking, and property rentals — all in one system.

---

## Features

### Core ERP
- **Multi-company support** — isolated data, roles, and accounting per entity
- **Double-entry accounting** — daybook, vouchers, P&L, balance sheet, ledgers
- **Customer & supplier ledgers** with PDF statement generation
- **Purchase order management** with freight costing
- **Soft delete system** with restore / permanent-delete admin panel
- **CSRF protection** and tenant isolation

### Inventory & Warehouse
- **Multi-location inventory tracking** with average cost calculation
- **Stock Hub** — unified view across all locations and items
- **Stock transfers, adjustments, and write-offs**
- **Reorder alerts** and pricing health reports
- **Barcode label printing** and scan-based lookup

### Container & Shipment Tracking
- **GIT Containers workbook** — summary, detail, port report, truck/location, agent duty
- **Live container tracking** — Maersk, CMA-CGM, and other providers
- **FIFO duty allocation** per agent
- **WhatsApp image dispatch** — sends a formatted agent duty card to a WhatsApp group
- **OTW (On The Way) tracking** with ETA management

### Factory Module
- **Bale production pipeline** — raw materials → mix batches → bales → dispatch
- **Worker management and payroll** with salary advances and bonuses
- **Customer proformas** with agreed price lists (auto-fill on new proforma)
- **Ground scan and daily bale scanning**
- **Stock allocation** per proforma (V5)
- **Dispatch batch management** with scan-based loading
- **Factory Status Builder** — configurable production status boards
- **Wipers re-entry** with backdated stock entry
- **Factory intelligence** — KPIs, cashflow, profitability, waste, mix optimizer, supplier scoreboard

### POS System
- **Offline-first** with IndexedDB (Dexie.js) and background sync
- **Custom pricing and profit comparison**
- **Draft autosave** and conflict resolution
- **Multi-station support** with per-user location locking
- **Intercompany POS transfers**

### Payroll (ERP & Factory)
- **Employee and worker payroll** with monthly salary deposits
- **Salary advances** with automatic deduction tracking
- **Smart bonus calculator** — sales % bonus and bales/units-based bonus
- **Bulk operations** — bulk salary deposit, bulk withdrawal, bulk bonus
- **Employee groups** and group member management
- **Employee statement** with full transaction history

### Properties & Rentals
- **Rental management** for properties, warehouses, and shops
- **Automated payment reminders** for overdue rent
- **Rental ledger** and payment log

### AI & Automation
- **AI Command Center** — queries live business data (inventory, sales, financials, alerts)
- **AI Import** — intelligent data import assistance
- **Scheduled WhatsApp reports** — stock PDF, net position, monthly summaries
- **Automated container ETA updates** (scheduled every 6 hours)

### Communication & Collaboration
- **User-to-user in-app chat**
- **Screen feed** — live activity monitoring for admins
- **WhatsApp integration** for automated reports and notifications

### Reporting
- **Live Sheets** — embeddable Google Sheets-style spreadsheets linked to live data
- **Export Center** — Excel/PDF exports across all major modules
- **Net position export** — scheduled multi-entity net position reports
- **Daily production reports**, factory profitability, and bale history

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| Routing | wouter |
| State / Data | TanStack Query v5 |
| Forms | react-hook-form + Zod |
| UI Components | shadcn/ui (Radix UI + Tailwind CSS) |
| Backend | Express.js, TypeScript |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Offline | Dexie.js (IndexedDB) |
| Auth | Express sessions + bcrypt + CSRF tokens |
| Real-time | WebSocket (live cache invalidation) |
| PDF | Server-side PDF generation |
| AI | OpenAI API |

---

## Project Structure

```
├── client/src/
│   ├── pages/                  # Route-level page components
│   │   ├── factory/            # Factory module (~100 pages)
│   │   ├── pos/                # POS pages
│   │   ├── properties/         # Properties/rental pages
│   │   ├── erp/                # ERP-specific rental pages
│   │   ├── settings/           # Settings sub-pages
│   │   ├── daybook/            # Daybook sub-components
│   │   └── payroll/            # Payroll sub-components & dialogs
│   ├── components/             # Shared UI components (shadcn/ui primitives)
│   ├── contexts/               # React contexts (currency, date format, app mode)
│   ├── hooks/                  # Custom hooks
│   └── lib/                    # Utilities, API client, offline sync engine
├── server/
│   ├── routes/                 # Express route handlers
│   │   └── factory/            # Factory-specific routes
│   ├── lib/                    # Server helpers, PDF generators, schedulers, tracking providers
│   └── index.ts                # Entry point + runtime DB migrations
├── shared/
│   └── schema.ts               # Drizzle schema — single source of truth for all types
├── scripts/                    # DB utilities, smoke tests, admin setup
└── client/public/              # Static assets, service worker, label images
```

---

## Getting Started (Local / Replit)

### Prerequisites
- Node.js 18+
- PostgreSQL database
- `DATABASE_URL` environment variable set

### Install & Run

```bash
npm install
npm run dev       # starts both Express backend (port 5000) and Vite frontend together
```

### Build for Production

```bash
npm run build
```

### Type Checking

```bash
npm run typecheck
```

### Database Migrations

Migrations run automatically on server startup as idempotent SQL statements in `server/index.ts`. No manual migration step needed — just start the server.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `NODE_ENV` | ✅ | `development` or `production` |
| `SESSION_SECRET` | ✅ | Secret key for Express session signing |
| `CSRF_ENFORCE` | — | Set to `0` for warn-only CSRF mode; anything else (default) = hard 403 |
| `OPENAI_API_KEY` | — | Powers the AI Command Center chatbot and AI import |
| `WHATSAPP_API_URL` | — | WhatsApp API base URL for automated messaging |
| `WHATSAPP_API_TOKEN` | — | WhatsApp API auth token |
| `WHATSAPP_GROUP_ID` | — | Default WhatsApp group for automated reports |
| `PARCELS_APP_API_KEY` | — | Container tracking API key (ParcelsApp) |
| `PG_POOL_MAX` | — | PostgreSQL connection pool size (default: 5) |
| `ENABLE_SCHEDULERS` | — | Set to `false` to disable background schedulers in dev |

---

## Architecture Decisions

- **Drizzle ORM** for type-safe queries and schema-as-code; runtime migrations avoid `drizzle-kit push` drift issues
- **Offline-first POS** via Dexie.js with a sync engine handling conflict resolution and draft autosave
- **Multi-tenancy** via `company_id` scoping on all data — `erp`, `factory`, and `properties` company types share core accounting but have isolated modules
- **Centralized `adjustInventory` helper** — all inventory mutations go through one function with row-level locking and FIFO/average cost calculations
- **Per-user, per-page access control** — replaces broad roles; admins grant individual users access to specific sidebar pages independently for ERP and Factory modes
- **WebSocket real-time updates** — any save/delete triggers a targeted cache invalidation for all connected clients, no manual refresh needed
- **Component decomposition** — large pages (Payroll, Daybook, Vouchers) are split into focused sub-components under their own folders (`pages/payroll/`, `pages/daybook/`)

---

## Known Gotchas

- **`tsc --noEmit` is slow** — typechecking can take over 2 minutes; avoid blocking on it in tight loops
- **Orphaned data** — several `NOT VALID` foreign key constraints exist from historical data; validating them would require data cleanup
- **`drizzle-kit push` is blocked** by schema drift; use the runtime SQL migrations in `server/index.ts` instead
- **`console.log` in server code** — many legacy log calls remain; use `serverLog` for new production logging

---

## Deploying to Render

The project includes a `render.yaml` blueprint for one-click deployment.

### What You'll Get
- Live HTTPS URL with your own domain
- PostgreSQL database with automatic backups
- Auto-deploy on every GitHub push
- **Fixed cost: ~$14/month** (Web Service $7 + Database $7)

### Step 1 — Push to GitHub

**Option A: GitHub Desktop**
1. Download [GitHub Desktop](https://desktop.github.com)
2. Add Existing Repository → choose your project folder
3. Click "Publish repository"

**Option B: Terminal**
```bash
git init
git add .
git commit -m "Initial commit"
gh repo create erp-pos-system --public --source=. --remote=origin --push
```

### Step 2 — Deploy on Render

1. Go to [render.com](https://render.com) and sign in with GitHub
2. Click **New +** → **Blueprint**
3. Connect your GitHub repository
4. Render detects `render.yaml` and shows:
   - Web Service: `erp-pos-system` — $7/month (512 MB RAM, shared CPU)
   - PostgreSQL Database: `erp-database` — $7/month (256 MB RAM, 1 GB storage)
5. Click **Apply** and add your payment method
6. Wait 3–5 minutes — Render builds the app, creates the database, and runs migrations automatically
7. Your URL will be: `https://erp-pos-system.onrender.com`

### Step 3 — Create Your First Admin User

Connect to your database (via Render's Shell tab or a PostgreSQL client using the External Connection String) and run:

```sql
-- Create initial company
INSERT INTO companies (code, name, active)
VALUES ('COMP001', 'Your Company Name', true);

-- Create admin user (password = 'admin123')
INSERT INTO users (username, password, active)
VALUES ('admin', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', true);

-- Link user to company with Admin role
INSERT INTO user_company_roles (user_id, company_id, role)
VALUES (
  (SELECT id FROM users WHERE username = 'admin'),
  (SELECT id FROM companies WHERE code = 'COMP001'),
  'Admin'
);
```

**Default login:** `admin` / `admin123` — **change this immediately after first login.**

### Step 4 — Set Environment Variables

In the Render dashboard → your Web Service → **Environment**:

| Variable | Value |
|---|---|
| `SESSION_SECRET` | Any long random string |
| `OPENAI_API_KEY` | Your OpenAI key (for AI chatbot) |
| `WHATSAPP_API_URL` | Your WhatsApp API URL (optional) |
| `WHATSAPP_API_TOKEN` | Your WhatsApp token (optional) |

`DATABASE_URL` is set automatically by Render when using the Blueprint.

### SSL & Database Notes

- Production SSL is automatically enabled with `rejectUnauthorized: false`
- Development (local/Replit) runs with SSL disabled — the app detects this automatically via `NODE_ENV`
- Compatible with Render PostgreSQL, Neon, and any standard PostgreSQL database

### Updating the App

```bash
# Make your changes, then:
git add .
git commit -m "Your update"
git push
```

Render auto-deploys on every push. Watch progress in the **Events** tab.

### Scaling Up

| Tier | Web Service | Database |
|---|---|---|
| Starter (current) | $7/mo — 512 MB RAM | $7/mo — 1 GB storage |
| Standard | $25/mo — 2 GB RAM, 1 CPU | $14/mo — 512 MB RAM |
| Pro | $85/mo — 4 GB RAM, 2 CPUs | $25/mo — 1 GB RAM, 10 GB storage |

---

## Troubleshooting

**"Error connecting to database"**
- Verify `DATABASE_URL` is set and the database service is running
- In Render shell: `echo $DATABASE_URL`

**"relation does not exist" error**
- A migration may be pending — restart the server to trigger auto-migration

**Build fails on Render**
- Check the Logs tab in the Render dashboard for the exact error
- Verify all required environment variables are set

**Page or menu item missing for a user**
- Admins grant page access per-user in Settings → User Access Management

**POS user can't see cost/profit**
- By design — hidden at the API level for POS roles
