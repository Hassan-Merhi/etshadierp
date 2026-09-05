import { db } from "../db";
import { ledgerAccounts } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";

export interface SupplierPartnerCustomerNetPositionItem {
  customerId: number;
  ledgerAccountId: number | null;
  name: string;
  code: string;
  signedBalance: number;
}

export interface SupplierPartnerCustomerNetPositionResult {
  items: SupplierPartnerCustomerNetPositionItem[];
  ledgerAccountIds: Set<number>;
}

/**
 * GC / Supplier Partner Net Position intentionally excludes customers.
 *
 * The three Net Position paths that use this helper already suppress linked
 * customer ledgers via ledgerAccountIds and then append items as authoritative
 * customer balances. For Supplier Partner mode we return every customer-like
 * ledger id in ledgerAccountIds and no items, so customers are excluded from:
 *
 *   - the live Net Position response;
 *   - historical/as-of Net Position calculations; and
 *   - the Net Position Excel export.
 *
 * Customer ledgers and customer accounting remain untouched everywhere else.
 */
export async function getSupplierPartnerCustomerNetPosition(
  companyId: number,
  _toDate?: string | null
): Promise<SupplierPartnerCustomerNetPositionResult> {
  const companyLedgerAccounts = await db
    .select({
      id: ledgerAccounts.id,
      accountType: ledgerAccounts.accountType,
      subType: ledgerAccounts.subType,
      code: ledgerAccounts.code,
      name: ledgerAccounts.name,
    })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt)));

  const customerLedgerIds = companyLedgerAccounts
    .filter(
      (account) =>
        account.accountType === "Customer" ||
        account.subType === "Accounts Receivable" ||
        (account.code || "").toUpperCase().startsWith("CUST-") ||
        (account.name || "").toLowerCase().includes("customer account")
    )
    .map((account) => account.id);

  return {
    items: [],
    ledgerAccountIds: new Set(customerLedgerIds),
  };
}
