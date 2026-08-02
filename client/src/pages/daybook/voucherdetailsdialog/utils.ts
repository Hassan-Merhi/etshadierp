/**
 * Pure helpers and lookup tables for the VoucherDetailsDialog page.
 *
 * Extracted from VoucherDetailsDialog.tsx during the Phase 4 god-file split.
 */
import { ViewVoucherEntry } from ".././types";

export /**
 * Returns a formatted string of the original transaction-currency amount
 * when it differs from USD (i.e. for CFA vouchers).  Returns null for USD
 * or when multi-currency fields are not populated yet (pre-backfill rows).
 */
function txCurrencyLabel(entry: ViewVoucherEntry): string | null {
  if (!entry.transactionCurrency || entry.transactionCurrency === "USD") return null;
  const debit = parseFloat(entry.transactionDebitAmount || "0");
  const credit = parseFloat(entry.transactionCreditAmount || "0");
  const amt = Math.max(debit, credit);
  if (!amt) return null;
  if (entry.transactionCurrency === "CFA") {
    return `CFA ${Math.round(amt).toLocaleString()}`;
  }
  return `${entry.transactionCurrency} ${amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
