import Decimal from "decimal.js";
import { erpRateToDaybookFxRateToUsd } from "./currencyAmounts";

export interface FactoryDaybookVoucherLike {
  id: number;
  voucherDate: string;
  voucherType: string;
  voucherNumber: string;
  description?: string | null;
  currency?: string | null;
  exchangeRate?: string | number | null;
  totalAmount?: string | number | null;
  effectiveDate?: string | null;
}

export interface FactoryDaybookPostingValues {
  companyId: number;
  txDate: string;
  txType: "PAYMENT" | "RECEIPT";
  referenceId: number;
  referenceTable: "vouchers";
  description: string;
  currencyCode: string;
  amountCurrency: string;
  fxRateToUsd: string;
  amountUsd: string;
  createdBy: null;
  effectiveDate: string | null;
}

function decimal(value: string | number | null | undefined, label: string): Decimal {
  try {
    const parsed = new Decimal(value ?? 0);
    if (!parsed.isFinite()) throw new Error("not finite");
    return parsed;
  } catch {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
}

/**
 * Build the factory-daybook mirror from an already-posted Payment/Receipt voucher.
 *
 * This helper deliberately keeps all money as decimal strings. The caller must persist
 * the returned row inside the SAME database transaction as the voucher posting so the
 * Voucher/Ledger/Daybook views cannot diverge after a partial commit.
 */
export function buildFactoryDaybookPosting(input: {
  companyId: number;
  voucher: FactoryDaybookVoucherLike;
}): FactoryDaybookPostingValues {
  const { companyId, voucher } = input;
  if (voucher.voucherType !== "Payment" && voucher.voucherType !== "Receipt") {
    throw new Error(`Unsupported factory daybook voucher type: ${voucher.voucherType}`);
  }

  const currency = (voucher.currency || "USD").trim().toUpperCase();
  const baseTotal = decimal(voucher.totalAmount, "voucher totalAmount");
  if (baseTotal.lt(0)) throw new Error("voucher totalAmount must be non-negative");

  let amountCurrency = baseTotal;
  if (currency !== "USD") {
    const rate = decimal(voucher.exchangeRate, "voucher exchangeRate");
    if (rate.lte(0)) throw new Error("voucher exchangeRate must be positive for non-USD vouchers");
    amountCurrency = baseTotal.times(rate);
  }

  return {
    companyId,
    txDate: voucher.voucherDate,
    txType: voucher.voucherType === "Payment" ? "PAYMENT" : "RECEIPT",
    referenceId: voucher.id,
    referenceTable: "vouchers",
    description:
      voucher.description || `${voucher.voucherType} voucher #${voucher.voucherNumber}`,
    currencyCode: currency,
    amountCurrency: amountCurrency.toDecimalPlaces(6).toFixed(6),
    fxRateToUsd: erpRateToDaybookFxRateToUsd(currency, "USD", voucher.exchangeRate),
    amountUsd: baseTotal.toDecimalPlaces(6).toFixed(6),
    createdBy: null,
    effectiveDate: voucher.effectiveDate || null,
  };
}
