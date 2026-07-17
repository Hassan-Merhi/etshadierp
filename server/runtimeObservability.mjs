import { monitorEventLoopDelay } from "node:perf_hooks";
import { Server } from "node:http";

const startedAt = Date.now();
const slowRequestMs = Number.parseInt(process.env.SLOW_REQUEST_MS || "1000", 10);
const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

const metrics = {
  activeRequests: 0,
  totalRequests: 0,
  total5xx: 0,
  slowRequests: 0,
  maxActiveRequests: 0,
  last5xxAt: null,
};

globalThis.__erpRuntimeMetrics = metrics;

function pathnameOf(req) {
  try { return new URL(req.url || "/", "http://localhost").pathname; }
  catch { return req.url || "/"; }
}

function snapshot() {
  const memory = process.memoryUsage();
  return {
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    requests: { ...metrics },
    eventLoop: {
      meanMs: Number.isFinite(histogram.mean) ? Number((histogram.mean / 1e6).toFixed(2)) : 0,
      maxMs: Number((histogram.max / 1e6).toFixed(2)),
      p95Ms: Number((histogram.percentile(95) / 1e6).toFixed(2)),
      p99Ms: Number((histogram.percentile(99) / 1e6).toFixed(2)),
    },
    memory: {
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      externalMb: Math.round(memory.external / 1024 / 1024),
    },
  };
}

function log(level, action, details) {
  console[level === "ERROR" ? "error" : level === "WARN" ? "warn" : "log"](JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    module: "runtime-observability",
    action,
    ...details,
  }));
}

const originalEmit = Server.prototype.emit;
Server.prototype.emit = function observableEmit(event, ...args) {
  if (event !== "request") return originalEmit.call(this, event, ...args);
  const [req, res] = args;
  const path = pathnameOf(req);

  if (path === "/api/health/metrics") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(snapshot()));
    return true;
  }

  const started = Date.now();
  metrics.totalRequests += 1;
  metrics.activeRequests += 1;
  metrics.maxActiveRequests = Math.max(metrics.maxActiveRequests, metrics.activeRequests);
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    metrics.activeRequests = Math.max(0, metrics.activeRequests - 1);
    const durationMs = Date.now() - started;
    if (res.statusCode >= 500) {
      metrics.total5xx += 1;
      metrics.last5xxAt = new Date().toISOString();
      log("ERROR", "http-5xx", { method: req.method, path, statusCode: res.statusCode, durationMs });
    } else if (durationMs >= slowRequestMs) {
      metrics.slowRequests += 1;
      log("WARN", "slow-request", { method: req.method, path, statusCode: res.statusCode, durationMs });
    }
  };

  res.once("finish", release);
  res.once("close", release);
  return originalEmit.call(this, event, ...args);
};

const periodic = setInterval(() => {
  const data = snapshot();
  if (data.eventLoop.p99Ms >= 250 || data.memory.rssMb >= 1200) {
    log("WARN", "runtime-pressure", data);
  }
  histogram.reset();
}, 60_000);
periodic.unref();

log("INFO", "startup", { slowRequestMs });
