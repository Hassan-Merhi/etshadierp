import cron from "node-cron";
import archiver from "archiver";
import { fetchAllCompanies, fetchCompanyExportData } from "./exportDataService";
import { buildCompanyWorkbook } from "./exportExcelService";
import { sendExportEmail } from "./emailService";
import { pool } from "../db";
import { getWaSettings, getActiveRecipients, sendWhatsAppFile } from "./whatsappService";
import { generateNetPositionExcel } from "../helpers/generateNetPositionExcel";
import { generateAllCompaniesNetPositionExcel } from "../helpers/generateAllCompaniesNetPositionExcel";
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
  try {
    const settings = await getWaSettings();
    if (!settings?.enabled || !settings?.dailyAutoSend) {
      console.log("[WhatsApp] Daily auto-send is disabled — skipping.");
      return;
    }
    const recipients = await getActiveRecipients();
    if (!recipients.length) {
      console.log("[WhatsApp] No active recipients — skipping daily WhatsApp send.");
      return;
    }

    console.log("[WhatsApp] Starting daily send — data ZIP + net-position Excel…");

    // 1. Send daily export ZIP
    const zipFileName = `DailyExport_${dateLabel}.zip`;
    const zipCaption  = `Daily Company Export — ${dateLabel}\nAll companies included.`;
    const zipResult   = await sendWhatsAppFile(dailyZip, zipFileName, zipCaption);
    console.log(`[WhatsApp] Daily ZIP: sent=${zipResult.sent} failed=${zipResult.failed}`);

    // 2. Build + send all-companies net position Excel (current year)
    const today     = new Date();
    const year      = today.getUTCFullYear();
    const npStart   = `${year}-01-01`;
    const npEnd     = `${year}-12-31`;
    console.log(`[WhatsApp] Generating all-companies net-position Excel (${npStart} → ${npEnd})…`);
    const npBuffer   = await generateAllCompaniesNetPositionExcel(companies, npStart, npEnd);
    const npFileName = `NetPosition_AllCompanies_${year}.xlsx`;
    const npCaption  = `Net Position Report — All Companies\nYear: ${year}`;
    const npResult   = await sendWhatsAppFile(npBuffer, npFileName, npCaption);
    console.log(`[WhatsApp] Net Position Excel: sent=${npResult.sent} failed=${npResult.failed}`);

    console.log("[WhatsApp] Daily WhatsApp send complete.");
  } catch (err: any) {
    console.error("[WhatsApp] Daily send error:", err?.message || err);
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
