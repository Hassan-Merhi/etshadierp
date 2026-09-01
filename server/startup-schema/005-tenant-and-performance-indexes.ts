/**
 * Startup schema migrations - Customer logos plus the F-Phase 1 company_id indexes and hot-path performance indexes.
 *
 * Part of the ordered `startupMigrations` array assembled in ./index.ts.
 * Statement order is load-bearing: these run sequentially at boot, so entries
 * must never be reordered or moved between parts.
 */

export const tenantAndPerformanceIndexes: string[] = [
  // ── Customer Logos — per-customer brand logos for bale label printing (May 2026) ──
  `CREATE TABLE IF NOT EXISTS customer_logos (
      id          serial PRIMARY KEY,
      company_id  integer NOT NULL,
      customer_id integer NOT NULL,
      name        varchar(100) NOT NULL,
      file_path   varchar(500) NOT NULL,
      mime_type   varchar(50) NOT NULL,
      active      boolean NOT NULL DEFAULT true,
      created_at  timestamp NOT NULL DEFAULT now(),
      updated_at  timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE INDEX IF NOT EXISTS customer_logos_company_customer_idx ON customer_logos (company_id, customer_id)`,
  `ALTER TABLE bale_label_prints ADD COLUMN IF NOT EXISTS customer_logo_id integer`,

  // ── F-Phase 1 (May 2026) — companyId indexes for multi-tenant tables (security/data-integrity audit) ──
  `CREATE INDEX IF NOT EXISTS exchange_rates_company_idx ON exchange_rates (company_id)`,
  `CREATE INDEX IF NOT EXISTS user_company_roles_company_idx ON user_company_roles (company_id)`,
  `CREATE INDEX IF NOT EXISTS user_company_roles_user_idx ON user_company_roles (user_id)`,
  `CREATE INDEX IF NOT EXISTS user_locations_company_idx ON user_locations (company_id)`,
  `CREATE INDEX IF NOT EXISTS locations_company_idx ON locations (company_id)`,
  `CREATE INDEX IF NOT EXISTS employees_company_idx ON employees (company_id)`,
  `CREATE INDEX IF NOT EXISTS employee_groups_company_idx ON employee_groups (company_id)`,
  `CREATE INDEX IF NOT EXISTS bank_accounts_company_idx ON bank_accounts (company_id)`,
  `CREATE INDEX IF NOT EXISTS fixed_assets_company_idx ON fixed_assets (company_id)`,
  `CREATE INDEX IF NOT EXISTS containers_company_idx ON containers (company_id)`,
  `CREATE INDEX IF NOT EXISTS purchase_orders_company_idx ON purchase_orders (company_id)`,
  `CREATE INDEX IF NOT EXISTS inventory_company_idx ON inventory (company_id)`,
  `CREATE INDEX IF NOT EXISTS vouchers_company_idx ON vouchers (company_id)`,
  `CREATE INDEX IF NOT EXISTS employee_bale_rates_company_idx ON employee_bale_rates (company_id)`,
  `CREATE INDEX IF NOT EXISTS employee_bale_pct_rates_company_idx ON employee_bale_pct_rates (company_id)`,
  `CREATE INDEX IF NOT EXISTS salary_advances_company_idx ON salary_advances (company_id)`,
  `CREATE INDEX IF NOT EXISTS dashboard_cash_accounts_company_idx ON dashboard_cash_accounts (company_id)`,
  `CREATE INDEX IF NOT EXISTS dashboard_payable_accounts_company_idx ON dashboard_payable_accounts (company_id)`,
  `CREATE INDEX IF NOT EXISTS mix_batches_company_idx ON mix_batches (company_id)`,
  `CREATE INDEX IF NOT EXISTS pressing_batches_company_idx ON pressing_batches (company_id)`,
  `CREATE INDEX IF NOT EXISTS bale_transfers_company_idx ON bale_transfers (company_id)`,
  `CREATE INDEX IF NOT EXISTS customer_balances_company_idx ON customer_balances (company_id)`,
  `CREATE INDEX IF NOT EXISTS stock_group_location_archives_company_idx ON stock_group_location_archives (company_id)`,
  `CREATE INDEX IF NOT EXISTS pos_shifts_company_idx ON pos_shifts (company_id)`,
  `CREATE INDEX IF NOT EXISTS pos_offline_queue_company_idx ON pos_offline_queue (company_id)`,
  `CREATE INDEX IF NOT EXISTS customer_logos_company_idx ON customer_logos (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_containers_company_idx ON factory_containers (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_offload_additional_charges_company_idx ON factory_offload_additional_charges (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_container_other_charges_company_idx ON factory_container_other_charges (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_raw_material_adjustments_company_idx ON factory_raw_material_adjustments (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_supplier_payments_company_idx ON factory_supplier_payments (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_supplier_fx_transfers_company_idx ON factory_supplier_fx_transfers (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_mix_batches_company_idx ON factory_mix_batches (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_daily_usages_company_idx ON factory_daily_usages (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_pressing_batches_company_idx ON factory_pressing_batches (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_bale_import_batches_company_idx ON factory_bale_import_batches (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_duty_audit_log_company_idx ON factory_duty_audit_log (company_id)`,
  `CREATE INDEX IF NOT EXISTS customer_proformas_company_idx ON customer_proformas (company_id)`,
  `CREATE INDEX IF NOT EXISTS container_documents_company_idx ON container_documents (company_id)`,
  `CREATE INDEX IF NOT EXISTS container_freight_company_idx ON container_freight (company_id)`,
  `CREATE INDEX IF NOT EXISTS container_freight_payments_company_idx ON container_freight_payments (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_worker_documents_company_idx ON factory_worker_documents (company_id)`,
  `CREATE INDEX IF NOT EXISTS supplier_proformas_company_idx ON supplier_proformas (company_id)`,
  `CREATE INDEX IF NOT EXISTS file_folders_company_idx ON file_folders (company_id)`,
  `CREATE INDEX IF NOT EXISTS stored_files_company_idx ON stored_files (company_id)`,
  `CREATE INDEX IF NOT EXISTS spreadsheets_company_idx ON spreadsheets (company_id)`,
  `CREATE INDEX IF NOT EXISTS bale_recode_sessions_company_idx ON bale_recode_sessions (company_id)`,
  `CREATE INDEX IF NOT EXISTS live_spreadsheets_company_idx ON live_spreadsheets (company_id)`,
  `CREATE INDEX IF NOT EXISTS erp_worker_docs_company_idx ON erp_worker_docs (company_id)`,
  `CREATE INDEX IF NOT EXISTS erp_payroll_runs_company_idx ON erp_payroll_runs (company_id)`,
  `CREATE INDEX IF NOT EXISTS waste_dispatches_company_idx ON waste_dispatches (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_bale_waste_dispatches_company_idx ON factory_bale_waste_dispatches (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_pos_sales_company_idx ON factory_pos_sales (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_pos_sale_items_company_idx ON factory_pos_sale_items (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_worker_categories_company_idx ON factory_worker_categories (company_id)`,
  `CREATE INDEX IF NOT EXISTS property_monthly_ledger_company_idx ON property_monthly_ledger (company_id)`,
  `CREATE INDEX IF NOT EXISTS location_price_groups_company_idx ON location_price_groups (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_sheets_company_idx ON factory_sheets (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_v3_loads_company_idx ON factory_v3_loads (company_id)`,
  `CREATE INDEX IF NOT EXISTS factory_invoice_loading_bales_company_idx ON factory_invoice_loading_bales (company_id)`,

  // ── Performance indexes — prevent pool exhaustion from full table scans ──
  // factory_bales: the bale-ledger and BalesHistory both filter by company_id+status.
  // Without this index the query scans the entire table (observed: 220s on Render).
  `CREATE INDEX IF NOT EXISTS factory_bales_company_status_idx ON factory_bales (company_id, status)`,
  // customer_orders: pending-count and bale-ledger join on company_id+status.
  `CREATE INDEX IF NOT EXISTS customer_orders_company_status_idx ON customer_orders (company_id, status)`,
  // customer_order_bales: bale-ledger joins this on order_id (may already exist).
  `CREATE INDEX IF NOT EXISTS customer_order_bales_order_id_idx ON customer_order_bales (order_id)`,
  // intercompany_payment_requests: pending-count filters on linkId+status.
  `CREATE INDEX IF NOT EXISTS icp_requests_link_status_idx ON intercompany_payment_requests (link_id, status)`,
];
