import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { fetchAllCompanies } from "../exportDataService";
import { pool } from "../../db";
import {} from "../whatsappService";
import { buildFullExportZip } from "../../helpers/buildFullExportZip";
import { retryAsync, isWaConfigError } from "../../helpers/retryAsync";
import { createExportRun, updateExportRun, finishExportRun } from "../../helpers/exportRunTracker";

import { getTodayLabel, runDailyExport } from "./daily-export";
import { runDailyWhatsAppSend } from "./whatsapp-send";

export async function purgeOldSoftDeletes(): Promise<void> {
  const client = await pool.connect();
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await client.query("BEGIN");

    // ── Stock Items (must clear FK children first) ──────────────────────────
    const oldStockItems = await client.query<{ id: number }>(
      `SELECT id FROM stock_items WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
      [cutoff]
    );
    if (oldStockItems.rows.length > 0) {
      const ids = oldStockItems.rows.map((r) => r.id);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
      await client.query(`DELETE FROM sales_items                       WHERE stock_item_id IN (${placeholders})`, ids);
      await client.query(`DELETE FROM stock_adjustment_items            WHERE stock_item_id IN (${placeholders})`, ids);
      await client.query(`DELETE FROM stock_transfer_items              WHERE stock_item_id IN (${placeholders})`, ids);
      await client.query(`DELETE FROM stock_transfer_revision_items     WHERE stock_item_id IN (${placeholders})`, ids);
      await client.query(`DELETE FROM po_line_items                     WHERE stock_item_id IN (${placeholders})`, ids);
      await client.query(`DELETE FROM container_offload_items           WHERE stock_item_id IN (${placeholders})`, ids);
      await client.query(`DELETE FROM credit_note_items                 WHERE stock_item_id IN (${placeholders})`, ids);
      await client.query(`DELETE FROM inventory                         WHERE stock_item_id IN (${placeholders})`, ids);
      await client.query(`DELETE FROM waste_dispatch_items              WHERE stock_item_id IN (${placeholders})`, ids);
      await client.query(
        `DELETE FROM stock_group_location_archive_items WHERE stock_item_id IN (${placeholders})`,
        ids
      );
      await client.query(`DELETE FROM stock_item_code_aliases           WHERE stock_item_id IN (${placeholders})`, ids);
      await client.query(`DELETE FROM stock_item_location_prices        WHERE stock_item_id IN (${placeholders})`, ids);
      await client.query(`DELETE FROM stock_items WHERE id IN (${placeholders})`, ids);
      logger.info(`[Purge] Permanently deleted ${ids.length} stock item(s) older than 30 days.`);
    }

    // ── Simple tables with no FK children referencing them ──────────────────
    const simplePurges: Array<{ table: string; col: string }> = [
      { table: "stock_groups", col: "deleted_at" },
      { table: "locations", col: "deleted_at" },
      { table: "ledger_accounts", col: "deleted_at" },
      { table: "employees", col: "deleted_at" },
      { table: "customers", col: "deleted_at" },
      { table: "suppliers", col: "deleted_at" },
      { table: "bank_accounts", col: "deleted_at" },
      { table: "factory_categories", col: "deleted_at" },
      { table: "factory_bale_products", col: "deleted_at" },
      { table: "factory_containers", col: "deleted_at" },
      { table: "factory_raw_stock", col: "deleted_at" },
      { table: "factory_raw_material_adjustments", col: "deleted_at" },
      { table: "factory_mix_batches", col: "deleted_at" },
      { table: "factory_bales", col: "deleted_at" },
      { table: "customer_proformas", col: "deleted_at" },
      { table: "customer_orders", col: "deleted_at" },
    ];

    for (const { table, col } of simplePurges) {
      const result = await client.query(`DELETE FROM ${table} WHERE ${col} IS NOT NULL AND ${col} < $1`, [cutoff]);
      if (result.rowCount && result.rowCount > 0) {
        logger.info(`[Purge] Permanently deleted ${result.rowCount} ${table} row(s) older than 30 days.`);
      }
    }

    await client.query("COMMIT");
    logger.info("[Purge] 30-day soft-delete purge complete.");
  } catch (err: unknown) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error("[Purge] Error during soft-delete purge (rolled back):", { error: getErrorMessage(err) });
  } finally {
    client.release();
  }
}

// ── Containers WhatsApp scheduled send ────────────────────────────────────────

export async function checkAndRunContainersWhatsApp(): Promise<void> {
  try {
    const { getContainersWaSettings, sendWhatsAppFileToChatId, markContainersWaSent } =
      await import("../whatsappService");
    const settings = await getContainersWaSettings();

    if (!settings?.scheduleEnabled || !settings?.groupChatId) return;
    if (!settings?.instanceId || !settings?.apiToken || !settings?.enabled) return;

    const nowHour = new Date().getHours();
    if (nowHour !== settings.scheduleHour) return;

    // Skip if already sent within the last 12 hours
    if (settings.lastSentAt) {
      const hoursSince = (Date.now() - new Date(settings.lastSentAt).getTime()) / (1000 * 60 * 60);
      if (hoursSince < 12) {
        logger.info("[ContainersWA] Already sent within 12 h — skipping.");
        return;
      }
    }

    logger.info("[ContainersWA] Scheduled send triggered.");
    const { generateContainersPdf } = await import("../../helpers/generateContainersPdf");
    const { buffer, rowCount } = await generateContainersPdf();

    const today = new Date().toISOString().substring(0, 10);
    const caption = "";
    const fileName = `Containers_${today}.pdf`;

    const result = await sendWhatsAppFileToChatId(settings.groupChatId, buffer, fileName, caption, "application/pdf");

    if (result.success) {
      await markContainersWaSent();
      logger.info(`[ContainersWA] PDF sent to ${settings.groupChatId} — ${rowCount} containers.`);
    } else {
      logger.error("[ContainersWA] Scheduled send failed:", { error: result.error });
    }
  } catch (err: unknown) {
    logger.error("[ContainersWA] Error:", { error: getErrorMessage(err) });
  }
}

/** Manually trigger the daily ZIP → WhatsApp send (bypasses the dailyAutoSend schedule toggle).
 *  Pass fromDate / toDate (YYYY-MM-DD) to scope the export; omit for full history.
 *  Retries up to 3 times (30 s between attempts) on actual send failures.
 *  Records the attempt in daily_export_runs.
 *  Throws an Error with a human-readable message if WhatsApp is not configured or the send fails.
 */
export async function triggerDailyWhatsAppSendNow(fromDate?: string, toDate?: string): Promise<{ message: string }> {
  const runId = await createExportRun("manual_whatsapp");
  logger.info(`[ManualWhatsApp] Run id=${runId} started.`);

  const companies = await fetchAllCompanies();
  if (!companies || companies.length === 0) {
    await finishExportRun(runId, { status: "failed", skippedReason: "No companies found." });
    throw new Error("No companies found.");
  }

  const today = getTodayLabel();
  let zip: Buffer, names: string[], skipped: string[];
  try {
    ({ zip, names, skipped } = await buildFullExportZip(companies, fromDate, toDate));
  } catch (err: unknown) {
    await finishExportRun(runId, { status: "failed", skippedReason: getErrorMessage(err) });
    throw err;
  }

  await updateExportRun(runId, {
    companiesCount: companies.length,
    companyFilesCount: names.length,
    zipSizeBytes: zip.length,
    skippedCompanies: skipped.join(", ") || null,
    whatsappAttempted: true,
  });

  const rangeLabel = fromDate || toDate ? ` (${fromDate || "start"} → ${toDate || "today"})` : " (full history)";
  const skippedNote = skipped.length > 0 ? ` (${skipped.length} skipped)` : "";

  // Retry up to 3× with 30-second delays (manual trigger is interactive — shorter delay)
  const waRes = await retryAsync({
    label: "ManualWhatsApp",
    attempts: 3,
    delayMs: 30 * 1000,
    fn: () => runDailyWhatsAppSend(zip, today, companies, { bypassAutoSendCheck: true }),
    isSuccess: (r) => r.sent,
    shouldRetry: (r) => !r.skipped && (!r.error || !isWaConfigError(r.error)),
    onAttempt: (n) => logger.info(`[ManualWhatsApp] Attempt ${n}/3...`),
  });

  const result = waRes.result;

  if (result.skipped) {
    await finishExportRun(runId, {
      status: "failed",
      whatsappSuccess: false,
      whatsappError: result.skipReason,
      whatsappAttempts: waRes.attempts,
    });
    throw new Error(
      `WhatsApp not configured or not ready: ${result.skipReason}. ` +
        `Please enable WhatsApp and select a Daily Export recipient in WhatsApp settings.`
    );
  }

  if (!result.sent) {
    await finishExportRun(runId, {
      status: "failed",
      whatsappSuccess: false,
      whatsappError: result.error || "Unknown error",
      whatsappAttempts: waRes.attempts,
    });
    throw new Error(`WhatsApp send failed after ${waRes.attempts} attempt(s): ${result.error || "Unknown error"}`);
  }

  await finishExportRun(runId, {
    status: "success",
    whatsappSuccess: true,
    whatsappAttempts: waRes.attempts,
  });

  logger.info(`[ManualWhatsApp] Run ${runId} succeeded (attempt ${waRes.attempts}).`);
  return { message: `Daily ZIP sent to WhatsApp — ${names.length} companies${rangeLabel}${skippedNote}.` };
}

export { runDailyExport };
