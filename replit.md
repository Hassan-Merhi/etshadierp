# ERP POS System

## Overview

This is a comprehensive ERP (Enterprise Resource Planning) and POS (Point of Sale) system designed for multi-company warehouse management. The application handles inventory tracking across multiple locations, purchase order management, container tracking, financial accounting, and reporting. Built as a full-stack TypeScript application, it targets businesses that manage bulk inventory (like textile bales) with complex supply chain requirements including international container shipments.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React with TypeScript, built using Vite for development and bundling.

**UI Component System**: The application implements the shadcn/ui design system (New York style variant) built on Radix UI primitives and styled with Tailwind CSS. This provides:
- A comprehensive set of pre-built, accessible components
- Consistent styling through CSS variables supporting light/dark themes
- Type-safe component APIs with full TypeScript support

**Design Philosophy**: Following enterprise UI principles emphasizing clarity over decoration, efficiency-first interactions, and scannable layouts for data-heavy interfaces. Typography uses Inter for general UI and JetBrains Mono for numerical/code displays.

**State Management**: 
- TanStack Query (React Query) for server state management with configured defaults for infinite stale time and disabled refetching
- React hooks and context for local UI state (theme, sidebar state, location selection)
- LocationContext: Global context managing the currently selected location across the app
- Form state managed through react-hook-form with Zod validation

**Routing**: wouter library for lightweight client-side routing

**Key Pages**:
- Dashboard: KPI cards and charts for business overview
- Location Inventory: Central hub for location selection with hierarchical drill-down (Locations → Stock Groups → Stock Items). Features spreadsheet-style table view with keyboard navigation for stock items. Used to select working location for POS and other modules.
- POS: Point-of-sale interface with barcode scanning. Requires location selection via Location Inventory page. Displays current location with option to change.
- Inventory: Stock management across locations
- Containers: Import tracking and management
- Financial: Voucher and expense management
- Reports: Analytics and downloadable reports
- Accounting Create: Multi-entity form for creating master data

### Backend Architecture

**Framework**: Express.js server with TypeScript

**API Design**: RESTful endpoints organized by resource type (locations, ledger accounts, employees, suppliers, stock items, bank accounts, fixed assets)

**Validation**: Zod schemas shared between frontend and backend for request/response validation

**Development Server**: Custom Vite integration in development mode with HMR support through middleware mode

**Production Build**: Uses esbuild to bundle the server code, with separate Vite build for client assets

### Data Storage

**Database**: PostgreSQL accessed through Neon serverless driver with WebSocket support

**ORM**: Drizzle ORM providing:
- Type-safe database queries
- Schema-first approach with migrations
- Automatic TypeScript type generation from schema
- Integration with Zod for validation through drizzle-zod

**Schema Structure**: Comprehensive database schema including:
- Users (authentication)
- Locations (warehouses/branches)
- Ledger accounts (chart of accounts with hierarchical structure)
- Employees, Suppliers
- Stock groups and items (inventory hierarchy)
- Bank accounts, Fixed assets
- Purchase orders with voucher linkage for accounting integration
- Vouchers and voucher entries for double-entry bookkeeping
- Support for multi-currency, opening balances, and active/inactive states

**Migration Strategy**: Drizzle Kit manages schema migrations with `db:push` command for schema synchronization

### External Dependencies

**UI Component Libraries**:
- Radix UI: Comprehensive set of unstyled, accessible component primitives
- Tailwind CSS: Utility-first CSS framework with custom theme configuration
- class-variance-authority & clsx: Dynamic className composition
- cmdk: Command palette component
- embla-carousel-react: Touch-friendly carousel
- recharts: Charting library for data visualization
- date-fns: Date manipulation and formatting
- react-day-picker: Calendar/date picker component

**Database & Backend**:
- @neondatabase/serverless: Serverless PostgreSQL driver with WebSocket support
- drizzle-orm: Type-safe ORM
- connect-pg-simple: PostgreSQL session store for Express

**Form Handling**:
- react-hook-form: Performant form library
- @hookform/resolvers: Validation resolvers
- zod & drizzle-zod: Schema validation and type safety

**Development Tools**:
- Replit-specific plugins: Runtime error modal, cartographer, dev banner
- tsx: TypeScript execution for development
- WebSocket (ws): Required for Neon serverless connection

**Build Tools**:
- Vite: Frontend build tool and dev server
- esbuild: Backend bundler
- PostCSS with Autoprefixer: CSS processing

**Key Architectural Decisions**:
- Shared schema definitions between frontend and backend via `shared/schema.ts` ensures type safety across the stack
- Path aliases configured in both TypeScript and Vite for clean imports (`@/`, `@shared/`, `@assets/`)
- Separation of concerns: client code in `/client`, server code in `/server`, shared types in `/shared`
- Environment-based configuration with development and production build targets
- Design system approach with comprehensive typography scale and spacing primitives documented in design guidelines

## Recent Changes (October 2025)

### Database Connection Management (October 30, 2025)
- **Critical Issue - Database Connectivity**: The application cannot connect to the Neon database. All queries timeout after 3 seconds regardless of connection method.
  - **Investigation Summary**:
    - Attempted WebSocket connection with ws library: Connection established but queries hang indefinitely
    - Attempted WebSocket without ws library: Same timeout behavior
    - Attempted HTTP mode using neon() function: Same timeout behavior  
    - Attempted removing `sslmode=require` parameter: Same timeout behavior
    - Attempted using pooler endpoint: DATABASE_URL doesn't include pooler
    - Health check consistently times out: `SELECT 1` query never completes
  - **Current Configuration**: Using HTTP-based Neon driver (`drizzle-orm/neon-http` with `neon()` function)
    - Connection string sanitized to remove incompatible SSL parameters
    - No WebSocket configuration (following best practices for Replit)
  - **Root Cause**: DATABASE_URL appears to point to an inaccessible or deprovisioned database instance
  - **Next Steps**: Database needs to be reprovisioned or DATABASE_URL needs to be updated with a working endpoint

### Stock Item Enhancements (October 30, 2025)
- **Stock Group Assignment**: Stock items can now be immediately assigned to stock groups during creation
  - Manual creation form (Accounting Create page) includes stock group dropdown
  - Bulk import (Import Stock Items) supports stock group assignment via stockGroupCode column in Excel
  - Template updated to include barcode and stockGroupCode examples
  - Import logic automatically maps stock group codes to IDs before creating items
- **Import Template Updates**: Excel template now includes columns for barcode and stock group code
  - Preview table shows all imported fields including stock group assignment
  - Optional fields (barcode, stockGroupCode) only included in payload when provided
  - Schema-compliant validation ensures clean imports

### Multi-Company Support (October 29, 2025)
- **Complete Multi-Tenancy Architecture**: Full support for managing multiple companies within a single instance
  - New `companies` table for company management
  - `user_company_roles` junction table for assigning different roles to users across companies
  - Users can have different roles (Admin, Owner, Manager, POS 1-6) in different companies
  - Session-based company selection with company switcher in header
- **Data Isolation**: All business data is scoped by company
  - Locations, inventory, vouchers, ledger accounts, bank accounts, purchase orders, containers all filtered by companyId
  - Each company maintains isolated financial records and inventory
  - **Exception**: Suppliers are GLOBAL entities shared across all companies with aggregate balances
- **Company Context**: React context provider manages currently selected company throughout the app
  - Automatic query invalidation when switching companies
  - Company selector in header for switching between companies
- **Role-Based Access Control**:
  - Admin users can create/manage companies and assign user roles
  - POS users restricted to specific location AND company (requires re-login when switching companies)
  - Location-based authentication ensures POS users can only access locations in their current company
- **Enhanced Security**:
  - All location and inventory endpoints now require authentication
  - Company verification on all data access endpoints (returns 403 if accessing another company's data)
  - POS page shows user-friendly error messages when location access is denied
- **User Management**:
  - Multi-company role assignment interface in Settings
  - Can assign users to multiple companies with different roles/locations per company
  - Real-time cache invalidation for role assignments
- **Location Management**:
  - Location creation includes optional cash account auto-creation
  - Creates CASH ledger account (Asset type) and links to bank account with code {locationCode}-CASH
  - Reuses existing CASH ledger if available, regardless of account type classification
- **Supplier Management**:
  - Clickable supplier names show transaction dialog
  - Transactions filtered by currently selected company
  - Supplier balances aggregate across all companies globally
  - Transaction dialog shows company-specific voucher entries with totals

### Purchase Order Accounting Integration
- **Automatic Voucher Creation**: When importing POs via containers, the system now automatically creates accounting vouchers following double-entry bookkeeping principles
  - Debit entry: PURCHASES ledger account (expense increases)
  - Credit entry: Supplier account (accounts payable increases)
- **Supplier Balance Tracking**: PO amounts now correctly appear in supplier account balances, making it easy to track what you owe each supplier
- **Auto-Account Creation**: System automatically creates a "PURCHASES" ledger account (code: PURCHASES, type: Expense) if it doesn't exist when importing the first PO
- **Purchase Order-Voucher Linkage**: Added `voucherId` field to purchase_orders table to maintain referential integrity between POs and their accounting entries
- **Backfill Support**: Created `/api/po-import/backfill` endpoint to retroactively create voucher entries for existing POs imported before this feature was implemented

### Enhanced Transaction Filtering
- **Month/Year Selector**: Accounts page now includes dropdown selectors to easily filter transactions by month and year
  - Generates options from January 2024 through current month
  - Automatically converts selected month/year to proper date range filters
  - Works across all account types: Ledger, Bank, Fixed Asset, and Supplier accounts
- **Improved UX**: Users can still use custom date ranges if needed, with a clear button to reset all filters at once

### Container Offload Accounting Integration (October 30, 2025)
- **Ledger Account Selection**: When offloading containers, users can select specific ledger accounts for duties, office charges, and transport fees
  - Supports dedicated accounts like "Duty Agent Payable", "Office Charges Payable", or "Transporter Payable"
  - Office charges field includes amount input and required account dropdown (disabled when amount is 0)
  - Flexible additional charges section allows custom line items with description, amount, and ledger account selection
- **Balanced Double-Entry Vouchers**: All offload charges create proper accounting vouchers
  - Debit entry: IMPORT_CHARGES ledger account (expense increases) - auto-created if needed
  - Credit entry: Selected ledger account (liability increases)
  - Each voucher is balanced with equal debit and credit amounts
- **Comprehensive Cost Tracking**: All import-related costs (duties, office charges, transport, additional charges) are properly tracked in the accounting system
  - Each charge type creates a separate voucher for clear audit trail (DUTY-*, OFFICE-*, TRANS-* voucher numbers)
  - Costs are added to inventory valuation through additional cost per bale calculation
- **Consistent Pattern**: Office charges now follow the exact same pattern as duties and transport fees with dedicated account selection and voucher creation

### Technical Implementation Notes
- **Double-Entry Compliance**: All vouchers created by PO import and container offload are properly balanced with equal debit and credit amounts
- **Idempotency**: Backfill endpoint checks for existing voucherIds to prevent duplicate processing
- **Storage Extensions**: Added getAllPurchaseOrders and updatePurchaseOrder methods to support backfill workflow