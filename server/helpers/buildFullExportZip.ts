import archiver from "archiver";
import { fetchCompanyExportData } from "../services/exportDataService";
import { buildCompanyWorkbook } from "../services/exportExcelService";
import { generateAllCompaniesNetPositionExcel } from "./generateAllCompaniesNetPositionExcel";

export interface ExportZipResult {
  zip:     Buffer;
  names:   string[];
  skipped: string[];
}

/**
 * Builds the canonical full-company export ZIP.
 * Includes one Excel workbook per company (all accounts, ledger, vouchers, etc.)
 * PLUS the all-companies Net Position Excel for the current year.
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
  const year      = new Date().getUTCFullYear();
  const npStart   = `${year}-01-01`;
  const npEnd     = dateLabel;

  const xlsxBuffers: { name: string; buf: Buffer }[] = [];
  const names:   string[] = [];
  const skipped: string[] = [];

  for (const company of companies) {
    try {
      log(`[${company.name}] Querying all data...`, "info");
      const data = await fetchCompanyExportData(company.id, fromDate, toDate);

      log(`[${company.name}] Building Excel workbook...`, "info");
      const raw     = await buildCompanyWorkbook(data);
      const buf     = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const safeName = company.name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      xlsxBuffers.push({ name: safeName, buf });
      names.push(company.name);
      log(`[${company.name}] workbook ready (${(buf.length / 1024).toFixed(0)} KB)`, "success");
    } catch (err: any) {
      log(`[${company.name}] Failed: ${err?.message || err}`, "error");
      skipped.push(company.name);
    }
  }

  // Net Position Excel (full current year, all companies combined)
  let npBuf: Buffer | null = null;
  try {
    log("Building Net Position Excel (all companies, YTD)...", "info");
    const raw = await generateAllCompaniesNetPositionExcel(companies, npStart, npEnd);
    npBuf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    log(`Net Position Excel ready (${(npBuf.length / 1024).toFixed(0)} KB)`, "success");
  } catch (err: any) {
    log(`Net Position Excel failed: ${err?.message || err}`, "warning");
  }

  const zip = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const arc = archiver("zip", { zlib: { level: 6 } });
    arc.on("data",  (c: Buffer) => chunks.push(c));
    arc.on("end",   () => resolve(Buffer.concat(chunks)));
    arc.on("error", reject);

    for (const { name, buf } of xlsxBuffers) {
      arc.append(buf, { name: `${name}_Export_${dateLabel}.xlsx` });
    }
    if (npBuf) {
      arc.append(npBuf, { name: `NetPosition_AllCompanies_${year}.xlsx` });
    }
    arc.finalize();
  });

  log(`ZIP ready — ${(zip.length / 1024 / 1024).toFixed(1)} MB (${names.length} companies, ${skipped.length} skipped)`, "success");
  return { zip, names, skipped };
}
