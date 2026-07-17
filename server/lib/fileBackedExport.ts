import fs from "fs";
import path from "path";
import { logger } from "./logger";

export interface FileBackedExport {
  readonly __erpFileBackedExport: true;
  readonly filePath: string;
  readonly tempDir: string;
  readonly length: number;
  readonly createdAt: number;
}

const artifacts = new Map<string, FileBackedExport>();
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const cleanupTtlMs = Math.max(10 * 60 * 1000, Number(process.env.EXPORT_ARTIFACT_TTL_MS || DEFAULT_TTL_MS));

export function isFileBackedExport(value: unknown): value is FileBackedExport {
  return !!(
    value &&
    typeof value === "object" &&
    (value as any).__erpFileBackedExport === true &&
    typeof (value as any).filePath === "string" &&
    typeof (value as any).length === "number"
  );
}

/**
 * Compatibility adapter for legacy callers that type the ZIP as Buffer and only
 * inspect `.length` before passing it to email/WhatsApp/job services.
 *
 * The returned value is intentionally NOT a real Buffer. Boundary services must
 * call isFileBackedExport() and stream/read the file as appropriate.
 */
export function createFileBackedExport(filePath: string, tempDir: string, length: number): Buffer {
  const artifact: FileBackedExport = Object.freeze({
    __erpFileBackedExport: true,
    filePath,
    tempDir,
    length,
    createdAt: Date.now(),
  });
  artifacts.set(filePath, artifact);
  return artifact as unknown as Buffer;
}

export function getExportFilePath(value: Buffer | FileBackedExport): string | null {
  return isFileBackedExport(value) ? value.filePath : null;
}

export async function readExportBuffer(
  value: Buffer | FileBackedExport,
  maxBytes = Number.POSITIVE_INFINITY
): Promise<Buffer> {
  if (!isFileBackedExport(value)) return value;
  if (value.length > maxBytes) {
    throw new Error(`Export artifact is too large to buffer safely (${value.length} bytes; limit ${maxBytes} bytes).`);
  }
  return fs.promises.readFile(value.filePath);
}

export async function cleanupFileBackedExport(value: unknown): Promise<void> {
  if (!isFileBackedExport(value)) return;
  artifacts.delete(value.filePath);
  await fs.promises.rm(value.tempDir, { recursive: true, force: true }).catch((error) => {
    logger.warn("Failed to remove export temporary directory", {
      module: "file-backed-export",
      action: "cleanup",
      tempDir: value.tempDir,
      error,
    });
  });
}

export async function cleanupExportPath(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return;
  const artifact = artifacts.get(filePath);
  if (artifact) {
    await cleanupFileBackedExport(artifact);
    return;
  }

  // Only delete paths inside the OS temp export prefix. Never accept an arbitrary
  // path from an HTTP request or database row.
  const parent = path.dirname(filePath);
  if (path.basename(parent).startsWith("erp-export-")) {
    await fs.promises.rm(parent, { recursive: true, force: true }).catch(() => {});
  }
}

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - cleanupTtlMs;
  for (const artifact of artifacts.values()) {
    if (artifact.createdAt < cutoff) void cleanupFileBackedExport(artifact);
  }
}, 5 * 60 * 1000);
cleanupTimer.unref();
