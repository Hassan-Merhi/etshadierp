# ERP POS System

## Recent Changes (Nov 24, 2025)

- **Added Stock Transfer for POS**: POS users can now transfer stock between locations via `/stock-transfer` page
  - Shows only item names and quantities (cost prices hidden)
  - Automatically updates inventory at source and destination
  - Creates vouchers for accounting records
  - API endpoints: GET/POST `/api/stock-transfers`, GET `/api/inventory-by-location/:id`
- **Fixed Configured Selling Price**: Sales reports now use the configured selling price from stock items when available. If a stock item has a configured price, sales will use that price instead of the manually entered rate.
- **Fixed Error Handler**: Removed `throw err` from Express error handler to prevent process crashes
- **Fixed Barcode Generation**: Moved barcode generation from frontend (bwip-js) to backend API endpoint (`/api/generate-barcode`) to fix production builds
- **Added Barcode API**: New `/api/generate-barcode` POST endpoint generates PNG barcodes server-side for printing

## Overview

This project is a comprehensive ERP and POS system designed for multi-company warehouse management. It provides robust inventory tracking across multiple locations, streamlines purchase order management, enables container tracking, and offers full financial accounting and reporting capabilities. Built as a full-stack TypeScript application, its primary purpose is to optimize operations and provide strong financial oversight for businesses managing bulk inventory with complex supply chains, including international container shipments. The system is designed to support multi-entity businesses by ensuring isolated data for each company while providing a unified platform.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions

The frontend utilizes React with TypeScript and Vite, implementing the shadcn/ui design system (New York style) built on Radix UI primitives and styled with Tailwind CSS. This combination prioritizes clarity, efficiency, and scannable layouts essential for data-intensive interfaces. Typography features Inter and JetBrains Mono for numerical displays, and the application supports both light and dark themes.

### Technical Implementations

-   **Frontend**: Built with React, TypeScript, and Vite. State management relies on TanStack Query for server state, React hooks/context for local UI state (theme, sidebar, location selection), and `react-hook-form` with Zod for form management. Routing is handled by `wouter`.
-   **Backend**: An Express.js server developed with TypeScript. It features RESTful API design with Zod for shared validation schemas between frontend and backend. Development uses a custom Vite integration with HMR, while production builds utilize `esbuild` for the server and Vite for client assets.
-   **Data Storage**: PostgreSQL is the chosen database, utilizing the native `pg` driver with connection pooling. Drizzle ORM provides type-safe queries and a schema-first approach, integrated with Zod. The database schema supports users, locations, ledger accounts, employees, suppliers, stock items/groups, bank accounts, fixed assets, purchase orders, and vouchers, including multi-currency and opening balance features. Drizzle Kit is used for schema migrations. Production sessions are managed via `connect-pg-simple` with PostgreSQL-backed storage and SSL.
-   **Multi-Tenancy**: The system fully supports multiple companies with isolated data for inventory, financials, and locations, while allowing shared global suppliers. Users can have different roles across companies.
-   **Inventory Management**: Stock items are identified by a single `code` for item codes and barcode scanning, and can be assigned to stock groups. All stock operations, including multi-source location transfers and production/consumption adjustments, are wrapped in Drizzle ORM transactions to ensure atomicity and maintain accurate weighted average cost calculations.
-   **Financial Accounting**: Includes automatic voucher creation for purchase orders and container offload charges. It handles auto-generation of ledger account codes (e.g., `PURCHASES`, `IMPORT_CHARGES`) and employee codes. The system supports comprehensive account pages with filters, ensuring all financial calculations (e.g., net profit, sales trends, balances) correctly handle hierarchical accounts and exclude optional (draft) vouchers.
-   **Location Management**: Supports location creation with optional auto-creation of linked CASH ledger accounts.
-   **Supplier Management**: Suppliers are global entities, with transactions filtered by the selected company.
-   **Role-Based Access Control**: Granular roles (Admin, Owner, Manager, POS 1-6) are implemented per company, with location-based authentication for POS users.
-   **Voucher System**: Comprehensive support for creating, editing, and managing all voucher types (Payment, Receipt, Journal, Stock Transfer, Production, Consumption). An "optional" voucher system allows for drafts/templates that are excluded from all inventory movements and financial calculations, with a toggle mechanism that atomically applies or reverses inventory changes.

### System Design Choices

-   **Shared Schemas**: `shared/schema.ts` ensures type safety across the entire stack.
-   **Path Aliases**: Configured for clean imports (`@/`, `@shared/`, `@assets/`).
-   **Separation of Concerns**: Codebase is organized with client-side code in `/client`, server-side code in `/server`, and shared types in `/shared`.
-   **Environment Configuration**: Supports distinct development and production build targets.
-   **Design System**: Features comprehensive typography and spacing primitives for consistent UI.

## External Dependencies

-   **UI Component Libraries**: Radix UI, Tailwind CSS, `shadcn/ui`, `class-variance-authority`, `clsx`, `cmdk`, `embla-carousel-react`, `recharts`, `date-fns`, `react-day-picker`.
-   **Database & Backend**: `pg` (node-postgres driver), `drizzle-orm`, `connect-pg-simple` (PostgreSQL session store with SSL).
-   **Form Handling**: `react-hook-form`, `@hookform/resolvers`, `zod`, `drizzle-zod`.
-   **Build Tools**: Vite, `esbuild`, PostCSS with Autoprefixer.