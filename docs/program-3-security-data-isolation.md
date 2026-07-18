# Program 3 — Security, Authorization, and Data Isolation

Status: in progress. This branch is stacked on the completed, unmerged Program 2 branch and must remain unmerged until the owner approves the completed Program 3 package.

## Phase sequence

- [x] 3A — Security and authorization surface audit
- [ ] 3B — Central authorization policy boundary
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

### Scope established

Program 3 hardens who may perform sensitive operations and which company or tenant data each request may access. It builds on Program 2's accounting and inventory integrity boundaries without changing their balances or costing behavior.

### Audit categories

- Authentication and session establishment, renewal, revocation, and logout.
- Route-level role and permission enforcement.
- Company and tenant scoping for reads, writes, exports, reports, and repair endpoints.
- Administrative, diagnostic, recalculation, migration, and destructive operations.
- Object-level ownership checks for vouchers, accounts, suppliers, customers, stock, factory data, files, and attachments.
- Input validation at security-sensitive boundaries.
- Auditability of denied and privileged actions.

### Risk priorities

1. Cross-company or cross-tenant object access caused by trusting caller-supplied IDs.
2. Privileged routes protected only by UI visibility or inconsistent route middleware.
3. Repair, recalculation, migration, and destructive endpoints without uniform authorization, confirmation, and audit controls.
4. Session or credential behavior that permits stale, replayed, or insufficiently scoped access.
5. Exports, files, and attachments returned without object-level ownership verification.
6. Fragmented authorization logic that can drift between modules.

### Phase ownership

- 3B defines the canonical authorization decision contract.
- 3C migrates company and tenant isolation to that boundary.
- 3D hardens privileged and administrative operations.
- 3E covers sessions, authentication, and credentials.
- 3F standardizes validation for unsafe operations.
- 3G protects exports, files, and attachments.
- 3H adds security audit and anomaly visibility.
- 3I verifies the program and produces the remediation report.

### Verification

- Documentation-only phase; no production routes, balances, stock, sessions, or data were changed.
- Program 3 is isolated on its own branch.
- No Replit checks or credits were used.

## Next phase

- Phase 3B — Central authorization policy boundary

## Safety constraints

- Do not merge automatically.
- Do not push directly to `main`.
- Preserve every phase as a separate commit.
- Do not use Replit-hosted checks or consume Replit credits.
- Do not weaken an existing authorization check while centralizing policy.
- Do not modify accounting balances, stock values, or historical transactions as part of Program 3.
