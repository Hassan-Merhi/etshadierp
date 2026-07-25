import { Client } from "pg";

const REPAIR_LOCK_KEY = "erp-startup-warning-repair-v1";

function structuredLog(level, message, detail = {}) {
  const writer = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
  writer(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      module: "startup-warning-repair",
      action: "startup-repair",
      ...detail,
    }),
  );
}

function connectionOptions() {
  const connectionString =
    process.env.DATABASE_URL ||
    (process.env.PGHOST
      ? `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`
      : "");

  if (!connectionString) return null;

  const isLocalReplitDb = process.env.PGHOST === "helium" || connectionString.includes("@helium:");
  const sslDisabled = process.env.PGSSLMODE === "disable";

  return {
    connectionString,
    ssl: !isLocalReplitDb && !sslDisabled ? { rejectUnauthorized: false } : false,
  };
}

async function existingTables(client) {
  const result = await client.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [["exchange_rates", "vouchers", "voucher_entries", "sp_containers", "ledger_accounts"]],
  );
  return new Set(result.rows.map((row) => row.table_name));
}

async function ensureSupplierSyncColumns(client, tables) {
  const ensured = [];

  if (tables.has("vouchers")) {
    await client.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS supplier_id INTEGER`);
    ensured.push("vouchers.supplier_id");
  }
  if (tables.has("voucher_entries")) {
    await client.query(`ALTER TABLE voucher_entries ADD COLUMN IF NOT EXISTS supplier_id INTEGER`);
    ensured.push("voucher_entries.supplier_id");
  }
  if (tables.has("sp_containers")) {
    await client.query(`ALTER TABLE sp_containers ADD COLUMN IF NOT EXISTS supplier_id INTEGER`);
    await client.query(`ALTER TABLE sp_containers ADD COLUMN IF NOT EXISTS goods_otw_voucher_id INTEGER`);
    ensured.push("sp_containers.supplier_id", "sp_containers.goods_otw_voucher_id");
  }
  if (tables.has("ledger_accounts")) {
    await client.query(`ALTER TABLE ledger_accounts ADD COLUMN IF NOT EXISTS sub_type TEXT`);
    ensured.push("ledger_accounts.sub_type");
  }

  return ensured;
}

async function repairExchangeRateDuplicates(client, tables) {
  if (!tables.has("exchange_rates")) {
    return { duplicateRowsRemoved: 0, indexEnsured: false };
  }

  await client.query(`LOCK TABLE exchange_rates IN SHARE ROW EXCLUSIVE MODE`);

  const removed = await client.query(`
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY company_id, effective_date, from_currency, to_currency
               ORDER BY id DESC
             ) AS duplicate_rank
        FROM exchange_rates
    )
    DELETE FROM exchange_rates er
    USING ranked r
    WHERE er.id = r.id
      AND r.duplicate_rank > 1
    RETURNING er.id
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS exchange_rates_company_date_pair_unique
      ON exchange_rates (company_id, effective_date, from_currency, to_currency)
  `);

  return {
    duplicateRowsRemoved: removed.rowCount ?? 0,
    indexEnsured: true,
  };
}

export async function runStartupWarningRepair() {
  const options = connectionOptions();
  if (!options) {
    structuredLog("INFO", "Startup warning repair skipped because no database configuration is present");
    return;
  }

  const client = new Client(options);
  let transactionStarted = false;

  try {
    await client.connect();
    await client.query(`SET lock_timeout = '30s'`);
    await client.query(`SET statement_timeout = '120s'`);
    await client.query("BEGIN");
    transactionStarted = true;

    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [REPAIR_LOCK_KEY]);

    const tables = await existingTables(client);
    const ensuredColumns = await ensureSupplierSyncColumns(client, tables);
    const exchangeRateRepair = await repairExchangeRateDuplicates(client, tables);

    await client.query("COMMIT");
    transactionStarted = false;

    structuredLog("INFO", "Startup database warning repair completed", {
      ensuredColumns,
      ...exchangeRateRepair,
    });
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }

    structuredLog("WARN", "Startup database warning repair could not complete; normal server startup will continue", {
      error: error instanceof Error ? error.message : String(error),
      code: error && typeof error === "object" && "code" in error ? error.code : undefined,
    });
  } finally {
    await client.end().catch(() => undefined);
  }
}

await runStartupWarningRepair();
