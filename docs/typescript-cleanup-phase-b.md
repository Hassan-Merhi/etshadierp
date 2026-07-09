# TypeScript Cleanup — Phase B (client/UI type errors + missing imports)

Scope: fix only client/UI prop-shape errors, missing client-side type imports, and a
client-only type-name collision, all listed explicitly in the Phase B brief. No server
accounting, stock quantity, POS sale, voucher posting, migration, or container/freight
accounting logic touched; no database schema or Drizzle table definitions touched.

## Error count

| | Count |
|---|---|
| Before (baseline, same as Phase A's "after") | 518 |
| After | 509 |
| **Fixed** | **9** |

Both counts were produced by `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit`
(the default heap OOMs on this project in this environment).

## Files changed (10)

### 1. Client/UI prop-shape errors

- **`client/src/components/sidebar/sidebarPrimitives.tsx`** — `NavSection` had an index
  signature (`[key: string]: any`) but that isn't enough for TS to recognize `devOnly` on
  object-literal spreads (`{...s, items: ...}` in `AppSidebar.tsx`). Added an explicit
  optional `devOnly?: boolean` field to the interface. Fixes
  `AppSidebar.tsx(199,47): Property 'devOnly' does not exist`.
- **`client/src/components/FactorySidebar.tsx`** — `useFactoryVisibleSections`'s return-type
  annotation listed `sections`, `isPinnedVisible`, `isAdmin`, `isDeveloper` but the function
  body already computed and returned a 5th field, `isPrivileged`. Added `isPrivileged: boolean`
  to the annotation (the runtime object literal was already correct — this was a type-only
  omission). Fixes both `FactorySidebar.tsx(253,61)` and `(288,5)`.
- **`client/src/components/ui/dialog.tsx`** — `handleKeyDown` was typed
  `React.KeyboardEvent<HTMLElement>` but is passed to `DialogPrimitive.Content`'s `onKeyDown`,
  which expects `React.KeyboardEvent<HTMLDivElement>` (Radix's `Content` renders a div).
  Narrowed the parameter type to `HTMLDivElement` to match; `e.currentTarget` usage inside
  (passed to `findScrollTarget(el: HTMLElement)`) still type-checks since `HTMLDivElement`
  is a subtype of `HTMLElement`. No behavior change — same runtime event object either way.

### 2. Client missing type imports

- **`client/src/components/vouchers/PrintTemplate.tsx`** — `VoucherEntry` was referenced but
  never defined/imported. This component isn't the schema-level voucher entry — it only
  reads `entry.accountName` and `entry.amount` (both strings) from whatever caller passes in.
  Added a local `VoucherEntry` interface capturing exactly that usage (plus an index signature
  so callers passing richer objects, like `Vouchers.tsx`'s form entries, remain compatible).
  No rendering or prop-passing changed.
- **`client/src/components/vouchers/StockItemCombobox.tsx`** — same issue with `StockItem`;
  the component only reads `.id` and `.name`. Added a local `StockItem` interface with those
  two fields plus an index signature. No rendering/behavior changed. (Note: this component
  currently has no importers anywhere in the app — likely superseded by the differently-named
  `StockItemCombobox` in `voucher-edit/VoucherEditHelpers.tsx` — but fixing its type error was
  in scope regardless of whether it's currently wired up.)

### 3. Client type-name collision (`Location`)

`client/src/pages/LocationInventory.tsx` and its child hooks/components under
`client/src/pages/location-inventory/` had **eight** separate local `interface Location {...}`
declarations (in `LocationGrid.tsx`, `StockGroupsView.tsx`, `LocationDialogs.tsx`,
`LocationInventoryDialogs.tsx`, `useLocationInventoryExports.ts`, `useLocationInventoryQueries.ts`,
`useLocationInventoryMutations.ts`) that were all meant to describe the same real "location"
object but were slightly different shapes (some had extra optional fields, some used index
signatures, some didn't). When values flowed between these files as props/callbacks, TypeScript
correctly flagged the shapes as structurally incompatible even though the error message printed
the same name (`Location`) on both sides, which is what looked like a "collision."

Fix: renamed the canonical type in `locationInventoryTypes.ts` from `Location` to
`InventoryLocation` (kept a `@deprecated` `type Location = InventoryLocation` alias for any
external references), and replaced every duplicated local `interface Location {...}` across
the eight files above with `import type { InventoryLocation as Location } from "./locationInventoryTypes"`.
Files that already imported the canonical type (`LocationInventoryBreadcrumb.tsx`,
`LocationInventoryMovementFilter.tsx`, `useLocationInventoryState.ts`, `LocationInventory.tsx`)
were updated to import `InventoryLocation as Location` too, so every file in this feature now
shares one identical type. This eliminates the structural mismatches. Fixes
`LocationInventory.tsx(87,5)`, `(288,17)`, `(289,17)`.

No API calls, inventory math, stock display logic, or selected-location behavior changed —
every edit is either an import line or a type-only alias; the local variable name `Location`
used throughout each file's existing code is unchanged, so no call sites needed edits.

## Intentionally skipped

Nothing else in the allowed list needed a skip — all 9 target errors were fixed. Per the brief,
no `server/routes/containers/*`, `server/routes/vouchers/*`, `server/routes/ledgerRoutes.ts`,
`server/routes/stats/*`, `server/routes/stock/*`, `server/services/pos/*`, `client/src/pages/pos/POS.tsx`,
stock item schema mismatches (`unit`/`barcode`), or database/Drizzle schema files were touched.

Other pre-existing errors observed in the same `tsc` run (e.g. `Customers.tsx`, `Payroll.tsx`,
`UserListTable.tsx`, `ERPRunPayroll.tsx`, `FactoryCustomers.tsx`) were confirmed present in the
pre-Phase-B baseline too (only the printed union-type ordering in the message differs run-to-run,
a known `tsc` output quirk) — none of these are new, and none were touched.

## Verification

- `tsc --noEmit` (increased heap): 518 → 509 errors, all 9 target errors gone, no new errors
  introduced by the Phase B edits.
- `npm run build` — succeeded (exit 0), same pre-existing chunk-size warnings, no new build
  errors.
- App workflow restarted and confirmed serving on port 5000 with no new startup errors.
- No changes were made to business logic, API contracts, database schema, accounting math,
  POS logic, or stock quantity/display behavior. Every change is a type annotation, an added
  local interface, or an import-path substitution for an existing (renamed) type.
