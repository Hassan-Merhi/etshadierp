# Program 3 — Security, Authorization, and Data Isolation

Status: in progress. This branch is stacked on the completed, unmerged Program 2 branch and must remain unmerged until the owner approves the completed Program 3 package.

## Phase sequence

- [x] 3A — Security and authorization surface audit
- [x] 3B — Central authorization policy boundary
- [x] 3C — Company and tenant isolation enforcement
- [ ] 3D — Privileged action and admin-operation controls
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

### Completed work

- Added `server/services/security/companyIsolationPolicy.ts` as the canonical object-level company-isolation boundary.
- Required company ownership to be loaded from canonical storage rather than trusted from request parameters or payloads.
- Added supported resource identities for vouchers, accounts, banks, customers, suppliers, inventory, factory records, reports, exports, and attachments.
- Required resource IDs and adapter-returned company IDs to be valid before authorization.
- Delegated role and permission evaluation to the Phase 3B authorization policy only after canonical company ownership is known.
- Prevented Admin and Developer roles from bypassing cross-company isolation.
- Added non-leaking `Not found` handling for missing resources and `Forbidden` handling for cross-company access.
- Added `assertRequestCompanyMatchesSession` for list, report, and export filters that accept a company parameter.
- Kept existing route middleware unchanged; route adapters can migrate incrementally without weakening current controls.

### Verification

- Added focused tests for same-company access, storage-backed ownership lookup, Admin cross-company denial, missing resources, invalid IDs, invalid stored ownership, role/permission preservation, and company-filter validation.
- Confirmed caller-supplied company IDs are never accepted as proof of object ownership.
- Confirmed cross-company checks occur before privileged-role authorization.
- Confirmed no accounting balances, inventory quantities, costing, sessions, or historical data were changed.
- Verification was limited to focused static inspection and test-contract review; no Replit checks or credits were used.

## Next phase

- Phase 3D — Privileged action and admin-operation controls

## Safety constraints

- Do not merge automatically.
- Do not push directly to `main`.
- Preserve every phase as separate commits.
- Do not use Replit-hosted checks or consume Replit credits.
- Do not weaken an existing authorization check while centralizing policy.
- Do not modify accounting balances, stock values, or historical transactions as part of Program 3.
