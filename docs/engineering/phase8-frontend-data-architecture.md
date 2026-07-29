# Phase 8 — Frontend Data Architecture Completion

Phase 8 establishes shared frontend data contracts without changing backend APIs, accounting behavior, inventory calculations, or database schemas.

## Canonical request URLs

Filtered requests now have a shared canonical URL builder. Query parameter names are sorted, empty values are removed, and equivalent filter objects produce the same URL. This allows React Query to deduplicate requests and reuse one cache entry instead of treating parameter-order differences as different data.

## Company-scoped cache identity

The shared company key factory keeps the real request URL as the first key element and the active company as the second. Identical endpoints therefore remain isolated between companies while continuing to work with the existing shared query function.

Shared factories now cover accounts, vouchers, dashboard cash and payable accounts, company transfers, cross-company account pickers, stock-item lists, paginated stock-item management requests, auto-transfer rules, and voucher search.

## Exact endpoint-family invalidation

The new endpoint-family matcher compares URL pathnames and segment boundaries. `/api/accounts` matches `/api/accounts/all` but does not match `/api/accounts-old`. Query strings do not affect family matching.

This removes the collision risk created by plain string-prefix invalidation.

## Active-only refetch

The shared invalidation helper defaults to active-only refetch. Mutations can mark all matching cache entries stale without downloading heavy inactive pages in the background. A caller may explicitly request another refetch type when business behavior requires it.

## Response-shape normalization

`unwrapList` accepts existing array responses and common paginated response shapes using `data`, `items`, `rows`, or `results`. Pages can migrate to pagination without duplicating shape-detection logic or changing current API responses.

## Query policies

Three named policies are provided:

- `reference` for stable picker and reference data;
- `operational` for normal business screens;
- `live` for data that must refresh whenever mounted.

These policies make stale time, garbage collection, mount behavior, and focus behavior explicit instead of relying on page-specific copies.

## Compatibility

- Existing API endpoints and response formats remain valid.
- The real request URL stays first in every shared key.
- Phase 4 company-session keys and switch isolation remain available.
- Existing factory and inventory key factories are retained.
- No global polling interval was added.
- No backend or database changes were introduced.

## Verification boundary

Focused contracts cover canonical URL generation, company isolation, exact endpoint-family matching, active-only invalidation, list-response normalization, and shared query factories.

No CI, TypeScript compilation, lint, unit tests, production build, browser testing, database testing, or deployment checks were run.

## Merge boundary

Phase 8 was integrated only after the earlier phases and explicit owner authorization.
