# Program 4 — Security Integration and Runtime Enforcement

Status: in progress. This branch is stacked on the completed, unmerged Program 3 branch.

## Phase sequence

- [x] 4A — Route and service adoption audit
- [x] 4B — Authentication and session enforcement adapters
- [x] 4C — Company isolation enforcement on high-risk reads and writes
- [x] 4D — Privileged operation enforcement on repair and administrative endpoints
- [ ] 4E — Unsafe input validation on sensitive mutations
- [ ] 4F — Protected file, attachment, report, and export enforcement
- [ ] 4G — Security audit persistence and anomaly surfacing
- [ ] 4H — End-to-end enforcement tests and integration report

## Phase 4B

Status: complete.

Authentication and session enforcement is connected to production middleware through `sessionEnforcementAdapter.ts`.

## Phase 4C

Status: complete for the first production slice.

- Adopted the Program 3 company-isolation boundary in `server/routes/factory/factoryInsuranceRoutes.ts`.
- The operating company comes from authenticated session state.
- Request body or query `companyId` values are assertions only and must match the session company.
- Applied the boundary to member lists, member ledger reads, creation, updates, toggles, deletion, and monthly journal generation.
- Retained company predicates on insurance members, vouchers, and linked ledger cleanup.
- Cross-company attempts receive a non-leaking response.
- Added focused regression coverage showing privileged roles cannot bypass company isolation.
- Tests were added but not executed through Replit or GitHub Actions.

## Phase 4D

Status: complete for the first privileged production slice.

- Added `server/services/security/privilegedOperationEnforcementAdapter.ts`.
- Wired the Program 3 privileged-operation policy in front of `/api/admin/rebuild-inventory` through `server/routes/adminRoutes.ts`.
- Preserved the existing default dry-run behavior.
- Applying changes (`dryRun: false`) now requires:
  - Same-company authenticated context.
  - Admin or Developer route access plus the exact `administration.repair` permission.
  - A non-empty reason.
  - A deterministic idempotency key.
  - Source identity.
  - The company-bound confirmation token `REBUILD-INVENTORY:<companyId>`.
  - A recent password confirmation.
- Explicit named permission sets fail closed when the required permission is absent.
- Existing Admin/Developer sessions receive a documented compatibility permission bridge until named permissions are persisted in session state.
- Security failures return a non-leaking `Forbidden` response.
- Added focused adapter regression coverage.
- Tests were added but not executed through Replit or GitHub Actions.

## Next phase

Phase 4E — Unsafe input validation on sensitive mutations.

## Safety constraints

- Never merge automatically or push directly to `main`.
- Preserve existing authorization until replacement enforcement is equivalent or stricter.
- Do not change accounting balances, stock values, costing rules, or historical transactions.
