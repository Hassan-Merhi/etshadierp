---
    name: GC-LSHI to SP migration — stock master fix
    description: Root cause and fix for cross-company stock_item ID reuse bug in the GC migration tool; account subtype conventions.
    ---

    ## Stock master ID-reuse bug (fixed)
    The GC→SP migration tool previously wrote source-company `stock_items.id` values directly into target-company `inventory`, `sp_stock_movements`, and `stock_item_code_aliases` rows. Since `stock_items` is company-scoped, this silently cross-linked SP-company inventory to ERP-company stock master rows (no DB constraint catches it — no company_id check on the FK).

    **Fix:** `ensureTargetStockItems()` in `server/routes/spMigrationRoutes.ts` creates real target-company `stock_items`/`stock_groups` rows and returns a source→target id map; provenance is recorded in `sp_migration_source_links` (run_id, source_table, source_id, target_table, target_id). Always use the mapped target id, never the source id, when inserting rows scoped to the target company.

    **Why:** any future "copy X into another company" migration must create net-new company-scoped master rows, not reuse the source row's PK across companies.

    ## GC profit account subtypes
    Current subtypes: `gc_our_profit_share`, `gc_supplier_profit_share`, `gc_accumulated_profit_clearing` (via GC_PROFIT_ACCOUNTS in spMigrationRoutes.ts). Earlier tool versions used `gc_owner_profit`/`gc_supplier_profit` (LEGACY_GC_PROFIT_SUBTYPES) — kept only for status/back-compat display, not created going forward. Keep any status/preview logic checking both current and legacy sets.

    ## Staged build note
    The GC-LSHI → SP migration spec (July 2026) is large (11 requirements: stock master, historical sales read-only, containers, profit-share opening, account renaming, rollback of all new artifact types). Built in stages — stage 1 (this) covers account setup with user-controlled renaming + correct stock-master migration. Historical sales read-only guard, container migration, and profit-share opening-balance UI are still outstanding if the user resumes this work.
    