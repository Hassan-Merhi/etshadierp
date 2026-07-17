import fs from "fs";
import path from "path";
import { fork } from "child_process";
import { fileURLToPath } from "url";
import { createFileBackedExport } from "../lib/fileBackedExport";
import { logger } from "../lib/logger";

export interface WorkerExportResult {
  zip: Buffer;
  names: string[];
  skipped: string[];
}

type ProgressLevel = "info" | "success" | "warning" | "error";

type WorkerMessage =
  | { type: "progress"; message: string; level: ProgressLevel }
  | {
      type: "result";
      filePath: string;
      tempDir: string;
      length: number;
      names: string[];
      skipped: string[];
    }
  | { type: "error"; message: string; stack?: string; code?: string };

let workerRunning = false;

function resolveWorkerPath(): string | null {
  const bundledPath = fileURLToPath(new URL("./full-export-worker.js", import.meta.url));
  if (fs.existsSync(bundledPath)) return bundledPath;

  const cwdPath = path.resolve(process.cwd(), "dist", "full-export-worker.js");
  if (fs.existsSync(cwdPath)) return cwdPath;

  return null;
}

export function isFullExportWorkerAvailable(): boolean {
  return resolveWorkerPath() !== null;
}

export async function runFullExportWorker(
  companies: any[],
  fromDate?: string,
  toDate?: string,
  onProgress?: (message: string, level?: ProgressLevel) => void
): Promise<WorkerExportResult> {
  if (workerRunning) {
    const error = new Error("Another full export worker is already running.");
    (error as any).code = "EXPORT_ALREADY_RUNNING";
    throw error;
  }

  const workerPath = resolveWorkerPath();
  if (!workerPath) {
    const error = new Error("Full export worker bundle is not available.");
    (error as any).code = "EXPORT_WORKER_NOT_AVAILABLE";
    throw error;
  }

  workerRunning = true;
  const timeoutMs = Math.max(5 * 60 * 1000, Number(process.env.EXPORT_WORKER_TIMEOUT_MS || 45 * 60 * 1000));
  const heapMb = Math.max(384, Number(process.env.EXPORT_WORKER_HEAP_MB || 768));

  return new Promise<WorkerExportResult>((resolve, reject) => {
    let settled = false;
    let stderrTail = "";

    const worker = fork(workerPath, [], {
      env: {
        ...process.env,
        ERP_EXPORT_WORKER: "1",
      },
      execArgv: [`--max-old-space-size=${heapMb}`],
      serialization: "json",
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    const safeDisconnect = () => {
      try {
        if (worker.connected) worker.disconnect();
      } catch {
        // Worker may have exited between the connected check and disconnect.
      }
    };

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      workerRunning = false;
      callback();
    };

    const timeout = setTimeout(() => {
      worker.kill("SIGKILL");
      finish(() => {
        const error = new Error(`Full export worker exceeded its ${Math.round(timeoutMs / 60000)} minute limit.`);
        (error as any).code = "EXPORT_WORKER_TIMEOUT";
        reject(error);
      });
    }, timeoutMs);
    timeout.unref();

    worker.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) logger.debug("Export worker output", { module: "full-export-worker", action: "stdout", line });
    });

    worker.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = `${stderrTail}${chunk.toString()}`.slice(-4000);
      logger.warn("Export worker diagnostic", {
        module: "full-export-worker",
        action: "stderr",
        line: chunk.toString().trim(),
      });
    });

    worker.on("message", (raw: unknown) => {
      if (!raw || typeof raw !== "object" || typeof (raw as any).type !== "string") return;
      const message = raw as WorkerMessage;

      if (message.type === "progress") {
        onProgress?.(message.message, message.level);
        return;
      }

      if (message.type === "result") {
        const validResult =
          path.isAbsolute(message.filePath) &&
          path.isAbsolute(message.tempDir) &&
          Number.isFinite(message.length) &&
          message.length >= 0 &&
          Array.isArray(message.names) &&
          Array.isArray(message.skipped);

        if (!validResult) {
          finish(() => {
            const error = new Error("Full export worker returned an invalid result payload.");
            (error as any).code = "EXPORT_WORKER_INVALID_RESULT";
            reject(error);
          });
          safeDisconnect();
          return;
        }

        finish(() => {
          const zip = createFileBackedExport(message.filePath, message.tempDir, message.length);
          resolve({ zip, names: message.names, skipped: message.skipped });
        });
        safeDisconnect();
        return;
      }

      if (message.type === "error") {
        finish(() => {
          const error = new Error(message.message);
          (error as any).code = message.code || "EXPORT_WORKER_FAILED";
          (error as any).stack = message.stack || error.stack;
          reject(error);
        });
        safeDisconnect();
      }
    });

    worker.once("error", (error) => {
      finish(() => reject(error));
    });

    worker.once("exit", (code, signal) => {
      if (settled) return;
      finish(() => {
        const suffix = stderrTail.trim() ? ` Last diagnostics: ${stderrTail.trim()}` : "";
        const error = new Error(
          `Full export worker exited before returning a result (code=${code ?? "null"}, signal=${signal ?? "none"}).${suffix}`
        );
        (error as any).code = code === null ? "EXPORT_WORKER_KILLED" : "EXPORT_WORKER_EXITED";
        reject(error);
      });
    });

    worker.send(
      {
        type: "start",
        companies,
        fromDate: fromDate || null,
        toDate: toDate || null,
      },
      (error) => {
        if (!error) return;
        finish(() => reject(error));
        safeDisconnect();
      }
    );
  });
}
