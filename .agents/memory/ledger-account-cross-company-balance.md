---
name: Ledger account cross-company balance discrepancy
description: getVoucherEntriesByLedger had no company filter — cross-company vouchers caused Accounts vs Net Position discrepancy
---

## Rule
`getVoucherEntriesByLedger` now accepts an optional `companyId` parameter. Always pass the session company ID when calling it from any route handler, so the account statement only sees vouchers that belong to the requesting company.

**Why:** Net Position scopes to `companyId = factoryCompanyId`; without the same scope on `getVoucherEntriesByLedger`, intercompany vouchers (e.g. an ERP-side journal that credits a factory Cash account) appeared in the Accounts ledger statement but not in Net Position — producing an $18,000 balance difference.

**How to apply:**
- All callers updated: `accountRoutes.ts` (transactions + balance endpoints), `accountStatementPdfGenerator.ts`, `posCustomerRoutes.ts`, `customerRoutes.ts`, `ledgerRoutes.ts`.
- The cross-company balance in `/api/accounts/all` uses a *separate* `crossCompanyLedgerEntries` query (intentional for migrated accounts) and does NOT go through `getVoucherEntriesByLedger` — that path is unaffected.
- Pre-period (brought-forward) inline SQL in the transactions endpoint also needs the same `AND v.company_id = $N` clause — added alongside the main fix.

## Secondary fix: closeFiscalPeriod missing deletedAt guard
`storage/accounting.ts:closeFiscalPeriod` — the income/expense balance query at line ~977 was missing `isNull(schema.vouchers.deletedAt)`. Added. Without it, deleted vouchers' entries inflated the P&L closing figures used to zero out income/expense accounts.
