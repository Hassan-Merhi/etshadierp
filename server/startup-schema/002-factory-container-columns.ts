/**
 * Startup schema migrations - factory_containers columns, added incrementally as the container costing model grew.
 *
 * Part of the ordered `startupMigrations` array assembled in ./index.ts.
 * Statement order is load-bearing: these run sequentially at boot, so entries
 * must never be reordered or moved between parts.
 */

export const factoryContainerColumns: string[] = [
  // ── factory_containers — columns added incrementally ──────────────────────
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS freight_account_id integer`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS freight_supplier_id integer`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS freight_paid_by TEXT DEFAULT 'supplier'`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS freight_own_account_id INTEGER`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS other_charges decimal(20,2) DEFAULT 0`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS other_charges_currency_code varchar(10)`,
  // Backfill: existing rows that had no other_charges_currency_code set should use USD (not container currency)
  `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM migrations_log WHERE key = 'factory-containers-currency-backfill-v1') THEN
        UPDATE factory_containers SET other_charges_currency_code = 'USD' WHERE other_charges_currency_code IS NULL AND COALESCE(other_charges::numeric, 0) > 0;
        INSERT INTO migrations_log(key) VALUES ('factory-containers-currency-backfill-v1');
      END IF;
    END $$`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS other_charges_account_id integer`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS other_charges_supplier_id integer`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS commission_amount decimal(20,2) DEFAULT 0`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS commission_currency_code varchar(10) DEFAULT 'USD'`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS commission_account_id integer`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS commission_supplier_id integer`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS commission_notes text`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS duty_amount decimal(20,2)`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS duty_account_id integer`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS duty_status text NOT NULL DEFAULT 'NONE'`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS duty_notes text`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS fx_rate_to_usd_import decimal(20,8)`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS fx_rate_to_usd_offload decimal(20,8)`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS fx_rate_source text NOT NULL DEFAULT 'auto'`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS fx_rate_confirmed boolean NOT NULL DEFAULT false`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS fx_rate_date_import date`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS fx_rate_date_offload date`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS rate_per_kg_usd decimal(20,4)`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS final_payable_amount_usd decimal(20,4)`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now()`,
  // Pre-offload snapshot columns — saved during offload, restored on reverse (Mar 2026)
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_freight decimal(20,2)`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_freight_currency_code varchar(10)`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_freight_account_id integer`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_freight_supplier_id integer`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_other_charges decimal(20,2)`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_other_charges_account_id integer`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_other_charges_supplier_id integer`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_status text`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_commission_amount decimal(20,2)`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_commission_currency_code varchar(10)`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_commission_account_id integer`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_commission_supplier_id integer`,
  `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_commission_notes text`,
  `CREATE TABLE IF NOT EXISTS factory_pos_sales (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      sale_number text NOT NULL,
      tx_date date NOT NULL,
      location_id integer,
      customer_name text,
      notes text,
      total_amount decimal(20,2) NOT NULL DEFAULT 0,
      currency_code varchar(10) NOT NULL DEFAULT 'USD',
      cash_account_id integer,
      status text NOT NULL DEFAULT 'COMPLETED',
      created_by integer,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE TABLE IF NOT EXISTS factory_pos_sale_items (
      id serial PRIMARY KEY,
      sale_id integer NOT NULL,
      company_id integer NOT NULL,
      product_id integer,
      product_name text NOT NULL,
      article_code text,
      quantity integer NOT NULL DEFAULT 1,
      unit_price decimal(20,2) NOT NULL DEFAULT 0,
      total_amount decimal(20,2) NOT NULL DEFAULT 0,
      currency_code varchar(10) NOT NULL DEFAULT 'USD'
    )`,
  `ALTER TABLE factory_pos_sales ADD COLUMN IF NOT EXISTS expenses_json text`,
  `ALTER TABLE factory_pos_sales ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'CASH'`,
  `ALTER TABLE factory_pos_sales ADD COLUMN IF NOT EXISTS customer_id integer`,
  `ALTER TABLE factory_pos_sales ADD COLUMN IF NOT EXISTS deposit_amount decimal(20,2) DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS factory_worker_categories (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      name varchar(200) NOT NULL,
      worker_ids jsonb NOT NULL DEFAULT '[]',
      created_at timestamp NOT NULL DEFAULT now()
    )`,
  `ALTER TABLE customer_proforma_lines ADD COLUMN IF NOT EXISTS price_fixed boolean NOT NULL DEFAULT false`,
  `ALTER TABLE customer_proforma_lines ADD COLUMN IF NOT EXISTS production_price_per_bale numeric(20,2) NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS factory_raw_material_adjustments (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      date varchar(20) NOT NULL,
      type varchar(10) NOT NULL,
      kg decimal(15,3) NOT NULL,
      cost_per_kg decimal(20,4) DEFAULT '0',
      currency_code varchar(10) DEFAULT 'USD',
      supplier_id integer,
      material_label varchar(200),
      notes text,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE TABLE IF NOT EXISTS agent_accounts (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      account_id varchar(50) NOT NULL,
      account_type varchar(50) NOT NULL,
      account_name varchar(300) NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      UNIQUE(company_id, account_id)
    )`,
  `CREATE TABLE IF NOT EXISTS proforma_stock_reservations (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      proforma_id integer NOT NULL,
      article_code varchar(50) NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      UNIQUE(company_id, proforma_id, article_code)
    )`,
  // factory_settings columns added in phases — add missing boolean columns
  `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'factory_settings') THEN
         ALTER TABLE factory_settings ADD COLUMN IF NOT EXISTS net_profit_enabled boolean NOT NULL DEFAULT false;
         ALTER TABLE factory_settings ADD COLUMN IF NOT EXISTS production_summary_enabled boolean NOT NULL DEFAULT false;
         ALTER TABLE factory_settings ADD COLUMN IF NOT EXISTS supplier_report_enabled boolean NOT NULL DEFAULT false;
         ALTER TABLE factory_settings ADD COLUMN IF NOT EXISTS supplier_statement_enabled boolean NOT NULL DEFAULT false;
         ALTER TABLE factory_settings ADD COLUMN IF NOT EXISTS hide_selling_price boolean NOT NULL DEFAULT false;
         ALTER TABLE factory_settings ADD COLUMN IF NOT EXISTS hide_avg_cost boolean NOT NULL DEFAULT false;
       END IF;
     END $$`,
  // Several factory tables have created_by as integer but users now use UUID strings — migrate all
  `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'factory_daybook_entries' AND column_name = 'created_by' AND data_type = 'integer'
       ) THEN
         ALTER TABLE factory_daybook_entries
           ALTER COLUMN created_by TYPE character varying
           USING CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END;
       END IF;
     END $$`,
  `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'factory_bale_waste_dispatches' AND column_name = 'created_by' AND data_type = 'integer'
       ) THEN
         ALTER TABLE factory_bale_waste_dispatches
           ALTER COLUMN created_by TYPE character varying
           USING CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END;
       END IF;
     END $$`,
  `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'factory_pos_sales' AND column_name = 'created_by' AND data_type = 'integer'
       ) THEN
         ALTER TABLE factory_pos_sales
           ALTER COLUMN created_by TYPE character varying
           USING CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END;
       END IF;
     END $$`,
  `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'factory_pressing_batches' AND column_name = 'created_by' AND data_type = 'integer'
       ) THEN
         ALTER TABLE factory_pressing_batches
           ALTER COLUMN created_by TYPE character varying
           USING CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END;
       END IF;
     END $$`,
  `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'factory_waste_entries' AND column_name = 'created_by' AND data_type = 'integer'
       ) THEN
         ALTER TABLE factory_waste_entries
           ALTER COLUMN created_by TYPE character varying
           USING CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END;
       END IF;
     END $$`,
  `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'container_freight_payments' AND column_name = 'created_by' AND data_type = 'integer'
       ) THEN
         ALTER TABLE container_freight_payments
           ALTER COLUMN created_by TYPE character varying
           USING CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END;
       END IF;
     END $$`,
  `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'pressing_batches' AND column_name = 'created_by' AND data_type = 'integer'
       ) THEN
         ALTER TABLE pressing_batches
           ALTER COLUMN created_by TYPE character varying
           USING CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END;
       END IF;
     END $$`,
  // Backfill offload_date on containers that were offloaded before the column was written.
  // The offloadContainer() function previously set status=OFFLOADED but never wrote offload_date.
  // Pull the date from the container_offloads record (offloaded_at) so the Container Report
  // date filter and all ERP displays show the correct offload date for historical data.
  `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM migrations_log WHERE key = 'containers-offload-date-backfill-v1') THEN
        UPDATE containers c
        SET offload_date = (
          SELECT DATE(co.offloaded_at)
          FROM container_offloads co
          WHERE co.container_id = c.id
          ORDER BY co.id DESC
          LIMIT 1
        )
        WHERE c.status = 'OFFLOADED'
          AND c.offload_date IS NULL;
        INSERT INTO migrations_log(key) VALUES ('containers-offload-date-backfill-v1');
      END IF;
    END $$`,
  // Financial Snapshot pinned accounts per company/card (Apr 2026)
  `CREATE TABLE IF NOT EXISTS snapshot_pinned_accounts (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      card_key varchar(50) NOT NULL,
      account_id varchar(50) NOT NULL,
      account_type varchar(50) NOT NULL,
      account_name varchar(300) NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT snapshot_pinned_accounts_unique UNIQUE (company_id, card_key, account_id)
    )`,
  `CREATE TABLE IF NOT EXISTS stock_transfer_revisions (
      id serial PRIMARY KEY,
      transfer_id integer NOT NULL,
      revision_number integer NOT NULL,
      note text,
      optional boolean NOT NULL DEFAULT false,
      revision_date timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE TABLE IF NOT EXISTS stock_transfer_revision_items (
      id serial PRIMARY KEY,
      revision_id integer NOT NULL,
      stock_item_id integer NOT NULL,
      stock_item_name text NOT NULL,
      source_location_id integer,
      source_location_name text,
      original_quantity decimal(15,3) NOT NULL,
      delta decimal(15,3) NOT NULL,
      new_quantity decimal(15,3) NOT NULL
    )`,
  `ALTER TABLE stock_transfer_revisions ADD COLUMN IF NOT EXISTS created_by varchar`,
  // Transport allowance on worker profile
  `ALTER TABLE factory_workers ADD COLUMN IF NOT EXISTS transport_allowance decimal(20,2) DEFAULT 0`,
  // Transport column on payroll records
  `ALTER TABLE factory_payrolls ADD COLUMN IF NOT EXISTS transport decimal(20,2) DEFAULT 0`,
  // Daily export recipients list
  `CREATE TABLE IF NOT EXISTS export_recipients (
      id serial PRIMARY KEY,
      email varchar(255) NOT NULL UNIQUE,
      active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
  // Daily export settings (singleton row id=1)
  `CREATE TABLE IF NOT EXISTS export_settings (
      id integer PRIMARY KEY,
      gmail_user varchar(255) NOT NULL DEFAULT '',
      gmail_app_password text NOT NULL DEFAULT '',
      schedule_enabled boolean NOT NULL DEFAULT false,
      last_run_at timestamp
    )`,
  // WhatsApp (Green API) settings — singleton row id=1
  `CREATE TABLE IF NOT EXISTS whatsapp_settings (
      id integer PRIMARY KEY,
      instance_id varchar(255) NOT NULL DEFAULT '',
      api_token text NOT NULL DEFAULT '',
      enabled boolean NOT NULL DEFAULT false,
      monthly_auto_send boolean NOT NULL DEFAULT false,
      daily_auto_send boolean NOT NULL DEFAULT false
    )`,
  `ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS daily_auto_send boolean NOT NULL DEFAULT false`,
  `ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS daily_recipient_id integer`,
  `ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS containers_wa_group_chat_id text NOT NULL DEFAULT ''`,
  `ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS containers_wa_schedule_enabled boolean NOT NULL DEFAULT false`,
  `ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS containers_wa_schedule_hour integer NOT NULL DEFAULT 8`,
  `ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS containers_wa_last_sent_at timestamp`,
  `ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS transfer_wa_group_chat_id text NOT NULL DEFAULT ''`,
  `ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS agent_duty_wa_groups jsonb NOT NULL DEFAULT '{}'`,
  `ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS weekly_report_wa_group_chat_id text NOT NULL DEFAULT ''`,
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS transfer_wa_group_chat_id text`,
  // WhatsApp recipients (individual numbers or group chatIds) — per-tenant
  `CREATE TABLE IF NOT EXISTS whatsapp_recipients (
      id serial PRIMARY KEY,
      chat_id varchar(255) NOT NULL UNIQUE,
      name varchar(255) NOT NULL DEFAULT '',
      is_group boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
  // Tenant isolation (May 2026): scope every recipient to a company
  `ALTER TABLE whatsapp_recipients ADD COLUMN IF NOT EXISTS company_id integer`,
  // Backfill any pre-existing rows to the lowest companyId (parent company convention)
  `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM migrations_log WHERE key = 'whatsapp-recipients-company-backfill-v1') THEN
        UPDATE whatsapp_recipients SET company_id = (SELECT MIN(id) FROM companies) WHERE company_id IS NULL;
        INSERT INTO migrations_log(key) VALUES ('whatsapp-recipients-company-backfill-v1');
      END IF;
    END $$`,
  // Drop the old global UNIQUE on chat_id; replace with per-tenant uniqueness
  `ALTER TABLE whatsapp_recipients DROP CONSTRAINT IF EXISTS whatsapp_recipients_chat_id_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_recipients_company_chat_unique ON whatsapp_recipients (company_id, chat_id)`,
  // Stock + Net Position report — per-company config sent to one specific group
  `CREATE TABLE IF NOT EXISTS whatsapp_stock_settings (
      id serial PRIMARY KEY,
      company_id integer,
      recipient_id integer,
      auto_send boolean NOT NULL DEFAULT false,
      enabled boolean NOT NULL DEFAULT false,
      frequency varchar(20) NOT NULL DEFAULT 'daily',
      send_hour integer NOT NULL DEFAULT 18,
      send_day_of_week integer,
      last_sent_at timestamp
    )`,
  `ALTER TABLE whatsapp_stock_settings ADD COLUMN IF NOT EXISTS frequency varchar(20) NOT NULL DEFAULT 'daily'`,
  `ALTER TABLE whatsapp_stock_settings ADD COLUMN IF NOT EXISTS send_hour integer NOT NULL DEFAULT 18`,
  `ALTER TABLE whatsapp_stock_settings ADD COLUMN IF NOT EXISTS send_day_of_week integer`,
  `ALTER TABLE whatsapp_stock_settings ADD COLUMN IF NOT EXISTS last_sent_at timestamp`,

  // Update ALL existing credit sale voucher entries to use new narration format:
  // "POS - [Customer Name] - [Location Name]" instead of old "Credit Sale - POSXXX"
  `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM migrations_log WHERE key = 'credit-sale-narration-backfill-v1') THEN
        -- Debit entries (customer receivable — Asset account)
        WITH debit_narrations AS (
           SELECT ve.id AS entry_id,
                  'POS - ' || la.name || ' - ' || COALESCE(v.location_name, '') AS new_narration
           FROM voucher_entries ve
           JOIN vouchers v ON v.id = ve.voucher_id
           JOIN ledger_accounts la ON la.id = ve.ledger_account_id
           WHERE v.is_credit_sale = true
             AND ve.debit_amount::numeric > 0
             AND la.account_type = 'Asset'
        )
        UPDATE voucher_entries
        SET narration = debit_narrations.new_narration
        FROM debit_narrations
        WHERE voucher_entries.id = debit_narrations.entry_id
          AND (voucher_entries.narration IS NULL OR voucher_entries.narration = '');
        -- Credit entries (SALES account side)
        WITH credit_narrations AS (
           SELECT credit_ve.id AS entry_id,
                  'POS - ' || la.name || ' - ' || COALESCE(v.location_name, '') AS new_narration
           FROM vouchers v
           JOIN voucher_entries debit_ve ON (
             debit_ve.voucher_id = v.id AND debit_ve.debit_amount::numeric > 0
           )
           JOIN ledger_accounts la ON (
             la.id = debit_ve.ledger_account_id AND la.account_type = 'Asset'
           )
           JOIN voucher_entries credit_ve ON (
             credit_ve.voucher_id = v.id AND credit_ve.credit_amount::numeric > 0
           )
           WHERE v.is_credit_sale = true
        )
        UPDATE voucher_entries
        SET narration = credit_narrations.new_narration
        FROM credit_narrations
        WHERE voucher_entries.id = credit_narrations.entry_id
          AND (voucher_entries.narration IS NULL OR voucher_entries.narration = '');
        INSERT INTO migrations_log(key) VALUES ('credit-sale-narration-backfill-v1');
      END IF;
    END $$`,

  // Net position scheduled export — configurable group + frequency
  `CREATE TABLE IF NOT EXISTS net_position_export_settings (
       id           integer PRIMARY KEY DEFAULT 1,
       recipient_id integer,
       frequency    varchar(20) NOT NULL DEFAULT 'daily',
       send_hour    integer NOT NULL DEFAULT 18,
       send_day_of_week integer,
       enabled      boolean NOT NULL DEFAULT false,
       auto_send    boolean NOT NULL DEFAULT false,
       last_sent_at timestamp
    )`,
  // container_offloads.optional — marks optional bale lines (added Apr 2026)
  `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'container_offloads') THEN
         ALTER TABLE container_offloads ADD COLUMN IF NOT EXISTS optional BOOLEAN NOT NULL DEFAULT false;
       END IF;
     END $$`,
  // Rename bale statuses (Apr 2026): REMOVED→DISPATCHED/DELETED, FINALIZED→IN_STOCK
  // Wrapped: after first run no REMOVED/FINALIZED rows remain so re-running is a no-op,
  // but migrations_log guard prevents any risk of touching newly-added rows with those names.
  `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM migrations_log WHERE key = 'bale-status-rename-v1') THEN
        UPDATE factory_bales SET status = 'DISPATCHED' WHERE status = 'REMOVED' AND waste_dispatch_id IS NOT NULL;
        UPDATE factory_bales SET status = 'DELETED' WHERE status = 'REMOVED';
        UPDATE factory_bales SET status = 'IN_STOCK' WHERE status = 'FINALIZED';
        INSERT INTO migrations_log(key) VALUES ('bale-status-rename-v1');
      END IF;
    END $$`,
];
