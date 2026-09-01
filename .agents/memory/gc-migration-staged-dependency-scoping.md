---
name: GC migration staged dependency scoping
description: Lessons from fixing the GC-LSHI staged migration flow (stock opening failure, missing step guards, missing historical sale item rows).
---

## Dependency guards must be scoped to the exact (source, target) pair
A "has step X completed for this target company" check is not enough when the tool
supports multiple source ERP companies migrating into the same target. A completed
Step 5 for Source A must not silently unlock Step 6/7 for Source B into the same
target. Any `requireCompletedMigrationAction`-style helper (server) and any
run-history-based button-disable logic (client) must filter by
`source_company_id + target_company_id + action + status='completed'`, not target
alone.

**Why:** caught in code review after an initial implementation only scoped by target
company; would have allowed cross-source bypass of staged dependencies.

**How to apply:** any future staged/wizard-style migration or import flow with
ordered steps and a shared run-history table needs the same three-key scoping
(source, target, action) for both the enforcement guard and the UI lock state.

## varchar column widths silently truncate literal enum-like values
A `source_type varchar(20)` column happily accepted short literals like `'offload'`
but threw `value too long for type character varying(20)` the moment a longer
literal (`'migration_opening_stock'`, 23 chars) was introduced by new code. The
error was swallowed by a generic catch (`"X failed"` with no detail), making the
real cause invisible until the column length was cross-checked against
`information_schema.columns` (live DB) vs the schema file (which had already been
widened to 100 for a different column) and the actual failing literal length.

**Why:** DB error messages truncate to a generic 500 unless the catch block echoes
`err.message`; always echo the real DB error in catch blocks for admin/dev-only
tools like migration runners.

**How to apply:** when adding a new literal value to any `source_type`/`status`/
`kind`-style varchar column, grep the literal's length against the live column's
`character_maximum_length`, not just the Drizzle schema definition (they can drift).
