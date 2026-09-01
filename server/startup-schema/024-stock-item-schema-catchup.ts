/**
 * Stock-item schema catch-up.
 *
 * The canonical Drizzle stockItems model selects these columns on full-row reads.
 * Some long-lived databases predate one or more of them, which makes any route
 * using storage.getAllStockItems() fail before application-level validation can
 * run (notably PO Import parse/validate/import).
 *
 * Keep these idempotent. runStartupMigrations() rewrites simple
 * ADD COLUMN IF NOT EXISTS statements into information_schema guarded DO blocks
 * so already-correct databases avoid taking an unnecessary table lock.
 */
export const stockItemSchemaCatchup: string[] = [
  `ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS stock_group_id integer`,
  `ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS grade_id integer`,
  `ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS category_id integer`,
  `ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS opening_qty numeric(15,3) DEFAULT 0`,
  `ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS opening_rate numeric(15,2) DEFAULT 0`,
  `ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS opening_value numeric(15,2) DEFAULT 0`,
  `ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS reorder_level numeric(15,3) DEFAULT 0`,
  `ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS selling_price numeric(15,2) DEFAULT 0`,
  `ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true`,
  `ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
  `ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now()`,
];
