---
name: Factory supplier locked raw-material rate — final design
description: How the persisted per-supplier USD raw-material cost/kg is computed, when it moves, and how reads/corrections must stay consistent.
---

A supplier's raw-material cost/kg (`factorySuppliers.currentRawMaterialCostPerKgUsd`) is a persisted, event-driven value — never recomputed live from full receipt history on read.

It only changes on:
1. A real container offload / opening-balance receipt — moving average using the supplier's **authoritative remaining kg** (raw-stock received-used, plus supplier-linked ADD adjustments, minus REMOVE adjustments; DEDUCT already reduces raw-stock rows directly so it's excluded) as the pre-offload base, not all-time received kg.
2. An explicit landed-cost correction — a **delta** applied only to each container's still-remaining kg, then spread across the supplier's total remaining kg. Never recompute by reintroducing already-consumed kg into the average.
3. The explicit "Update Cost per KG" adjustment (`POST /api/factory/raw-stock/update-cost`) — sets the rate directly (valid since after this op every row shares one cost), and its mix-batch/batch/bale cascade must be scoped to OPEN batches only, never closed/completed ones.

Mix-batch create/edit/top-up/delete, consumption, reservations, and any client-supplied `costPerKg` must never influence this rate — always read the locked rate server-side and ignore client cost fields for supplier-linked sources.

**Why:** earlier logic weighted by remaining-kg-at-read-time (drifts under FIFO consumption) or recomputed from all-time received kg (wrongly re-averages consumed stock back in on every correction).

**How to apply:** any new read path (a report, KPI, diagnostic) must call the same `getLockedSupplierRate`/`getAuthoritativeSupplierRemainingKg` helpers in `server/services/factory/rawStockLockedRate.ts` — never inline a fallback default (e.g. defaulting a NULL persisted column to 0), or that surface will silently disagree with every other display of the same rate. KPI "Total Used Value" should sum `factoryMixBatchSources.totalCost` per supplier (locked-rate-at-creation-time), not a blended average × used kg.

Also: `npx tsc --noEmit` can OOM on this repo's size; run with `NODE_OPTIONS=--max-old-space-size=4096` first before assuming a real type error.
