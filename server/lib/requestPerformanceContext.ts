import { AsyncLocalStorage } from "node:async_hooks";

type RequestPerformanceMetrics = {
  dbQueryCount: number;
  dbDurationMs: number;
};

const storage = new AsyncLocalStorage<RequestPerformanceMetrics>();

export function runWithRequestPerformanceContext<T>(callback: () => T): T {
  return storage.run({ dbQueryCount: 0, dbDurationMs: 0 }, callback);
}

export function isRequestPerformanceContextActive(): boolean {
  return storage.getStore() !== undefined;
}

export function recordDatabaseQuery(durationMs: number): void {
  const metrics = storage.getStore();
  if (!metrics) return;

  metrics.dbQueryCount += 1;
  if (Number.isFinite(durationMs) && durationMs > 0) {
    metrics.dbDurationMs += durationMs;
  }
}

export function getRequestPerformanceMetrics(): RequestPerformanceMetrics {
  const metrics = storage.getStore();
  return metrics
    ? { dbQueryCount: metrics.dbQueryCount, dbDurationMs: metrics.dbDurationMs }
    : { dbQueryCount: 0, dbDurationMs: 0 };
}
