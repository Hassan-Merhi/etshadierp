# Combo 4G TypeScript Audit

## Scope

Combo 4G reviews the final **8 TypeScript diagnostics across 7 files** after Combo 4F.

## Remaining diagnostics

### Data-model and ownership decisions

- `server/routes/factory/customer-orders/orderCrudRoutes.ts` — customer `defaultShippingCompany` persistence — 1
- `server/routes/reportsRoutes.ts` — voucher ownership/user field — 1
- `server/routes/vouchers/voucherQueryRoutes.ts` — voucher ownership/user field — 1
- `server/routes/sp/spContainerRoutes.ts` — Supplier Partner container supplier/accounting association — 3
- `server/storage/inventory/stockItemStorage.ts` — legacy barcode lookup semantics — 1

### Accounting representation decision

- `server/routes/fiscalTransferRoutes.ts` — stock-consumption voucher representation — 1

## Goal

Resolve each remaining diagnostic using current schema and runtime evidence, without inventing replacement fields or silently changing business behavior. The target is a clean TypeScript baseline only where the intended data model can be proven from existing code and tests.

## Safety boundary

Combo 4G must not change:

- fiscal posting direction, totals, or account selection
- Supplier Partner container ownership or supplier accounting without verified schema/runtime evidence
- customer shipping behavior without a supported persistence path
- voucher ownership semantics by substituting an unrelated field
- barcode/code/alias lookup behavior by guessing
- schema or migrations unless a missing persistence field is conclusively required and separately documented
- TypeScript configuration or broad suppression casts

Each diagnostic will be classified as either a proven code correction, a required schema/data-model change, or an intentionally retained business decision before implementation.