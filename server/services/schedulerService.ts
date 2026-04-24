import cron from "node-cron";
import archiver from "archiver";
import { fetchAllCompanies } from "./exportDataService";
import { sendExportEmail } from "./emailService";
import { pool } from "../db";
import { getWaSettings, getActiveRecipients, sendWhatsAppFile, sendWhatsAppFileToChatId } from "./whatsappService";
import { generateNetPositionExcel } from "../helpers/generateNetPositionExcel";
import { generateStockPdf } from "../helpers/generateStockPdf";
import { storage } from "../storage";
import { buildFullExportZip } from "../helpers/buildFullExportZip";

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
      try {
        const buf  = await generateNetPositionExcel(company.id, company.name, startDate, endDate);
        const safe = company.name.replace(/[^a-z0-9]/gi, "_");
        arc.append(Buffer.isBuffer(buf) ? buf : Buffer.from(buf), {
          name: `NetPosition_${safe}_${endDate}.xlsx`,
        });
        console.log(`[NetPositionExport] Added ${company.name}`);
      } catch (e: any) {
        console.error(`[NetPositionExport] Failed for ${company.name}:`, e.message);
      }
    }

    arc.finalize();
  });
}

async function runDailyExport(retryCount = 0): Promise<void> {
  const MAX_RETRIES = 3;
  console.log(`[DailyExport] Starting daily export (attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`);

  try {
    const companies = await fetchAllCompanies();
    if (!companies || companies.length === 0) {
      console.log("[DailyExport] No companies found — skipping export.");
      return;
    }

    const today = getTodayLabel();
    // Use full history (no date filter) so the export is never empty
    console.log(`[DailyExport] Building full-history export for ${companies.length} company/companies (label: ${today})`);

    // buildFullExportZip throws if the ZIP would be empty (all companies failed)
    const { zip, names, skipped } = await buildFullExportZip(companies, undefined, undefined);

    if (skipped.length > 0) {
      console.warn(`[DailyExport] Skipped ${skipped.length} companies: ${skipped.join(", ")}`);
    }

    // Only send via WhatsApp and email once we have confirmed the ZIP is non-empty
    await runDailyWhatsAppSend(zip, today, companies);

    const result = await sendExportEmail(zip, today, names);

    if (result.success) {
      console.log(`[DailyExport] Export emailed successfully for ${names.length} companies.`);
      await pool.query(`UPDATE export_settings SET last_run_at = now() WHERE id = 1`).catch(() => {});
    } else {
      console.error(`[DailyExport] Email failed: ${result.error}`);
      if (retryCount < MAX_RETRIES) {
        console.log(`[DailyExport] Retrying in 10 minutes...`);
        setTimeout(() => runDailyExport(retryCount + 1), 10 * 60 * 1000);
      } else {
        console.error(`[DailyExport] All ${MAX_RETRIES + 1} attempts failed. Giving up until next scheduled run.`);
      }
    }

  } catch (err: any) {
    console.error(`[DailyExport] Unexpected error:`, err?.stack || err?.message || err);
    if (retryCount < MAX_RETRIES) {
      console.log(`[DailyExport] Retrying in 10 minutes...`);
      setTimeout(() => runDailyExport(retryCount + 1), 10 * 60 * 1000);
    }
  }
}

// ─── Daily WhatsApp send (6 PM) ───────────────────────────────────────────────

async function runDailyWhatsAppSend(
  dailyZip: Buffer,
  dateLabel: string,
  companies: { id: number; name: string }[],
): Promise<void> {
  try {
    const settings = await getWaSettings();
    if (!settings?.enabled) {
      console.log("[WhatsApp] WhatsApp is disabled — skipping daily ZIP send.");
      return;
    }
    if (!settings?.dailyAutoSend) {
      console.log("[WhatsApp] Daily auto-send toggle is off — skipping.");
      return;
    }

    // Resolve the configured daily export recipient
    const recipientId = settings.dailyRecipientId;
    if (!recipientId) {
      console.log("[WhatsApp] No daily export WhatsApp group configured — skipping daily ZIP send.");
      return;
    }

    const rRow = await pool.query(
      "SELECT chat_id FROM whatsapp_recipients WHERE id = $1 AND active = true",
      [recipientId],
    );
    if (!rRow.rows.length) {
      console.log(`[WhatsApp] Daily export recipient id=${recipientId} not found or inactive — skipping.`);
      return;
    }

    const chatId      = rRow.rows[0].chat_id as string;
    const zipFileName = `DailyExport_${dateLabel}.zip`;
    const zipCaption  = `Daily Company Export — ${dateLabel}\nAll companies included.`;
    console.log(`[WhatsApp] Sending daily export ZIP to ${chatId}…`);
    const zipRes = await sendWhatsAppFileToChatId(chatId, dailyZip, zipFileName, zipCaption, "application/zip");
    console.log(`[WhatsApp] Daily ZIP: ${zipRes.success ? "sent" : zipRes.error}`);

    console.log("[WhatsApp] Daily WhatsApp send complete.");
  } catch (err: any) {
    console.error("[WhatsApp] Daily send error:", err?.message || err);
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
    const pdfBuf  = await generateStockPdf(row.company_id, company.name);
    const pdfName = `Stock_${company.name.replace(/[^a-z0-9]/gi, "_")}_${today}.pdf`;
    const pdfCap  = `Stock Inventory with Cost — ${company.name}\nAs of ${today}`;
    const pdfRes  = await sendWhatsAppFileToChatId(chatId, pdfBuf, pdfName, pdfCap, "application/pdf");
    console.log(`[StockReport] PDF: ${pdfRes.success ? "sent" : pdfRes.error}`);

    // 2. Net Position Excel (Jan 1 → today)
    const xlsBuf  = await generateNetPositionExcel(row.company_id, company.name, yearStart, today);
    const xlsName = `NetPosition_${company.name.replace(/[^a-z0-9]/gi, "_")}_${today}.xlsx`;
    const xlsCap  = `Net Position — ${company.name}\nPeriod: ${yearStart} → ${today}`;
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
            `Net Position Report — All Companies\nPeriod: ${npStart} → ${npEnd}`,
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
        const caption  = `Monthly Net Position Report — ${company.name}\nPeriod: ${startDate} → ${endDate}`;
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

export function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Run at 6:00 PM EST (America/New_York) every day
  cron.schedule("0 18 * * *", async () => {
    const emailEnabled = await isScheduleEnabled();

    if (emailEnabled) {
      // Full export: builds ZIP (full history), emails it, then sends via WhatsApp
      await runDailyExport();
    } else {
      // Email export is off — still run WhatsApp daily send independently
      console.log("[DailyExport] Email schedule is disabled — skipping email, running WhatsApp send only.");
      try {
        const companies = await fetchAllCompanies();
        if (!companies?.length) {
          console.log("[DailyExport] No companies — WhatsApp send skipped.");
          return;
        }
        const today = getTodayLabel();
        // buildFullExportZip throws if ZIP would be empty — no empty send possible
        const { zip, names } = await buildFullExportZip(companies, undefined, undefined);
        if (names.length === 0) {
          console.log("[DailyExport] ZIP is empty after build — WhatsApp send skipped.");
          return;
        }
        await runDailyWhatsAppSend(zip, today, companies);
      } catch (err: any) {
        console.error("[DailyExport] WhatsApp-only 6 PM send failed:", err?.message || err);
      }
    }
  }, {
    timezone: "America/New_York",
  });

  // Run on the 1st of every month at 7:00 AM EST — send net-position Excel via WhatsApp
  cron.schedule("0 7 1 * *", async () => {
    await runMonthlyWhatsAppNetPosition();
  }, {
    timezone: "America/New_York",
  });

  // Stock + Net Position report — check every hour (minute 0) in EST
  cron.schedule("0 * * * *", async () => {
    await checkAndRunStockReport();
    await checkAndRunNetPositionExport();
  }, {
    timezone: "America/New_York",
  });

  console.log("[DailyExport] Scheduler started — will run daily at 6:00 PM EST.");
  console.log("[WhatsApp] Monthly net-position scheduler started — runs on the 1st of each month at 7:00 AM EST.");
  console.log("[StockReport] Independent scheduler started — checks every hour.");
  console.log("[NetPositionExport] Scheduled export checker started — checks every hour.");
}

/** Manually trigger the daily ZIP → WhatsApp send (bypasses schedule check).
 *  Pass fromDate / toDate (YYYY-MM-DD) to scope the export; omit for full history.
 */
export async function triggerDailyWhatsAppSendNow(
  fromDate?: string,
  toDate?: string,
): Promise<{ message: string }> {
  const companies = await fetchAllCompanies();
  if (!companies || companies.length === 0) {
    return { message: "No companies found." };
  }
  const today = getTodayLabel();
  // buildFullExportZip throws if ZIP would be empty — propagates to caller as error
  const { zip, names, skipped } = await buildFullExportZip(companies, fromDate, toDate);
  if (names.length === 0) {
    throw new Error("ZIP is empty — no companies exported successfully. WhatsApp send aborted.");
  }
  await runDailyWhatsAppSend(zip, today, companies);
  const rangeLabel = (fromDate || toDate)
    ? ` (${fromDate || "start"} → ${toDate || "today"})`
    : " (full history)";
  const skippedNote = skipped.length > 0 ? ` (${skipped.length} skipped)` : "";
  return { message: `Daily ZIP sent to WhatsApp — ${names.length} companies${rangeLabel}${skippedNote}.` };
}

export { runDailyExport };
