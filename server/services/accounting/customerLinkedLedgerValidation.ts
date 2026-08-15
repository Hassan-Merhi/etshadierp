import { and, eq, inArray } from "drizzle-orm";
import { customers } from "@shared/schema";
import type { VoucherEntryInsertFields } from "./accountingTypes";
import { PostingValidationError } from "./centralPostingEngine";

export interface CustomerLedgerPair {
  customerId: number;
  ledgerAccountId: number;
}

export interface CustomerLedgerOwnershipRow {
  id: number;
  ledgerAccountId: number | null;
}

export function collectCustomerLedgerPairs(
  entries: VoucherEntryInsertFields[]
): CustomerLedgerPair[] {
  const pairs = entries
    .filter((entry) => entry.customerId != null && entry.ledgerAccountId != null)
    .map((entry) => ({
      customerId: Number(entry.customerId),
      ledgerAccountId: Number(entry.ledgerAccountId),
    }));

  const unique = new Map<string, CustomerLedgerPair>();
  for (const pair of pairs) {
    if (
      !Number.isInteger(pair.customerId) ||
      pair.customerId <= 0 ||
      !Number.isInteger(pair.ledgerAccountId) ||
      pair.ledgerAccountId <= 0
    ) {
      throw new PostingValidationError(
        "POSTING_TARGET_ID_INVALID",
        "Customer linked-ledger IDs must be positive integers"
      );
    }
    unique.set(`${pair.customerId}:${pair.ledgerAccountId}`, pair);
  }

  return [...unique.values()];
}

export function validateCustomerLedgerPairs(
  pairs: CustomerLedgerPair[],
  rows: CustomerLedgerOwnershipRow[],
  companyId: number
): void {
  const byCustomer = new Map(rows.map((row) => [Number(row.id), row.ledgerAccountId]));

  for (const pair of pairs) {
    if (!byCustomer.has(pair.customerId)) {
      throw new PostingValidationError(
        "POSTING_TARGET_NOT_OWNED",
        `Customer ${pair.customerId} not found in company ${companyId}`
      );
    }

    const linkedLedgerId = byCustomer.get(pair.customerId);
    if (Number(linkedLedgerId) !== pair.ledgerAccountId) {
      throw new PostingValidationError(
        "POSTING_LINKED_LEDGER_MISMATCH",
        `Customer ${pair.customerId} is linked to ledger ${linkedLedgerId ?? "none"}, not ${pair.ledgerAccountId}`
      );
    }
  }
}

export async function assertCustomerLinkedLedgerPairs(input: {
  tx: any;
  companyId: number;
  entries: VoucherEntryInsertFields[];
}): Promise<void> {
  const pairs = collectCustomerLedgerPairs(input.entries);
  if (pairs.length === 0) return;

  const customerIds = [...new Set(pairs.map((pair) => pair.customerId))];
  const rows = await input.tx
    .select({ id: customers.id, ledgerAccountId: customers.ledgerAccountId })
    .from(customers)
    .where(
      and(
        eq(customers.companyId, input.companyId),
        inArray(customers.id, customerIds)
      )
    );

  validateCustomerLedgerPairs(pairs, rows, input.companyId);
}
