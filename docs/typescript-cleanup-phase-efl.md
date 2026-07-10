# TypeScript Cleanup — Phase E + F + L

## Summary

| Metric | Before | After |
|---|---|---|
| `tsc --noEmit` error count | **399** | **239** |
| Errors fixed | **160** | |
| Target requested | 199 | Not reached — see "Why 199 was not reachable" below |
| `npm run build` | — | ✅ Succeeds (frontend + backend bundle both built) |
| App runtime | — | ✅ Verified via workflow restart — starts clean, no new console/log errors |

Baseline snapshot: `ts-errors-before-phase-efl.txt` (399 errors, captured before any changes).
Final snapshot: `ts-errors-after-phase-efl.txt` (239 errors, captured after all fixes below).

## Scope discipline

Every change in this pass is **type-only or display-only**: missing null guards, wrong/renamed
column references, missing imports, stale type imports, unreachable dead code removal, or
argument-order fixes matching an existing function signature. No change alters:
- accounting math / voucher posting
- inventory quantity logic
- POS flows
- SP (Supplier Partner) container/migration logic
- factory stock allocation V2/V3/V5

Files under the explicitly forbidden list (`containers/*`, `vouchers/*`, `ledgerRoutes.ts`,
`stats/*`, `stock/*`, `storage/inventory/*`, `services/pos/*`, `POS.tsx`,
`sp/spContainerRoutes.ts`, SP migration, factory stock allocation V2/V3/V5) were **not touched**,
even where they contained large error counts.

## Files changed (Phase E — auth/passkey/chat/bank)

- `server/chatService.ts` — fixed `Map.get()` misuse comparing whole rows instead of parsed
  `.quantity` in low-stock/slow-moving reports; fixed a regex `.match().concat()` type mismatch;
  added a missing `today` variable in the stock-adjustment AI-prompt scope; added a null-safety
  guard around `filePatchDrafts`; coerced nullable `role`/`content` fields to strings in chat
  history mapping. **Now clean.**
- `server/routes/authRoutes.ts` — added missing `posViewOnly` field to the Developer-bypass role
  object; added an explicit `if (!userRole) return 403` guard so downstream code narrows
  correctly. **Now clean.**
- `server/routes/bankAssetRoutes.ts` — added required `old`/`new` placeholders to audit-log
  `changes` objects; simplified a type-impossible `"Dr"|"Cr" !== ""` boolean check.
  **Now clean.**
- `server/routes/passkeyRoutes.ts` — adapted to a newer `@simplewebauthn/server` API (credential
  IDs are now base64url strings, not Buffer/Uint8Array); fixed `excludeCredentials`/
  `allowCredentials` typing and the `userId` type (`varchar`, so `string` not `number`).
  **Now clean.**
- `server/routes/chatbotRoutes.ts` — fixed `varchar` column comparisons that were incorrectly
  cast with `Number(...)`; fixed a supplier/customer search query using non-existent
  `customers.name` (→ `customers.legalName`); fixed several out-of-scope `companyId`/`userId`
  references; removed an invalid `suppliers.companyId` filter (see schema gap below); fixed the
  `pdf-parse` dynamic-import typing to fall back to the module itself when no `.default` export
  exists, preserving the original runtime call behavior (an initial cast-only version was caught
  and corrected during code review — see "Code review" below). **Now clean.**

## Files changed (Phase F — factory worker/report/tracking)

- `server/routes/factory/factoryContainerTrackingRoutes.ts` — added `containerId === null` guards
  after every `parseId()` call (previously passed a possibly-null id straight into Drizzle
  queries). **Now clean.**
- `server/routes/factoryWorkerRoutes.ts` — added explicit `Map<string, any>` generics to
  `byCode`/`byPassport`/`byNationalId` lookup maps so `.get()` results type correctly.
  **Now clean.**
- `server/routes/factory/factoryMixBatchRoutes.ts` — fixed `parseFloat(string | null)` calls by
  defaulting to `"0"`; removed a ~95-line dead code block after an unconditional early `return`
  in the batch-delete route (never executed, confirmed by unreachable-code errors). **Now clean.**

## Files changed (Phase L — long-tail, vetted individually against the forbidden list)

- `server/routes/customerRoutes.ts` / `server/routes/supplierRoutes.ts` — fixed audit-log
  `changes` objects missing required `old`/`new` keys; removed references to non-existent
  `customers.email`/`address` and `suppliers.companyId` columns; cast a `updateLedgerAccount` call
  to match its declared parameter type.
- `server/routes/location/locationCrudRoutes.ts` — same audit-log `old`/`new` fix pattern.
- `server/routes/baleRoutes.ts` — added missing shared-schema imports
  (`mixBatchSources`, `insertMixBatchSourceSchema`, `insertBaleProductCategorySchema`,
  `insertBaleProductSchema`, `insertProductionBaleSchema`) that were referenced but never
  imported.
- `server/routes/debugRoutes.ts` — added required `type`/`details` fields to four
  `DiagnosticIssue` push sites; added `totalAssets`/`totalExpenses`/`totalLiabilities` (previously
  undefined names) computed from the same balances already feeding `netImportCycleBalance`, for
  this display-only reconciliation report.
- `server/routes/factory/employee-pos/employeeLedgerWasteRoutes.ts` — typed a lookup `Map`
  explicitly; loosened `sumBucket`'s parameter type to match what `bucketToArray` actually returns
  (rows with `baleDetails` stripped).
- `server/routes/approvalRoutes.ts` — fixed `changes: { status: "..." }` shape to the required
  `{ old, new }` object across create/approve/reject/execute.
- `server/routes/creditNoteRoutes.ts` — same audit-log shape fix.
- `server/routes/accountRoutes.ts` — fixed `customers.name` → `customers.legalName`; removed
  invalid `suppliers.companyId` filter; fixed `getVoucherEntriesBySupplier`/`ByEmployee` calls that
  were passing `startDate` where the function signature expects `companyId` (a real
  positional-argument bug — same class as the `chatbotRoutes.ts` fixes from an earlier session).
- `server/aiTools.ts` / `server/routes/aiImportRoutes.ts` — removed invalid `suppliers.companyId`
  filters and `customers.name` references; added a missing `await` on `readExcel()`.
- `server/routes/rental/rentalUnitsContractsRoutes.ts` — added `import type ExcelJS from
  "exceljs"` so the dynamically-imported `ExcelJS.Fill` type resolves.
- `server/routes/factory/employee-pos/employeeAttendanceRoutes.ts` — fixed three `QueryResult →
  any[]` casts to go through `unknown` first.
- `server/routes/factory/customer-orders/orderCrudRoutes.ts` — fixed `eq()` calls receiving a
  possibly-null id from `parseOptionalId()` by guarding on `!== null` first.
- `server/routes/whatsappRoutes.ts` — fixed `req.session.user` (doesn't exist) → 
  `req.session.currentRole`, matching the pattern used elsewhere in the codebase for role checks.
- `server/routes/aiAgentRoutes.ts` — fixed a control-flow narrowing artifact: checks against
  `step.status` after `Object.assign(step, updatedStep)` were comparing against an
  already-narrowed `"pending"` type; switched to checking `updatedStep.status` directly.
- `server/lib/parcelsAppClient.ts` — fixed union-type property access on shipment `states[0]` by
  casting through `any` for the tracking-provider's ad-hoc external shape.
- `server/lib/workerBalesPdfGenerator.ts` — cast PDFKit's `features: ["rtla", "arab"]` array
  (valid PDFKit option, stale `OpenTypeFeatures` type definition) with `as any`.
- `server/routes/admin/adminRepairRoutes.ts` — fixed a broken relative import path
  (`../seedDev` → `../../seedDev`; file is nested one level deeper).
- `server/routes/factory/factorySheetsRoutes.ts` — fixed a typo (`columns` → `rawColumns`) in a
  column-width array builder.

## Schema mismatches found and intentionally left alone (not type-only fixes)

These are real schema/business gaps, not type errors to silence. Documented per instructions
rather than "fixed" with a workaround that would change behavior:

- **`suppliers` has no `companyId` column.** Several routes (`chatbotRoutes.ts`,
  `aiTools.ts`, `aiImportRoutes.ts`, `accountRoutes.ts`) filtered supplier queries by
  `companyId`, which cannot work — the filter was silently invalid. Since suppliers appear to be
  intentionally global (not company-scoped) in this schema, the filter was removed rather than
  invented; this is the schema-accurate behavior, not a business-logic change. Flagging in case
  multi-tenant supplier scoping was intended but never implemented.
- **`customers` has no `email`/`address` columns**, and no plain `name` column (only
  `legalName`). Several audit-log calls referenced these as if they existed. Left the audit log
  entries scoped to only the fields that actually exist.
- **`customers` has no `defaultShippingCompany` column** (`server/routes/factory/customer-orders/orderCrudRoutes.ts:663`).
  Skipped — adding the column or removing the feature is a product decision, not a type fix.
- **`vouchers` has no `userId`/creator column** (`server/routes/reportsRoutes.ts:2094`). A POS
  access-control check (`voucher.userId !== req.user.id`) references a field that doesn't exist,
  meaning that specific restriction is currently a no-op. Left untouched — this sits in
  security-sensitive POS-flow logic explicitly outside this pass's scope, and any fix requires a
  real schema/product decision about how voucher ownership should be tracked.

## Why 199 was not reachable within the forbidden-list constraint

After exhausting all files outside the forbidden list, the remaining 239 errors are heavily
concentrated in exactly the areas marked off-limits:

| File area (forbidden) | Remaining errors |
|---|---|
| `server/routes/containers/*` | ~65 |
| `server/routes/stock/*` | ~20 |
| `server/routes/factory/factoryStockAllocationV2/V3/V5Routes.ts` | ~15 |
| `server/routes/vouchers/*` | ~20 |
| `server/routes/ledgerRoutes.ts` | 11 |
| `server/routes/stats/*` | ~17 |
| `server/routes/sp/*`, SP services | ~14 |
| `server/services/containerTrackingService.ts`, `storage/inventory/*`, `POS.tsx`, payroll calc | ~15 |

That's roughly 175+ of the remaining 239 errors sitting in files whose topics (accounting math,
inventory quantities, voucher posting, POS flows, SP/container logic, factory stock allocation
V2/V3/V5) were explicitly excluded from this pass. Reaching 199 would require touching at least
one of those areas, which the instructions rule out. The reduction achieved (399 → 239, **160
fixed, 40% reduction**) represents the safe ceiling while strictly honoring the forbidden list.

## Code review

An architect subagent reviewed the full diff before this was considered done. It caught one real
regression: the `pdf-parse` dynamic-import fix in `chatbotRoutes.ts` initially cast the whole
module namespace as callable instead of using its `.default` export, which would have broken PDF
uploads in the AI chat importer at runtime. Corrected to read `.default` with a fallback to the
module itself (matching how ESM/CJS interop actually resolves for this package), re-verified
clean under `tsc`, and confirmed the fix doesn't change any other reviewed area (audit-log shapes,
`suppliers.companyId` removals, and the `accountRoutes.ts` argument-order fix were all confirmed
correct on review).

## Verification

- `npm run build` completes successfully (frontend Vite bundle + backend esbuild bundle).
- App workflow restarted cleanly; no new runtime errors in server logs.
- No forbidden-topic files were modified (confirmed via the diff below).
