# What Is This?

A full-stack ERP and factory management system built for businesses that deal with bulk inventory, international container shipments, and multi-location operations.

---

## Who It's For

- Warehouse and trading companies managing stock across multiple shops or locations
- Factories that track bale production, worker output, and raw material costs
- Businesses that need integrated accounting, payroll, and POS in one place

---

## What It Does

| Area | Capabilities |
|------|-------------|
| **Accounting** | Double-entry ledger, vouchers, bank accounts, supplier/customer statements |
| **Inventory** | Multi-location stock, transfers, containers, barcodes |
| **Payroll** | Employee & worker payroll, salary advances, bonuses |
| **POS** | Point-of-sale terminal, daily sales, daybook |
| **Factory** | Bale production, worker groups, factory financials |
| **Reporting** | Daybook, account statements, stock summaries, monthly ledger |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, TypeScript, Vite, TanStack Query, shadcn/ui, Tailwind CSS |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL with Drizzle ORM |
| Auth | Session-based, per-user page access control |
| Real-time | WebSocket for live cache invalidation |

---

## Two Modes

The system runs in two distinct modes from a single codebase:

- **ERP mode** — accounting, purchasing, inventory, payroll, POS
- **Factory mode** — bale production, factory workers, factory accounts

Both modes share the same backend and database but have separate sidebars, access controls, and some dedicated API routes (`/api/factory/*`).

---

## Multi-Tenant

Each company's data is fully isolated. Users belong to one or more companies and switch between them via the company selector. Suppliers are global (shared across companies); all other data is company-scoped.
