---
name: cross-version-db-copy
description: How to copy data from a newer-major-version external Postgres (e.g. Render on PG18) into Replit's dev DB when pg_dump refuses due to version mismatch.
---

pg_dump/pg_restore refuse to run when the source server's major version is newer than the installed client (Replit's nix postgresql tops out around 16, external hosts like Render may run 18). Nix has no postgresql_18 package available via installSystemDependencies.

**Workaround:** psql itself has no such version gate (only pg_dump does). Use `drizzle-kit push --force` against a freshly dropped public schema to recreate the *current* schema on the target, then move data table-by-table with `psql source -c "\copy (SELECT col1,col2,... FROM t) TO STDOUT" | psql target -c "\copy t(col1,col2,...) FROM STDIN"`, explicitly naming/ordering columns by name (not `SELECT *`) since column order/types can drift between the external DB's live schema and the current codebase's schema.

**Why:** pg_dump's version check is purely a client-side guard on catalog compatibility; raw COPY over the wire protocol doesn't care about server version. Explicit column lists survive schema drift (added/removed/reordered/retyped columns) that bytewise `SELECT *` copying breaks on with cryptic "invalid input syntax" errors.

**How to apply:** disable triggers (`ALTER TABLE x DISABLE TRIGGER ALL`) on target before the copy loop so FK order doesn't matter, re-enable after, then `setval` every serial sequence to `MAX(id)`. Diff `information_schema.columns` between source/target per table to catch type mismatches (e.g. numeric-as-text vs integer, empty-string dates) before they abort a COPY; cast/NULLIF them explicitly in the source SELECT. Tables that exist only on one side (schema has since evolved) should just be skipped — copying is best-effort against the *current* app schema, not a full historical mirror.
