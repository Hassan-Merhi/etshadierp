# Remote support Phase 4 — pre-authorized control sessions

Phase 4 adds the guarded session layer required before mouse or keyboard commands can exist.

## Completed behavior

- Developer is the only controller role by default. Additional roles must be explicitly configured through `REMOTE_SUPPORT_CONTROLLER_ROLES`.
- Opening the existing live Watch view starts a control-ready session only when the `remoteControl` runtime flag is enabled.
- A session is bound to one authenticated ERP browser tab using a per-tab `sessionStorage` identifier and heartbeat.
- Only one controller may hold an active session for a target user at a time.
- Sessions expire after a bounded duration, stop when the controller viewer closes, and stop when either browser tab disconnects.
- The employee sees a small persistent **Admin support active** indicator only while a session is active.
- The employee can stop the session immediately from the indicator. The controller stops it by closing the final Watch viewer or through the authenticated stop endpoint.
- The existing global emergency stop and runtime rollback terminate every active session.
- The session exposes no mouse, keyboard, clipboard, desktop, operating-system, or other-tab command endpoint. Those remain blocked until later phases.

## Safety boundaries

- Scope is fixed to `erp-browser-tab`.
- Mouse and keyboard capabilities are explicitly `false` in every Phase 4 session.
- The session identifier is random and server-issued.
- Target and controller heartbeats are required; stale sessions fail closed.
- No passwords, field values, clipboard contents, or screenshots are added to session state.

## Storage and SQL

Phase 4 session and tab-presence state is intentionally transient and in memory. No SQL or migration is required. Permanent session and action auditing belongs to Phase 7, where the schema can be introduced together with the server-side sensitive-action policy.

## Rollout

`remoteControl` remains disabled by default. Enable it through the existing Developer runtime controls only after deploying this phase. Disabling the flag or invoking the emergency stop immediately ends active sessions.
