import archiver from "archiver";
import { streamCompanyWorkbookDirect } from "../services/exportExcelService";
import { logger } from "../lib/logger";

export interface ExportZipResult {
  zip: Buffer;
  names: string[];
  skipped: string[];
}

/**
 * Builds the canonical full-company export ZIP.
 * Includes one Excel workbook per company (all accounts, ledger, vouchers, etc.)
 *
 * Memory-safe approach: each company's data is fetched one sheet at a time
 * and streamed directly into the archiver via a PassThrough — no dataset is
 * held in RAM while the next is fetched. Peak RAM is bounded to roughly one
 * sheet's worth of raw rows + the ExcelJS workbook being built (instead of
 * ALL table data + workbook simultaneously, which caused OOM crashes).
 *
 * This is the single source of truth used by:
 *  - Manual "Export Now → Email / Download" (exportRoutes.ts)
 *  - Daily Auto-Send WhatsApp trigger (schedulerService.ts)
 *  - Scheduled 6 PM cron job
 */
export async function buildFullExportZip(
  companies: any[],
  fromDate?: string,
  toDate?: string,
  onProgress?: (msg: string, level?: "info" | "success" | "warning" | "error") => void
): Promise<ExportZipResult> {
  const log =
    onProgress ??
    ((message: string, level: "info" | "success" | "warning" | "error" = "info") => {
      const context = { module: "full-export", action: "build-zip" };
      if (level === "error") logger.error(message, context);
      else if (level === "warning") logger.warn(message, context);
      else logger.info(message, context);
    });

  const dateLabel = new Date().toISOString().substring(0, 10);
  const names: string[] = [];
  const skipped: string[] = [];

  // Start the archiver up front so we can stream into it company-by-company.
  const chunks: Buffer[] = [];
  const arc = archiver("zip", { zlib: { level: 6 } });
  arc.on("data", (chunk: Buffer) => chunks.push(chunk));
  arc.on("warning", (error: unknown) => {
    logger.warn("Export ZIP archiver warning", {
      module: "full-export",
      action: "archive",
      error,
    });
  });

  const zipPromise = new Promise<Buffer>((resolve, reject) => {
    arc.on("end", () => resolve(Buffer.concat(chunks)));
    arc.on("error", reject);
  });

  for (const company of companies) {
    try {
      log(`[${company.name}] Building workbook (streaming, one sheet at a time)...`, "info");

      const safeName = company.name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const entryName = `${safeName}_Export_${dateLabel}.xlsx`;

      // Build the workbook and get a Buffer, then append the buffer
      // directly to the archiver — no PassThrough stream needed.
      const xlsBuf = await streamCompanyWorkbookDirect(company.id, fromDate, toDate);
      arc.append(xlsBuf, { name: entryName });

      names.push(company.name);
      log(`[${company.name}] workbook streamed into ZIP`, "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[${company.name}] Failed: ${message}`, "error");
      logger.error("Company workbook export failed", {
        module: "full-export",
        action: "company-workbook",
        companyId: company.id,
        companyName: company.name,
        error,
      });
      skipped.push(company.name);
    }
  }

  if (names.length === 0) {
    arc.abort();
    const message = `Export aborted — all ${companies.length} company/companies failed to generate workbooks. ZIP would be empty. Check server logs for per-company errors.`;
    log(message, "error");
    throw new Error(message);
  }

  arc.finalize();
  const zip = await zipPromise;

  log(
    `ZIP ready — ${(zip.length / 1024 / 1024).toFixed(1)} MB (${names.length} companies, ${skipped.length} skipped)`,
    "success"
  );
  return { zip, names, skipped };
}
