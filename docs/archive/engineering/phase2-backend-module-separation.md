# Phase 2 — Backend Module Separation

## Goal

Keep Express route files focused on HTTP transport while moving request parsing, authorization context, business rules, SQL/query work, persistence, and audit behavior into explicit domain modules.

This phase does not change public URLs, accounting entry direction, inventory costing, container lifecycle semantics, or response contracts.

## Public composition roots

The following files are composition-only entry points:

- `server/routes.ts`
- `server/routes/authRoutes.ts`
- `server/routes/customerRoutes.ts`
- `server/routes/inventoryRoutes.ts`
- `server/routes/reportsRoutes.ts`
- `server/routes/supplierRoutes.ts`
- existing voucher, container, ledger, POS, factory, and rental registries

New business logic must not be added directly to `server/routes.ts`.

## Domain ownership

### Suppliers

- `supplierRoutes.ts`: HTTP methods, status codes, response shapes
- `suppliers/supplierRequestContext.ts`: active-company and actor resolution
- `suppliers/supplierValidation.ts`: create/update/stock-group parsing
- `suppliers/supplierService.ts`: codes, balances, CRUD, audit behavior
- `suppliers/supplierRepository.ts`: storage and Drizzle access
- `suppliers/supplierErrors.ts`: domain-to-HTTP error contract

### Inventory

- `inventoryRoutes.ts`: composition
- `inventory/inventoryListRoutes.ts`: paginated read adapter
- `inventory/inventoryQueryService.ts`: SQL list and combined-profile queries
- `inventory/inventoryQuickAdjustRoutes.ts`: write adapter
- `inventory/inventoryQuickAdjustService.ts`: ownership, supplier-partner guard, transaction, audit
- `inventory/inventoryRequestContext.ts`: request parsing
- `inventory/inventoryErrors.ts`: domain errors

### Customers

- `customerRoutes.ts`: composition
- `customers/customerMasterRoutes.ts`: customer HTTP adapters
- `customers/customerService.ts`: CRUD, code generation, ledger synchronization, audit
- `customers/customerBalanceQuery.ts`: batched transaction-currency and historical-base balances
- `customers/customerRequestContext.ts`: company, ID, and audit actor resolution
- `customers/customerErrors.ts`: domain errors

### Container sales

- `containers/containerSalesRoutes.ts`: HTTP adapter
- `containers/containerSalesService.ts`: ownership checks, commission account resolution, one-transaction voucher/sale/SOLD update

### Company transfers

- `transfers/companyTransferRoutes.ts`: HTTP adapters
- `transfers/interCompanyTransferService.ts`: IC account and paired-voucher workflow
- `transfers/simpleCompanyTransferService.ts`: clearing-account workflow and undo
- `transfers/transferRepository.ts`: voucher, entry, transfer, account, and query persistence
- `transfers/transferRequestContext.ts`: user/company authorization context
- `transfers/transferValidation.ts`: request schemas and IDs
- `transfers/transferErrors.ts`: domain errors

### Authentication sessions

- `authRoutes.ts`: composition
- `auth/sessionRoutes.ts`: session and login-history HTTP adapters
- `auth/sessionService.ts`: role policy, ownership, response mapping
- `auth/sessionRepository.ts`: PostgreSQL session table and login-history access

Password hashing, emergency master-password policy, audit writes, uploads, exchange rates, inventory history, employee balance synchronization, and supplier-balance context were already separated under `server/routes/helpers/` before this phase.

### Reporting

- `reportsRoutes.ts`: composition
- `reportsNetProfitStatementRoutes.ts`: net-profit drill-downs
- `reportsClosingStockRoutes.ts`: closing-stock operations
- `reportsDashboardAccountRoutes.ts`: dashboard account configuration
- remaining historical reports: compatibility registry

### Existing separated domains

The following registries were already modular and remain unchanged:

- vouchers and stock-transfer lifecycle
- containers and offload lifecycle
- ledger/account currency routes
- POS
- factory stock, suppliers, products, containers, bales, customers, production, scanning, shipping, and allocation
- rental units/contracts, payments/accruals, configuration, deletion, and reconciliation

## Compatibility registries

These files are frozen migration boundaries:

- `server/routesLegacy.ts`
- `server/routes/authRoutesLegacy.ts`
- `server/routes/customerRoutesLegacy.ts`
- `server/routes/reportsRoutesLegacy.ts`

Focused routes register before their compatibility copies. Express therefore uses the separated implementation for migrated URLs while untouched endpoints preserve their prior behavior.

Do not add new endpoints or new business rules to compatibility files. Move a complete route family into a focused module, register it before the compatibility registry, add an architecture contract, and only then remove its old copy in a later cleanup phase.

## Accounting and lifecycle invariants retained

- Container sales debit the customer account, credit commission revenue, create the sale, and mark the container `SOLD` in one database transaction.
- Inter-company transfers retain paired Payment and Receipt vouchers with `IC-TO-*` and `IC-FROM-*` accounts.
- Simple company transfers retain paired vouchers using `TRANSFER-CLEARING` and preserve two-sided undo.
- Inventory quick adjustment remains transactional and still blocks Supplier Partner companies.
- Customer opening-balance changes continue to synchronize the linked Accounts Receivable ledger account.
- Supplier reads and writes remain active-company scoped.

## Verification

- `scripts/verify-phase2-backend-module-separation.mjs`
- `tests/phase2-backend-module-separation.test.ts`

Both contracts check composition order, forbidden dependencies in transport files, preservation of accounting/lifecycle markers, and explicit compatibility boundaries.
