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

Status: **implementation complete — final verification deferred to Phase 6**

Implemented scope:

- A canonical stock movement journal (`canonical_stock_movements` and its request/audit siblings) records every applied inventory movement as append-only evidence, written inside the same transaction that mutates inventory. Its tables are created by the startup schema, alongside the existing startup-only tables.
- Evidence is posted by the live write paths rather than by a service nobody calls: stock transfers (both branches of the create endpoint), stock adjustments, POS sale issue and POS edit reversal/reissue, container offload receipts, factory stock entry, factory bale finalisation, and credit/debit note movements.
- Convergence reconciliation compares Voucher, VoucherEntry, Factory Daybook and stock documents against that evidence. It is read-only and never repairs; untrustworthy evidence fails closed rather than being aggregated away.
- Each voucher type states what ledger evidence it owes — balanced, single-sided, or none — instead of being excluded from the comparison by name. A voucher type nobody has classified is reported rather than skipped.
- The Factory Daybook mirror is withdrawn in the same transaction that cancels its voucher, and a mirror that outlives its voucher is reported by reconciliation.
- `GET /api/admin/convergence-reconciliation` exposes the report for the session's own company, for Admin and Owner.

## Phase 5 — Production Resilience

Status: **in progress**.

Implemented scope:

- Stock transfers created from scratch accept a caller-supplied `clientRequestId` and are recorded under a deterministic idempotency key inside their own transaction, so a retry or a double submission answers with the original transfer instead of moving stock twice. Concurrent submissions of the same key serialise on a transaction-scoped advisory lock. The client attaches that identity through the same mechanism protected accounting writes already use.
- Stock adjustments check for an existing adjustment under a lock on the voucher row inside the inserting transaction, closing the check-then-act window in which two submissions could both apply their items to inventory.
- Scheduled jobs run through a tick guard so a run that outlives its interval is not overtaken by the next tick; a skipped tick is logged rather than dropped, and the guard is released on failure.

## Phase 6 — Quality & Final Certification

Status: pending Phase 5 completion.

When all Phase 6 implementation is complete, the combined PR must run and pass the full exact-head certification matrix before merge to `main`.
