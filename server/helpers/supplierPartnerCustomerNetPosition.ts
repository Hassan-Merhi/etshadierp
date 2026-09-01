import { db } from "../db";
import { customers, voucherEntries, vouchers } from "@shared/schema";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";

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
 * Resolve supplier-partner customer receivables from the accounting sources that
 * actually carry customer activity.
 *
 * A customer can be posted in two ways:
 *   1. through its linked receivable ledger account; or
 *   2. directly through voucher_entries.customer_id (manual journals/receipts).
 *
 * Entries that carry both IDs are counted only through the ledger query, while
 * the direct-customer query is restricted to rows without ledger_account_id.
 * This prevents POS credit-sale entries from being counted twice.
 */
export async function getSupplierPartnerCustomerNetPosition(
  companyId: number,
  toDate?: string | null
): Promise<SupplierPartnerCustomerNetPositionResult> {
  const companyCustomers = await db
    .select({
      id: customers.id,
      code: customers.code,
      legalName: customers.legalName,
      ledgerAccountId: customers.ledgerAccountId,
      openingBalance: customers.openingBalance,
      openingBalanceSide: customers.openingBalanceSide,
    })
    .from(customers)
    .where(and(eq(customers.companyId, companyId), isNull(customers.deletedAt)));

  if (companyCustomers.length === 0) {
    return { items: [], ledgerAccountIds: new Set<number>() };
  }

  const customerIds = companyCustomers.map((customer) => customer.id);
  const linkedLedgerIds = companyCustomers
    .map((customer) => customer.ledgerAccountId)
    .filter((id): id is number => typeof id === "number" && id > 0);

  const voucherConditions = [
    eq(vouchers.companyId, companyId),
    eq(vouchers.optional, false),
    isNull(vouchers.deletedAt),
  ];
  if (toDate) voucherConditions.push(lte(vouchers.voucherDate, toDate));

  const [ledgerRows, directRows] = await Promise.all([
    linkedLedgerIds.length > 0
      ? db
          .select({
            ledgerAccountId: voucherEntries.ledgerAccountId,
            debit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric)), 0)`,
            credit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, and(eq(voucherEntries.voucherId, vouchers.id), ...voucherConditions))
          .where(inArray(voucherEntries.ledgerAccountId, linkedLedgerIds))
          .groupBy(voucherEntries.ledgerAccountId)
      : Promise.resolve([]),
    db
      .select({
        customerId: voucherEntries.customerId,
        debit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric)), 0)`,
        credit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
      })
      .from(voucherEntries)
      .innerJoin(vouchers, and(eq(voucherEntries.voucherId, vouchers.id), ...voucherConditions))
      .where(
        and(
          inArray(voucherEntries.customerId, customerIds),
          isNull(voucherEntries.ledgerAccountId)
        )
      )
      .groupBy(voucherEntries.customerId),
  ]);

  const byLedger = new Map<number, { debit: number; credit: number }>();
  for (const row of ledgerRows) {
    if (!row.ledgerAccountId) continue;
    byLedger.set(row.ledgerAccountId, {
      debit: Number.parseFloat(row.debit || "0") || 0,
      credit: Number.parseFloat(row.credit || "0") || 0,
    });
  }

  const byCustomer = new Map<number, { debit: number; credit: number }>();
  for (const row of directRows) {
    if (!row.customerId) continue;
    byCustomer.set(row.customerId, {
      debit: Number.parseFloat(row.debit || "0") || 0,
      credit: Number.parseFloat(row.credit || "0") || 0,
    });
  }

  const items: SupplierPartnerCustomerNetPositionItem[] = [];
  for (const customer of companyCustomers) {
    const opening = Number.parseFloat(customer.openingBalance || "0") || 0;
    const signedOpening = customer.openingBalanceSide === "Cr" ? -opening : opening;
    const ledgerMovement = customer.ledgerAccountId
      ? byLedger.get(customer.ledgerAccountId) || { debit: 0, credit: 0 }
      : { debit: 0, credit: 0 };
    const directMovement = byCustomer.get(customer.id) || { debit: 0, credit: 0 };
    const signedBalance =
      signedOpening +
      ledgerMovement.debit -
      ledgerMovement.credit +
      directMovement.debit -
      directMovement.credit;

    if (Math.abs(signedBalance) < 0.01) continue;

    items.push({
      customerId: customer.id,
      ledgerAccountId: customer.ledgerAccountId ?? null,
      name: customer.legalName,
      code: customer.code,
      signedBalance,
    });
  }

  return {
    items,
    ledgerAccountIds: new Set(linkedLedgerIds),
  };
}
