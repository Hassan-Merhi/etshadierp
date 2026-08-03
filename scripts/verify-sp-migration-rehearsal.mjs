import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString, ssl: false });
const requiredTables = [
  "stock_items",
  "locations",
  "sp_containers",
  "sp_container_lines",
  "sp_offloads",
  "sp_offload_charges",
  "sp_stock_movements",
  "sp_sales",
  "sp_sale_lines",
  "sp_prepaid_charges",
  "sp_profit_splits",
  "vouchers",
  "voucher_entries",
  "ledger_accounts",
  "users",
  "companies",
];

const checks = [];
const add = (name, passed, details = {}) => checks.push({ name, passed, details });

const client = await pool.connect();
try {
  const tableRows = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
    [requiredTables]
  );
  const found = new Set(tableRows.rows.map((row) => row.table_name));
  const missing = requiredTables.filter((table) => !found.has(table));
  add("required-schema", missing.length === 0, { missing });

  const duplicateAliases = found.has("stock_item_aliases")
    ? await client.query("SELECT alias, COUNT(*)::int AS count FROM stock_item_aliases GROUP BY alias HAVING COUNT(*) > 1 LIMIT 20")
    : { rows: [] };
  add("duplicate-aliases", duplicateAliases.rows.length === 0, { rows: duplicateAliases.rows });

  const unknownCodes = found.has("sp_container_lines")
    ? await client.query("SELECT id, article_code FROM sp_container_lines WHERE stock_item_id IS NULL LIMIT 20")
    : { rows: [] };
  add("unknown-stock-codes", unknownCodes.rows.length === 0, { rows: unknownCodes.rows });

  const missingSuppliers = await client.query(
    "SELECT id, supplier_name FROM sp_containers WHERE supplier_id IS NULL AND status <> 'cancelled' LIMIT 20"
  );
  add("missing-supplier-links", missingSuppliers.rows.length === 0, { rows: missingSuppliers.rows });

  const unmappedCharges = await client.query(
    `SELECT id, charge_type FROM sp_offload_charges
     WHERE charge_type IN ('prepaid_used','paid_now','unpaid_payable','other','parent_agent')
       AND CASE
         WHEN charge_type = 'prepaid_used' THEN prepaid_charge_id IS NULL
         WHEN charge_type = 'paid_now' THEN credit_bank_account_id IS NULL
         ELSE credit_ledger_account_id IS NULL
       END
     LIMIT 20`
  );
  add("unmapped-container-charges", unmappedCharges.rows.length === 0, { rows: unmappedCharges.rows });

  const quantityMismatch = await client.query(
    `SELECT o.id,
            o.total_qty::numeric AS recorded,
            COALESCE(SUM(sm.qty_in::numeric),0) AS movement_total
     FROM sp_offloads o
     LEFT JOIN sp_stock_movements sm ON sm.offload_id = o.id AND sm.company_id = o.company_id
     GROUP BY o.id, o.total_qty
     HAVING ABS(o.total_qty::numeric - COALESCE(SUM(sm.qty_in::numeric),0)) > 0.0001
     LIMIT 20`
  );
  add("quantity-reconciliation", quantityMismatch.rows.length === 0, { rows: quantityMismatch.rows });

  const valueMismatch = await client.query(
    `SELECT o.id,
            o.total_final_cost_usd::numeric AS recorded,
            COALESCE(SUM(sm.qty_in::numeric * sm.final_unit_cost_usd::numeric),0) AS movement_value
     FROM sp_offloads o
     LEFT JOIN sp_stock_movements sm ON sm.offload_id = o.id AND sm.company_id = o.company_id
     GROUP BY o.id, o.total_final_cost_usd
     HAVING ABS(o.total_final_cost_usd::numeric - COALESCE(SUM(sm.qty_in::numeric * sm.final_unit_cost_usd::numeric),0)) > 0.01
     LIMIT 20`
  );
  add("value-reconciliation", valueMismatch.rows.length === 0, { rows: valueMismatch.rows });

  const suspense = await client.query(
    "SELECT id, name FROM ledger_accounts WHERE LOWER(name) LIKE '%migration suspense%' AND deleted_at IS NULL LIMIT 20"
  );
  add("migration-suspense", suspense.rows.length === 0, { rows: suspense.rows });

  await client.query("BEGIN");
  await client.query("SAVEPOINT sp_rehearsal_cutover");
  const before = await client.query("SELECT COUNT(*)::int AS count FROM sp_containers");
  await client.query("CREATE TEMP TABLE sp_rehearsal_marker(id int) ON COMMIT DROP");
  await client.query("INSERT INTO sp_rehearsal_marker VALUES (1)");
  await client.query("ROLLBACK TO SAVEPOINT sp_rehearsal_cutover");
  const after = await client.query("SELECT COUNT(*)::int AS count FROM sp_containers");
  await client.query("ROLLBACK");
  add("cutover-rollback-rehearsal", before.rows[0].count === after.rows[0].count, {
    before: before.rows[0].count,
    after: after.rows[0].count,
  });

  const failed = checks.filter((check) => !check.passed);
  const report = { status: failed.length === 0 ? "PASS" : "FAIL", failedCount: failed.length, checks };
  console.log(JSON.stringify(report, null, 2));
  if (failed.length > 0) process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
