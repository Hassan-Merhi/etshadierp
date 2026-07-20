# Program 13 — TypeScript Safety Completion

## Status

Program 13 is complete for all changes that can be made safely without changing accounting, inventory, costing, authorization, or persistence semantics.

The final exact-head audit recorded **8 remaining TypeScript diagnostics across 7 files**. These are not mechanical typing defects. Each one requires an explicit schema, accounting, authorization, or product decision. They are therefore deferred rather than hidden with casts, suppressions, or invented behavior.

## Completed work

- Removed the safe structural TypeScript diagnostics identified through Combos 4A–4F.
- Corrected stale schema-field references where the intended replacement was unambiguous.
- Added precise DTO and query-result typing without changing runtime calculations.
- Preserved fiscal-transfer totals, inventory direction, Supplier Partner formulas, workbook results, voucher posting behavior, and stock lookup semantics.
- Kept strict TypeScript configuration intact.
- Added no broad `any`, `@ts-ignore`, `@ts-nocheck`, or compiler suppression workaround to conceal unresolved decisions.

## Deferred decisions

1. `server/routes/fiscalTransferRoutes.ts`
   - Decide whether stock consumption is an allowed voucher type or must use a dedicated stock-adjustment representation.

2. `server/routes/sp/spContainerRoutes.ts`
   - Three diagnostics depend on the intended Supplier Partner container-to-supplier/accounting association because vouchers no longer persist `supplierId`.

3. `server/storage/inventory/stockItemStorage.ts`
   - Decide whether the legacy barcode API should map to stock code, aliases, or a new persisted barcode field.

4. `server/routes/factory/customer-orders/orderCrudRoutes.ts`
   - Decide whether `defaultShippingCompany` should be restored to the customer schema, derived elsewhere, or removed from the workflow.

5. `server/routes/reportsRoutes.ts`
   - Define the replacement for voucher ownership checks because vouchers no longer persist `userId`.

6. `server/routes/vouchers/voucherQueryRoutes.ts`
   - Define the same voucher ownership/audit model for voucher-query authorization.

## Completion rule

These deferred items must be reopened only after the corresponding product/schema decision is approved. Until then, Program 13 is considered complete-with-deferrals and must not block Programs 14–19.

## Evidence

The final Program 13 audit is documented in `docs/combo-4f-typescript-audit.md`, which records the reduction from 18 to 8 diagnostics with no new diagnostics and identifies every remaining decision explicitly.
