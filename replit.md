# ERP POS System

## Overview

This is a comprehensive ERP (Enterprise Resource Planning) and POS (Point of Sale) system for multi-company warehouse management. It handles inventory tracking across multiple locations, purchase order management, container tracking, financial accounting, and reporting. Built as a full-stack TypeScript application, it targets businesses managing bulk inventory with complex supply chain requirements, including international container shipments. Its primary purpose is to streamline operations and provide robust financial oversight for multi-entity businesses.

**Deployment**: Configured for Render cloud hosting at $14/month (Web Service: $7 + PostgreSQL: $7) with automatic deployments from GitHub.

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
- **Inventory Management**: Stock items use a single `code` field for item codes and barcode scanning. Stock items can be assigned to stock groups during creation or import.
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