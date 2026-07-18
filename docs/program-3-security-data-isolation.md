# Program 3 — Security, Authorization, and Data Isolation

Status: in progress. This branch is stacked on the completed, unmerged Program 2 branch and must remain unmerged until the owner approves the completed Program 3 package.

## Phase sequence

- [x] 3A — Security and authorization surface audit
- [x] 3B — Central authorization policy boundary
- [x] 3C — Company and tenant isolation enforcement
- [x] 3D — Privileged action and admin-operation controls
- [ ] 3E — Session, authentication, and credential hardening
- [ ] 3F — Input validation and unsafe-operation protection
- [ ] 3G — File, export, and attachment access controls
- [ ] 3H — Security audit logging and anomaly reporting
- [ ] 3I — Security regression suite and remediation report

Each phase must be completed and committed separately. Do not begin Program 4 on this branch.

## Phase 3A — Security and authorization surface audit

Status: complete.

- Classified authentication, route authorization, company isolation, privileged operations, validation, file access, and security-audit risks.
- Assigned remediation ownership across Phases 3B–3I.
- Changed documentation only; no production behavior or data was modified.

## Phase 3B — Central authorization policy boundary

Status: complete.

- Added the canonical, pure authorization decision boundary.
- Added authenticated actor, role, company, permission, action, and resource contracts.
- Enforced company isolation before role or permission evaluation, including for privileged roles.
- Added default-deny behavior and non-leaking authorization errors.

## Phase 3C — Company and tenant isolation enforcement

Status: complete.

- Added the canonical object-level company-isolation boundary.
- Required company ownership to be loaded from canonical storage.
- Prevented privileged roles from bypassing cross-company isolation.
- Added company-filter validation for lists, reports, and exports.

## Phase 3D — Privileged action and admin-operation controls

Status: complete.

### Completed work

- Added `server/services/security/privilegedOperationPolicy.ts` as the canonical fail-closed gate for repair, recalculation, migration, destructive, credential-reset, permission-change, company-configuration, and diagnostic-write operations.
- Required same-company authorization before any privileged role or permission evaluation.
- Required Admin or Developer role plus the exact declared privileged permission.
- Required a non-empty actor reason, deterministic idempotency key, and source identity for every privileged operation.
- Added exact confirmation-token validation for operations that require an explicit confirmation challenge.
- Required recent password confirmation and rejected missing, expired, or future confirmation timestamps.
- Returned normalized operation metadata so adapters can bind audit and idempotency records to the exact approved operation.
- Kept the boundary pure: callers must execute the operation and append its audit record inside one transaction after authorization succeeds.

### Verification

- Added focused tests for authorized execution, Admin cross-company denial, missing reason, missing idempotency/source identity, wrong confirmation tokens, expired password confirmation, and future confirmation timestamps.
- Confirmed privileged roles cannot bypass company isolation.
- Confirmed destructive and repair-style operations fail closed when confirmation or provenance is incomplete.
- Confirmed no accounting balances, stock quantities, costing, sessions, or historical records were modified.
- Verification was limited to focused static inspection and test-contract review; no Replit checks or credits were used.

## Next phase

- Phase 3E — Session, authentication, and credential hardening

## Safety constraints

- Do not merge automatically.
- Do not push directly to `main`.
- Preserve every phase as separate commits.
- Do not use Replit-hosted checks or consume Replit credits.
- Do not weaken an existing authorization check while centralizing policy.
- Do not modify accounting balances, stock values, or historical transactions as part of Program 3.
