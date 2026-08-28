import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { pool } from "../../db";
import { runWithDatabaseMaintenanceScope } from "../security/databaseScopeRuntimeContext";

/** Lightweight state query used by scheduler ticks without loading export libraries. */
export async function hasTodayExportSucceeded(): Promise<boolean> {
  try {
    const r = await pool.query(`
      SELECT id FROM daily_export_runs
       WHERE run_type = 'scheduled'
         AND status   IN ('success', 'partial_failed')
         AND started_at >= NOW() - INTERVAL '23 hours'
       LIMIT 1
    `);
    return (r.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Lightweight state query used by scheduler ticks without loading export libraries. */
export async function isTodayExportRunning(): Promise<boolean> {
  try {
    const r = await pool.query(`
      SELECT id FROM daily_export_runs
       WHERE run_type = 'scheduled'
         AND status   = 'running'
         AND started_at >= NOW() - INTERVAL '23 hours'
       LIMIT 1
    `);
    return (r.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Re-run a missed scheduled export after restart, but keep the expensive
 * export dependency graph out of memory unless the probe proves work is due.
 * The schedule checks and maintenance scope mirror the established recovery
 * behavior; only module-loading timing changes.
 */
export async function checkAndRecoverDailyExport(): Promise<void> {
  return runWithDatabaseMaintenanceScope("daily-export-recovery", async () => {
    try {
      const r = await pool.query(
        `SELECT schedule_enabled, schedule_hour, schedule_timezone FROM export_settings WHERE id = 1`
      );
      if (!r.rows.length) return;
      const row = r.rows[0];

      if (!row.schedule_enabled) {
        logger.info("[DailyExport] Recovery check: schedule is disabled — skipping.");
        return;
      }

      const configuredHour: number = row.schedule_hour ?? 18;
      const tz: string = row.schedule_timezone || "America/New_York";
      const nowInTz = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
      const currentHour = nowInTz.getHours();

      if (currentHour < configuredHour) {
        logger.info(
          `[DailyExport] Recovery check: current hour (${currentHour}:xx ${tz}) is before scheduled hour (${configuredHour}:00) — skipping.`
        );
        return;
      }

      if (await hasTodayExportSucceeded()) {
        logger.info("[DailyExport] Recovery check: today's export already succeeded — nothing to do.");
        return;
      }
      if (await isTodayExportRunning()) {
        logger.info("[DailyExport] Recovery check: export is currently running — skipping.");
        return;
      }

      logger.info("[DailyExport] Recovery check: re-running today's failed/missed export...");
      const { runDailyExport } = await import("./daily-export");
      await runDailyExport();
    } catch (e: unknown) {
      logger.error("[DailyExport] Recovery check error:", { error: getErrorMessage(e) || e });
    }
  });
}
