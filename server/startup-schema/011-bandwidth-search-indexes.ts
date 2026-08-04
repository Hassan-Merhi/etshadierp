/**
 * Bandwidth phases 3-4 search and pagination indexes.
 *
 * These statements are idempotent and support bounded stock-item search,
 * location inventory pagination and location-scoped POS price lists.
 */
export const bandwidthSearchIndexes: string[] = [
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
  `CREATE INDEX IF NOT EXISTS stock_items_company_active_name_idx
     ON stock_items (company_id, active, name, id)
     WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS stock_items_name_trgm_idx
     ON stock_items USING gin (lower(name) gin_trgm_ops)
     WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS stock_items_code_trgm_idx
     ON stock_items USING gin (lower(code) gin_trgm_ops)
     WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS stock_item_aliases_alias_trgm_idx
     ON stock_item_code_aliases USING gin (lower(alias_code) gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS stock_item_aliases_company_item_idx
     ON stock_item_code_aliases (company_id, stock_item_id)`,
  `CREATE INDEX IF NOT EXISTS inventory_company_location_item_idx
     ON inventory (company_id, location_id, stock_item_id)`,
  `CREATE INDEX IF NOT EXISTS inventory_location_quantity_idx
     ON inventory (location_id, quantity, stock_item_id)`,
  `CREATE INDEX IF NOT EXISTS stock_item_location_prices_location_item_idx
     ON stock_item_location_prices (location_id, stock_item_id)`,
];
