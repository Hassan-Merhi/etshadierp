# Remote Support Phase 8 — Controlled Rollout and Release Verification

Phase 8 completes the guarded remote-support program with a staged rollout gate, readiness reporting, immediate rollback, and release verification.

## Safety boundary

Passive screen viewing remains read-only. Interactive support remains limited to the exact authenticated ERP browser tab. It does not provide desktop, operating-system, other-browser-tab, clipboard, or file control.

During actual mouse or keyboard control, the employee sees the compact active-support indicator and can stop the session immediately. Sensitive-action protection, company isolation, exact-tab binding, bounded session expiry, local-user priority, permissions, recent controller password confirmation, and metadata-only permanent auditing remain mandatory.

## Rollout stages

- `disabled` — default. No interactive session can start.
- `internal` — Developer controllers and explicitly listed internal controller IDs only.
- `canary` — interactive support is limited to explicitly listed company IDs.
- `general` — permissioned controllers may start guarded sessions in their active company.

The rollout stage is independent from the lower-level runtime flags. Runtime hard-disable, screen-feed disable, remote-control disable, and sensitive-action protection always take precedence.

## Configuration

Optional boot-time environment variables:

- `REMOTE_SUPPORT_ROLLOUT_STAGE`
- `REMOTE_SUPPORT_CANARY_COMPANY_IDS` — comma-separated positive company IDs
- `REMOTE_SUPPORT_INTERNAL_CONTROLLER_IDS` — comma-separated user IDs

The safe default is `disabled`.

Developer-only runtime endpoints:

- `GET /api/screen-feed/admin/rollout`
- `PATCH /api/screen-feed/admin/rollout`
- `POST /api/screen-feed/admin/rollout/rollback`

Enabling `internal`, `canary`, or `general` requires a controller password confirmation no older than five minutes. Any rollout-policy change terminates active interactive sessions so every session is re-evaluated under the new policy.

## Recommended release sequence

1. Keep the stage `disabled` while CI, security, i18n, and focused remote-support tests run.
2. Enable `internal` for Developer verification.
3. Enable `canary` for one approved company and review session failures, blocked commands, disconnects, frame age, and audit records.
4. Expand the canary company list only after the first cohort is stable.
5. Move to `general` only after owner approval and production smoke testing.

## Immediate rollback

Call `POST /api/screen-feed/admin/rollout/rollback` as a Developer. This:

- returns the rollout stage to `disabled`;
- disables mouse and keyboard runtime capability;
- stops every active interactive support session;
- preserves passive screen-feed settings and permanent audit history.

For a full screen-feed shutdown, the existing emergency-stop endpoint or `DISABLE_SCREEN_FEED=true` remains stronger.

## Verification

The integrated Phase 4–8 branch passes TypeScript validation and the focused remote-support suite covering sessions, mouse commands, keyboard commands, permissions, sensitive-action policy, permanent audit, rollout eligibility, and emergency rollback. Repository-wide CI, security, i18n, build, and regression checks remain release gates on the final pull-request head.

## Storage

Rollout configuration is runtime state and can be supplied by environment variables at boot. Phase 8 adds no SQL table and no database migration. Permanent session and command metadata continues to use the existing `audit_log` table without storing screenshots, field values, passwords, clipboard contents, or typed text.
