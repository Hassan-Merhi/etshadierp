# ERP POS System

## Overview

This project is a comprehensive ERP and POS system for multi-company warehouse management. It provides robust inventory tracking across multiple locations, streamlines purchase order management, enables container tracking, and offers full financial accounting and reporting capabilities. Built as a full-stack TypeScript application, its primary purpose is to optimize operations and provide strong financial oversight for businesses managing bulk inventory with complex supply chains, including international container shipments. The system supports multi-entity businesses with isolated data and includes an AI Chatbot powered by Google Gemini for intelligent assistance with ERP data.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions

The frontend uses React with TypeScript and Vite, implementing the shadcn/ui design system (New York style) built on Radix UI primitives and styled with Tailwind CSS. It prioritizes clarity and efficiency for data-intensive interfaces, using Inter and JetBrains Mono fonts, and supports light/dark themes.

### Technical Implementations

-   **Frontend**: React, TypeScript, Vite, TanStack Query for server state, React hooks/context for local UI state, `react-hook-form` with Zod for forms, and `wouter` for routing.
-   **Backend**: Express.js server with TypeScript, RESTful API design using Zod for shared validation.
-   **Data Storage**: PostgreSQL with the native `pg` driver and Drizzle ORM for type-safe queries and schema management. Supports multi-currency, opening balances, and Drizzle Kit for migrations.
-   **Multi-Tenancy**: Full support for multiple companies with isolated data (inventory, financials, locations) while allowing shared global suppliers. Role-based access control is implemented per company with location-based authentication for POS users.
-   **Inventory Management**: Stock items with unique codes, grouped for tracking. All stock operations, including multi-source location transfers, production/consumption adjustments, are wrapped in Drizzle ORM transactions to ensure atomicity and accurate weighted average cost calculations. Includes accurate PO freight costing and comprehensive voucher-based inventory reversal on deletion. Consumption amounts use actual inventory average cost.
-   **Financial Accounting**: Automatic voucher creation for purchase orders and container offload. Supports auto-generation of ledger and employee codes. Comprehensive account pages with filters, ensuring accurate financial calculations (e.g., net profit, sales trends) for hierarchical accounts, excluding draft vouchers. Net Profit (P&L) report provides Tally Prime-style insights. Opening balances are correctly signed. `IMPORT_CHARGES` and `PURCHASES` accounts are excluded from P&L calculations as they are capitalized into inventory.
-   **Location Management**: Supports creation of locations with optional linked CASH ledger accounts, preservation of location names on vouchers, and management of orphaned records.
-   **Voucher System**: Comprehensive support for all voucher types (Payment, Receipt, Journal, Stock Transfer, Production, Consumption) with an "optional" draft system that can atomically apply or reverse inventory changes.
-   **Stock Transfer Order Enhancements**: Allows date selection, optional status, and multi-source transfers where items from various locations can be consolidated into a single transfer voucher.
-   **Soft Delete System**: Implemented across key tables (`deletedAt` timestamp), with admin UI for viewing, restoring, and permanently deleting items.
-   **AI Chatbot**: Multi-provider AI chatbot (Gemini, ChatGPT, Grok) with comprehensive access to ALL ERP data. Features natural language queries like "show items with 'dress cream' in name" or "what was the last price this item sold at?" Includes complete stock items with inventory by location, full sales history with prices, all suppliers/customers, purchase orders, and financial summaries. Admin controls for provider selection with automatic fallback.
-   **Purchase Order Enhancements**: POs include editable freight and charges factored into container offload costs and supplier balances. Blocks stock item swaps on offloaded containers without prior reversal.
-   **Inter-Company Credit System**: Automated accounting where a configurable parent company pays all suppliers. Creates matching entries in subsidiary and parent books at PO import time, representing a liability for the subsidiary and a receivable for the parent.
-   **Net Position Calculation**: Pure sign-based calculation (Assets - Liabilities), including containers in transit (OTW) as assets. Suppliers are included only for the designated parent company; subsidiaries use a "[Parent] Credit" liability. Configurable parent company setting used for both Net Position and inter-company credit.
-   **Barcode Generation**: Backend API for server-side PNG barcode generation.
-   **Import Cycle Diagnostics**: Debug tool to identify and guide fixes for issues like negative inventory, orphaned inventory, unbalanced vouchers, stale OTW containers, and duplicate inventory records.
-   **Employee Deposit Accounting**: Employee deposits are accounted for as `PAYROLL_DEPOSIT_EXPENSE` (Indirect Expense), hitting Net Profit at deposit/payroll time. Withdrawals reduce liability without Net Profit impact. Employee opening balances are included in the implicit opening balance equity calculation.
-   **Active Users Monitoring**: Admin-only feature displaying logged-in users, grouped by company, with role, current page, and last active time, updated in real-time.
-   **OTW Container Tracking**: A TallyPrime-style interface for tracking containers in transit, including automatic fields from PO data and manual, inline-editable fields (e.g., shop name, ETA, transport fee). Supports export to Excel and optional API integration for automatic ETA updates.
-   **Global Multi-Currency Switcher**: For companies with a `displayCurrency` set (e.g., CFA), users can toggle between USD and CFA currencies. The preference persists across sessions via localStorage (for guests) and backend database (for logged-in users via `user_preferences.preferredCurrency`). All currency displays use a centralized `formatAmount()` function from `CurrencyContext` that handles exchange rate conversion at display time. Graceful fallback to USD with console warnings when exchange rates are missing.

-   **Inventory Transaction Safety**: All 11 critical stock-mutation endpoints are wrapped in `db.transaction()` blocks using the shared `adjustInventory` helper (`server/inventoryHelper.ts`) for atomic insert-or-update operations. Input validation guards reject NaN/invalid data before transactions execute. Voucher deletion atomically reverses inventory for Sales, Stock Transfers, and Adjustments. Zero `db.*` calls remain inside any `tx` block (verified by automated audit). Integration test suite (`tests/inventory.test.ts`) with 19 tests covers POS sales, stock transfers, quick adjustments, voucher deletions, input validation, and the `adjustInventory` helper.
-   **Inventory Reconciliation**: Admin-only `GET /api/inventory/reconcile` endpoint detects negative inventory, value mismatches (qty * rate vs totalValue), negative rates, zero-qty with non-zero value, and duplicate inventory records. Returns severity-categorized issues with a summary.

### System Design Choices

-   **Shared Schemas**: `shared/schema.ts` for type safety across the stack.
-   **Path Aliases**: For clean imports (`@/`, `@shared/`, `@assets/`).
-   **Separation of Concerns**: Code organized into `/client`, `/server`, and `/shared`.
-   **Environment Configuration**: Distinct development and production build targets.
-   **Design System**: Comprehensive typography and spacing primitives for UI consistency.

## External Dependencies

-   **AI/ML**: Google Gemini API
-   **UI Component Libraries**: Radix UI, Tailwind CSS, `shadcn/ui`, `class-variance-authority`, `clsx`, `cmdk`, `embla-carousel-react`, `recharts`, `date-fns`, `react-day-picker`.
-   **Database & Backend**: `pg` (node-postgres driver), `drizzle-orm`, `connect-pg-simple`.
-   **Form Handling**: `react-hook-form`, `@hookform/resolvers`, `zod`, `drizzle-zod`.
-   **Build Tools**: Vite, `esbuild`, PostCSS with Autoprefixer.