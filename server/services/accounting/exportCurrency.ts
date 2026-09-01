import Decimal from "decimal.js";
import { normalizeCurrencyCode } from "./currencyAmounts";

export type ExportCurrencyRow = {
  transactionCurrency: string | null;
  nativeDebit: string;
  nativeCredit: string;
  historicalBaseDebit: string;
  historicalBaseCredit: string;
  historicalExchangeRate: string | null;
  rateConvention: string | null;
  status: "HISTORICAL_BASE" | "LEGACY_BASE" | "UNRESOLVED_LEGACY";
};

export type ExportCurrencySummary = {
  nativeDebitByCurrency: Record<string, string>;
  nativeCreditByCurrency: Record<string, string>;
  historicalBaseDebitTotal: string;
  historicalBaseCreditTotal: string;
  unresolvedEntryCount: number;
  totalsProvisional: boolean;
};

function decimal(value: unknown): Decimal {
  try {
    const parsed = new Decimal(value == null ? "0" : String(value));
    return parsed.isFinite() ? parsed : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

function currency(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return normalizeCurrencyCode(value);
  } catch {
    return value.trim().toUpperCase();
  }
}

function fixed(value: Decimal): string {
  return value.toDecimalPlaces(6).toFixed(6);
}

/**
 * Export projection for accounting rows. Native amounts are never converted
 * or added across currencies. Existing base debit/credit columns remain the
 * compatibility fallback for legacy USD rows only.
 */
export function projectExportCurrencyRow(row: Record<string, unknown>): ExportCurrencyRow {
  const hasHistoricalBase = row.baseDebitAmount != null || row.baseCreditAmount != null;
  const transactionCurrency = currency(row.transactionCurrency ?? row.currency);
  const legacyIsBase = !transactionCurrency || transactionCurrency === "USD";
  const status: ExportCurrencyRow["status"] = hasHistoricalBase
    ? "HISTORICAL_BASE"
    : transactionCurrency && !legacyIsBase
      ? "UNRESOLVED_LEGACY"
      : "LEGACY_BASE";

  return {
    transactionCurrency,
    nativeDebit: String(row.transactionDebitAmount ?? row.debitAmount ?? "0"),
    nativeCredit: String(row.transactionCreditAmount ?? row.creditAmount ?? "0"),
    historicalBaseDebit: String(row.baseDebitAmount ?? row.debitAmount ?? "0"),
    historicalBaseCredit: String(row.baseCreditAmount ?? row.creditAmount ?? "0"),
    historicalExchangeRate: row.historicalExchangeRate == null ? null : String(row.historicalExchangeRate),
    rateConvention: row.rateConvention == null ? null : String(row.rateConvention),
    status,
  };
}

export function summarizeExportCurrencyRows(rows: unknown[]): ExportCurrencySummary {
  const nativeDebit = new Map<string, Decimal>();
  const nativeCredit = new Map<string, Decimal>();
  let baseDebit = new Decimal(0);
  let baseCredit = new Decimal(0);
  let unresolved = 0;

  for (const value of rows) {
    if (!value || typeof value !== "object") continue;
    const projected = projectExportCurrencyRow(value as Record<string, unknown>);
    if (projected.status === "UNRESOLVED_LEGACY" || !projected.transactionCurrency) {
      unresolved++;
      continue;
    }
    const ccy = projected.transactionCurrency;
    nativeDebit.set(ccy, (nativeDebit.get(ccy) ?? new Decimal(0)).plus(decimal(projected.nativeDebit)));
    nativeCredit.set(ccy, (nativeCredit.get(ccy) ?? new Decimal(0)).plus(decimal(projected.nativeCredit)));
    baseDebit = baseDebit.plus(decimal(projected.historicalBaseDebit));
    baseCredit = baseCredit.plus(decimal(projected.historicalBaseCredit));
  }

  const mapToObject = (values: Map<string, Decimal>) =>
    Object.fromEntries(
      [...values.entries()]
        .filter(([, value]) => !value.isZero())
        .map(([ccy, value]) => [ccy, fixed(value)])
    );

  return {
    nativeDebitByCurrency: mapToObject(nativeDebit),
    nativeCreditByCurrency: mapToObject(nativeCredit),
    historicalBaseDebitTotal: fixed(baseDebit),
    historicalBaseCreditTotal: fixed(baseCredit),
    unresolvedEntryCount: unresolved,
    totalsProvisional: unresolved > 0,
  };
}