/**
 * Pure helpers and lookup tables for the AccountsLegacy page.
 *
 * Extracted from AccountsLegacy.tsx during the Phase 4 god-file split.
 */

export // Maps a voucher's stored type to the vouchers-page tab that edits it.
// Mirrors the mapping used in Daybook/OptionalVouchers; falls back to "payment".
const VOUCHER_TYPE_TAB_MAP: Record<string, string> = {
  PurchaseOrder: "purchase-order",
  Payment: "payment",
  Receipt: "receipt",
  Journal: "journal",
  Contra: "contra",
  StockTransfer: "transferorder",
  "Stock Transfer": "transferorder",
  Transfer: "transfer",
  "Credit Note": "credit-note",
  "Debit Note": "credit-note",
  Production: "adjustment",
  Consumption: "adjustment",
  Mixed: "adjustment",
};

export function voucherTypeToTab(voucherType: string): string {
  return VOUCHER_TYPE_TAB_MAP[voucherType] ?? "payment";
}
