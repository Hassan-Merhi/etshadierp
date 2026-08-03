export const SP_RELEASE_CURRENCY = "USD" as const;
export const SP_RELEASE_EXCHANGE_RATE = "1" as const;

/**
 * Supplier Partner release policy approved for the production-finalization program.
 *
 * Keep this object code-owned and immutable so later phases cannot quietly change
 * accounting or migration assumptions while implementing correction workflows.
 */
export const SP_RELEASE_POLICY = Object.freeze({
  approvedAt: "2026-08-03",
  settlementCurrency: SP_RELEASE_CURRENCY,
  exchangeRate: SP_RELEASE_EXCHANGE_RATE,
  amountStorage: "usd_columns_only",
  saleCorrection: "full_reversal_only",
  partialReturnsEnabled: false,
  inventoryPosting: "atomic_with_accounting",
  migrationCompanySelection: "configured_company_ids",
  directSqlCorrectionsAllowed: false,
} as const);

export function assertSpReleaseCurrency(currency: unknown, exchangeRate: unknown = SP_RELEASE_EXCHANGE_RATE): void {
  const normalizedCurrency = String(currency ?? "").trim().toUpperCase();
  const normalizedRate = Number(exchangeRate);

  if (normalizedCurrency !== SP_RELEASE_CURRENCY || !Number.isFinite(normalizedRate) || normalizedRate !== 1) {
    throw new Error(
      `Supplier Partner is USD-only for this release. Expected ${SP_RELEASE_CURRENCY} at exchange rate 1.`,
    );
  }
}
