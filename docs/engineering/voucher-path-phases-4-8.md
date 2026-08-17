# Voucher Path Review — Phases 4–8

This branch consolidates voucher request-identity hardening Phases 4 through 8 into one reviewable programme.

## Phase 4 — Operational retry boundary

Carries forward the completed 22-writer Phase 4 durable operational request boundary, including browser/offline retry identity persistence, company scoping, replay/conflict handling, uncertain-outcome fail-closed behavior, and the expanded route matrix.

## Phase 5 — Remaining operational writers

Convert the remaining 22 operational voucher-creation paths. Completion target: `operational-without-request-identity = 0`.

## Phase 6 — Migration/import/repair identities

Give each rerunnable migration/import/repair/admin conversion a deterministic source/run identity instead of a browser-only request identity. Interrupted runs must safely resume and replays must not add vouchers.

## Phase 7 — Remove direct voucher-creation escape hatches

Require voucher creation through approved canonical writers or documented restoration/recovery exemptions, with CI rejecting new unapproved direct voucher inserts.

## Phase 8 — Retry/concurrency closure

Run the system-wide retry/concurrency regression matrix and final write-evidence audit. Final targets are zero unreviewed paths, zero operational writers without identity, zero unsafe infrastructure writers, zero rerunnable special-purpose writers without deterministic identity, and all CI green.

## Verification policy

Per the owner instruction for this combined branch, implementation is completed first. Full repository checks and CI verification are intentionally deferred until all Phase 4–8 code changes are in place; no green-check claim is made before that final pass.
