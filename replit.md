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