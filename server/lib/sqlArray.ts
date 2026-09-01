import { sql } from "drizzle-orm";

/**
 * Converts a JavaScript array into a typed PostgreSQL ARRAY expression safe for
 * use with `= ANY()` inside db.execute() calls.
 *
 * Problem: Drizzle's sql`` tag renders bare JS arrays as tuple syntax ($1,$2,...)
 * which PostgreSQL rejects for = ANY(). Wrapping in ARRAY[$1,$2,...] fixes the
 * syntax but WITHOUT an explicit cast PostgreSQL infers all untyped parameters as
 * `text`, causing "operator does not exist: integer = text" on integer columns.
 *
 * This helper adds ::int[] for numeric arrays and ::text[] for string arrays so
 * PostgreSQL always gets a properly-typed array.
 *
 * Usage:
 *   import { sqlArray } from "../../lib/sqlArray";
 *   sql`WHERE id = ANY(${sqlArray(ids)})`
 *   sql`WHERE status = ANY(${sqlArray(statuses)})`
 */
export const sqlArray = (arr: (string | number)[]) => {
  const joined = sql.join(
    arr.map((v) => sql`${v}`),
    sql`, `
  );
  const isNumeric = arr.length > 0 && arr.every((v) => typeof v === "number");
  return isNumeric ? sql`ARRAY[${joined}]::int[]` : sql`ARRAY[${joined}]::text[]`;
};
