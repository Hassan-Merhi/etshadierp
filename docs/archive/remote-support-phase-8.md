# Remote Support Phase 8 — Controlled Rollout and Release Verification

Phase 8 completes the guarded remote-support program with a staged rollout gate, readiness reporting, immediate rollback, and release verification.

## Safety boundary

Passive screen viewing remains read-only. Interactive support remains limited to the exact authenticated ERP browser tab. It does not provide desktop, operating-system, other-browser-tab, clipboard, or file control.

During actual mouse or keyboard control, the employee sees the compact active-support indicator and can stop the session immediately. Sensitive-action protection, company isolation, exact-tab binding, bounded session expiry, local-user priority, permissions, recent controller password confirmation, and metadata-only permanent auditing remain mandatory.

## Rollout stages

- `disabled` — no interactive session can start.
- `internal` — Developer controllers and explicitly listed internal controller IDs only.
- `canary` — interactive support is limited to explicitly listed company IDs.
- `general` — permissioned controllers may start guarded sessions in their active company.

The rollout stage is independent from the lower-level runtime flags. Runtime hard-disable, screen-feed disable, remote-control disable, and sensitive-action protection always take precedence.

## Configuration

Production boot values are documented in `docs/remote-support.env.example`:

- `REMOTE_SUPPORT_ROLLOUT_STAGE` selects `disabled`, `internal`, `canary`, or `general`. Set it explicitly to `disabled` for a fail-closed staged rollout.
- `REMOTE_SUPPORT_CANARY_COMPANY_IDS` is a comma-separated list of positive company IDs permitted during the canary stage.
- `REMOTE_SUPPORT_INTERNAL_CONTROLLER_USER_IDS` is a comma-separated list of controller user IDs permitted during the internal stage in addition to Developer-role controllers.

Rollout changes made through the guarded administrative API are runtime-only and are not persisted. Restarting the application restores the configured production boot state. A Developer must confirm their password before changing the live rollout stage, which keeps interactive support behind both the deployment configuration and the runtime safety controls.

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

The final focused verification passed environment-documentation validation, TypeScript, disposable PostgreSQL schema setup, source formatting, and 48 remote-support tests. The tests cover sessions, mouse commands, keyboard commands, permissions, sensitive-action policy, permanent audit, rollout eligibility, exact-tab scope, local-user priority, unavailable target channels, and emergency rollback.

Repository-wide CI, security, i18n, production build, backend and frontend regression, coverage ratchets, and CircleCI remain release gates on the exact final pull-request head.

## Storage

Rollout configuration is transient runtime state and is intentionally not persisted. Phase 8 adds no SQL table and no database migration. Permanent session and command metadata continues to use the existing `audit_log` table without storing screenshots, field values, passwords, clipboard contents, or typed text.
