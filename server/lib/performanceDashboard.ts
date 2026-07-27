import type { Request, Response } from "express";
import { pool } from "../db";
import { evaluateOperationalAlerts, getOperationalIncidentSnapshot } from "./operationalAlerts";
import { getRuntimePerformanceSnapshot } from "./runtimePerformance";

interface RequestSample { timestamp: number; method: string; routeTemplate: string; mode: string; status: number; durationMs: number; responseBytes: number; dbQueryCount: number; dbDurationMs: number; }
interface RouteAggregate { method: string; route: string; mode: string; count: number; errors: number; totalMs: number; maxMs: number; bytes: number; dbMs: number; durations: number[]; }

function finiteConfig(name: string, fallback: number, minimum: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

const WINDOW_MS = finiteConfig("PERFORMANCE_DASHBOARD_WINDOW_MS", 15 * 60_000, 60_000);
const MAX_SAMPLES = finiteConfig("PERFORMANCE_DASHBOARD_MAX_SAMPLES", 5_000, 500);
const samples: RequestSample[] = [];

function prune(now = Date.now()): void { const cutoff = now - WINDOW_MS; while (samples.length && samples[0].timestamp < cutoff) samples.shift(); if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES); }
function percentile(values: number[], ratio: number): number { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]); }
function modeForPath(path: string): string { if (path.startsWith("/api/factory/pos/") || path.startsWith("/api/pos/")) return "POS"; if (path.startsWith("/api/factory/")) return "Factory"; if (path.startsWith("/api/sp/")) return "Supplier Partner"; if (path.startsWith("/api/properties/")) return "Properties"; return "ERP"; }
export function recordPerformanceSample(input: Omit<RequestSample, "timestamp" | "mode">): void { samples.push({ ...input, timestamp: Date.now(), mode: modeForPath(input.routeTemplate) }); prune(); }
export function getPerformanceDashboardSnapshot() {
  prune();
  const memory = process.memoryUsage(), completed = samples.length, durations = samples.map((sample) => sample.durationMs), errors = samples.filter((sample) => sample.status >= 500).length;
  const slow = samples.filter((sample) => sample.durationMs >= finiteConfig("SLOW_REQUEST_MS", 500, 0)).length;
  const routeMap = new Map<string, RouteAggregate>();
  for (const sample of samples) {
    const key = `${sample.method} ${sample.routeTemplate}`;
    const row = routeMap.get(key) || { method: sample.method, route: sample.routeTemplate, mode: sample.mode, count: 0, errors: 0, totalMs: 0, maxMs: 0, bytes: 0, dbMs: 0, durations: [] };
    row.count += 1; row.errors += sample.status >= 500 ? 1 : 0; row.totalMs += sample.durationMs; row.maxMs = Math.max(row.maxMs, sample.durationMs); row.bytes += sample.responseBytes; row.dbMs += sample.dbDurationMs; row.durations.push(sample.durationMs); routeMap.set(key, row);
  }
  const routes = [...routeMap.values()].map(({ durations: routeDurations, ...row }) => ({ ...row, p95Ms: percentile(routeDurations, 0.95), averageMs: Math.round(row.totalMs / Math.max(1, row.count)), averageBytes: Math.round(row.bytes / Math.max(1, row.count)), averageDbMs: Math.round(row.dbMs / Math.max(1, row.count)) }));
  const byMode = ["ERP", "Factory", "Supplier Partner", "Properties", "POS"].map((mode) => { const modeSamples = samples.filter((sample) => sample.mode === mode); return { mode, requests: modeSamples.length, errors: modeSamples.filter((sample) => sample.status >= 500).length, p95Ms: percentile(modeSamples.map((sample) => sample.durationMs), 0.95) }; });
  const poolMax = Number((pool as any).options?.max || 0), poolTotal = Number((pool as any).totalCount || 0), poolIdle = Number((pool as any).idleCount || 0), runtime = getRuntimePerformanceSnapshot();
  return { timestamp: new Date().toISOString(), windowMinutes: Math.round(WINDOW_MS / 60_000), sampleLimit: MAX_SAMPLES, summary: { requests: completed, errors, errorPercent: completed ? Math.round((errors / completed) * 10_000) / 100 : 0, slow, p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95), p99Ms: percentile(durations, 0.99), responseBytes: samples.reduce((sum, sample) => sum + sample.responseBytes, 0), dbDurationMs: Math.round(samples.reduce((sum, sample) => sum + sample.dbDurationMs, 0)) }, memoryMb: { rss: Math.round(memory.rss / 1048576), heapUsed: Math.round(memory.heapUsed / 1048576), heapTotal: Math.round(memory.heapTotal / 1048576) }, databasePool: { max: poolMax, total: poolTotal, idle: poolIdle, active: Math.max(0, poolTotal - poolIdle), waiting: Number((pool as any).waitingCount || 0) }, byMode, slowestRoutes: [...routes].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 20), largestRoutes: [...routes].sort((a, b) => b.averageBytes - a.averageBytes).slice(0, 20), busiestRoutes: [...routes].sort((a, b) => b.count - a.count).slice(0, 20), runtime, backgroundJobs: runtime.backgroundJobs, externalDependencies: runtime.dependencies };
}
function escapeHtml(value: unknown): string { return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char] || char); }
function runtimeRows(rows: Array<{ name: string; source: string; calls: number; failures: number; averageMs: number; p95Ms: number; maxMs: number }>): string { return rows.map((row) => `<tr><td><code>${escapeHtml(row.name)}</code></td><td>${escapeHtml(row.source)}</td><td>${row.calls}</td><td>${row.p95Ms}</td><td>${row.averageMs}</td><td>${row.maxMs}</td><td>${row.failures}</td></tr>`).join(""); }
function isMonitoringRole(req: Request): boolean { const role = String((req as any).session?.currentRole || (req as any).user?.role || "").toLowerCase(); return role === "admin" || role === "developer"; }
function renderIncidents(res: Response): void { const snapshot = getOperationalIncidentSnapshot(); const rows = snapshot.active.map((incident) => `<tr><td>${escapeHtml(incident.severity)}</td><td>${escapeHtml(incident.title)}</td><td>${incident.observed}</td><td>${incident.threshold}</td><td>${incident.occurrences}</td><td>${escapeHtml(incident.lastSeenAt)}</td><td>${escapeHtml(incident.action)}</td></tr>`).join(""); const resolvedRows = snapshot.resolved.slice(0, 20).map((incident) => `<tr><td>${escapeHtml(incident.title)}</td><td>${escapeHtml(incident.firstSeenAt)}</td><td>${escapeHtml(incident.lastSeenAt)}</td><td>${incident.occurrences}</td></tr>`).join(""); res.status(200).type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="30"><title>ERP Incidents</title></head><body><h1>Operational Incidents</h1><p><a href="/api/health/incidents.json">JSON</a> · <a href="/api/health/performance">Performance</a></p><table><tbody>${rows || '<tr><td>No active incidents.</td></tr>'}</tbody></table><h2>Recently resolved</h2><table><tbody>${resolvedRows || '<tr><td>No resolved incidents in memory.</td></tr>'}</tbody></table></body></html>`); }
export function handlePerformanceDashboard(req: Request, res: Response): boolean {
  const paths = ["/api/health/performance", "/api/health/performance.json", "/api/health/incidents", "/api/health/incidents.json"];
  if (req.method !== "GET" || !paths.includes(req.path)) return false;
  if (!isMonitoringRole(req)) { res.status(403).json({ message: "Admin or Developer access required." }); return true; }
  const performance = getPerformanceDashboardSnapshot();
  if (req.path.startsWith("/api/health/incidents")) { if (process.env.OBSERVABILITY_ALERTS_ENABLED === "true") evaluateOperationalAlerts(performance); if (req.path.endsWith(".json")) res.status(200).json(getOperationalIncidentSnapshot()); else renderIncidents(res); return true; }
  if (req.path.endsWith(".json")) { res.status(200).json(performance); return true; }
  const rows = performance.slowestRoutes.map((row) => `<tr><td>${escapeHtml(row.mode)}</td><td>${escapeHtml(row.method)}</td><td><code>${escapeHtml(row.route)}</code></td><td>${row.count}</td><td>${row.p95Ms}</td><td>${row.averageMs}</td><td>${row.maxMs}</td><td>${row.averageDbMs}</td><td>${Math.round(row.averageBytes / 1024)} KB</td><td>${row.errors}</td></tr>`).join("");
  const modes = performance.byMode.map((row) => `<div><strong>${escapeHtml(row.mode)}</strong> ${row.requests} requests · p95 ${row.p95Ms} ms · ${row.errors} errors</div>`).join("");
  const jobs = runtimeRows(performance.runtime.backgroundJobs), dependencies = runtimeRows(performance.runtime.dependencies);
  res.status(200).type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="30"><title>ERP Performance</title></head><body><h1>Production Performance</h1><p>Bounded ${performance.windowMinutes}-minute window · maximum ${performance.sampleLimit} samples · <a href="/api/health/performance.json">JSON</a> · <a href="/api/health/incidents">Incidents</a></p>${modes}<h2>Slowest routes</h2><table><tbody>${rows || '<tr><td>No samples collected yet.</td></tr>'}</tbody></table><h2>Background jobs</h2><table><tbody>${jobs}</tbody></table><h2>External dependencies</h2><table><tbody>${dependencies}</tbody></table></body></html>`);
  return true;
}
