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
- [ ] 3H — Security audit logging and anomaly reporting
- [ ] 3I — Security regression suite and remediation report

## Phase 3G — File, export, and attachment access controls

Status: complete.

- Added `server/services/security/protectedAssetAccessPolicy.ts` for attachments, uploaded files, generated exports, and report exports.
- Requires canonical storage lookup before access decisions.
- Enforces same-company isolation before role, permission, or owner checks.
- Prevents privileged roles from bypassing company isolation.
- Returns non-leaking errors for missing and deleted assets.
- Rejects unsafe storage keys and traversal-like paths.
- Sanitizes download filenames and validates byte-size metadata.
- Binds exports to the active session company.
- Defaults protected downloads to attachment disposition.
- Added focused test contracts for same-company access, cross-company denial, deleted assets, owner access, path validation, filename sanitization, and export scoping.
- No Replit checks or credits were used.

## Next phase

- Phase 3H — Security audit logging and anomaly reporting

## Safety constraints

- Do not merge automatically.
- Do not push directly to `main`.
- Preserve every phase as a separate commit.
- Do not use Replit-hosted checks.
- Do not change accounting balances, stock values, or historical transactions.
