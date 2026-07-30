import { and, desc, eq } from "drizzle-orm";
import { factoryFxRates } from "@shared/schema";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";

function buildValidatedFxUrl(dateISO: string, currencyCode: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    throw new Error("Invalid FX date");
  }
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new Error("Invalid FX currency");
  }

  const url = new URL("https://api.frankfurter.app");
  url.pathname = `/${dateISO}`;
  url.searchParams.set("from", currencyCode);
  url.searchParams.set("to", "USD");
  return url.href;
}

/**
 * Read-only equivalent of the mutation route's FX lookup policy.
 *
 * It preserves the same precedence — latest manual rate, exact-date cached auto
 * rate, external historical rate, latest stored fallback — but never persists
 * an externally fetched rate. This keeps impact preview strictly read-only while
 * producing the same value the subsequent mutation will normally resolve.
 */
export async function getFxRateToUsdReadOnly(
  companyId: number,
  currencyCode: string,
  dateISO: string,
): Promise<string> {
  const normalizedCurrency = currencyCode.trim().toUpperCase();
  if (normalizedCurrency === "USD") return "1";

  const [manualRate] = await db
    .select()
    .from(factoryFxRates)
    .where(
      and(
        eq(factoryFxRates.companyId, companyId),
        eq(factoryFxRates.currencyCode, normalizedCurrency),
        eq(factoryFxRates.source, "manual"),
      ),
    )
    .orderBy(desc(factoryFxRates.effectiveDate))
    .limit(1);
  if (manualRate) return manualRate.rateToUsd;

  const [existingExactRate] = await db
    .select()
    .from(factoryFxRates)
    .where(
      and(
        eq(factoryFxRates.companyId, companyId),
        eq(factoryFxRates.currencyCode, normalizedCurrency),
        eq(factoryFxRates.effectiveDate, dateISO),
        eq(factoryFxRates.source, "auto"),
      ),
    )
    .limit(1);
  if (existingExactRate) return existingExactRate.rateToUsd;

  try {
    const response = await fetch(buildValidatedFxUrl(dateISO, normalizedCurrency));
    if (!response.ok) throw new Error(`FX API returned ${response.status}`);
    const data = (await response.json()) as { rates?: { USD?: number } };
    const rate = Number(data?.rates?.USD);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Invalid rate from FX API");
    }
    return String(rate);
  } catch (error: unknown) {
    const [fallback] = await db
      .select()
      .from(factoryFxRates)
      .where(
        and(
          eq(factoryFxRates.companyId, companyId),
          eq(factoryFxRates.currencyCode, normalizedCurrency),
        ),
      )
      .orderBy(desc(factoryFxRates.effectiveDate))
      .limit(1);

    if (fallback) return fallback.rateToUsd;
    throw new Error(
      `No FX rate available for ${dateISO}/${normalizedCurrency}. External API error: ${getErrorMessage(error)}`,
      { cause: error },
    );
  }
}
