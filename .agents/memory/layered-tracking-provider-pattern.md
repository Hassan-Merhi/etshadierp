---
name: Layering a single-purpose tracking provider onto an existing multi-provider pipeline
description: How to add a new, narrower external-data provider (e.g. one that only returns ETA) alongside an existing multi-provider tracking system without disturbing it.
---

When a new external provider only supplies a subset of what an existing multi-provider tracking
pipeline already handles (e.g. it returns ETA only, not status/location/events), and it needs its
own refresh cadence different from the existing scheduler's per-priority cooldowns, don't fold it
into the existing provider chain or its shared columns.

**Why:** The existing pipeline's cadence, retry policy, and status/location ownership are tuned for
its own providers; giving the new provider distinct DB columns (its own `*LastCheckedAt`,
`*TrackingStatus`, `*Error`) keeps its gating fully self-contained and avoids ambiguity about which
provider populated which field. Writing only to the field it's authoritative for (e.g. `eta` +
`etaSource`) — not `trackingProvider`/status/location — keeps the existing pipeline's ownership
of those fields intact.

**How to apply:** Build the new provider as its own module (HTTP client + a `refresh*`/`get*`
service layer) with an internal self-throttling gate (checks its own last-checked column against a
configurable window) so it can safely piggyback on whatever cron/scheduler already invokes the
existing pipeline — no new scheduled job needed. Wire it in with a single best-effort, try/caught
call inserted at the top of the existing pipeline's per-item function, so a failure in the new
provider never breaks the existing flow. Never let the new provider blank a previously-known value
on null/error responses.
