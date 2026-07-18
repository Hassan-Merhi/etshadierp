# Program 3 — Security, Authorization, and Data Isolation

Status: complete on the dedicated draft branch. The branch remains stacked on the completed, unmerged Program 2 branch and must not be merged without owner approval.

## Phase sequence

- [x] 3A — Security and authorization surface audit
- [x] 3B — Central authorization policy boundary
- [x] 3C — Company and tenant isolation enforcement
- [x] 3D — Privileged action and admin-operation controls
- [x] 3E — Session, authentication, and credential hardening
- [x] 3F — Input validation and unsafe-operation protection
- [x] 3G — File, export, and attachment access controls
- [x] 3H — Security audit logging and anomaly reporting
- [x] 3I — Security regression suite and remediation report

## Completed security boundaries

- Central default-deny authorization policy.
- Canonical storage-backed company and tenant isolation.
- Privileged-operation controls for destructive, repair, migration, credential, permission, configuration, and diagnostic actions.
- Session expiry, inactivity, credential-version, company-context, and recent-password-confirmation validation.
- Strict unsafe-operation input validation and mutation provenance.
- Protected attachment, file, report-export, and generated-export access controls.
- Security-event normalization, secret redaction, and anomaly classification.

## Phase 3I — Security regression suite and remediation report

Status: complete.

### Completed work

- Audited every Program 3 policy and focused test directly from PR #79.
- Added `tests/program-3-security-regression.test.ts` to cover cross-company ordering, privileged operation controls, unsafe-input rejection, audit redaction, and anomaly detection across policy boundaries.
- Added `docs/program-3-security-remediation-report.md` with the completed scope, verified invariants, regression inventory, integration limitation, and verification status.
- Found and corrected a real consolidation mismatch: Admin and Developer bypass ordinary permissions in the general policy, but privileged operations are intended to require the exact named permission. `privilegedOperationPolicy.ts` now enforces that permission explicitly.
- Added a regression case proving an Admin without the exact privileged permission is denied with `PERMISSION_REQUIRED`.

### Verification status

- The branch and PR patches were inspected directly through GitHub.
- Focused tests exist for all seven Program 3 boundaries plus the consolidated regression suite.
- Tests were not executed through Replit or GitHub Actions in this phase.
- No Replit checks or credits were used.
- Runtime deployment verification is not claimed.
- Broad route and service adoption remains an integration requirement because the new policies are pure and additive; existing middleware was not globally replaced.

## Final status

Program 3 policy, regression, and remediation work is complete. Do not begin Program 4 on this branch. Keep PR #79 draft and unmerged until the owner explicitly approves the full stacked merge plan.

## Safety constraints

- Do not merge automatically.
- Do not push directly to `main`.
- Preserve phase history in the draft PR.
- Do not use Replit-hosted checks.
- Do not change accounting balances, stock values, or historical transactions.
