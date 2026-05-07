/**
 * Safe integer ID parsers for Express route/query params.
 *
 * Rules:
 *  - parseId()         — value must be a positive integer; returns null for anything else
 *  - parseOptionalId() — empty/null/undefined returns null (valid absence); non-empty must be a positive integer
 *
 * Using these guards at the top of every route handler prevents NaN from
 * reaching Drizzle/Postgres and turns bad input into a clean 400 response
 * instead of a confusing 500.
 */

export function parseId(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function parseOptionalId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  return parseId(value);
}
