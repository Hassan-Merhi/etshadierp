---
name: Raw-stock recalc full-audit system
description: Summary of the full audit/repair system built for raw material cost recalculation
---

**What was built:**
- `getFullAuditScan(companyId)` — full read-only scan, emits `{summary, rows}` with per-container audit codes and `safeToRepair` flag
- `computeApplyAllDryRun(companyId, opts)` — estimates scope of "Apply All Safe" without writing
- `getMixBatchSourceCostMismatchPreview(companyId)` — full source scan (zero AND nonzero wrong costs), uses `costPerKgUsd` throughout
- Three new routes: `GET /api/factory/raw-stock/recalc/full-audit`, `GET /api/factory/raw-stock/recalc/source-cost-mismatches`, `POST /api/factory/raw-stock/recalc/apply-all-safe`
- `RawStockRecalculate.tsx` — full overhaul with 3-tab UI (Container Cost Recalc / Source Cost Mismatches / Full Audit), expandable batch sources, 6dp cost display
- `tests/factory-raw-stock-recalc-full-audit.test.ts` — 26 tests, all passing
- `scripts/audit-repair-all-raw-material-costs.ts` — CLI: reads audit, applies repairs, re-verifies

**Key design decisions baked in:**
- `costEquals()` at 6dp replaces `EPS = 0.0005` — differences down to 0.000001 are real at 20 000 kg volumes
- Mix-batch sources store USD cost in `costPerKg` column — always compare/write via `costPerKgUsd` from the container
- `includeHistoricalContainers` flag bound in the repair token — scope can't expand silently at confirm time
- `otherChargesRows` included in fingerprint — any token issued before this deploy is automatically stale (acceptable)

**Live verification result (Render DB, company 12):**
- Initial: 5 containers, 2 safe repairs, 4 source mismatches, 2 FX-unresolved (excluded)
- After repair: 3 correct, 2 FX-unresolved, 0 safe mismatches
- CLI exit code 0

**Why:** All the existing float-comparison tolerances masked real 0.0001/kg errors; the new 6dp system catches them without breaking correctness for rounding noise (7th decimal rounds away).
