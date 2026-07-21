import process from "node:process";
import pg from "pg";

const { Client } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  (process.env.PGHOST
    ? `postgresql://${encodeURIComponent(process.env.PGUSER || "")}://${encodeURIComponent(process.env.PGPASSWORD || "")}@${process.env.PGHOST}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || ""}`
    : "");

function log(level, message, extra = {}) {
  const method = level === "ERROR" ? "error" : level === "WARN" ? "warn" : "log";
  console[method](
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      module: "critical-security-schema",
      action: "startup-ensure",
      ...extra,
    })
  );
}

async function ensureCriticalSecuritySchema() {
  if (!connectionString) {
    log("WARN", "Critical security schema check skipped because no database configuration is available");
    return;
  }

  const isLocalReplitDb =
    process.env.PGHOST === "helium" || connectionString.includes("@helium:");
  const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
  const requiresSsl = !isLocalReplitDb && !sslExplicitlyDisabled;

  const client = new Client({
    connectionString,
    ssl: requiresSsl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 8_000,
  });

  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '60s'");

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_security_permissions (
        id serial PRIMARY KEY NOT NULL,
        user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id integer NOT NULL,
        permission text NOT NULL,
        granted_by varchar REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      )
    `);

    // CREATE TABLE IF NOT EXISTS does not repair a partially-created table.
    // These additions are idempotent and protect deployments with schema drift.
    await client.query(`ALTER TABLE user_security_permissions ADD COLUMN IF NOT EXISTS id serial`);
    await client.query(`ALTER TABLE user_security_permissions ADD COLUMN IF NOT EXISTS user_id varchar`);
    await client.query(`ALTER TABLE user_security_permissions ADD COLUMN IF NOT EXISTS company_id integer`);
    await client.query(`ALTER TABLE user_security_permissions ADD COLUMN IF NOT EXISTS permission text`);
    await client.query(`ALTER TABLE user_security_permissions ADD COLUMN IF NOT EXISTS granted_by varchar`);
    await client.query(`ALTER TABLE user_security_permissions ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now()`);
    await client.query(`ALTER TABLE user_security_permissions ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now()`);

    await client.query(`
      DELETE FROM user_security_permissions
      WHERE user_id IS NULL OR company_id IS NULL OR permission IS NULL
    `);

    await client.query(`
      DELETE FROM user_security_permissions duplicate
      USING user_security_permissions canonical
      WHERE duplicate.id > canonical.id
        AND duplicate.user_id = canonical.user_id
        AND duplicate.company_id = canonical.company_id
        AND duplicate.permission = canonical.permission
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS user_security_permissions_unique
      ON user_security_permissions (user_id, company_id, permission)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS user_security_permissions_company_user_idx
      ON user_security_permissions (company_id, user_id)
    `);

    const permissions = [
      "administration.repair",
      "security.permissions.manage",
      "security.anomalies.read",
      "factory.documents.download",
      "factory.raw-stock.repair",
      "files.download",
    ];

    await client.query(
      `
        INSERT INTO user_security_permissions
          (user_id, company_id, permission, granted_by)
        SELECT
          ucr.user_id,
          ucr.company_id,
          permission_name,
          ucr.user_id
        FROM user_company_roles ucr
        CROSS JOIN unnest($1::text[]) AS permission_name
        WHERE ucr.role IN ('Admin', 'Developer')
        ON CONFLICT (user_id, company_id, permission) DO NOTHING
      `,
      [permissions]
    );

    const verification = await client.query(`
      SELECT
        COUNT(*)::integer AS total_permissions,
        COUNT(*) FILTER (WHERE permission = 'factory.raw-stock.repair')::integer AS raw_stock_repair_permissions
      FROM user_security_permissions
    `);

    await client.query("COMMIT");

    log("INFO", "Critical security permissions schema verified", {
      totalPermissions: verification.rows[0]?.total_permissions ?? 0,
      rawStockRepairPermissions: verification.rows[0]?.raw_stock_repair_permissions ?? 0,
      startupMigrationsEnabled: process.env.RUN_STARTUP_MIGRATIONS !== "false",
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    log("ERROR", "Critical security schema verification failed; aborting startup", {
      errorCode: error?.code,
      errorMessage: error?.message || String(error),
    });
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

await ensureCriticalSecuritySchema();
