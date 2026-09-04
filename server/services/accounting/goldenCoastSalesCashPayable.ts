// ── Golden Coast: canonical GC Sales Cash payable sign convention ─────────────
//
// GC Sales Cash is a LIABILITY: the running amount Golden Coast owes Fresh
// Start FZ for goods of theirs that Golden Coast has sold. It is therefore
// credit-normal, and every module that reasons about "how much is still owed"
// must agree on one sign convention.
//
//   * A sale INCREASES the payable  → credit GC Sales Cash.
//   * A payment REDUCES the payable → debit GC Sales Cash.
//
// Ledger balances are read out of `voucher_entries` as a signed debit-minus-
// credit figure (plus the account's opening balance, signed by its opening
// side). For a credit-normal account that raw figure is the NEGATIVE of the
// outstanding payable, which is exactly the trap earlier Golden Coast phases
// fell into: they treated the raw Dr-minus-Cr figure as a collectible
// receivable, so a company with real sales showed nothing to settle.
//
// This module is pure and database-free so the convention can be unit tested
// and reused by posting services, routes and reports without duplication.

import Decimal from "decimal.js";

/** GC Sales Cash is credit-normal; this constant documents that for callers. */
export const GC_SALES_CASH_NORMAL_SIDE = "Cr" as const;

const MONEY_SCALE = 2;

export class GoldenCoastSalesCashBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenCoastSalesCashBalanceError";
  }
}

function parse(value: unknown, field: string): Decimal {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new GoldenCoastSalesCashBalanceError(`${field} must be a number or numeric string`);
  }
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new GoldenCoastSalesCashBalanceError(`${field} must be a finite number`);
  }
  if (!parsed.isFinite()) {
    throw new GoldenCoastSalesCashBalanceError(`${field} must be a finite number`);
  }
  return parsed;
}

function money(value: Decimal): string {
  return value.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP).toFixed(MONEY_SCALE);
}

/**
 * Converts the signed ledger figure (debits minus credits) into the
 * credit-normal payable balance. A positive result means Golden Coast still
 * owes that much; a negative result means the account has been overpaid.
 */
export function gcSalesCashPayableBalance(signedDebitMinusCreditUsd: string | number): string {
  return money(parse(signedDebitMinusCreditUsd, "signedDebitMinusCreditUsd").negated());
}

/**
 * The amount a payment may clear right now: the payable balance, floored at
 * zero so an already-overpaid account never invites a further payment.
 */
export function gcSalesCashSettleablePayable(payableBalanceUsd: string | number): string {
  return money(Decimal.max(parse(payableBalanceUsd, "payableBalanceUsd"), 0));
}

/** Convenience: signed ledger figure straight to the settleable payable. */
export function gcSalesCashSettleableFromSignedBalance(signedDebitMinusCreditUsd: string | number): string {
  return gcSalesCashSettleablePayable(gcSalesCashPayableBalance(signedDebitMinusCreditUsd));
}

/** The payable balance left after a payment of `paymentUsd` is posted. */
export function gcSalesCashPayableAfterPayment(
  payableBalanceUsd: string | number,
  paymentUsd: string | number
): string {
  const payable = parse(payableBalanceUsd, "payableBalanceUsd");
  const payment = parse(paymentUsd, "paymentUsd");
  return money(payable.minus(payment));
}

/**
 * The most conservative payable reading across the accounting-date view and
 * the all-posted view. Future-dated credits must not be paid early, and
 * already-posted payments must never be ignored, so the lower of the two wins.
 */
export function gcSalesCashConservativePayable(input: {
  datedPayableUsd: string | number;
  allPostedPayableUsd: string | number;
}): string {
  return money(
    Decimal.min(
      parse(input.datedPayableUsd, "datedPayableUsd"),
      parse(input.allPostedPayableUsd, "allPostedPayableUsd")
    )
  );
}
