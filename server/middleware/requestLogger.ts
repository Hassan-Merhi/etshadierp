/**
 * HTTP request logging and lightweight internal monitoring middleware.
 *
 * Logs failures, slow requests and an optional sample of successful requests.
 * Never logs request/response bodies, credentials, cookies or auth headers.
 */
import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { pool } from "../db";
import { logger } from "../lib/logger";
import { getOperationalEventSnapshot, recordOperationalEvent } from "../lib/operationalEvents";

const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS || 500);
const SUCCESS_SAMPLE_RATE = Math.min(1, Math.max(0, Number(process.env.REQUEST_LOG_SAMPLE_RATE || 0)));
const SKIPPED_PATHS = new Set(["/api/health", "/api/health/db", "/api/health/metrics", "/api/boot", "/api/csrf-token"]);
const startedAt = Date.now();

type DurationBucket = "under100" | "under500" | "under1000" | "under5000" | "over5000";

interface RequestMetrics {
  total: number;
  active: number;
  success: number;
  clientError: number;
  serverError: number;
  slow: number;
  durationTotalMs: number;
  durationMaxMs: number;
  durationBuckets: Record<DurationBucket, number>;
}

const metrics: RequestMetrics = {
  total: 0,
  active: 0,
  success: 0,
  clientError: 0,
  serverError: 0,
  slow: 0,
  durationTotalMs: 0,
  durationMaxMs: 0,
  durationBuckets: {
    under100: 0,
    under500: 0,
    under1000: 0,
    under5000: 0,
    over5000: 0,
  },
};

function normaliseRequestId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]{8,128}$/.test(trimmed) ? trimmed : undefined;
}

function recordDuration(durationMs: number): void {
  metrics.durationTotalMs += durationMs;
  metrics.durationMaxMs = Math.max(metrics.durationMaxMs, durationMs);

  if (durationMs < 100) metrics.durationBuckets.under100 += 1;
  else if (durationMs < 500) metrics.durationBuckets.under500 += 1;
  else if (durationMs < 1000) metrics.durationBuckets.under1000 += 1;
  else if (durationMs < 5000) metrics.durationBuckets.under5000 += 1;
  else metrics.durationBuckets.over5000 += 1;
}

function percentage(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 10000) / 100;
}

function isMonitoringRole(req: Request): boolean {
  const role = String((req as any).session?.currentRole || (req as any).user?.role || "").toLowerCase();
  return role === "admin" || role === "developer";
}

export function getRequestMetricsSnapshot() {
  const memory = process.memoryUsage();
  const poolMax = Number((pool as any).options?.max || 0);
  const poolTotal = Number((pool as any).totalCount || 0);
  const poolIdle = Number((pool as any).idleCount || 0);
  const poolWaiting = Number((pool as any).waitingCount || 0);
  const completed = metrics.success + metrics.clientError + metrics.serverError;

  return {
    status: poolWaiting > 0 ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    process: {
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: new Date(startedAt).toISOString(),
      nodeEnv: process.env.NODE_ENV || "development",
      memoryMb: {
        rss: Math.round(memory.rss / 1024 / 1024),
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
      },
    },
    requests: {
      total: metrics.total,
      active: metrics.active,
      completed,
      success: metrics.success,
      clientError: metrics.clientError,
      serverError: metrics.serverError,
      slow: metrics.slow,
      averageDurationMs: completed > 0 ? Math.round(metrics.durationTotalMs / completed) : 0,
      maxDurationMs: metrics.durationMaxMs,
      slowPercent: percentage(metrics.slow, completed),
      serverErrorPercent: percentage(metrics.serverError, completed),
      slowRequestThresholdMs: SLOW_REQUEST_MS,
      durationBuckets: { ...metrics.durationBuckets },
    },
    databasePool: {
      max: poolMax,
      total: poolTotal,
      idle: poolIdle,
      active: Math.max(0, poolTotal - poolIdle),
      waiting: poolWaiting,
      utilizationPercent: poolMax > 0 ? Math.round(((poolTotal - poolIdle) / poolMax) * 100) : null,
    },
    operationalEvents: getOperationalEventSnapshot(),
  };
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const requestId = normaliseRequestId(req.headers["x-request-id"]) || randomUUID();
  res.setHeader("X-Request-Id", requestId);

  if (req.method === "GET" && req.path === "/api/health") {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
    return;
  }

  if (req.method === "GET" && req.path === "/api/health/metrics") {
    if (!isMonitoringRole(req)) {
      res.status(403).json({ message: "Admin or Developer access required." });
      return;
    }
    res.status(200).json(getRequestMetricsSnapshot());
    return;
  }

  if (req.path.startsWith("/api/")) {
    metrics.total += 1;
    metrics.active += 1;
  }

  res.on("finish", () => {
    const { method, path } = req;
    if (!path.startsWith("/api/")) return;

    metrics.active = Math.max(0, metrics.active - 1);
    const statusCode = res.statusCode;
    const durationMs = Date.now() - start;
    recordDuration(durationMs);

    if (statusCode >= 500) metrics.serverError += 1;
    else if (statusCode >= 400) metrics.clientError += 1;
    else metrics.success += 1;

    const isSlow = durationMs >= SLOW_REQUEST_MS;
    if (isSlow) metrics.slow += 1;

    const userId: number | undefined = (req as any).user?.id;
    const companyId: number | undefined = (req as any).session?.currentCompanyId;

    if (statusCode >= 500) {
      recordOperationalEvent({
        category: "error",
        code: "http_server_error",
        severity: "critical",
        message: "HTTP server error detected",
        requestId,
        method,
        path,
        status: statusCode,
        durationMs,
        ...(userId != null ? { userId } : {}),
        ...(companyId != null ? { companyId } : {}),
      });
      return;
    }

    if (SKIPPED_PATHS.has(path)) return;

    const isFailure = statusCode >= 400;
    const sampledSuccess = !isFailure && SUCCESS_SAMPLE_RATE > 0 && Math.random() < SUCCESS_SAMPLE_RATE;

    if (!isFailure && !isSlow && !sampledSuccess) return;

    const level = statusCode >= 400 || isSlow ? "warn" : "info";
    logger[level](`${method} ${path} ${statusCode}`, {
      module: "http",
      action: isSlow ? "slow_request" : "request",
      requestId,
      ...(userId != null ? { userId } : {}),
      ...(companyId != null ? { companyId } : {}),
      status: statusCode,
      durationMs,
      slow: isSlow,
    });
  });

  next();
}
