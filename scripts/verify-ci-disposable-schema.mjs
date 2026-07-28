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
      to_regclass('public.factory_recalc_undo_log') AS factory_recalc_undo_log,
      to_regclass('public.sp_migration_rehearsal_runs') AS sp_migration_rehearsal_runs
  `);
  const row = required.rows[0];
  for (const table of [
    "inventory_negative_layers",
    "whatsapp_settings",
    "whatsapp_recipients",
    "factory_recalc_undo_log",
    "sp_migration_rehearsal_runs",
  ]) {
    if (!row?.[table]) throw new Error(`Disposable schema is missing ${table}`);
  }
} finally {
  await client.end();
}
