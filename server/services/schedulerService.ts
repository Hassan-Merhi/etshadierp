import cron from "node-cron";
import archiver from "archiver";
import { fetchAllCompanies, fetchCompanyExportData } from "./exportDataService";
import { buildCompanyWorkbook } from "./exportExcelService";
import { sendExportEmail } from "./emailService";
import { pool } from "../db";
import { getWaSettings, getActiveRecipients, sendWhatsAppFile, sendWhatsAppFileToChatId } from "./whatsappService";
import { generateNetPositionExcel } from "../helpers/generateNetPositionExcel";
import { generateAllCompaniesNetPositionExcel } from "../helpers/generateAllCompaniesNetPositionExcel";
import { generateStockPdf } from "../helpers/generateStockPdf";
import { storage } from "../storage";

let schedulerStarted = false;

function getYesterdayRange(): { fromDate: string; toDate: string } {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const toStr = (d: Date) => d.toISOString().substring(0, 10);
  return { fromDate: toStr(yesterday), toDate: toStr(yesterday) };
}

async function buildZipBuffer(
  companies: any[],
  fromDate: string,
  toDate: string
): Promise<{ zip: Buffer; names: string[]; skipped: string[] }> {
  return new Promise(async (resolve, reject) => {
    const chunks: Buffer[] = [];
    const names: string[] = [];
    const skipped: string[] = [];
    const arc = archiver("zip", { zlib: { level: 6 } });
    arc.on("data", (chunk: Buffer) => chunks.push(chunk));
    arc.on("end", () => resolve({ zip: Buffer.concat(chunks), names, skipped }));
    arc.on("error", reject);

    const dateLabel = toDate;

    for (const company of companies) {
      try {
        console.log(`[DailyExport] Building workbook for company ${company.id} (${company.name}), range ${fromDate}→${toDate}...`);
        const data = await fetchCompanyExportData(company.id, fromDate, toDate);
        const rawBuf = await buildCompanyWorkbook(data);
        // Ensure we pass a proper Node.js Buffer (not Uint8Array) to archiver
        const xlsxBuf = Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf);
        const safeName = company.name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
        const filename = `${safeName}_Export_${dateLabel}.xlsx`;
        arc.append(xlsxBuf, { name: filename });
        names.push(company.name);
        console.log(`[DailyExport] Workbook ready for ${company.name} (${(xlsxBuf.length / 1024).toFixed(0)} KB)`);
      } catch (err: any) {
        console.error(`[DailyExport] Failed for company ${company.id} (${company.name}):`, err?.stack || err?.message || err);
        skipped.push(company.name);
      }
    }

    // Include all-companies net position Excel (full current year) in the ZIP
    try {
      const year    = new Date().getUTCFullYear();
      const npStart = `${year}-01-01`;
      const npEnd   = `${year}-12-31`;
      console.log(`[DailyExport] Adding all-companies net-position Excel (${npStart}→${npEnd}) to ZIP…`);
      const npBuf  = await generateAllCompaniesNetPositionExcel(companies, npStart, npEnd);
      const ensured = Buffer.isBuffer(npBuf) ? npBuf : Buffer.from(npBuf);
      arc.append(ensured, { name: `NetPosition_AllCompanies_${year}.xlsx` });
      console.log(`[DailyExport] Net Position Excel added (${(ensured.length / 1024).toFixed(0)} KB)`);
    } catch (npErr: any) {
      console.error(`[DailyExport] Failed to build net-position Excel:`, npErr?.message || npErr);
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

    const { fromDate, toDate } = getYesterdayRange();
    console.log(`[DailyExport] Date range: ${fromDate} → ${toDate} for ${companies.length} company/companies`);

    const { zip, names, skipped } = await buildZipBuffer(companies, fromDate, toDate);

    if (names.length === 0) {
      console.error(`[DailyExport] All ${companies.length} companies failed — nothing to send.`);
      if (retryCount < MAX_RETRIES) {
        console.log(`[DailyExport] Retrying in 10 minutes...`);
        setTimeout(() => runDailyExport(retryCount + 1), 10 * 60 * 1000);
      }
      return;
    }

    if (skipped.length > 0) {
      console.warn(`[DailyExport] Skipped ${skipped.length} companies: ${skipped.join(", ")}`);
    }

    const result = await sendExportEmail(zip, toDate, names);

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

    // WhatsApp daily send — independent of email success
    await runDailyWhatsAppSend(zip, toDate, companies);

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
  const today = new Date().toISOString().split("T")[0];
  try {
    const settings = await getWaSettings();
    if (!settings?.enabled || !settings?.dailyAutoSend) {
      console.log("[WhatsApp] Daily auto-send is disabled — skipping.");
    } else {
      // Resolve the configured daily export recipient
      const recipientId = settings.dailyRecipientId;
      if (!recipientId) {
        console.log("[WhatsApp] No daily export WhatsApp group configured — skipping daily ZIP send.");
      } else {
        const rRow = await pool.query(
          "SELECT chat_id FROM whatsapp_recipients WHERE id = $1 AND active = true",
          [recipientId],
        );
        if (!rRow.rows.length) {
          console.log(`[WhatsApp] Daily export recipient id=${recipientId} not found or inactive — skipping.`);
        } else {
          const chatId      = rRow.rows[0].chat_id as string;
          const zipFileName = `DailyExport_${dateLabel}.zip`;
          const zipCaption  = `Daily Company Export — ${dateLabel}\nAll companies included + Net Position (YTD).`;
          console.log(`[WhatsApp] Sending daily export ZIP to ${chatId}…`);
          const zipRes = await sendWhatsAppFileToChatId(chatId, dailyZip, zipFileName, zipCaption, "application/zip");
          console.log(`[WhatsApp] Daily ZIP: ${zipRes.success ? "sent" : zipRes.error}`);
        }
      }
    }

    // Stock report — sends to its own specific group if configured
    await runStockReportSend(today);

    console.log("[WhatsApp] Daily WhatsApp send complete.");
  } catch (err: any) {
    console.error("[WhatsApp] Daily send error:", err?.message || err);
  }
}

async function runStockReportSend(today: string): Promise<void> {
  try {
    const r = await pool.query(
      `SELECT company_id, recipient_id, auto_send, enabled
       FROM whatsapp_stock_settings WHERE id = 1`,
    );
    if (!r.rows.length) return;
    const cfg = r.rows[0];
    if (!cfg.enabled || !cfg.auto_send) {
      console.log("[WhatsApp] Stock report auto-send is disabled — skipping.");
      return;
    }
    if (!cfg.company_id || !cfg.recipient_id) {
      console.log("[WhatsApp] Stock report: no company or recipient configured — skipping.");
      return;
    }

    const recipResult = await pool.query(
      "SELECT chat_id FROM whatsapp_recipients WHERE id = $1 AND active = true",
      [cfg.recipient_id],
    );
    if (!recipResult.rows.length) {
      console.log("[WhatsApp] Stock report: recipient not found or inactive — skipping.");
      return;
    }
    const chatId = recipResult.rows[0].chat_id as string;

    const allCompanies = await storage.getAllCompanies();
    const company      = (allCompanies as any[]).find((c) => c.id === cfg.company_id);
    if (!company) {
      console.log(`[WhatsApp] Stock report: company ${cfg.company_id} not found — skipping.`);
      return;
    }

    const yearStart = `${new Date().getUTCFullYear()}-01-01`;

    console.log(`[WhatsApp] Stock report: generating PDF for ${company.name}…`);
    const pdfBuf  = await generateStockPdf(cfg.company_id, company.name);
    const pdfName = `Stock_${company.name.replace(/[^a-z0-9]/gi, "_")}_${today}.pdf`;
    const pdfCap  = `Stock Inventory with Cost — ${company.name}\nAs of ${today}`;
    const pdfRes  = await sendWhatsAppFileToChatId(chatId, pdfBuf, pdfName, pdfCap, "application/pdf");
    console.log(`[WhatsApp] Stock PDF: ${pdfRes.success ? "sent" : pdfRes.error}`);

    console.log(`[WhatsApp] Stock report: generating net-position Excel for ${company.name} (${yearStart}→${today})…`);
    const xlsBuf  = await generateNetPositionExcel(cfg.company_id, company.name, yearStart, today);
    const xlsName = `NetPosition_${company.name.replace(/[^a-z0-9]/gi, "_")}_${today}.xlsx`;
    const xlsCap  = `Net Position Report — ${company.name}\nPeriod: ${yearStart} → ${today}`;
    const xlsRes  = await sendWhatsAppFileToChatId(
      chatId, xlsBuf, xlsName, xlsCap,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    console.log(`[WhatsApp] Net Position Excel (stock config): ${xlsRes.success ? "sent" : xlsRes.error}`);
  } catch (err: any) {
    console.error("[WhatsApp] Stock report send error:", err?.message || err);
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
    const endDate   = new Date().toISOString().split("T")[0];
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
    const enabled = await isScheduleEnabled();
    if (!enabled) {
      console.log("[DailyExport] Schedule is disabled — skipping.");
      return;
    }
    await runDailyExport();
  }, {
    timezone: "America/New_York",
  });

  // Run on the 1st of every month at 7:00 AM EST — send net-position Excel via WhatsApp
  cron.schedule("0 7 1 * *", async () => {
    await runMonthlyWhatsAppNetPosition();
  }, {
    timezone: "America/New_York",
  });

  console.log("[DailyExport] Scheduler started — will run daily at 6:00 PM EST.");
  console.log("[WhatsApp] Monthly net-position scheduler started — runs on the 1st of each month at 7:00 AM EST.");
}

export { runDailyExport, buildZipBuffer };
