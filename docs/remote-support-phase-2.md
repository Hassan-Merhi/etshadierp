# Remote Support Phase 2 — Faster Silent Watching

Phase 2 provides an authenticated Server-Sent Events transport for low-latency screen viewing while preserving the original polling routes as automatic fallbacks.

## Delivered behavior

- Fast mode is disabled by default and must be enabled through the protected runtime controls.
- Opening the support watch dialog creates a live frame stream for the selected user only when fast mode is enabled.
- The watched browser receives silent status updates and begins capture without a popup, toast, sound, or permission prompt.
- New frames are pushed to the support viewer as soon as the server accepts them.
- Capture delay adapts automatically: active screens are sampled quickly, unchanged screens slow down, and failed or backpressured uploads pause before retrying.
- Identical frames are not uploaded unless a new click must be delivered.
- Fast frames are resized and JPEG-compressed before upload.
- The existing `/being-watched` and `/:userId` polling routes remain available when fast mode is disabled, SSE is unsupported, or a stream is interrupted.

## Conditional polling transport

The fallback `GET /api/screen-feed/:userId` route now emits an ETag derived from the current frame, pointer, and click identity.

- Viewers can send `If-None-Match`.
- An unchanged fast-mode frame returns `304 Not Modified` without retransmitting the image payload.
- Changed frames continue returning the existing JSON response shape.
- The response identifies `fast` or `legacy` transport through `X-Screen-Feed-Transport`.

## Reconnect and switching cleanup

- SSE reconnect delay receives per-connection jitter to avoid synchronized reconnect spikes.
- Closing the watch dialog or switching the watched user closes the previous `EventSource`, resets frame and cursor state, and leaves polling recovery available.
- Server-side viewer cleanup removes stale watcher markers when the final viewer disconnects.

## Payload and backpressure protection

- Fast-mode frame payloads are capped at 900,000 data-URL characters.
- Legacy payloads retain the 1,500,000-character ceiling.
- Oversized uploads return `413 Payload Too Large`.
- Fast producers are rate-limited to prevent overlapping capture pressure.
- Backpressure returns `429 Too Many Requests` with `Retry-After: 1`.
- The existing adaptive client delay treats rejected uploads as failures and backs off before retrying.
- Watched-user identifiers are bounded and restricted to safe characters.

## Live routes

- `GET /api/screen-feed/live/status` — authenticated watched-browser status stream.
- `GET /api/screen-feed/live/:userId` — authorized support-viewer frame stream.

Both routes are same-origin, session-authenticated, non-cacheable, and protected by the Phase 1 runtime switches.

## Safety and rollback

- `screenFeedEnabled=false` disables capture, polling, and live delivery.
- `fastScreenFeed=false` disconnects live streams and causes clients to use the polling path.
- Runtime changes, restore-defaults, and emergency stop clear transport pressure state.
- The emergency-stop endpoint immediately disconnects live streams and clears active watcher markers.
- `DISABLE_SCREEN_FEED=true` remains the hard process-start override.

## Storage and database impact

Frames, subscriptions, watcher markers, backpressure state, and metrics remain process-local and ephemeral. No SQL or schema migration is required.

## Verification targets

- Fast mode remains disabled at boot.
- ETag and `304 Not Modified` behavior preserves the frame response contract.
- Reconnect jitter and stream cleanup do not leak previous watched-user state.
- Payload limits and `429` backpressure remain limited to the screen-feed transport.
- Polling recovery remains available whenever the live path is unavailable.
