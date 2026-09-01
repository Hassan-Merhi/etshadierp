---
name: Drizzle :: cast in parameterized queries
description: Why sql`${column}::type` breaks in Drizzle ORM and how to avoid it
---

`sql\`${factoryContainers.actualReceivedKg}::numeric > 0\`` throws `syntax error at or near "::"` because Drizzle replaces the column reference with a `$N` parameter placeholder, and PostgreSQL then sees `$1::numeric` which is valid — but when used inside a WHERE clause built by Drizzle, the context can make it fail.

More critically: `db.execute(sql\`... COUNT(*)::int ...\`)` throws the "Cannot convert undefined or null to object" crash from the `drizzle-execute-crash.md` pattern, because `::int` casts inside `db.execute` are not handled correctly.

**Fixes:**

1. For simple column comparisons with casts: use Drizzle helpers instead:
   ```typescript
   // WRONG
   sql`${factoryContainers.actualReceivedKg}::numeric > 0`
   // RIGHT
   gt(factoryContainers.actualReceivedKg, "0")
   ```

2. For aggregate queries with `::int` casts: always use `pool.query(text, params)` directly:
   ```typescript
   pool.query<{ count: string }>(
     `SELECT COUNT(*)::int AS count FROM ... WHERE container_id = ANY($1)`,
     [ids]
   )
   ```
   `pool.query()` returns `{ rows: T[] }` — no `.rows.rows` nesting.

**Why:** Drizzle parameterizes column references in `sql` tagged templates, and the `::` PostgreSQL cast operator doesn't compose cleanly with placeholders in all contexts.
