---
name: FX safe-repair service design
description: How the raw-material FX-unresolved repair service is scoped, gated, and where its boundary sits relative to the cost-recalc service.
---

`server/services/factory/fxResolutionRepair.ts` + `POST /api/factory/suppliers/fx-diagnostic/repair` only
resolve a row's `fxRateConfirmed`/`fxRateToUsd` from an admin-supplied explicit rate — they never guess a
rate and never recompute downstream cost/kg or cascade to mix batches/bales. That cascade remains the
separate `rawStockRecalc.ts` preview/apply pair (`GET /api/factory/raw-stock/recalc/preview`,
`POST /api/factory/raw-stock/recalc/apply`), which already refuses to touch fx-unresolved containers.

**Why:** the user explicitly required "no auto-repair of missing FX" — the only safe repair is accepting
a human-supplied real rate, never inferring one; and "never rewrite CLOSED/COMPLETED historical costing".

**How to apply:** every repair-style endpoint on raw-material data must: gate with `checkFactoryAdmin`;
default to dry-run and return a `confirmationToken` (sha256 of the exact op's params) that the apply call
must echo back, so replay/fat-finger can't silently apply a different repair than what was previewed;
wrap the write in `db.transaction` + `pg_advisory_xact_lock`; check container status against
CLOSED/COMPLETED/OFFLOADED and refuse with a `MANUAL_REVIEW_REQUIRED`-coded 409 instead of writing; and
audit-log via `logAudit` from `server/routes/helpers/auditHelpers.ts` on every actual write. The existing
raw-stock bulk endpoints (`recalculate-used`, `recalculate-bale-costs`, `recalc/apply`) were retrofitted
with the same admin+dry-run+audit-log shape — they previously had none of it.

`decimal.js` is wired into the shared chokepoint (`resolveStoredFxRate`/`applyFxRate` in
`currencyConversion.ts`) but NOT yet propagated into every caller's own `parseFloat` arithmetic
elsewhere (weighted averages, stock value sums, supplier balance rollups still use floats) — that
remains a real, not-yet-done piece of the "decimal.js not floats" requirement.
