---
name: Supplier balance parent-company detection
description: Canonical rule for gating supplier.openingBalance and computing company-scoped supplier balances across ERP companies.
---

Supplier master records are global (shared across ERP companies), but a
supplier's `openingBalance` is a one-time historical figure that belongs
**only** to the explicitly linked parent company's books
(`companies.parentCompanyId`). The legacy global `parentCompanyId` system
setting is only a compatibility fallback for historical rows or deployments
that have no explicit company relationship. Every other company starts each
supplier at $0 and only accrues a balance from its own vouchers/POs/containers.

**Why:** the parent company must never be inferred by "lowest company ID" —
that heuristic silently breaks the moment a real child/second company is
used, even though it can coincidentally match the configured parent in a
single-deployment dataset and mask the bug for a long time.

**How to apply:** resolve parent status with the active company ID so explicit
child links and reverse child links are honored before consulting the legacy
global setting. Any endpoint that renders or exports a supplier balance
(account lists, payables, stats, ledgers, sidebars, transaction/brought-forward
queries, PDF/Excel statements) must go through
`server/routes/helpers/supplierBalanceHelpers.ts`
(`resolveParentCompanyId`, `isParentCompanyContext`,
`getSupplierBalanceForContext`, `authorizeCompanyIdParam`) instead of
re-deriving parent status or re-summing entries itself. A caller-supplied
`companyId` query param on a supplier endpoint must be authorized against
the requesting user's actual company roles, never trusted directly, since
suppliers are shared master records readable cross-company.
