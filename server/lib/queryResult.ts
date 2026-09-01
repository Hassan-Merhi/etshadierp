/**
 * Typed access to a raw `db.execute()` result.
 *
 * `db.execute(sql...)` resolves to pg's `QueryResult<Record<string, unknown>>`,
 * so the `rows` property is already typed — but each row is
 * `Record<string, unknown>` and every column access lands on `unknown`. The
 * codebase's response to that was to cast the whole result to `any` before
 * reaching for its rows, which discards the row type and makes the entire
 * downstream expression `any`: 344 of them, across the route and service layers.
 *
 * These helpers give back the same shape without the `any`. Callers that know
 * their columns can name them:
 *
 *     const rows = resultRows<{ id: number; total: string }>(result);
 *
 * and callers that don't get `Record<string, unknown>`, which forces column
 * values through a coercion (`pn`, `Number`, `String`) instead of silently
 * flowing on as `any`. That coercion is nearly always already present at the
 * call site, so the conversion is mechanical, and the type only becomes
 * load-bearing where a value was previously untyped.
 *
 * Both tolerate a result that is itself an array. Older drizzle releases
 * resolved `execute()` to the rows directly, and many call sites still carried
 * a defensive fallback because of it. Keeping that behaviour here means the
 * conversion cannot change what a handler returns.
 */

/** Rows from a raw query result, or `[]` if there are none. */
export function resultRows<TRow extends Record<string, unknown> = Record<string, unknown>>(result: unknown): TRow[] {
  if (Array.isArray(result)) return result as TRow[];
  const rows = (result as { rows?: unknown } | null | undefined)?.rows;
  return Array.isArray(rows) ? (rows as TRow[]) : [];
}

/**
 * The first row, or `undefined`.
 *
 * Returned as `| undefined` rather than indexing `resultRows(...)[0]`, because
 * without `noUncheckedIndexedAccess` that index claims a row is always present
 * and hands back a type the runtime may not have. This signature makes the
 * empty case something the caller has to answer for.
 */
export function firstRow<TRow extends Record<string, unknown> = Record<string, unknown>>(
  result: unknown
): TRow | undefined {
  return resultRows<TRow>(result)[0];
}

/** `true` when a raw query returned no rows. */
export function hasRows(result: unknown): boolean {
  return resultRows(result).length > 0;
}
