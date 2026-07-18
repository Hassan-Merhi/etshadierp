/**
 * Opt-in endpoint performance and bandwidth profiler.
 *
 * Active only when BANDWIDTH_DEBUG=true. It records aggregate route metadata and
 * periodically emits a ranked list without logging response bodies, request
 * bodies, cookies, authorization headers, tokens, or query-string values.
 */
import type { Request, Response, NextFunction } from "express";
import { recordOperationalEvent } from "../lib/operationalEvents";

const DEFAULT_THRESHOLD_BYTES = 500 * 1024;
const DEFAULT_REPORT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TOP_N = 20;

type EndpointAggregate = {
  method: string;
  path: string;
  requestCount: number;
  errorCount: number;
  totalResponseBytes: number;
  maxResponseBytes: number;
  totalDurationMs: number;
  maxDurationMs: number;
  totalHeapDeltaBytes: number;
  maxHeapDeltaBytes: number;
  dbQueryCount: number;
  dbDurationMs: number;
};

type DatabaseMetrics = {
  queryCount?: number;
  durationMs?: number;
};

const aggregates = new Map<string, EndpointAggregate>();
let reportTimer: NodeJS.Timeout | undefined;

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getThresholdBytes(): number {
  return Math.round(positiveNumber(process.env.BANDWIDTH_DEBUG_THRESHOLD_KB, 500) * 1024);
}

function normalizePath(req: Request): string {
  const routePath = req.route?.path;
  if (typeof routePath === "string") {
    const baseUrl = req.baseUrl || "";
    return `${baseUrl}${routePath}` || "/";
  }

  return req.path
    .split("/")
    .map((segment) => {
      if (/^\d+$/.test(segment)) return ":id";
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":id";
      return segment;
    })
    .join("/");
}

function getDatabaseMetrics(res: Response): DatabaseMetrics {
  const value = res.locals?.databaseMetrics as DatabaseMetrics | undefined;
  return {
    queryCount: Number.isFinite(value?.queryCount) ? Math.max(0, Number(value?.queryCount)) : 0,
    durationMs: Number.isFinite(value?.durationMs) ? Math.max(0, Number(value?.durationMs)) : 0,
  };
}

function calculateRankScore(aggregate: EndpointAggregate): number {
  const count = Math.max(aggregate.requestCount, 1);
  const averageBytes = aggregate.totalResponseBytes / count;
  const averageDuration = aggregate.totalDurationMs / count;
  const averageHeapDelta = aggregate.totalHeapDeltaBytes / count;
  const averageDbDuration = aggregate.dbDurationMs / count;

  return (
    aggregate.totalResponseBytes / (1024 * 1024) +
    aggregate.requestCount * 0.25 +
    averageDuration / 100 +
    Math.max(0, averageHeapDelta) / (1024 * 1024) +
    averageDbDuration / 100 +
    aggregate.errorCount * 2 +
    aggregate.maxResponseBytes / (10 * 1024 * 1024)
  );
}

function emitRanking(): void {
  if (aggregates.size === 0) return;

  const topN = Math.round(positiveNumber(process.env.BANDWIDTH_DEBUG_TOP_N, DEFAULT_TOP_N));
  const ranked = [...aggregates.values()]
    .map((aggregate) => {
      const count = Math.max(aggregate.requestCount, 1);
      return {
        method: aggregate.method,
        path: aggregate.path,
        score: Number(calculateRankScore(aggregate).toFixed(3)),
        requests: aggregate.requestCount,
        errors: aggregate.errorCount,
        totalResponseBytes: aggregate.totalResponseBytes,
        averageResponseBytes: Math.round(aggregate.totalResponseBytes / count),
        maxResponseBytes: aggregate.maxResponseBytes,
        averageDurationMs: Math.round(aggregate.totalDurationMs / count),
        maxDurationMs: aggregate.maxDurationMs,
        averageHeapDeltaBytes: Math.round(aggregate.totalHeapDeltaBytes / count),
        maxHeapDeltaBytes: aggregate.maxHeapDeltaBytes,
        dbQueryCount: aggregate.dbQueryCount,
        averageDbDurationMs: Math.round(aggregate.dbDurationMs / count),
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, topN);

  recordOperationalEvent({
    category: "bandwidth",
    code: "endpoint_performance_ranking",
    severity: "info",
    message: "Ranked endpoint performance and bandwidth snapshot",
    endpointCount: aggregates.size,
    windowMs: positiveNumber(process.env.BANDWIDTH_DEBUG_REPORT_INTERVAL_MS, DEFAULT_REPORT_INTERVAL_MS),
    ranked,
  });

  aggregates.clear();
}

function ensureReportTimer(): void {
  if (reportTimer) return;

  const intervalMs = positiveNumber(
    process.env.BANDWIDTH_DEBUG_REPORT_INTERVAL_MS,
    DEFAULT_REPORT_INTERVAL_MS,
  );
  reportTimer = setInterval(emitRanking, intervalMs);
  reportTimer.unref();
}

export function bandwidthDebugMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.BANDWIDTH_DEBUG !== "true") return next();

  ensureReportTimer();

  const start = Date.now();
  const startHeapBytes = process.memoryUsage().heapUsed;
  const thresholdBytes = getThresholdBytes();
  let totalBytes = 0;
  let finalized = false;

  const originalWrite = res.write.bind(res);
  (res as typeof res & { write: typeof res.write }).write = function (chunk: unknown, ...args: unknown[]): boolean {
    if (chunk != null) {
      totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    }
    return originalWrite(chunk as never, ...(args as never[]));
  };

  const originalEnd = res.end.bind(res);
  (res as typeof res & { end: typeof res.end }).end = function (chunk?: unknown, ...args: unknown[]): Response {
    if (chunk != null && typeof chunk !== "function") {
      totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    }

    originalEnd(chunk as never, ...(args as never[]));

    if (!finalized) {
      finalized = true;
      const durationMs = Date.now() - start;
      const heapDeltaBytes = process.memoryUsage().heapUsed - startHeapBytes;
      const path = normalizePath(req);
      const key = `${req.method} ${path}`;
      const databaseMetrics = getDatabaseMetrics(res);
      const aggregate = aggregates.get(key) ?? {
        method: req.method,
        path,
        requestCount: 0,
        errorCount: 0,
        totalResponseBytes: 0,
        maxResponseBytes: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        totalHeapDeltaBytes: 0,
        maxHeapDeltaBytes: 0,
        dbQueryCount: 0,
        dbDurationMs: 0,
      };

      aggregate.requestCount += 1;
      if (res.statusCode >= 500) aggregate.errorCount += 1;
      aggregate.totalResponseBytes += totalBytes;
      aggregate.maxResponseBytes = Math.max(aggregate.maxResponseBytes, totalBytes);
      aggregate.totalDurationMs += durationMs;
      aggregate.maxDurationMs = Math.max(aggregate.maxDurationMs, durationMs);
      aggregate.totalHeapDeltaBytes += heapDeltaBytes;
      aggregate.maxHeapDeltaBytes = Math.max(aggregate.maxHeapDeltaBytes, heapDeltaBytes);
      aggregate.dbQueryCount += databaseMetrics.queryCount ?? 0;
      aggregate.dbDurationMs += databaseMetrics.durationMs ?? 0;
      aggregates.set(key, aggregate);

      if (totalBytes >= thresholdBytes) {
        recordOperationalEvent({
          category: "bandwidth",
          code: "large_http_response",
          severity: "warning",
          message: "Large HTTP response detected",
          method: req.method,
          path,
          status: res.statusCode,
          responseBytes: totalBytes,
          durationMs,
          heapDeltaBytes,
          dbQueryCount: databaseMetrics.queryCount ?? 0,
          dbDurationMs: databaseMetrics.durationMs ?? 0,
        });
      }
    }

    return res;
  };

  next();
}

export const __bandwidthDebugTesting = {
  emitRanking,
  normalizePath,
  calculateRankScore,
  clear(): void {
    aggregates.clear();
  },
};
