# Program 5 — Security Rollout and Identity Hardening

Status: implementation complete on `agent/program-5-security-rollout-identity-hardening`.

This program expands the Program 3 policy package and Program 4 production proof points into a broader ERP rollout. It remains stacked on the completed, unmerged Program 4 branch.

## Phase sequence

- [x] 5A — Enterprise security adoption inventory and rollout map
- [x] 5B — Persistent named permissions and administration
- [x] 5C — Persistent credential versions and session invalidation
- [x] 5D — Explicit company-context enforcement and legacy fallback removal
- [x] 5E — Privileged-operation rollout across high-risk repair and recalculation writes
- [x] 5F — Sensitive-input schema rollout across prioritized high-impact mutations
- [x] 5G — Protected asset, report, export, and attachment rollout
- [x] 5H — Security-event coverage expansion, migration cleanup, and end-to-end report

## Completed controls

### 5A — Rollout inventory

Established the dependency order: persistent permissions, credential versions, explicit company context, privileged writes, exact input schemas, protected assets, and audit cleanup.

### 5B — Persistent named permissions

Added company-scoped `user_security_permissions`, migration `0003_user_security_permissions.sql`, grant replacement, membership validation, session hydration, targeted invalidation, and security-audited administration endpoints. Removed the role-only privileged compatibility bridge.

### 5C — Credential versions

Added `user_credential_versions`, migration `0004_user_credential_versions.sql`, password-change version rotation, session revocation, bounded version hydration, and stale-session rejection.

### 5D — Explicit company context

Made authenticated `session.currentCompanyId` authoritative. Legacy factory and request-supplied company IDs are assertions only. Applied the boundary to the active raw-stock route group.

### 5E — Privileged-operation rollout

Added `factory.raw-stock.repair`, migration `0005_raw_stock_repair_permission.sql`, recent password confirmation, reason, deterministic idempotency key, exact permission, company alignment, and persisted decisions for prioritized raw-material repair writes. Existing signed tokens, stale fingerprints, row locks, business audits, and undo snapshots remain intact.

### 5F — Sensitive-input rollout

Added exact allow-list schemas for prioritized repair bodies. Rejected unknown fields, prototype-pollution keys, malformed identifiers, excessive structure, oversized values, and invalid rate maps. Validated payloads replace `req.body` as frozen objects.

### 5G — Protected assets

Preserved Program 4 container-document protection. Added `files.download`, migration `0006_stored_file_download_permission.sql`, and protected stored-file download and preview access with same-company enforcement, exact permission or ownership, non-leaking denials, sanitized filenames, security events, `nosniff`, and private no-store headers.

### 5H — Audit expansion and finalization

- Persisted allowed and denied company-context decisions.
- Persisted allowed and denied raw-stock sensitive-input decisions.
- Made denial paths fail closed when their security decision cannot be stored.
- Reconciled migrations `0003` through `0006` with sequential journal entries.
- Added `tests/program-5-end-to-end-security.test.ts` covering company scope, exact input, privileged authorization, protected assets, and audit conversion.
- Added `docs/program-5-security-rollout-final-report.md`.

## Verification limits

- Tests were written but were not executed through Replit or GitHub Actions.
- Migrations were not applied to a runtime or production database.
- Password-confirmation UX, stored-file streaming, deployment, and production behavior were not verified.

## Safety constraints

- Never merge automatically or push directly to `main`.
- Keep the Program 5 pull request draft until explicit owner approval.
- Preserve accounting balances, inventory values, costing, and historical transactions.
- Do not claim test, runtime, deployment, or database verification unless actually performed.
- Avoid Replit-hosted checks and Replit credit usage.
