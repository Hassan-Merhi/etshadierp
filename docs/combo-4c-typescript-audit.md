# Combo 4C TypeScript Audit

## Scope

Combo 4C covers container accounting, purchase-order freight read/write routes, and factory-container freight voucher typing. The starting point is the merged Combo 4B baseline on `main` commit `716fa60862f01b1b838d7bc97cef30bcda3e7b5a`.

## Verified baseline

- **141 TypeScript diagnostics across 28 files**
- **53 container-related diagnostics across 5 files plus Supplier Partner container routes**

## Safe production candidates

Exactly **50 diagnostics across 4 production files** are mechanical schema/scope mismatches:

- `server/routes/containers/containerAccountingRoutes.ts` — 30
- `server/routes/containers/containerFreightReadRoutes.ts` — 6
- `server/routes/containers/containerFreightWriteRoutes.ts` — 11
- `server/routes/factory/factoryContainersRoutes.ts` — 3

Planned corrections:

- Remove `companyId` only from `voucherEntries` insert objects because company ownership is stored on the parent `vouchers` row and `voucher_entries` has no `company_id` column.
- Replace the undefined single-container alias `poContainerRow` with the already-authorized `container` row.
- Hoist `cNum` and `isSameCompanyPo` to the purchase-order loop scope before their first use.
- Use the actual `po_line_items.poId` schema field instead of the removed `purchaseOrderId` name.
- Import the existing `InsertPurchaseOrder` type used by the restricted update payload.
- Use `existingPO.companyId` in the own-freight voucher block where no local `companyId` variable exists.

## Deliberately deferred

`server/routes/sp/spContainerRoutes.ts` has 3 diagnostics because `supplierId` is being written to the `vouchers` header even though supplier association exists only on `voucher_entries`. Moving or deleting that value could change Supplier Partner supplier statements or OTW-clearing semantics, so it requires a domain/data-model review rather than a mechanical TypeScript correction.

No tracking diagnostics remain in the current baseline.

## Safety boundary

Combo 4C must not change freight amounts, purchase-order totals, Dr/Cr direction, account selection, intercompany behavior, supplier balances, container status, ETA/tracking behavior, schema, or migrations. No broad `any`, `@ts-ignore`, `@ts-nocheck`, or TypeScript configuration weakening is permitted.

## Validation target

After the safe patch, the expected baseline is **91 diagnostics across 24 files**, with zero diagnostics in the four modified production files and the three deferred Supplier Partner container diagnostics still visible.