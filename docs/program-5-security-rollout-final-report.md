# Program 5 — Security Rollout and Identity Hardening Final Report

Status: implementation complete on `agent/program-5-security-rollout-identity-hardening`.

This report records the controls added in Program 5. It does not claim test execution, migration execution, deployment, or production verification.

## Completed phases

- 5A — Enterprise rollout inventory and sequencing.
- 5B — Persistent company-scoped named permissions.
- 5C — Persistent credential versions and stale-session invalidation.
- 5D — Explicit authenticated company context and legacy fallback removal.
- 5E — Privileged-operation enforcement for prioritized raw-material repair writes.
- 5F — Exact sensitive-input schemas for the same high-impact mutations.
- 5G — Protected stored-file and inherited container-document access.
- 5H — Expanded security-event coverage, migration reconciliation, and end-to-end regression documentation.

## Persistent identity controls

### Named permissions

`user_security_permissions` stores exact user/company/permission grants. Privileged enforcement hydrates these grants and no longer fabricates permission from Admin or Developer role alone.

Known Program 5 grants include:

- `security.permissions.manage`
- `factory.raw-stock.repair`
- `files.download`

### Credential versions

`user_credential_versions` tracks persistent credential state. Password changes increment the version and revoke active sessions. Shared authentication middleware rejects stale sessions after compatibility hydration.

## Company isolation

The authenticated `session.currentCompanyId` is authoritative. Legacy `factoryCompanyId`, request body company IDs, query company IDs, and route company IDs are assertions only and must match. The protected raw-stock route group applies this boundary before downstream handlers.

Company-context decisions are now persisted as security events. Denials fail closed when the audit decision cannot be recorded.

## Privileged repair controls

Prioritized raw-material repair writes require:

- Admin or Developer role.
- Exact persisted `factory.raw-stock.repair` permission.
- Recent password confirmation.
- A non-empty reason.
- A bounded deterministic idempotency key.
- Authenticated company alignment.
- A persisted security decision before mutation.

Existing domain protections remain in place, including signed confirmation tokens, user/company token binding, stale-input fingerprints, row locks, business audit records, and undo snapshots.

## Sensitive-input controls

The prioritized repair bodies use exact top-level allow-lists. They reject unknown fields, prototype-pollution keys, excessive nesting, oversized arrays and strings, malformed primitives, non-finite values, duplicate identifiers, and invalid manual-rate maps. Validated payloads replace `req.body` as frozen objects.

Allowed and denied input-validation decisions are persisted as security events. Validation denials fail closed when the audit record cannot be written.

## Protected assets

Stored-file download and preview routes now load the canonical company-owned asset before the legacy streamer runs. Access requires exact `files.download` permission or recorded ownership. Missing and cross-company assets return non-leaking not-found responses. Filenames are sanitized and responses receive `nosniff` and private no-store headers.

Program 4 container-document protection remains active.

## Security-event coverage

The shared audit store now receives decisions from:

- Privileged-operation enforcement.
- Permission administration.
- Company-context enforcement.
- Raw-stock sensitive-input validation.
- Stored-file protected-asset access.
- Inherited container-document protected-asset access.

Company anomaly queries remain company-scoped and bounded.

## Migration ledger

The Program 5 migration sequence is:

1. `0003_user_security_permissions.sql`
2. `0004_user_credential_versions.sql`
3. `0005_raw_stock_repair_permission.sql`
4. `0006_stored_file_download_permission.sql`

All four are registered sequentially in `migrations/meta/_journal.json`. The permission migrations are idempotent and seed existing Admin/Developer company memberships without deleting existing grants.

## Regression files added

- `tests/named-permission-service.test.ts`
- `tests/credential-version-service.test.ts`
- `tests/company-context-enforcement.test.ts`
- `tests/legacy-privileged-write-guard.test.ts`
- `tests/raw-stock-sensitive-input-guard.test.ts`
- `tests/stored-file-protected-access.test.ts`
- `tests/program-5-end-to-end-security.test.ts`

## Verification limits

- Tests were written but not executed through Replit or GitHub Actions.
- Migrations were not applied to a runtime or production database.
- Password-confirmation UX was not exercised.
- Stored-file byte streaming was not runtime verified.
- Deployment and production behavior are not claimed.

## Merge status

Program 5 remains stacked on the completed, unmerged Program 4 branch. The pull request must remain draft and unmerged until explicit owner approval.
