# Program 3 — Security, Authorization, and Data Isolation

Status: in progress. This branch is stacked on the completed, unmerged Program 2 branch and must remain unmerged until the owner approves the completed Program 3 package.

## Phase sequence

- [x] 3A — Security and authorization surface audit
- [x] 3B — Central authorization policy boundary
- [x] 3C — Company and tenant isolation enforcement
- [x] 3D — Privileged action and admin-operation controls
- [x] 3E — Session, authentication, and credential hardening
- [ ] 3F — Input validation and unsafe-operation protection
- [ ] 3G — File, export, and attachment access controls
- [ ] 3H — Security audit logging and anomaly reporting
- [ ] 3I — Security regression suite and remediation report

Each phase must be completed and committed separately. Do not begin Program 4 on this branch.

## Phase 3A — Security and authorization surface audit

Status: complete.

- Classified authentication, route authorization, company isolation, privileged operations, validation, file access, and security-audit risks.
- Assigned remediation ownership across Phases 3B–3I.

## Phase 3B — Central authorization policy boundary

Status: complete.

- Added the canonical, pure authorization decision boundary.
- Enforced company isolation before role and permission evaluation.
- Added default-deny behavior and non-leaking authorization errors.

## Phase 3C — Company and tenant isolation enforcement

Status: complete.

- Added canonical storage-backed object ownership checks.
- Prevented privileged roles from bypassing cross-company isolation.
- Added company-filter validation for lists, reports, and exports.

## Phase 3D — Privileged action and admin-operation controls

Status: complete.

- Added fail-closed controls for repair, recalculation, migration, destructive, credential, permission, configuration, and diagnostic-write operations.
- Required same-company authorization, exact permission, reason, source identity, idempotency, confirmation, and recent password confirmation.

## Phase 3E — Session, authentication, and credential hardening

Status: complete.

### Completed work

- Added `server/services/security/sessionSecurityPolicy.ts` as the canonical fail-closed session validation boundary.
- Added absolute session lifetime and idle-timeout enforcement with invalid/future timestamp rejection.
- Added credential-version validation so password resets and explicit security revocations invalidate every older session independently of cookie expiration.
- Required a valid company context for company-scoped application sessions.
- Added optional recent-password-confirmation enforcement for sensitive actions.
- Added safe credential-version incrementing with invalid and overflow protection.
- Preserved the existing login protections already present in `authRoutes.ts`, including login throttling, session-ID regeneration, CSRF-token issuance, and persisted session save before response.
- Kept the new policy pure so route and session-store adapters can migrate incrementally without weakening existing protections.

### Verification

- Added focused tests for valid sessions, missing sessions, idle expiry, absolute expiry, credential revocation, missing company context, stale password confirmation, and credential-version increments.
- Confirmed errors expose only `Unauthorized` or `Forbidden` while retaining machine-readable security codes.
- Confirmed no accounting balances, stock quantities, costing, or historical business records were modified.
- Verification was limited to focused static inspection and test-contract review; no Replit checks or credits were used.

## Next phase

- Phase 3F — Input validation and unsafe-operation protection

## Safety constraints

- Do not merge automatically.
- Do not push directly to `main`.
- Preserve every phase as separate commits.
- Do not use Replit-hosted checks or consume Replit credits.
- Do not weaken an existing authorization check while centralizing policy.
- Do not modify accounting balances, stock values, or historical transactions as part of Program 3.
