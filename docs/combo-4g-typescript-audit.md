# Combo 4G TypeScript Audit

## Scope

Combo 4G resolved the final **8 TypeScript diagnostics across 7 files** after Combo 4F.

## Result

- Starting baseline: **8 diagnostics across 7 files**
- Final baseline: **0 diagnostics across 0 files**
- Removed: **8 diagnostics**
- New diagnostics: **0**
- TypeScript roadmap status: **clean**

## Implemented data-model decisions

### Customer shipping company

- Kept `shippingCompany` persisted on the customer order, where the supported field exists.
- Removed the swallowed update to nonexistent `customers.defaultShippingCompany`.
- Existing order assignment behavior remains unchanged.

### POS voucher ownership

- Replaced stale `voucher.userId` checks with the real ownership path: `vouchers.shiftId -> pos_shifts.userId`.
- POS users remain restricted to Sales vouchers created through their own shift.
- Company ownership checks remain in place.

### Supplier Partner container supplier association

- Removed nonexistent `supplierId` writes from voucher headers.
- Associated the supplier with the OTW clearing credit entry through the supported `voucher_entries.supplierId` field.
- Debit/credit amounts, accounts, dates, descriptions, and container links were not changed.

### Barcode lookup

- Preserved the legacy `getStockItemByBarcode` API as a compatibility wrapper.
- Routed it through `getStockItemByCodeOrAlias`, matching the existing barcode-import flow that stores barcodes in `stock_item_code_aliases`.

### Waste-dispatch consumption voucher

- Added the already-used runtime voucher type `Consumption` to the voucher insert validator.
- Made the existing database defaults explicit as `currency: "USD"` and `sourceModule: "ERP"`.
- Waste quantities, stock-adjustment direction, expense account, rates, and totals were not changed.

## Safety boundary maintained

Combo 4G did **not** change:

- fiscal posting direction, totals, or account selection
- stock-adjustment quantities or inventory direction
- Supplier Partner voucher amounts or OTW account selection
- customer-order container/shipping fields
- POS sale totals or shift assignment
- database tables or migrations
- TypeScript configuration or suppression rules

## Validation

Exact production-code CI through temporary PR #37 passed completely:

- TypeScript check
- production build
- lint
- test database schema setup
- application startup migrations
- backend tests
- frontend tests
- frontend coverage thresholds
- format check

Temporary patch scripts and workflows were removed. Temporary validation PRs #36 and #37 were not merged and were closed after validation.