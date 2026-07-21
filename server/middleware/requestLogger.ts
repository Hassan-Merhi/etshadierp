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
import { logAudit } from "../routes/helpers/auditHelpers";

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

interface ActivityAuditMatch {
  action: string;
  tableName: string;
  recordId: number | null;
  recordIdentifier: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
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

function parseRouteId(path: string): number | null {
  const values = path.match(/\/(\d+)(?:\/|$)/g);
  if (!values?.length) return null;
  const value = Number(values[values.length - 1].replace(/\//g, ""));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function compactChanges(body: any, extra?: Record<string, unknown>): Record<string, { old: unknown; new: unknown }> | null {
  const safeKeys = [
    "status",
    "reason",
    "amount",
    "currency",
    "fxRate",
    "exchangeRate",
    "chargeDate",
    "date",
    "referenceNumber",
    "newReferenceNumber",
    "prefix",
    "pattern",
    "replacement",
    "affectedRows",
    "updated",
    "skipped",
    "scope",
    "mode",
  ];
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const key of safeKeys) {
    const value = body?.[key];
    if (value === undefined || value === null || typeof value === "object") continue;
    const text = typeof value === "string" ? value.slice(0, 160) : value;
    changes[key] = { old: null, new: text };
  }
  for (const [key, value] of Object.entries(extra || {})) {
    if (value !== undefined && value !== null) changes[key] = { old: null, new: value };
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

function classifySuccessfulActivity(req: Request): ActivityAuditMatch | null {
  const method = req.method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return null;
  const path = req.path.toLowerCase();
  const id = parseRouteId(path);
  const body = (req as any).body || {};

  // Customer-order delivery activity. Preview/download-only routes are deliberately excluded.
  if (path.includes("/api/factory/customer-orders/") && path.includes("whatsapp") && !path.includes("preview")) {
    return { action: "send_whatsapp", tableName: "factory_customer_orders", recordId: id, recordIdentifier: `Customer order #${id ?? "unknown"}`, changes: compactChanges(body, { delivery: "whatsapp" }) };
  }
  if (path.includes("/api/factory/customer-orders/") && path.includes("email") && !path.includes("preview")) {
    return { action: "send_email", tableName: "factory_customer_orders", recordId: id, recordIdentifier: `Customer order #${id ?? "unknown"}`, changes: compactChanges(body, { delivery: "email" }) };
  }

  // POS lifecycle actions not covered by the existing create/edit route-level logs.
  if (path.includes("/api/pos/") || path.includes("/api/factory/pos/")) {
    if (path.includes("return")) return { action: "return", tableName: "pos_sales", recordId: id, recordIdentifier: `POS sale #${id ?? "unknown"}`, changes: compactChanges(body) };
    if (path.includes("void")) return { action: "void", tableName: "pos_sales", recordId: id, recordIdentifier: `POS sale #${id ?? "unknown"}`, changes: compactChanges(body) };
    if (path.includes("cancel")) return { action: "cancel", tableName: "pos_sales", recordId: id, recordIdentifier: `POS sale #${id ?? "unknown"}`, changes: compactChanges(body) };
    if (method === "DELETE" && path.includes("sale")) return { action: "delete", tableName: "pos_sales", recordId: id, recordIdentifier: `POS sale #${id ?? "unknown"}`, changes: compactChanges(body) };
    if (path.includes("payment") && (method === "PATCH" || method === "PUT" || method === "POST")) return { action: "update", tableName: "pos_sales", recordId: id, recordIdentifier: `POS sale payment #${id ?? "unknown"}`, changes: compactChanges(body) };
  }

  // Apply-only factory recalculation and repair activity. Dry-run, preview and diagnostics never match.
  const excludedRepairRead = path.includes("dry-run") || path.includes("dryrun") || path.includes("preview") || path.includes("diagnostic");
  if (!excludedRepairRead && path.includes("/api/factory/") && (path.includes("recalculate") || path.includes("recalc")) && (path.includes("apply") || body?.apply === true || body?.dryRun === false)) {
    return { action: "recalculate", tableName: "factory_raw_stock", recordId: id, recordIdentifier: `Factory recalculation${id ? ` #${id}` : ""}`, changes: compactChanges(body, { mode: "apply" }) };
  }
  if (!excludedRepairRead && path.includes("/api/factory/") && (path.includes("repair") || path.includes("replay")) && (path.includes("apply") || body?.apply === true || body?.dryRun === false)) {
    const tableName = path.includes("fx") ? "factory_fx_repairs" : path.includes("landed") || path.includes("cost") ? "factory_landed_cost_repairs" : "factory_repairs";
    return { action: "repair", tableName, recordId: id, recordIdentifier: `Factory repair${id ? ` #${id}` : ""}`, changes: compactChanges(body, { mode: "apply" }) };
  }

  // Post-offload/container financial adjustments.
  if (path.includes("post-offload") || path.includes("post_offload")) {
    const action = method === "DELETE" ? "delete" : method === "POST" ? "create" : "update";
    return { action, tableName: "factory_post_offload_charges", recordId: id, recordIdentifier: `Post-offload charge #${id ?? "unknown"}`, changes: compactChanges(body) };
  }
  if (path.includes("reverse-offload") || path.includes("reverse_offload") || (path.includes("offload") && path.includes("reverse"))) {
    return { action: "reverse", tableName: "factory_containers", recordId: id, recordIdentifier: `Container/offload #${id ?? "unknown"}`, changes: compactChanges(body) };
  }
  if (path.includes("/api/factory/") && (path.includes("commission") || path.includes("freight") || path.includes("extra-charge") || path.includes("other-charge"))) {
    const action = method === "DELETE" ? "delete" : method === "POST" ? "create" : "update";
    const tableName = path.includes("commission") ? "factory_container_commissions" : path.includes("freight") ? "factory_container_freight" : "factory_container_extra_charges";
    return { action, tableName, recordId: id, recordIdentifier: `Container adjustment #${id ?? "unknown"}`, changes: compactChanges(body) };
  }

  // Remaining bale lifecycle operations. Existing ordinary status/weight/repack routes do not match.
  if (path.includes("/api/factory/bales") || path.includes("/api/factory/bale")) {
    if (path.includes("relabel") || path.includes("recode")) return { action: "update", tableName: "factory_bales", recordId: id, recordIdentifier: String(body?.referenceNumber || body?.barcode || `Bale #${id ?? "unknown"}`), changes: compactChanges(body, { operation: "relabel" }) };
    if (path.includes("restore") || path.includes("re-entry") || path.includes("reentry")) return { action: "restore", tableName: "factory_bales", recordId: id, recordIdentifier: String(body?.referenceNumber || body?.barcode || `Bale #${id ?? "unknown"}`), changes: compactChanges(body) };
    if (path.includes("merge")) return { action: "update", tableName: "factory_bales", recordId: id, recordIdentifier: `Bale merge${id ? ` #${id}` : ""}`, changes: compactChanges(body, { operation: "merge" }) };
    if (path.includes("split")) return { action: "create", tableName: "factory_bales", recordId: id, recordIdentifier: `Bale split${id ? ` #${id}` : ""}`, changes: compactChanges(body, { operation: "split" }) };
    if (method === "DELETE") return { action: "delete", tableName: "factory_bales", recordId: id, recordIdentifier: String(body?.referenceNumber || body?.barcode || `Bale #${id ?? "unknown"}`), changes: compactChanges(body) };
  }

  return null;
}

function writeSuccessfulActivityAudit(req: Request, statusCode: number): void {
  if (statusCode < 200 || statusCode >= 400) return;
  const match = classifySuccessfulActivity(req);
  if (!match) return;
  const session = (req as any).session;
  const userId = session?.userId || (req as any).user?.id;
  const companyId = session?.factoryCompanyId || session?.currentCompanyId;
  if (!userId || !companyId) return;

  void logAudit({
    userId,
    username: session?.username || String(userId),
    companyId: Number(companyId),
    action: match.action,
    tableName: match.tableName,
    recordId: match.recordId,
    recordIdentifier: match.recordIdentifier,
    changes: match.changes,
  }).catch((error: unknown) => {
    logger.warn("Activity audit write failed after successful request", {
      module: "activity-audit",
      action: match.action,
      path: req.path,
      error: error instanceof Error ? error.message : String(error),
    });
  });
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

  // Activity history must never fall back to an unscoped query. The route's
  // query builder supports legacy no-company sessions, which previously meant
  // a request made before company selection returned every company's audit
  // records. Fail closed until the ERP company is confirmed in the session.
  if (req.method === "GET" && req.path === "/api/audit-log") {
    const companyId = Number((req as any).session?.currentCompanyId);
    if (!Number.isSafeInteger(companyId) || companyId <= 0) {
      res.status(409).json({
        message: "Select a company before viewing activity history.",
        code: "AUDIT_COMPANY_REQUIRED",
      });
      return;
    }
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
    writeSuccessfulActivityAudit(req, statusCode);

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
