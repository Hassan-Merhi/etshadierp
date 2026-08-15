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

  // Canonical stock movement journal. Stock transfers write their evidence
  // inside the transaction that applies inventory, so the suite cannot run
  // without these. In a deployed environment they come from
  // server/startup-schema/021-canonical-stock-movement-journal.ts; this job
  // prepares its database with `drizzle-kit push` alone and never starts the
  // application, which is why the DDL is repeated here as it already is for
  // inventory_negative_layers above.
  await client.query(`
    CREATE TABLE IF NOT EXISTS canonical_stock_movements (
      id BIGSERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
      stock_item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,
      location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
      quantity_delta NUMERIC(18, 6) NOT NULL,
      unit_cost NUMERIC(18, 6) NOT NULL,
      movement_kind TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      reversal_of_movement_id BIGINT REFERENCES canonical_stock_movements(id) ON DELETE RESTRICT,
      occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT canonical_stock_movements_quantity_nonzero CHECK (quantity_delta <> 0),
      CONSTRAINT canonical_stock_movements_unit_cost_nonnegative CHECK (unit_cost >= 0)
    )
  `);
  await client.query(
    "CREATE INDEX IF NOT EXISTS canonical_stock_movements_company_source_idx ON canonical_stock_movements(company_id, source_type, source_id)",
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS canonical_stock_movements_company_item_location_idx ON canonical_stock_movements(company_id, stock_item_id, location_id)",
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS canonical_stock_movement_requests (
      id BIGSERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
      idempotency_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      movement_ids BIGINT[] NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT canonical_stock_movement_requests_company_key_unique
        UNIQUE(company_id, idempotency_key)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS canonical_stock_movement_audit (
      id BIGSERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
      idempotency_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      movement_ids BIGINT[] NOT NULL,
      quantity NUMERIC(18, 6) NOT NULL,
      value NUMERIC(24, 6) NOT NULL,
      actor_user_id TEXT,
      actor_username TEXT,
      reason TEXT,
      occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const required = await client.query(`
    SELECT
      to_regclass('public.inventory_negative_layers') AS inventory_negative_layers,
      to_regclass('public.whatsapp_settings') AS whatsapp_settings,
      to_regclass('public.whatsapp_recipients') AS whatsapp_recipients,
      to_regclass('public.whatsapp_stock_settings') AS whatsapp_stock_settings,
      to_regclass('public.net_position_export_settings') AS net_position_export_settings,
      to_regclass('public.factory_recalc_undo_log') AS factory_recalc_undo_log,
      to_regclass('public.sp_migration_rehearsal_runs') AS sp_migration_rehearsal_runs,
      to_regclass('public.canonical_stock_movements') AS canonical_stock_movements,
      to_regclass('public.canonical_stock_movement_requests') AS canonical_stock_movement_requests,
      to_regclass('public.canonical_stock_movement_audit') AS canonical_stock_movement_audit
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
    "canonical_stock_movements",
    "canonical_stock_movement_requests",
    "canonical_stock_movement_audit",
  ]) {
    if (!row?.[table]) throw new Error(`Disposable schema is missing ${table}`);
  }
} finally {
  await client.end();
}
