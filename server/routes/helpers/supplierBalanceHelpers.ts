// Canonical, company-isolated supplier balance calculation.
//
// Business rule: a supplier's `openingBalance` is a one-time historical figure
// that belongs ONLY to the configured parent company's books. Every other
// (child/sub) company starts that supplier at $0 and only accrues a balance
// from its OWN vouchers/POs/containers. The parent company is never inferred
// by "lowest company ID" — it must come from the explicit `parentCompanyId`
// system setting (storage.getParentCompanyId()).
//
// Every endpoint that renders a supplier balance (accounts/all, payables,
// suppliers/stats, supplier balance, voucher-sidebar, transactions,
// brought-forward/date-filtered queries, PDF/Excel statement exports) MUST
// route through these helpers instead of re-implementing the parent check.

import { storage } from "../../storage";

export class ParentCompanyNotConfiguredError extends Error {
  constructor() {
    super(
      "Parent company is not configured (system setting 'parentCompanyId' is unset) and there is more than one " +
        "ERP company, so supplier opening balances cannot be safely isolated. An Admin must set the parent " +
        "company under Company Settings before viewing supplier balances."
    );
    this.name = "ParentCompanyNotConfiguredError";
  }
}

/**
 * Resolves the ID of the company that owns supplier.openingBalance.
 * NEVER guesses via "lowest company ID". If the explicit setting is unset:
 *   - exactly one ERP company exists → that company is unambiguously the parent.
 *   - more than one ERP company exists → this is a genuine configuration gap;
 *     throw a clear diagnostic error instead of guessing.
 */
export async function resolveParentCompanyId(): Promise<number> {
  const configured = await storage.getParentCompanyId();
  if (configured) return configured;

  const allCompanies = await storage.getAllCompanies();
  const erpCompanies = allCompanies.filter((c: any) => !c.companyType || c.companyType === "erp");
  if (erpCompanies.length === 1) return erpCompanies[0].id;

  throw new ParentCompanyNotConfiguredError();
}

/**
 * True when `companyId` is the parent company. When `companyId` is omitted
 * (legacy "all companies" views), treated as parent context so the caller
 * keeps its existing cross-company behavior.
 */
export async function isParentCompanyContext(companyId?: number | null): Promise<boolean> {
  if (!companyId) return true;
  const parentCompanyId = await resolveParentCompanyId();
  return companyId === parentCompanyId;
}

export interface SupplierBalanceContextResult {
  balance: number;
  openingBalance: number;
  hasActivity: boolean;
  entries: Array<{ creditAmount?: string | null; debitAmount?: string | null }>;
}

/**
 * Canonical supplier balance for a given viewing context.
 *  - companyId provided: opening balance only applies if companyId is the
 *    parent company; credits/debits are scoped to THAT company's own vouchers.
 *  - companyId omitted: legacy "all companies" aggregate view — opening
 *    balance + credits/debits across every company (unchanged prior behavior
 *    for callers that intentionally show a global rollup).
 */
export async function getSupplierBalanceForContext(
  supplier: { id: number; openingBalance?: string | null },
  companyId?: number | null
): Promise<SupplierBalanceContextResult> {
  const isParent = await isParentCompanyContext(companyId);
  const openingBalance = isParent ? parseFloat(supplier.openingBalance || "0") : 0;
  const entries = await storage.getVoucherEntriesBySupplier(supplier.id, companyId || undefined);

  const balance = entries.reduce((sum: number, entry: any) => {
    const credit = parseFloat(entry.creditAmount || "0");
    const debit = parseFloat(entry.debitAmount || "0");
    if (credit > 0 && debit === 0) return sum + credit;
    if (debit > 0 && credit === 0) return sum - debit;
    return sum;
  }, openingBalance);

  // A nonzero opening balance (only ever present in the parent's own context)
  // counts as activity too — otherwise the parent company itself would
  // wrongly have its own suppliers filtered out of activity-gated lists.
  return { balance, openingBalance, hasActivity: entries.length > 0 || openingBalance !== 0, entries };
}

/**
 * Authorizes an arbitrary `companyId` query parameter against the
 * authenticated user's actual company access, instead of trusting it blindly.
 * Returns the authorized companyId, or null if the user has no access to it.
 */
export async function authorizeCompanyIdParam(
  req: { session: { currentCompanyId?: number; userId?: string } },
  requestedCompanyId?: number | null
): Promise<number | null> {
  if (!requestedCompanyId) return req.session.currentCompanyId ?? null;
  if (requestedCompanyId === req.session.currentCompanyId) return requestedCompanyId;

  const userId = req.session.userId;
  if (!userId) return null;
  const roles = await storage.getUserCompaniesWithRoles(userId);
  const hasAccess = roles.some((r: any) => r.companyId === requestedCompanyId);
  return hasAccess ? requestedCompanyId : null;
}
