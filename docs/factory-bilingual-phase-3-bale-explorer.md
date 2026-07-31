# Factory bilingual bale catalog — Phase 3 Bale Explorer

Issue: #347  
Status: Phase 3 implemented  
Scope: language switching, bilingual search, bilingual create/edit flows, category controls, and browser preference persistence.

## User experience

The Bale Products page now has a catalog-language control:

- **English** displays English, then Arabic, then article code.
- **العربية** displays Arabic, then English, then article code.
- The selected language is stored in browser storage and a same-site API cookie used only to route edit mutations to the correct language column.
- Search matches article code, English name, Arabic name, English description, or Arabic description regardless of the selected display language.

The existing Bale Explorer remains the operational surface. Its article codes, weights, prices, colors, active status, selection tools, and permission-based price hiding are unchanged.

## Explorer-scoped reads

Bale Explorer list reads use dedicated endpoints:

- `GET /api/factory/catalog-bilingual/products?lang=en|ar&search=...`
- `GET /api/factory/catalog-bilingual/categories?lang=en|ar`

The wrapper redirects only the legacy page's product/category GET requests while it is mounted and removes those query-cache entries when it unmounts. Search is never stored in a cookie and never changes the shared `/api/factory/bale-products` response used by stock pages, product selectors, or other Factory screens.

The dedicated product endpoint is outside the existing `/api/factory/bale-products` 30-second read microcache, so language switches and searches cannot return stale English or unfiltered cache hits.

## Create and edit

- Product creation stores English and Arabic names and descriptions on one product record.
- English remains the required canonical product name because the existing schema and historical integrations require it.
- A dedicated bilingual-category action stores English and Arabic names on one category record.
- In Arabic display mode, the existing product and category edit controls write to `name_ar` / `description_ar` rather than overwriting English.
- In English display mode, the same controls preserve their original English behavior.
- English/article-code fallback text displayed for missing Arabic translations is suppressed during unrelated edits, so changing a price, weight, color, or category cannot silently create a false Arabic translation.

## Compatibility architecture

The original large Bale Products page remains at its existing architecture boundary. A small page wrapper and a small Factory route composition wrapper add bilingual behavior without expanding that god file:

- `client/src/pages/BaleProducts.tsx` — existing operational page
- `client/src/pages/BaleProductsBilingual.tsx` — Phase 3 display/search wrapper
- `server/routes/factoryRoutesLegacy.ts` — preserved route composition
- `server/routes/factoryRoutes.ts` — small Phase 3 composition boundary
- `server/routes/factory/factoryBilingualCatalogRoutes.ts` — scoped bilingual reads/writes

The server adapter localizes only response text and routes localized edits to the correct columns. It never modifies quantity, weight, price, cost, stock, status, voucher, journal, balance, or company ownership fields.

## Company and permission safety

- Every dedicated read and write is scoped to the active Factory company.
- Existing Factory company-resolution and admin middleware remains authoritative.
- Product creation keeps the existing administrator/supervisor authorization flow.
- Label color restrictions and price visibility rules remain in the existing handlers and UI.

## Verification

Phase 3 tests cover:

- English and Arabic fallback behavior;
- bilingual search independent of selected display language;
- preserving language-neutral values while switching text;
- Arabic-mode edits not overwriting English fields;
- suppressing fallback text during unrelated Arabic-mode edits;
- English-mode edit compatibility;
- bilingual category presentation and edit mapping;
- browser language persistence.

## Rollback posture

The Phase 3 wrapper can be rolled back independently. Phase 2 nullable Arabic columns remain safe for earlier application builds to ignore.
