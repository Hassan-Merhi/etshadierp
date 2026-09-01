/**
 * Startup schema migrations - Rental management, production planner, and the Apr 2026 tables missing from prior migrations.
 *
 * Part of the ordered `startupMigrations` array assembled in ./index.ts.
 * Statement order is load-bearing: these run sequentially at boot, so entries
 * must never be reordered or moved between parts.
 */

export const rentalAndProductionPlanner: string[] = [
  // ── Rental Management tables (Apr 2026) ───────────────────────────────────
  `CREATE TABLE IF NOT EXISTS property_units (
      id             SERIAL PRIMARY KEY,
      company_id     INTEGER NOT NULL,
      module         TEXT NOT NULL DEFAULT 'PROPERTIES',
      unit_type      TEXT NOT NULL,
      location_group TEXT NOT NULL,
      unit_number    TEXT NOT NULL,
      size           TEXT,
      dimensions     TEXT,
      notes          TEXT,
      active         BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS property_units_company_module_unit_unique
       ON property_units (company_id, module, unit_number)`,
  `CREATE INDEX IF NOT EXISTS property_units_company_idx
       ON property_units (company_id, module, unit_type)`,

  `CREATE TABLE IF NOT EXISTS property_contracts (
      id                            SERIAL PRIMARY KEY,
      company_id                    INTEGER NOT NULL,
      module                        TEXT NOT NULL DEFAULT 'PROPERTIES',
      unit_id                       INTEGER NOT NULL,
      tenant_name                   TEXT NOT NULL,
      guarantee_period              TEXT,
      guarantee_amount              NUMERIC(20,2) NOT NULL DEFAULT 0,
      rental_amount                 NUMERIC(20,2) NOT NULL DEFAULT 0,
      start_date                    DATE NOT NULL,
      end_date                      DATE,
      status                        TEXT NOT NULL DEFAULT 'ACTIVE',
      notes                         TEXT,
      guarantee_posted_to_statement BOOLEAN NOT NULL DEFAULT FALSE,
      guarantee_posted_amount       NUMERIC(20,2) DEFAULT 0,
      created_at                    TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS property_contracts_unit_idx
       ON property_contracts (unit_id, status)`,
  `CREATE INDEX IF NOT EXISTS property_contracts_company_idx
       ON property_contracts (company_id, status)`,

  `CREATE TABLE IF NOT EXISTS property_monthly_ledger (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER NOT NULL,
      module          TEXT NOT NULL DEFAULT 'PROPERTIES',
      contract_id     INTEGER NOT NULL,
      unit_id         INTEGER NOT NULL,
      year            INTEGER NOT NULL,
      month           INTEGER NOT NULL,
      expected_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
      paid_amount     NUMERIC(20,2) NOT NULL DEFAULT 0,
      notes           TEXT,
      created_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS property_monthly_ledger_unique
       ON property_monthly_ledger (contract_id, year, month)`,
  `CREATE INDEX IF NOT EXISTS property_monthly_ledger_unit_idx
       ON property_monthly_ledger (unit_id)`,

  `CREATE TABLE IF NOT EXISTS property_payments (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER NOT NULL,
      module          TEXT NOT NULL DEFAULT 'PROPERTIES',
      contract_id     INTEGER NOT NULL,
      unit_id         INTEGER NOT NULL,
      ledger_row_id   INTEGER,
      cash_account_id INTEGER,
      voucher_id      INTEGER,
      amount          NUMERIC(20,2) NOT NULL,
      payment_date    DATE NOT NULL,
      for_year        INTEGER NOT NULL,
      for_month       INTEGER NOT NULL,
      notes           TEXT,
      created_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS property_payments_contract_idx
       ON property_payments (contract_id)`,
  `CREATE INDEX IF NOT EXISTS property_payments_company_idx
       ON property_payments (company_id, payment_date)`,

  // ── Production Planner tables (Apr 2026) ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS factory_production_plans (
      id           SERIAL PRIMARY KEY,
      company_id   INTEGER NOT NULL,
      plan_date    DATE NOT NULL,
      category_ids TEXT NOT NULL DEFAULT '[]',
      notes        TEXT,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, plan_date)
    )`,
  `CREATE TABLE IF NOT EXISTS factory_production_plan_entries (
      id           SERIAL PRIMARY KEY,
      plan_id      INTEGER NOT NULL,
      worker_id    INTEGER NOT NULL,
      role         TEXT NOT NULL DEFAULT 'WORKER',
      target_bales INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )`,

  // ── Tables missing from prior migrations (added Apr 2026) ─────────────────

  // Offload additional charges (broker/extra costs logged at offload time)
  `CREATE TABLE IF NOT EXISTS factory_offload_additional_charges (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER NOT NULL,
      container_id     INTEGER NOT NULL,
      description      TEXT NOT NULL,
      amount           NUMERIC(20,2) NOT NULL,
      currency_code    TEXT DEFAULT 'USD',
      fx_rate_to_usd   NUMERIC(20,6) DEFAULT 1,
      ledger_account_id INTEGER,
      supplier_id      INTEGER,
      created_at       TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS factory_offload_addl_charges_container_idx
       ON factory_offload_additional_charges (container_id)`,

  // FX allocations — links fx transfers to specific containers
  `CREATE TABLE IF NOT EXISTS factory_fx_allocations (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER NOT NULL,
      fx_transfer_id   INTEGER NOT NULL,
      container_id     INTEGER NOT NULL,
      source_type      VARCHAR(20) NOT NULL DEFAULT 'supplier',
      allocated_amount NUMERIC(20,4) NOT NULL,
      currency_code    VARCHAR(10) NOT NULL,
      created_at       TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS factory_fx_alloc_transfer_idx ON factory_fx_allocations (fx_transfer_id)`,
  `CREATE INDEX IF NOT EXISTS factory_fx_alloc_container_idx ON factory_fx_allocations (container_id)`,
  `CREATE INDEX IF NOT EXISTS factory_fx_alloc_company_idx ON factory_fx_allocations (company_id)`,

  // Duty audit log — change history for container duty amounts/status
  `CREATE TABLE IF NOT EXISTS factory_duty_audit_log (
      id                  SERIAL PRIMARY KEY,
      company_id          INTEGER NOT NULL,
      container_id        INTEGER NOT NULL,
      old_duty_amount     NUMERIC(20,2),
      new_duty_amount     NUMERIC(20,2) NOT NULL,
      old_duty_status     TEXT,
      new_duty_status     TEXT NOT NULL,
      notes               TEXT,
      updated_by_user_id  TEXT NOT NULL,
      created_at          TIMESTAMP NOT NULL DEFAULT NOW()
    )`,

  // POS Shifts — open/close shift records per location/user
  `CREATE TABLE IF NOT EXISTS pos_shifts (
      id             SERIAL PRIMARY KEY,
      company_id     INTEGER NOT NULL,
      location_id    INTEGER NOT NULL,
      user_id        VARCHAR NOT NULL,
      username       TEXT NOT NULL,
      cash_account_id INTEGER,
      pos_station    INTEGER,
      status         TEXT NOT NULL DEFAULT 'open',
      opened_at      TIMESTAMP NOT NULL DEFAULT NOW(),
      closed_at      TIMESTAMP,
      opening_cash   NUMERIC(20,2) NOT NULL DEFAULT 0,
      closing_cash   NUMERIC(20,2),
      expected_cash  NUMERIC(20,2),
      variance       NUMERIC(20,2),
      sales_count    INTEGER DEFAULT 0,
      sales_total    NUMERIC(20,2) DEFAULT 0,
      notes          TEXT,
      created_at     TIMESTAMP NOT NULL DEFAULT NOW()
    )`,

  // POS Offline Queue — holds unsynced sales from offline POS clients
  `CREATE TABLE IF NOT EXISTS pos_offline_queue (
      id            SERIAL PRIMARY KEY,
      client_id     VARCHAR(100) NOT NULL,
      company_id    INTEGER NOT NULL,
      location_id   INTEGER NOT NULL,
      user_id       VARCHAR NOT NULL,
      payload       JSONB NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      retries       INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
      processed_at  TIMESTAMP
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS pos_offline_queue_client_unique ON pos_offline_queue (client_id)`,

  // Dashboard account selections — saved cash/payable account groups per company
  `CREATE TABLE IF NOT EXISTS dashboard_account_selections (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER NOT NULL,
      selection_type  TEXT NOT NULL,
      account_ids     INTEGER[] NOT NULL DEFAULT '{}',
      created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dashboard_account_selections_company_type_unique
       ON dashboard_account_selections (company_id, selection_type)`,

  // ERP user page access — per-company page permission grants
  `CREATE TABLE IF NOT EXISTS erp_user_page_access (
      id         SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      user_id    VARCHAR NOT NULL,
      page_key   TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS erp_user_page_access_unique
       ON erp_user_page_access (company_id, user_id, page_key)`,

  // ERP worker docs — employee document store (base64 file data)
  `CREATE TABLE IF NOT EXISTS erp_worker_docs (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      file_name   TEXT NOT NULL,
      file_type   TEXT NOT NULL,
      file_size   INTEGER NOT NULL,
      file_data   TEXT NOT NULL,
      description TEXT,
      uploaded_by TEXT,
      uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,

  // factory_worker_advances — voucher_id column (Drizzle migration 0101)
  `ALTER TABLE factory_worker_advances ADD COLUMN IF NOT EXISTS voucher_id INTEGER`,
  // factory_worker_documents — store file contents in DB so docs survive
  // server redeploys/restarts (Render and Replit both have ephemeral disks).
  `ALTER TABLE factory_worker_documents ADD COLUMN IF NOT EXISTS file_data text`,

  // ── Rental Auto-Transfer Config (Apr 2026) ────────────────────────────────
  `CREATE TABLE IF NOT EXISTS rental_auto_transfer_configs (
      id                    SERIAL PRIMARY KEY,
      company_id            INTEGER NOT NULL,
      module                TEXT NOT NULL,
      dest_company_id       INTEGER NOT NULL,
      dest_ledger_account_id INTEGER NOT NULL,
      enabled               BOOLEAN NOT NULL DEFAULT TRUE,
      created_at            TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  // Dropped unique index so multiple rules per company+module are supported
  `DROP INDEX IF EXISTS rental_auto_transfer_unique`,
  `ALTER TABLE rental_auto_transfer_configs ADD COLUMN IF NOT EXISTS source_cash_account_ids INTEGER[] NOT NULL DEFAULT '{}'`,
  // Ensure inter_company_transfers table exists (may not exist on fresh DBs where Drizzle push was never run)
  `CREATE TABLE IF NOT EXISTS inter_company_transfers (
      id                    SERIAL PRIMARY KEY,
      transfer_type         TEXT NOT NULL,
      from_company_id       INTEGER NOT NULL,
      to_company_id         INTEGER NOT NULL,
      transfer_date         DATE NOT NULL,
      amount                NUMERIC(15,2) NOT NULL,
      from_ledger_account_id INTEGER NOT NULL,
      to_ledger_account_id  INTEGER NOT NULL,
      from_voucher_id       INTEGER,
      to_voucher_id         INTEGER,
      description           TEXT,
      source_payment_id     INTEGER,
      created_at            TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  // Link auto-transfers back to their originating payment for cascade reversal (for older DBs)
  `ALTER TABLE inter_company_transfers ADD COLUMN IF NOT EXISTS source_payment_id INTEGER`,
  // Free-form note shown on statement PDF/Excel per customer
  `ALTER TABLE property_contracts ADD COLUMN IF NOT EXISTS statement_note TEXT`,
  // Free-form note shown on factory customer statement PDF/Excel
  `ALTER TABLE customers ADD COLUMN IF NOT EXISTS statement_note TEXT`,
  // Per-row note on each transaction in the customer balance/statement
  `ALTER TABLE customer_balances ADD COLUMN IF NOT EXISTS row_note TEXT`,
  // Payment terms (days) for factory customers — used for overdue reminders
  `ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_terms_days integer`,
  // Destination field on incoming containers (where the goods are going/warehouse)
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS destination TEXT`,
  // ── Factory/ERP User Profile Tables (may not exist on older prod DBs) ─────
  `CREATE TABLE IF NOT EXISTS factory_user_profiles (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER NOT NULL,
      user_id          VARCHAR NOT NULL,
      display_name     TEXT NOT NULL,
      has_erp_access   BOOLEAN NOT NULL DEFAULT TRUE,
      has_factory_access BOOLEAN NOT NULL DEFAULT TRUE,
      hidden_cost_fields TEXT[] NOT NULL DEFAULT '{}',
      hide_all_costs   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS factory_user_profiles_unique ON factory_user_profiles (company_id, user_id)`,
  `CREATE TABLE IF NOT EXISTS factory_user_page_access (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL,
      user_id     VARCHAR NOT NULL,
      page_key    TEXT NOT NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS factory_user_page_access_unique ON factory_user_page_access (company_id, user_id, page_key)`,
  `CREATE TABLE IF NOT EXISTS erp_user_page_access (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL,
      user_id     VARCHAR NOT NULL,
      page_key    TEXT NOT NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS erp_user_page_access_unique ON erp_user_page_access (company_id, user_id, page_key)`,
  // hide_all_costs column added later — ensure it exists on older rows
  `ALTER TABLE factory_user_profiles ADD COLUMN IF NOT EXISTS hide_all_costs BOOLEAN NOT NULL DEFAULT FALSE`,
  // Team leader linking — helpers can be assigned to a team leader in a production plan
  `ALTER TABLE factory_production_plan_entries ADD COLUMN IF NOT EXISTS team_leader_worker_id INTEGER`,
  // Bale removal log — records every bale removed from a loading for audit/history
  `CREATE TABLE IF NOT EXISTS customer_order_bale_removals (
      id                   SERIAL PRIMARY KEY,
      order_id             INTEGER NOT NULL,
      bale_id              INTEGER NOT NULL,
      reference_number     VARCHAR(100) NOT NULL,
      article_code         VARCHAR(50),
      product_name         TEXT,
      weight_kg            DECIMAL(15,3),
      removed_by_user_id   VARCHAR,
      removed_by_username  VARCHAR,
      removed_at           TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE TABLE IF NOT EXISTS location_price_groups (
      id                  SERIAL PRIMARY KEY,
      company_id          INTEGER NOT NULL,
      master_location_id  INTEGER NOT NULL,
      follower_location_id INTEGER NOT NULL,
      created_at          TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS location_price_groups_unique ON location_price_groups (company_id, master_location_id, follower_location_id)`,
  // Worker count per plan entry — how many workers are grouped under this person
  `ALTER TABLE factory_production_plan_entries ADD COLUMN IF NOT EXISTS worker_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE property_contracts ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE`,

  // ── Factory 2.0 Stock Allocation — proforma reservation tracking (Apr 2026) ──
  // Add reserved_qty to proforma_stock_reservations so the table stores the
  // pre-computed "not yet loaded" quantity per proforma+article.
  // Maintained by syncProformaReservations() after every proforma/line/loading mutation.
  // NOTE: the UNIQUE(company_id, proforma_id, article_code) constraint was already created
  // inline in the CREATE TABLE statement above — no separate index needed.
  `ALTER TABLE proforma_stock_reservations ADD COLUMN IF NOT EXISTS reserved_qty INTEGER NOT NULL DEFAULT 0`,
  // Performance index for the per-company aggregation used in computeStockTruth
  `CREATE INDEX IF NOT EXISTS proforma_stock_reservations_company_article_idx
       ON proforma_stock_reservations (company_id, article_code)`,
  // Company-level timezone setting (Apr 2026)
  `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS timezone text`,
  // SP POS accounting accounts (May 2026)
  `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS sp_pos_payable_account_id integer`,
  `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS sp_pos_profit_account_id integer`,
  // Backfill columns that exist in CREATE TABLE but may be absent on older deployed instances
  `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS logo_url text`,
  `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS logo_file_name text`,
  `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS logo_updated_at timestamp`,
  `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS invoice_footer text`,
  `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS parent_credit_account_id integer`,
  `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS net_position_adjustment decimal(15,2) DEFAULT 0`,
  `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS pos_excel_import_enabled boolean DEFAULT false`,
  `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now()`,
  `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now()`,
];
