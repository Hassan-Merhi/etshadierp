import { logger } from "../lib/logger";

const DEFAULT_MAX_CONCURRENT = 1;
const DEFAULT_MAX_QUEUE = 6;
const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60 * 1000;

interface QueueEntry {
  label: string;
  enqueuedAt: number;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

let active = 0;
const queue: QueueEntry[] = [];

function readPositiveInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function maxConcurrent(): number {
  return readPositiveInt("HEAVY_EXPORT_MAX_CONCURRENT", DEFAULT_MAX_CONCURRENT);
}

function maxQueue(): number {
  return readPositiveInt("HEAVY_EXPORT_MAX_QUEUE", DEFAULT_MAX_QUEUE);
}

function waitTimeoutMs(): number {
  return readPositiveInt("HEAVY_EXPORT_WAIT_TIMEOUT_MS", DEFAULT_WAIT_TIMEOUT_MS);
}

function dispatch(): void {
  while (active < maxConcurrent() && queue.length > 0) {
    const entry = queue.shift()!;
    clearTimeout(entry.timeout);
    active += 1;

    let released = false;
    entry.resolve(() => {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
      logger.info("Heavy export slot released", {
        module: "heavy-export-coordinator",
        action: "release",
        label: entry.label,
        active,
        queued: queue.length,
      });
      dispatch();
    });

    logger.info("Heavy export slot acquired", {
      module: "heavy-export-coordinator",
      action: "acquire",
      label: entry.label,
      waitMs: Date.now() - entry.enqueuedAt,
      active,
      queued: queue.length,
    });
  }
}

export function getHeavyExportState() {
  return {
    active,
    queued: queue.length,
    maxConcurrent: maxConcurrent(),
    maxQueue: maxQueue(),
  };
}

export async function acquireHeavyExportSlot(label: string): Promise<() => void> {
  if (queue.length >= maxQueue() && active >= maxConcurrent()) {
    throw new Error(`Export capacity reached (${active} active, ${queue.length} queued). Try again after the current export finishes.`);
  }

  return new Promise<() => void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = queue.findIndex((entry) => entry.timeout === timeout);
      if (index >= 0) queue.splice(index, 1);
      reject(new Error(`Timed out waiting for export capacity after ${Math.round(waitTimeoutMs() / 60000)} minutes.`));
    }, waitTimeoutMs());
    timeout.unref?.();

    queue.push({ label, enqueuedAt: Date.now(), resolve, reject, timeout });
    dispatch();
  });
}

export async function withHeavyExportSlot<T>(label: string, work: () => Promise<T>): Promise<T> {
  const release = await acquireHeavyExportSlot(label);
  try {
    return await work();
  } finally {
    release();
  }
}
