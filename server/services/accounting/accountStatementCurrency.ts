import Decimal from "decimal.js";
import { normalizeCurrencyCode } from "./currencyAmounts";

export interface AccountStatementCurrencySummary {
  nativeDebitByCurrency: Record<string, string>;
  nativeCreditByCurrency: Record<string, string>;
  historicalBaseDebitTotal: string;
  historicalBaseCreditTotal: string;
  unresolvedEntryCount: number;
  totalsProvisional: boolean;
}

function dec(value: unknown): Decimal {
  try {
    const result = new Decimal(value == null ? 0 : String(value));
    return result.isFinite() ? result : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

function currencyOf(row: Record<string, unknown>): string | null {
  const raw = row.transactionCurrency ?? row.currency;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return normalizeCurrencyCode(raw);
  } catch {
    return raw.trim().toUpperCase();
  }
}

/**
 * Summarizes account statement rows without ever adding native amounts from
 * different currencies together. Legacy non-base rows remain provisional.
 */
export function summarizeAccountStatementCurrency(rows: unknown[]): AccountStatementCurrencySummary {
  const nativeDebit = new Map<string, Decimal>();
  const nativeCredit = new Map<string, Decimal>();
  let historicalDebit = new Decimal(0);
  let historicalCredit = new Decimal(0);
  let unresolvedEntryCount = 0;

  for (const value of rows) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const currency = currencyOf(row);
    const hasHistoricalBase = row.baseDebitAmount != null || row.baseCreditAmount != null;
    const transactionDebit = hasHistoricalBase ? row.transactionDebitAmount : row.debitAmount;
    const transactionCredit = hasHistoricalBase ? row.transactionCreditAmount : row.creditAmount;
    const baseDebit = hasHistoricalBase ? row.baseDebitAmount : row.debitAmount;
    const baseCredit = hasHistoricalBase ? row.baseCreditAmount : row.creditAmount;

    if (!currency) {
      unresolvedEntryCount++;
      continue;
    }
    if (!hasHistoricalBase && currency !== "USD") {
      unresolvedEntryCount++;
      continue;
    }

    nativeDebit.set(currency, (nativeDebit.get(currency) ?? new Decimal(0)).plus(dec(transactionDebit)));
    nativeCredit.set(currency, (nativeCredit.get(currency) ?? new Decimal(0)).plus(dec(transactionCredit)));
    historicalDebit = historicalDebit.plus(dec(baseDebit));
    historicalCredit = historicalCredit.plus(dec(baseCredit));
  }

  const formatMap = (values: Map<string, Decimal>) =>
    Object.fromEntries(
      [...values.entries()]
        .filter(([, value]) => !value.isZero())
        .map(([currency, value]) => [currency, value.toDecimalPlaces(6).toFixed(6)])
    );

  return {
    nativeDebitByCurrency: formatMap(nativeDebit),
    nativeCreditByCurrency: formatMap(nativeCredit),
    historicalBaseDebitTotal: historicalDebit.toDecimalPlaces(6).toFixed(6),
    historicalBaseCreditTotal: historicalCredit.toDecimalPlaces(6).toFixed(6),
    unresolvedEntryCount,
    totalsProvisional: unresolvedEntryCount > 0,
  };
}