# ERP POS System

## Overview

This project is a comprehensive ERP and POS system designed for multi-company warehouse management. It focuses on optimizing operations and providing strong financial oversight for businesses dealing with bulk inventory and complex supply chains, including international container shipments. Key capabilities include robust inventory tracking across multiple locations, streamlined purchase order management, container tracking, and full financial accounting and reporting. The system supports multi-entity businesses with isolated data and features an AI Chatbot for intelligent assistance with ERP data.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions

The frontend uses React with TypeScript and Vite, employing the `shadcn/ui` design system (New York style) built on Radix UI primitives and styled with Tailwind CSS. It prioritizes clarity and efficiency for data-intensive interfaces, using Inter and JetBrains Mono fonts, and supports light/dark themes. A consistent vertical sidebar navigation pattern is used across all major pages, featuring `w-56` width, uppercase group labels, active state styling, and icons from `lucide-react`.

### Technical Implementations

The system is a full-stack TypeScript application. The frontend utilizes React, Vite, TanStack Query for server state, `react-hook-form` with Zod for forms, and `wouter` for routing. The backend is an Express.js server providing a RESTful API, with Zod used for shared validation. Data is stored in PostgreSQL, accessed via the native `pg` driver and Drizzle ORM for type-safe queries and schema management, supporting multi-currency and Drizzle Kit for migrations.

Key features include:
-   **Multi-Tenancy**: Isolated data for multiple companies, shared global suppliers, and per-user page access control (replacing role-based permissions) with location-based authentication for POS users. ERP page access uses `erp_user_page_access` table (same pattern as factory's `factory_user_page_access`), managed via Settings → Page Access. Sidebar uses `/api/my-erp-pages` endpoint. Admin users always have full access.
-   **Inventory Management**: Comprehensive stock item tracking, multi-source location transfers, production/consumption adjustments with Drizzle ORM transactions for atomicity, accurate weighted average cost calculations, PO freight costing, and voucher-based inventory reversal. All inventory mutations are routed through a centralized `adjustInventory` helper with `SELECT FOR UPDATE` row-level locking and `INSERT ON CONFLICT` for race-free operations. An admin-only reconciliation endpoint detects inventory discrepancies.
-   **Financial Accounting**: Automatic voucher creation, auto-generation of ledger and employee codes, comprehensive account pages with filters, and accurate financial calculations for hierarchical accounts. Net Profit (P&L) report provides Tally Prime-style insights. Supports inter-company credit system for parent company supplier payments. Employee deposits are accounted for as indirect expenses.
-   **Location Management**: Creation of locations with optional linked CASH ledger accounts and management of orphaned records.
-   **Voucher System**: Supports all voucher types (Payment, Receipt, Journal, Stock Transfer, Production, Consumption) with an optional draft system for atomic inventory changes.
-   **Stock Transfer Order Enhancements**: Allows date selection, optional status, and multi-source transfers.
-   **Soft Delete System**: Implemented across key tables with admin UI for viewing, restoring, and permanently deleting items.
-   **AI Chatbot**: Multi-provider (Gemini, ChatGPT, Grok) chatbot with access to all ERP data, supporting natural language queries for stock items, sales history, suppliers, POs, and financial summaries.
-   **Purchase Order Enhancements**: POs include editable freight and charges factored into container offload costs and supplier balances.
-   **Net Position Calculation**: Pure sign-based calculation (Assets - Liabilities), including containers in transit as assets.
-   **Barcode Generation**: Backend API for server-side PNG barcode generation.
-   **Import Cycle Diagnostics**: Debug tool for identifying and fixing issues like negative inventory or unbalanced vouchers.
-   **Active Users Monitoring**: Admin-only feature displaying real-time logged-in users, grouped by company, with role, current page, and last active time.
-   **OTW Container Tracking**: TallyPrime-style interface for tracking containers in transit with automatic and manual fields, export to Excel, and optional API integration for ETA updates.
-   **Global Multi-Currency Switcher**: Allows users to toggle between USD and other display currencies (e.g., CFA) with preference persistence and real-time exchange rate conversion via a `formatAmount()` function.
-   **Factory Mode**: A dedicated factory production system isolated with its own database tables (`factory_*`), API namespace (`/api/factory/*`), and UI. It shares core accounting data with ERP mode but maintains isolated operational data (suppliers, containers, bales). Features include bulk import tools, multi-currency support for transactions and costing, a comprehensive daybook for all factory transactions, and a customer bale sales workflow including proformas, POS-style invoice creation, and invoice management. Bale costing flows from mix batches to individual bales. Stock entry supports inline quick-creation of new products (with category selection including "Garbage") and Excel import of historical bales with auto-product creation and duplicate barcode detection.
-   **ERP/Factory API Separation (Feb 2026)**: Frontend API layer is split between ERP and Factory modes. `client/src/lib/factoryApi.ts` provides a `factoryApiRequest` wrapper that guards against non-factory endpoint access (throws in dev mode). Factory-only pages (`Factory*.tsx`) import `factoryApiRequest` directly. Shared pages use `useAppMode()` context (from `AppModeContext.tsx`) + `getApiRequest(mode)` to automatically select the right API request function. The `AppModeProvider` wraps factory routes with `mode="factory"` and ERP routes with `mode="erp"` in `App.tsx`. Allowed shared prefixes (locations, barcode, auth, etc.) are whitelisted in `factoryApi.ts`.
-   **Auto FX Daily Snapshot**: Factory containers store FX rate snapshots at import and offload time. A `getOrFetchFxRateToUsd` helper checks local `factory_fx_rates` DB then falls back to Frankfurter external API, caching results per date/currency. Containers track `fxRateToUsdImport`, `fxRateToUsdOffload`, `fxRateSource` (auto/manual), and snapshot dates. FX is auto-pulled on container create, Excel import, and offload. UI shows read-only auto FX with manual toggle option. Supplier balances remain in their original currency; USD is a reference conversion only.
-   **User-to-User Chat**: Direct messaging system using `direct_messages` table with real-time polling, accessible from both ERP and Factory sidebars.
-   **Factory Worker Management**: Comprehensive worker profiles (`factory_workers` table) with identity, contact, employment, financial, and document fields. Worker CRUD with photo upload, contract end functionality, productivity stats tracking (bales, KG), and bale assignment history. Routes in `server/factoryWorkerRoutes.ts`.
-   **Factory Payroll System**: Payroll generation (`factory_payrolls` table) for factory workers with salary type support (Monthly/Daily/Per Bale/Per KG), overtime, bonuses, deductions, and advances. Payroll preview, adjustment, and approval workflow. PDF and Excel export using `pdfkit` and `exceljs`. Routes in `server/factoryPayrollRoutes.ts`.
-   **Supplier Usage Report**: Comprehensive PDF/Excel supplier usage reports computing opening balance, purchased KG, used KG, remaining, cost per KG, cost per bale, mixing breakdowns, and bale production data per supplier with date range filtering. Routes in `server/factoryReportRoutes.ts`.
-   **Supplier Proforma Verification (Feb 2026)**: ERP-side feature for comparing supplier proformas against actual container loaded items. Tables: `supplier_proformas`, `supplier_proforma_lines`, `supplier_container_loaded_items`. Routes in `server/supplierProformaRoutes.ts`. Supports CRUD for proformas/lines/loaded items, Excel import for both, and a verification-summary endpoint that categorizes items as Overloaded, Less Loaded, Not Requested, or Price Different. Excel export of verification results. Frontend pages: `SupplierProformas.tsx` (manage proformas per supplier) and `ContainerVerification.tsx` (compare proforma vs loaded items with 4 summary tables). All routes enforce multi-company data isolation.
-   **Factory Container Offload Charges (Feb 2026)**: Container offloading supports freight, other charges, commission (with selectable ledger account), and duty. Bale costing uses inclusive costPerKg = (base + freight + charges + commission + duty) / receivedKg. Duty supports NONE/PENDING/CONFIRMED status—pending duty is excluded from cost until confirmed via `PATCH /api/factory/containers/:id/confirm-duty`, which recalculates rawStock costPerKg. All duty confirmations are logged in `factory_duty_audit_log` with old/new values, user ID, and notes. Commission records in `factory_container_commissions` include optional `ledgerAccountId`.

### System Design Choices

The system employs shared schemas (`shared/schema.ts`) for type safety across the stack, path aliases for clean imports, and a clear separation of concerns with code organized into `/client`, `/server`, and `/shared`. It supports distinct development and production build targets and uses a comprehensive design system for UI consistency.

## External Dependencies

-   **AI/ML**: Google Gemini API
-   **UI Component Libraries**: Radix UI, Tailwind CSS, `shadcn/ui`, `class-variance-authority`, `clsx`, `cmdk`, `embla-carousel-react`, `recharts`, `date-fns`, `react-day-picker`.
-   **Database & Backend**: `pg` (node-postgres driver), `drizzle-orm`, `connect-pg-simple`.
-   **Form Handling**: `react-hook-form`, `@hookform/resolvers`, `zod`, `drizzle-zod`.
-   **Build Tools**: Vite, `esbuild`, PostCSS with Autoprefixer.