# Bandwidth Phase 1 — Request Containment

## Scope

This phase contains repeated high-bandwidth API reads observed in the July 28, 2026 production snapshots. It does not change accounting formulas, stock quantities, costing, posting, permissions, schemas, or deletion behavior.

## Runtime behavior

- Identical in-flight hotspot GET requests share one network response.
- Successful hotspot responses use short, endpoint-specific browser snapshots.
- All hotspot requests pause while the browser tab is hidden.
- Every POST, PUT, PATCH, and DELETE clears snapshots before and after the write.
- A write-generation guard prevents a GET racing a mutation from repopulating stale data.
- `Range`, `no-store`, `reload`, and `X-Bypass-Request-Storm-Guard` requests bypass snapshots.
- The cache is limited to 32 entries.
- Normal responses are capped at 1.5 MB; `/api/containers/otw-items` alone receives a bounded 4 MB allowance until Phase 2 replaces its oversized response.

## Primary protected routes

The protected routes include OTW items, inventory, ERP and factory containers, ledger accounts, bale products, workers, attendance and salary reports, raw stock, mix batches, supplier reads, accounts, stock-item selectors, daybook, stock movement, user-company context, and barcode lookup.

## Verification

Run:

```bash
npm run verify:bandwidth
```

Live production success criteria remain below 50 MB of API responses in each five-minute reporting window after deployment.
