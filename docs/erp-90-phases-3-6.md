# ERP 90/100 — Combined Phases 3–6

This branch and pull request intentionally aggregate ERP 90/100 Phases 3 through 6. Intermediate phases are implemented and pushed without running the repository-wide verification matrix. The complete exact-head certification is deferred until all Phase 6 implementation work is complete.

## Phase 3 — Tenant Isolation

Status: **implementation complete — final verification deferred to Phase 6**

Implemented scope:

- A pre-route `tenantIsolationBoundary` now sits ahead of every API registrar and resolves the authoritative company from canonical session/company-role state.
- Caller-supplied primary `companyId` values are treated only as requested targets and must match the server-owned active company. Admin, Owner, Manager, POS, normal users, and Developer do not receive a role-only primary-company override through this boundary.
- Intentional intercompany secondary fields (`sourceCompanyId`, `destinationCompanyId`, etc.) are membership-checked for every referenced company; their existing route-level business permission gates remain authoritative for who may execute the operation.
- Express routes that explicitly use `:companyId` receive a parameter-level tenant check after route matching, closing the path-parameter timing gap in global middleware.
- Factory requests preserve the existing authorized factory-company selection policy; Properties keeps its existing pinned-company/fallback semantics instead of being forced through Factory company-type selection.
- The only deliberate synthetic all-company exception remains the established account-level Developer selector behavior. Admin/Owner/Manager active companies require real company membership.
- `/api/companies` and individual company metadata routes are membership-scoped. Company update/delete operations cannot target a company merely because its ID was supplied by the caller.
- AsyncLocalStorage propagates authenticated request company/user/role context for downstream tenant-aware services and audit instrumentation.
- `scripts/audit-company-scope.mjs` inventories high-risk direct SQL, Drizzle access, and request-company use that lacks a company/auth marker. It is authored for final certification but intentionally not executed during this intermediate phase.
- Versioned migration `0016_company_scope_rls_readiness` adds staged PostgreSQL RLS readiness for vouchers, voucher entries, customers, ledger/bank/fixed-asset tables, stock groups/items, and inventory. It is registered but **not applied**.
- The staged RLS policies preserve compatibility only when `app.current_company_id` is genuinely absent. A malformed/non-positive asserted company context fails closed. When Phase 4 central transaction services begin using `SET LOCAL app.current_company_id`, the same policies become company-restrictive without a policy rewrite.
- Negative tenant-isolation regression coverage was authored for same-company access, forged cross-company primary targets across privileged and non-privileged roles, invalid/unauthenticated context, conflicting request company sources, and unauthorized Factory pins.
- The older company-boundary contract was ratcheted so it no longer expects the removed Admin active-company bypass.

Safety / deferred evidence:

- No test suite, type-check, build, lint, coverage run, GitHub Actions rerun, CircleCI run, smoke test, or release verification was executed for Phase 3, per the combined-PR workflow.
- No database migration was applied.
- No production database, production deployment, repair, backfill, delete, restore, or provider action was performed.
- All Phase 3 changes remain on the shared `program/erp-90-phases-3-6` branch and combined PR. They will receive the full exact-head verification matrix only after Phase 6 implementation is complete.

## Phase 4 — Accounting & Inventory Convergence

Status: **next**.

## Phase 5 — Production Resilience

Status: pending Phase 4 completion.

## Phase 6 — Quality & Final Certification

Status: pending Phase 5 completion.

When all Phase 6 implementation is complete, the combined PR must run and pass the full exact-head certification matrix before merge to `main`.
