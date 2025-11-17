# ERP POS System

## Overview

This is a comprehensive ERP (Enterprise Resource Planning) and POS (Point of Sale) system for multi-company warehouse management. It handles inventory tracking across multiple locations, purchase order management, container tracking, financial accounting, and reporting. Built as a full-stack TypeScript application, it targets businesses managing bulk inventory with complex supply chain requirements, including international container shipments. Its primary purpose is to streamline operations and provide robust financial oversight for multi-entity businesses.

**Deployment**: Configured for Render cloud hosting at $14/month (Web Service: $7 + PostgreSQL: $7) with automatic deployments from GitHub.

## Recent Changes (November 2025)

### Database Schema Fixes
- **Multi-Company Ledger Account Support**: Fixed critical database constraint bug where ledger account codes were globally unique across all companies. Changed to composite unique constraint on `(companyId, code)`, allowing each company to have its own standard accounts (PURCHASES, IMPORT_CHARGES, SALES_REV, COGS).
  - This fix resolves the "duplicate key value violates unique constraint" error when multiple companies tried to create standard accounts
  - Applied database migration successfully to production

### Financial Improvements
- **Fixed Financial Totals Calculation**: Corrected total calculations in Analytics and Financial Dashboard to properly handle hierarchical parent-child account relationships. The system now sums only leaf accounts (children) to avoid double-counting when both parent and child accounts exist. Additionally fixed orphaned account handling - accounts whose parent chain is filtered out are now excluded from totals, preventing silent over-counting in all sections (Liabilities, Assets, Expenses, Income).
- **Fixed Net Profit & Sales Trend Consistency**: Both Net Profit card and Sales & Profit Trend chart now use identical inventory cost exclusion logic with normalized code matching (handles "Transport Charges" vs "TRANSPORT_CHARGES"). Both exclude PURCHASES, DUTIES, TRANSPORT_CHARGES, CONTAINER_LICENSES from operating expenses as these costs are capitalized to inventory until sold.
- **Fixed Expense Account Recognition in Net Profit**: Resolved critical bug where expense payments weren't being counted in net profit calculations. The system now recognizes expense accounts in both correct format (accountType="Expense" with subType="Indirect Expense"/"Direct Expense") and legacy format (accountType="Indirect Expense"/"Direct Expense"). This fix applies to:
  - `/api/stats/net-profit` endpoint (Dashboard)
  - `/api/stats/monthly-data` endpoint (Sales & Profit Trend)
  - Analytics page P&L calculations
  - All expense filtering throughout the application
- **Real-time Balance Updates**: All voucher types (Payment, Receipt, Journal) now properly invalidate account balance queries after creation, ensuring balances update immediately across the application.
- **Sales Accounting Integration**: POS imports now create proper accounting vouchers with SALES_REV (credit) and COGS (debit) entries for accurate profit tracking
- **Sales Backfill Script**: Added `/api/sales-import/backfill` endpoint to add accounting entries to existing sales data
  - Intelligently detects which sales vouchers are missing SALES_REV or COGS entries
  - Creates only the missing entries (idempotent - safe to re-run)
  - Uses database transactions for atomic operations
  - Auto-creates SALES_REV and COGS accounts if they don't exist
- **Customizable Dashboard Cash Tracking**: Added new "Cash in Hand" section to the main Dashboard:
  - Users can manually select which accounts (Ledger or Bank) to display
  - Automatically hides accounts with zero balance
  - Add/remove accounts using a simple dialog interface
  - Each account shows current balance in a dedicated card
  - Data persists per company in the `dashboard_cash_accounts` table

### UI/UX Improvements
- **Import Buttons Relocated**: Moved import functionality buttons from Dashboard sidebar to their respective pages for better context:
  - Import Stock Items button added to Stock Items page
  - Import PO button on Containers page
  - Import Sales button added to Point of Sale page (visible to non-POS users only)
- **Navigation Cleanup**: Removed standalone import pages and Analytics page from sidebar navigation to reduce clutter
- **Stock Query Enhancements**: 
  - Display all purchases and sales in table format (not just last transaction)
  - Include container numbers in purchase history
  - Removed Code and UOM columns from stock items list
  - Smart number formatting removes .00 from whole numbers while preserving full decimal precision
- **Voucher Form Simplification (November 12, 2025)**: Streamlined all voucher-related forms to improve usability:
  - **Removed codes from all dropdown displays**: Ledger accounts, bank accounts, suppliers, employees, fixed assets, locations, and stock items now show names only
  - **Alphabetical sorting**: All account/item dropdowns sorted alphabetically using `localeCompare()` for consistent A-Z ordering
  - **Affected pages**: Vouchers (Payment/Receipt/Journal/Transfer/Adjustment tabs), VoucherEdit, VoucherEditDialog, Daybook, AccountingCreate
  - **Components updated**: StockItemCombobox, AccountCombobox, LocationAutocomplete, StockItemAutocomplete, AccountAutocomplete
  - **Note**: Management tables (e.g., Stock Items page stock groups) intentionally retain codes for administrative search/filtering purposes
- **Receipt Voucher Design Update (November 17, 2025)**: Redesigned receipt voucher to match payment voucher layout:
  - Created dedicated `ReceiptVoucherTab` component with 60/40 layout (form left, sidebar right)
  - Plain text input fields auto-filter the account sidebar (no dropdowns)
  - Full keyboard navigation with arrow keys and Enter to select accounts
  - Real-time optimistic balance updates as amounts are entered
  - Removed duplicate old receipt tab code from Vouchers.tsx

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions

The frontend uses React with TypeScript and Vite. It implements the shadcn/ui design system (New York style) built on Radix UI primitives and styled with Tailwind CSS, emphasizing clarity, efficiency, and scannable layouts for data-heavy interfaces. Typography uses Inter and JetBrains Mono for numerical displays. The application supports light/dark themes.

### Technical Implementations

- **Frontend**:
    - **State Management**: TanStack Query for server state, React hooks/context for local UI state (theme, sidebar, location selection), `react-hook-form` with Zod for form state.
    - **Routing**: `wouter` for lightweight client-side routing.
    - **Key Pages**: Dashboard, Location Inventory (for selecting working location), POS, Inventory, Containers, Financial, Reports, Accounting Create.
- **Backend**:
    - **Framework**: Express.js server with TypeScript.
    - **API Design**: RESTful endpoints organized by resource type.
    - **Validation**: Zod schemas shared between frontend and backend.
    - **Development**: Custom Vite integration with HMR.
    - **Production**: `esbuild` for server bundling, Vite for client assets.
- **Data Storage**:
    - **Database**: PostgreSQL using native `pg` driver with connection pooling. Compatible with Render, Neon, and any standard PostgreSQL database.
    - **ORM**: Drizzle ORM for type-safe queries, schema-first approach, and Zod integration.
    - **Schema**: Comprehensive database schema including Users, Locations, Ledger accounts, Employees, Suppliers, Stock groups/items, Bank accounts, Fixed assets, Purchase orders, Vouchers, supporting multi-currency and opening balances.
    - **Migrations**: Drizzle Kit for schema migrations.
    - **Sessions**: PostgreSQL-backed sessions in production using `connect-pg-simple` with SSL support.

### Feature Specifications

- **Multi-Tenancy**: Full support for multiple companies with isolated data (locations, inventory, financials) and shared global suppliers. Users can have different roles across companies.
- **Inventory Management**: 
    - Stock items use a single `code` field for item codes and barcode scanning. Stock items can be assigned to stock groups during creation or import.
    - **Stock Transfers**: Multi-source location transfers wrapped in database transactions for atomic operations. Each item can be transferred from a different source location to a single destination, with automatic weighted average rate calculation.
    - **Stock Adjustments**: Production and consumption adjustments wrapped in transactions. Production adds inventory with weighted average costing; consumption reduces inventory maintaining current average rate.
    - All stock operations use Drizzle ORM transactions to ensure atomicity - either all inventory updates succeed or everything rolls back.
- **Financial Accounting**:
    - Automatic voucher creation for purchase orders (Debit: PURCHASES, Credit: Supplier).
    - Automatic voucher creation for container offload charges (duties, office, transport, additional) to specific ledger accounts (Debit: IMPORT_CHARGES, Credit: Payable accounts).
    - Auto-generation of `PURCHASES` and `IMPORT_CHARGES` ledger accounts if they don't exist.
    - Accounts page with month/year filters for transactions.
    - Auto-generated ledger account codes (e.g., SALREV, SALREV1).
    - Auto-generated employee codes (e.g., JOHDOE, JANSMI).
- **Location Management**: Location creation includes optional auto-creation of a linked CASH ledger account.
- **Supplier Management**: Suppliers are global entities; transactions are filtered by the selected company.
- **Role-Based Access Control**: Granular roles (Admin, Owner, Manager, POS 1-6) per company, with location-based authentication for POS users.

### System Design Choices

- **Shared Schemas**: `shared/schema.ts` for type safety across the stack.
- **Path Aliases**: Configured for clean imports (`@/`, `@shared/`, `@assets/`).
- **Separation of Concerns**: Client code in `/client`, server code in `/server`, shared types in `/shared`.
- **Environment Configuration**: Development and production build targets.
- **Design System**: Comprehensive typography and spacing primitives.

## External Dependencies

- **UI Component Libraries**: Radix UI, Tailwind CSS, `class-variance-authority`, `clsx`, `cmdk`, `embla-carousel-react`, `recharts`, `date-fns`, `react-day-picker`.
- **Database & Backend**: `pg` (node-postgres driver), `drizzle-orm`, `connect-pg-simple` (PostgreSQL session store with SSL).
- **Form Handling**: `react-hook-form`, `@hookform/resolvers`, `zod`, `drizzle-zod`.
- **Development Tools**: `tsx`, `ws` (for Neon connection), Replit-specific plugins.
- **Build Tools**: Vite, `esbuild`, PostCSS with Autoprefixer.