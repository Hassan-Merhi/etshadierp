import cron from "node-cron";
import archiver from "archiver";
import { PassThrough } from "stream";
import { fetchAllCompanies } from "./exportDataService";
import { sendExportEmail } from "./emailService";
import { pool } from "../db";
import { ensureMonthlyForCompany, postRentAccrualForCompany } from "../routes/rental/_rentalShared";
import { getWaSettings, getActiveRecipients, sendWhatsAppFile, sendWhatsAppFileToChatId, sendWhatsAppText } from "./whatsappService";
import { generateNetPositionExcel } from "../helpers/generateNetPositionExcel";
import { generateStockPdf } from "../helpers/generateStockPdf";
import { storage } from "../storage";
import { buildFullExportZip } from "../helpers/buildFullExportZip";
import { retryAsync, isEmailConfigError, isWaConfigError } from "../helpers/retryAsync";
import { createExportRun, updateExportRun, finishExportRun } from "../helpers/exportRunTracker";

const WHATSAPP_ATTACHMENT_LIMIT_MB = 15;

let schedulerStarted = false;

function getTodayLabel(): string {
  return new Date().toISOString().substring(0, 10);
}

/**
 * Build a ZIP containing per-company net position Excel files.
 */
async function buildNetPositionZip(
  companies: any[],
  startDate: string,
  endDate: string
): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    const chunks: Buffer[] = [];
    const arc = archiver("zip", { zlib: { level: 6 } });
    arc.on("data", (chunk: Buffer) => chunks.push(chunk));
    arc.on("end", () => resolve(Buffer.concat(chunks)));
    arc.on("error", reject);

    for (const company of companies) {
      const safe = company.name.replace(/[^a-z0-9]/gi, "_");
      const pass = new PassThrough();
      arc.append(pass, { name: `NetPosition_${safe}_${endDate}.xlsx` });
      try {
        await generateNetPositionExcel(company.id, company.name, startDate, endDate, pass);
        if (!pass.destroyed) pass.end();
        console.log(`[NetPositionExport] Added ${company.name}`);
      } catch (e: any) {
        console.error(`[NetPositionExport] Failed for ${company.name}:`, e.message);
        if (!pass.destroyed) pass.destroy(e);
      }
    }

    arc.finalize();
  });
}

// ── Helpers: check today's scheduled export state (UTC-agnostic: last 23 h) ───

async function hasTodayExportSucceeded(): Promise<boolean> {
  try {
    const r = await pool.query(`
      SELECT id FROM daily_export_runs
       WHERE run_type = 'scheduled'
         AND status   IN ('success', 'partial_failed')
         AND started_at >= NOW() - INTERVAL '23 hours'
       LIMIT 1
    `);
    return (r.rowCount ?? 0) > 0;
  } catch { return false; }
}

async function isTodayExportRunning(): Promise<boolean> {
  try {
    const r = await pool.query(`
      SELECT id FROM daily_export_runs
       WHERE run_type = 'scheduled'
         AND status   = 'running'
         AND started_at >= NOW() - INTERVAL '23 hours'
       LIMIT 1
    `);
    return (r.rowCount ?? 0) > 0;
  } catch { return false; }
}

/**
 * Re-runs the daily export if today's scheduled run hasn't succeeded yet.
 * Called at startup (after server restart).
 * Will NOT fire before the configured schedule hour to avoid early-restart surprises.
 */
export async function checkAndRecoverDailyExport(): Promise<void> {
  try {
    // Read schedule config first — only recover if the scheduled hour has already passed today.
    const r = await pool.query(
      `SELECT schedule_enabled, schedule_hour, schedule_timezone FROM export_settings WHERE id = 1`
    );
    if (!r.rows.length) return;
    const row = r.rows[0];

    if (!row.schedule_enabled) {
      console.log("[DailyExport] Recovery check: schedule is disabled — skipping.");
      return;
    }

    const configuredHour: number = row.schedule_hour ?? 18;
    const tz: string = row.schedule_timezone || "America/New_York";
    const nowInTz = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const currentHour = nowInTz.getHours();

    // Don't trigger recovery before the scheduled time has even arrived today.
    if (currentHour < configuredHour) {
      console.log(
        `[DailyExport] Recovery check: current hour (${currentHour}:xx ${tz}) is before scheduled hour (${configuredHour}:00) — skipping.`
      );
      return;
    }

    if (await hasTodayExportSucceeded()) {
      console.log("[DailyExport] Recovery check: today's export already succeeded — nothing to do.");
      return;
    }
    if (await isTodayExportRunning()) {
      console.log("[DailyExport] Recovery check: export is currently running — skipping.");
      return;
    }
    console.log("[DailyExport] Recovery check: re-running today's failed/missed export...");
    await runDailyExport();
  } catch (e: any) {
    console.error("[DailyExport] Recovery check error:", e?.message || e);
  }
}

async function runDailyExport(): Promise<boolean> {
  const cronFiredAt = new Date().toISOString();
  console.log(`[DailyExport] Scheduled run triggered at ${cronFiredAt}`);

  // ── Check what's enabled BEFORE any expensive work ──────────────────────
  const emailEnabled  = await isScheduleEnabled();
  const waSettings    = await getWaSettings();
  const whatsappReady = !!(
    waSettings?.enabled &&
    waSettings?.dailyAutoSend &&
    waSettings?.dailyRecipientId
  );

  console.log(`[DailyExport] Email enabled: ${emailEnabled} | WhatsApp ready: ${whatsappReady}`);

  if (!emailEnabled && !whatsappReady) {
    console.log("[DailyExport] Email schedule and WhatsApp daily auto-send are both disabled. Nothing to send.");
    const rid = await createExportRun("scheduled");
    await finishExportRun(rid, { status: "skipped", skippedReason: "Email schedule and WhatsApp daily auto-send are both disabled." });
    return true;
  }

  const runId = await createExportRun("scheduled");
  console.log(`[DailyExport] Run id=${runId} started.`);

  try {
    const companies = await fetchAllCompanies();
    if (!companies || companies.length === 0) {
      console.log("[DailyExport] No companies found — skipping export.");
      await finishExportRun(runId, { status: "failed", skippedReason: "No companies found." });
      return false;
    }

    const today = getTodayLabel();

    // Limit the scheduled daily export to the last 3 years so the ZIP stays
    // a manageable size. Older data is available via the manual "Export Now"
    // flow where the user can pick an explicit date range.
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    const exportFromDate = threeYearsAgo.toISOString().substring(0, 10);

    console.log(`[DailyExport] Building export for ${companies.length} company/companies (label: ${today}, from: ${exportFromDate})`);

    const { zip, names, skipped } = await buildFullExportZip(companies, exportFromDate, undefined);

    if (!names.length || !zip.length) {
      console.error("[DailyExport] ZIP is empty — no companies exported successfully. Nothing will be sent.");
      await finishExportRun(runId, {
        status: "failed",
        companiesCount: companies.length,
        skippedReason: "Export ZIP is empty — no companies exported successfully.",
      });
      return false;
    }

    const zipSizeBytes = zip.length;
    const zipSizeMb    = (zipSizeBytes / 1024 / 1024).toFixed(1);
    console.log(`[DailyExport] Run ${runId} — ZIP ready: ${zipSizeMb} MB, ${names.length} companies${skipped.length ? `, ${skipped.length} skipped: ${skipped.join(", ")}` : ""}`);

    await updateExportRun(runId, {
      companiesCount:    companies.length,
      companyFilesCount: names.length,
      zipSizeBytes,
      skippedCompanies:  skipped.join(", ") || null,
    });

    // ── Email (retried up to 3×, 2 min between attempts) ───────────────────
    let emailSuccess  = false;
    let emailError: string | undefined;
    let emailAttempts = 0;

    if (emailEnabled) {
      await updateExportRun(runId, { emailAttempted: true });
      console.log("[DailyExport] Sending email (up to 3 attempts, 2 min delay)...");

      const emailRes = await retryAsync({
        label:       "DailyExport/Email",
        attempts:    3,
        delayMs:     2 * 60 * 1000,
        fn:          () => sendExportEmail(zip, today, names),
        isSuccess:   r => r.success,
        shouldRetry: r => !r.error || !isEmailConfigError(r.error),
        onAttempt:   n => { emailAttempts = n; console.log(`[DailyExport] Email attempt ${n}/3...`); },
      });

      emailSuccess  = emailRes.result.success;
      emailAttempts = emailRes.attempts;
      emailError    = emailRes.result.error;

      if (emailSuccess) {
        console.log(`[DailyExport] Email sent successfully (attempt ${emailAttempts}).`);
        await pool.query(`UPDATE export_settings SET last_run_at = now() WHERE id = 1`).catch(() => {});
      } else {
        console.error(`[DailyExport] Email failed after ${emailAttempts} attempt(s): ${emailError}`);
      }
    } else {
      console.log("[DailyExport] Email schedule is disabled — skipping email.");
    }

    // ── WhatsApp (retried up to 3×, 2 min between attempts) ────────────────
    let waSuccess  = false;
    let waError: string | undefined;
    let waAttempts = 0;

    if (whatsappReady) {
      await updateExportRun(runId, { whatsappAttempted: true });
      console.log("[DailyExport] Sending via WhatsApp (up to 3 attempts, 2 min delay)...");

      const waRes = await retryAsync({
        label:       "DailyExport/WhatsApp",
        attempts:    3,
        delayMs:     2 * 60 * 1000,
        fn:          () => runDailyWhatsAppSend(zip, today, companies),
        isSuccess:   r => r.sent,
        shouldRetry: r => !r.skipped && (!r.error || !isWaConfigError(r.error)),
        onAttempt:   n => { waAttempts = n; console.log(`[DailyExport] WhatsApp attempt ${n}/3...`); },
      });

      waSuccess  = waRes.result.sent;
      waAttempts = waRes.attempts;
      waError    = waRes.result.error || waRes.result.skipReason;

      if (waSuccess) {
        console.log(`[DailyExport] WhatsApp sent successfully (attempt ${waAttempts}).`);
      } else if (waRes.result.skipped) {
        console.log(`[DailyExport] WhatsApp skipped: ${waError}.`);
      } else {
        console.error(`[DailyExport] WhatsApp failed after ${waAttempts} attempt(s): ${waError}`);
      }
    } else {
      console.log("[DailyExport] WhatsApp not ready — skipping WhatsApp send.");
    }

    // ── Determine final run status ──────────────────────────────────────────
    const bothSucceeded = (!emailEnabled || emailSuccess) && (!whatsappReady || waSuccess);
    const atLeastOne    = (emailEnabled && emailSuccess) || (whatsappReady && waSuccess);
    const finalStatus   = bothSucceeded ? "success" : atLeastOne ? "partial_failed" : "failed";

    console.log(
      `[DailyExport] Run ${runId} finished — status: ${finalStatus}` +
      ` | email: ${emailEnabled ? (emailSuccess ? "ok" : "failed") : "n/a"}` +
      ` | wa: ${whatsappReady ? (waSuccess ? "ok" : "failed") : "n/a"}`,
    );

    await finishExportRun(runId, {
      status:           finalStatus,
      emailSuccess,
      emailError:       emailError ?? null,
      emailAttempts,
      whatsappSuccess:  waSuccess,
      whatsappError:    waError ?? null,
      whatsappAttempts: waAttempts,
    });

    return finalStatus !== "failed";

  } catch (err: any) {
    console.error(`[DailyExport] Unexpected error in run ${runId}:`, err?.stack || err?.message || err);
    await finishExportRun(runId, { status: "failed", skippedReason: err?.message || "Unexpected error" }).catch(() => {});
    return false;
  }
}

// ─── Daily WhatsApp send (6 PM) ───────────────────────────────────────────────

interface DailyWaSendResult {
  sent:        boolean;
  skipped:     boolean;
  skipReason?: string;
  error?:      string;
}

async function runDailyWhatsAppSend(
  dailyZip: Buffer,
  dateLabel: string,
  companies: { id: number; name: string }[],
  opts: { bypassAutoSendCheck?: boolean } = {},
): Promise<DailyWaSendResult> {
  const skip = (skipReason: string): DailyWaSendResult => {
    console.log(`[WhatsApp] ${skipReason} — skipping daily ZIP send.`);
    return { sent: false, skipped: true, skipReason };
  };

  const settings = await getWaSettings();

  if (!settings?.enabled) {
    return skip("WhatsApp is disabled");
  }

  // Only enforce the dailyAutoSend toggle for the scheduled cron, not manual triggers
  if (!opts.bypassAutoSendCheck && !settings.dailyAutoSend) {
    return skip("Daily auto-send toggle is off");
  }

  const recipientId = settings.dailyRecipientId;
  if (!recipientId) {
    return skip("No daily export WhatsApp group configured");
  }

  const rRow = await pool.query(
    "SELECT chat_id FROM whatsapp_recipients WHERE id = $1 AND active = true",
    [recipientId],
  );
  if (!rRow.rows.length) {
    return skip(`Daily export recipient id=${recipientId} not found or inactive`);
  }

  // ZIP size check — WhatsApp has a lower attachment limit than email
  const zipSizeMb = dailyZip.length / 1024 / 1024;
  if (zipSizeMb > WHATSAPP_ATTACHMENT_LIMIT_MB) {
    const msg = `ZIP is too large for WhatsApp. Size: ${zipSizeMb.toFixed(1)} MB (limit: ${WHATSAPP_ATTACHMENT_LIMIT_MB} MB).`;
    console.error(`[WhatsApp] ${msg}`);
    return { sent: false, skipped: false, error: msg };
  }

  const chatId      = rRow.rows[0].chat_id as string;
  const zipFileName = `DailyExport_${dateLabel}.zip`;
  const zipCaption  = "";
  console.log(`[WhatsApp] Sending daily export ZIP (${zipSizeMb.toFixed(1)} MB) to ${chatId}…`);

  try {
    const zipRes = await sendWhatsAppFileToChatId(chatId, dailyZip, zipFileName, zipCaption, "application/zip");
    if (zipRes.success) {
      console.log("[WhatsApp] Daily ZIP sent successfully.");
      return { sent: true, skipped: false };
    }
    const errMsg = zipRes.error || "Send failed";
    console.error(`[WhatsApp] Daily ZIP send error: ${errMsg}`);
    return { sent: false, skipped: false, error: errMsg };
  } catch (err: any) {
    const errMsg = err?.message || "Unknown error";
    console.error("[WhatsApp] Daily send error:", errMsg);
    return { sent: false, skipped: false, error: errMsg };
  }
}

// ─── Stock + Net Position Report — independent schedule ───────────────────────

/** Returns true if, given frequency/day config and last_sent_at, it's time to send. */
function shouldSendStockReport(cfg: {
  frequency:     string;
  sendHour:      number;
  sendDayOfWeek: number | null;
  lastSentAt:    Date | null;
}): boolean {
  // All times in EST (America/New_York)
  const nowEst = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const currentHour = nowEst.getHours();
  const currentDay  = nowEst.getDay();  // 0=Sun … 6=Sat

  if (currentHour !== cfg.sendHour) return false;

  // Check if already sent in the current period
  if (cfg.lastSentAt) {
    const lastEst = new Date(new Date(cfg.lastSentAt).toLocaleString("en-US", { timeZone: "America/New_York" }));
    const sameDay   = lastEst.toDateString() === nowEst.toDateString();
    const sameWeek  = isSameIsoWeek(lastEst, nowEst);
    const sameMonth = lastEst.getFullYear() === nowEst.getFullYear() && lastEst.getMonth() === nowEst.getMonth();

    if (cfg.frequency === "daily"   && sameDay)   return false;
    if (cfg.frequency === "weekly"  && sameWeek)  return false;
    if (cfg.frequency === "monthly" && sameMonth) return false;
  }

  if (cfg.frequency === "daily") return true;

  if (cfg.frequency === "weekly") {
    const targetDay = cfg.sendDayOfWeek ?? 1; // default Monday
    return currentDay === targetDay;
  }

  if (cfg.frequency === "monthly") {
    return nowEst.getDate() === 1;
  }

  return false;
}

function isSameIsoWeek(a: Date, b: Date): boolean {
  const getMonday = (d: Date) => {
    const copy = new Date(d);
    const day = copy.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    copy.setDate(copy.getDate() + diff);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };
  return getMonday(a).getTime() === getMonday(b).getTime();
}

export async function checkAndRunStockReport(): Promise<void> {
  try {
    const r = await pool.query(
      `SELECT company_id, recipient_id, auto_send, enabled,
              frequency, send_hour, send_day_of_week, last_sent_at
       FROM whatsapp_stock_settings WHERE id = 1`,
    );
    if (!r.rows.length) return;
    const row = r.rows[0];

    if (!row.enabled || !row.auto_send) return;
    if (!row.company_id || !row.recipient_id) return;

    const cfg = {
      frequency:     (row.frequency     ?? "daily") as string,
      sendHour:      (row.send_hour     ?? 18)       as number,
      sendDayOfWeek: (row.send_day_of_week           ?? null) as number | null,
      lastSentAt:    row.last_sent_at ? new Date(row.last_sent_at) : null,
    };

    if (!shouldSendStockReport(cfg)) return;

    // Fetch recipient chatId
    const rq = await pool.query(
      "SELECT chat_id FROM whatsapp_recipients WHERE id = $1 AND active = true",
      [row.recipient_id],
    );
    if (!rq.rows.length) {
      console.log("[StockReport] Recipient inactive — skipping.");
      return;
    }
    const chatId = rq.rows[0].chat_id as string;

    const allCompanies = await storage.getAllCompanies();
    const company      = (allCompanies as any[]).find((c) => c.id === row.company_id);
    if (!company) { console.log(`[StockReport] Company ${row.company_id} not found.`); return; }

    const today     = getTodayLabel();
    const yearStart = `${new Date().getUTCFullYear()}-01-01`;

    console.log(`[StockReport] Sending to ${company.name} → ${chatId} (${cfg.frequency})…`);

    // 1. Stock PDF
    const { buffer: pdfBuf, pageCount: pdfPageCount, rowCount: pdfRowCount } =
      await generateStockPdf(row.company_id, company.name, undefined, undefined, true);

    // Safety guard: if PDF is absurdly over-paginated, skip send rather than
    // delivering a broken 100+ page file. Root cause: PDFKit ≥0.17 exposes
    // page.maxY as a function; ensureSpace must call it, not compare to it.
    const maxAllowedPages = Math.ceil(pdfRowCount / 20) + 5;
    if (pdfPageCount > maxAllowedPages) {
      console.error(
        `[StockReport] SAFETY GUARD: PDF has ${pdfPageCount} pages for ${pdfRowCount} rows ` +
        `(max allowed: ${maxAllowedPages}). company="${company.name}". Skipping WhatsApp send.`,
      );
      return;
    }

    const pdfName = `Stock_${company.name.replace(/[^a-z0-9]/gi, "_")}_${today}.pdf`;
    const pdfCap  = "";
    console.log(
      `[StockReport] Uploading stock PDF — chatId=${chatId} file=${pdfName} ` +
      `size=${pdfBuf.length} pageCount=${pdfPageCount} rowCount=${pdfRowCount}`,
    );
    const pdfRes  = await sendWhatsAppFileToChatId(chatId, pdfBuf, pdfName, pdfCap, "application/pdf");
    if (pdfRes.success) {
      console.log(`[StockReport] PDF sent — chatId=${chatId} file=${pdfName}`);
    } else {
      console.error(
        `[StockReport] PDF upload failed — chatId=${chatId} file=${pdfName} ` +
        `size=${pdfBuf.length} pageCount=${pdfPageCount} rowCount=${pdfRowCount} ` +
        `greenApiError="${pdfRes.error}"`,
      );
    }

    // 2. Net Position Excel (Jan 1 → today)
    const xlsBuf  = await generateNetPositionExcel(row.company_id, company.name, yearStart, today);
    const xlsName = `NetPosition_${company.name.replace(/[^a-z0-9]/gi, "_")}_${today}.xlsx`;
    const xlsCap  = "";
    const xlsRes  = await sendWhatsAppFileToChatId(
      chatId, xlsBuf, xlsName, xlsCap,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    console.log(`[StockReport] Net Position Excel: ${xlsRes.success ? "sent" : xlsRes.error}`);

    // Mark as sent
    await pool.query(`UPDATE whatsapp_stock_settings SET last_sent_at = now() WHERE id = 1`);
    console.log(`[StockReport] Done — last_sent_at updated.`);
  } catch (err: any) {
    console.error("[StockReport] Error:", err?.message || err);
  }
}

// ─── Net Position Scheduled Export — all companies → WhatsApp group + email ──

export async function checkAndRunNetPositionExport(): Promise<void> {
  try {
    const r = await pool.query(
      `SELECT recipient_id, frequency, send_hour, send_day_of_week,
              enabled, auto_send, last_sent_at
       FROM net_position_export_settings WHERE id = 1`,
    );
    if (!r.rows.length) return;
    const row = r.rows[0];

    if (!row.enabled || !row.auto_send) return;

    const cfg = {
      frequency:     (row.frequency      ?? "daily") as string,
      sendHour:      (row.send_hour      ?? 18)       as number,
      sendDayOfWeek: (row.send_day_of_week            ?? null) as number | null,
      lastSentAt:    row.last_sent_at ? new Date(row.last_sent_at) : null,
    };

    if (!shouldSendStockReport(cfg)) return;

    const companies = await storage.getAllCompanies() as any[];
    if (!companies.length) {
      console.log("[NetPositionExport] No companies found — skipping.");
      return;
    }

    const today    = getTodayLabel();
    const year     = new Date().getUTCFullYear();
    const npStart  = `${year}-01-01`;
    const npEnd    = today;

    console.log(`[NetPositionExport] Building net position ZIP for ${companies.length} companies (${npStart}→${npEnd})…`);
    const zipBuf = await buildNetPositionZip(companies, npStart, npEnd);
    console.log(`[NetPositionExport] ZIP ready (${(zipBuf.length / 1024).toFixed(0)} KB)`);

    // Send to WhatsApp group
    if (row.recipient_id) {
      const rq = await pool.query(
        "SELECT chat_id FROM whatsapp_recipients WHERE id = $1 AND active = true",
        [row.recipient_id],
      );
      if (rq.rows.length) {
        const chatId = rq.rows[0].chat_id as string;
        const waSettings = await getWaSettings();
        if (waSettings?.enabled) {
          const waRes = await sendWhatsAppFileToChatId(
            chatId,
            zipBuf,
            `NetPosition_AllCompanies_${today}.zip`,
            "",
            "application/zip",
          );
          console.log(`[NetPositionExport] WhatsApp: ${waRes.success ? "sent" : waRes.error}`);
        } else {
          console.log("[NetPositionExport] WhatsApp not enabled — skipping WhatsApp send.");
        }
      } else {
        console.log(`[NetPositionExport] Recipient id=${row.recipient_id} inactive — skipping WhatsApp.`);
      }
    }

    // Send via email (uses existing export_recipients + export_settings for credentials)
    const emailResult = await sendExportEmail(zipBuf, today, companies.map((c) => c.name));
    console.log(`[NetPositionExport] Email: ${emailResult.success ? "sent" : emailResult.error}`);

    // Mark as sent
    await pool.query(`UPDATE net_position_export_settings SET last_sent_at = now() WHERE id = 1`);
    console.log(`[NetPositionExport] Done — last_sent_at updated.`);
  } catch (err: any) {
    console.error("[NetPositionExport] Error:", err?.message || err);
  }
}

export async function isScheduleEnabled(): Promise<boolean> {
  try {
    const res = await pool.query(`SELECT schedule_enabled FROM export_settings WHERE id = 1`);
    if (!res.rows || res.rows.length === 0) return false;
    return res.rows[0].schedule_enabled === true;
  } catch {
    return false;
  }
}

// ─── Monthly WhatsApp net-position send ───────────────────────────────────────

async function runMonthlyWhatsAppNetPosition() {
  console.log("[WhatsApp] Starting monthly net-position send…");
  try {
    const settings = await getWaSettings();
    if (!settings?.enabled || !settings?.monthlyAutoSend) {
      console.log("[WhatsApp] Monthly auto-send is disabled — skipping.");
      return;
    }
    const recipients = await getActiveRecipients();
    if (!recipients.length) {
      console.log("[WhatsApp] No active recipients — skipping.");
      return;
    }

    const companies = await storage.getAllCompanies();
    const endDate   = getTodayLabel();
    const startDate = (() => {
      const d = new Date(endDate);
      d.setFullYear(d.getFullYear() - 1);
      return d.toISOString().split("T")[0];
    })();

    for (const company of companies as any[]) {
      try {
        console.log(`[WhatsApp] Generating net-position Excel for ${company.name}…`);
        const buffer   = await generateNetPositionExcel(company.id, company.name, startDate, endDate);
        const safe     = company.name.replace(/[^a-z0-9]/gi, "_");
        const fileName = `NetPosition_${safe}_${endDate}.xlsx`;
        const caption  = "";
        const result   = await sendWhatsAppFile(buffer, fileName, caption);
        console.log(`[WhatsApp] ${company.name}: sent=${result.sent} failed=${result.failed}`);
      } catch (compErr: any) {
        console.error(`[WhatsApp] Failed for ${company.name}:`, compErr.message);
      }
    }
    console.log("[WhatsApp] Monthly net-position send complete.");
  } catch (err: any) {
    console.error("[WhatsApp] Monthly send error:", err);
  }
}

/**
 * Check all factory customers who have payment terms set and an outstanding debit balance
 * whose oldest unpaid invoice has passed its due date (invoice_date + payment_terms_days).
 * Sends a single consolidated WhatsApp text message listing all overdue customers.
 */
export async function checkOverdueCustomers(): Promise<void> {
  console.log("[OverdueCheck] Running overdue customer payment check...");

  const waSettings = await getWaSettings();
  if (!waSettings?.enabled) {
    console.log("[OverdueCheck] WhatsApp disabled — skipping.");
    return;
  }

  try {
    // Find customers with payment terms set, their net balance (debit = they owe us),
    // and the earliest finalized invoice date per customer.
    const result = await pool.query(`
      SELECT
        c.id,
        c.legal_name,
        c.payment_terms_days,
        c.company_id,
        COALESCE(SUM(
          CASE
            WHEN cb.entry_type = 'DEBIT'  THEN cb.amount::numeric
            WHEN cb.entry_type = 'CREDIT' THEN -cb.amount::numeric
            ELSE 0
          END
        ), 0) + COALESCE(
          CASE WHEN c.opening_balance_side = 'Dr' THEN c.opening_balance::numeric
               WHEN c.opening_balance_side = 'Cr' THEN -c.opening_balance::numeric
               ELSE 0 END, 0
        ) AS net_balance,
        MIN(
          CASE WHEN cb.entry_type = 'DEBIT' THEN cb.entry_date ELSE NULL END
        ) AS earliest_invoice_date
      FROM customers c
      LEFT JOIN customer_balances cb ON cb.customer_id = c.id
      WHERE c.payment_terms_days IS NOT NULL
        AND c.deleted_at IS NULL
        AND c.active = true
      GROUP BY c.id, c.legal_name, c.payment_terms_days, c.company_id,
               c.opening_balance, c.opening_balance_side
      HAVING COALESCE(SUM(
          CASE
            WHEN cb.entry_type = 'DEBIT'  THEN cb.amount::numeric
            WHEN cb.entry_type = 'CREDIT' THEN -cb.amount::numeric
            ELSE 0
          END
        ), 0) + COALESCE(
          CASE WHEN c.opening_balance_side = 'Dr' THEN c.opening_balance::numeric
               WHEN c.opening_balance_side = 'Cr' THEN -c.opening_balance::numeric
               ELSE 0 END, 0
        ) > 0
    `);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdue: { name: string; balance: number; dueDate: string; daysOverdue: number }[] = [];

    for (const row of result.rows) {
      const earliestInvoiceDate = row.earliest_invoice_date ? new Date(row.earliest_invoice_date) : null;
      if (!earliestInvoiceDate) continue;

      const dueDate = new Date(earliestInvoiceDate);
      dueDate.setDate(dueDate.getDate() + Number(row.payment_terms_days));
      dueDate.setHours(0, 0, 0, 0);

      if (dueDate <= today) {
        const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        overdue.push({
          name: row.legal_name,
          balance: parseFloat(row.net_balance),
          dueDate: dueDate.toISOString().substring(0, 10),
          daysOverdue,
        });
      }
    }

    if (overdue.length === 0) {
      console.log("[OverdueCheck] No overdue customers today.");
      return;
    }

    const lines = overdue.map((c) =>
      `• ${c.name}: $${c.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} — due ${c.dueDate} (${c.daysOverdue === 0 ? "due today" : `${c.daysOverdue}d overdue`})`
    );

    const message = `*Payment Reminder*\n\nThe following customers have outstanding balances past their due date:\n\n${lines.join("\n")}\n\nPlease follow up.`;

    const waRes = await sendWhatsAppText(message);
    if (waRes.success) {
      console.log(`[OverdueCheck] Reminder sent for ${overdue.length} overdue customer(s).`);
    } else {
      console.error("[OverdueCheck] Failed to send WhatsApp reminder:", waRes.errors);
    }
  } catch (err: any) {
    console.error("[OverdueCheck] Error during overdue check:", err.message);
  }
}

/**
 * Reads the configured schedule_hour + schedule_timezone from export_settings
 * and runs the daily export if the current local hour matches and it hasn't run today.
 * Called every hour by the main hourly cron.
 */
async function checkAndRunScheduledDailyExport(): Promise<void> {
  try {
    const r = await pool.query(
      `SELECT schedule_enabled, schedule_hour, schedule_timezone FROM export_settings WHERE id = 1`
    );
    if (!r.rows.length) return;
    const row = r.rows[0];

    if (!row.schedule_enabled) return;

    const configuredHour: number = row.schedule_hour ?? 18;
    const tz: string = row.schedule_timezone || "America/New_York";

    // Get the current hour in the configured timezone
    const nowInTz = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const currentHour = nowInTz.getHours();

    if (currentHour !== configuredHour) return;

    // Already succeeded today?
    if (await hasTodayExportSucceeded()) {
      console.log("[DailyExport] Hourly check: today's export already succeeded — skipping.");
      return;
    }
    // Already running?
    if (await isTodayExportRunning()) {
      console.log("[DailyExport] Hourly check: export is currently running — skipping.");
      return;
    }

    console.log(`[DailyExport] Hourly check: time matches (${configuredHour}:00 ${tz}) — starting export.`);
    const MAX_ATTEMPTS = 4;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const ok = await runDailyExport();
      if (ok) {
        if (attempt > 1) console.log(`[DailyExport] Succeeded on retry attempt ${attempt}.`);
        break;
      }
      if (attempt < MAX_ATTEMPTS) {
        console.log(`[DailyExport] Attempt ${attempt}/${MAX_ATTEMPTS} failed — retrying in 15 minutes...`);
        await new Promise<void>(res => setTimeout(res, 15 * 60 * 1000));
      } else {
        console.error(`[DailyExport] All ${MAX_ATTEMPTS} attempts failed.`);
      }
    }
  } catch (err: any) {
    console.error("[DailyExport] checkAndRunScheduledDailyExport error:", err?.message || err);
  }
}

/**
 * Auto-post monthly rent accrual vouchers for every active rental contract
 * across all modules (ERP, FACTORY, PROPERTIES) and all companies.
 * Safe to run multiple times — already-accrued rows are skipped.
 */
async function runMonthlyRentalAccrual() {
  console.log("[RentalAccrual] Monthly auto-accrual started.");
  try {
    const { rows } = await pool.query<{ id: number }>("SELECT id FROM companies");
    const modules: Array<{ module: string; income: string; expense: string }> = [
      { module: "ERP",        income: "Rental Income - ERP",        expense: "Rent Expense - ERP Shops" },
      { module: "FACTORY",    income: "Rental Income - Factory",    expense: "Rent Expense - Factory Shops" },
      { module: "PROPERTIES", income: "Rental Income - Properties", expense: "Rent Expense - Property Shops" },
    ];

    let totalAccrued = 0;
    for (const { id: companyId } of rows) {
      for (const { module, income, expense } of modules) {
        try {
          await ensureMonthlyForCompany(companyId, module as any);
          const { accrued } = await postRentAccrualForCompany(companyId, expense, module, income);
          totalAccrued += accrued;
        } catch (err: any) {
          console.error(`[RentalAccrual] company=${companyId} module=${module}: ${err?.message}`);
        }
      }
    }
    console.log(`[RentalAccrual] Monthly auto-accrual complete — ${totalAccrued} rows accrued.`);
  } catch (err: any) {
    console.error("[RentalAccrual] Fatal error:", err?.message);
  }
}

export function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Run on the 1st of every month at 7:00 AM EST — send net-position Excel via WhatsApp
  cron.schedule("0 7 1 * *", async () => {
    await runMonthlyWhatsAppNetPosition();
  }, {
    timezone: "America/New_York",
  });

  // Run on the 2nd of every month at 6:00 AM EST — auto-post rent accrual vouchers
  cron.schedule("0 6 2 * *", async () => {
    await runMonthlyRentalAccrual();
  }, {
    timezone: "America/New_York",
  });

  // Every hour: check stock report, net position export, AND the configurable daily export.
  // The daily export fires when the current local hour (in the stored timezone) matches
  // the stored schedule_hour — this replaces the old hardcoded 6 PM EST cron.
  cron.schedule("0 * * * *", async () => {
    await checkAndRunStockReport();
    await checkAndRunNetPositionExport();
    await checkAndRunScheduledDailyExport();
    await checkAndRunContainersWhatsApp();
  }, {
    timezone: "America/New_York",
  });

  // Overdue customer payment reminder — runs every day at 9:00 AM EST
  cron.schedule("0 9 * * *", async () => {
    console.log("[OverdueCheck] 9 AM cron fired.");
    await checkOverdueCustomers();
  }, {
    timezone: "America/New_York",
  });

  // Purge soft-deleted items older than 30 days — runs daily at 2:00 AM EST
  cron.schedule("0 2 * * *", async () => {
    console.log("[Purge] 30-day soft-delete purge started.");
    await purgeOldSoftDeletes();
  }, {
    timezone: "America/New_York",
  });

  // Container auto-tracking — runs every 6 hours (00:00, 06:00, 12:00, 18:00 EST)
  cron.schedule("0 */6 * * *", async () => {
    console.log("[ContainerTracking] 6-hour auto-tracking cron fired.");
    try {
      const { trackDueContainers } = await import("./containerTrackingService");
      await trackDueContainers();
    } catch (err: any) {
      console.error("[ContainerTracking] Cron error:", err?.message);
    }
    try {
      const { trackDueFactoryContainers } = await import("./factoryContainerTrackingService");
      await trackDueFactoryContainers();
    } catch (err: any) {
      console.error("[FactoryTracking] Cron error:", err?.message);
    }
  }, {
    timezone: "America/New_York",
  });

  console.log("[ContainerTracking] Auto-tracking scheduler started — runs every 6 hours (00:00, 06:00, 12:00, 18:00 EST).");
  console.log("[DailyExport] Scheduler started — time-configurable via export settings (checked every hour).");
  console.log("[WhatsApp] Monthly net-position scheduler started — runs on the 1st of each month at 7:00 AM EST.");
  console.log("[RentalAccrual] Monthly auto-accrual scheduler started — runs on the 2nd of each month at 6:00 AM EST.");
  console.log("[StockReport] Independent scheduler started — checks every hour.");
  console.log("[NetPositionExport] Scheduled export checker started — checks every hour.");
  console.log("[OverdueCheck] Payment reminder scheduler started — runs daily at 9:00 AM EST.");
  console.log("[Purge] 30-day soft-delete purge scheduler started — runs daily at 2:00 AM EST.");
}

/**
 * Permanently delete all soft-deleted records older than 30 days.
 * Handles FK dependencies in the correct order.
 */
async function purgeOldSoftDeletes(): Promise<void> {
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
      const ids = oldStockItems.rows.map(r => r.id);
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
      await client.query(`DELETE FROM stock_group_location_archive_items WHERE stock_item_id IN (${placeholders})`, ids);
      await client.query(`DELETE FROM stock_item_code_aliases           WHERE stock_item_id IN (${placeholders})`, ids);
      await client.query(`DELETE FROM stock_item_location_prices        WHERE stock_item_id IN (${placeholders})`, ids);
      await client.query(`DELETE FROM stock_items WHERE id IN (${placeholders})`, ids);
      console.log(`[Purge] Permanently deleted ${ids.length} stock item(s) older than 30 days.`);
    }

    // ── Simple tables with no FK children referencing them ──────────────────
    const simplePurges: Array<{ table: string; col: string }> = [
      { table: "stock_groups",                   col: "deleted_at" },
      { table: "locations",                      col: "deleted_at" },
      { table: "ledger_accounts",                col: "deleted_at" },
      { table: "employees",                      col: "deleted_at" },
      { table: "customers",                      col: "deleted_at" },
      { table: "suppliers",                      col: "deleted_at" },
      { table: "bank_accounts",                  col: "deleted_at" },
      { table: "factory_categories",             col: "deleted_at" },
      { table: "factory_bale_products",          col: "deleted_at" },
      { table: "factory_containers",             col: "deleted_at" },
      { table: "factory_raw_stock",              col: "deleted_at" },
      { table: "factory_raw_material_adjustments", col: "deleted_at" },
      { table: "factory_mix_batches",            col: "deleted_at" },
      { table: "factory_bales",                  col: "deleted_at" },
      { table: "customer_proformas",             col: "deleted_at" },
      { table: "customer_orders",                col: "deleted_at" },
    ];

    for (const { table, col } of simplePurges) {
      const result = await client.query(
        `DELETE FROM ${table} WHERE ${col} IS NOT NULL AND ${col} < $1`,
        [cutoff]
      );
      if (result.rowCount && result.rowCount > 0) {
        console.log(`[Purge] Permanently deleted ${result.rowCount} ${table} row(s) older than 30 days.`);
      }
    }

    await client.query("COMMIT");
    console.log("[Purge] 30-day soft-delete purge complete.");
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[Purge] Error during soft-delete purge (rolled back):", err.message);
  } finally {
    client.release();
  }
}

// ── Containers WhatsApp scheduled send ────────────────────────────────────────

async function checkAndRunContainersWhatsApp(): Promise<void> {
  try {
    const { getContainersWaSettings, sendWhatsAppFileToChatId, markContainersWaSent } = await import("./whatsappService");
    const settings = await getContainersWaSettings();

    if (!settings?.scheduleEnabled || !settings?.groupChatId) return;
    if (!settings?.instanceId || !settings?.apiToken || !settings?.enabled) return;

    const nowHour = new Date().getHours();
    if (nowHour !== settings.scheduleHour) return;

    // Skip if already sent within the last 12 hours
    if (settings.lastSentAt) {
      const hoursSince = (Date.now() - new Date(settings.lastSentAt).getTime()) / (1000 * 60 * 60);
      if (hoursSince < 12) {
        console.log("[ContainersWA] Already sent within 12 h — skipping.");
        return;
      }
    }

    console.log("[ContainersWA] Scheduled send triggered.");
    const { generateContainersPdf } = await import("../helpers/generateContainersPdf");
    const { buffer, rowCount } = await generateContainersPdf();

    const today    = new Date().toISOString().substring(0, 10);
    const caption  = "";
    const fileName = `Containers_${today}.pdf`;

    const result = await sendWhatsAppFileToChatId(
      settings.groupChatId, buffer, fileName, caption, "application/pdf",
    );

    if (result.success) {
      await markContainersWaSent();
      console.log(`[ContainersWA] PDF sent to ${settings.groupChatId} — ${rowCount} containers.`);
    } else {
      console.error("[ContainersWA] Scheduled send failed:", result.error);
    }
  } catch (err: any) {
    console.error("[ContainersWA] Error:", err?.message);
  }
}

/** Manually trigger the daily ZIP → WhatsApp send (bypasses the dailyAutoSend schedule toggle).
 *  Pass fromDate / toDate (YYYY-MM-DD) to scope the export; omit for full history.
 *  Retries up to 3 times (30 s between attempts) on actual send failures.
 *  Records the attempt in daily_export_runs.
 *  Throws an Error with a human-readable message if WhatsApp is not configured or the send fails.
 */
export async function triggerDailyWhatsAppSendNow(
  fromDate?: string,
  toDate?: string,
): Promise<{ message: string }> {
  const runId = await createExportRun("manual_whatsapp");
  console.log(`[ManualWhatsApp] Run id=${runId} started.`);

  const companies = await fetchAllCompanies();
  if (!companies || companies.length === 0) {
    await finishExportRun(runId, { status: "failed", skippedReason: "No companies found." });
    throw new Error("No companies found.");
  }

  const today = getTodayLabel();
  let zip: Buffer, names: string[], skipped: string[];
  try {
    ({ zip, names, skipped } = await buildFullExportZip(companies, fromDate, toDate));
  } catch (err: any) {
    await finishExportRun(runId, { status: "failed", skippedReason: err.message });
    throw err;
  }

  await updateExportRun(runId, {
    companiesCount:    companies.length,
    companyFilesCount: names.length,
    zipSizeBytes:      zip.length,
    skippedCompanies:  skipped.join(", ") || null,
    whatsappAttempted: true,
  });

  const rangeLabel  = (fromDate || toDate) ? ` (${fromDate || "start"} → ${toDate || "today"})` : " (full history)";
  const skippedNote = skipped.length > 0 ? ` (${skipped.length} skipped)` : "";

  // Retry up to 3× with 30-second delays (manual trigger is interactive — shorter delay)
  const waRes = await retryAsync({
    label:       "ManualWhatsApp",
    attempts:    3,
    delayMs:     30 * 1000,
    fn:          () => runDailyWhatsAppSend(zip, today, companies, { bypassAutoSendCheck: true }),
    isSuccess:   r => r.sent,
    shouldRetry: r => !r.skipped && (!r.error || !isWaConfigError(r.error)),
    onAttempt:   n => console.log(`[ManualWhatsApp] Attempt ${n}/3...`),
  });

  const result = waRes.result;

  if (result.skipped) {
    await finishExportRun(runId, {
      status:           "failed",
      whatsappSuccess:  false,
      whatsappError:    result.skipReason,
      whatsappAttempts: waRes.attempts,
    });
    throw new Error(
      `WhatsApp not configured or not ready: ${result.skipReason}. ` +
      `Please enable WhatsApp and select a Daily Export recipient in WhatsApp settings.`,
    );
  }

  if (!result.sent) {
    await finishExportRun(runId, {
      status:           "failed",
      whatsappSuccess:  false,
      whatsappError:    result.error || "Unknown error",
      whatsappAttempts: waRes.attempts,
    });
    throw new Error(`WhatsApp send failed after ${waRes.attempts} attempt(s): ${result.error || "Unknown error"}`);
  }

  await finishExportRun(runId, {
    status:           "success",
    whatsappSuccess:  true,
    whatsappAttempts: waRes.attempts,
  });

  console.log(`[ManualWhatsApp] Run ${runId} succeeded (attempt ${waRes.attempts}).`);
  return { message: `Daily ZIP sent to WhatsApp — ${names.length} companies${rangeLabel}${skippedNote}.` };
}

export { runDailyExport };
