/**
 * HTTP request logging, resource protection and lightweight internal monitoring.
 *
 * Logs failures, slow requests and an optional sample of successful requests.
 * Never logs request/response bodies, credentials, cookies or auth headers.
 */
import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { pool } from "../db";
import { logger } from "../lib/logger";
import { getOperationalEventSnapshot, recordOperationalEvent } from "../lib/operationalEvents";
import { getRuntimeDiagnosticsSnapshot } from "../lib/runtimeDiagnostics";
import {
  beginTrackedApiRequest,
  endTrackedApiRequest,
  getResourceGuardSnapshot,
  installJsonResponseLimit,
  isResourceDraining,
  startResourceGuard,
  tryAcquireHeavyRequestSlot,
} from "../lib/resourceGuard";
import {
  getHeavyReadCache,
  getHeavyReadCacheSnapshot,
  invalidateHeavyReadCache,
  storeHeavyReadCache,
} from "../lib/heavyReadCache";

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
  rejectedByResourceGuard: number;
  cacheHits: number;
  cacheMisses: number;
  durationTotalMs: number;
  durationMaxMs: number;
  responseBytesTotal: number;
  responseBytesMax: number;
  durationBuckets: Record<DurationBucket, number>;
}

const metrics: RequestMetrics = {
  total: 0,
  active: 0,
  success: 0,
  clientError: 0,
  serverError: 0,
  slow: 0,
  rejectedByResourceGuard: 0,
  cacheHits: 0,
  cacheMisses: 0,
  durationTotalMs: 0,
  durationMaxMs: 0,
  responseBytesTotal: 0,
  responseBytesMax: 0,
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

function recordResponseBytes(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  metrics.responseBytesTotal += bytes;
  metrics.responseBytesMax = Math.max(metrics.responseBytesMax, bytes);
}

function percentage(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 10000) / 100;
}

function isMonitoringRole(req: Request): boolean {
  const role = String((req as any).session?.currentRole || (req as any).user?.role || "").toLowerCase();
  return role === "admin" || role === "developer";
}

function isReadMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

export function getRequestMetricsSnapshot() {
  const poolMax = Number((pool as any).options?.max || 0);
  const poolTotal = Number((pool as any).totalCount || 0);
  const poolIdle = Number((pool as any).idleCount || 0);
  const poolWaiting = Number((pool as any).waitingCount || 0);
  const completed = metrics.success + metrics.clientError + metrics.serverError;
  const resourceGuard = getResourceGuardSnapshot();
  const runtimeDiagnostics = getRuntimeDiagnosticsSnapshot();
  const degraded =
    poolWaiting > 0 ||
    resourceGuard.draining ||
    resourceGuard.memory.level === "critical" ||
    resourceGuard.memory.level === "hard" ||
    runtimeDiagnostics.eventLoop.p99Ms >= Number(process.env.EVENT_LOOP_WARN_P99_MS || 500);

  return {
    status: degraded ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    process: {
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: new Date(startedAt).toISOString(),
      nodeEnv: process.env.NODE_ENV || "development",
      memoryMb: {
        rss: resourceGuard.memory.rssMb,
        heapUsed: resourceGuard.memory.heapUsedMb,
        heapTotal: resourceGuard.memory.heapTotalMb,
        external: resourceGuard.memory.externalMb,
        arrayBuffers: resourceGuard.memory.arrayBuffersMb,
        limit: resourceGuard.memory.limitMb,
        utilizationPercent: resourceGuard.memory.utilizationPercent,
        pressureLevel: resourceGuard.memory.level,
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
      rejectedByResourceGuard: metrics.rejectedByResourceGuard,
      cacheHits: metrics.cacheHits,
      cacheMisses: metrics.cacheMisses,
      averageDurationMs: completed > 0 ? Math.round(metrics.durationTotalMs / completed) : 0,
      maxDurationMs: metrics.durationMaxMs,
      averageResponseBytes: completed > 0 ? Math.round(metrics.responseBytesTotal / completed) : 0,
      maxResponseBytes: metrics.responseBytesMax,
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
    resourceGuard,
    runtimeDiagnostics,
    heavyReadCache: getHeavyReadCacheSnapshot(),
    operationalEvents: getOperationalEventSnapshot(),
  };
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  startResourceGuard();

  const start = Date.now();
  const requestId = normaliseRequestId(req.headers["x-request-id"]) || randomUUID();
  res.setHeader("X-Request-Id", requestId);

  if (req.method === "GET" && req.path === "/api/health") {
    const guard = getResourceGuardSnapshot();
    const status = guard.draining || guard.memory.level === "hard" ? 503 : 200;
    res.status(status).json({
      status: status === 200 ? "ok" : "draining",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      memoryPressure: guard.memory.level,
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

  const isApiRequest = req.path.startsWith("/api/");
  let releaseHeavySlot: (() => void) | undefined;
  let finalized = false;

  if (isApiRequest) {
    metrics.total += 1;
    metrics.active += 1;
    beginTrackedApiRequest();

    const finalize = () => {
      if (finalized) return;
      finalized = true;

      releaseHeavySlot?.();
      endTrackedApiRequest();
      metrics.active = Math.max(0, metrics.active - 1);

      const statusCode = res.statusCode;
      const durationMs = Date.now() - start;
      const responseBytes =
        Number((res.locals as any).responseBytes || res.getHeader("Content-Length") || 0) || 0;

      recordDuration(durationMs);
      recordResponseBytes(responseBytes);

      if (statusCode >= 500) metrics.serverError += 1;
      else if (statusCode >= 400) metrics.clientError += 1;
      else metrics.success += 1;

      const isSlow = durationMs >= SLOW_REQUEST_MS;
      if (isSlow) metrics.slow += 1;

      const userId: number | undefined = (req as any).user?.id;
      const companyId: number | undefined =
        (req as any).session?.factoryCompanyId || (req as any).session?.currentCompanyId;

      if (statusCode >= 500) {
        recordOperationalEvent({
          category: "error",
          code: "http_server_error",
          severity: "critical",
          message: "HTTP server error detected",
          requestId,
          method: req.method,
          path: req.path,
          status: statusCode,
          durationMs,
          ...(userId != null ? { userId } : {}),
          ...(companyId != null ? { companyId } : {}),
        });
        return;
      }

      if (SKIPPED_PATHS.has(req.path)) return;

      const isFailure = statusCode >= 400;
      const sampledSuccess = !isFailure && SUCCESS_SAMPLE_RATE > 0 && Math.random() < SUCCESS_SAMPLE_RATE;

      if (!isFailure && !isSlow && !sampledSuccess) return;

      const level = statusCode >= 400 || isSlow ? "warn" : "info";
      logger[level](`${req.method} ${req.path} ${statusCode}`, {
        module: "http",
        action: isSlow ? "slow_request" : "request",
        requestId,
        ...(userId != null ? { userId } : {}),
        ...(companyId != null ? { companyId } : {}),
        status: statusCode,
        durationMs,
        responseBytes,
        cache: res.getHeader("X-ERP-Cache") || undefined,
        slow: isSlow,
      });
    };

    res.once("finish", finalize);
    res.once("close", finalize);

    if (!isReadMethod(req.method)) {
      // Any mutation can affect one or more summary endpoints. Invalidate before
      // route execution so a fast follow-up GET cannot observe an older snapshot.
      invalidateHeavyReadCache(req);
    }

    const cacheHit = getHeavyReadCache(req);
    if (cacheHit) {
      metrics.cacheHits += 1;
      installJsonResponseLimit(req, res);
      res.setHeader("X-ERP-Cache", "HIT");
      res.setHeader("Age", String(Math.max(0, Math.floor(cacheHit.ageMs / 1000))));
      res.setHeader("Cache-Control", "private, no-store");
      res.status(200).json(cacheHit.body);
      return;
    }

    const acquisition = tryAcquireHeavyRequestSlot(req);
    releaseHeavySlot = acquisition.slot?.release;
    installJsonResponseLimit(req, res, acquisition.slot?.policy);

    const cacheAwareJson = res.json.bind(res);
    (res as any).json = (body: unknown) => {
      if (res.statusCode < 400) {
        try {
          const serialized = JSON.stringify(body);
          if (serialized !== undefined) {
            const bytes = Buffer.byteLength(serialized);
            if (storeHeavyReadCache(req, body, bytes)) metrics.cacheMisses += 1;
          }
        } catch {
          // The normal response serializer remains authoritative.
        }
      }
      return cacheAwareJson(body);
    };

    if (acquisition.rejection) {
      metrics.rejectedByResourceGuard += 1;
      res.setHeader("Retry-After", String(acquisition.rejection.retryAfterSeconds));
      res.status(acquisition.rejection.status).json({
        message: acquisition.rejection.message,
        code: acquisition.rejection.code,
        retryAfterSeconds: acquisition.rejection.retryAfterSeconds,
        resource: acquisition.rejection.policy?.name,
      });
      return;
    }

    if (isResourceDraining()) {
      metrics.rejectedByResourceGuard += 1;
      res.setHeader("Retry-After", "15");
      res.status(503).json({
        message: "The server is restarting safely after reaching its memory limit. Please retry shortly.",
        code: "RESOURCE_DRAINING",
        retryAfterSeconds: 15,
      });
      return;
    }

    res.setHeader("X-ERP-Cache", "MISS");
  }

  next();
}
