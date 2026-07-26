# Historical Replay Phase 8 — production readiness and controlled release

## Status

Phase 8 adds a fail-closed production control plane around the completed V7 Historical Replay engine. It does not execute a migration, preview, Prepare, Apply, Undo, deployment, or production database command by itself.

The existing V7 engine remains authoritative for:

- full-company supplier dependency closure;
- exact signed scope and fingerprint validation;
- cost-only writes;
- serializable transaction and advisory locking;
- exact non-cost invariants;
- one-use replay tokens;
- atomic audit and undo snapshot persistence; and
- stale-safe Undo.

Phase 8 does not change moving-average formulas, inventory quantities, accounting entries, finalized-bale policy, or source-priority rules.

## New protection boundary

Apply is disabled unless both runtime controls are present with exact values:

```text
HISTORICAL_REPLAY_APPLY_MODE=APPROVED_V8_CONTROLLED_APPLY
HISTORICAL_REPLAY_RELEASE_ID=<approved 8-128 character release identifier>
```

A release identifier is operational metadata, not a password. Use a unique value for one approved release window, for example:

```text
2026-07-26-replay-01
```

Removing either setting immediately disables new Apply requests. Changing the release identifier invalidates previously prepared V8 authorizations.

## Readiness endpoint

Developer and Admin users may inspect:

```text
GET /api/factory/raw-stock/recalc/historical-replay/readiness
```

The endpoint is read-only. It reports:

- current algorithm and readiness versions;
- whether the explicit runtime release gate is enabled;
- missing required tables, columns, indexes, triggers, or constraints;
- current replay safety blockers;
- applicable supplier/change counts; and
- the most recent exact replay/undo record for the active company.

`readyForApplyAuthorization` must be `true` before an authorized Prepare can issue the second V8 token.

## Two-token Apply

Prepare still creates the existing exact replay confirmation token. When all V8 controls pass, the server also creates a short-lived Apply authorization token bound to:

- the active company;
- the current user;
- the configured release identifier;
- the exact V7 algorithm version;
- the Phase 8 readiness version; and
- the SHA-256 hash of the exact prepared replay token.

The client freezes both server-issued tokens and the release identifier with the prepared request. Apply fails closed when any value is absent, expired, changed, or mismatched. A browser reload that loses the frozen authorization requires a new Prepare.

The second token does not replace any existing V7 protection. Apply must still pass the exact replay token, company/user binding, algorithm version, fingerprint, signed scope, current-state locks, cost arithmetic, invariants, one-use token insertion, audit write, and undo snapshot transaction.

## Required release procedure

1. Confirm a current database backup exists and has been validated under the database recovery runbook.
2. Deploy the code and required schema migrations through the controlled versioned-migration process. Do not use startup repair logic as evidence of readiness.
3. Leave `HISTORICAL_REPLAY_APPLY_MODE` unset while checking the normal application.
4. Open the V8 readiness endpoint for the intended company and resolve every schema and safety blocker.
5. Review the normal Historical Replay preview, including supplier changes, raw-material value, Balance on Table, and projected Net Position.
6. Set a unique approved `HISTORICAL_REPLAY_RELEASE_ID` and the exact Apply mode value for the release window.
7. Re-open readiness and require `readyForApplyAuthorization: true`.
8. Run Prepare immediately before the approved Apply and review the exact frozen supplier, container, raw-stock, source, batch, bale, and financial scope.
9. Apply once. Do not retry with an old response after an error; re-open readiness and re-run Prepare.
10. Record the returned result, audit entry, undo-log ID, algorithm version, scope fingerprint, and release identifier in the release record.
11. Remove `HISTORICAL_REPLAY_APPLY_MODE` after the approved Apply window so future applies return `HISTORICAL_REPLAY_APPLY_DISABLED`.
12. Perform read-only post-apply reconciliation before allowing any unrelated cost repair.

## Post-apply reconciliation

The operator must verify, without editing data:

- the latest exact undo record exists for the company;
- its algorithm version and fingerprint match the approved Prepare;
- the consumed-token record exists;
- the audit entry records the expected supplier and exact scope;
- the Historical Replay preview no longer reports the applied mismatches;
- raw-material value and Balance on Table match the reviewed projection within established decimal precision;
- inventory quantities, source weights, batch weights, bale weights, statuses, ownership, dates, and accounting entries did not change; and
- no finalized/sold bale was updated.

If reconciliation is not exact, stop. Do not run another replay over the same scope. Use the existing exact Undo only after confirming that its stale-state and invariant checks still pass.

## Undo boundary

Phase 8 does not loosen Undo. Undo remains:

- company-scoped;
- algorithm-version matched;
- serializable and advisory-locked;
- available once only;
- conditional on the current rows still matching the exact post-apply snapshot; and
- atomic with its audit entry and `undone_at` marker.

A stale Undo refusal is a safety result, not permission to bypass the guard or manually rewrite the snapshot.

## Explicit non-actions

This phase does not:

- turn Apply on by default;
- add autonomous scheduling;
- run on startup;
- execute a replay from health/readiness checks;
- alter historical costs while inspecting readiness;
- update finalized/sold bales;
- write accounting entries;
- change raw-material quantities; or
- merge or deploy itself.
