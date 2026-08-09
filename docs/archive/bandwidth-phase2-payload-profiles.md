# Bandwidth Phase 2 — Compact Payload Profiles

## Scope

Phase 2 reduces response bytes for the ERP Inventory Hub **On the way** tab without changing the default contracts used by the rest of the ERP.

## Active profiles

- `GET /api/containers?profile=otw-summary`
  - returns only OTW container `id`, `status`, and `grandTotal` fields;
- `GET /api/containers/otw-items?profile=stock-otw`
  - groups duplicate purchase-order lines by item, container, supplier, grade, and category;
  - returns only the fields rendered or exported by Stock OTW;
- `GET /api/containers/:id?profile=combined-detail`
  - removes charges, container metadata, and unused purchase-order fields;
  - keeps only the item fields Combined Inventory reads;
- `GET /api/inventory?profile=combined`
  - aggregates quantity and value across all locations in SQL;
  - returns one row per stock item rather than the first 100 location-level rows.

All profiles are opt-in. Requests without a `profile` query parameter retain their existing full responses.

## Query-cache isolation

Stock OTW historically stores `/api/containers` and container-detail responses under shared TanStack Query keys. Compact data must not be reused by Containers, purchase-order, offload, or detail screens.

The Phase 2 client guard therefore clears only the affected query keys whenever navigation enters or leaves `/inventory?tab=on-the-way`, including push, replace, back, and forward navigation.

## Expected bandwidth effect

The largest observed response, `/api/containers/otw-items`, was approximately 3.57 MB per request. Grouping duplicate line items and removing unused fields should materially reduce that payload. Combined Inventory also stops downloading location-level inventory rows that it immediately re-aggregates in the browser.

## Verification

Run:

```bash
npm run verify:bandwidth
```

Production success remains below 50 MB of API responses in every five-minute bandwidth reporting window after merge and deployment.
