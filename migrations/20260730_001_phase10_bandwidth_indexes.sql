-- Phase 10 — API performance and bandwidth indexes
-- These indexes support the compact inventory matrix, proforma summaries,
-- lazy proforma lines, and focused factory selectors.

CREATE INDEX IF NOT EXISTS inventory_company_stock_location_idx
  ON inventory (company_id, stock_item_id, location_id);

CREATE INDEX IF NOT EXISTS customer_proformas_company_customer_name_idx
  ON customer_proformas (company_id, customer_id, name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_proforma_lines_proforma_article_idx
  ON customer_proforma_lines (proforma_id, article_code, id);

CREATE INDEX IF NOT EXISTS factory_workers_company_active_name_idx
  ON factory_workers (company_id, active, full_name);

CREATE INDEX IF NOT EXISTS factory_bale_products_company_active_name_idx
  ON factory_bale_products (company_id, active, name)
  WHERE deleted_at IS NULL;
