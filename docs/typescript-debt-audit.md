# TypeScript Debt Audit

_Audit only — no business logic, schema, or route behavior was changed to produce this report._

Generated from: `npm run check 2>&1 | tee ts-errors.txt` (raw output preserved at repo root as `ts-errors.txt`).

## 1. Total error count

**548 TypeScript errors** (`tsc --noEmit`), spread across **143 files**.

This count matches the pre-existing baseline observed across all recent sessions (GC-LSHI migration route work, tsconfig `ignoreDeprecations` fix) — none of that work added or removed any of these errors.

## 2. Top 20 files by error count

| # | File | Errors |
|---|---|---|
| 1 | `server/routes/containers/containerAccountingRoutes.ts` | 30 |
| 2 | `server/routes/customerRoutes.ts` | 17 |
| 3 | `client/src/pages/factory/FactoryInvoiceLoadingScan.tsx` | 17 |
| 4 | `server/routes/containers/containerFreightWriteRoutes.ts` | 15 |
| 5 | `server/storage/index.ts` | 12 |
| 6 | `server/routes/supplierRoutes.ts` | 12 |
| 7 | `server/routes/stock/stockGroupsItemsRoutes.ts` | 12 |
| 8 | `server/routes/factory/factoryStockAllocationV3Routes.ts` | 12 |
| 9 | `server/routes/ledgerRoutes.ts` | 11 |
| 10 | `server/routes/chatbotRoutes.ts` | 11 |
| 11 | `server/routes/bankAssetRoutes.ts` | 11 |
| 12 | `server/routes/factoryWorkerRoutes.ts` | 10 |
| 13 | `server/chatService.ts` | 10 |
| 14 | `server/routes/stats/statsNetProfitRoutes.ts` | 9 |
| 15 | `server/routes/factory/factoryContainerTrackingRoutes.ts` | 9 |
| 16 | `server/routes/authRoutes.ts` | 9 |
| 17 | `server/routes/vouchers/voucherSalesUpdateRoutes.ts` | 8 |
| 18 | `server/routes/stats/statsNetPositionRoutes.ts` | 8 |
| 19 | `server/routes/passkeyRoutes.ts` | 8 |
| 20 | `server/routes/factory/factoryMixBatchRoutes.ts` | 8 |

The remaining 123 files each have 1–7 errors (long tail — see `ts-errors.txt` for the full breakdown).

## 3. Top error codes by count

| Code | Count | Meaning | Category |
|---|---|---|---|
| TS2339 | 97 | Property does not exist on type | Missing property |
| TS2741 | 88 | Property missing in type but required | Missing property (object literal) |
| TS2322 | 55 | Type not assignable | Wrong/nullable type |
| TS2345 | 53 | Argument type not assignable to parameter | Wrong/nullable type (call site) |
| TS2769 | 46 | No overload matches this call | Route/overload issue (mostly Express handlers & Drizzle query builders) |
| TS2304 | 38 | Cannot find name | Import/export issue |
| TS18048 | 34 | Value is possibly `undefined` | Nullable value |
| TS2352 | 32 | Conversion of type may be a mistake | Unsafe cast (`as X` on unrelated types) |
| TS2448 | 19 | Block-scoped variable used before declaration | Ordering/hoisting bug |
| TS2308 | 12 | Module has already exported a member (ambiguous re-export) | Import/export issue |
| TS7006 | 11 | Parameter implicitly has an `any` type | Implicit any |
| TS2454 | 9 | Variable used before being assigned | Nullable value |
| TS2353 | 9 | Object literal may only specify known properties | Wrong schema type |
| TS2367 | 7 | Comparison appears unintentional (no overlap) | Logic/type mismatch |
| TS18046 | 7 | Value is of type `unknown` | Nullable/unknown value |
| TS2554 | 5 | Expected N arguments, got M | Wrong call signature |
| TS2551 | 5 | Property does not exist, did you mean ...? | Missing property (typo-like) |
| TS18004 | 4 | No value exists in scope for shorthand property | Import/export issue |
| TS7015 | 3 | Element implicitly has an `any` type (index signature) | Implicit any |
| TS2503 | 3 | Cannot find namespace | Import/export issue |
| TS2365 | 3 | Operator cannot be applied to types | Wrong/nullable type |
| TS2305 | 2 | Module has no exported member | Import/export issue |
| TS7053 | 1 | Element implicitly has an `any` type (indexing) | Implicit any |
| TS2552 | 1 | Cannot find name, did you mean ...? | Import/export issue (typo) |
| TS2459 | 1 | Module declares locally but not exported | Import/export issue |

### Category rollup (approximate, by dominant code mapping)

| Category | Approx. count | Codes |
|---|---|---|
| Missing property | ~185 | TS2339, TS2741, TS2551 |
| Wrong/nullable value type | ~152 | TS2322, TS2345, TS18048, TS2454, TS18046, TS2365 |
| Route/overload issue | 46 | TS2769 |
| Import/export issue | ~56 | TS2304, TS2308, TS18004, TS2503, TS2305, TS2552, TS2459 |
| Unsafe cast | 32 | TS2352 |
| Ordering/hoisting bug | 19 | TS2448 |
| Wrong schema type (object literal) | 9 | TS2353 |
| Implicit any | 15 | TS7006, TS7015, TS7053 |
| Wrong call signature | 5 | TS2554 |
| Logic/comparison mismatch | 7 | TS2367 |

## 4. Safe quick fixes (low risk, no behavior change)

These are almost entirely type-annotation-only fixes — the runtime code path is untouched:

- **TS7006 / TS7015 / TS7053 (implicit any, 15 errors)** — add explicit parameter/element types (e.g. `(id: number) =>`, `(r: SomeRowType) =>`). Purely additive; zero runtime risk.
- **TS2308 in `server/storage/index.ts` (12 errors, all from `"./auth"` re-export ambiguity)** — a single barrel-file fix: use explicit named re-exports (`export { x } from "./auth"`) instead of `export *` to resolve the duplicate-export ambiguity. Mechanical, one file, no logic touched.
- **TS2448 "used before declaration" (19 errors)** — reordering `const`/`let` declarations above their first use. Pure ordering fix; in most cases (e.g. `ChatbotSettings.tsx`, `containerAccountingRoutes.ts`'s `cNum`) this is a straightforward hoist-up with no semantic change, though each site should still be read to confirm the variable isn't reassigned in between.
- **TS2352 "unknown-first" casts in test/report code** (e.g. `TrackingSheets.tsx` casting `Response` directly to a typed array) — insert `as unknown as X` or, better, actually `await res.json()` before casting. Low risk where it's clearly a forgotten `.json()` call (several of the 32 look like this pattern).
- **Client-only prop/type mismatches in UI components** (`AppSidebar.tsx`, `FactorySidebar.tsx`, `ui/dialog.tsx`, `LocationInventory.tsx` callback signature mismatches) — these are prop-shape/type widening issues in presentational code, not data logic. Safe to tighten types without behavior change.
- **`VoucherEdit.tsx` `number | null` vs `number` (2 errors)** — likely a form-state initialization needing `?? 0` or optional-chaining on read only; still worth a quick manual check since it's adjacent to voucher data, but the fix itself is type-only if the underlying value is already guaranteed non-null at that point.

**Estimated safe-fix count: ~100–120 errors** across the above categories, touching only type annotations, import statements, and declaration order — no query logic, no schema, no business rules.

## 5. Risky fixes — touch accounting / POS / stock / migration logic

These require actually reading and possibly changing business logic, schema usage, or query shape, not just type annotations:

- **`server/routes/containers/containerAccountingRoutes.ts` (30 errors)** and **`containerFreightWriteRoutes.ts` (15 errors)** — container/freight accounting posting logic. TS2339/TS2741/TS2769 errors here likely reflect real drift between the schema and the code's assumed shape (e.g. accessing fields that don't exist on the inferred Drizzle row type). Needs careful review against `shared/schema` before touching.
- **`server/routes/stock/stockGroupsItemsRoutes.ts` (12)**, **`server/storage/inventory/locationInventoryStorage.ts`** and **`server/storage/inventory/stockItemStorage.ts`** (TS2339 on `stock_items.unit` / `stock_items.barcode`) — these specifically say the columns `unit` and `barcode` don't exist on the `stock_items` table type. This is either a genuine schema/code mismatch (column renamed or dropped) or a stale Drizzle type — **must verify against the live schema** before any fix, since it directly affects stock item read/write paths.
- **`server/routes/ledgerRoutes.ts` (11)**, **`server/routes/stats/statsNetProfitRoutes.ts` (9)**, **`server/routes/stats/statsNetPositionRoutes.ts` (8)**, **`server/helpers/calculateNetPositionAsOf.ts`** — ledger/net-position calculation code. Errors here can mask real accounting bugs (e.g. nullable balances treated as definite numbers via TS18048/TS2454) — fixing the type without checking the underlying math risk silently changing computed figures.
- **`server/routes/vouchers/voucherSalesUpdateRoutes.ts` (8)**, `voucherJournalRoutes.ts`, `voucherTransferRoutes.ts`, `voucherCreateRoutes.ts`, `voucherPaymentRoutes.ts`, `voucherQueryRoutes.ts`, `voucherEntryRoutes.ts` — voucher posting/entry logic, the accounting engine's core write path. Any type fix here should go through the "flag as latent bug, don't reshape blindly" rule from prior sessions' notes, since several of these routes are accounting-critical.
- **`server/routes/factory/factoryStockAllocationV3Routes.ts` (12)** and related V2/V5 allocation routes — factory stock allocation, a business-critical inventory flow; TS2769 "no overload matches" errors here often indicate a query builder call is being fed the wrong shape.
- **`client/src/pages/pos/POS.tsx` (5)** — live POS screen; even small prop/type fixes here should be tested against an actual sale flow before merging.
- **`server/services/pos/edit/updateSaleService.ts` (1)** and **`employeeAttendanceRoutes.ts` (3, `QueryResult → any[]` unsafe casts)** — casts here are hiding the real shape of a raw SQL result; fixing requires confirming what `pool.query()` actually returns for that query, not just satisfying the compiler.
- **`server/routes/sp/spContainerRoutes.ts` (3)** — Supplier Partner container logic, adjacent to the recent GC-LSHI migration work; low error count but same domain, so any fix should be reviewed against the SP container/supplier linking conventions already documented in memory.
- **`server/routes/customerRoutes.ts` (17)** and **`server/routes/supplierRoutes.ts` (12)** — many of these come from a shared pattern: an insert/update payload object literal not matching the full Drizzle-inferred insert type (`TS2741`/`TS2353`). This looks systemic (likely the same helper or pattern reused across both files) and worth fixing as one unit rather than file-by-file, but it does touch customer/supplier ledger-account creation paths.

**Estimated risky-fix count: ~250–300 errors**, concentrated in accounting, inventory, voucher, and factory-allocation code.

The remaining errors (~130–150) are moderate risk — mostly report/export/chat/factory-worker routes (`chatbotRoutes.ts`, `chatService.ts`, `factoryWorkerRoutes.ts`, `authRoutes.ts`, `passkeyRoutes.ts`, `bankAssetRoutes.ts`) that don't touch core accounting math but do touch auth, payroll, or bank data, so still deserve individual review rather than bulk fixing.

## 6. Recommended fix order (safest → riskiest)

1. **`server/storage/index.ts` TS2308 barrel re-export ambiguity** (12 errors, 1 file, purely mechanical) — do this first; it's isolated and has no runtime effect.
2. **Implicit-any parameters (TS7006/TS7015/TS7053, 15 errors)** — add types, no logic change, spread across many small files.
3. **TS2448 "used before declaration" (19 errors)** — reorder declarations; verify no reassignment happens in between before moving.
4. **Presentational/UI-only prop-type mismatches** (sidebar components, dialog.tsx, LocationInventory callback signatures, VoucherEdit null-handling) — client-side, no server data risk.
5. **Auth/session/passkey/chat routes** (`authRoutes.ts`, `passkeyRoutes.ts`, `chatbotRoutes.ts`, `chatService.ts`, `bankAssetRoutes.ts`) — touch permissions and integrations but not the accounting engine; review each fix against actual login/permission behavior before merging.
6. **Factory worker / factory tracking / factory mix-batch routes** — business logic but isolated to the factory module; moderate blast radius.
7. **Customer/Supplier route object-literal shape issues** (`customerRoutes.ts`, `supplierRoutes.ts`) — likely one shared root cause; fix as a batch with care since it touches ledger-account creation for customers/suppliers.
8. **Stock/inventory schema mismatches** (`stockGroupsItemsRoutes.ts`, `locationInventoryStorage.ts`, `stockItemStorage.ts` — the `unit`/`barcode` column errors) — **verify against live schema first**; these might indicate a real drift, not just a stale type.
9. **Container accounting & freight routes** (`containerAccountingRoutes.ts`, `containerFreightWriteRoutes.ts`, `containerFreightReadRoutes.ts`, `containerCrudRoutes.ts`, `containerTrackingService.ts`) — highest single-file error concentration; needs a dedicated review pass against the accounting posting rules already documented in memory (same-company freight posting, SP intercompany charges) before any type fix is applied.
10. **Voucher posting/entry routes and ledger/net-position calculators** (`voucherSalesUpdateRoutes.ts` and siblings, `ledgerRoutes.ts`, `statsNetProfitRoutes.ts`, `statsNetPositionRoutes.ts`, `calculateNetPositionAsOf.ts`) — the accounting engine's core; fix last, one route at a time, with backend tests run after each change.
11. **Factory stock allocation V2/V3/V5 routes and POS.tsx** — business-critical live inventory/sale flows; riskiest tier, should be done last and validated with the existing regression test suite (`npm run test:backend`) after each batch.

## 7. GC migration cleanup — any errors caused by it?

**No.** `ts-errors.txt` contains zero references to `spMigrationRoutes.ts`, `GcLshiMigration.tsx`, `sp_migration_source_links`, or any other file touched during the GC-LSHI → Supplier Partner migration cleanup work. The 548-error count is identical to the baseline measured before, during, and after that work in prior sessions — the migration route consolidation (`buildGcMigrationPreview`, the `/gc-preview` and `/preview` aliases, the `410`-disabled rehearsal route) introduced no new type errors and fixed none of the pre-existing ones.

---

_Raw compiler output: `ts-errors.txt` (repo root, 548 `error TS` lines). This report is descriptive only — no fixes were applied._
