import fs from "fs";
import type { Request, Response } from "express";
import { logger } from "./logger";

type MemoryPressureLevel = "normal" | "warning" | "critical" | "hard";
type RejectionCode =
  | "RESOURCE_DRAINING"
  | "MEMORY_PRESSURE"
  | "HEAVY_REQUEST_LIMIT"
  | "RESPONSE_TOO_LARGE";

interface HeavyRequestPolicy {
  name: string;
  maxConcurrent: number;
  maxJsonBytes: number;
}

interface HeavyRequestSlot {
  release: () => void;
  policy: HeavyRequestPolicy;
}

interface RequestSlotRejection {
  status: 429 | 503;
  code: Exclude<RejectionCode, "RESPONSE_TOO_LARGE">;
  message: string;
  retryAfterSeconds: number;
  policy?: HeavyRequestPolicy;
}

interface ExclusiveTaskLock {
  name: string;
  owner: string;
  startedAt: number;
}

const MB = 1024 * 1024;
const DEFAULT_MEMORY_LIMIT_MB = 2048;
const DEFAULT_WARNING_PERCENT = 70;
const DEFAULT_CRITICAL_PERCENT = 82;
const DEFAULT_HARD_PERCENT = 92;
const DEFAULT_MONITOR_INTERVAL_MS = 15_000;
const DEFAULT_DRAIN_TIMEOUT_MS = 15_000;
const DEFAULT_API_JSON_LIMIT_MB = 25;

const activeHeavyRequests = new Map<string, number>();
const exclusiveTasks = new Map<string, ExclusiveTaskLock>();
const rejectionCounts = {
  total: 0,
  byCode: {} as Record<string, number>,
  byResource: {} as Record<string, number>,
};

let activeApiRequests = 0;
let monitorStarted = false;
let draining = false;
let drainReason: string | null = null;
let drainStartedAt: number | null = null;
let forcedExitTimer: NodeJS.Timeout | null = null;
let cleanExitTimer: NodeJS.Timeout | null = null;
let lastWarningLogAt = 0;
let lastCriticalLogAt = 0;
let lastHardLogAt = 0;

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNumericFile(paths: string[]): number | null {
  for (const file of paths) {
    try {
      const raw = fs.readFileSync(file, "utf8").trim();
      if (!raw || raw === "max") continue;
      const bytes = Number(raw);
      if (Number.isFinite(bytes) && bytes >= 0) return bytes;
    } catch {
      // Try the next cgroup layout.
    }
  }
  return null;
}

function readCgroupLimitMb(): number | null {
  const bytes = readNumericFile([
    "/sys/fs/cgroup/memory.max",
    "/sys/fs/cgroup/memory/memory.limit_in_bytes",
  ]);
  // Ignore effectively-unlimited sentinel values.
  if (bytes === null || bytes <= 0 || bytes > 1024 ** 5) return null;
  return Math.max(1, Math.floor(bytes / MB));
}

function readCgroupCurrentMb(): number | null {
  const bytes = readNumericFile([
    "/sys/fs/cgroup/memory.current",
    "/sys/fs/cgroup/memory/memory.usage_in_bytes",
  ]);
  return bytes === null ? null : Math.max(0, bytes / MB);
}

const configuredMemoryLimitMb = Number(process.env.APP_MEMORY_LIMIT_MB);
const detectedMemoryLimitMb = readCgroupLimitMb();
const memoryLimitMb =
  Number.isFinite(configuredMemoryLimitMb) && configuredMemoryLimitMb > 0
    ? configuredMemoryLimitMb
    : detectedMemoryLimitMb || DEFAULT_MEMORY_LIMIT_MB;

const warningPercent = positiveNumber(process.env.MEMORY_WARNING_PERCENT, DEFAULT_WARNING_PERCENT);
const criticalPercent = Math.max(
  warningPercent + 1,
  positiveNumber(process.env.MEMORY_CRITICAL_PERCENT, DEFAULT_CRITICAL_PERCENT)
);
const hardPercent = Math.max(
  criticalPercent + 1,
  positiveNumber(process.env.MEMORY_HARD_PERCENT, DEFAULT_HARD_PERCENT)
);
const monitorIntervalMs = positiveNumber(process.env.MEMORY_MONITOR_INTERVAL_MS, DEFAULT_MONITOR_INTERVAL_MS);
const drainTimeoutMs = positiveNumber(process.env.MEMORY_DRAIN_TIMEOUT_MS, DEFAULT_DRAIN_TIMEOUT_MS);
const defaultApiJsonLimitBytes =
  positiveNumber(process.env.MAX_API_JSON_RESPONSE_MB, DEFAULT_API_JSON_LIMIT_MB) * MB;

function pressureLevelFor(usedMb: number): MemoryPressureLevel {
  const percent = (usedMb / memoryLimitMb) * 100;
  if (percent >= hardPercent) return "hard";
  if (percent >= criticalPercent) return "critical";
  if (percent >= warningPercent) return "warning";
  return "normal";
}

function currentMemorySnapshot() {
  const usage = process.memoryUsage();
  const rssMbRaw = usage.rss / MB;
  const cgroupCurrentMbRaw = readCgroupCurrentMb();

  // cgroup memory includes Node, Chrome, export workers and filesystem cache—the
  // same total the hosting platform uses to OOM-kill the service. Fall back to
  // Node RSS only where cgroups are unavailable.
  const effectiveUsedMbRaw = cgroupCurrentMbRaw ?? rssMbRaw;
  const utilizationPercent = (effectiveUsedMbRaw / memoryLimitMb) * 100;

  return {
    level: pressureLevelFor(effectiveUsedMbRaw),
    source: cgroupCurrentMbRaw === null ? "process-rss" : "cgroup-container",
    limitMb: Math.round(memoryLimitMb),
    detectedCgroupLimitMb: detectedMemoryLimitMb,
    effectiveUsedMb: Math.round(effectiveUsedMbRaw),
    cgroupCurrentMb: cgroupCurrentMbRaw === null ? null : Math.round(cgroupCurrentMbRaw),
    rssMb: Math.round(rssMbRaw),
    heapUsedMb: Math.round(usage.heapUsed / MB),
    heapTotalMb: Math.round(usage.heapTotal / MB),
    externalMb: Math.round(usage.external / MB),
    arrayBuffersMb: Math.round(usage.arrayBuffers / MB),
    utilizationPercent: Math.round(utilizationPercent * 10) / 10,
    thresholds: {
      warningPercent,
      criticalPercent,
      hardPercent,
    },
  };
}

function recordRejection(code: RejectionCode, resource = "global"): void {
  rejectionCounts.total += 1;
  rejectionCounts.byCode[code] = (rejectionCounts.byCode[code] || 0) + 1;
  rejectionCounts.byResource[resource] = (rejectionCounts.byResource[resource] || 0) + 1;
}

function scheduleCleanExitIfDrained(): void {
  if (!draining || process.env.NODE_ENV !== "production" || activeApiRequests > 0 || cleanExitTimer) return;

  cleanExitTimer = setTimeout(() => {
    logger.error("Resource guard exiting after active requests drained", {
      module: "resource-guard",
      action: "graceful-exit",
      reason: drainReason,
      activeApiRequests,
    });
    process.exit(1);
  }, 250);
  cleanExitTimer.unref();
}

function beginDrain(reason: string): void {
  if (draining) return;

  draining = true;
  drainReason = reason;
  drainStartedAt = Date.now();

  logger.error("Resource guard entered drain mode", {
    module: "resource-guard",
    action: "begin-drain",
    reason,
    activeApiRequests,
    memory: currentMemorySnapshot(),
  });

  if (process.env.NODE_ENV === "production" && !forcedExitTimer) {
    forcedExitTimer = setTimeout(() => {
      logger.error("Resource guard forced process restart after drain timeout", {
        module: "resource-guard",
        action: "forced-exit",
        reason: drainReason,
        activeApiRequests,
        timeoutMs: drainTimeoutMs,
      });
      process.exit(1);
    }, drainTimeoutMs);
    forcedExitTimer.unref();
  }

  scheduleCleanExitIfDrained();
}

function evaluateMemoryPressure(): ReturnType<typeof currentMemorySnapshot> {
  const snapshot = currentMemorySnapshot();
  const now = Date.now();

  if (snapshot.level === "hard") {
    if (now - lastHardLogAt >= 30_000) {
      lastHardLogAt = now;
      logger.error("Hard container memory limit reached", {
        module: "resource-guard",
        action: "memory-hard",
        memory: snapshot,
      });
    }
    beginDrain("container-memory-hard-limit");
  } else if (snapshot.level === "critical") {
    if (now - lastCriticalLogAt >= 30_000) {
      lastCriticalLogAt = now;
      logger.warn("Critical container memory pressure detected", {
        module: "resource-guard",
        action: "memory-critical",
        memory: snapshot,
      });
    }
  } else if (snapshot.level === "warning" && now - lastWarningLogAt >= 60_000) {
    lastWarningLogAt = now;
    logger.warn("Elevated container memory usage detected", {
      module: "resource-guard",
      action: "memory-warning",
      memory: snapshot,
    });
  }

  return snapshot;
}

function getCompanyScope(req: Request): string {
  const session = (req as any).session;
  const companyId = session?.factoryCompanyId || session?.currentCompanyId;
  return companyId == null ? "global" : String(companyId);
}

function getHeavyRequestPolicy(req: Request): HeavyRequestPolicy | null {
  if (req.method !== "GET") return null;
  const path = req.path;

  if (path === "/api/factory/net-position") {
    return {
      name: "factory-net-position",
      maxConcurrent: positiveNumber(process.env.NET_POSITION_MAX_CONCURRENT, 1),
      maxJsonBytes: positiveNumber(process.env.NET_POSITION_MAX_RESPONSE_MB, 8) * MB,
    };
  }

  if (path === "/api/factory/raw-stock") {
    return {
      name: "factory-raw-stock",
      maxConcurrent: positiveNumber(process.env.RAW_STOCK_MAX_CONCURRENT, 2),
      maxJsonBytes: positiveNumber(process.env.RAW_STOCK_MAX_RESPONSE_MB, 12) * MB,
    };
  }

  if (path === "/api/factory/bale-ledger") {
    return {
      name: "factory-bale-ledger",
      maxConcurrent: positiveNumber(process.env.BALE_LEDGER_MAX_CONCURRENT, 2),
      maxJsonBytes: positiveNumber(process.env.BALE_LEDGER_MAX_RESPONSE_MB, 12) * MB,
    };
  }

  if (path === "/api/factory/bale-stock-count") {
    return {
      name: "factory-bale-stock-count",
      maxConcurrent: positiveNumber(process.env.BALE_STOCK_COUNT_MAX_CONCURRENT, 2),
      maxJsonBytes: positiveNumber(process.env.BALE_STOCK_COUNT_MAX_RESPONSE_MB, 4) * MB,
    };
  }

  if (path.startsWith("/api/factory/customer-orders")) {
    return {
      name: "factory-customer-orders",
      maxConcurrent: positiveNumber(process.env.CUSTOMER_ORDERS_MAX_CONCURRENT, 6),
      maxJsonBytes: positiveNumber(process.env.CUSTOMER_ORDERS_MAX_RESPONSE_MB, 10) * MB,
    };
  }

  return null;
}

export function startResourceGuard(): void {
  if (monitorStarted) return;
  monitorStarted = true;

  logger.info("Resource guard started", {
    module: "resource-guard",
    action: "start",
    memoryLimitMb: Math.round(memoryLimitMb),
    detectedMemoryLimitMb,
    warningPercent,
    criticalPercent,
    hardPercent,
    monitorIntervalMs,
  });

  evaluateMemoryPressure();
  const timer = setInterval(evaluateMemoryPressure, monitorIntervalMs);
  timer.unref();
}

export function beginTrackedApiRequest(): void {
  activeApiRequests += 1;
}

export function endTrackedApiRequest(): void {
  activeApiRequests = Math.max(0, activeApiRequests - 1);
  scheduleCleanExitIfDrained();
}

export function isResourceDraining(): boolean {
  return draining;
}

export function getResourceGuardSnapshot() {
  return {
    draining,
    drainReason,
    drainStartedAt: drainStartedAt ? new Date(drainStartedAt).toISOString() : null,
    activeApiRequests,
    memory: currentMemorySnapshot(),
    activeHeavyRequests: Object.fromEntries(activeHeavyRequests.entries()),
    rejectionCounts: {
      total: rejectionCounts.total,
      byCode: { ...rejectionCounts.byCode },
      byResource: { ...rejectionCounts.byResource },
    },
    exclusiveTasks: Array.from(exclusiveTasks.values()).map((task) => ({
      name: task.name,
      owner: task.owner,
      startedAt: new Date(task.startedAt).toISOString(),
      runningMs: Date.now() - task.startedAt,
    })),
  };
}

export function tryAcquireHeavyRequestSlot(
  req: Request
): { slot?: HeavyRequestSlot; rejection?: RequestSlotRejection } {
  const policy = getHeavyRequestPolicy(req);
  const memory = evaluateMemoryPressure();
  const resource = policy?.name || "global";

  if (draining) {
    recordRejection("RESOURCE_DRAINING", resource);
    return {
      rejection: {
        status: 503,
        code: "RESOURCE_DRAINING",
        message: "The server is restarting safely after reaching its memory limit. Please retry shortly.",
        retryAfterSeconds: 15,
        policy: policy || undefined,
      },
    };
  }

  if (!policy) return {};

  if (memory.level === "critical" || memory.level === "hard") {
    recordRejection("MEMORY_PRESSURE", resource);
    return {
      rejection: {
        status: 503,
        code: "MEMORY_PRESSURE",
        message: "This heavy request is temporarily paused because the server is under memory pressure.",
        retryAfterSeconds: 10,
        policy,
      },
    };
  }

  const key = `${policy.name}:${getCompanyScope(req)}`;
  const current = activeHeavyRequests.get(key) || 0;

  if (current >= policy.maxConcurrent) {
    recordRejection("HEAVY_REQUEST_LIMIT", resource);
    return {
      rejection: {
        status: 429,
        code: "HEAVY_REQUEST_LIMIT",
        message: "Too many heavy requests are already running for this company. Please retry shortly.",
        retryAfterSeconds: 3,
        policy,
      },
    };
  }

  activeHeavyRequests.set(key, current + 1);
  let released = false;

  return {
    slot: {
      policy,
      release: () => {
        if (released) return;
        released = true;
        const next = Math.max(0, (activeHeavyRequests.get(key) || 1) - 1);
        if (next === 0) activeHeavyRequests.delete(key);
        else activeHeavyRequests.set(key, next);
      },
    },
  };
}

export function installJsonResponseLimit(req: Request, res: Response, policy?: HeavyRequestPolicy): void {
  if (!req.path.startsWith("/api/")) return;

  const maxBytes = policy?.maxJsonBytes || defaultApiJsonLimitBytes;
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  (res as any).json = (body: unknown) => {
    let serialized: string | undefined;

    try {
      const preSerialized = (res.locals as any).preSerializedJson;
      serialized = typeof preSerialized === "string" ? preSerialized : JSON.stringify(body);
      delete (res.locals as any).preSerializedJson;
    } catch {
      return originalJson(body);
    }

    if (serialized === undefined) return originalJson(body);

    const actualBytes = Buffer.byteLength(serialized);
    (res.locals as any).responseBytes = actualBytes;

    if (actualBytes > maxBytes) {
      recordRejection("RESPONSE_TOO_LARGE", policy?.name || req.path);
      logger.warn("JSON response blocked because it exceeded the configured limit", {
        module: "resource-guard",
        action: "response-too-large",
        method: req.method,
        path: req.path,
        actualBytes,
        maxBytes,
        policy: policy?.name,
      });

      res.status(413);
      return originalJson({
        message: "The requested dataset is too large to return safely. Narrow the date range or filters.",
        code: "RESPONSE_TOO_LARGE",
        maxBytes,
        actualBytes,
      });
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return originalSend(serialized);
  };
}

export function tryAcquireExclusiveTask(name: string, owner: string): (() => void) | null {
  if (exclusiveTasks.has(name)) return null;

  exclusiveTasks.set(name, {
    name,
    owner,
    startedAt: Date.now(),
  });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    exclusiveTasks.delete(name);
  };
}
