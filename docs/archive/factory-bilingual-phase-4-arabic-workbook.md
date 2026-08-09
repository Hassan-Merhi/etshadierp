# Factory bilingual catalog — Phase 4 Arabic workbook

Phase 4 adds a controlled Excel workflow for manually entering Arabic Factory bale-product and category text. It does not translate automatically and it does not create duplicate Arabic products or categories.

## Operator workflow

1. Open **Factory > Bale Explorer > Bale Products**.
2. Select **Export Arabic Names Template**.
3. Enter Arabic text only in the unlocked columns.
4. Select **Import Arabic Names** and choose the completed `.xlsx` file.
5. Choose one update mode:
   - **Fill missing Arabic names only** preserves every existing Arabic value.
   - **Replace existing Arabic names** uses non-blank Arabic values from the workbook.
6. Run **Preview**.
7. Correct blocking errors or download the rejected-row workbook.
8. Apply the previewed workbook.

## Workbook contract

The first worksheet must keep these columns in this exact order:

1. `Article Code / Barcode`
2. `English Product Name`
3. `Arabic Product Name`
4. `English Category`
5. `Arabic Category`
6. `Arabic Description`
7. `Current Translation Status`

Article codes are exported as Excel text so leading zeroes and long values remain unchanged. Reference columns are locked. The Arabic product, category, and description columns are editable.

The first release accepts `.xlsx` only, with one file per request, a 10 MB upload limit, and a 50,000-row workbook limit.

## Matching and validation

The server normalizes an article code by trimming surrounding whitespace and normalizing case. It preserves punctuation and leading zeroes.

Matching is performed only against the current Factory company's existing catalog:

- no product-name matching;
- no Arabic-name matching;
- no fuzzy matching;
- no cross-company lookup.

Preview identifies:

- matched products;
- unchanged rows;
- rows and products to update;
- categories to update;
- unknown article codes;
- duplicate article codes in the workbook;
- ambiguous normalized article codes already present in the company catalog;
- blank or invalid translation rows;
- conflicting Arabic translations for the same category.

Duplicate workbook codes, ambiguous catalog codes, and category conflicts block apply. Unknown or invalid rows are rejected and included in the downloadable error workbook; they never update a product.

## Preview/apply integrity

Preview returns a SHA-256 workbook digest and a preview token. The token is bound to:

- company;
- update mode;
- workbook bytes;
- matched product/category IDs;
- current Arabic values;
- proposed Arabic values;
- row classifications and validation reasons.

Apply requires the token and recomputes the complete preview inside the database transaction. A changed workbook or changed catalog returns `409` and requires a new preview.

## Transaction and audit safety

Apply updates only:

- `factory_bale_products.name_ar`;
- `factory_bale_products.description_ar`;
- `factory_categories.name_ar`.

Every product and category write is company-scoped and excludes soft-deleted catalog rows. Category writes are consolidated to one write per category.

The product changes, category changes, and durable `audit_log` entry are committed in the same database transaction. If any catalog write or the audit insert fails, the transaction rolls back completely.

The audit entry records:

- user and company;
- source file name;
- mode;
- workbook hash and preview token;
- preview counts and rejected-row count;
- changed product IDs;
- changed category IDs.

## Fields that Phase 4 never changes

The workflow never changes English names, article codes, internal codes, category assignments, weights, colors, quantities, production or selling prices, costs, inventory, allocations, statuses, vouchers, journals, balances, or other accounting data.

## Endpoints

- `GET /api/factory/bale-products/arabic-template`
- `POST /api/factory/bale-products/arabic-import/preview`
- `POST /api/factory/bale-products/arabic-import/errors`
- `POST /api/factory/bale-products/arabic-import/apply`

All endpoints require authentication, canonical Factory company resolution, and the existing import/export permission boundary.

## Verification coverage

Phase 4 tests cover template headers and cell protection, article-code text round-trip, exact-code matching, unknown codes, duplicate workbook codes, ambiguous catalog codes, category conflicts, both update modes, idempotence, preview-token invalidation, authenticated routes, company isolation, durable audit persistence, stale-preview rejection, non-`.xlsx` rejection, and full transaction rollback when audit persistence fails.
