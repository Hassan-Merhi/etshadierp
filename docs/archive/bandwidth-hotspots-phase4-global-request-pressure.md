# Bandwidth Hotspots — Phase 4 Global Request Pressure

## Scope

Phase 4 finishes the implementation side of the five-phase bandwidth program. It targets the remaining recurring production traffic around `/api/stock-items/light`, Factory bale-product/category catalogs, cache invalidation churn, and the misleading duplicated `/api/factory/api/factory/...` route labels seen in Render diagnostics.

As agreed for this program, TypeScript, lint, build, automated tests, CI, and production bandwidth comparison remain deferred to Phase 5 so the cumulative Phase 1–4 branch can be audited and repaired in one final verification pass.

## 1. Correct the duplicated Factory route labels in bandwidth diagnostics

The production logs showed route labels such as:

- `/api/factory/api/factory/bale-products`
- `/api/factory/api/factory/categories`

Code search found no client request that intentionally builds those URLs. The duplication came from request observability: Express could expose both a mounted `baseUrl` (`/api/factory`) and an already-absolute `req.route.path` (`/api/factory/bale-products`), while `normaliseRouteTemplate()` blindly concatenated both.

`server/lib/traceContext.ts` now canonicalizes route templates before logging:

- an already-absolute `/api/...` route is kept unchanged;
- a route already prefixed by its base is kept unchanged;
- only relative route paths are joined to `baseUrl`.

This fixes the diagnostic label without adding aliases or preserving a malformed request path. Future bandwidth rankings should report the real canonical endpoints.

## 2. Add a truly compact stock-item identity profile

The existing `/api/stock-items/light` contract is intentionally retained because some callers still require `active`, `stockGroupId`, `categoryId`, and `gradeId`.

Phase 4 adds:

`GET /api/stock-items/light?profile=identity`

It returns only:

- `id`
- `code`
- `name`
- `uom`

Payload marker: `X-ERP-Payload-Profile: stock-items-identity-v1`.

The default light contract continues to return its previous fields and now carries `X-ERP-Payload-Profile: stock-items-light-v1`.

A shared `stockItemKeys.identity(companyId)` query-key factory keeps the real profile URL as query-key element zero, so the normal shared React Query fetcher requests the correct compact contract.

## 3. Move the busiest stock selectors to the identity profile

The following high-frequency workflows use the identity profile because they only need item identity for lookup/select operations:

- voucher edit stock selectors;
- voucher create / transfer / transfer-order / adjustment / POS stock selectors through the shared voucher query hook;
- Factory Customer Proformas Add Item catalog.

Factory Proformas received an additional request-pressure fix: expanding a proforma no longer downloads the ERP stock-item catalog. The identity catalog is enabled only while the Add Item dialog is actually open. It is then retained with a 30-minute stale period, two-hour garbage-collection window, and no mount/focus/reconnect refetches.

Callers that genuinely consume stock grouping/category metadata remain on the backwards-compatible default `/api/stock-items/light` profile.

## 4. Stop proforma edits from evicting unrelated reference catalogs

The browser bandwidth invalidation policy previously treated every customer-proforma or proforma-line write as a full reference-data invalidation. That meant routine actions such as adding a proforma line could expire unrelated cached datasets including:

- `/api/stock-items/light`
- `/api/factory/bale-products`
- `/api/factory/categories`
- locations, workers, suppliers and other stable picker data.

Phase 4 removes proforma/proforma-line writes from full invalidation. They now invalidate the live workflow scope instead.

`/api/factory/customer-proformas` is correspondingly classified as a live cache entry rather than reference data, so proforma writes still expire the data they actually changed.

Full invalidation remains in place for authentication/session changes, company/location changes, access/settings changes, and mutations of the reference datasets themselves.

## 5. Separate live and reference cache generations

The request storm guard previously used one global write generation. Even when a write was correctly scoped as `live`, a stable reference request that happened to be in flight during that write was refused admission to the reference cache because the global generation changed.

Phase 4 separates the generations:

- live writes advance the live generation only;
- full invalidations advance both live and reference generations.

As a result, a scan, voucher, order, or proforma write cannot prevent an unrelated stock/catalog/reference response from becoming reusable simply because the two requests overlapped in time.

## 6. Keep Factory categories in the stable reference policy

`/api/factory/categories` now receives the same reference-data treatment as Factory bale products:

- 30-minute browser response-cache lifetime;
- 30-minute React Query stale period;
- two-hour React Query GC period;
- no automatic refetch on mount, window focus, or reconnect.

Actual category writes still trigger full reference invalidation through the existing reference-data write rules.

## 7. Stop bilingual catalog search from downloading a new full catalog per term

The bilingual Bale Products wrapper previously injected the current search term as `q` into `/api/factory/bale-products`. Because the wrapper remounts the catalog query as the user searches or changes translation-status filters, each new search term could create a distinct large server response even though the browser already held the same language catalog.

Phase 4 changes this behavior:

- the server request varies by catalog language, not by search term;
- search is applied locally across English/Arabic/French names, article/code fields, and category names;
- translation-completeness filters are also applied locally;
- the 30-minute reference response cache can therefore reuse one language-specific catalog representation while the user searches and filters;
- the redundant second React Query cache removal on the language event handler was removed; the CatalogFetchBoundary remains the single owner of that remount/cleanup lifecycle.

This preserves server-side language resolution while eliminating network churn caused purely by UI search/filter state.

## Existing protections retained

Phase 4 builds on the earlier bandwidth layers rather than replacing them:

- identical in-flight GETs are still shared;
- browser GET concurrency remains capped;
- cache entries still vary by selected-company headers;
- hidden-tab deferral remains enabled for heavy live endpoints;
- conditional ETag revalidation remains available after browser cache expiry;
- server-side read microcache remains active for stock-item and Factory reference reads;
- company/auth isolation rules are unchanged.

## Database changes

No database migration and no manual SQL are required for Phase 4.

## Phase 5 verification checklist

The final phase must run the cumulative Phase 1–4 branch through the complete project verification and repair anything found until green. In addition to the normal TypeScript/lint/build/test/CI gates, explicitly verify:

1. Render bandwidth logs report `/api/factory/bale-products` and `/api/factory/categories` canonically, with no observability-created `/api/factory/api/factory/...` duplicate labels.
2. `/api/stock-items/light?profile=identity` preserves item selector behavior while returning only `id`, `code`, `name`, and `uom`.
3. Default `/api/stock-items/light` still supplies grouping/category/grade/activity metadata to extended callers.
4. Factory Proformas does not request stock items merely when cards are expanded; it requests the identity profile when Add Item opens.
5. Voucher create/edit/transfer/adjustment/POS selectors continue to resolve stock items correctly through the identity profile.
6. Routine proforma/order/scan/voucher writes do not evict unrelated reference payloads.
7. Actual stock-item, bale-product, category, company/location, settings, access, or authentication changes do invalidate the appropriate reference caches.
8. Bilingual Bale Products search and translation-status filtering preserve results without generating a distinct large server response for each search term.
9. Five-minute Render bandwidth windows show a material reduction in `/api/stock-items/light`, Factory bale-product, and Factory category response bytes compared with the supplied production baseline.
10. No cache behavior crosses company/session boundaries.
