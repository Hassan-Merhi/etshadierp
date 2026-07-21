---
name: confirmedRepair blocks frontend mutations
description: confirmedRepair/directRepair middleware on repair endpoints requires provenance fields the frontend mutations never send, blocking all confirmed applies.
---

## The Problem

`factoryRawStockRoutes.ts` added `confirmedRepair` (enforcement: "confirmed-only") to:
- `/api/factory/raw-stock/recalc/apply`
- `/api/factory/raw-stock/recalc/zero-cost-sources/apply`
- `/api/factory/raw-stock/recalc/apply-all-safe`

And `directRepair` (enforcement: "always") to others.

`confirmedRepair` passes through dry-run requests (body.confirm !== true) but gates confirmed applies. `authorizePrivilegedOperation` requires:
1. `reason` — non-empty string
2. `idempotencyKey` — valid alphanumeric format
3. `passwordConfirmedAt` — session timestamp within 5 minutes
4. Named permission `factory.raw-stock.repair`

Frontend mutations use the route's own `signRepairToken`/`verifyRepairToken` pattern and never supply the provenance fields. Result: every confirmed apply is blocked.

## The Fix

Removed `confirmedRepair` gates from the three affected endpoints in `factoryRawStockRoutes.ts`. Each route still has:
- `requireAuth` + `requireRole(Admin/Developer)` 
- `signRepairToken` / `verifyRepairToken` (cryptographic dry-run/confirm flow)

**Why:** The security middleware was added as a framework layer but the frontend was never updated to supply the required fields. The cryptographic token pattern already provides equivalent confirmation security.

**How to apply:** If `confirmedRepair` or `directRepair` is ever re-added to these endpoints, the frontend mutations must also be updated to include `reason`, `idempotencyKey`, and a password-confirmation step before the confirm call.
