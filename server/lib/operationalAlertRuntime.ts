import type { Request, Response } from "express";
import { evaluateOperationalAlerts, getOperationalIncidentSnapshot } from "./operationalAlerts";
import { getPerformanceDashboardSnapshot } from "./performanceDashboard";
import { logger } from "./logger";

const INTERVAL_MS = Math.max(60_000, Number(process.env.OBSERVABILITY_ALERT_EVALUATION_MS || 60_000));
let timer: NodeJS.Timeout | undefined;

function evaluate(): void {
  if (process.env.OBSERVABILITY_ALERTS_ENABLED !== "true") return;
  try {
    evaluateOperationalAlerts(getPerformanceDashboardSnapshot());
  } catch (error) {
    logger.warn("Operational alert evaluation failed", {
      module: "observability-alerts",
      action: "evaluation_failed",
      error,
    });
  }
}

export function installOperationalAlertRuntime(): void {
  if (timer) return;
  timer = setInterval(evaluate, INTERVAL_MS);
  timer.unref();
}

function isMonitoringRole(req: Request): boolean {
  const role = String((req as any).session?.currentRole || (req as any).user?.role || "").toLowerCase();
  return role === "admin" || role === "developer";
}

export function handleOperationalIncidents(req: Request, res: Response): boolean {
  if (req.method !== "GET" || !["/api/health/incidents", "/api/health/incidents.json"].includes(req.path)) return false;
  if (!isMonitoringRole(req)) {
    res.status(403).json({ message: "Admin or Developer access required." });
    return true;
  }

  evaluate();
  const snapshot = getOperationalIncidentSnapshot();
  if (req.path.endsWith(".json")) {
    res.status(200).json(snapshot);
    return true;
  }

  const escape = (value: unknown) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char] || char);
  const rows = snapshot.active.map((incident) => `<tr><td>${escape(incident.severity)}</td><td>${escape(incident.title)}</td><td>${incident.observed}</td><td>${incident.threshold}</td><td>${incident.occurrences}</td><td>${escape(incident.lastSeenAt)}</td><td>${escape(incident.action)}</td></tr>`).join("");
  const resolvedRows = snapshot.resolved.slice(0, 20).map((incident) => `<tr><td>${escape(incident.title)}</td><td>${escape(incident.firstSeenAt)}</td><td>${escape(incident.lastSeenAt)}</td><td>${incident.occurrences}</td></tr>`).join("");

  res.status(200).type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="30"><title>ERP Incidents</title><style>body{font-family:system-ui;margin:0;background:#0b1020;color:#e8edf8;padding:24px}.muted{color:#9aa7bd}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:20px 0}.card{background:#141b2d;border:1px solid #27304a;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:6px}table{width:100%;border-collapse:collapse;background:#141b2d;margin-bottom:24px}th,td{text-align:left;padding:10px;border-bottom:1px solid #27304a;font-size:13px;vertical-align:top}th{color:#9aa7bd}a{color:#9fd3ff}</style></head><body><h1>Operational Incidents</h1><p class="muted">Auto-refreshes every 30 seconds · <a href="/api/health/incidents.json">JSON</a> · <a href="/api/health/performance">Performance</a></p><div class="grid"><div class="card"><strong>${snapshot.active.length}</strong><span>Active incidents</span></div><div class="card"><strong>${snapshot.cooldownMinutes} min</strong><span>Notification cooldown</span></div><div class="card"><strong>${snapshot.alertsEnabled ? "Enabled" : "Disabled"}</strong><span>Alert evaluation</span></div><div class="card"><strong>${snapshot.deliveryConfigured ? "Configured" : "Not configured"}</strong><span>External delivery</span></div></div><h2>Active</h2><table><thead><tr><th>Severity</th><th>Incident</th><th>Observed</th><th>Threshold</th><th>Occurrences</th><th>Last seen</th><th>Recommended action</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No active incidents.</td></tr>'}</tbody></table><h2>Recently resolved</h2><table><thead><tr><th>Incident</th><th>First seen</th><th>Resolved</th><th>Occurrences</th></tr></thead><tbody>${resolvedRows || '<tr><td colspan="4">No resolved incidents in memory.</td></tr>'}</tbody></table></body></html>`);
  return true;
}
