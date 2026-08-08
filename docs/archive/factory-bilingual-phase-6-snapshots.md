# Factory bilingual catalog — Phase 6 linked snapshots

Phase 6 makes Arabic catalog text available beyond Bale Explorer without changing commercial or accounting data.

## Live/current propagation

Successful Factory writes for bales, proformas, customer orders, loading records, dispatch scans, POS rows, and recode rows run through one company-scoped snapshot service. The resolver uses:

1. product ID when the linked record has one;
2. normalized exact article code when product ID is absent;
3. no name-based or fuzzy matching.

New/current rows receive the catalog Arabic product snapshot. `factory_bales` also receives the Arabic category snapshot. Existing English snapshots are never rewritten by this service.

When a product Arabic name changes, current non-finalized linked rows are refreshed. Finalized, sold, dispatched, completed, invoiced, cancelled, historical, and POS/recode audit rows remain frozen.

## Historical repair

Two protected endpoints are available:

- `GET /api/factory/bilingual-snapshots/diagnose`
- `POST /api/factory/bilingual-snapshots/backfill`

The POST endpoint is dry-run by default and reports each supported table with:

- missing Arabic snapshots;
- safely resolvable rows;
- orphaned/unresolvable rows;
- finalized rows.

Apply requires Admin/Owner/Developer access, `act_import_data`, and the exact confirmation `APPLY_ARABIC_SNAPSHOT_BACKFILL`. It runs in a database transaction under a company advisory lock and records before/apply/after details in the durable audit log.

Default apply behavior fills missing snapshots only and excludes finalized records. Historical finalized snapshots can be filled only with explicit `includeFinalized: true`. Existing manually stored Arabic snapshots are preserved unless `overwrite: true` is explicitly supplied.

## Covered Phase 2 snapshot columns

- `factory_bales.product_name_ar` and `category_ar`
- `customer_proforma_lines.product_name_ar`
- `customer_order_lines.bale_name_ar`
- `customer_order_bales.bale_name_ar`
- `customer_order_bales_history.bale_name_ar`
- `customer_order_expected_lines.product_name_ar`
- `factory_pos_sale_items.product_name_ar`
- `customer_order_bale_removals.product_name_ar`
- `factory_v3_load_bales.product_name_ar`
- `factory_invoice_loading_bales.product_name_ar`
- `customer_dispatch_bale_scans.product_name_ar`
- `bale_recode_items.product_name_ar`

Optional module tables are detected through `information_schema`; an absent optional module does not block the remaining repair.

## Safety

The service updates Arabic snapshot text only. It does not write English names, article codes, category assignments, quantities, weights, prices, costs, allocations, stock, statuses, vouchers, journals, balances, or payments.
