import cron from "node-cron";
import archiver from "archiver";
import { fetchAllCompanies, fetchCompanyExportData } from "./exportDataService";
import { buildCompanyWorkbook } from "./exportExcelService";
import { sendExportEmail } from "./emailService";
import { pool } from "../db";

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
  } catch (err: any) {
    console.error(`[DailyExport] Unexpected error:`, err?.stack || err?.message || err);
    if (retryCount < MAX_RETRIES) {
      console.log(`[DailyExport] Retrying in 10 minutes...`);
      setTimeout(() => runDailyExport(retryCount + 1), 10 * 60 * 1000);
    }
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

  console.log("[DailyExport] Scheduler started — will run daily at 6:00 PM EST.");
}

export { runDailyExport, buildZipBuffer };
