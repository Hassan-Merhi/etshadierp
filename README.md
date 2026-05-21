# Business OS — ERP & POS System

A comprehensive, full-stack ERP and POS platform built for multi-company warehouse management. Designed for businesses that need robust inventory tracking, financial accounting, factory production management, and real-time container/shipment tracking — all in one system.

---

## Features

### Core ERP
- **Multi-company support** — isolated data, roles, and accounting per entity
- **Full financial accounting** — daybook, vouchers, P&L, balance sheet, ledgers
- **Customer & supplier ledgers** with statement generation
- **Purchase order management** with freight costing
- **Soft delete system** with a restore / permanent-delete admin panel
- **CSRF protection** and tenant isolation

### Inventory & Warehouse
- **Multi-location inventory tracking** with average cost calculation
- **Stock transfers, adjustments, and write-offs**
- **Reorder alerts** and pricing health reports
- **Container tracking** for international shipments (OTW, At Port, In Transit, Arrived)

### Factory Module
- **Bale production** — raw materials → mix batches → bales → dispatch
- **Worker management and payroll**
- **Customer proformas** with agreed price lists (auto-fill on new proforma)
- **Ground scan** and daily bale scanning
- **Stock allocation** per proforma

### POS System
- **Offline-first** with IndexedDB (Dexie.js) and background sync
- **Custom pricing and profit comparison**
- **Draft autosave** and conflict resolution
- **Multi-station support**

### GIT / Container Tracking
- **Live tracking workbook** — GIT summary, detail, port report, truck/location, agent duty
- **FIFO duty allocation** per agent
- **WhatsApp image dispatch** — sends a formatted agent duty card as an image to a WhatsApp group

### Properties & Rentals
- **Rental management** for properties and warehouses
- **Automated payment reminders** for overdue rent

### AI Chatbot
- **ERP-aware assistant** — queries live business data (inventory, sales, financials, alerts)
- **Context-aware suggestions** based on company data

### Communication
- **User-to-user in-app chat**
- **WhatsApp integration** for automated reports and notifications

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
| Auth | Express sessions + CSRF |

---

## Project Structure

```
├── client/src/
│   ├── pages/              # Route-level page components
│   │   ├── factory/        # Factory module pages
│   │   ├── pos/            # POS pages
│   │   └── properties/     # Properties/rental pages
│   ├── components/         # Shared UI components (shadcn/ui primitives)
│   ├── contexts/           # React contexts
│   ├── hooks/              # Custom hooks
│   └── lib/                # Utilities, API client, offline sync engine
├── server/
│   ├── routes/             # Express route handlers
│   │   └── factory/        # Factory-specific routes
│   ├── lib/                # Server helpers, PDF generators, schedulers
│   └── index.ts            # Entry point + runtime DB migrations
├── shared/
│   └── schema.ts           # Drizzle schema — single source of truth for all types
└── scripts/                # DB backfills, smoke tests
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database
- Set `DATABASE_URL` environment variable

### Install & Run

```bash
npm install
npm run dev       # starts both Express backend and Vite frontend on port 5000
```

### Build for production

```bash
npm run build
```

### Type checking

```bash
npm run typecheck
```

### Database migrations

Migrations are managed as raw SQL strings in the `server/index.ts` migrations array — they run automatically on startup and are idempotent.

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NODE_ENV` | `development` or `production` |
| `CSRF_ENFORCE` | Set to `0` for warn-only mode, anything else enforces hard 403 |
| `WHATSAPP_*` | WhatsApp API credentials for automated messaging |
| `OPENAI_API_KEY` | Powers the AI ERP chatbot |

---

## Architecture Decisions

- **Drizzle ORM** for type-safe queries and schema-as-code
- **Offline-first POS** via Dexie.js with a sync engine that handles conflict resolution
- **Multi-tenancy** via `company_id` scoping on all data — `erp`, `factory`, and `properties` company types share core accounting but have isolated modules
- **Centralized `adjustInventory` helper** — all inventory mutations go through a single function with row-level locking and FIFO/average cost calculations
- **Runtime migrations** — schema changes are applied as idempotent SQL in `server/index.ts`, avoiding `drizzle-kit push` drift issues
