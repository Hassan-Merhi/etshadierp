import archiver from "archiver";
import fs from "fs";
import os from "os";
import path from "path";
import { streamCompanyWorkbookDirect } from "../services/exportExcelService";
import { logger } from "../lib/logger";
import { pool } from "../db";
import { tryAcquireExclusiveTask } from "../lib/resourceGuard";
import { createFileBackedExport } from "../lib/fileBackedExport";

export interface ExportZipResult {
  zip: Buffer;
  names: string[];
  skipped: string[];
}

/**
 * In-process implementation used exclusively by the dedicated export worker,
 * or as a development fallback when the worker bundle has not been built yet.
 */
export async function buildFullExportZipInProcess(
  companies: any[],
  fromDate?: string,
  toDate?: string,
  onProgress?: (msg: string, level?: "info" | "success" | "warning" | "error") => void
): Promise<ExportZipResult> {
  const releaseTask = tryAcquireExclusiveTask("full-export", `pid:${process.pid}`);

  if (!releaseTask) {
    const message = "Another full export is already running. Wait for it to finish before starting a new one.";
    onProgress?.(message, "warning");
    const error = new Error(message);
    (error as any).code = "EXPORT_ALREADY_RUNNING";
    throw error;
  }

  let lockClient: Awaited<ReturnType<typeof pool.connect>> | null = null;
  let distributedLockAcquired = false;
  let tempDir: string | null = null;
  let completedSuccessfully = false;
  const workbookPaths: string[] = [];
  const exportLockKey = 742001317;

  try {
    lockClient = await pool.connect();
    const lockResult = await lockClient.query("SELECT pg_try_advisory_lock($1) AS locked", [exportLockKey]);
    distributedLockAcquired = lockResult.rows[0]?.locked === true;

    if (!distributedLockAcquired) {
      const message = "Another full export is already running on a different server instance.";
      onProgress?.(message, "warning");
      const error = new Error(message);
      (error as any).code = "EXPORT_ALREADY_RUNNING";
      throw error;
    }

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

    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "erp-export-"));
    const zipPath = path.join(tempDir, `ERP_Full_Export_${dateLabel}.zip`);
    const output = fs.createWriteStream(zipPath, { flags: "wx" });
    const arc = archiver("zip", { zlib: { level: 6 } });

    const outputComplete = new Promise<void>((resolve, reject) => {
      output.once("close", resolve);
      output.once("error", reject);
      arc.once("error", reject);
    });

    arc.on("warning", (error: unknown) => {
      logger.warn("Export ZIP archiver warning", {
        module: "full-export",
        action: "archive",
        error,
      });
    });
    arc.pipe(output);

    for (let index = 0; index < companies.length; index++) {
      const company = companies[index];
      let workbookPath: string | null = null;

      try {
        log(`[${company.name}] Building workbook (one company at a time)...`, "info");

        const safeName =
          String(company.name || `Company_${company.id}`)
            .replace(/[^a-zA-Z0-9_\- ]/g, "")
            .trim() || `Company_${company.id}`;
        const entryName = `${safeName}_Export_${dateLabel}.xlsx`;
        workbookPath = path.join(tempDir, `${String(index + 1).padStart(3, "0")}-${safeName}.xlsx`);

        let workbookBuffer = await streamCompanyWorkbookDirect(company.id, fromDate, toDate);
        await fs.promises.writeFile(workbookPath, workbookBuffer);
        workbookBuffer = Buffer.alloc(0);

        workbookPaths.push(workbookPath);
        arc.file(workbookPath, { name: entryName });
        workbookPath = null;

        names.push(company.name);
        log(`[${company.name}] workbook queued from disk`, "success");
      } catch (error: unknown) {
        if (workbookPath) await fs.promises.unlink(workbookPath).catch(() => {});
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
      output.destroy();
      const message = `Export aborted — all ${companies.length} company/companies failed to generate workbooks. ZIP would be empty. Check server logs for per-company errors.`;
      log(message, "error");
      throw new Error(message);
    }

    await arc.finalize();
    await outputComplete;

    await Promise.all(workbookPaths.map((file) => fs.promises.unlink(file).catch(() => {})));
    workbookPaths.length = 0;

    const zipStats = await fs.promises.stat(zipPath);
    const zip = createFileBackedExport(zipPath, tempDir, zipStats.size);
    completedSuccessfully = true;

    log(
      `ZIP ready on disk — ${(zipStats.size / 1024 / 1024).toFixed(1)} MB (${names.length} companies, ${skipped.length} skipped)`,
      "success"
    );
    return { zip, names, skipped };
  } finally {
    if (!completedSuccessfully) {
      await Promise.all(workbookPaths.map((file) => fs.promises.unlink(file).catch(() => {})));
      if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }

    if (lockClient) {
      if (distributedLockAcquired) {
        await lockClient
          .query("SELECT pg_advisory_unlock($1)", [exportLockKey])
          .catch((error: unknown) =>
            logger.warn("Failed to release full-export advisory lock", {
              module: "full-export",
              action: "release-lock",
              error,
            })
          );
      }
      lockClient.release();
    }
    releaseTask();
  }
}
