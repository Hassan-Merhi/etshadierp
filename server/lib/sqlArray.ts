import { sql } from "drizzle-orm";

/**
 * Converts a JavaScript array into a PostgreSQL ARRAY[...] expression safe for
 * use with `= ANY()` inside db.execute() calls.
 *
 * Drizzle's sql`` tag renders bare JS arrays as tuple syntax ($1,$2,...) which
 * PostgreSQL rejects for = ANY(); this helper produces ARRAY[$1,$2,...] instead.
 *
 * Usage:
 *   import { sqlArray } from "@/lib/sqlArray";
 *   sql`WHERE id = ANY(${sqlArray(ids)})`
 */
export const sqlArray = (arr: (string | number)[]) =>
  sql`ARRAY[${sql.join(arr.map(v => sql`${v}`), sql`, `)}]`;
