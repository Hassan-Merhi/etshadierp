# Remote Support Phase 2 — Faster Silent Watching

Phase 2 replaces the normal 15–30 second watch-detection and viewer polling path with authenticated Server-Sent Events while preserving the original polling routes as automatic fallbacks.

## Delivered behavior

- Opening the Developer watch dialog creates a live frame stream for the selected user.
- The watched browser receives an immediate silent status event and starts capturing without a popup, toast, sound, or permission prompt.
- New frames are pushed to the Developer as soon as the server accepts them.
- The watched browser captures approximately every 1.2 seconds while the screen is changing.
- Capture frequency slows to 3.5–5 seconds while the sampled screen remains unchanged.
- Identical frames are not uploaded unless a new click must be delivered.
- Fast frames are resized and JPEG-compressed toward a maximum data URL length of 420 KB.
- The existing `/being-watched` and `/:userId` polling routes remain available when SSE is unsupported or interrupted.

## New live routes

- `GET /api/screen-feed/live/status` — authenticated watched-browser status stream.
- `GET /api/screen-feed/live/:userId` — Developer-only live frame stream.

Both routes are same-origin, session-authenticated, non-cacheable, and protected by the Phase 1 runtime switches.

## Safety and rollback

- `screenFeedEnabled=false` disables capture, polling, and live delivery.
- `fastScreenFeed=false` disconnects live streams and causes clients to use the previous polling path.
- The emergency-stop endpoint immediately disconnects live streams and clears active watcher markers.
- `DISABLE_SCREEN_FEED=true` remains the hard process-start override.
- Remote mouse and keyboard controls remain disabled.

## Storage and database impact

Frames, subscriptions, watcher markers, and metrics remain process-local and ephemeral. No SQL or schema migration is required.

## Verification targets

- Live hub viewer and disconnect behavior.
- Runtime defaults, kill switch behavior, and live metrics.
- Adaptive capture delay, duplicate suppression, and deterministic frame signatures.
- TypeScript, build, lint, formatting, backend tests, frontend tests, API smoke tests, coverage gates, security checks, and route-manifest ratchets.
