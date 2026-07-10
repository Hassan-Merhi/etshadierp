# TypeScript Cleanup — Phase C+D

## Scope
Reduce `tsc --noEmit` errors by fixing client/UI and display/report-page issues only:
props, missing imports, presentational mismatches, date/format context bugs, and
render-safe nullable fixes. Explicitly out of scope: server accounting/POS/stock/
voucher/ledger/container route logic, DB schema/Drizzle definitions, the pre-existing
`unit`/`barcode` stock schema mismatch, `client/src/pages/pos/POS.tsx`, and any change
to mutation/request payload shape or business calculations.

## Results
- Baseline: **509** errors (`ts-errors-before-phase-cd.txt`)
- After Phase C+D: **399** errors (`ts-errors-after-phase-cd.txt`)
- **110 errors fixed**, 0 regressions
- `npm run build` succeeds
- Workflow restarted and verified healthy

## Files changed
- `client/src/components/ERPRunPayroll.tsx` — `.currency` → `.displayCurrency` (matches real `useCompany()` type).
- `client/src/pages/SupplierProfitCheck.tsx` — added `avgPrice: string` to po-overrides local type (confirmed real server field).
- `client/src/pages/StockTransfers.tsx` — `useDateFormat()` destructure fixed to real export (`formatShortDate`, aliased).
- `client/src/pages/ProductionBales.tsx` — added missing `useDateFormat()` call inside nested `BatchDetailView` component.
- `client/src/pages/TransactionJournal.tsx` — added `customerId: number | null` to local `VoucherEntry` (real schema column).
- `client/src/pages/VoucherEdit.tsx` — `exchangeRate ?? 1` guard for two hook calls expecting `number`.
- `client/src/pages/Vouchers.tsx` — `posUser ?? undefined` for `StockTransferForm` prop.
- `client/src/components/ConfirmationDialog.tsx` — `DeleteConfirmDialogProps` extended with optional `title`/`description` (same defaults as before), used by `AccountDialogs.tsx`.
- `client/src/pages/analytics/HierarchicalAccounts.tsx` — `Account` type imported from its real source; `accountMap` type narrowed to match actual data shape.
- `client/src/pages/factory/DailyProductionReport.tsx` — real bug fixes: `perWorker.name` typed; `sellingPricePerBale` → `costPricePerBale` rename (real field name); `onTableKg` corrected to read `balanceOnTable.weightKg` (was reading a non-existent field).
- `client/src/pages/factory/ProductionRawStock.tsx`, `client/src/pages/settings/AuditLog.tsx` — `useAppMode()` returns the value directly, not `{ appMode }`.
- `client/src/pages/factory/production-raw-stock/RawStockTable.tsx` — added missing `onNewMaterial` prop declaration (real prop already passed at call site).
- `client/src/pages/factory/FactoryFinancialSnapshot.tsx` — optional chaining for possibly-undefined `netPosition`.
- `client/src/pages/factory/FactoryBrokerVisualStatement.tsx` — `formatNumber` called with its native numeric signature instead of a stringified argument.
- `client/src/pages/factory/FactoryStockAllocationV2.tsx` — added missing `isActive`/`hiddenZeroCount` fields to fallback object literals.
- `client/src/pages/factory/FactoryInsurance.tsx`, `client/src/pages/factory/factory-containers/TrackingSheets.tsx` — real bug fix: `apiRequest`/`factoryApiRequest` return a raw `Response`; call sites were using the `Response` object directly instead of calling `.json()`, so these features returned nothing usable at runtime.
- `client/src/pages/factory/FactoryInvoiceLoadingScan.tsx` — added an explicit `if (!summary) return null;` guard; a combined boolean early-return didn't narrow `summary` for TS, causing 17 cascading `possibly undefined` errors from one root cause.
- `client/src/pages/factory/FactoryContainerLoadingScan.tsx` — added `containerNotes: string | null` to `OrderDetail` (real API field, confirmed server-side).
- `client/src/pages/factory/FactoryCustomers.tsx` — added `paymentTermsDays?: number` to create-mutation payload type (real `customers` table column).
- `client/src/pages/factory/FactoryInvoiceDetail.tsx` — added optional `fullAccess?: boolean` to `myAccess` query type (real `/api/factory/my-access` response field).
- `client/src/pages/factory/FactoryInvoices.tsx` — widened `getRemainingBales`/`getEstimatedKg`/`getEstimatedPrice` parameter types to the minimal shape actually used, so they satisfy `InvoiceSummaryBar`'s `OrderLike` callback contract.
- `client/src/pages/settings/DataToolsTab.tsx` — Excel row typing loosened to `Record<string, any>` for casing-tolerant lookups; `MergeStockItemsCard` accepts an optional `embedded` prop (matching its sibling `BulkMergeStockItemsCard`).
- `client/src/pages/settings/StockReportSection.tsx` — `saveSettings.mutate(undefined)` (mutation's optional-arg function still requires an explicit call argument).
- `client/src/pages/settings/users/UserListTable.tsx` — `Set<string>` typed explicitly for FEATURE_KEYS lookup.
- `client/src/routes/ErpRoutes.tsx` — lazy page components routed through the existing `ComponentType<any>` cast pattern already used elsewhere in the file.
- `client/src/pages/git-containers/ContainerDrawerTracking.tsx` — `variant="link"` (not a valid Button variant) replaced with `variant="ghost"` + `underline` class, same visual result.
- `client/src/pages/git-containers/ContainerTable.tsx`, `client/src/pages/git-containers/InlineCells.tsx` — added missing `uppercase`/`width` props to `InlineTextCell`/`InlineNumberCell` (were already being passed at call sites; components now honor them).
- `client/src/pages/git-containers/EtaDateFilter.tsx` — simplified `includeNoEta` derivation to avoid an impossible-overlap comparison.
- `client/src/pages/git-containers/gitContainerTypes.ts` — added missing `PriorityTier` type export (`"high" | "medium" | "low"`, matches actual `getContainerPriority` return values).
- `client/src/pages/factory/production-raw-stock/MixBatchList.tsx` — `justifyBetween` → `justifyContent` typo in inline style (real bug — the flex rule was never applied).
- `client/src/pages/factory/FactoryPayrollTab.tsx` — Excel export TOTAL row corrected to use the exact column keys required by the sheet type (was using a stray `"Transport ($)"` key that doesn't exist in the template).
- `client/src/pages/factory/FactorySuppliers.tsx` — `editObComm` now constructed explicitly to match its local state type instead of assigning the full `ObCommission` (see Skipped below for the `voucherPayments`/`notes` backend gaps this touches).
- `client/src/pages/factory/FactoryUsers.tsx` — added `hideAllCosts?: boolean` to create-mutation payload type (real backend field).
- `client/src/pages/factory/LabelBannersSettings.tsx` — `PageHeader` invoked with its real prop names (`subtitle`, `showBackButton`) instead of non-existent `description`/`backHref`.
- `client/src/pages/factory/bale-stock-entry/StockEntryScanner.tsx` — real bug fix: rendered `p.grade`, a field that doesn't exist on `FactoryBaleProduct`; now shows `articleCode || code` (consistent with the rest of the row).
- `client/src/pages/factory/bale-stock-entry/StockEntryTab.tsx` — real bug fix: draft-restore logic was reading `cartDraft.cart`/`cartDraft.selectedLocationId` directly, but the draft hook stores the payload under `cartDraft.data`; corrected the access path so restoring a draft actually works. Also fixed `DraftRestorePrompt`'s `age` prop → `draftAge`.
- `client/src/pages/factory/factory-suppliers/factorySupplierTypes.ts` — re-exported `BulkFxPreviewResult` as `BulkFxPreview` (the type existed under a different name in `lib/bulkFxOffline.ts`).
- `client/src/pages/factory/factory-suppliers/SupplierDialogs.tsx` — mutation `.mutate()` calls given explicit `undefined` argument; `overpayment` treated as optional/defaulted where the data shape allows it.
- `client/src/pages/factory/FactoryPendingInvoiceVerify.tsx` — added `ledgerAccountId?: number | null` to local `OrderCharge` type (real `customer_order_charges` column, confirmed via schema).

## Skipped (documented, not fixed — genuine backend/schema mismatches or forbidden areas)
- `client/src/pages/Payroll.tsx` — `employeeGroupId` referenced on the employee record but not present in the actual employee query/schema shape. Real backend mismatch; needs product/API decision, not a type patch.
- `client/src/pages/factory/FactoryPendingInvoiceVerify.tsx` — `stockQty`/`stockTotalWeight` used on `ComparisonItem`, but no backend route ever returns these fields (only `totalWeight`/`loadedQty` exist). Left as-is; feature currently falls back to other averaging tiers already present in the code.
- `client/src/pages/factory/FactorySuppliers.tsx` — `statementData.voucherPayments` has no backend counterpart (the statement endpoint never selects it). Made the field an explicit optional on `StatementResponse` with a comment instead of casting to `any`, so the gap is visible in the type itself; still a pre-existing dead/no-op code path (guarded by `|| []`), not something to invent server-side without a product decision.
- `client/src/pages/factory/FactorySuppliers.tsx` — OB-commission edit dialog's `notes` field: the `/api/factory/suppliers/:id/statement` endpoint's `obCommissions` array never selects a notes/commissionNotes column, so this value was already effectively lost before this cleanup (dialog always showed it empty). The explicit `notes: ""` construction added here preserves that pre-existing behavior; it does not introduce new data loss, but surfacing real commission notes end-to-end (if desired) is a backend change outside this phase's scope.
- `client/src/pages/pos/POS.tsx` — explicitly forbidden by scope; 5 errors remain (`RefObject`/`MutableRefObject` mismatch, `number | null` vs `number` in a few spots).
- All remaining ~394 errors are in `server/**` files (accounting, vouchers, POS, stock, container tracking, SP migration/export services, storage layer) — explicitly forbidden by scope, including the known `unit`/`barcode` stock schema mismatch.

## Verification
- `tsc --noEmit`: 509 → 399 errors, all remaining accounted for above.
- `npm run build`: succeeds.
- Workflow restarted cleanly; app loads.
