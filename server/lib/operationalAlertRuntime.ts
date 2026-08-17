import type { Request, Response } from "express";
import { evaluateOperationalAlerts, getOperationalIncidentSnapshot } from "./operationalAlerts";
import { getPerformanceDashboardSnapshot } from "./performanceDashboard";
import { logger } from "./logger";

const parsedInterval = Number(process.env.OBSERVABILITY_ALERT_EVALUATION_MS);
const INTERVAL_MS = Number.isFinite(parsedInterval) ? Math.max(60_000, parsedInterval) : 60_000;
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
  const role = String(req.session?.currentRole || req.user?.role || "").toLowerCase();
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
  res
    .status(200)
    .type("html")
    .send(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="30"><title>ERP Incidents</title></head><body><h1>Operational Incidents</h1><p><a href="/api/health/incidents.json">JSON</a> · <a href="/api/health/performance">Performance</a></p><pre>${JSON.stringify(snapshot, null, 2)}</pre></body></html>`
    );
  return true;
}
