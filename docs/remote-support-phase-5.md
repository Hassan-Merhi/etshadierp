# Remote support Phase 5 — guarded mouse control

## Scope

Phase 5 adds mouse movement, safe clicks, and scrolling inside the exact authenticated ERP browser tab established in Phase 4. It does not add keyboard input, clipboard access, desktop control, operating-system control, or access to another browser tab.

## Controller activation

- Opening the Watch view still creates only the bounded Phase 4 support session.
- Mouse control remains read-only until the controller explicitly selects **Enable**.
- The controller must confirm their own password. The existing authenticated password-confirmation timestamp is accepted for no more than five minutes.
- Authorization is bound to the controller, support session, target user, and exact target browser-tab identifier.
- Closing the Watch view, stopping the support session, session expiry, tab disconnect, runtime disable, restore-defaults, or the global emergency stop ends the usable command path.

## Allowed commands

- Pointer movement, with a visible support pointer in the employee ERP tab.
- Bounded scrolling in the nearest scrollable ERP surface.
- Clicks on same-origin navigation links, tabs, read-only View/Open/Details/History controls, and controls explicitly marked as safe.

## Commands blocked in Phase 5

The target tab evaluates every click locally and fails closed. Phase 5 blocks:

- Forms, inputs, text areas, selects, editable content, disabled controls, and protected support UI.
- Save, submit, create, add, edit, delete, approve, reject, payment, transfer, offload, reversal, import, export, print, logout, permission, password, and similar state-changing actions.
- Unknown buttons that are not on the read-only allowlist.
- External links, downloads, new-window links, and JavaScript links.
- Every keyboard, typing, clipboard, file, desktop, and operating-system command.

The employee can still stop the complete support session immediately from the persistent **Admin support active** indicator.

## Transport and validation

- Commands and results use authenticated Server-Sent Events plus CSRF-protected POST routes.
- Coordinates are normalized and validated server-side.
- Scroll deltas are bounded.
- Commands are sequenced, rate-limited by type, expire quickly, and are rejected when the target command stream is unavailable.
- Target results report `executed`, `blocked`, or `ignored` without transmitting field values or sensitive page content.
- Broken streams are isolated so one disconnected listener cannot affect another session.

## Rollout and storage

- The existing `remoteControl` runtime flag remains disabled by default.
- `DISABLE_SCREEN_FEED=true` and the global emergency stop remain hard rollback paths.
- Phase 5 state is transient and in memory. No SQL or migration is required.
- Permanent session and command auditing remains Phase 7 so the schema is introduced together with the full sensitive-action policy.

## Verification

- Session tests now require mouse capability while keyboard capability remains disabled.
- Backend tests cover password freshness, controller ownership, exact target-tab binding, normalized commands, bounded scrolling, command sequencing, rate limits, missing streams, result ownership, and broken-listener isolation.
- Frontend tests cover image coordinate mapping, protected elements, safe navigation, explicit allowlisting, blocked mutation controls, pointer movement, and nearest-container scrolling.
