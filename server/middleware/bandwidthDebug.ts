import type { Request, Response, NextFunction } from "express";
import { recordOperationalEvent } from "../lib/operationalEvents";
import {
  getRequestPerformanceMetrics,
  runWithRequestPerformanceContext,
} from "../lib/requestPerformanceContext";

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
  if (typeof routePath === "string") return `${req.baseUrl || ""}${routePath}` || "/";

  return req.path
    .split("/")
    .map((segment) => {
      if (/^\d+$/.test(segment)) return ":id";
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":id";
      return segment;
    })
    .join("/");
}

/**
 * Returns true for Vite/webpack hashed static assets such as
 * /assets/index-DdXDEvCM.js or /assets/main-B4tkL4ok.css.
 * These are CDN-cached on the first visit and not meaningful API bandwidth.
 */
function isStaticAsset(path: string): boolean {
  return /^\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(js|css|woff2?|ttf|png|jpg|svg|ico)$/.test(path);
}

function formatRow(aggregate: EndpointAggregate) {
  const count = Math.max(aggregate.requestCount, 1);
  return {
    method: aggregate.method,
    path: aggregate.path,
    requests: aggregate.requestCount,
    errors: aggregate.errorCount,
    totalResponseBytes: aggregate.totalResponseBytes,
    averageResponseBytes: Math.round(aggregate.totalResponseBytes / count),
    maxResponseBytes: aggregate.maxResponseBytes,
    averageDurationMs: Math.round(aggregate.totalDurationMs / count),
    maxDurationMs: aggregate.maxDurationMs,
    dbQueryCount: aggregate.dbQueryCount,
    averageDbDurationMs: Math.round(aggregate.dbDurationMs / count),
  };
}

function emitRanking(): void {
  if (aggregates.size === 0) return;

  const topN = Math.round(positiveNumber(process.env.BANDWIDTH_DEBUG_TOP_N, DEFAULT_TOP_N));
  const all = [...aggregates.values()];

  // Separate API routes from hashed static assets so API bandwidth is easy to read.
  const apiRows = all
    .filter((a) => !isStaticAsset(a.path))
    .map(formatRow)
    .sort((l, r) =>
      r.totalResponseBytes !== l.totalResponseBytes
        ? r.totalResponseBytes - l.totalResponseBytes
        : r.requests - l.requests,
    )
    .slice(0, topN);

  const staticRows = all
    .filter((a) => isStaticAsset(a.path))
    .map(formatRow)
    .sort((l, r) => r.totalResponseBytes - l.totalResponseBytes)
    .slice(0, 10);

  recordOperationalEvent({
    category: "bandwidth",
    code: "endpoint_performance_ranking",
    severity: "info",
    message: "Ranked endpoint performance and bandwidth snapshot",
    endpointCount: all.length,
    apiEndpointCount: apiRows.length,
    staticAssetCount: staticRows.length,
    windowMs: positiveNumber(process.env.BANDWIDTH_DEBUG_REPORT_INTERVAL_MS, DEFAULT_REPORT_INTERVAL_MS),
    ranked: apiRows,
    staticAssets: staticRows,
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
  runWithRequestPerformanceContext(() => {
    const start = Date.now();
    const startHeapBytes = process.memoryUsage().heapUsed;
    const thresholdBytes = getThresholdBytes();
    let totalBytes = 0;
    let finalized = false;

    const originalWrite = res.write.bind(res);
    (res as typeof res & { write: typeof res.write }).write = function (chunk: unknown, ...args: unknown[]): boolean {
      if (chunk != null) totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
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
        const databaseMetrics = getRequestPerformanceMetrics();
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
        aggregate.dbQueryCount += databaseMetrics.dbQueryCount;
        aggregate.dbDurationMs += databaseMetrics.dbDurationMs;
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
            dbQueryCount: databaseMetrics.dbQueryCount,
            dbDurationMs: databaseMetrics.dbDurationMs,
          });
        }
      }
      return res;
    };

    next();
  });
}

export const __bandwidthDebugTesting = {
  emitRanking,
  normalizePath,
  isStaticAsset,
  clear(): void {
    aggregates.clear();
  },
};
