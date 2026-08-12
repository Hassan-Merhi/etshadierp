# ERP 90/100 — Combined Phases 3–6

This branch and pull request intentionally aggregate ERP 90/100 Phases 3 through 6. Intermediate phases are implemented and pushed without running the repository-wide verification matrix. The complete exact-head certification is deferred until all Phase 6 implementation work is complete.

## Phase 3 — Tenant Isolation

Status: **in progress**

Acceptance scope:

- Mandatory authenticated company context for tenant-scoped API access.
- Request-supplied company identifiers are treated only as requested targets, never as authorization evidence.
- Cross-company targets require both an explicitly privileged role and verified company membership; Developer synthetic access remains the only deliberate all-company exception.
- Company metadata routes are membership-scoped.
- Runtime company-scope context is propagated so high-risk database access can be audited.
- Unscoped high-risk database access is surfaced through structured audit telemetry and an offline static audit script.
- Defence-in-depth PostgreSQL RLS support is provided for compatible high-risk tables without enabling a policy until the application has established a transaction-local company context.
- Negative isolation regression tests cover same-company, cross-company, forged request-company, and unauthenticated cases. Tests are authored now and run only during the final Phase 6 certification.

## Phase 4 — Accounting & Inventory Convergence

Status: pending Phase 3 completion.

## Phase 5 — Production Resilience

Status: pending Phase 4 completion.

## Phase 6 — Quality & Final Certification

Status: pending Phase 5 completion.

When all Phase 6 implementation is complete, the combined PR must run and pass the full exact-head certification matrix before merge to `main`.
