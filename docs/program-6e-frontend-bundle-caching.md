# Program 6E — Frontend Bundle and Caching

Branch: `integration/programs-1-to-6-validation`

## Objective

Reduce initial JavaScript cost and repeated network work without changing business calculations, mutation behavior, company isolation, offline behavior, or user-visible data freshness after writes.

## Completed controls

### Route-level code splitting

`client/src/lazyPages.ts` centralizes React.lazy imports for ERP, POS, Factory, and Supplier Partner pages. Heavy pages are loaded only when navigated to instead of entering the initial application bundle.

### Heavy export dependencies

Stock Items and other reviewed export screens dynamically import `@/lib/excelHelper` at export time. ExcelJS/XLSX work therefore remains outside the initial route bundle where the screen does not need it immediately.

### Stable query keys

`client/src/lib/queryKeys.ts` provides shared key factories and normalized filter objects. The first key element is always the real request URL used by the shared query function. Lightweight and full stock-item contracts use different URL prefixes, preventing broad full-list invalidations from refetching selector payloads.

### Refetch suppression

The shared QueryClient disables automatic polling, window-focus refetch, mount refetch, and reconnect refetch by default. Data-changing flows explicitly invalidate the required caches after successful mutations.

### Scoped invalidation

`client/src/lib/queryClient.ts` provides:

- `keyStartsWith()` for parameterized URL keys
- stock-item light-cache invalidation
- paginated stock-item management invalidation
- combined stock-item invalidation
- `refetchType: "active"` support so inactive heavy screens are not fetched in the background

Financial/customer invalidation remains intentionally broader because balances must refresh together after writes.

## Verification guard

Run:

```bash
node scripts/verify-program6e-frontend-bundle-caching.mjs
```

The guard verifies:

- broad React.lazy route coverage remains present
- normalized heavy query keys remain present
- lightweight stock-item keys continue using the real lightweight URL
- automatic refetch triggers remain disabled globally
- active-query-only invalidation support remains present
- Stock Items does not regain a static Excel helper import

## Safety decisions

- No query was given an arbitrary long stale time to hide missing invalidation.
- No financial response was cached outside the existing application query lifecycle.
- No mutation invalidation was removed unless a dedicated equivalent already existed.
- No offline queue or reconnect behavior was altered.
- Export resource limits and streaming remain Program 6F scope.

## Completion status

Program 6E is implementation-complete. Runtime bundle-size comparison is optional operational evidence, not a blocker to the code safeguards, because route splitting, dynamic heavy imports, stable keys, and refetch constraints are statically enforceable in this repository.
