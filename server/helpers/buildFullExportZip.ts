import archiver from "archiver";
import type { Writable } from "stream";
import { streamCompanyWorkbookDirect } from "../services/exportExcelService";
import { logger } from "../lib/logger";

export interface ExportZipResult {
  zip: Buffer;
  names: string[];
  skipped: string[];
}

export interface StreamExportZipResult {
  names: string[];
  skipped: string[];
  bytesWritten: number;
}

type ExportProgress = (msg: string, level?: "info" | "success" | "warning" | "error") => void;

function createProgressLogger(onProgress?: ExportProgress): ExportProgress {
  return (
    onProgress ??
    ((message: string, level: "info" | "success" | "warning" | "error" = "info") => {
      const context = { module: "full-export", action: "build-zip" };
      if (level === "error") logger.error(message, context);
      else if (level === "warning") logger.warn(message, context);
      else logger.info(message, context);
    })
  );
}

function attachArchiveLogging(arc: archiver.Archiver): void {
  arc.on("warning", (error: unknown) => {
    logger.warn("Export ZIP archiver warning", {
      module: "full-export",
      action: "archive",
      error,
    });
  });
}

async function appendCompanyWorkbooks(
  arc: archiver.Archiver,
  companies: any[],
  fromDate: string | undefined,
  toDate: string | undefined,
  log: ExportProgress
): Promise<{ names: string[]; skipped: string[] }> {
  const dateLabel = new Date().toISOString().substring(0, 10);
  const names: string[] = [];
  const skipped: string[] = [];

  for (const company of companies) {
    try {
      log(`[${company.name}] Building workbook one sheet at a time...`, "info");

      const safeName = company.name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const entryName = `${safeName}_Export_${dateLabel}.xlsx`;

      // ExcelJS's document workbook still creates one workbook buffer. Append it
      // immediately, then release the reference before starting the next company.
      // The surrounding ZIP is streamed and is never accumulated in Buffer[].
      const xlsBuf = await streamCompanyWorkbookDirect(company.id, fromDate, toDate);
      arc.append(xlsBuf, { name: entryName });

      names.push(company.name);
      log(`[${company.name}] workbook appended to ZIP`, "success");
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

  return { names, skipped };
}

/**
 * Direct-download path. The ZIP bytes flow from archiver to the HTTP response or
 * another Writable and are never retained as Buffer chunks in Node memory.
 */
export async function streamFullExportZip(
  destination: Writable,
  companies: any[],
  fromDate?: string,
  toDate?: string,
  onProgress?: ExportProgress
): Promise<StreamExportZipResult> {
  const log = createProgressLogger(onProgress);
  const arc = archiver("zip", { zlib: { level: 6 } });
  attachArchiveLogging(arc);

  const complete = new Promise<void>((resolve, reject) => {
    destination.once("finish", resolve);
    destination.once("error", reject);
    arc.once("error", reject);
  });

  arc.pipe(destination);
  const { names, skipped } = await appendCompanyWorkbooks(arc, companies, fromDate, toDate, log);
  await arc.finalize();
  await complete;

  const bytesWritten = arc.pointer();
  log(
    `ZIP streamed — ${(bytesWritten / 1024 / 1024).toFixed(1)} MB (${names.length} companies, ${skipped.length} skipped)`,
    "success"
  );

  return { names, skipped, bytesWritten };
}

/**
 * Attachment compatibility path used by email and WhatsApp providers, which
 * require final bytes. Direct browser downloads must use streamFullExportZip.
 */
export async function buildFullExportZip(
  companies: any[],
  fromDate?: string,
  toDate?: string,
  onProgress?: ExportProgress
): Promise<ExportZipResult> {
  const log = createProgressLogger(onProgress);
  const chunks: Buffer[] = [];
  const arc = archiver("zip", { zlib: { level: 6 } });
  attachArchiveLogging(arc);
  arc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const zipPromise = new Promise<Buffer>((resolve, reject) => {
    arc.on("end", () => resolve(Buffer.concat(chunks)));
    arc.on("error", reject);
  });

  const { names, skipped } = await appendCompanyWorkbooks(arc, companies, fromDate, toDate, log);
  await arc.finalize();
  const zip = await zipPromise;

  log(
    `ZIP ready — ${(zip.length / 1024 / 1024).toFixed(1)} MB (${names.length} companies, ${skipped.length} skipped)`,
    "success"
  );
  return { zip, names, skipped };
}
