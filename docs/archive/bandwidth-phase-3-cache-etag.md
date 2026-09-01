# Bandwidth Phase 3 — cache, ETags, and stable query identity

Phase 3 makes repeated reference-data reads stay inside React Query or revalidate with a weak ETag instead of downloading the same JSON again.

## Client behavior

- Stable reference URLs, including canonical query-string variants, use a 30-minute stale time and a two-hour garbage-collection window where exact defaults apply.
- The request-storm guard retains an expired representation only as an ETag validator. A `304 Not Modified` response refreshes its lifetime and reuses the saved body.
- Successful reference CRUD responses update every matching React Query cache locally. Existing computed fields are preserved when an entity is merged.
- Factory worker and worker-category CRUD no longer invalidates and refetches lists after the response has already supplied the updated entity.
- Shared reference key factories canonicalize parameter order and always include company identity for company-scoped data.

## Server behavior

The authenticated read microcache now covers the remaining stable company, preference, customer, asset, stock taxonomy, factory access, supplier, customer, and worker-category endpoints. Existing authorization, company-scoped keys, write invalidation, PostgreSQL cross-instance coordination, and weak ETag generation remain unchanged.

## Safety

- A client-side invalidation never serves a retained body directly. The next request must contact the authenticated server and receive `304` before that body can be reused.
- Operational descendants such as `/api/locations/:id/inventory` do not inherit the long reference-data React Query policy.
- No accounting, costing, stock, payroll, schema, or migration logic is changed.
