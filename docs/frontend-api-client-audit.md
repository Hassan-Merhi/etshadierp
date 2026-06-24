# Frontend API Client Audit

**Phase 8 — Centralize Frontend API Clients**
**Date:** 2026-06-24
**Scope:** `client/src/` (non-factory pages only — factory already has `client/src/lib/factoryApi.ts`)

---

## Summary

| Category | Count |
|---|---|
| API client files created | 10 |
| Pages migrated (safe mutations) | 4 |
| Pages marked Needs Verification | 15+ |
| Pages/files skipped (factory) | all `factory/` pages |
| Query keys changed | 0 |
| Invalidation behavior changed | 0 |
| Backend routes changed | 0 |

---

## API Client Files Created (`client/src/api/`)

| File | Covers |
|---|---|
| `accountsApi.ts` | `POST/PUT /api/ledger-accounts`, `PATCH /api/ledger-accounts/bulk-assign-parent` |
| `stockApi.ts` | bulk-delete, bulk-assign-category, quick-adjust, grades CRUD, categories CRUD |
| `inventoryApi.ts` | locations CRUD, stock-group-archives, silent-production |
| `customersApi.ts` | `POST /api/customers`, `PUT /api/customers/:id` |
| `suppliersApi.ts` | `DELETE /api/suppliers/:id` |
| `containersApi.ts` | sync-all-vouchers, tracking, container-number updates |
| `settingsApi.ts` | sessions CRUD, user-preferences, export settings |
| `reportsApi.ts` | export start, WhatsApp triggers |
| `posApi.ts` | shift open/close, sales, drafts |
| `vouchersApi.ts` | bulk-delete only (create/update left inline — see below) |

All clients wrap `apiRequest` from `@/lib/queryClient` with typed parameters and identical URL/method/payload.

---

## Pages Migrated (✅ Safe)

### `client/src/pages/Customers.tsx`
- **Migrated:** `createMutation` → `customersApi.create()`, `updateMutation` → `customersApi.update()`
- **Left inline:** nothing — all `apiRequest` calls were customer CRUD
- **Query keys:** unchanged
- **Invalidation:** unchanged

### `client/src/pages/Suppliers.tsx`
- **Migrated:** `deleteMutation` → `suppliersApi.delete()`
- **Left inline:** `apiRequest("POST", "/api/auth/set-company", ...)` — auth flow, not a supplier concern
- **Query keys:** unchanged
- **Invalidation:** unchanged

### `client/src/pages/AccountGroups.tsx`
- **Migrated:** `createGroupMutation` → `accountsApi.createLedgerAccount()`, `renameMutation` → `accountsApi.updateLedgerAccount()`, `assignMutation` / `removeMutation` / `dissolveMutation` → `accountsApi.bulkAssignParent()`
- **Left inline:** none — all `apiRequest` calls were ledger-account mutations
- **Query keys:** unchanged
- **Invalidation:** unchanged

### `client/src/pages/settings/ActiveSessionsTab.tsx`
- **Migrated:** `revokeMutation` → `settingsApi.deleteSession()`, `revokeAllMutation` → `settingsApi.deleteAllSessions()`
- **Left inline:** none — all `apiRequest` calls were session management
- **Query keys:** unchanged
- **Invalidation:** unchanged

---

## Needs Verification (⚠️ Left Inline — Risky or Complex)

These pages contain `apiRequest` calls that were deliberately left unchanged. They must be verified against business logic before any further migration. Do **not** migrate without careful review.

### `client/src/pages/VoucherEdit.tsx`
- Complex multi-step voucher creation with confirmation dialogs, offline queue, and error branching.
- **Do not touch** until all flows are tested end-to-end.

### `client/src/pages/ContainerDetail.tsx`
- Deep mutations across containers, purchase orders, freight costing, and intercompany.
- **Do not touch.**

### `client/src/pages/Daybook.tsx`
- Inline `fetch` calls for balance lookups with dynamic URL construction.
- Mutation for voucher delete/patch left inline — tied to Daybook-specific state.

### `client/src/pages/StockItems.tsx`
- Has 9 `apiRequest` calls (bulk-delete, quick-adjust, bulk-assign-category, grades, categories) plus 4 raw `fetch` calls for export.
- `stockApi.ts` and `inventoryApi.ts` cover these patterns — migration is mechanical but volume warrants a dedicated pass.
- **Status:** API client exists; page not yet migrated.

### `client/src/pages/LocationInventory.tsx`
- 5 `apiRequest` calls (add/update/delete location, archive stock group) plus 2 raw `fetch` calls.
- `inventoryApi.ts` covers these patterns — migration is mechanical.
- **Status:** API client exists; page not yet migrated.

### `client/src/pages/Containers.tsx`
- 5 `apiRequest` calls + 4 raw `fetch` calls including export-all trigger.
- `containersApi.ts` covers patterns — migration requires verifying bulk-sync logic.
- **Status:** API client exists; page not yet migrated.

### `client/src/pages/pos/POS.tsx`
- 9 `apiRequest` calls across sale creation, shift management, draft saving.
- `posApi.ts` covers the patterns — POS is a critical flow; migrate with care.
- **Status:** API client exists; page not yet migrated.

### `client/src/pages/properties/PropertyRentalPage.tsx`
- 22 `apiRequest` calls — highest count in codebase.
- Complex rental, payment, tenant management flows.
- **Do not migrate en masse.**

### `client/src/pages/properties/PropertiesDashboard.tsx`
- 9 `apiRequest` calls + uses `refetchQueries` directly.
- **Do not touch** — property dashboard has real-time cash/payable account logic.

### `client/src/pages/settings/DataToolsTab.tsx`
- 10 `apiRequest` calls across destructive data tools (reconcile, merge, import, restore).
- **Do not migrate** — destructive operations need careful manual verification.

### `client/src/pages/settings/DailyExportSection.tsx`
- 8 `apiRequest` calls for WhatsApp export triggers.
- `reportsApi.ts` covers patterns — straightforward but WhatsApp flows need UAT.

### `client/src/pages/SupplierProformas.tsx`
- 8 `apiRequest` calls — proforma + profit-split logic.
- **Needs verification** — multi-step proforma creation.

### `client/src/pages/StockTransferOrder.tsx`
- 8 `apiRequest` calls — stock transfer creation + intercompany.
- **Needs verification** — cross-company data integrity.

### `client/src/pages/Accounts.tsx`
- 4 `apiRequest` calls (voucher bulk-delete, ledger-account update, search).
- `accountsApi.ts` + `vouchersApi.ts` cover patterns.
- **Status:** API clients exist; page not yet migrated.

---

## Skipped — Factory (Already Abstracted)

All files under `client/src/pages/factory/` and factory-specific hooks use `client/src/lib/factoryApi.ts` which was created in an earlier phase. No changes made.

---

## Skipped — Non-Migrated Raw `fetch` Calls

The codebase has ~350 raw `fetch("/api/...")` calls in components and pages. These are partially covered by the global CSRF fetch interceptor in `queryClient.ts`. Migration of raw `fetch` to API clients is a future phase — only `apiRequest` mutations were considered in scope for Phase 8.

---

## Rules for Future Migration

1. **Never change a query key** — invalidation depends on exact key shape.
2. **Never change invalidation calls** — leave `queryClient.invalidateQueries(...)` exactly as-is in each page.
3. **API clients only wrap `apiRequest`** — no business logic, no caching, no side effects.
4. **One domain per file** — do not add unrelated endpoints to an existing client file.
5. **Verify mutationFn return value usage** — some `onSuccess(data)` handlers access `data.id`; confirm the API client returns the same type as the raw `apiRequest` call (both return `Promise<Response>`).
6. **High-risk pages require a dedicated review pass** — VoucherEdit, ContainerDetail, PropertyRentalPage, DataToolsTab.
