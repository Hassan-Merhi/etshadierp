# Remote support Phase 7 — permissions, sensitive-action protection, and permanent audit

## Scope

Phase 7 adds the permanent authorization and accountability layer for the screen viewing, mouse, and keyboard capabilities delivered in Phases 1–6.

The scope remains the exact authenticated ERP browser tab. It does not provide desktop, operating-system, another-browser-tab, clipboard, or file control.

## Dedicated permissions

Four independent Advanced Restrictions permissions are available:

- `remote_support_view` — open the screen viewer and establish a bounded support session;
- `remote_support_mouse` — enable and send guarded pointer, click, and scroll commands;
- `remote_support_keyboard` — enable and send guarded keyboard commands;
- `remote_support_audit` — view company-scoped permanent remote-support history.

Developer and Admin retain the existing permission-system bypass. Owner and Manager are allowed by the normal system default but can be explicitly restricted. Other roles remain denied unless explicitly granted. Controller-role validation remains an additional server-side gate.

## Company, user, and tab isolation

- Every employee tab heartbeat includes the active company.
- A support session binds the controller company, target user, exact target tab, and current ERP route.
- A controller cannot attach to a target tab in another company.
- Switching the target tab to another company immediately stops the session and disables mouse and keyboard capability.
- Controller session listings and the permanent audit endpoint are company scoped.

## Sensitive-action protection

The route policy treats the following surfaces as high risk:

- Settings and administration;
- account migration;
- permissions and role management;
- password and authentication controls;
- accounting period close;
- payroll approval, finalization, or posting;
- container offload and reversal.

On a high-risk route:

- keyboard control is blocked;
- mouse clicks are blocked;
- pointer movement and scrolling remain available for troubleshooting and observation.

The target-side Phase 5 and 6 policies continue to block mutation controls and sensitive fields even on ordinary routes. This defense is independent of labels sent by the controller.

## Permanent audit records

Phase 7 uses the existing `audit_log` table under module `remote_support_sessions`. No SQL or migration is required.

Recorded metadata includes:

- company and support-session identifier;
- controller user, username, and role;
- target user and username;
- ERP-tab scope and current route;
- capability and command type;
- sequence, status, bounded reason, and stop reason;
- keyboard text length when relevant.

The audit never stores:

- screen images or screenshots;
- passwords, OTPs, secrets, tokens, or credential values;
- field values or inserted keyboard text;
- clipboard or file contents.

Session start, mouse activation, keyboard activation, and command publication fail closed when the permanent audit write is unavailable. Emergency stopping always remains available and never waits for the database. Automatic expiry, disconnect, company change, runtime disable, restore-defaults, and emergency stop are observed by the session stop listener and recorded best effort without duplicate stop rows.

## Audit access

`GET /api/screen-feed/control/audit` requires `remote_support_audit`, applies the active company ID, and returns only rows from `remote_support_sessions`. Pagination is bounded to 100 rows per page.

## Rollback

- `remoteControl=false` ends interactive sessions.
- `keyboardControl=false` immediately removes keyboard capability.
- `screenFeedEnabled=false`, restore-defaults, and the global emergency stop terminate the complete support path.
- `DISABLE_SCREEN_FEED=true` remains the hard server-side override.

## Verification

Focused tests cover:

- the four dedicated permission catalog entries and route middleware;
- active-company and exact-tab binding;
- company-switch termination;
- high-risk route classification;
- keyboard and click blocking on high-risk routes;
- permanent audit redaction and bounded metadata;
- keyboard text-to-length conversion;
- automatic stop listener isolation;
- all Phase 5 and Phase 6 mouse and keyboard safety regressions.
