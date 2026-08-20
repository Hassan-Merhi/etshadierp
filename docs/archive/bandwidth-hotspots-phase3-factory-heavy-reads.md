# Bandwidth Hotspots — Phase 3 Factory Heavy Reads

## Scope

Phase 3 reduces repeated Factory response bytes and database query pressure for the production hotspots observed in Render bandwidth diagnostics. It does not change accounting formulas, stock quantities, supplier costing rules, invoice totals, permissions, schemas, or write semantics.

Verification, builds, lint, TypeScript, tests, GitHub Actions and production bandwidth comparison are intentionally deferred to Phase 5 so Phases 1–4 can be audited together against one final branch.

## Customer proformas

### Compact summary list

`GET /api/factory/customer-proformas?customerId=<id>&profile=summary` now returns proforma metadata plus SQL-aggregated card metrics instead of downloading every line for every proforma:

- `lineCount`
- `totalQty`
- `totalWeightKg`
- `totalAmount`
- `lines: []`

The total amount preserves both `per_bale` and `per_kg` pricing semantics.

### Lazy line detail

The Factory Proformas page uses the compact summary for its collapsed cards. Line detail is fetched from `GET /api/factory/customer-proformas/:id` only when that proforma is expanded. Expanded detail is cached for five minutes and does not refetch on focus, reconnect, or remount.

Proforma writes invalidate both summary and open detail keys so the lazy caches remain coherent after create, rename, activation, transfer, line edits, price application and deletion.

The full-list route remains backwards compatible for legacy callers but explicitly selects only fields needed by existing proforma UI/contracts.

## Customer-order scanning

Successful `POST /api/factory/customer-orders/:id/bales` responses now return the refreshed order header plus the current bale list only.

The former response re-read and retransmitted order lines and charges after every physical bale scan even though scan screens do not need those resources to acknowledge the scan. Lines and charges remain available through their existing order-detail/read contracts.

Payload marker: `X-ERP-Payload-Profile: customer-order-scan-state`.

## Bale Ledger

`GET /api/factory/bale-ledger` is accelerated before the legacy route with SQL-side classification and aggregation.

The previous implementation loaded all relevant bales, all products, all categories, active-order bale IDs and stale-order bale IDs into Node, then grouped every bale in memory. Phase 3 performs the same current-stock / waste / sold / dispatched / pending-loading classification in PostgreSQL and returns product-level aggregates only.

Historical sold/dispatched scanning remains limited to the same 90-day `factory_bales.created_at` window used by the legacy implementation. Current `IN_STOCK` and `RESERVED_FOR_ORDER` bales are always included.

Waste classification preserves the legacy rules: a bale is waste when its own article code starts with `HMD16`, or its current product category contains `garbage` or `wiper`.

`GET /api/factory/bale-ledger/details?section=...&productId=...` keeps individual bale rows lazy and returns only `id`, `ref`, `weightKg`, and the displayed production-price value.

Payload markers:

- `bale-ledger-sql-aggregate`
- `bale-ledger-detail-sql`

Existing Bale Ledger clients already keep the summary/detail queries stale for five minutes and avoid focus/mount refetching, so the smaller SQL-side payloads are reused rather than repeatedly transferred.

## Raw-stock offload selector

`GET /api/factory/raw-stock/available-containers` now selects only fields consumed by the Offload dialog instead of returning full Factory container records.

Completed partial receipts are filtered in SQL before serialization. For still-partial containers, only the latest raw-stock cost pair required to preserve the established landed rate is added.

Company isolation continues to use `resolveRequestCompanyId`.

Payload marker: `X-ERP-Payload-Profile: raw-stock-offload-selector`.

## Mix batches

`GET /api/factory/mix-batches` no longer performs one persisted locked-rate lookup for every supplier in the list.

Persisted supplier locked USD rates are fetched in one query. Suppliers whose persisted rate is still NULL retain the existing read-only stable historical fallback; those legacy fallbacks are resolved concurrently and do not write from the list read.

Only mix-batch source fields required for the display blend are selected. The established costing rules remain unchanged:

1. source-batch rows use their stored source cost;
2. supplier rows use the supplier locked USD rate;
3. rows with neither use their stored source cost.

Payload marker: `X-ERP-Payload-Profile: mix-batches-bulk-locked-rates`.

## Database changes

No migration or manual SQL is required for Phase 3.

## Current-main re-certification — 2026-08-20

The Production/Bandwidth Hardening program was re-audited from current `main` after the Phase 1 Stock Allocation invalidation fix and the Phase 2 Customer Loading compact availability response landed.

The Phase 3 heavy-read optimizations listed above are already present on current `main`, so they are being re-certified rather than duplicated. The current implementation also retains the query-pressure protections documented in `bandwidth-phase3-query-pressure.md`: supplier-balance batching plus the server read microcache for the major Factory/accounting read hotspots.

Customer Loading itself now combines the Phase 1 no-background-invalidation policy with the Phase 2 compact availability response. Its allocation query keeps a two-minute stale window, ten-minute cache lifetime, one retry, and focus/reconnect refetch disabled; no additional interval polling is introduced by Phase 3.

The re-certification target is therefore preservation of the existing optimized contracts on the latest main ancestry, with full exact-head CI used as the completion gate. No new accounting, stock-allocation, costing, authorization, company-scope, schema, migration, or quality-ratchet change is required for this Phase 3 pass.

## Deferred Phase 5 verification

The final verification phase must run the full project checks and specifically confirm:

- TypeScript and lint are green;
- production build is green;
- existing route-ownership and bandwidth tests are updated where they assert the old implementation text instead of the new contracts;
- customer proforma summary cards and lazy expansion preserve values and edits;
- loading scans preserve order state while avoiding lines/charges retransmission;
- Bale Ledger bucket totals/details match the previous classification rules;
- raw-stock selector retains every Offload dialog field and established partial-container cost;
- mix-batch display rates/totals match the supplier locked-rate rules;
- Render five-minute bandwidth windows materially reduce customer-proforma, bale-ledger, raw-stock/available-containers, mix-batch and customer-order traffic compared with the pre-Phase-3 baseline.
