import cron from "node-cron";
import archiver from "archiver";
import { fetchAllCompanies, fetchCompanyExportData } from "./exportDataService";
import { buildCompanyWorkbook } from "./exportExcelService";
import { sendExportEmail } from "./emailService";
import { pool } from "../db";

let schedulerStarted = false;

async function buildZipBuffer(companies: any[]): Promise<{ zip: Buffer; names: string[] }> {
  return new Promise(async (resolve, reject) => {
    const chunks: Buffer[] = [];
    const arc = archiver("zip", { zlib: { level: 6 } });
    arc.on("data", (chunk: Buffer) => chunks.push(chunk));
    arc.on("end", () => resolve({ zip: Buffer.concat(chunks), names: companies.map(c => c.name) }));
    arc.on("error", reject);

    const dateLabel = new Date().toISOString().substring(0, 10);

    for (const company of companies) {
      try {
        const data = await fetchCompanyExportData(company.id);
        const xlsxBuf = await buildCompanyWorkbook(data);
        const safeName = company.name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
        const filename = `${safeName}_Export_${dateLabel}.xlsx`;
        arc.append(xlsxBuf as any, { name: filename });
      } catch (err: any) {
        console.error(`[DailyExport] Failed to generate workbook for company ${company.id}:`, err.message);
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

    const dateLabel = new Date().toISOString().substring(0, 10);
    const { zip, names } = await buildZipBuffer(companies);
    const result = await sendExportEmail(zip, dateLabel, names);

    if (result.success) {
      console.log(`[DailyExport] Export emailed successfully for ${names.length} companies.`);
      await pool.query(`UPDATE export_settings SET last_run_at = now() WHERE id = 1`).catch(() => {});
    } else {
      console.error(`[DailyExport] Email failed: ${result.error}`);
      if (retryCount < MAX_RETRIES) {
        const delayMs = 10 * 60 * 1000;
        console.log(`[DailyExport] Retrying in 10 minutes...`);
        setTimeout(() => runDailyExport(retryCount + 1), delayMs);
      } else {
        console.error(`[DailyExport] All ${MAX_RETRIES + 1} attempts failed. Giving up until next scheduled run.`);
      }
    }
  } catch (err: any) {
    console.error(`[DailyExport] Unexpected error:`, err.message);
    if (retryCount < MAX_RETRIES) {
      const delayMs = 10 * 60 * 1000;
      console.log(`[DailyExport] Retrying in 10 minutes...`);
      setTimeout(() => runDailyExport(retryCount + 1), delayMs);
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
