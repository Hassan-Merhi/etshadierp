/**
 * What ledger evidence a voucher type owes.
 *
 * Convergence reconciliation started from one assumption — every voucher posts
 * a balanced double entry whose sides each equal the document total — and two
 * voucher types broke it in the first week of use. Rather than keep growing an
 * exclusion list, each type states what it posts, and a type nobody has
 * classified is reported rather than quietly skipped.
 *
 * "balanced"     Debits equal credits, and each side equals the document total.
 * "single-sided" Exactly one side is posted. The other side of the movement is
 *                inventory, which is not a ledger account in this system, so
 *                the entry cannot balance and must not be judged as if it could.
 * "none"         The document posts no ledger entry at all. Its convergence is
 *                checked on the stock side of the same report.
 */
export type VoucherLedgerExpectation = "balanced" | "single-sided" | "none" | "unclassified";

/**
 * Evidence for each classification, gathered by reading the code that writes
 * the entries rather than by inspecting data that happened to be present:
 *
 * - Journal, Payment, Receipt post through the central posting engine, which
 *   refuses an unbalanced entry set.
 * - Sales posts the cash/customer side against the sales account
 *   (insertSaleAccountingEntries); Purchase mirrors it.
 * - Credit Note and Debit Note post a cash leg and an inventory leg per line
 *   (creditNoteRoutes), so they balance.
 * - Stock Adjustment posts exactly one entry: production credits the production
 *   account, consumption debits the consumption account. The contra side is
 *   inventory (server/storage/stock-ops/transfers-create.ts).
 * - Consumption is the voucher type a waste dispatch creates, and waste is
 *   dispatched as a stock adjustment — so it carries the same single entry.
 * - Stock Transfer moves stock between locations and posts nothing. The three
 *   spellings are the ones the transfer document loader treats as one type.
 *
 * "Opening", "Advance" and "Payroll" are deliberately absent: they are synthetic
 * rows built by statement and report queries and are never persisted as
 * vouchers, so no reconciliation ever sees them.
 */
const VOUCHER_LEDGER_EXPECTATIONS: Record<string, VoucherLedgerExpectation> = {
  Journal: "balanced",
  Payment: "balanced",
  Receipt: "balanced",
  Sales: "balanced",
  Purchase: "balanced",
  "Credit Note": "balanced",
  "Debit Note": "balanced",
  "Stock Adjustment": "single-sided",
  Consumption: "single-sided",
  "Stock Transfer": "none",
  StockTransfer: "none",
  Transfer: "none",
};

/**
 * Classifies a voucher type. An unrecognised type is "unclassified" rather than
 * assumed harmless: the reconciler reports it, so a newly introduced voucher
 * type is surfaced by the next reconciliation instead of silently escaping
 * every accounting check.
 */
export function classifyVoucherLedgerExpectation(voucherType: unknown): VoucherLedgerExpectation {
  const key = String(voucherType ?? "").trim();
  if (!key) return "unclassified";
  return VOUCHER_LEDGER_EXPECTATIONS[key] ?? "unclassified";
}

/** The classified types, for tests and documentation. */
export function classifiedVoucherTypes(): string[] {
  return Object.keys(VOUCHER_LEDGER_EXPECTATIONS).sort();
}
