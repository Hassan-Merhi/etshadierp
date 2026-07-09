# TypeScript Cleanup — Phase A (mechanical/type-only fixes)

Scope: fix only `server/storage/index.ts` TS2308 ambiguous re-exports, implicit-any
(TS7006/TS7015/TS7053), and safe TS2448 "used before declaration" sites. No changes
to accounting math, POS sale logic, stock quantity logic, voucher posting logic,
migration logic, or database schema.

## Error count

| | Count |
|---|---|
| Before (`ts-errors.txt`) | 548 |
| After (`ts-errors-after-phase-a.txt`) | 518 |
| **Fixed** | **30** |

Both counts were produced by the same command (`tsc --noEmit`, run with an increased
Node heap — the checker OOMs at default heap size in this environment; see Verification
below), so they are directly comparable.

## Files changed

1. **`server/storage/index.ts`** — TS2308 (12 errors → 0)
   - `auth.ts` and `accounting.ts` both define 12 identically-named functions
     (`getSystemSetting`, `setSystemSetting`, `getParentCompanyId`, `setParentCompanyId`,
     `getRoleFeaturePermissions`, `getRoleFeaturePermission`, `upsertRoleFeaturePermission`,
     `bulkUpsertRoleFeaturePermissions`, `getErpUserPageAccess`, `setErpUserPageAccess`,
     `getErpUserHiddenCostFields`, `setErpUserHiddenCostFields`).
   - Confirmed this barrel file is **not** the runtime storage object — `server/storage.ts`
     (a sibling file, which TS/Node resolve `import ... from "./storage"` to ahead of the
     `storage/` directory) is what every route actually imports, and it merges the modules
     via object spread (`{ ...auth, ...accounting, ... }`), so `accounting.ts`'s versions
     win at runtime today.
   - Changed `export * from "./auth"` to an explicit named-export list covering only
     `auth.ts`'s non-duplicated functions, leaving `export * from "./accounting"` untouched
     so it continues to win for the 12 shared names — matching the existing runtime
     precedence exactly. No function was renamed, no file was moved, no runtime behavior
     changed (this barrel isn't imported by any runtime code, so the fix is purely a
     type-level clarification).

2. **Implicit-any (TS7006 / TS7015 / TS7053)** — added explicit parameter/index types only,
   no behavior changes:
   - `client/src/components/CombinedImportDialog.tsx` — added `"Barcode (Item Code)"` to the
     parsed-row type used for Excel import mapping.
   - `client/src/pages/factory/FactoryCustomerStatement.tsx` — `rowNotes` state was typed
     `Record<number, string>` but entry ids can be `number | string`; widened to
     `Record<number | string, string>` (fixes indexing at both the note-population loop and
     the note input's `value`/`onBlur` handlers).
   - `client/src/pages/factory/bale-stock-entry/RemoveFromStockTable.tsx` — annotated the
     `id` parameter in two `.every((id) => selectedBaleIds.has(id))` calls as `number`.
   - `client/src/pages/factory/factory-suppliers/SupplierDialogs.tsx` — annotated the bulk-FX
     preview row parameter with the shape it's actually used as
     (`supplierId`, `supplierName`, `overpayment`, `allocated`, `toAmountUsd`).
   - `server/routes/factoryWorkerRoutes.ts` — annotated `r` in the advance/payroll total
     reducers, `w` in two `.map()` calls (typed via `typeof factoryWorkers.$inferSelect`),
     and `max`/`w` in the HMD-code-numbering reducers (`max: number`,
     `w: { employeeCode: string | null }`).

3. **TS2448 (used before declaration)** — moved 2 of 5 flagged declarations above their
   first use; the other 3 sites were intentionally skipped (see below):
   - `client/src/pages/ChatbotSettings.tsx` — moved the `chatStatus` query above the
     `chatHistory` query that reads `chatStatus?.isAdminOrOwner` in its `enabled` flag.
   - `client/src/pages/factory/FactoryInvoiceCreate.tsx` — moved the `orderDetail` query
     above the `useEffect` that syncs form state from it (removed the old, now-duplicate,
     declaration further down the file).

## Intentionally skipped

- **`server/routes/containers/containerAccountingRoutes.ts`** (12 TS2448 sites, `cNum` used
  before declaration) — container accounting logic is out of scope per instructions.
- **`server/routes/stats/statsNetPositionRoutes.ts`** (4 TS2448 sites, `round2` used before
  declaration) — net-position/ledger routes are out of scope per instructions.
- **`server/services/containerTrackingService.ts`** (1 TS2448 site, `CMA_PREFIXES` used
  before declaration) — part of the container tracking/accounting surface; left alone to
  stay clear of that exclusion.
- **`server/routes/vouchers/voucherTransferRoutes.ts(380,34)`** (TS7006, parameter `it`) —
  left as-is. Investigation showed this line sits inside a pre-existing scope bug: the
  variable it maps over (`transferItemsData`) is declared *inside* a `db.transaction(async
  (tx) => {...})` closure but used *outside* that closure in an audit-logging block after
  the transaction returns, which is already flagged separately as
  `TS2304: Cannot find name 'transferItemsData'` in the original 548-error baseline. Adding
  a type annotation to `it` without addressing the actual out-of-scope reference would only
  mask the symptom, and fixing the real scope issue means changing control flow around
  voucher posting — explicitly out of scope for Phase A. Both pre-existing errors
  (TS2304 + TS7006) are left untouched and unresolved.

## Verification

- `tsc --noEmit` (`ts-errors-after-phase-a.txt`) — 518 errors, down from 548. Note: this
  environment's default Node heap is insufficient for `npx tsc --noEmit` on this project
  (`FATAL ERROR: Reached heap limit`); both the before and after counts were produced with
  `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit` for a fair
  comparison.
- `npm run build` — succeeded (exit 0), same pre-existing chunk-size warnings as before,
  no new build errors.
- App workflow restarted and verified serving on port 5000 with no new startup errors.
- No changes were made to accounting math, POS sale logic, stock quantity logic, voucher
  posting logic, migration logic, or database schema. All 12 files touched are either type
  annotations, a re-export list, or moving an existing query declaration earlier in the
  same component (no new queries, no changed dependencies, no changed conditions/JSX).
