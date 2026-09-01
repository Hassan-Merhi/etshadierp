# Factory bilingual bale catalog — Phase 1 audit

Issue: #347  
Status: Phase 1 complete  
Scope: Factory bale product names, category names, article-code translation import, linked operational screens, invoices, PDFs, Excel files, labels, loading documents, and historical snapshots.

## 1. Contract locked by this phase

1. English and Arabic belong to the same product/category record. Arabic products are never duplicated.
2. Product ID and company-scoped article code are language-neutral identifiers.
3. Arabic translation workbooks match by article code only, never by product name.
4. Article-code normalization is conservative: trim surrounding whitespace and uppercase. Preserve punctuation and leading zeroes.
5. Live catalog fallback is:
   - Arabic request: Arabic -> English -> article code.
   - English request: English -> Arabic -> article code.
6. Finalized-document fallback is:
   - requested-language snapshot -> opposite-language snapshot -> requested current catalog value -> opposite current catalog value -> article code.
7. Current catalog edits may update live operational records but must never silently rename finalized documents.
8. Language changes are text-only. They cannot alter quantities, weights, prices, costs, stock, allocations, vouchers, journals, or balances.
9. Every lookup, import, mutation, diagnostic, and repair remains company-scoped.
10. Later phases must use `shared/factoryBilingualContract.ts`; pages and exports must not create independent fallback rules.

## 2. Current data model findings

### Parallel catalogs

The repository contains two bale catalogs:

- Legacy: `bale_product_categories`, `bale_products`, `production_bales`.
- Factory: `factory_categories`, `factory_bale_products`, `factory_bales`.

Issue #347 targets the Factory catalog. Legacy/shared surfaces remain in the dependency manifest because barcode, transfer, loading, invoice, and label flows still use related bale-name fields and must be classified explicitly in Phase 8.

### Factory catalog source of truth

`factory_bale_products` currently stores one English name and description together with:

- `id`
- `company_id`
- `code`
- `article_code`
- `name`
- `description`
- `weight_per_bale_kg`
- `category_id`
- production/selling prices, label color, status, and deletion state

`factory_categories` currently stores one English category name per company.

The schema already has a company/article-code uniqueness boundary. Phase 2 must preserve it while adding nullable Arabic fields.

### Operational bale snapshots

`factory_bales` stores:

- `product_id`
- `article_code`
- `product_name`
- `category`

The existing product cascade updates linked `factory_bales.product_name`, `weight_kg`, and `article_code`. It has no Arabic fields and does not distinguish all historical/finalized use cases. Phase 6 must add bilingual propagation without allowing finalized document names to drift.

### Proforma and order snapshots

| Record | Current copied fields | Company scope |
|---|---|---|
| `customer_proforma_lines` | `article_code`, `product_name` | parent `customer_proformas.company_id` |
| `customer_order_lines` | `article_code`, `bale_name` | parent `customer_orders.company_id` |
| `customer_order_bales` | `article_code`, `bale_name`, `bale_id` | parent `customer_orders.company_id` |
| `customer_order_bales_history` | `article_code`, `bale_name`, `bale_id` | historical parent order |
| `customer_order_expected_lines` | `article_code`, `product_name`, `company_id` | direct and parent order |

Several child tables do not carry `company_id`. Repair and backfill code must scope them through their parent order/proforma; filtering by article code alone is unsafe.

### Current update paths

The product routes currently have:

- generic `PATCH /api/factory/bale-products/:id`
- `POST /api/factory/bale-products/:id/cascade-update`

The translation workbook must use a dedicated, transactional endpoint. It must not perform hundreds of generic product patches or accidentally expose pricing, stock, or accounting fields.

## 3. Dependency inventory

The machine-readable inventory is:

`config/factory-bilingual-dependencies.json`

It assigns identified files to Phases 2–8 and records these groups:

- schema and shared contract
- catalog CRUD and Bale Explorer UI
- Arabic translation workbook import/export
- barcode lookup, labels, and relabeling
- production, stock, inventory, and history
- allocation and dispatch
- proformas
- customer orders and invoices
- PDF, Excel, loading, and messaging attachments
- daybook, reports, and employee POS
- legacy/shared bale surfaces
- existing Arabic rendering references

The manifest uses unique file ownership and identifies the critical catalog, import, snapshot, invoice, PDF, Excel, and loading boundaries that later phases must complete.

## 4. Key linked surfaces identified

### Catalog and editing

- `server/routes/factory/factoryProductsRoutes.ts`
- `client/src/pages/BaleProducts.tsx`
- `client/src/components/CreateBaleProductDialog.tsx`
- merge and product-image pages
- legacy/shared bale product routes

### Translation workbook

- current Factory bale import components, types, utilities, and history
- a new narrow Arabic-name workflow must be separate from stock/bale creation imports

### Barcode and labels

- barcode lookup route and page
- shared label HTML
- label reprint and relabeling
- pressing and production-bale pages

Barcode identity remains unchanged regardless of display language.

### Production and inventory

- Factory bale, daily scan, ground scan, stock, stock-entry history, and bale export routes
- stock entry scanner/printing
- location inventory, tracking, daily production, comparison, and re-entry pages

These are live operational surfaces and should resolve through product ID/article code where possible.

### Allocation and dispatch

- Stock Allocation V2, V3, and V5 routes/pages
- V5 pagination payloads
- scanning panels
- dispatch batch list, detail, and scan flows

API changes must be additive so existing English consumers remain compatible.

### Proformas, orders, and invoices

- Factory proforma routes and drawers
- customer-order helpers, CRUD, scanning, verify, and recover routes
- invoice create, detail, pending, and verification pages

These paths copy names into lines and scanned-bale rows. Phase 6 must persist both English and Arabic snapshots at write time.

### PDFs, Excel, loading, and attachments

- customer-order PDF export
- customer-order Excel export
- invoice loading routes/screens
- Factory document-user routes
- worker-bale PDF generation
- label and product-sheet output

Existing Arabic PDF support is available in the account-statement generator and Arabic-capable Factory customer documents. Phase 7 should reuse that approach.

No separate WhatsApp product-name resolver was found. WhatsApp correctness must be enforced at the attachment-generation boundary so the selected PDF/Excel/loading file already has the requested language.

## 5. Phase 2 schema ownership

Phase 2 should add these catalog fields:

- `factory_bale_products.name_ar`
- `factory_bale_products.description_ar`
- `factory_categories.name_ar`

Likely snapshot additions identified by the audit:

- `factory_bales.product_name_ar`
- `factory_bales.category_ar`
- `customer_proforma_lines.product_name_ar`
- `customer_order_lines.bale_name_ar`
- `customer_order_bales.bale_name_ar`
- `customer_order_bales_history.bale_name_ar`
- `customer_order_expected_lines.product_name_ar`

Where finalized outputs include categories, English and Arabic category snapshots must be stored together rather than reading a mutable current category.

An optional `customer_orders.document_language` may save the default output language, but each export route must still support an explicit `lang=en|ar` override.

## 6. Arabic translation workbook contract

The exported workbook must contain one current-company product per row:

- `Article Code / Barcode` — locked reference, exported as Excel text
- `English Product Name` — locked reference
- `Arabic Product Name` — editable
- `English Category` — locked reference
- `Arabic Category` — editable
- `Arabic Description` — optional/editable
- `Current Translation Status` — reference

Import rules:

1. `.xlsx` only for the first release.
2. Normalize article codes with trim + uppercase only.
3. Match inside the active company only.
4. Never match by English or Arabic product name.
5. Preview matched, unchanged, update, unknown, duplicate, blank, and category-conflict counts.
6. Duplicate codes and conflicting Arabic translations for one category block apply.
7. Apply accepted changes in one database transaction.
8. `fill-missing` is the safe default; `replace-existing` requires explicit selection.
9. Re-importing the same workbook is idempotent.
10. Audit user, company, filename, mode, counts, and changed record IDs.
11. Rejected rows can be downloaded with the original article code and rejection reason.

## 7. Company and historical safety

- Confirm every product/category ID belongs to the active company.
- Include company ID in every article-code lookup.
- Scope child snapshot tables through parent orders/proformas when they lack `company_id`.
- Never use a Company B product to repair a Company A record.
- Resolve repairs by product ID first and exact article code second.
- Never fuzzy-match by name.
- Report ambiguous/orphaned records instead of guessing.
- Allow dry-run before historical apply.
- Do not overwrite an existing finalized Arabic snapshot during ordinary catalog edits.
- Preserve all English historical names.

## 8. Phase 1 deliverables

- `shared/factoryBilingualContract.ts`
  - language and import-mode types
  - article-code normalization
  - live English/Arabic resolver
  - snapshot-first finalized-document resolver
  - bilingual snapshot builder
  - Arabic translation-row normalizer
- `config/factory-bilingual-dependencies.json`
  - dependency inventory and implementation-phase ownership
- `tests/factory-bilingual-contract.test.ts`
  - English-only, Arabic-only, bilingual, missing-value, code-fallback, import normalization, and historical snapshot fixtures
- this audit document

## 9. Completion checklist

- [x] Active Factory and parallel legacy catalog tables identified.
- [x] Catalog CRUD and Arabic import boundaries identified.
- [x] Barcode, scanning, labels, pressing, and relabeling boundaries identified.
- [x] Stock, allocation, dispatch, history, and reporting boundaries identified.
- [x] Proforma, order, invoice, loading, PDF, and Excel boundaries identified.
- [x] Copied-name snapshot tables identified.
- [x] Parent-join company-scoping requirements identified.
- [x] Live and finalized fallback contracts implemented.
- [x] Exact article-code import normalization implemented.
- [x] Historical non-renaming rule implemented in the shared contract.
- [x] Shared contract covered by regression fixtures.
- [x] Dependency inventory assigned to remaining phases.

Phase 2 can now add the schema and migration without rediscovering or guessing the linked data paths.
