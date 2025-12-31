# ERP POS System

## Overview

This project is a comprehensive ERP and POS system designed for multi-company warehouse management. It provides robust inventory tracking across multiple locations, streamlines purchase order management, enables container tracking, and offers full financial accounting and reporting capabilities. Built as a full-stack TypeScript application, its primary purpose is to optimize operations and provide strong financial oversight for businesses managing bulk inventory with complex supply chains, including international container shipments. The system is designed to support multi-entity businesses by ensuring isolated data for each company while providing a unified platform. It now includes an AI Chatbot powered by Google Gemini for intelligent assistance with ERP data.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions

The frontend utilizes React with TypeScript and Vite, implementing the shadcn/ui design system (New York style) built on Radix UI primitives and styled with Tailwind CSS. This combination prioritizes clarity, efficiency, and scannable layouts essential for data-intensive interfaces. Typography features Inter and JetBrains Mono for numerical displays, and the application supports both light and dark themes.

### Technical Implementations

-   **Frontend**: Built with React, TypeScript, and Vite. State management relies on TanStack Query for server state, React hooks/context for local UI state, and `react-hook-form` with Zod for form management. Routing is handled by `wouter`.
-   **Backend**: An Express.js server developed with TypeScript. It features RESTful API design with Zod for shared validation schemas. Development uses a custom Vite integration with HMR, while production builds utilize `esbuild` for the server and Vite for client assets.
-   **Data Storage**: PostgreSQL is the chosen database, utilizing the native `pg` driver with connection pooling. Drizzle ORM provides type-safe queries and a schema-first approach, integrated with Zod. The database schema supports users, locations, ledger accounts, employees, suppliers, stock items/groups, bank accounts, fixed assets, purchase orders, and vouchers, including multi-currency and opening balance features. Drizzle Kit is used for schema migrations. Production sessions are managed via `connect-pg-simple` with PostgreSQL-backed storage and SSL.
-   **Multi-Tenancy**: The system fully supports multiple companies with isolated data for inventory, financials, and locations, while allowing shared global suppliers. Users can have different roles across companies.
-   **Inventory Management**: Stock items are identified by a single `code` and can be assigned to stock groups. All stock operations, including multi-source location transfers and production/consumption adjustments, are wrapped in Drizzle ORM transactions to ensure atomicity and maintain accurate weighted average cost calculations. Recent updates include accurate PO freight costing and comprehensive voucher-based inventory reversal on deletion. **Stock Adjustments**: Production/Consumption/Mixed vouchers now create balancing voucher entries to maintain import cycle balance: Production items credit PRODUCTION_ADJUSTMENT (Liability), consumption items debit CONSUMPTION_EXPENSE (Indirect Expense). Consumption amounts use actual inventory average cost (not user-provided rate) for accurate tracking.
-   **Financial Accounting**: Includes automatic voucher creation for purchase orders and container offload charges. It handles auto-generation of ledger account codes and employee codes. The system supports comprehensive account pages with filters, ensuring all financial calculations (e.g., net profit, sales trends, balances) correctly handle hierarchical accounts and exclude optional (draft) vouchers. A Net Profit (P&L) report provides Tally Prime-style insights. Opening balances for ledger accounts are now correctly signed based on `openingBalanceSide` (Dr/Cr) and account type (asset/liability). The Import Cycle Balance calculation uses IMPORT_CHARGES parent account for isolated expense tracking, and properly handles both consumption (expense on inventory reduction) and production (offset on inventory increase) to maintain balance at $0. **Critical**: IMPORT_CHARGES accounts are excluded from all net profit/P&L calculations - these import costs (freight, duties, clearing) are product costs that get capitalized into inventory and only hit P&L through COGS when goods are sold.
-   **Location Management**: Supports location creation with optional auto-creation of linked CASH ledger accounts. It includes mechanisms for preserving location names on vouchers and managing orphaned records after location deletion.
-   **Supplier Management**: Suppliers are global entities, with transactions filtered by the selected company. Note: Supplier opening balances are currently global and not company-scoped. A future enhancement is needed to add per-company supplier opening balances for accurate multi-company balance reporting.
-   **Role-Based Access Control**: Granular roles (Admin, Owner, Manager, POS 1-6) are implemented per company, with location-based authentication for POS users.
-   **Voucher System**: Comprehensive support for creating, editing, and managing all voucher types (Payment, Receipt, Journal, Stock Transfer, Production, Consumption). An "optional" voucher system allows for drafts/templates that are excluded from all inventory movements and financial calculations, with a toggle mechanism that atomically applies or reverses inventory changes.
-   **Soft Delete System**: Implemented across key tables (locations, ledger accounts, stock items, suppliers, employees, customers, bank accounts) with a `deletedAt` timestamp. Includes admin-only UI for viewing, restoring, and permanently deleting items.
-   **AI Chatbot**: Integrated Google Gemini for ERP context-aware responses. Features multi-language support, real-time chat with history, and admin controls for user access and chat history viewing.
-   **Purchase Order Enhancements**: POs now include editable freight and other charges, which are correctly factored into container offload inventory costs and supplier account balances. **Critical Fix (Dec 2025)**: PO import voucher entries now correctly use company-specific Purchases ledger accounts. Previously, entries were incorrectly posting to a single Purchases account regardless of company, causing inflated balances. Existing data was corrected via SQL migration. **Stock Item Swap Prevention (Dec 2025)**: Editing stock items on offloaded containers is now blocked with a clear error message - users must first reverse the offload, edit the PO, then re-offload.
-   **Inter-Company Credit System (Dec 2025)**: Automated inter-company accounting where a configurable parent company pays all suppliers. When a PO is imported to a subsidiary company:
    - **In subsidiary books**: DR Purchases, CR [Parent] Credit (liability - we owe parent company)
    - **In parent company books**: DR [Subsidiary] Credit (receivable), CR Supplier (payable)
    This creates matching entries in both companies' books at PO import time (not offload). A "Fix Old PO Credits" button in Settings handles existing POs by creating transfer vouchers. **Updated Dec 2025**: Parent company is now configurable via system settings (not hardcoded), voucher numbering uses `INTERCO-PARENT-*` format, and all account names dynamically reflect the configured parent company name.
-   **Net Position with Parent Company Setting (Dec 2025)**: Pure sign-based Net Position calculation:
    - **Formula**: Net Position = Sum(positive balances) - Sum(negative balances) = Assets - Liabilities
    - **Sign-based logic**: Positive balance = Asset (what we have), Negative balance = Liability (what we owe)
    - **Suppliers**: Only included for designated parent company (pays all suppliers). Subsidiaries use "[Parent] Credit" liability instead
    - **Parent Company Setting**: Stored in global `system_settings` table, Admin-only access in Settings > System Tools. This setting is used for both Net Position calculations AND inter-company credit accounting.
    - **Stock OTW**: Containers in transit (OTW status) are included as assets in Net Position - this correctly balances the Parent Credit liability created when a subsidiary imports a PO
    - **Dashboard**: Shows breakdown of Assets vs Liabilities with Net Position calculation
-   **Barcode Generation**: Backend API for server-side PNG barcode generation.
-   **Import Cycle Diagnostics (Dec 2025)**: Debug tool at `/import-cycle-diagnostics` to identify issues causing import cycle imbalance. Detects: negative inventory, orphaned inventory at deleted locations, unbalanced vouchers (debits ≠ credits), stale OTW containers (>90 days), and duplicate inventory records. Provides severity levels, impact amounts, and fix guidance for each issue.
-   **P&L Accounting for Imports (Dec 2025)**: PURCHASES accounts are excluded from all P&L/expense calculations because:
    - Purchases represent inventory cost (asset), not operating expense
    - Cost only hits P&L when goods are sold (as COGS - Cost of Goods Sold)
    - This is consistent with how IMPORT_CHARGES accounts are handled
    - Result: Net Profit stays $0 when you have stock OTW balanced by a liability
-   **Employee Deposit Accounting (Dec 2025)**: Employee deposits now correctly use PAYROLL_LIABILITIES (Liability) instead of SALARY_EXPENSE (Expense). This is correct because:
    - Employee deposits represent earned wages that employees choose to leave with the company
    - The salary expense was already recorded during payroll
    - The deposit just moves liability from "wages owed" to "deposits held for employee"
    - Result: Employee deposits no longer affect Net Profit (previously they incorrectly reduced it)
-   **Known Limitations**: 
    -   Reverse offload may show small value discrepancies due to weighted average rate calculations - the math is correct but not perfectly reversible when other transactions occurred between offload and reversal.
    -   Consumption vouchers require existing inventory - they cannot be created for items that don't exist at the specified location (this is intentional to prevent import cycle imbalances from using user-input rates instead of actual inventory rates).

### System Design Choices

-   **Shared Schemas**: `shared/schema.ts` ensures type safety across the entire stack.
-   **Path Aliases**: Configured for clean imports (`@/`, `@shared/`, `@assets/`).
-   **Separation of Concerns**: Codebase is organized with client-side code in `/client`, server-side code in `/server`, and shared types in `/shared`.
-   **Environment Configuration**: Supports distinct development and production build targets.
-   **Design System**: Features comprehensive typography and spacing primitives for consistent UI.

## External Dependencies

-   **AI/ML**: Google Gemini API
-   **UI Component Libraries**: Radix UI, Tailwind CSS, `shadcn/ui`, `class-variance-authority`, `clsx`, `cmdk`, `embla-carousel-react`, `recharts`, `date-fns`, `react-day-picker`.
-   **Database & Backend**: `pg` (node-postgres driver), `drizzle-orm`, `connect-pg-simple` (PostgreSQL session store with SSL).
-   **Form Handling**: `react-hook-form`, `@hookform/resolvers`, `zod`, `drizzle-zod`.
-   **Build Tools**: Vite, `esbuild`, PostCSS with Autoprefixer.