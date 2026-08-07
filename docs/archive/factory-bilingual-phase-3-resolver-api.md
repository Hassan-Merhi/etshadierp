# Factory bilingual bale catalog — Phase 3 resolver and API

Issue: #347  
Status: Phase 3 complete  
Scope: one shared English/Arabic resolver, backward-compatible catalog responses, language-aware search, and unchanged Factory security boundaries.

## One shared resolver

Phase 3 extends the Phase 1 contract in:

`shared/factoryBilingualContract.ts`

The same contract now resolves:

- product name;
- category name;
- product description;
- normalized article code;
- the searchable bilingual text corpus.

No second resolver module is retained.

Fallback remains:

- Arabic request: Arabic → English → normalized article code;
- English request: English → Arabic → normalized article code.

Article-code normalization trims surrounding whitespace and uppercases only. Punctuation and leading zeroes are preserved.

## API contract

The existing endpoints are extended rather than replaced:

- `GET /api/factory/categories`
- `GET /api/factory/bale-products`
- `GET /api/factory/bale-products/:id`

Optional query parameters:

- `lang=en|ar` — defaults to English;
- `q=<search>` — searches the supported bilingual fields;
- `legacy=1` — continues to the unchanged legacy GET handler for diagnostic compatibility.

Existing English fields remain unchanged. Bilingual responses add:

- `nameEn`
- `nameAr`
- `descriptionEn`
- `descriptionAr`
- `categoryName`
- `categoryNameAr`
- `displayName`
- `displayDescription`
- `displayCategoryName`
- `language`

## Search behavior

Product search checks:

- article code/barcode;
- English product name;
- Arabic product name;
- English category name;
- Arabic category name.

Category search checks both English and Arabic names.

The selected display language never changes article-code matching or barcode identity.

## Security and compatibility

The bilingual handlers are registered inside `registerFactoryRoutes`:

1. after canonical Factory company resolution;
2. after company/resource/deleted-item scope middleware;
3. after operational permission middleware;
4. after the existing read microcache;
5. before the legacy product/category GET handlers.

This preserves the same company selection, membership checks, permission boundaries, cache key, and write invalidation behavior used by the rest of Factory Mode.

The list endpoints retain the existing soft-delete filtering and sort order. The product-detail endpoint preserves the previous historical detail behavior for a same-company soft-deleted product.

Phase 3 does not change any create, update, delete, import, price, weight, costing, stock, voucher, journal, or accounting path.

## Verification

Coverage includes:

- supported language parsing;
- English and Arabic fallback order;
- article-code fallback for missing product/category/description text;
- normalized search values;
- unauthenticated rejection;
- canonical Factory company resolution;
- Arabic product and category search;
- language-neutral article-code search;
- backward-compatible raw English fields;
- explicit legacy response behavior;
- historical soft-deleted detail compatibility;
- cross-company product isolation.
