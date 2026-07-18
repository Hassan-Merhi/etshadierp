# Program 3 — Security, Authorization, and Data Isolation

Status: in progress. This branch remains stacked on the completed, unmerged Program 2 branch.

## Phase sequence

- [x] 3A — Security and authorization surface audit
- [x] 3B — Central authorization policy boundary
- [x] 3C — Company and tenant isolation enforcement
- [x] 3D — Privileged action and admin-operation controls
- [x] 3E — Session, authentication, and credential hardening
- [x] 3F — Input validation and unsafe-operation protection
- [x] 3G — File, export, and attachment access controls
- [x] 3H — Security audit logging and anomaly reporting
- [ ] 3I — Security regression suite and remediation report

## Phase 3G — File, export, and attachment access controls

Status: complete.

- Added canonical storage-backed access controls for attachments, uploads, generated exports, and report exports.
- Enforced same-company isolation, safe storage keys, safe filenames, protected download disposition, and session-bound export scope.

## Phase 3H — Security audit logging and anomaly reporting

Status: complete.

### Completed work

- Added `server/services/security/securityAuditPolicy.ts` as the canonical pure boundary for security-event normalization and anomaly classification.
- Added event categories for authentication, authorization, company isolation, privileged operations, sessions, input validation, and protected assets.
- Added deterministic append-only event keys and normalized actor, company, target, reason, network, timestamp, outcome, and severity fields.
- Added automatic critical severity for cross-company and privileged-operation failures, with warning classification for other denied or failed security events.
- Added metadata redaction for passwords, secrets, tokens, cookies, authorization values, credentials, session IDs, and CSRF data.
- Limited recorded metadata to primitive values and bounded long strings so audit records do not become a secret or payload-storage channel.
- Added time-window anomaly detection for repeated denials, cross-company attempts, privileged-operation failures, credential/session anomalies, and protected-asset probing.
- Kept the policy storage-agnostic so existing audit-log adapters can append records transactionally without changing accounting or inventory behavior.

### Verification

- Added focused tests for normalized records, immutable output, secret redaction, invalid company context, severity classification, repeated-denial detection, category-specific anomalies, and time-window filtering.
- Confirmed allowed events do not create anomaly findings by themselves.
- Confirmed audit output exposes machine-readable security details without retaining passwords, tokens, cookies, or credential material.
- Verification was limited to focused static inspection and test-contract review; no Replit checks or credits were used.

## Next phase

- Phase 3I — Security regression suite and remediation report

## Safety constraints

- Do not merge automatically.
- Do not push directly to `main`.
- Preserve every phase as a separate commit group.
- Do not use Replit-hosted checks.
- Do not change accounting balances, stock values, or historical transactions.
