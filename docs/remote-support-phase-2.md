# Remote Support Phase 2 — Faster Feed Transport

Phase 2 adds a lower-latency, lower-repeat-bandwidth transport path while preserving the existing screen-feed endpoint and behavior as the fallback.

## Default state

- `fastScreenFeed` remains disabled by default through the Phase 1 runtime configuration.
- The existing `/api/screen-feed/:userId` viewer remains available.
- Normal ERP behavior is unchanged when the flag is disabled.
- No database migration or SQL is required.

## Safety controls

- Viewer access remains restricted to the `Developer` role.
- Watched-user identifiers are length and character bounded.
- Fast-mode frame payloads are capped at 900 KB.
- Producers are rate-limited to prevent overlapping capture/upload pressure.
- Rejected oversized payloads return `413`.
- Backpressure returns `429` with `Retry-After`.
- The Phase 1 emergency stop clears watcher state and fast-transport rate state immediately.

## Bandwidth behavior

When `fastScreenFeed` is enabled, the server emits an ETag for each frame. A viewer that already has the current frame can send `If-None-Match`; unchanged frames return `304` without retransmitting the image payload.

The response also includes `X-Screen-Feed-Transport: fast|legacy` so rollout behavior can be observed without changing the payload contract.

## Rollout

1. Confirm Phase 1 runtime controls are available and the emergency stop works.
2. Enable `fastScreenFeed` only for a controlled Developer test.
3. Confirm unchanged viewer requests return `304` and new frames return `200`.
4. Confirm oversized frames return `413` and excessive uploads return `429`.
5. Use the emergency-stop endpoint immediately if unexpected behavior appears.

## Rollback

Disable `fastScreenFeed` through the Phase 1 runtime endpoint. The old viewer route and frame store remain intact. For a complete shutdown, use the emergency-stop endpoint or `DISABLE_SCREEN_FEED=true`.

## Database

No SQL and no migration are required.
