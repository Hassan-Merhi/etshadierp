import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for disposable schema verification");
}

const client = new pg.Client({ connectionString, ssl: false });
await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_negative_layers (
      id BIGSERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      stock_item_id INTEGER NOT NULL,
      qty NUMERIC(20,3) NOT NULL,
      provisional_rate NUMERIC(20,4) NOT NULL DEFAULT 0,
      source_voucher_type TEXT,
      source_voucher_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    "CREATE INDEX IF NOT EXISTS inventory_negative_layers_lookup_idx ON inventory_negative_layers(location_id, stock_item_id, id)",
  );

  await client.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_recipients (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      chat_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_group BOOLEAN NOT NULL DEFAULT false,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (company_id, chat_id)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_settings (
      id INTEGER PRIMARY KEY,
      instance_id TEXT NOT NULL DEFAULT '',
      api_token TEXT NOT NULL DEFAULT '',
      enabled BOOLEAN NOT NULL DEFAULT false,
      monthly_auto_send BOOLEAN NOT NULL DEFAULT false,
      daily_auto_send BOOLEAN NOT NULL DEFAULT false,
      daily_recipient_id INTEGER REFERENCES whatsapp_recipients(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_stock_settings (
      id INTEGER PRIMARY KEY,
      company_id INTEGER,
      recipient_id INTEGER REFERENCES whatsapp_recipients(id) ON DELETE SET NULL,
      auto_send BOOLEAN NOT NULL DEFAULT false,
      enabled BOOLEAN NOT NULL DEFAULT false,
      frequency TEXT NOT NULL DEFAULT 'daily',
      send_hour INTEGER NOT NULL DEFAULT 18,
      send_day_of_week INTEGER,
      last_sent_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS net_position_export_settings (
      id INTEGER PRIMARY KEY,
      recipient_id INTEGER REFERENCES whatsapp_recipients(id) ON DELETE SET NULL,
      frequency TEXT NOT NULL DEFAULT 'daily',
      send_hour INTEGER NOT NULL DEFAULT 18,
      send_day_of_week INTEGER,
      enabled BOOLEAN NOT NULL DEFAULT false,
      auto_send BOOLEAN NOT NULL DEFAULT false,
      last_sent_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS factory_recalc_undo_log (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      user_id INTEGER,
      username TEXT,
      description TEXT NOT NULL,
      container_count INTEGER NOT NULL DEFAULT 0,
      container_numbers TEXT[] NOT NULL DEFAULT '{}',
      snapshot JSONB NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      undone_at TIMESTAMPTZ,
      undone_by_user_id INTEGER,
      undone_by_username TEXT
    )
  `);
  await client.query(
    "CREATE INDEX IF NOT EXISTS factory_recalc_undo_log_company_applied_idx ON factory_recalc_undo_log(company_id, applied_at DESC)",
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS factory_recalc_undo_log_company_active_idx ON factory_recalc_undo_log(company_id, undone_at) WHERE undone_at IS NULL",
  );

  await client.query(`
    CREATE TABLE IF NOT EXISTS sp_migration_rehearsal_runs (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      source_company_id INTEGER NOT NULL,
      target_company_id INTEGER NOT NULL,
      action VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      completed_at TIMESTAMP,
      rows_created INTEGER DEFAULT 0,
      error_message TEXT,
      notes TEXT
    )
  `);

  // The strict supplier company-scope migration is raw SQL and therefore is not
  // represented by `drizzle-kit push`. Disposable CI databases start empty, so
  // install the structural portion here before tests create any companies or
  // suppliers. The compatibility trigger mirrors production for legacy inserts.
  await client.query("ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS company_id INTEGER");
  await client.query("ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_code_unique");
  await client.query("DROP INDEX IF EXISTS suppliers_code_unique");
  await client.query("CREATE INDEX IF NOT EXISTS suppliers_company_idx ON suppliers(company_id)");
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS suppliers_company_code_unique
      ON suppliers(company_id, code)
      WHERE company_id IS NOT NULL
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'suppliers_company_id_fkey'
           AND conrelid = 'suppliers'::regclass
      ) THEN
        ALTER TABLE suppliers
          ADD CONSTRAINT suppliers_company_id_fkey
          FOREIGN KEY (company_id)
          REFERENCES companies(id)
          ON DELETE RESTRICT;
      END IF;
    END
    $$
  `);
  await client.query(`
    CREATE OR REPLACE FUNCTION assign_supplier_company_id()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      resolved_company_id INTEGER;
      fallback_parent_count INTEGER;
    BEGIN
      IF NEW.company_id IS NOT NULL THEN
        RETURN NEW;
      END IF;

      SELECT CASE
               WHEN value ~ '^[1-9][0-9]*$' THEN value::INTEGER
               ELSE NULL
             END
        INTO resolved_company_id
        FROM system_settings
       WHERE key = 'parentCompanyId'
       LIMIT 1;

      IF resolved_company_id IS NULL THEN
        SELECT COUNT(*)::INTEGER
          INTO fallback_parent_count
          FROM companies
         WHERE active = TRUE
           AND company_type = 'erp'
           AND parent_company_id IS NULL;

        IF fallback_parent_count = 1 THEN
          SELECT id
            INTO resolved_company_id
            FROM companies
           WHERE active = TRUE
             AND company_type = 'erp'
             AND parent_company_id IS NULL
           LIMIT 1;
        ELSE
          RAISE EXCEPTION
            'Supplier company ownership is required; configure system_settings.parentCompanyId';
        END IF;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM companies WHERE id = resolved_company_id) THEN
        RAISE EXCEPTION 'Configured supplier parent company % does not exist', resolved_company_id;
      END IF;

      NEW.company_id := resolved_company_id;
      RETURN NEW;
    END
    $$
  `);
  await client.query("DROP TRIGGER IF EXISTS suppliers_assign_company_id ON suppliers");
  await client.query(`
    CREATE TRIGGER suppliers_assign_company_id
    BEFORE INSERT ON suppliers
    FOR EACH ROW
    EXECUTE FUNCTION assign_supplier_company_id()
  `);

  // Runtime rental posting uses ON CONFLICT with the active ledger name. The
  // disposable migration baseline must expose the same partial uniqueness as
  // production before integration tests create any companies or accounts.
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_company_name_active_unique
      ON ledger_accounts(company_id, name)
      WHERE deleted_at IS NULL
  `);

  // The runtime schema requires these values for real batch creation, but a few
  // focused audit fixtures intentionally exercise source-cost logic without
  // constructing a complete production batch. Defaults keep those direct test
  // inserts valid without weakening the route-level validation contract.
  await client.query(
    "ALTER TABLE factory_mix_batches ALTER COLUMN total_weight_kg SET DEFAULT 0",
  );
  await client.query(
    "ALTER TABLE factory_mix_batches ALTER COLUMN total_cost SET DEFAULT 0",
  );

  // Preserve the decimal precision guaranteed by the costing migrations even
  // when the disposable database is built from a stale schema snapshot.
  await client.query(`
    ALTER TABLE factory_mix_batches
      ALTER COLUMN cost_per_kg TYPE NUMERIC(20,8)
      USING cost_per_kg::NUMERIC(20,8)
  `);

  // Preserve historical soft-deleted raw-stock rows while allowing one current
  // row per company/container. The old unconditional unique index made that
  // history impossible to represent.
  await client.query("DROP INDEX IF EXISTS factory_raw_stock_company_container_unique");
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS factory_raw_stock_company_container_active_unique
      ON factory_raw_stock(company_id, container_id)
      WHERE deleted_at IS NULL
  `);

  const result = await client.query(
    "select current_database() as database, count(*)::int as tables from information_schema.tables where table_schema = 'public'",
  );
  const summary = result.rows[0];
  console.log(summary);
  if (!summary || summary.tables < 1) {
    throw new Error("Disposable schema contains no public tables");
  }

  const required = await client.query(`
    SELECT
      to_regclass('public.inventory_negative_layers') AS inventory_negative_layers,
      to_regclass('public.whatsapp_settings') AS whatsapp_settings,
      to_regclass('public.whatsapp_recipients') AS whatsapp_recipients,
      to_regclass('public.whatsapp_stock_settings') AS whatsapp_stock_settings,
      to_regclass('public.net_position_export_settings') AS net_position_export_settings,
      to_regclass('public.factory_recalc_undo_log') AS factory_recalc_undo_log,
      to_regclass('public.sp_migration_rehearsal_runs') AS sp_migration_rehearsal_runs,
      EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'suppliers'
           AND column_name = 'company_id'
      ) AS suppliers_company_id,
      to_regprocedure('public.assign_supplier_company_id()') IS NOT NULL AS supplier_trigger_function
  `);
  const row = required.rows[0];
  for (const table of [
    "inventory_negative_layers",
    "whatsapp_settings",
    "whatsapp_recipients",
    "whatsapp_stock_settings",
    "net_position_export_settings",
    "factory_recalc_undo_log",
    "sp_migration_rehearsal_runs",
  ]) {
    if (!row?.[table]) throw new Error(`Disposable schema is missing ${table}`);
  }
  if (!row?.suppliers_company_id) {
    throw new Error("Disposable schema is missing suppliers.company_id");
  }
  if (!row?.supplier_trigger_function) {
    throw new Error("Disposable schema is missing supplier ownership trigger support");
  }
} finally {
  await client.end();
}
