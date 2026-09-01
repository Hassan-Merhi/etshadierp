# Accounting Engine Audit — Phase 10

Generated: 2026-06-25
Purpose: Map every accounting write flow before any code extraction. Step 1 of Phase 10.

---

## Commands Run

```bash
grep -rn "createVoucher\b" server/ --include="*.ts"
grep -rn "voucherEntries.*insert\|insert.*voucherEntries" server/ --include="*.ts"
grep -rn "customerBalances.*insert\|insert.*customerBalances" server/ --include="*.ts"
grep -rn "syncEmployeeBalancesFromEntries\|addCustomerBalanceEntry" server/
grep -rn "BEGIN\|COMMIT\|ROLLBACK\|db\.transaction\|pool\.connect" server/
grep -rn "daybookEntries.*insert\|insert.*daybookEntries" server/
wc -l server/routes/_helpers.ts server/storage/accounting.ts server/routes/vouchers/*.ts
```

---

## Already-Existing Shared Helpers (DO NOT DUPLICATE)

These are the accounting helpers already factored out in the codebase:

| Helper | File | Purpose |
|--------|------|---------|
| `logAudit()` | `server/routes/_helpers.ts:68` | Write to audit_log |
| `snapshotVoucherEntries()` | `server/routes/_helpers.ts:108` | Resolve party names for audit |
| `buildVoucherChangesForCreate/Delete/Update()` | `server/routes/_helpers.ts:221-264` | Build audit change objects |
| `syncEmployeeBalancesFromEntries()` | `server/routes/_helpers.ts:880` | Update employee balance/deposits/withdrawals |
| `runIntercompanyPosTransfer()` | `server/routes/_helpers.ts:282` | Auto-post intercompany cash transfer |
| `upsertIntercompanyVoucher()` | `server/routes/_helpers.ts:439` | Upsert a daily interco voucher + entries |
| `recalculateIntercompanyForDate()` | `server/routes/_helpers.ts:367` | Rebuild interco vouchers for a date |
| `getCurrentExchangeRate()` | `server/routes/_helpers.ts:267` | Get latest FX rate |
| `writeDaybookEntry()` | `server/routes/factory/_helpers.ts:41` | Insert factory daybook entry |
| `getOrCreateLedgerAccount()` (factory) | `server/routes/factory/_helpers.ts:146` | Find or create ledger acct by code |
| `addCustomerBalanceEntry()` | `server/storage/accounting.ts:1257` | Insert running-balance customer ledger row |
| `getOrCreateLedgerAccount()` (storage) | `server/storage/accounting.ts:76` | Full version with deleted-at recovery |
| `createVoucher()` | `server/storage/accounting.ts:530` | Single-row insert into vouchers |
| `adjustInventory()` | `server/inventoryHelper.ts` | Centralized stock qty + cost mutation |

---

## Accounting Flow Map

### F01 — Manual Voucher with Entries (canonical)
- **File**: `server/routes/vouchers/voucherCreateRoutes.ts`
- **Route**: `POST /api/vouchers/with-entries`
- **Business action**: User creates any manual accounting voucher with debit/credit entries
- **Creates vouchers**: YES — inside `db.transaction()`
- **Creates voucherEntries**: YES — loop insert inside same tx
- **Customer balances**: NO direct write
- **Supplier balances**: NO direct write
- **Ledger balances**: Derived on-the-fly from entries (no stored balance update)
- **Stock qty**: NO
- **POS sales**: NO
- **Transfer balances**: NO
- **Daybook**: NO
- **In DB transaction**: YES (`db.transaction()`)
- **Side effects**: `syncEmployeeBalancesFromEntries`, `logAudit`, `triggerIntercompanyNotifications`, `autoReallocateLoansAccounts` (all fire-and-forget after commit)
- **Risk**: **SAFE TO EXTRACT** — the tx insert pattern is the canonical one

### F02 — Payment / Receipt Voucher
- **File**: `server/routes/vouchers/voucherPaymentRoutes.ts`
- **Routes**: `POST /api/vouchers/payment-receipt`, `PATCH /api/vouchers/:id/payment-receipt`
- **Business action**: Record a payment to supplier or receipt from customer/employee
- **Creates vouchers**: YES
- **Creates voucherEntries**: YES (debit + credit pair)
- **Customer balances**: Via `addCustomerBalanceEntry()` if customerId present
- **Supplier balances**: Via voucher entries referencing supplierId
- **Ledger balances**: Derived
- **Stock qty**: NO
- **Daybook**: YES — posts to `factoryDaybookEntries` when factory settings active
- **In DB transaction**: YES
- **Side effects**: `syncEmployeeBalancesFromEntries`, `logAudit`, `writeDaybookEntry`
- **Risk**: **MODERATE** — complex party-linking and daybook side effect; leave route-level logic intact

### F03 — Journal Voucher
- **File**: `server/routes/vouchers/voucherJournalRoutes.ts`
- **Route**: `POST /api/vouchers/journal`
- **Business action**: Free-form journal entry across any accounts
- **Creates vouchers**: YES
- **Creates voucherEntries**: YES
- **Customer balances**: May update via `addCustomerBalanceEntry()` if customer entry present
- **Supplier balances**: Via entries
- **Ledger balances**: Derived
- **Stock qty**: NO
- **Daybook**: NO
- **In DB transaction**: YES
- **Side effects**: `syncEmployeeBalancesFromEntries`, `logAudit`, `autoReallocateLoansAccounts`, order-charge sync
- **Risk**: **MODERATE** — auto-links order charges based on account+customer; leave special-case intact

### F04 — Purchase Voucher Update
- **File**: `server/routes/vouchers/voucherPurchaseUpdateRoutes.ts`
- **Routes**: `PUT /api/vouchers/:id/purchase`, `DELETE /api/vouchers/:id`
- **Business action**: Edit or delete a purchase voucher and reverse inventory
- **Creates vouchers**: UPDATES existing
- **Creates voucherEntries**: REPLACES existing
- **Customer balances**: Via `adjustLedger` helper calls
- **Supplier balances**: Via entries
- **Stock qty**: YES — calls `reverseInventoryByExactValue` on delete
- **Daybook**: NO
- **In DB transaction**: YES
- **Side effects**: `syncEmployeeBalancesFromEntries` (reverse), `logAudit`
- **Risk**: **MODERATE** — stock reversal tied to accounting; leave together

### F05 — Sales Voucher Update
- **File**: `server/routes/vouchers/voucherSalesUpdateRoutes.ts`
- **Routes**: `PUT /api/vouchers/:id/sales`, `DELETE` (sales)
- **Business action**: Edit or delete a sales voucher; reverse inventory on delete
- **Creates vouchers**: UPDATES existing
- **Creates voucherEntries**: REPLACES
- **Customer balances**: `adjustLedger` / `addCustomerBalanceEntry`
- **Supplier balances**: Via entries (SP mode)
- **Stock qty**: YES — `reverseInventoryByExactValue` on delete
- **Daybook**: NO
- **In DB transaction**: YES
- **Side effects**: `syncEmployeeBalancesFromEntries` (reverse), `logAudit`, interco recalc
- **Risk**: **MODERATE**

### F06 — Transfer Voucher
- **File**: `server/routes/vouchers/voucherTransferRoutes.ts`
- **Routes**: `POST /api/vouchers/transfer`, `PATCH`, `DELETE`
- **Business action**: Inter-company or inter-account transfer posting
- **Creates vouchers**: YES (multiple — one per company leg)
- **Creates voucherEntries**: YES
- **Customer balances**: NO
- **Supplier balances**: NO
- **Ledger balances**: Via `adjustLedger`
- **Stock qty**: NO
- **Transfer balances**: YES — updates `interCompanyTransfers`, `receivables`, `payouts`
- **Daybook**: NO
- **In DB transaction**: YES
- **Side effects**: `syncEmployeeBalancesFromEntries`, `logAudit`
- **Risk**: **NEEDS VERIFICATION / LEAVE ALONE** — multi-company legs, settlement logic

### F07 — POS Sale
- **File**: `server/routes/posRoutes.ts`
- **Routes**: `POST /api/pos/sales`, `PUT /api/vouchers/:id/sales`
- **Business action**: Record a point-of-sale cash or credit sale
- **Creates vouchers**: YES (Sales type)
- **Creates voucherEntries**: YES (Dr Cash/Receivable, Cr Sales; or SP mode)
- **Customer balances**: `addCustomerBalanceEntry()` for credit sales
- **Supplier balances**: SP partner mode: Cr supplier
- **Stock qty**: YES — `adjustInventory()`
- **POS sales**: YES — inserts into `salesItems`
- **Transfer balances**: YES — `runIntercompanyPosTransfer()` for cash sales
- **Daybook**: NO
- **In DB transaction**: YES
- **Side effects**: `runIntercompanyPosTransfer`, `logAudit`, sales items
- **Risk**: **NEEDS VERIFICATION / LEAVE ALONE** — dual mode (standard ERP / SP partner), stock + accounting in same tx

### F08 — Credit Note
- **File**: `server/routes/creditNoteRoutes.ts`
- **Business action**: Issue a credit note against a sale, reverse stock
- **Creates vouchers**: YES
- **Creates voucherEntries**: YES (12 inserts in this file)
- **Customer balances**: `addCustomerBalanceEntry()` (reverse debit)
- **Supplier balances**: NO
- **Stock qty**: YES — `adjustInventory()` (reverse)
- **Daybook**: NO
- **In DB transaction**: YES
- **Side effects**: `logAudit`, `syncEmployeeBalancesFromEntries`
- **Risk**: **MODERATE** — stock+accounting combo; leave together

### F09 — SP (Supplier Partner) Module
- **File**: `server/routes/spRoutes.ts`
- **Business action**: Full SP lifecycle — opening stock, sales, offload, transfers, reversals
- **Creates vouchers**: YES (many: SP-STOCK, SP-OTW-REV, SP-OPNSTK)
- **Creates voucherEntries**: YES (30 inserts — highest count in codebase)
- **Customer balances**: NO
- **Supplier balances**: YES — via voucher entries with supplierId; intercompany IC entries
- **Stock qty**: YES — `adjustInventory()` extensively
- **Daybook**: NO
- **In DB transaction**: Partially (some ops use `pool.query` transactions)
- **Risk**: **NEEDS VERIFICATION / LEAVE ALONE** — unique SP voucher numbering (SP-OTW-REV-*, SP-STOCK-*, SP-OPNSTK-*), filtered from normal ledger views, intercompany IC posting

### F10 — Employee Accounting
- **File**: `server/routes/employeeRoutes.ts`
- **Business action**: Employee salary advances, deductions, manual journal entries for employees
- **Creates vouchers**: YES (1 direct `db.insert(vouchers)` at line 2157 + many via entries)
- **Creates voucherEntries**: YES (22 inserts)
- **Customer balances**: NO
- **Supplier balances**: NO
- **Ledger balances**: Derived; `syncEmployeeBalancesFromEntries`
- **Stock qty**: NO
- **Daybook**: NO
- **In DB transaction**: YES (some) / partially (some use db directly)
- **Risk**: **MODERATE** — salary advance + ledger must stay paired; leave special-cases

### F11 — Container Accounting (ERP)
- **File**: `server/routes/containers/containerAccountingRoutes.ts`
- **Business action**: Record container charges, freight costs against ERP vouchers
- **Creates vouchers**: YES
- **Creates voucherEntries**: YES (7 inserts)
- **Customer balances**: NO
- **Supplier balances**: Via entries
- **Stock qty**: NO
- **Daybook**: NO
- **In DB transaction**: YES
- **Risk**: **MODERATE** — freight-paid-by logic (parent/child companies); see memory note same-company-freight.md

### F12 — Container Offload (ERP)
- **File**: `server/routes/containers/containerOffloadRoutes.ts`
- **Business action**: Record container offload — inventory receipt + supplier payable
- **Creates vouchers**: YES
- **Creates voucherEntries**: YES (9 inserts)
- **Customer balances**: NO
- **Supplier balances**: YES (payable to supplier for goods)
- **Stock qty**: YES — `adjustInventory()`
- **Daybook**: NO
- **In DB transaction**: YES
- **Risk**: **NEEDS VERIFICATION / LEAVE ALONE** — stock + supplier payable in one tx

### F13 — Container Freight Write (ERP)
- **File**: `server/routes/containers/containerFreightWriteRoutes.ts`
- **Business action**: Post freight/duty charges to voucher
- **Creates vouchers**: YES (via `storage.createVoucher`)
- **Creates voucherEntries**: YES (5 inserts)
- **Supplier balances**: Via entries
- **Stock qty**: NO
- **Daybook**: NO
- **In DB transaction**: Partially
- **Risk**: **MODERATE**

### F14 — Container Storage (accounting.ts)
- **File**: `server/storage/containers.ts`
- **Business action**: Backend storage for container offload accounting
- **Creates vouchers**: NO direct
- **Creates voucherEntries**: YES (18 inserts — second highest)
- **In DB transaction**: YES (pool transactions)
- **Risk**: **NEEDS VERIFICATION / LEAVE ALONE** — complex container cost calculations

### F15 — Rental Payments / Accrual
- **Files**: `server/routes/rental/rentalUnitsContractsRoutes.ts`, `server/routes/rental/rentalPaymentsAccrualRoutes.ts`, `server/routes/rental/_rentalShared.ts`
- **Business action**: Record rent receipts, accrue rental income
- **Creates vouchers**: YES
- **Creates voucherEntries**: YES (6+9+6 inserts)
- **Customer balances**: `addCustomerBalanceEntry()` for rent receivable
- **Supplier balances**: NO
- **Ledger balances**: Derived
- **Daybook**: NO
- **In DB transaction**: YES
- **Risk**: **MODERATE** — accrual + payment pairing; shared `_rentalShared.ts` helper already exists

### F16 — Payroll Core
- **File**: `server/routes/payroll/payrollCoreRoutes.ts`
- **Business action**: Generate payroll run — compute wages, deductions, net pay
- **Creates vouchers**: YES (payroll journal entries)
- **Creates voucherEntries**: YES (6 inserts)
- **Customer balances**: NO
- **Supplier balances**: NO
- **Ledger balances**: Employee pay-ledger; `syncEmployeeBalancesFromEntries`
- **Daybook**: YES — posts `PAYROLL_GENERATED`
- **In DB transaction**: YES
- **Risk**: **NEEDS VERIFICATION / LEAVE ALONE** — payroll calculation + ledger + daybook in one flow

### F17 — Advance Accounting (Payroll)
- **File**: `server/routes/payroll/advanceAccountingRoutes.ts`
- **Business action**: Post salary advance to ledger, create advance deduction schedule
- **Creates vouchers**: YES
- **Creates voucherEntries**: YES (6 inserts)
- **Ledger balances**: Employee advance ledger
- **Daybook**: YES
- **In DB transaction**: YES
- **Risk**: **MODERATE** — advance + deduction schedule must stay paired

### F18 — Factory Containers
- **File**: `server/routes/factory/factoryContainersRoutes.ts`
- **Business action**: Factory-side container management — commission, duty, supplier payments
- **Creates vouchers**: Via `pool.query` (raw SQL)
- **Creates voucherEntries**: YES (14 inserts)
- **Supplier balances**: YES (factory supplier payables)
- **Stock qty**: Via raw stock linkage
- **Daybook**: YES — `writeDaybookEntry()`
- **In DB transaction**: YES (`pool.connect()` + `BEGIN/COMMIT`)
- **Risk**: **NEEDS VERIFICATION / LEAVE ALONE** — raw SQL transactions, FX conversion, commission

### F19 — Factory Raw Stock Offload
- **File**: `server/routes/factory/raw-stock/rawStockOffloadRoutes.ts`
- **Business action**: Offload a factory container into raw stock, post supplier payable
- **Creates vouchers**: Via pool.query
- **Creates voucherEntries**: YES (13 inserts)
- **Supplier balances**: YES (factory supplier)
- **Stock qty**: YES (factory raw stock)
- **Daybook**: YES
- **In DB transaction**: YES (pool transactions)
- **Risk**: **NEEDS VERIFICATION / LEAVE ALONE** — multi-step: container → raw stock → voucher → daybook in one tx

### F20 — Factory Raw Stock Adjustment
- **File**: `server/routes/factory/raw-stock/rawStockAdjRoutes.ts`
- **Business action**: Adjust raw stock quantities + post accounting entry
- **Creates vouchers**: YES (via `storage.createVoucher` — 3 calls)
- **Creates voucherEntries**: YES (3 inserts)
- **Stock qty**: YES (factory raw stock)
- **Daybook**: YES
- **In DB transaction**: YES
- **Risk**: **MODERATE** — stock + voucher paired; keep together

### F21 — Factory Customer Order Charges
- **File**: `server/routes/factory/customer-orders/orderChargesRoutes.ts`
- **Business action**: Add charges (freight, misc) to customer orders
- **Creates vouchers**: YES
- **Creates voucherEntries**: YES (8 inserts)
- **Customer balances**: YES — `addCustomerBalanceEntry()`
- **Daybook**: NO
- **In DB transaction**: YES
- **Risk**: **MODERATE**

### F22 — Factory Order Finalize / Loading
- **File**: `server/routes/factory/customer-orders/orderFinalizeLoadingRoutes.ts`
- **Business action**: Finalize a bale loading order, invoice the customer
- **Creates vouchers**: YES
- **Creates voucherEntries**: YES
- **Customer balances**: YES — `addCustomerBalanceEntry()` + `customers.currentBalance`
- **Daybook**: YES — `LOADING_SUBMITTED`, `ORDER_VERIFIED`
- **In DB transaction**: YES
- **Risk**: **NEEDS VERIFICATION / LEAVE ALONE** — invoice + balance + daybook + bale status in one flow

### F23 — Employee POS Financial
- **File**: `server/routes/factory/employee-pos/employeePosFinancialRoutes.ts`
- **Business action**: Factory employee POS — sales charged to employee ledger
- **Creates vouchers**: YES
- **Creates voucherEntries**: YES (6 inserts)
- **Customer balances**: YES (4 inserts — employee as customer)
- **Daybook**: YES (3 inserts)
- **In DB transaction**: YES
- **Risk**: **NEEDS VERIFICATION / LEAVE ALONE** — employee balance + POS + daybook in one flow

### F24 — Factory Employee Advances / Bonus
- **File**: `server/routes/factory/employee-pos/employeeAdvancesBonusRoutes.ts`
- **Business action**: Record cash advances or bonuses for factory workers
- **Creates vouchers**: YES
- **Creates voucherEntries**: YES
- **Ledger balances**: Employee payroll ledger
- **Daybook**: YES
- **In DB transaction**: YES
- **Risk**: **MODERATE**

### F25 — Factory Docs / Users (Factory Admin Vouchers)
- **File**: `server/routes/factory/factoryDocsUsersRoutes.ts`
- **Business action**: Admin-created factory accounting adjustments (direct voucher posting)
- **Creates vouchers**: YES (1 `tx.insert(vouchers)` at line 2837)
- **Creates voucherEntries**: YES
- **Customer balances**: YES (1 insert)
- **Daybook**: YES (1 insert)
- **In DB transaction**: YES
- **Risk**: **MODERATE**

### F26 — Fiscal Transfer
- **File**: `server/routes/fiscalTransferRoutes.ts`
- **Business action**: Close a fiscal period — zero out P&L, post to retained earnings
- **Creates vouchers**: YES (closing journal)
- **Creates voucherEntries**: YES
- **Ledger balances**: YES — resets `openingBalance` on revenue/expense accounts
- **In DB transaction**: YES
- **Side effects**: Updates `ledgerAccounts.openingBalance` to "0"
- **Risk**: **NEEDS VERIFICATION / LEAVE ALONE** — irreversible; touches opening balances

### F27 — Import Routes
- **File**: `server/routes/importRoutes.ts`
- **Business action**: Bulk import vouchers / entries / balances from Excel
- **Creates vouchers**: YES (2 `storage.createVoucher` calls)
- **Creates voucherEntries**: YES (4 inserts)
- **In DB transaction**: Partially
- **Risk**: **MODERATE** — bulk import; validation-heavy; leave separate

### F28 — Customer Routes (Balance)
- **File**: `server/routes/customerRoutes.ts`
- **Business action**: Opening balance posting for new customers
- **Creates voucherEntries**: YES (8 inserts)
- **Customer balances**: YES (1 `addCustomerBalanceEntry`)
- **In DB transaction**: YES
- **Risk**: **MODERATE**

### F29 — Balance Repair
- **File**: `server/routes/balanceRepairRoutes.ts`
- **Business action**: Admin tool to recompute employee balances from voucher history
- **Creates vouchers**: NO (read + recalculate only)
- **Updates balances**: YES — `employees.currentBalance`
- **In DB transaction**: NO
- **Risk**: **SAFE** — read-only repair; no voucher creation

### F30 — Admin PO Fix
- **File**: `server/routes/admin/adminPoFixRoutes.ts`
- **Business action**: Admin repair of malformed PO-related vouchers
- **Creates voucherEntries**: YES (8 inserts)
- **In DB transaction**: YES
- **Risk**: **MODERATE** — admin only; leave separate

### F31 — SP Migration
- **File**: `server/routes/spMigrationRoutes.ts`
- **Business action**: One-time migration helper for SP module data
- **Creates vouchers**: YES
- **Creates voucherEntries**: YES (3 inserts)
- **Risk**: **LEAVE ALONE** — migration-only; highly specialized

---

## Duplicated Patterns Found

### Pattern A — Raw `insert voucher + insert entries` Boilerplate
The mechanical sequence:
```typescript
const [v] = await tx.insert(vouchers).values({...}).returning();
for (const entry of entries) {
  await tx.insert(voucherEntries).values({ voucherId: v.id, ...entry }).returning();
}
return { voucher: v, entries: insertedEntries };
```
Appears in:
- `voucherCreateRoutes.ts` (canonical `/api/vouchers/with-entries`)
- `factoryDocsUsersRoutes.ts` (line 2837)
- `employeeRoutes.ts` (line 2157 — uses `db.insert` directly, not inside tx)
- Various pool.query flows in `spRoutes.ts`, `factoryContainersRoutes.ts` etc. (raw SQL variant)

**Extraction decision**: Extract the pure insert boilerplate into `insertVoucherWithEntriesTx()`.
All business logic (balance sync, audit log, notifications, daybook) stays in the calling routes.

### Pattern B — `getOrCreateLedgerAccount` Duplication
- `server/storage/accounting.ts:76` — full version with deletedAt recovery and race-condition retry
- `server/routes/factory/_helpers.ts:146` — simpler version (code lookup only, no name fallback)

These have different signatures and behavior. **Decision: leave both in place. Document only.**

### Pattern C — `syncEmployeeBalancesFromEntries` Already Centralized
Already in `server/routes/_helpers.ts`. Called from:
- `voucherCreateRoutes.ts`, `voucherPaymentRoutes.ts`, `voucherJournalRoutes.ts`,
  `voucherSalesUpdateRoutes.ts`, `voucherPurchaseUpdateRoutes.ts`, `voucherTransferRoutes.ts`,
  `importRoutes.ts`, `balanceRepairRoutes.ts`

No further extraction needed — already centralized.

### Pattern D — `addCustomerBalanceEntry` Already Centralized
Already in `server/storage/accounting.ts`. Called from multiple routes.
No further extraction needed.

### Pattern E — `writeDaybookEntry` Already Centralized
Already in `server/routes/factory/_helpers.ts`. Called by all factory flows that need daybook.
No further extraction needed.

---

## Special-Case Flows That Must Stay Isolated

| Flow | Reason |
|------|--------|
| SP module (`spRoutes.ts`) | Unique voucher numbering (SP-OTW-REV-*, SP-STOCK-*); filtered from normal ledger views; intercompany IC; complex SP payable rules |
| POS sale (`posRoutes.ts`) | Dual mode (ERP / SP partner); stock + accounting + intercompany in same tx |
| Fiscal period close (`fiscalTransferRoutes.ts`) | Irreversible; modifies opening balances |
| Transfer vouchers (`voucherTransferRoutes.ts`) | Multi-company legs; settlement / payout / receivable tables |
| Raw stock offload (`rawStockOffloadRoutes.ts`) | Container → raw stock → supplier payable → daybook chain |
| Factory order finalize (`orderFinalizeLoadingRoutes.ts`) | Invoice + customer balance + bale status + daybook |
| Employee POS financial | Employee-as-customer balance + POS + daybook |
| Container storage (`storage/containers.ts`) | Complex raw SQL cost calculations |
| Payroll core | Payroll calculation + ledger + daybook |

---

## Target Output — Service Layer

### `server/services/accounting/accountingTypes.ts`
Shared TypeScript types for entry payloads and the voucher+entries insert result.

### `server/services/accounting/voucherPostingService.ts`
Exports `insertVoucherWithEntriesTx()` — the safe Pattern A extraction.
Thin wrapper: accepts a Drizzle tx handle, voucher fields, and entry fields. Returns `{ voucher, entries }`.
No business logic. No balance sync. No audit log. No side effects.

### `server/services/accounting/index.ts`
Re-exports from the above two files.

---

## Files Intentionally NOT Changed

- `server/routes/spRoutes.ts`
- `server/routes/posRoutes.ts`
- `server/routes/fiscalTransferRoutes.ts`
- `server/routes/vouchers/voucherTransferRoutes.ts`
- `server/routes/vouchers/voucherSalesUpdateRoutes.ts`
- `server/routes/vouchers/voucherPurchaseUpdateRoutes.ts`
- `server/routes/containers/containerOffloadRoutes.ts`
- `server/storage/containers.ts`
- `server/routes/factory/raw-stock/rawStockOffloadRoutes.ts`
- `server/routes/factory/factoryContainersRoutes.ts`
- `server/routes/factory/customer-orders/orderFinalizeLoadingRoutes.ts`
- `server/routes/factory/employee-pos/employeePosFinancialRoutes.ts`
- `server/routes/payroll/payrollCoreRoutes.ts`
- `server/routes/spMigrationRoutes.ts`
- `server/routes/rental/_rentalShared.ts`
- `shared/schema.ts`
- `server/inventoryHelper.ts`
- `server/routes/_helpers.ts` (except additive only)
- `server/storage/accounting.ts` (except additive only)

---

## Manual Verification Checklist

After Phase 10 service layer is created:

- [ ] `POST /api/vouchers/with-entries` still creates voucher + entries atomically
- [ ] `POST /api/vouchers/payment-receipt` still posts daybook + employee balance sync
- [ ] POS sale still updates stock + customer balance + intercompany
- [ ] SP sales still use SP-prefixed voucher numbers
- [ ] Container offload still creates supplier payable + stock entry in one tx
- [ ] Payroll run still posts daybook entry + employee balance
- [ ] Employee advance still creates deduction schedule + ledger entry
- [ ] Rental receipt still posts `addCustomerBalanceEntry`
- [ ] Fiscal close still resets revenue/expense opening balances to 0
- [ ] Balance repair still reads from entries and updates employee.currentBalance
- [ ] No new schema changes were made
- [ ] No API routes changed paths or response shapes
