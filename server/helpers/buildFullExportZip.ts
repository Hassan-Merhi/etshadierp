import archiver from "archiver";
import { PassThrough } from "stream";
import { fetchCompanyExportData } from "../services/exportDataService";
import { buildCompanyWorkbook } from "../services/exportExcelService";

export interface ExportZipResult {
  zip:     Buffer;
  names:   string[];
  skipped: string[];
}

/**
 * Builds the canonical full-company export ZIP.
 * Includes one Excel workbook per company (all accounts, ledger, vouchers, etc.)
 *
 * Memory-safe approach: each company's workbook is streamed directly into the
 * archiver via a PassThrough — the full workbook buffer is never held in RAM.
 * Only one company is in flight at a time, so peak RAM usage is bounded to
 * roughly one workbook + the compressed ZIP output being accumulated.
 *
 * This is the single source of truth used by:
 *  - Manual "Export Now → Email / Download" (exportRoutes.ts)
 *  - Daily Auto-Send WhatsApp trigger (schedulerService.ts)
 *  - Scheduled 6 PM cron job
 */
export async function buildFullExportZip(
  companies: any[],
  fromDate?: string,
  toDate?:   string,
  onProgress?: (msg: string, level?: "info" | "success" | "warning" | "error") => void,
): Promise<ExportZipResult> {
  const log = onProgress ?? ((msg: string) => console.log(`[FullExport] ${msg}`));

  const dateLabel = new Date().toISOString().substring(0, 10);

  const names:   string[] = [];
  const skipped: string[] = [];

  // Start the archiver up front so we can stream into it company-by-company.
  const chunks: Buffer[] = [];
  const arc = archiver("zip", { zlib: { level: 6 } });
  arc.on("data",    (c: Buffer) => chunks.push(c));
  arc.on("warning", (e: any)   => console.warn("[FullExport] archiver warning:", e?.message || e));

  const zipPromise = new Promise<Buffer>((resolve, reject) => {
    arc.on("end",   () => resolve(Buffer.concat(chunks)));
    arc.on("error", reject);
  });

  for (const company of companies) {
    try {
      log(`[${company.name}] Querying all data...`, "info");
      const data = await fetchCompanyExportData(company.id, fromDate, toDate);

      log(`[${company.name}] Building Excel workbook...`, "info");

      const safeName = company.name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const entryName = `${safeName}_Export_${dateLabel}.xlsx`;

      // Create a PassThrough that bridges ExcelJS → archiver.
      // ExcelJS's wb.xlsx.write() ends the stream when it finishes writing.
      // Archiver processes this entry fully before moving on (sequential), so
      // at most one workbook's uncompressed data is in memory at once.
      const pass = new PassThrough();
      arc.append(pass, { name: entryName });

      await buildCompanyWorkbook(data, pass);
      // ExcelJS ends the stream internally; ensure it is closed in case it does not.
      if (!pass.destroyed) pass.end();

      names.push(company.name);
      log(`[${company.name}] workbook streamed into ZIP`, "success");
    } catch (err: any) {
      log(`[${company.name}] Failed: ${err?.message || err}`, "error");
      if (err?.stack) console.error(`[FullExport] Stack for ${company.name}:`, err.stack);
      skipped.push(company.name);
    }
  }

  if (names.length === 0) {
    // Abort the archiver cleanly before rejecting
    arc.abort();
    const msg = `Export aborted — all ${companies.length} company/companies failed to generate workbooks. ZIP would be empty. Check server logs for per-company errors.`;
    log(msg, "error");
    throw new Error(msg);
  }

  arc.finalize();
  const zip = await zipPromise;

  log(`ZIP ready — ${(zip.length / 1024 / 1024).toFixed(1)} MB (${names.length} companies, ${skipped.length} skipped)`, "success");
  return { zip, names, skipped };
}
