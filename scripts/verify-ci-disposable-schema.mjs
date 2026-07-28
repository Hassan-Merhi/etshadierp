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

  const result = await client.query(
    "select current_database() as database, count(*)::int as tables from information_schema.tables where table_schema = 'public'",
  );
  const summary = result.rows[0];
  console.log(summary);
  if (!summary || summary.tables < 1) {
    throw new Error("Disposable schema contains no public tables");
  }

  const required = await client.query(
    "select to_regclass('public.inventory_negative_layers') as inventory_negative_layers",
  );
  if (!required.rows[0]?.inventory_negative_layers) {
    throw new Error("Disposable schema is missing inventory_negative_layers");
  }
} finally {
  await client.end();
}
