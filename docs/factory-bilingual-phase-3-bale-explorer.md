# Factory bilingual bale catalog — Phase 3 Bale Explorer

Issue: #347  
Status: Phase 3 implemented  
Scope: language switching, bilingual search, bilingual create/edit flows, category controls, and browser preference persistence.

## User experience

The Bale Products page now has a catalog-language control:

- **English** displays English, then Arabic, then article code.
- **العربية** displays Arabic, then English, then article code.
- The selected language is stored in browser storage and a same-site API cookie.
- Search matches article code, English name, Arabic name, English description, or Arabic description regardless of the selected display language.

The existing Bale Explorer remains the operational surface. Its article codes, weights, prices, colors, active status, selection tools, and permission-based price hiding are unchanged.

## Create and edit

- Product creation stores English and Arabic names and descriptions on one product record.
- English remains the required canonical product name because the existing schema and historical integrations require it.
- A dedicated bilingual-category action stores English and Arabic names on one category record.
- In Arabic display mode, the existing product and category edit controls write to `name_ar` / `description_ar` rather than overwriting English.
- In English display mode, the same controls preserve their original English behavior.

## Compatibility architecture

The original large Bale Products page and Factory route registry are preserved as compatibility modules. Small Phase 3 composition wrappers add bilingual behavior without expanding those legacy files:

- `client/src/pages/BaleProductsLegacy.tsx`
- `server/routes/factoryRoutesLegacy.ts`
- `client/src/pages/BaleProducts.tsx`
- `server/routes/factory/factoryBilingualCatalogRoutes.ts`

The server adapter localizes only response text and routes localized edits to the correct columns. It never modifies quantity, weight, price, cost, stock, status, voucher, journal, balance, or company ownership fields.

## Company and permission safety

- All explicit bilingual writes are scoped to the active Factory company.
- Existing Factory company-resolution and admin middleware remains authoritative.
- Product creation keeps the existing administrator/supervisor authorization flow.
- Label color restrictions and price visibility rules remain in the legacy handlers and UI.

## Verification

Phase 3 tests cover:

- English and Arabic fallback behavior;
- bilingual search independent of selected display language;
- preserving language-neutral values while switching text;
- Arabic-mode edits not overwriting English fields;
- English-mode edit compatibility;
- bilingual category presentation and edit mapping;
- browser language persistence and bilingual search cookies.

## Rollback posture

The Phase 3 wrapper can be rolled back independently. Phase 2 nullable Arabic columns remain safe for earlier application builds to ignore.
