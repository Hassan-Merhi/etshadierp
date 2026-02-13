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
-   **Multi-Tenancy**: Isolated data for multiple companies, shared global suppliers, and role-based access control with location-based authentication for POS users.
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
-   **Factory Mode**: A dedicated factory production system isolated with its own database tables (`factory_*`), API namespace (`/api/factory/*`), and UI. It shares core accounting data with ERP mode but maintains isolated operational data (suppliers, containers, bales). Features include bulk import tools, multi-currency support for transactions and costing, a comprehensive daybook for all factory transactions, and a customer bale sales workflow including proformas, POS-style invoice creation, and invoice management. Bale costing flows from mix batches to individual bales.

### System Design Choices

The system employs shared schemas (`shared/schema.ts`) for type safety across the stack, path aliases for clean imports, and a clear separation of concerns with code organized into `/client`, `/server`, and `/shared`. It supports distinct development and production build targets and uses a comprehensive design system for UI consistency.

## External Dependencies

-   **AI/ML**: Google Gemini API
-   **UI Component Libraries**: Radix UI, Tailwind CSS, `shadcn/ui`, `class-variance-authority`, `clsx`, `cmdk`, `embla-carousel-react`, `recharts`, `date-fns`, `react-day-picker`.
-   **Database & Backend**: `pg` (node-postgres driver), `drizzle-orm`, `connect-pg-simple`.
-   **Form Handling**: `react-hook-form`, `@hookform/resolvers`, `zod`, `drizzle-zod`.
-   **Build Tools**: Vite, `esbuild`, PostCSS with Autoprefixer.