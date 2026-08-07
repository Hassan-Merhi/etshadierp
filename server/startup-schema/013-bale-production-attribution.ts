/**
 * Startup schema - Phase 2 production attribution attached to Factory bales.
 *
 * Existing/historical bales intentionally remain without attribution rows.
 * New Stock Entry bales receive exactly one row in the same DB transaction.
 */

export const baleProductionAttribution: string[] = [
  `CREATE TABLE IF NOT EXISTS factory_bale_production_attributions (
      id                                SERIAL PRIMARY KEY,
      company_id                        INTEGER NOT NULL,
      bale_id                           INTEGER NOT NULL REFERENCES factory_bales(id) ON DELETE CASCADE,
      worker_id                         INTEGER REFERENCES factory_workers(id) ON DELETE RESTRICT,
      worker_name_snapshot              TEXT,
      production_position_id            INTEGER REFERENCES factory_production_positions(id) ON DELETE RESTRICT,
      production_position_name_snapshot TEXT,
      stock_entry_date                  DATE NOT NULL,
      created_at                        TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS factory_bale_production_attributions_bale_unique
       ON factory_bale_production_attributions (bale_id)`,
  `CREATE INDEX IF NOT EXISTS factory_bale_production_attributions_company_position_date_idx
       ON factory_bale_production_attributions (company_id, production_position_id, stock_entry_date)`,
  `CREATE INDEX IF NOT EXISTS factory_bale_production_attributions_company_worker_date_idx
       ON factory_bale_production_attributions (company_id, worker_id, stock_entry_date)`,
  `CREATE OR REPLACE FUNCTION sync_factory_bale_production_attribution_date()
     RETURNS trigger AS $$
     BEGIN
       IF NEW.stock_entry_date IS DISTINCT FROM OLD.stock_entry_date AND NEW.stock_entry_date IS NOT NULL THEN
         UPDATE factory_bale_production_attributions
            SET stock_entry_date = NEW.stock_entry_date
          WHERE bale_id = NEW.id;
       END IF;
       RETURN NEW;
     END;
     $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS factory_bales_sync_production_attribution_date ON factory_bales`,
  `CREATE TRIGGER factory_bales_sync_production_attribution_date
       AFTER UPDATE OF stock_entry_date ON factory_bales
       FOR EACH ROW
       EXECUTE FUNCTION sync_factory_bale_production_attribution_date()`,
];
