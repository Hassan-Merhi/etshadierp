import fs from "fs";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";
import type { Response } from "express";
import { streamFullExportZip, type StreamExportZipResult } from "./buildFullExportZip";

export interface TemporaryExportArchiveResult extends StreamExportZipResult {
  filePath: string;
}

function safeJobId(jobId: string): string {
  return jobId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function createTemporaryExportArchive(
  jobId: string,
  companies: any[],
  fromDate?: string,
  toDate?: string,
  onProgress?: (msg: string, level?: "info" | "success" | "warning" | "error") => void
): Promise<TemporaryExportArchiveResult> {
  const filePath = path.join(os.tmpdir(), `erp-export-${safeJobId(jobId)}-${Date.now()}.zip`);
  const output = fs.createWriteStream(filePath, { flags: "wx" });

  try {
    const result = await streamFullExportZip(output, companies, fromDate, toDate, onProgress);
    return { ...result, filePath };
  } catch (error) {
    output.destroy();
    await fs.promises.rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function streamTemporaryExportArchive(
  res: Response,
  filePath: string,
  downloadName: string
): Promise<void> {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) throw new Error("Export archive is unavailable");

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${downloadName.replace(/[\r\n"]/g, "_")}"`);
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");

  await pipeline(fs.createReadStream(filePath), res);
}
