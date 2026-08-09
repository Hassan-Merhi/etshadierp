# Factory bilingual bale catalog — Phase 2 schema

Issue: #347  
Status: Phase 2 complete  
Scope: additive Arabic catalog fields, bilingual copied-name snapshots, migration registration, startup compatibility, and Unicode round-trip verification.

## Schema additions

### Catalog

- `factory_categories.name_ar`
- `factory_bale_products.name_ar`
- `factory_bale_products.description_ar`

### Core copied-name snapshots

- `factory_bales.product_name_ar`
- `factory_bales.category_ar`
- `customer_proforma_lines.product_name_ar`
- `customer_order_lines.bale_name_ar`
- `customer_order_bales.bale_name_ar`
- `customer_order_bales_history.bale_name_ar`
- `customer_order_expected_lines.product_name_ar`

### Additional linked operational snapshots identified in Phase 1

- `factory_pos_sale_items.product_name_ar`
- `customer_order_bale_removals.product_name_ar`
- `factory_v3_load_bales.product_name_ar`
- `factory_invoice_loading_bales.product_name_ar`
- `customer_dispatch_bale_scans.product_name_ar`
- `bale_recode_items.product_name_ar`

All fields are nullable. Existing English fields remain required or optional exactly as before, and no existing row is rewritten by this phase.

## Article-code matching support

The existing company/article-code unique index remains unchanged. Phase 2 adds the non-unique expression index:

`factory_bale_products_company_article_code_normalized_idx`

It indexes `company_id` with `UPPER(BTRIM(article_code))`, matching the Phase 1 contract: trim surrounding whitespace and uppercase only. Punctuation and leading zeroes are preserved.

The normalized index is deliberately non-unique. Existing databases may contain codes that differ only by case or surrounding whitespace; Phase 4 will report those conditions instead of making deployment fail or silently merging products.

## Deployment paths

The versioned migration is:

`migrations/20260731_001_factory_bilingual_catalog_snapshots.sql`

It is registered as journal entry 15 and is bounded by transaction, lock-timeout, and statement-timeout controls. Core catalog/order tables are required. Linked module tables that may be absent in older or partial deployments are checked with `to_regclass(...)` before their additive `ALTER TABLE` runs, so a missing optional module cannot roll back the required bilingual fields.

Production also preloads `server/factoryBilingualSchemaBridge.mjs` through the existing supplier-company startup bridge. This covers deployments that run with `RUN_STARTUP_MIGRATIONS=false`. The bridge:

- adds missing bilingual fields idempotently;
- verifies every required core field after apply;
- verifies the normalized article-code index;
- logs optional linked tables that are not installed yet;
- aborts startup if a required core table or field remains unavailable.

## Schema module structure

The existing `shared/schema/factory.ts` file remains unchanged as the English Factory schema source. `shared/schema/factoryBilingualTables.ts` contains only the table definitions that gain Arabic columns. The top-level `shared/schema/index.ts` explicitly exports those bilingual replacements after the existing Factory export, so normal `@shared/schema` consumers and Drizzle receive the additive Arabic contract without copying or growing the existing Factory schema file.

`shared/schema/factoryBase.ts` is a three-line compatibility boundary used only by the bilingual definitions to reference unchanged parent tables. This avoids introducing another god file and keeps direct legacy imports stable.

## Safety

Phase 2 does not:

- create duplicate Arabic products or categories;
- translate any value automatically;
- backfill or overwrite English names;
- change article codes, quantities, weights, prices, colors, costs, inventory, allocations, statuses, vouchers, journals, or balances;
- make a cross-company lookup or mutation.

Snapshot population and safe historical repair remain owned by Phase 6.

## Verification

`tests/factory-bilingual-schema.test.ts` verifies:

- every declared Arabic catalog and snapshot column;
- additive/idempotent migration statements;
- guards for every optional linked table;
- migration journal registration;
- startup bridge preload and failure behavior;
- applying the migration twice against PostgreSQL;
- round-tripping Arabic product, category, description, and bale snapshot text;
- preserving the original English values during that database round trip.

## Rollback posture

The release is additive. An application rollback can leave the nullable columns and expression index in place safely because earlier builds ignore them. Destructive column removal is intentionally not part of the rollback procedure.
