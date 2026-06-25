# Transaction Audit — Phase 11

**Date:** 2026-06-25  
**Scope:** All multi-table ERP write operations  
**Method:** Static grep audit across `server/routes/`, `server/storage/`, `server/inventoryHelper.ts`

---

## 1. Executive Summary

The vast majority of critical ERP write flows are already protected by `db.transaction()`. The factory module (bale scanning, dispatch, raw stock, employee-POS) is very thoroughly transactional. Container offload/freight, voucher payment/journal/transfer/sales/purchase updates, POS sale create/edit, payroll, and SP operations are all wrapped.

Two gaps were identified and safely fixed in this phase:

| # | Flow | Fix |
|---|------|-----|
| 1 | `POST /api/vouchers/with-entries` — used a fragile manual try/catch cleanup instead of a real transaction | Replaced with `db.transaction()` |
| 2 | `PUT /api/location-price-groups` — delete-then-insert pattern without a transaction | Wrapped in `db.transaction()` |

All other flows that appear to lack transactions either: (a) perform only single-row writes (atomic by default), (b) call storage helpers that wrap their own transactions, or (c) are too complex to touch safely and are marked **Needs Verification**.

---

## 2. Flows Already Using `db.transaction`

### Core ERP Routes

| File | Transaction count | What it covers |
|------|-------------------|----------------|
| `routes/posRoutes.ts` | 2 | POS sale create (voucher + entries + inventory adjust); POS sale edit (reverse + re-apply inventory) |
| `routes/vouchers/voucherJournalRoutes.ts` | 3 | Journal voucher create, edit, delete |
| `routes/vouchers/voucherPaymentRoutes.ts` | 2 | Payment/receipt voucher create and edit |
| `routes/vouchers/voucherTransferRoutes.ts` | 2 | Transfer voucher create and delete/void |
| `routes/vouchers/voucherSalesUpdateRoutes.ts` | 3 | Sales voucher edit, reversal, delete |
| `routes/vouchers/voucherPurchaseUpdateRoutes.ts` | 1 | Purchase voucher edit |
| `routes/voucherEntryRoutes.ts` | 2 | Stock transfer via voucher (entries + inventory); stock adjustment via voucher (entries + inventory) |
| `routes/containers/containerOffloadRoutes.ts` | 4 | Container offload create, edit, delete, post-offload charges |
| `routes/containers/containerFreightWriteRoutes.ts` | 2 | Freight cost write and reversal |
| `routes/containers/containerFreightReadRoutes.ts` | 2 | Freight read-back updates |
| `routes/containers/containerCostingRoutes.ts` | 1 | Container costing recalculation |
| `routes/containers/containerDocumentsRoutes.ts` | 1 | Document status + charge posting |
| `routes/factoryPayrollRoutes.ts` | 2 | Payroll run create and update |
| `routes/payroll/workerStatsAdvancesRoutes.ts` | 2 | Worker advance create and bulk-settle |
| `routes/payroll/advanceManagementRoutes.ts` | 5 | Advance create, edit, delete, approve, bulk |
| `routes/payroll/advanceAccountingRoutes.ts` | 1 | Advance accounting post |
| `routes/spRoutes.ts` | 5 | SP container create, edit, offload, charges, accounting |
| `routes/intercompanyNotificationRoutes.ts` | 1 | Intercompany transfer post |
| `routes/aiImportRoutes.ts` | 1 | AI-import row persist |
| `routes/importRoutes.ts` | 5 | Bulk import flows (stock, vouchers, etc.) |
| `routes/customerRoutes.ts` | 1 | Customer sale (credit sale pathway) |
| `routes/balanceRepairRoutes.ts` | 1 | Balance repair tool |
| `routes/admin/companySettingsRoutes.ts` | 1 | Company settings save |
| `routes/admin/deletedItemsRoutes.ts` | 1 | Hard-delete cascade |
| `routes/admin/importExportRoutes.ts` | 2 | Data import and export |
| `routes/admin/adminRepairRoutes.ts` | 2 | Ledger repair tools |
| `routes/debugRoutes.ts` | 1 | Debug data reset (dev only) |
| `routes/stock/stockGroupsItemsRoutes.ts` | 1 | Stock group bulk save |
| `routes/stock/stockMergeRoutes.ts` | 3 | Stock item merge operations |

### Factory Module Routes

| File | Transaction count | What it covers |
|------|-------------------|----------------|
| `routes/factory/factoryDispatchBatchRoutes.ts` | 9 | Dispatch batch create/edit/delete/finalize |
| `routes/factory/factoryShippingContainerRoutes.ts` | 1 | Shipping container finalize |
| `routes/factory/factoryStockAllocationV5Routes.ts` | 3 | Stock allocation create/edit/delete |
| `routes/factory/factoryDocsUsersRoutes.ts` | 7 | Docs, user assignments, approvals |
| `routes/factory/factoryTransporterRoutes.ts` | 3 | Transporter create/edit/delete |
| `routes/factory/customer-orders/baleScanningRoutes.ts` | 6 | Bale pick, ref-scan, article-scan, remove, exchange, bulk |
| `routes/factory/customer-orders/orderCrudRoutes.ts` | 1 | Order delete cascade |
| `routes/factory/customer-orders/orderChargesRoutes.ts` | 4 | Order charge create/edit/delete/bulk |
| `routes/factory/customer-orders/orderFinalizeLoadingRoutes.ts` | 2 | Finalize + undo finalize |
| `routes/factory/employee-pos/employeeCrudRoutes.ts` | 3 | Employee create/edit/delete |
| `routes/factory/employee-pos/employeePosFinancialRoutes.ts` | 3 | Employee financial post |
| `routes/factory/employee-pos/employeeAdvancesBonusRoutes.ts` | 1 | Advance/bonus post |
| `routes/factory/employee-pos/employeeLedgerWasteRoutes.ts` | 2 | Waste ledger post |
| `routes/factory/suppliers/supplierCrudRoutes.ts` | 2 | Factory supplier create/delete |
| `routes/factory/suppliers/supplierFxRoutes.ts` | 1 | Supplier FX rate post |
| `routes/factory/raw-stock/rawStockBalanceRoutes.ts` | 4 | Raw stock balance create/edit/delete/settle |
| `routes/factory/raw-stock/rawStockContainerRoutes.ts` | 1 | Raw stock container receive |
| `routes/factory/raw-stock/rawStockOffloadRoutes.ts` | 2 | Raw stock offload create/edit |
| `routes/factory/raw-stock/rawStockReceiptRoutes.ts` | 2 | Raw stock receipt create/edit |
| `routes/factory/raw-stock/rawStockAdjRoutes.ts` | 3 | Raw stock adjustment flows |

### Storage Layer

| File | Transaction count | What it covers |
|------|-------------------|----------------|
| `storage/accounting.ts` | 2 | Stock transfer via storage layer; create-with-entries (voucher+entries+inventory) |
| `storage/containers.ts` | 1 | Container offload create |
| `storage/stockOps.ts` | 5 | Inventory adjust, transfer, adjustment, merge, reset |
| `storage/employees.ts` | 1 | Employee balance sync |

### `adjustInventory` Helper

`server/inventoryHelper.ts` — `adjustInventory(tx, ...)` takes a `TxOrDb` parameter. It uses `FOR UPDATE` row-level locking. All callers that do concurrent inventory operations correctly pass the active `tx` handle from their enclosing `db.transaction()`.

---

## 3. Flows Missing Transaction Protection (before this phase)

### 3a. `POST /api/vouchers/with-entries` — **FIXED**

**File:** `server/routes/vouchers/voucherCreateRoutes.ts` (lines 192–277)

**Problem:** The voucher create + entries loop used a manual try/catch cleanup:
- Insert voucher row
- Loop: insert each entry row
- On failure: `await db.delete(voucherEntries)` + `await db.delete(vouchers)`

The cleanup was not atomic. If the delete-on-failure itself threw, the data was left in an inconsistent state. There was also a race window between writes.

**Fix applied:** Replaced the try/catch with `db.transaction(async (tx) => { ... })`. On any throw, PostgreSQL rolls back automatically. The `syncEmployeeBalancesFromEntries` and fire-and-forget calls remain outside the transaction (correct — they run after successful commit).

### 3b. `PUT /api/location-price-groups` — **FIXED**

**File:** `server/routes/stock/stockTransferAdjRoutes.ts` (lines 103–131)

**Problem:** Saved location price groups with a delete-all-then-re-insert pattern without a transaction. If the insert threw after the delete, the company's price groups were wiped.

**Fix applied:** Wrapped the delete + insert in `db.transaction(async (tx) => { ... })`.

---

## 4. Flows Too Risky to Change Now

The following flows involve helpers that call `db` directly (not through a passed `tx`). Wrapping the outer function in `db.transaction` would only partially protect them — the helpers' writes would be on a separate connection and would not roll back with the outer transaction. These are documented here and left unchanged.

| Flow | File | Why risky |
|------|------|-----------|
| `storage.createVoucher` (simple POST `/api/vouchers`) | `storage/accounting.ts` L531 | Single-row insert; atomic by default. No change needed. |
| `storage.createVoucherEntry` (simple single-entry add) | `storage/accounting.ts` L684 | Single-row insert; atomic by default. No change needed. |
| Stock grades/categories bulk assign loop | `stockTransferAdjRoutes.ts` L591–L711 | Metadata-only updates (no financial impact). Loop of `db.update` calls. Low risk. Would need a loop-with-tx rewrite. |
| Factory payroll posting | `factoryWorkerPayrollRoutes.ts` | No dedicated payroll post route found in this file; payroll is handled in `factoryPayrollRoutes.ts` which IS transactional. |
| `voucherEntryRoutes.ts` line 1392 — ledger account swap | `voucherEntryRoutes.ts` | Single `db.update` outside a transaction; only updates ledger IDs, no inventory effect. Low risk. |

---

## 5. Safe Fixes Applied

| # | File | Lines affected | Change |
|---|------|----------------|--------|
| 1 | `server/routes/vouchers/voucherCreateRoutes.ts` | ~192–277 | Replaced manual try/catch cleanup with `db.transaction()` |
| 2 | `server/routes/stock/stockTransferAdjRoutes.ts` | ~103–131 | Wrapped delete+insert in `db.transaction()` |

---

## 6. Needs Verification

These flows have multi-step writes but use helpers that hold their own `db` references. A full transactional fix would require passing `tx` through helper chains — not safe to do in this phase.

| Flow | File(s) | Risk |
|------|---------|------|
| `storage.createVoucher` + caller manually creates entries after | Any caller of `storage.createVoucher` that then separately inserts entries | Partial voucher possible if entry insert fails — but all known callers use `/api/vouchers/with-entries` (now fixed) or are POS (already transactional) |
| SP offload charge posting | `spRoutes.ts` (already has transactions but complex multi-step) | Verify SP offload does not leave orphan charges on error |
| Factory invoice + bale transfer | `factoryDocsUsersRoutes.ts` | Already has transactions but chains are complex |
| Waste dispatch create | `voucherCreateRoutes.ts` (waste dispatch section) | Needs manual review of whether entries + inventory are wrapped |

---

## 7. Future Recommendations

1. **Pass `tx` through storage helpers** — refactor `storage/accounting.ts` functions to accept an optional `TxOrDb` param so they can participate in outer transactions. Do this gradually with tests.
2. **Add integration test** for `/api/vouchers/with-entries` failure path — confirm rollback by injecting an error after the voucher insert.
3. **Consider a `createVoucherWithEntries` storage function** that wraps both inserts in one transaction and replaces the route-level logic.
4. **Audit waste dispatch** — the waste dispatch create endpoint was not fully audited in this phase.

---

## 8. Commands Run

```bash
# Count all existing transactions across routes
grep -rn "db\.transaction" server/routes/ | wc -l
# Result: 193 transactions found

grep -rn "db\.transaction" server/storage/ | wc -l
# Result: 9 transactions in storage layer

# Specific flow audits
grep -n "db\.transaction" server/routes/posRoutes.ts
grep -n "db\.transaction" server/routes/vouchers/voucherCreateRoutes.ts
grep -n "db\.transaction" server/routes/stock/stockTransferAdjRoutes.ts
grep -n "db\.transaction" server/routes/containers/containerOffloadRoutes.ts
grep -n "db\.transaction" server/routes/factoryPayrollRoutes.ts
grep -n "adjustInventory" server/inventoryHelper.ts
```

---

## 9. No-Change Confirmations

- No API URLs changed
- No request body fields changed
- No response shapes changed
- No schema changed
- No database tables changed
- No accounting math changed
- No inventory quantity math changed
- No POS sale payload changed
- No voucher numbering changed
- No permission logic changed
- No frontend code changed
