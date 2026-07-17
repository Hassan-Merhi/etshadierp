import { isFileBackedExport } from "../lib/fileBackedExport";
import { buildFullExportZipInProcess } from "../helpers/buildFullExportZipInProcess";

interface StartMessage {
  type: "start";
  companies: any[];
  fromDate: string | null;
  toDate: string | null;
}

function send(message: unknown): void {
  if (typeof process.send === "function") process.send(message);
}

let started = false;

process.on("message", (raw: StartMessage) => {
  if (!raw || raw.type !== "start" || started) return;
  started = true;

  void (async () => {
    try {
      const result = await buildFullExportZipInProcess(
        Array.isArray(raw.companies) ? raw.companies : [],
        raw.fromDate || undefined,
        raw.toDate || undefined,
        (message, level = "info") => send({ type: "progress", message, level })
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
