/**
 * Centralized raw-material currency conversion.
 *
 * `factory_containers.fx_rate_to_usd` (and the analogous fx-rate columns on
 * related tables) default to '1' at the schema level. For a non-USD currency,
 * a stored value of exactly 1 is therefore indistinguishable from "nobody
 * ever explicitly set this" — a genuine 1:1 peg against USD does not occur
 * for this business's supplier currencies (USD/EUR/CDF etc.). This exact
 * "looks set" heuristic already existed ad hoc in rawStockOffloadRoutes.ts;
 * this module makes it the one shared, tested implementation. Every place
 * that derives a USD cost/kg (or any USD amount) from an original-currency
 * value and a stored/fallback exchange rate must go through here instead of
 * inlining `parseFloat(x || "1")`, so a genuinely unresolved rate is never
 * silently treated as 1.
 */

export interface FxRateResolution {
  /** The rate to use for conversion. Only meaningful when looksSet is true. */
  fxRate: number;
  /** False when the currency is non-USD and the stored rate is missing, <= 0, or exactly 1 (the unset schema default). */
  looksSet: boolean;
}

/** USD always resolves to 1 with looksSet=true — no rate is ever needed for USD amounts. */
export function resolveStoredFxRate(
  currencyCode: string | null | undefined,
  storedFxRateToUsd: string | number | null | undefined
): FxRateResolution {
  const ccy = currencyCode || "USD";
  if (ccy === "USD") return { fxRate: 1, looksSet: true };
  const rate = parseFloat(String(storedFxRateToUsd ?? "0")) || 0;
  const looksSet = rate > 0 && rate !== 1;
  return { fxRate: looksSet ? rate : 0, looksSet };
}

/** Applies an already-resolved rate. Only call after confirming looksSet (or use convertToUsdOrNull/convertToUsdOrThrow). */
export function applyFxRate(amount: number, currencyCode: string | null | undefined, fxRate: number): number {
  return (currencyCode || "USD") === "USD" ? amount : amount * fxRate;
}

/**
 * Single-call conversion for read/diagnostic paths: returns null (never a
 * silent 1× conversion) when the currency is non-USD and no explicitly-set
 * rate is available, so callers can surface it as "unresolved" instead of
 * displaying a wrong number with no indication anything is off.
 */
export function convertToUsdOrNull(
  amount: number,
  currencyCode: string | null | undefined,
  storedFxRateToUsd: string | number | null | undefined
): number | null {
  const { fxRate, looksSet } = resolveStoredFxRate(currencyCode, storedFxRateToUsd);
  if (!looksSet) return null;
  return applyFxRate(amount, currencyCode, fxRate);
}

export class UnresolvedExchangeRateError extends Error {
  currencyCode: string;
  constructor(currencyCode: string) {
    super(
      `No explicitly-set exchange rate is available for ${currencyCode} — refusing to silently default to 1. Provide fxRateToUsd explicitly.`
    );
    this.name = "UnresolvedExchangeRateError";
    this.currencyCode = currencyCode;
  }
}

/**
 * Throwing version for write paths that must reject the write outright
 * rather than silently persist a mispriced USD value. Callers should catch
 * `UnresolvedExchangeRateError` and return HTTP 400 with its message.
 */
export function convertToUsdOrThrow(
  amount: number,
  currencyCode: string | null | undefined,
  storedFxRateToUsd: string | number | null | undefined
): number {
  const result = convertToUsdOrNull(amount, currencyCode, storedFxRateToUsd);
  if (result === null) throw new UnresolvedExchangeRateError(currencyCode || "USD");
  return result;
}
