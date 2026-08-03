# Remote Support Phase 1 — Safety Foundation

Phase 1 adds runtime safety controls around the existing screen-feed feature without changing its normal behavior.

## Default behavior

- The existing screen feed remains enabled unless `DISABLE_SCREEN_FEED=true`.
- Faster feed delivery is disabled.
- Interactive support controls are disabled.
- Keyboard input support is disabled.
- Sensitive-action protection is enabled.
- No database migration is required.

## Developer-only runtime endpoints

All endpoints require an authenticated user with the `Developer` role.

### Read status and measurements

`GET /api/screen-feed/admin/runtime`

Returns the active flags, revision, last updater, hard-disable state, and lightweight feed measurements.

### Update flags without redeploying

`PATCH /api/screen-feed/admin/runtime`

Example body:

```json
{
  "flags": {
    "screenFeedEnabled": true,
    "fastScreenFeed": false,
    "remoteControl": false,
    "keyboardControl": false,
    "sensitiveActionProtection": true
  }
}
```

Safety invariants are applied automatically:

- Disabling the screen feed disables every dependent capability.
- Disabling interactive support disables keyboard support.
- Sensitive-action protection cannot be disabled while interactive support is enabled.
- `DISABLE_SCREEN_FEED=true` remains a hard server-side override.

### Emergency rollback

`POST /api/screen-feed/admin/runtime/emergency-stop`

Immediately disables the screen feed and all dependent capabilities, clears active watcher markers, and does not require a deployment.

### Restore boot defaults

`POST /api/screen-feed/admin/runtime/restore-defaults`

Restores the safe boot defaults. A hard environment disable remains authoritative.

### Reset measurements

`POST /api/screen-feed/admin/runtime/reset-metrics`

Clears counters without changing feature flags.

## Measurements

The runtime snapshot includes:

- watched-browser status polls
- developer viewer polls
- accepted and rejected frames
- total and average frame payload size
- latest accepted frame size and timestamp
- latest viewer poll timestamp

The counters are process-local and intentionally ephemeral. They are for rollout verification and do not store screenshots or user input.

## Rollback procedure

1. Call the emergency-stop endpoint.
2. Confirm `screenFeedEnabled`, `fastScreenFeed`, `remoteControl`, and `keyboardControl` are all `false` in the returned snapshot.
3. If an application restart is planned, set `DISABLE_SCREEN_FEED=true` as the hard startup override.

The old screen-feed storage and polling implementation remains intact so later phases can be disabled without removing the existing fallback.
