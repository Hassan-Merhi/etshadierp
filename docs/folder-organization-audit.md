# Phase 21 — Folder / File Organisation Audit

**Date:** 2026-06-26  
**Build gate:** `npm run build` → ✓ clean  
**Lint baseline:** 18 errors (all pre-existing, unchanged)  
**Scope:** `client/src/`, `server/routes/`, `shared/`

---

## Methodology

Audit performed in parallel sweeps:

1. **Server routes** — compared root-level files against split subdirectory barrels.
2. **Client pages** — checked for same-name pairs, lowercase vs PascalCase, unrouted files.
3. **Global components** — verified each component in `client/src/components/` has at least one importer outside its own file.
4. **Shared schema** — confirmed barrel chain.
5. **Barrels / index files** — checked for missing or incorrect re-exports.

No files were moved or deleted. All issues are documented below with a recommended action for each.

---

## 1. Server Routes

### 1.1 Root-level barrel files — CORRECT, leave as-is

These small files (14–20 lines) are proper barrel re-exports forwarding to split subdirectories. They are the intended public API for `server/routes.ts`.

| File | Lines | Re-exports from |
|------|-------|-----------------|
| `server/routes/adminRoutes.ts` | 18 | `admin/` |
| `server/routes/containerRoutes.ts` | 18 | `containers/` |
| `server/routes/statsRoutes.ts` | 14 | `stats/` |
| `server/routes/stockRoutes.ts` | 14 | `stock/` |
| `server/routes/voucherRoutes.ts` | 20 | `vouchers/` |

### 1.2 `server/routes/containerTrackingRoutes.ts` (root, 463 lines) — CORRECT, NOT a duplicate

**Initial concern:** Both `server/routes/containerTrackingRoutes.ts` (root) and `server/routes/containers/containerTrackingRoutes.ts` exist and both expose a function named `registerContainerTrackingRoutes`.

**Resolution:** They serve completely different URL namespaces:

- **Root file** (`containerTrackingRoutes.ts`, 463 lines) — registered directly by `server/routes.ts:62` + `:1770`. Serves the tracking engine API: `GET/POST /api/container-tracking/*` (status, bulk-track-now, debug-eta, events, etc.)
- **Split file** (`containers/containerTrackingRoutes.ts`) — called via `containerRoutes.ts` barrel. Serves embedded container CRUD tracking fields: `PATCH /api/containers/:id/tracking`, `POST /api/containers/tracking/import`, `POST /api/containers/:id/fetch-eta`

No double registration. No action needed.

### 1.3 `server/routes/factoryRoutes.ts` (127 lines) — CORRECT, has real middleware

Not a barrel. Contains two important `app.use("/api/factory", ...)` middleware blocks:

- **Company resolution middleware** — resolves `session.factoryCompanyId` from any company type.
- **Admin guard middleware** — blocks PUT/PATCH/DELETE for non-admins (with specific carve-outs for floor-staff operations).

Both middlewares must be registered before all factory sub-routes. File is correctly placed.

### 1.4 `server/routes/voucherEntryRoutes.ts` (1400 lines) — CORRECT, shared helper

Not dead. Imported by `server/routes/vouchers/index.ts` and every voucher sub-route file in `server/routes/vouchers/*.ts`. Serves as the shared voucher-entries CRUD helper consumed by all voucher split files. Cannot be moved without touching many files.

---

## 2. Shared Schema

### 2.1 `shared/schema.ts` — correct single-line barrel

```ts
export * from "./schema/index";
```

`shared/schema/index.ts` then re-exports from `common`, `accounting`, `users`, `inventory`, `erp`, and `factory`. The chain is complete and correct.

---

## 3. Client Pages

### 3.1 `ContainersPage.tsx` (5 lines) — thin alias wrapper, both routes active

```tsx
import ContainersERP from "./Containers";
export default function ContainersPage() { return <ContainersERP />; }
```

`App.tsx` routes `/containers` → `ContainersPage` (which renders `Containers.tsx`, 1874 lines).  
`Containers.tsx` itself is not routed separately. No conflict.

**Recommendation:** Could be consolidated by routing `/containers` directly to `Containers.tsx`, but the change is cosmetic. Safe to leave.

### 3.2 `ContainerDetailPage.tsx` (575 lines) vs `ContainerDetail.tsx` (1933 lines) — two different pages

Both are independently routed:
- `/containers/:id` → `ContainerDetailPage` (SP/ERP view)
- A second container-detail route → `ContainerDetail` (the older, larger view)

Different components, different feature sets. Not duplicates. No action needed.

### 3.3 `FactoryFinancialHub.tsx` (5 lines) — thin alias wrapper

```tsx
import FactoryNetPositionDetails from "@/pages/factory/FactoryNetPositionDetails";
export default function FactoryFinancialHub() { return <FactoryNetPositionDetails />; }
```

Routed at `/factory/intelligence/financial-hub`. `FactoryFinanceHub.tsx` (74 lines) is a separate tabbed hub (Workers, Employees, Suppliers, Vouchers, Accounts) — different component, different purpose. No conflict.

**Recommendation:** `FactoryFinancialHub.tsx` could be replaced by routing directly to `FactoryNetPositionDetails`, but safe to leave.

### 3.4 `FactoryStockAllocation.tsx` (553 lines, v1) — UNROUTED, dead page

`App.tsx` line 219:
```ts
const FactoryStockAllocation = lazy(() => import("@/pages/factory/FactoryStockAllocationV2"));
```

The local constant name `FactoryStockAllocation` is an alias for V2. The original file `FactoryStockAllocation.tsx` (v1) has no importer. V2, V3, and V5 are all actively routed:

| Route | File |
|-------|------|
| `/factory/stock-allocation` | `FactoryStockAllocationV2.tsx` (aliased as `FactoryStockAllocation`) |
| `/factory/stock-allocation-v3` | `FactoryStockAllocationV3.tsx` |
| `/factory/stock-allocation-v5` | `FactoryStockAllocationV5.tsx` |

**Recommendation:** `FactoryStockAllocation.tsx` (v1) can be deleted. Verify with product owner that no navigation link points to `/factory/stock-allocation` expecting v1 behaviour.

### 3.5 `bale-transfer.tsx` (294 lines) — UNROUTED, no importer

No `Route` entry found in `App.tsx`. No `import` found in any other file. The active bale-transfer page is `BaleTransfers.tsx` (589 lines, uses `/bale-transfers` route).

**Recommendation:** Safe to delete after confirming it is not referenced by any dynamic navigation string not visible to static analysis.

### 3.6 `stock-transfer.tsx` (1008 lines) — UNROUTED, no importer

Same situation. No Route or import found. The active pages are:
- `StockTransfers.tsx` (485 lines)
- `StockTransferOrder.tsx` (routed at `/stock-transfer-order`)

**Recommendation:** Safe to delete after confirming no dynamic reference exists.

### 3.7 `FactoryLocationInventoryMockup.tsx` (661 lines) — intentional active mockup

Routed at `/factory/location-inventory-mockup` in `App.tsx`. The "Mockup" suffix is intentional — it is a working UI used for location-based inventory scanning. No action needed.

### 3.8 `pages/daybook/AccountCombobox.tsx` vs `components/vouchers/AccountCombobox.tsx` — NOT duplicates

Different props, different behaviour:
- `daybook/AccountCombobox.tsx` — keyboard-navigation-aware combobox (arrow keys, onArrowUp/Down/Right), consumes typed local `LedgerAccount | BankAccount | Supplier | Employee | FixedAsset`.
- `components/vouchers/AccountCombobox.tsx` — network-fetching combobox with `useQuery`, `useCompany`, typed from `@shared/schema`.

`daybook/AccountCombobox.tsx` is used only by `daybook/VoucherEditDialog.tsx`, which is used by `Daybook.tsx`. Correct co-location. No action needed.

### 3.9 `pages/daybook/VoucherEditDialog.tsx` (396 lines) vs `components/VoucherEditDialog.tsx` (788 lines) — NOT duplicates

Entirely different content. The daybook version is a form-only inline dialog with field-array editing. The global version is a full fetch-edit-save dialog used by `Vouchers.tsx` and `Daybook.tsx` (the latter imports the global one directly). No action needed.

---

## 4. Global Components (`client/src/components/`)

### 4.1 Confirmed unused components (zero importers)

The following files exist in `client/src/components/` but have no import anywhere in the codebase outside their own file:

| File | Lines | Notes |
|------|-------|-------|
| `CreateBaleDialog.tsx` | — | Superseded by factory-subfolder dialogs |
| `ERPAdvancesTab.tsx` | — | No importer found; advances logic lives in Payroll page now |
| `LocationAutocomplete.tsx` | — | No importer found |
| `LocationCreateDialog.tsx` | — | No importer found |
| `LocationSelector.tsx` | — | No importer found |
| `SpSidebar.tsx` | — | No importer found; sidebar now rendered inline in ContainerDetail |

**Recommendation:** Each can be deleted. Run `npm run build` after each deletion to confirm the build remains clean. No changes made in this phase (deletion is a separate decision).

### 4.2 Domain-specific components in global folder — acceptable, leave as-is

The following components are factory/container-domain-specific but are placed in `client/src/components/`. They have active importers and are referenced from multiple pages or from `shared.ts`.

| Component | Used by |
|-----------|---------|
| `OffloadDialog.tsx` | `ContainerDetail.tsx` |
| `AddContainerDialog.tsx` | `Containers.tsx` |
| `CreateMixBatchDialog.tsx` | `ProductionBales.tsx`, `MixBatches.tsx`, `factory/ProductionRawStock.tsx` |
| `EditMixBatchDialog.tsx` | `MixBatches.tsx`, `factory/ProductionRawStock.tsx` |
| `FactoryKpiCard.tsx` | `factory/FactoryDashboard.tsx`, `shared.ts` |
| `FactorySidebar.tsx` | (factory layout) |
| `ERPRunPayroll.tsx` | `Payroll.tsx` |
| `ERPWorkerDetail.tsx` | `payroll/WorkerProfilesTab.tsx` |

Moving these would require updating all import paths. The benefit is low; the risk is import-breakage. No action needed in this phase.

### 4.3 `shared.ts` barrel — correct

`client/src/components/shared.ts` is a curated re-export barrel of shared UI primitives (PageHeader, KPICard, StatCard, DashboardCard, etc.). Its re-exports are all active. No issues found.

---

## 5. Barrel / Index Files — Complete

All split subdirectories that need a barrel have one:

| Directory | Barrel |
|-----------|--------|
| `server/routes/admin/` | `server/routes/adminRoutes.ts` (root barrel) |
| `server/routes/containers/` | `server/routes/containers/index.ts` + root barrel |
| `server/routes/factory/` | `server/routes/factoryRoutes.ts` (root with middleware) |
| `server/routes/stats/` | `server/routes/statsRoutes.ts` (root barrel) |
| `server/routes/stock/` | `server/routes/stockRoutes.ts` (root barrel) |
| `server/routes/vouchers/` | `server/routes/vouchers/index.ts` + root barrel |
| `shared/schema/` | `shared/schema/index.ts` → `shared/schema.ts` |
| `client/src/components/` | `client/src/components/shared.ts` (curated, not full barrel) |

No missing barrels found.

---

## 6. Summary of Recommended Actions

| Priority | Action | File(s) | Risk |
|----------|--------|---------|------|
| Low | Delete unused components | `CreateBaleDialog`, `ERPAdvancesTab`, `LocationAutocomplete`, `LocationCreateDialog`, `LocationSelector`, `SpSidebar` | Low — build will catch any missed reference |
| Low | Delete unrouted v1 page | `pages/factory/FactoryStockAllocation.tsx` | Low — confirm no dynamic nav string |
| Low | Delete unrouted old pages | `pages/bale-transfer.tsx`, `pages/stock-transfer.tsx` | Low — confirm no dynamic nav string |
| Cosmetic | Collapse thin wrapper | `ContainersPage.tsx` → route directly to `Containers.tsx` | Low |
| Cosmetic | Collapse thin wrapper | `FactoryFinancialHub.tsx` → route directly to `FactoryNetPositionDetails` | Low |
| None | Leave as-is | All server route files, shared schema, daybook components, domain-specific global components | — |

---

## 7. No Fixes Applied in This Phase

All identified issues are **dead code** (unused pages/components) or **cosmetic wrappers**. Deletion of dead files was deferred because:

1. Dynamic navigation strings (stored in DB or session) cannot be detected by static analysis.
2. The conservative scope of this phase is audit + documentation only.
3. The build gate (`npm run build`) confirmed the codebase is clean at current state.

Deletions should be executed as a separate, focused cleanup phase with explicit build verification after each deletion.
