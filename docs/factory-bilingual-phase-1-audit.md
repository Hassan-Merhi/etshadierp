# Factory bilingual bale catalog — Phase 1 audit

Issue: #347  
Status: Phase 1 complete  
Scope: Factory bale product names, category names, article-code translation import, linked operational screens, invoices, PDFs, Excel files, labels, loading documents, and historical snapshots.

## 1. Decisions locked by this phase

1. English and Arabic are fields on the same product/category record. Arabic products are never duplicated.
2. The language-neutral identity is the company-scoped product ID plus article code. Excel translation imports match by normalized article code only.
3. Article-code normalization is deliberately conservative: trim surrounding whitespace and uppercase. Do not remove punctuation, convert to a number, or drop leading zeroes.
4. Live catalog fallback is:
   - Arabic request: Arabic -> English -> article code.
   - English request: English -> Arabic -> article code.
5. Finalized-document fallback is:
   - requested-language snapshot -> opposite-language snapshot -> requested current catalog value -> opposite current catalog value -> article code.
6. Current catalog changes may update live operational records, but must never silently rename a finalized invoice or historical document.
7. Language operations are text-only. They cannot change quantities, weights, prices, costs, stock, allocations, vouchers, journals, customer balances, or supplier balances.
8. Every database read/write and every translation import remains company-scoped.
9. The first Arabic translation import accepts `.xlsx` and supports `fill-missing` and explicit `replace-existing` modes.
10. No page, route, PDF, or Excel generator may invent its own fallback. All later phases must use `shared/factoryBilingualContract.ts`.

## 2. Current data model findings

### 2.1 Parallel catalogs exist

The schema contains both a legacy bale catalog and the active Factory catalog:

- Legacy: `bale_product_categories`, `bale_products`, `production_bales`.
- Factory: `factory_categories`, `factory_bale_products`, `factory_bales`.

The feature requested in issue #347 targets the Factory catalog. Legacy surfaces are still listed in the dependency manifest because several shared lookup, transfer, invoice, and label pages still read similar fields and must be explicitly verified rather than assumed unrelated.

### 2.2 Factory catalog source of truth

`factory_bale_products` currently stores:

- `id`
- `company_id`
- `code`
- `article_code`
- `name`
- `description`
- `weight_per_bale_kg`
- `category_id`
- selling/production prices, label color, active/deleted state

`factory_categories` currently stores one English `name` per company.

The schema already has a unique company/article-code index. Phase 2 must preserve that behavior and add nullable Arabic fields without replacing English fields.

### 2.3 Operational bale snapshot

`factory_bales` stores both a live foreign-key reference and copied text:

- `product_id`
- `article_code`
- `product_name`
- `category`

This is a mutable operational snapshot. The existing product cascade route updates `factory_bales.product_name`, `weight_kg`, and `article_code` for all company bales linked to the product. It does not currently carry an Arabic name or Arabic category.

Phase 6 must distinguish active/current bale display from finalized document history. Adding Arabic support must not make the existing broad cascade overwrite finalized document snapshots.

### 2.4 Proforma and order snapshots

The current schema copies names into multiple records:

| Record | Current copied identifiers/text | Company scope path | Snapshot classification |
|---|---|---|---|
| `customer_proforma_lines` | `article_code`, `product_name` | join through `customer_proformas.company_id` | mutable draft/proforma snapshot |
| `customer_order_lines` | `article_code`, `bale_name` | join through `customer_orders.company_id` | order/invoice line snapshot |
| `customer_order_bales` | `article_code`, `bale_name`, `bale_id` | join through `customer_orders.company_id` | scanned order-bale snapshot |
| `customer_order_bales_history` | `article_code`, `bale_name`, `bale_id` | join through historical order ID | immutable cancellation/history snapshot |
| `customer_order_expected_lines` | `article_code`, `product_name`, `company_id` | direct and parent order | mutable expected-line snapshot |

Several child tables do not carry `company_id`. Any import repair or backfill must scope them by joining to their parent proforma/order; filtering by article code alone is not safe.

### 2.5 Current product update behavior

The Factory product route has two update paths:

- A generic `PATCH /api/factory/bale-products/:id` that spreads request fields into the product update.
- A `POST /api/factory/bale-products/:id/cascade-update` path that validates selected fields and propagates English name/article/weight to `factory_bales`.

Later phases must add Arabic fields to explicit allowlists and avoid expanding unsafe arbitrary updates. Arabic translation imports must use a dedicated endpoint and transaction rather than reuse the generic patch route row-by-row.

## 3. Dependency-map result

The machine-readable dependency map is stored at:

`config/factory-bilingual-dependencies.json`

It contains the exact files and assigns each group to the implementation phase that owns it. The map is protected by `tests/factory-bilingual-dependency-map.test.ts`, which checks unique ownership, required high-risk boundaries, and repository path existence.

### 3.1 Catalog CRUD and editing

Primary boundaries:

- `server/routes/factory/factoryProductsRoutes.ts`
- `client/src/pages/BaleProducts.tsx`
- `client/src/components/CreateBaleProductDialog.tsx`
- `client/src/pages/factory/MergeBaleProducts.tsx`
- `client/src/pages/factory/BaleProductImages.tsx`

Current list, create, edit, merge statistics, product details, and cascade operations all expose only English names.

### 3.2 Import and translation workbook

Existing Factory import code is spread across:

- `client/src/pages/factory/factoryimport/components/BaleImport.tsx`
- `client/src/pages/factory/factoryimport/types.ts`
- `client/src/pages/factory/factoryimport/utils.ts`
- `client/src/pages/factory/FactoryBaleImportHistory.tsx`

The Arabic-name workbook must be a separate, narrow workflow. It updates Arabic catalog fields only and must not reuse the general bale import in a way that could create bales, change stock, or modify pricing.

### 3.3 Barcode lookup, labels, pressing, and relabeling

The audit found linked name/article-code rendering in barcode lookup, shared label HTML, label reprint, relabeling, pressing, and production-bale pages. These surfaces must keep scanning language-neutral while choosing the requested display/print language.

A barcode must always resolve the same product regardless of the selected language.

### 3.4 Production, stock, inventory, and history

Product names are returned or displayed by Factory bale routes, daily scan, ground scan, stock routes, stock-entry history, bale exports, location inventory, stock lists, product tracking, daily production reports, production comparison, and stock-entry print paths.

These are live operational surfaces. They should resolve from product ID/article code when possible and use copied bale fields only when no catalog match exists.

### 3.5 Allocation and dispatch

Stock Allocation V2, V3, V5, paginated V5 payloads, client pagination types, scanning panels, and dispatch batches all carry product names/article codes. Their API contracts must be extended additively; existing English consumers cannot break.

### 3.6 Proformas, orders, and invoices

The audit covers:

- Factory proforma route and all current create/edit/list drawers.
- Customer-order helpers and CRUD.
- Bale scanning and verify/recover flows.
- Invoice creation, detail, pending, and verification screens.

These boundaries copy names instead of always joining the product catalog. Phase 6 must create bilingual snapshots at write time and repair safe historical gaps by product ID first, exact article code second, never fuzzy name matching.

### 3.7 PDF, Excel, loading, labels, and attachments

The following generators/flows must use a shared language parameter and resolver:

- Customer-order PDF export.
- Customer-order Excel export.
- Invoice loading routes and loading screens.
- Factory document user routes.
- Worker-bale PDF generator.
- Product/bale labels and product sheets.

Existing Arabic rendering is available in `server/lib/accountStatementPdfGenerator.ts` and Arabic-capable Factory customer document paths. Phase 7 should reuse the established Arabic font/shaping approach instead of introducing a second incompatible renderer.

No independent WhatsApp product-name resolver was identified. WhatsApp output must therefore be verified at the attachment-generation boundary: the PDF/Excel/loading file selected for messaging must already be generated in the chosen language.

### 3.8 Daybook, reports, employee POS, and legacy surfaces

Bale history, loading-created daybook views, employee POS/waste routes, legacy transfers, legacy invoice pages, and legacy container loading were retained in the manifest. Phase 8 must classify each as one of:

- active Factory dependency to update,
- shared/legacy dependency to update,
- confirmed out of scope with a recorded reason.

They cannot simply be ignored because code search shows product-name/article-code use.

## 4. Schema ownership for Phase 2

Phase 2 should add the following catalog fields:

- `factory_bale_products.name_ar`
- `factory_bale_products.description_ar`
- `factory_categories.name_ar`

The audit identifies these likely snapshot additions, subject to final migration naming consistency:

- `factory_bales.product_name_ar`
- `factory_bales.category_ar`
- `customer_proforma_lines.product_name_ar`
- `customer_order_lines.bale_name_ar`
- `customer_order_bales.bale_name_ar`
- `customer_order_bales_history.bale_name_ar`
- `customer_order_expected_lines.product_name_ar`

If category names are added to invoice/proforma line output, English and Arabic category snapshots must be added together rather than reading mutable categories for finalized documents.

An optional `customer_orders.document_language` may store the user's default output language, but each export endpoint must still allow an explicit `lang=en|ar` override.

## 5. Translation workbook contract

The export template must contain one row per current-company product:

- `Article Code / Barcode` — locked/reference, exported as Excel text.
- `English Product Name` — locked/reference.
- `Arabic Product Name` — editable.
- `English Category` — locked/reference.
- `Arabic Category` — editable.
- `Arabic Description` — optional/editable.
- `Current Translation Status` — reference.

Import rules:

1. `.xlsx` only in the first release.
2. Normalize article code using trim + uppercase only.
3. Match inside the selected company only.
4. Never match by English or Arabic name.
5. Preview matched, unchanged, update, unknown, duplicate, blank, and category-conflict counts.
6. Duplicate codes and conflicting Arabic translations for one category block apply.
7. Apply all accepted changes in one database transaction.
8. `fill-missing` is the safe default. `replace-existing` requires explicit selection.
9. Re-importing the same workbook is idempotent.
10. Audit user, company, filename, mode, counts, and changed IDs.
11. Error workbook rows retain the original article code and include a rejection reason.

## 6. Company-isolation rules

All later phases must follow these rules:

- Catalog reads/writes filter `factory_bale_products.company_id` and `factory_categories.company_id`.
- Category IDs supplied by an import must belong to the same company as the product.
- Child snapshot tables without `company_id` are scoped through the parent proforma/order.
- Product-ID lookup is accepted only after confirming the product belongs to the active company.
- Article-code fallback always includes company ID.
- Diagnostics and dry-run backfills return no data from another company.
- An import cannot use a code found in Company B to update a missing code in Company A.

## 7. Historical safety rules

- Draft/current records may receive Arabic snapshots through a controlled repair.
- Finalized records with no Arabic snapshot may be backfilled once from a company-scoped product match.
- Once a finalized snapshot exists, later catalog edits do not overwrite it.
- Existing English historical names remain unchanged.
- Ambiguous or orphaned rows are reported, not guessed.
- Name-only fuzzy matching is prohibited.
- Repair endpoints must support dry run before apply and write an audit log.

## 8. Phase 1 code delivered

- `shared/factoryBilingualContract.ts`
  - language and import-mode types
  - article-code normalization
  - live English/Arabic resolver
  - snapshot-first finalized-document resolver
  - snapshot builder
  - translation-row normalizer
- `config/factory-bilingual-dependencies.json`
  - checked dependency inventory and phase ownership
- `tests/factory-bilingual-contract.test.ts`
  - English-only, Arabic-only, bilingual, missing-value, code-fallback, import normalization, and historical snapshot fixtures
- `tests/factory-bilingual-dependency-map.test.ts`
  - manifest integrity and high-risk boundary checks

## 9. Phase 1 completion checklist

- [x] Active Factory catalog tables identified.
- [x] Legacy parallel bale catalog identified.
- [x] Product/category CRUD and import boundaries identified.
- [x] Barcode, scanning, labels, pressing, and relabeling boundaries identified.
- [x] Stock, allocation, dispatch, history, and reporting boundaries identified.
- [x] Proforma, order, invoice, loading, PDF, and Excel boundaries identified.
- [x] Copied-name snapshot tables identified.
- [x] Parent-join company-scoping requirements identified.
- [x] Live and finalized fallback contracts defined.
- [x] Exact article-code import normalization defined.
- [x] Historical non-renaming rule defined.
- [x] Dependency map protected by tests.
- [x] Shared contract protected by fixtures.

Phase 2 can now add the schema and migrations without rediscovering or guessing the linked data paths.
