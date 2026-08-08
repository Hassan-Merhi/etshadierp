# Phase 8 — Frontend Data Architecture Completion

Phase 8 completes the shared frontend data contracts used by the bandwidth-reduction program without changing accounting behavior, inventory calculations, backend business rules, or database schemas.

## Canonical request URLs

Filtered requests use the shared `canonicalApiUrl` builder. Query parameter names are sorted, empty values are removed, and set-like filter values are normalized before URL creation. Equivalent filters therefore reuse one React Query cache entry instead of producing duplicate requests because of object-key or selection-order differences.

## Company-scoped cache identity

Every migrated key keeps the real request URL first and the active company or explicit all-accessible scope second. This preserves compatibility with the shared query function while preventing one company’s response from being reused after a company switch.

The shared architecture now provides:

- `companyDataKey`
- `paginatedCompanyDataKey`
- `queryCompanyIdentity`
- `queryMatchesCompanyApiFamily`
- `invalidateCompanyApiFamily`
- `removeCompanyApiFamily`

## Paginated screen integration

The GIT Containers page uses canonical server-filter URLs, stable paginated keys, sorted multi-select filters, and a distinct all-accessible-companies identity. Full container details remain lazy and load only when the drawer opens.

Daybook voucher pages use canonical URLs and company-scoped pagination keys. Offload rows, voucher details, expanded rows, transfer revisions, edit entries, suppliers, ledger accounts, bank accounts, employees, and fixed assets use company-aware identities.

Changing company closes stale Daybook detail/edit state and resets pagination so records from the previous company are not displayed while the next company loads.

## Exact endpoint-family invalidation

Endpoint-family matching compares URL pathnames and segment boundaries. `/api/vouchers` matches `/api/vouchers?page=2` and `/api/vouchers/123`, but does not match a collision such as `/api/vouchers-old`.

Company-specific invalidation marks only the selected company’s matching queries stale. GIT mutations use exact family invalidation because the same mutation may affect both the active-company and all-accessible views.

All shared invalidation helpers default to active-only refetch. Inactive heavy pages are marked stale without being downloaded in the background.

## Response-shape normalization

`unwrapList` accepts legacy arrays and common paginated shapes using `data`, `items`, `rows`, or `results`.

`unwrapPage` additionally normalizes:

- page number;
- page size;
- total rows;
- total pages;
- whether another page exists.

This allows remaining screens to migrate to pagination without duplicating response-shape logic.

## Query policies

Three named policies remain available:

- `reference` for stable picker and reference data;
- `operational` for ordinary business screens;
- `live` for data that must refresh whenever mounted.

Reference and operational policies do not refetch on focus, reconnect, or passive remount. Live queries explicitly opt into remount and reconnect refresh behavior.

## Export compatibility

Interactive Daybook views remain paginated. A complete filtered voucher list is requested only when the user explicitly starts the Excel export, preserving full export behavior without making every page visit download the full dataset.

## Compatibility retained

- Existing API endpoints and response formats remain valid.
- The real request URL remains first in shared keys.
- Existing Factory, inventory, and stock-item key factories remain available.
- No global polling interval was added.
- No backend or database migration was introduced.

## Database changes

No SQL, schema migration, or production data repair is required for Phase 8.

## Deferred verification

Focused source contracts were expanded for canonical set values, paginated company keys, company-specific family matching and invalidation, normalized page metadata, GIT integration, and Daybook integration. Per owner request, TypeScript, lint, unit, browser, build, PostgreSQL, deployment, and CI checks were not run and remain part of the final all-phase verification.

## Merge order

Phase 8 is stacked on the Phase 5–6 branch together with Phase 7. Phase 5–6 must be integrated first. The Phase 7–8 branch remains unmerged until explicit owner authorization and the final verification pass.
