import { isFileBackedExport } from "../lib/fileBackedExport";
import { startResourceGuard } from "../lib/resourceGuard";
import { buildFullExportZipInProcess } from "../helpers/buildFullExportZipInProcess";

interface StartMessage {
  type: "start";
  companies: any[];
  fromDate: string | null;
  toDate: string | null;
}

function send(message: Record<string, unknown>): void {
  if (typeof process.send === "function" && process.connected) {
    process.send(message as any);
  }
}

startResourceGuard();
let started = false;

process.on("message", (raw: unknown) => {
  if (!raw || typeof raw !== "object" || (raw as any).type !== "start" || started) return;
  const message = raw as StartMessage;
  started = true;

  void (async () => {
    try {
      const result = await buildFullExportZipInProcess(
        Array.isArray(message.companies) ? message.companies : [],
        message.fromDate || undefined,
        message.toDate || undefined,
        (progressMessage, level = "info") =>
          send({ type: "progress", message: progressMessage, level })
      );

      if (!isFileBackedExport(result.zip)) {
        throw new Error("Export worker produced an in-memory ZIP instead of a disk-backed artifact.");
      }

      send({
        type: "result",
        filePath: result.zip.filePath,
        tempDir: result.zip.tempDir,
        length: result.zip.length,
        names: result.names,
        skipped: result.skipped,
      });

      setTimeout(() => process.exit(0), 25).unref();
    } catch (error: any) {
      send({
        type: "error",
        message: error?.message || String(error),
        stack: error?.stack,
        code: error?.code,
      });
      setTimeout(() => process.exit(1), 25).unref();
    }
  })();
});

process.on("disconnect", () => {
  if (!started) process.exit(0);
});
