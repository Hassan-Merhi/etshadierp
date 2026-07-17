import { logger } from "../lib/logger";
import { buildFullExportZipInProcess, type ExportZipResult } from "./buildFullExportZipInProcess";
import { isFullExportWorkerAvailable, runFullExportWorker } from "../services/fullExportWorkerClient";

export type { ExportZipResult } from "./buildFullExportZipInProcess";

/**
 * Public full-export entry point.
 *
 * Production uses a memory-capped child process. If ExcelJS or a large company
 * workbook exhausts the worker heap, the worker fails while the live Express
 * process stays available. Development can fall back to in-process execution
 * when the separate worker bundle has not been built yet.
 */
export async function buildFullExportZip(
  companies: any[],
  fromDate?: string,
  toDate?: string,
  onProgress?: (msg: string, level?: "info" | "success" | "warning" | "error") => void
): Promise<ExportZipResult> {
  const forceInProcess =
    process.env.ERP_EXPORT_WORKER === "1" || process.env.EXPORT_WORKER_DISABLED === "1";

  if (!forceInProcess && isFullExportWorkerAvailable()) {
    onProgress?.("Starting isolated export worker...", "info");
    return runFullExportWorker(companies, fromDate, toDate, onProgress);
  }

  if (!forceInProcess && process.env.NODE_ENV === "production") {
    const error = new Error(
      "The isolated export worker bundle is missing. Rebuild the server before running a full export."
    );
    (error as any).code = "EXPORT_WORKER_NOT_AVAILABLE";
    throw error;
  }

  logger.warn("Full export running in-process because worker bundle is unavailable or disabled", {
    module: "full-export",
    action: "in-process-fallback",
    nodeEnv: process.env.NODE_ENV,
    workerAvailable: isFullExportWorkerAvailable(),
    explicitlyDisabled: process.env.EXPORT_WORKER_DISABLED === "1",
  });

  return buildFullExportZipInProcess(companies, fromDate, toDate, onProgress);
}
