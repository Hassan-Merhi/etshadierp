import { logger } from "./logger";

export type AlertSeverity = "warning" | "critical";
export interface PerformanceAlertInput {
  timestamp: string;
  summary: { requests: number; errorPercent: number; p95Ms: number };
  memoryMb: { rss: number; heapUsed: number; heapTotal: number };
  databasePool: { max: number; active: number; waiting: number };
  backgroundJobs: Array<{ name: string; calls: number; failures: number; p95Ms: number }>;
  externalDependencies: Array<{ name: string; calls: number; failures: number; p95Ms: number }>;
}
export interface OperationalIncident {
  key: string; title: string; severity: AlertSeverity; status: "active" | "resolved";
  firstSeenAt: string; lastSeenAt: string; lastNotifiedAt?: string; occurrences: number;
  observed: number; threshold: number; action: string;
}

function finiteConfig(name: string, fallback: number, minimum: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}
const incidents = new Map<string, OperationalIncident>();
const resolved: OperationalIncident[] = [];
const MAX_RESOLVED = finiteConfig("OBSERVABILITY_ALERT_HISTORY_LIMIT", 100, 20);
const COOLDOWN_MS = finiteConfig("OBSERVABILITY_ALERT_COOLDOWN_MS", 15 * 60_000, 60_000);
const ALERT_WEBHOOK_URL = process.env.OBSERVABILITY_ALERT_WEBHOOK_URL?.trim();
const ALERT_WEBHOOK_TOKEN = process.env.OBSERVABILITY_ALERT_WEBHOOK_TOKEN?.trim();
function threshold(name: string, fallback: number): number { const value = Number(process.env[name]); return Number.isFinite(value) && value >= 0 ? value : fallback; }

async function deliver(incident: OperationalIncident): Promise<void> {
  if (!ALERT_WEBHOOK_URL) return;
  try {
    const response = await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(ALERT_WEBHOOK_TOKEN ? { Authorization: `Bearer ${ALERT_WEBHOOK_TOKEN}` } : {}) },
      body: JSON.stringify({ type: "erp_operational_alert", incident }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`Alert webhook returned HTTP ${response.status}`);
  } catch (error) {
    logger.warn("Operational alert delivery failed", { module: "observability-alerts", action: "delivery_failed", alertKey: incident.key, error });
  }
}

function activate(input: Omit<OperationalIncident, "status" | "firstSeenAt" | "lastSeenAt" | "occurrences">): void {
  const now = new Date().toISOString();
  const existing = incidents.get(input.key);
  const incident: OperationalIncident = existing
    ? { ...existing, ...input, status: "active", lastSeenAt: now, occurrences: existing.occurrences + 1 }
    : { ...input, status: "active", firstSeenAt: now, lastSeenAt: now, occurrences: 1 };
  incidents.set(input.key, incident);
  const lastNotified = incident.lastNotifiedAt ? new Date(incident.lastNotifiedAt).getTime() : 0;
  if (Date.now() - lastNotified < COOLDOWN_MS) return;
  incident.lastNotifiedAt = now;
  logger[incident.severity === "critical" ? "error" : "warn"](incident.title, {
    module: "observability-alerts", action: "incident_active", alertKey: incident.key,
    severity: incident.severity, observed: incident.observed, threshold: incident.threshold,
    recommendedAction: incident.action,
  });
  void deliver(incident);
}

function resolveMissing(activeKeys: Set<string>): void {
  const now = new Date().toISOString();
  for (const [key, incident] of incidents) {
    if (activeKeys.has(key)) continue;
    const item = { ...incident, status: "resolved" as const, lastSeenAt: now };
    incidents.delete(key); resolved.unshift(item); if (resolved.length > MAX_RESOLVED) resolved.length = MAX_RESOLVED;
    logger.info(`Resolved: ${incident.title}`, { module: "observability-alerts", action: "incident_resolved", alertKey: key, occurrences: incident.occurrences });
    void deliver(item);
  }
}

export function evaluateOperationalAlerts(snapshot: PerformanceAlertInput): void {
  const activeKeys = new Set<string>();
  const rules = [
    { key: "http-5xx-rate", title: "HTTP 5xx rate is elevated", severity: "critical" as const, observed: snapshot.summary.errorPercent, threshold: threshold("OBSERVABILITY_ALERT_5XX_PERCENT", 5), enabled: snapshot.summary.requests >= threshold("OBSERVABILITY_ALERT_MIN_REQUESTS", 20), action: "Identify the failing route template and correlate request IDs with server logs." },
    { key: "http-p95-latency", title: "HTTP p95 latency is elevated", severity: "warning" as const, observed: snapshot.summary.p95Ms, threshold: threshold("OBSERVABILITY_ALERT_P95_MS", 2_000), enabled: snapshot.summary.requests >= threshold("OBSERVABILITY_ALERT_MIN_REQUESTS", 20), action: "Review slow routes, database duration, response size, and pool pressure." },
    { key: "memory-rss", title: "Process memory pressure is elevated", severity: "critical" as const, observed: snapshot.memoryMb.rss, threshold: threshold("OBSERVABILITY_ALERT_RSS_MB", 900), enabled: true, action: "Check large responses, polling, exports, and memory growth before restarting." },
    { key: "database-pool-waiting", title: "Database pool has waiting requests", severity: "critical" as const, observed: snapshot.databasePool.waiting, threshold: threshold("OBSERVABILITY_ALERT_DB_WAITING", 1), enabled: true, action: "Inspect long database routes, scheduled jobs, transactions, and connection release paths." },
  ];
  for (const rule of rules) if (rule.enabled && rule.observed >= rule.threshold) { activeKeys.add(rule.key); activate(rule); }
  for (const job of snapshot.backgroundJobs) {
    const limit = threshold("OBSERVABILITY_ALERT_JOB_FAILURES", 1); if (job.failures < limit) continue;
    const key = `job-failure:${job.name}`; activeKeys.add(key); activate({ key, title: `Scheduled job failures: ${job.name}`, severity: "critical", observed: job.failures, threshold: limit, action: "Review scheduler request IDs and dependent export, email, WhatsApp, and database logs." });
  }
  for (const dependency of snapshot.externalDependencies) {
    const limit = threshold("OBSERVABILITY_ALERT_DEPENDENCY_FAILURES", 1); if (dependency.failures < limit) continue;
    const key = `dependency-failure:${dependency.name}`; activeKeys.add(key); activate({ key, title: `External dependency failures: ${dependency.name}`, severity: "warning", observed: dependency.failures, threshold: limit, action: "Confirm provider availability and credentials, then correlate the dependency span." });
  }
  resolveMissing(activeKeys);
}

export function getOperationalIncidentSnapshot() {
  return { timestamp: new Date().toISOString(), cooldownMinutes: Math.round(COOLDOWN_MS / 60_000), alertsEnabled: process.env.OBSERVABILITY_ALERTS_ENABLED === "true", deliveryConfigured: Boolean(ALERT_WEBHOOK_URL), active: [...incidents.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)), resolved: [...resolved] };
}
