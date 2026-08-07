# Remote support Phase 8 — connection recovery and production verification

## Scope

Phase 8 completes the active remote-support program with deterministic connection health, bounded recovery behavior, and final production-focused verification.

This phase does not expand remote-support permissions or control scope. Existing viewing, mouse, keyboard, exact-tab binding, sensitive-action protection, audit, and emergency-stop rules remain unchanged.

## Connection health

Transport connectivity and frame freshness are evaluated independently.

- `excellent` — live transport is connected and the latest frame is younger than 2.5 seconds;
- `good` — a usable frame is younger than 6 seconds;
- `delayed` — the latest frame is between 6 and 15 seconds old;
- `stale` — the latest frame is at least 15 seconds old;
- `waiting` — no valid frame has been received yet.

A connected SSE socket never makes an old frame healthy by itself.

## Recovery decisions

The recovery model produces one explicit action:

- `none` for excellent or good feeds;
- `poll` when the transport is connected but the first frame is missing or the current frame is delayed;
- `reconnect` when the transport is disconnected or a connected stream remains stale.

Recovery retries use bounded delays of 1, 2, 4, 8, and 15 seconds. Further attempts stay capped at 15 seconds to prevent tight reconnect loops and excessive bandwidth.

A fresh healthy frame resets recovery state in the viewer integration. Manual refresh and existing polling fallback remain available.

## Failure handling

- Invalid or missing frames do not replace the last usable image.
- Transport failure and frame staleness remain separately observable.
- Recovery does not bypass authentication, permissions, rollout flags, or company and tab isolation.
- Closing or switching the watched user cancels timers, polling, and event streams.
- Disabling screen feed or remote control continues to stop the applicable support path.

## Verification

Focused tests cover:

- exact quality boundaries;
- stale connected transport classification;
- first-frame waiting behavior;
- polling versus reconnect decisions;
- disconnected and stale recovery;
- bounded retry delays and invalid attempt normalization;
- healthy-state no-op behavior;
- existing aspect-ratio and delay-format contracts.

The branch must pass the repository formatting, TypeScript, unit-test, static-build, and PostgreSQL regression checks before merge.

No SQL or schema migration is required.
