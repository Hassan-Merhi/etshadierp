---
name: Drizzle db.execute crashes on complex queries
description: db.execute(sql`...`) throws "Cannot convert undefined or null to object" on multi-join queries with camelCase aliases; pool.query() is the fix.
---

## Rule
Never use `db.execute(sql`...`)` for complex multi-join queries in storage functions. Use `pool.query(text, params)` directly instead.

**Why:** Drizzle's `db.execute()` wraps the pg QueryResult in its own result-processing layer. For certain query shapes (multi-join with camelCase double-quoted column aliases like `inv.id AS "inventoryId"`), this processing layer throws `TypeError: Cannot convert undefined or null to object` inside Drizzle internals. Simple queries (single table, few columns, lowercase aliases) work fine with `db.execute()`. The underlying `pool.query()` always works reliably.

**How to apply:**
- When writing storage functions that do multi-table JOINs with camelCase aliases, use `pool.query(sqlString, [param1, param2])` and access `.rows` directly.
- Import `pool` from `../db` (it is exported alongside `db`).
- Use `$1`, `$2` etc. for parameters in the SQL string.
- The diagnostic query in `locationRoutes.ts` (a simple single-subquery SELECT with lowercase aliases) worked with `db.execute()` — confirming the issue is query-shape-specific.
- This was confirmed in `server/storage/inventory.ts` `getLocationInventory()`: switching both `includeZero=false` and `includeZero=true` paths from `db.execute(sql`...`)` to `pool.query()` fixed the crash and returned 185 rows correctly.
