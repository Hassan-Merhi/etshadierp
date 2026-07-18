# Program 3 — Security, Authorization, and Data Isolation

Status: in progress. This branch is stacked on the completed, unmerged Program 2 branch and must remain unmerged until the owner approves the completed Program 3 package.

## Phase sequence

- [x] 3A — Security and authorization surface audit
- [x] 3B — Central authorization policy boundary
- [ ] 3C — Company and tenant isolation enforcement
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

### Completed work

- Added `server/services/security/authorizationPolicy.ts` as the canonical, pure authorization decision boundary.
- Added explicit accounting, inventory, factory, administration, reporting, and configuration domains.
- Added authenticated actor, role, company, permission, action, and resource contracts.
- Enforced company isolation before role or permission evaluation, including for Admin and Developer roles.
- Added default-deny behavior when no explicit role or permission policy is supplied.
- Added exact required-permission evaluation and explicit allowed-role evaluation.
- Added a non-leaking `AuthorizationDeniedError` whose public message remains `Forbidden` while retaining a machine-readable denial code.
- Added `assertAuthorized` for service and route adapters that require exception-based enforcement.
- Preserved all existing route middleware; migration to this boundary will occur incrementally without weakening current checks.

### Verification

- Added focused tests for authorized access, unauthenticated requests, invalid company context, cross-company denial, default deny, missing permissions, privileged-role behavior, and non-leaking errors.
- Confirmed privileged roles cannot bypass company isolation.
- Confirmed undefined policies fail closed.
- Confirmed this phase does not change accounting balances, inventory quantities, costing, sessions, or historical data.
- No Replit checks or credits were used.

## Next phase

- Phase 3C — Company and tenant isolation enforcement

## Safety constraints

- Do not merge automatically.
- Do not push directly to `main`.
- Preserve every phase as separate commits.
- Do not use Replit-hosted checks or consume Replit credits.
- Do not weaken an existing authorization check while centralizing policy.
- Do not modify accounting balances, stock values, or historical transactions as part of Program 3.
