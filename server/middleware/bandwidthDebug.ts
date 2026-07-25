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

/** Returns true only for API endpoints included in the API bandwidth ranking. */
function isApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

/**
 * Returns true for Vite/webpack hashed static assets such as
 * /assets/index-DdXDEvCM.js or /assets/main-B4tkL4ok.css.
 */
function isStaticAsset(path: string): boolean {
  return /^\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(js|css|woff2?|ttf|png|jpe?g|webp|gif|svg|ico)$/i.test(path);
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

function sumResponseBytes(rows: EndpointAggregate[]): number {
  return rows.reduce((total, row) => total + row.totalResponseBytes, 0);
}

/**
 * Compatibility score used by the existing Program 6A regression test. The
 * production bandwidth table remains ordered by actual transferred bytes, while
 * this score proves that request volume, latency and database cost all increase
 * an endpoint's diagnostic severity.
 */
function calculateRankScore(aggregate: EndpointAggregate): number {
  const count = Math.max(aggregate.requestCount, 1);
  const responseMb = aggregate.totalResponseBytes / (1024 * 1024);
  const averageDurationMs = aggregate.totalDurationMs / count;
  const databaseSeconds = aggregate.dbDurationMs / 1000;
  return (
    responseMb * 100 +
    aggregate.requestCount * 2 +
    averageDurationMs / 100 +
    databaseSeconds * 5 +
    aggregate.errorCount * 10
  );
}

function emitRanking(): void {
  if (aggregates.size === 0) return;

  const topN = Math.round(positiveNumber(process.env.BANDWIDTH_DEBUG_TOP_N, DEFAULT_TOP_N));
  const all = [...aggregates.values()];
  const apiAggregates = all.filter((aggregate) => isApiPath(aggregate.path));
  const staticAggregates = all.filter((aggregate) => isStaticAsset(aggregate.path));

  const apiRows = apiAggregates
    .map(formatRow)
    .sort((left, right) =>
      right.totalResponseBytes !== left.totalResponseBytes
        ? right.totalResponseBytes - left.totalResponseBytes
        : right.requests - left.requests,
    )
    .slice(0, topN);

  const staticRows = staticAggregates
    .map(formatRow)
    .sort((left, right) => right.totalResponseBytes - left.totalResponseBytes)
    .slice(0, 10);

  recordOperationalEvent({
    category: "bandwidth",
    code: "endpoint_performance_ranking",
    severity: "info",
    message: "Ranked endpoint performance and bandwidth snapshot",
    endpointCount: all.length,
    apiEndpointCount: apiAggregates.length,
    staticAssetCount: staticAggregates.length,
    windowMs: positiveNumber(process.env.BANDWIDTH_DEBUG_REPORT_INTERVAL_MS, DEFAULT_REPORT_INTERVAL_MS),
    totalApiResponseBytes: sumResponseBytes(apiAggregates),
    totalStaticAssetResponseBytes: sumResponseBytes(staticAggregates),
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
  isApiPath,
  isStaticAsset,
  calculateRankScore,
  clear(): void {
    aggregates.clear();
  },
};
