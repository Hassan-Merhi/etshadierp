// Canonical, company-isolated supplier balance calculation.
//
// Supplier rows are company-owned through suppliers.company_id. A supplier may
// be read or posted only from its owning company. The legacy parent-company
// setting is retained solely for historical opening-balance ownership when no
// active company context is available; it must never make an explicitly
// unlinked company behave like a child company.

import Decimal from "decimal.js";
import { storage } from "../../storage";
import { getAccessibleCompanyIds } from "../../security/companyAccessBoundary";
import { getVoucherEntriesBySupplierBatched } from "../performance/supplierVoucherEntryBatcher";

let parentCompanyResolution: Promise<number> | null = null;

export class ParentCompanyNotConfiguredError extends Error {
  constructor() {
    super(
      "Parent company is not configured (system setting 'parentCompanyId' is unset) and there is more than one " +
        "ERP company, so legacy supplier opening balances cannot be safely isolated. An Admin must set the parent " +
        "company under Company Settings before viewing supplier balances."
    );
    this.name = "ParentCompanyNotConfiguredError";
  }
}

/**
 * Resolves the accounting parent for a company-scoped request.
 *
 * When a companyId is supplied, companies.parent_company_id is authoritative:
 * an explicit parent link returns that parent; no link means the company is
 * standalone/root and therefore resolves to itself. The legacy global setting
 * is consulted only by callers that do not have a company context.
 */
export async function resolveParentCompanyId(companyId?: number | null): Promise<number> {
  if (companyId) {
    const currentCompany = await storage.getCompanyById(companyId);
    if (currentCompany?.parentCompanyId) return currentCompany.parentCompanyId;
    return companyId;
  }

  if (parentCompanyResolution) return parentCompanyResolution;

  const resolution = (async () => {
    const configured = await storage.getParentCompanyId();
    if (configured) return configured;

    const allCompanies = await storage.getAllCompanies();
    const erpCompanies = allCompanies.filter((c) => !c.companyType || c.companyType === "erp");
    if (erpCompanies.length === 1) return erpCompanies[0].id;

    throw new ParentCompanyNotConfiguredError();
  })();

  parentCompanyResolution = resolution;
  try {
    return await resolution;
  } finally {
    if (parentCompanyResolution === resolution) parentCompanyResolution = null;
  }
}

export async function isParentCompanyContext(companyId?: number | null): Promise<boolean> {
  if (!companyId) return true;

  const currentCompany = await storage.getCompanyById(companyId);
  if (currentCompany?.parentCompanyId) return false;

  // A company explicitly referenced by a child is unquestionably a parent.
  const linkedChild = (await storage.getAllCompanies()).some((company) => company.parentCompanyId === companyId);
  if (linkedChild) return true;

  // For a standalone company, the old global setting may still identify the
  // owner of historical supplier opening balances, but it does not create an
  // intercompany relationship for current transactions.
  const legacyParentCompanyId = await storage.getParentCompanyId();
  return legacyParentCompanyId === companyId;
}

export interface SupplierBalanceContextResult {
  balance: number;
  openingBalance: number;
  hasActivity: boolean;
  entries: Array<{
    creditAmount?: string | null;
    debitAmount?: string | null;
    transactionCurrency?: string | null;
    transactionDebitAmount?: string | null;
    transactionCreditAmount?: string | null;
    baseDebitAmount?: string | null;
    baseCreditAmount?: string | null;
  }>;
  /** Net balance in each transaction currency: { currency: { debit, credit, net } }. */
  balancesByCurrency: Record<string, { debit: number; credit: number; net: number }>;
  /** Sum of base debits minus base credits, including the owned opening balance. */
  historicalBaseBalance: number;
}

function emptySupplierBalance(): SupplierBalanceContextResult {
  return {
    balance: 0,
    openingBalance: 0,
    hasActivity: false,
    entries: [],
    balancesByCurrency: {},
    historicalBaseBalance: 0,
  };
}

/**
 * Canonical supplier balance for a viewing company.
 *
 * When suppliers.company_id is present, a mismatched company receives an empty
 * result even if historical cross-company voucher references still exist. This
 * prevents legacy references from making a foreign supplier visible.
 */
export async function getSupplierBalanceForContext(
  supplier: { id: number; companyId?: number | null; openingBalance?: string | null },
  companyId?: number | null
): Promise<SupplierBalanceContextResult> {
  if (companyId && supplier.companyId && supplier.companyId !== companyId) {
    return emptySupplierBalance();
  }

  const ownsOpeningBalance = supplier.companyId
    ? !companyId || supplier.companyId === companyId
    : await isParentCompanyContext(companyId);
  const openingBalanceD = ownsOpeningBalance ? new Decimal(supplier.openingBalance || "0") : new Decimal(0);
  const openingBalance = openingBalanceD.toNumber();
  const entries = await getVoucherEntriesBySupplierBatched(supplier.id, companyId || undefined);

  const balanceD = entries.reduce((sum: Decimal, entry) => {
    const credit = new Decimal(entry.creditAmount || "0");
    const debit = new Decimal(entry.debitAmount || "0");
    if (credit.gt(0) && debit.eq(0)) return sum.plus(credit);
    if (debit.gt(0) && credit.eq(0)) return sum.minus(debit);
    return sum;
  }, openingBalanceD);
  const balance = balanceD.toNumber();

  const balancesByCurrency: Record<string, { debit: number; credit: number; net: number }> = {};
  for (const entry of entries) {
    const ccy: string = (entry.transactionCurrency as string | null) || "USD";
    const txDr = parseFloat(
      (entry.transactionDebitAmount as string | null) ?? (entry.debitAmount as string | null) ?? "0"
    );
    const txCr = parseFloat(
      (entry.transactionCreditAmount as string | null) ?? (entry.creditAmount as string | null) ?? "0"
    );
    if (!balancesByCurrency[ccy]) balancesByCurrency[ccy] = { debit: 0, credit: 0, net: 0 };
    balancesByCurrency[ccy].debit += txDr;
    balancesByCurrency[ccy].credit += txCr;
    balancesByCurrency[ccy].net = balancesByCurrency[ccy].credit - balancesByCurrency[ccy].debit;
  }

  let historicalBaseBalance = openingBalanceD.toNumber();
  for (const entry of entries) {
    const baseDr = parseFloat((entry.baseDebitAmount as string | null) ?? (entry.debitAmount as string | null) ?? "0");
    const baseCr = parseFloat(
      (entry.baseCreditAmount as string | null) ?? (entry.creditAmount as string | null) ?? "0"
    );
    if (baseCr > 0 && baseDr === 0) historicalBaseBalance += baseCr;
    if (baseDr > 0 && baseCr === 0) historicalBaseBalance -= baseDr;
  }

  return {
    balance,
    openingBalance,
    hasActivity: entries.length > 0 || openingBalance !== 0,
    entries,
    balancesByCurrency,
    historicalBaseBalance,
  };
}

/**
 * Authorizes an arbitrary companyId query parameter against the authenticated
 * user's actual company access. Supplier master routes should still prefer the
 * active session company and should not use this helper to broaden visibility.
 */
export async function authorizeCompanyIdParam(
  req: { session: { currentCompanyId?: number; userId?: string } },
  requestedCompanyId?: number | null
): Promise<number | null> {
  if (!requestedCompanyId) return req.session.currentCompanyId ?? null;
  if (requestedCompanyId === req.session.currentCompanyId) return requestedCompanyId;

  const userId = req.session.userId;
  if (!userId) return null;
  const accessibleCompanyIds = await getAccessibleCompanyIds(userId);
  return accessibleCompanyIds.has(requestedCompanyId) ? requestedCompanyId : null;
}
