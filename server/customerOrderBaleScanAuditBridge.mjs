import process from "node:process";
import pg from "pg";
import { resolveDatabaseSsl } from "./lib/databaseSsl.mjs";

const { Client } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  (process.env.PGHOST
    ? `postgresql://${encodeURIComponent(process.env.PGUSER || "")}:${encodeURIComponent(process.env.PGPASSWORD || "")}@${process.env.PGHOST}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || ""}`
    : "");

function log(level, message, extra = {}) {
  const method = level === "ERROR" ? "error" : level === "WARN" ? "warn" : "log";
  console[method](
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      module: "customer-order-bale-scan-audit",
      action: "startup-ensure",
      ...extra,
    })
  );
}

/**
 * `options.connectionString` overrides the environment-derived target. Server
 * boot never passes it; it exists so the routine can be driven against a
 * stubbed client without mutating process-wide database configuration.
 */
export async function ensureCustomerOrderBaleScanAudit(options = {}) {
  const target = options.connectionString ?? connectionString;
  if (!target) {
    log("WARN", "Scan-audit schema check skipped because no database configuration is available");
    return;
  }

  const client = new Client({
    connectionString: target,
    ssl: resolveDatabaseSsl(target),
    connectionTimeoutMillis: 8_000,
  });

  const repaired = [];

  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '60s'");

    const liveLookup = await client.query(`SELECT to_regclass('public.customer_order_bales') AS table_name`);
    if (!liveLookup.rows[0]?.table_name) {
      await client.query("COMMIT");
      log("WARN", "Scan-audit schema check skipped because customer_order_bales does not exist");
      return;
    }

    const liveColumn = await client.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customer_order_bales'
        AND column_name = 'scanned_at'
      LIMIT 1
    `);
    if (liveColumn.rowCount === 0) {
      await client.query(`ALTER TABLE public.customer_order_bales ADD COLUMN scanned_at TIMESTAMPTZ`);
      repaired.push("customer_order_bales.scanned_at");
    }

    const historyLookup = await client.query(`SELECT to_regclass('public.customer_order_bales_history') AS table_name`);
    const hasHistory = Boolean(historyLookup.rows[0]?.table_name);
    if (hasHistory) {
      const historyColumn = await client.query(`
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'customer_order_bales_history'
          AND column_name = 'scanned_at'
        LIMIT 1
      `);
      if (historyColumn.rowCount === 0) {
        await client.query(`ALTER TABLE public.customer_order_bales_history ADD COLUMN scanned_at TIMESTAMPTZ`);
        repaired.push("customer_order_bales_history.scanned_at");
      }
    }

    // Future inserts get the database-server scan time. When a cancelled loading
    // is restored, reuse its archived timestamp instead of inventing a new one.
    // A legacy archived row with no timestamp deliberately stays NULL.
    await client.query(`
      CREATE OR REPLACE FUNCTION public.set_customer_order_bale_scanned_at()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        restored_at TIMESTAMPTZ;
        restored_match BOOLEAN := FALSE;
      BEGIN
        IF NEW.scanned_at IS NOT NULL THEN
          RETURN NEW;
        END IF;

        IF to_regclass('public.customer_order_bales_history') IS NOT NULL THEN
          SELECT h.scanned_at, TRUE
          INTO restored_at, restored_match
          FROM public.customer_order_bales_history h
          WHERE h.order_id = NEW.order_id
            AND h.bale_id = NEW.bale_id
          ORDER BY h.cancelled_at DESC
          LIMIT 1;

          IF restored_match THEN
            NEW.scanned_at := restored_at;
            RETURN NEW;
          END IF;
        END IF;

        NEW.scanned_at := CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$
    `);

    const liveTrigger = await client.query(`
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = 'public.customer_order_bales'::regclass
        AND tgname = 'customer_order_bales_set_scanned_at'
        AND NOT tgisinternal
      LIMIT 1
    `);
    if (liveTrigger.rowCount === 0) {
      await client.query(`
        CREATE TRIGGER customer_order_bales_set_scanned_at
        BEFORE INSERT ON public.customer_order_bales
        FOR EACH ROW
        EXECUTE FUNCTION public.set_customer_order_bale_scanned_at()
      `);
      repaired.push("customer_order_bales_set_scanned_at trigger");
    }

    if (hasHistory) {
      // Cancellation code intentionally copies a fixed legacy column list. Fill
      // scanned_at in a trigger while the live row still exists so restore keeps
      // the original scanner timestamp without changing the cancellation API.
      await client.query(`
        CREATE OR REPLACE FUNCTION public.copy_customer_order_bale_scanned_at_to_history()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.scanned_at IS NULL THEN
            SELECT cob.scanned_at
            INTO NEW.scanned_at
            FROM public.customer_order_bales cob
            WHERE cob.id = NEW.original_id
            LIMIT 1;
          END IF;
          RETURN NEW;
        END;
        $$
      `);

      const historyTrigger = await client.query(`
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.customer_order_bales_history'::regclass
          AND tgname = 'customer_order_bales_history_copy_scanned_at'
          AND NOT tgisinternal
        LIMIT 1
      `);
      if (historyTrigger.rowCount === 0) {
        await client.query(`
          CREATE TRIGGER customer_order_bales_history_copy_scanned_at
          BEFORE INSERT ON public.customer_order_bales_history
          FOR EACH ROW
          EXECUTE FUNCTION public.copy_customer_order_bale_scanned_at_to_history()
        `);
        repaired.push("customer_order_bales_history_copy_scanned_at trigger");
      }
    }

    await client.query("COMMIT");
    log("INFO", "Customer order bale scan-audit schema verified", { repaired });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    log("ERROR", "Customer order bale scan-audit schema verification failed; aborting startup", {
      errorCode: error?.code,
      errorMessage: error?.message || String(error),
      repaired,
    });
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

// Importing this module installs the schema on a real server boot. Tests import
// it for the exported routine and drive it against a stubbed client instead.
if (process.env.NODE_ENV !== "test") {
  await ensureCustomerOrderBaleScanAudit();
}
