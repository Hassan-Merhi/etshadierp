import { getOperationalEventSnapshot } from "../../lib/operationalEvents";
import { getRequestMetricsSnapshot } from "../../middleware/requestLogger";

export type OperationalHealthStatus = "ok" | "degraded" | "critical";

export interface OperationalAlert {
  code: string;
  status: Exclude<OperationalHealthStatus, "ok">;
  message: string;
  value: number;
  threshold: number;
  unit: string;
}

export interface OperationalThresholds {
  serverErrorPercentWarning: number;
  serverErrorPercentCritical: number;
  slowRequestPercentWarning: number;
  slowRequestPercentCritical: number;
  databasePoolWaitingWarning: number;
  heapUsedMbWarning: number;
  heapUsedMbCritical: number;
  recentCriticalEventsWarning: number;
}

const DEFAULT_THRESHOLDS: OperationalThresholds = {
  serverErrorPercentWarning: Number(process.env.OPS_SERVER_ERROR_WARNING_PERCENT || 1),
  serverErrorPercentCritical: Number(process.env.OPS_SERVER_ERROR_CRITICAL_PERCENT || 5),
  slowRequestPercentWarning: Number(process.env.OPS_SLOW_REQUEST_WARNING_PERCENT || 10),
  slowRequestPercentCritical: Number(process.env.OPS_SLOW_REQUEST_CRITICAL_PERCENT || 30),
  databasePoolWaitingWarning: Number(process.env.OPS_DB_POOL_WAITING_WARNING || 1),
  heapUsedMbWarning: Number(process.env.OPS_HEAP_WARNING_MB || 768),
  heapUsedMbCritical: Number(process.env.OPS_HEAP_CRITICAL_MB || 1024),
  recentCriticalEventsWarning: Number(process.env.OPS_RECENT_CRITICAL_EVENTS_WARNING || 1),
};

function finiteThreshold(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function getOperationalThresholds(): OperationalThresholds {
  return {
    serverErrorPercentWarning: finiteThreshold(DEFAULT_THRESHOLDS.serverErrorPercentWarning, 1),
    serverErrorPercentCritical: finiteThreshold(DEFAULT_THRESHOLDS.serverErrorPercentCritical, 5),
    slowRequestPercentWarning: finiteThreshold(DEFAULT_THRESHOLDS.slowRequestPercentWarning, 10),
    slowRequestPercentCritical: finiteThreshold(DEFAULT_THRESHOLDS.slowRequestPercentCritical, 30),
    databasePoolWaitingWarning: finiteThreshold(DEFAULT_THRESHOLDS.databasePoolWaitingWarning, 1),
    heapUsedMbWarning: finiteThreshold(DEFAULT_THRESHOLDS.heapUsedMbWarning, 768),
    heapUsedMbCritical: finiteThreshold(DEFAULT_THRESHOLDS.heapUsedMbCritical, 1024),
    recentCriticalEventsWarning: finiteThreshold(DEFAULT_THRESHOLDS.recentCriticalEventsWarning, 1),
  };
}

function addThresholdAlert(
  alerts: OperationalAlert[],
  input: {
    code: string;
    message: string;
    value: number;
    warning: number;
    critical?: number;
    unit: string;
  },
): void {
  if (input.critical !== undefined && input.value >= input.critical) {
    alerts.push({
      code: input.code,
      status: "critical",
      message: input.message,
      value: input.value,
      threshold: input.critical,
      unit: input.unit,
    });
    return;
  }
  if (input.value >= input.warning) {
    alerts.push({
      code: input.code,
      status: "degraded",
      message: input.message,
      value: input.value,
      threshold: input.warning,
      unit: input.unit,
    });
  }
}

export function evaluateOperationalHealth(
  metrics: ReturnType<typeof getRequestMetricsSnapshot>,
  thresholds: OperationalThresholds = getOperationalThresholds(),
) {
  const alerts: OperationalAlert[] = [];
  const recentCriticalEvents = metrics.operationalEvents.recent.filter(
    (event) => event.severity === "critical",
  ).length;

  addThresholdAlert(alerts, {
    code: "http_server_error_rate",
    message: "HTTP server error rate is above the operational threshold.",
    value: metrics.requests.serverErrorPercent,
    warning: thresholds.serverErrorPercentWarning,
    critical: thresholds.serverErrorPercentCritical,
    unit: "percent",
  });
  addThresholdAlert(alerts, {
    code: "slow_request_rate",
    message: "Slow request rate is above the operational threshold.",
    value: metrics.requests.slowPercent,
    warning: thresholds.slowRequestPercentWarning,
    critical: thresholds.slowRequestPercentCritical,
    unit: "percent",
  });
  addThresholdAlert(alerts, {
    code: "database_pool_waiting",
    message: "Database requests are waiting for a pooled connection.",
    value: metrics.databasePool.waiting,
    warning: thresholds.databasePoolWaitingWarning,
    unit: "connections",
  });
  addThresholdAlert(alerts, {
    code: "heap_usage",
    message: "Node.js heap usage is above the operational threshold.",
    value: metrics.process.memoryMb.heapUsed,
    warning: thresholds.heapUsedMbWarning,
    critical: thresholds.heapUsedMbCritical,
    unit: "MB",
  });
  addThresholdAlert(alerts, {
    code: "recent_critical_events",
    message: "Recent critical operational events require review.",
    value: recentCriticalEvents,
    warning: thresholds.recentCriticalEventsWarning,
    unit: "events",
  });

  const status: OperationalHealthStatus = alerts.some((alert) => alert.status === "critical")
    ? "critical"
    : alerts.length > 0 || metrics.status === "degraded"
      ? "degraded"
      : "ok";

  return {
    status,
    alerts,
    recentCriticalEvents,
  };
}

export function getOperationalHealthSnapshot() {
  const metrics = getRequestMetricsSnapshot();
  const thresholds = getOperationalThresholds();
  const evaluation = evaluateOperationalHealth(metrics, thresholds);
  const events = getOperationalEventSnapshot();

  return {
    status: evaluation.status,
    generatedAt: new Date().toISOString(),
    buildVersion: process.env.BUILD_VERSION || process.env.RENDER_GIT_COMMIT?.substring(0, 8) || "dev",
    thresholds,
    alerts: evaluation.alerts,
    summary: {
      uptimeSeconds: metrics.process.uptimeSeconds,
      serverErrorPercent: metrics.requests.serverErrorPercent,
      slowRequestPercent: metrics.requests.slowPercent,
      activeRequests: metrics.requests.active,
      databasePoolWaiting: metrics.databasePool.waiting,
      databasePoolUtilizationPercent: metrics.databasePool.utilizationPercent,
      heapUsedMb: metrics.process.memoryMb.heapUsed,
      recentCriticalEvents: evaluation.recentCriticalEvents,
    },
    metrics,
    events,
  };
}
