---
name: drizzle-kit push/generate fail non-interactively on unrelated drift
description: What to do when `npm run db:push` (drizzle-kit push) throws "Interactive prompts require a TTY terminal" for a small schema change.
---

`drizzle-kit push` and `drizzle-kit generate` render an interactive column-rename-conflict prompt
whenever the live DB schema and `shared/schema.ts` snapshot disagree on ANY column across the WHOLE
schema — not just the columns you just added. In this repo the snapshot has drifted from actual
Postgres state for reasons unrelated to any single change, so both commands fail immediately with
"Interactive prompts require a TTY terminal", even piping stdin doesn't help, and there's no
`--yes`/`--accept-all` flag (only `--force`, which only auto-approves data-LOSS statements, not
rename-ambiguity choices).

**Why:** the CLI needs a real interactive select prompt to disambiguate "new column" vs "renamed
column" and can't run headless in this environment.

**How to apply:** for small, well-understood additive changes (new nullable/defaulted columns), skip
`db:push` entirely — write an idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` and run it
directly against `$DATABASE_URL` via `psql`. Drizzle's query builder reads column mappings from
`shared/schema.ts` at runtime, not from the drizzle-kit snapshot, so the app works correctly once the
real Postgres columns exist with matching names/types — no working `db:push` run is required for the
app itself to function. Also drop a matching `.sql` file in `migrations/` for repo convention/history.
