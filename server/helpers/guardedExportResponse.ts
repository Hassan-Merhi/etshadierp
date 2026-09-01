import type { Response } from "express";
import type { Writable } from "stream";
import { withHeavyExportSlot } from "../services/heavyExportCoordinator";

export interface GuardedExportResponseOptions {
  label: string;
  contentType: string;
  filename: string;
  cacheControl?: string;
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[\r\n"]/g, "_");
}

/**
 * Serializes a large HTTP export through the global heavy-export coordinator
 * and rejects promptly when the browser disconnects. The producer must write
 * directly to the supplied response and must not retain the completed payload.
 */
export async function writeGuardedExportResponse(
  res: Response,
  options: GuardedExportResponseOptions,
  producer: (destination: Writable) => Promise<void>
): Promise<void> {
  await withHeavyExportSlot(options.label, async () => {
    if (res.destroyed || res.writableEnded) throw new Error("Export client disconnected before generation started");

    res.setHeader("Content-Type", options.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(options.filename)}"`);
    res.setHeader("Cache-Control", options.cacheControl ?? "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    let disconnected = false;
    const onClose = () => {
      if (!res.writableEnded) disconnected = true;
    };
    res.once("close", onClose);

    try {
      await producer(res);
      if (disconnected || res.destroyed) throw new Error("Export client disconnected during generation");
      if (!res.writableEnded) res.end();
    } catch (error) {
      if (!res.destroyed && !res.writableEnded) res.destroy(error instanceof Error ? error : undefined);
      throw error;
    } finally {
      res.off("close", onClose);
    }
  });
}
