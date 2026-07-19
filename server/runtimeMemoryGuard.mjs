import "./runtimeHealthGuard.mjs";
import "./runtimeObservability.mjs";
import "./runtimeLifecycleGuard.mjs";
import { Server } from "node:http";
import process from "node:process";

const mb = (bytes) => Math.round(bytes / 1024 / 1024);
const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const SOFT_RSS_MB = parsePositiveInt(process.env.MEMORY_SOFT_RSS_MB, 1200);
const HARD_RSS_MB = parsePositiveInt(process.env.MEMORY_HARD_RSS_MB, 1500);
const SAMPLE_INTERVAL_MS = parsePositiveInt(process.env.MEMORY_SAMPLE_INTERVAL_MS, 15_000);
const HARD_SAMPLES_BEFORE_EXIT = parsePositiveInt(process.env.MEMORY_HARD_SAMPLES_BEFORE_EXIT, 4);

const pressureState = {
  level: "normal",
  hardSamples: 0,
  lastSampleAt: Date.now(),
  rssMb: 0,
  heapUsedMb: 0,
  externalMb: 0,
  arrayBuffersMb: 0,
};

globalThis.__erpMemoryPressure = pressureState;

function sampleMemory(trigger = "interval") {
  const memory = process.memoryUsage();
  pressureState.lastSampleAt = Date.now();
  pressureState.rssMb = mb(memory.rss);
  pressureState.heapUsedMb = mb(memory.heapUsed);
  pressureState.externalMb = mb(memory.external);
  pressureState.arrayBuffersMb = mb(memory.arrayBuffers ?? 0);

  if (pressureState.rssMb >= HARD_RSS_MB) {
    pressureState.level = "critical";
    pressureState.hardSamples += 1;
  } else if (pressureState.rssMb >= SOFT_RSS_MB) {
    pressureState.level = "soft";
    pressureState.hardSamples = 0;
  } else {
    pressureState.level = "normal";
    pressureState.hardSamples = 0;
  }

  if (pressureState.level !== "normal") {
    console.warn(JSON.stringify({ timestamp: new Date().toISOString(), level: pressureState.level === "critical" ? "ERROR" : "WARN", message: "Runtime memory pressure detected", module: "memory-guard", action: "memory-sample", trigger, rssMb: pressureState.rssMb, heapUsedMb: pressureState.heapUsedMb, externalMb: pressureState.externalMb, arrayBuffersMb: pressureState.arrayBuffersMb, softLimitMb: SOFT_RSS_MB, hardLimitMb: HARD_RSS_MB, hardSamples: pressureState.hardSamples }));
  }

  if (pressureState.level === "critical" && typeof globalThis.gc === "function") {
    try { globalThis.gc(); } catch {}
  }

  if (pressureState.hardSamples >= HARD_SAMPLES_BEFORE_EXIT) {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "FATAL", message: "Memory stayed above the hard RSS limit; exiting before an OOM kill", module: "memory-guard", action: "controlled-restart", rssMb: pressureState.rssMb, hardLimitMb: HARD_RSS_MB, samples: pressureState.hardSamples }));
    process.exit(1);
  }
}

const pathLimits = [
  { test: (path) => path === "/api/factory/net-position", max: 2, name: "factory-net-position" },
  { test: (path) => path === "/api/factory/raw-stock", max: 2, name: "factory-raw-stock" },
  { test: (path) => path === "/api/factory/bale-ledger", max: 2, name: "factory-bale-ledger" },
  { test: (path) => path.includes("/export"), max: 1, name: "exports" },
];

const activeByName = new Map();
function pathnameOf(req) {
  try { return new URL(req.url || "/", "http://localhost").pathname; } catch { return req.url || "/"; }
}
function reject(res, statusCode, code, message, retryAfterSeconds = 5) {
  if (res.headersSent || res.writableEnded) return;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.end(JSON.stringify({ message, code, retryAfterSeconds }));
}

const originalEmit = Server.prototype.emit;
Server.prototype.emit = function patchedEmit(event, ...args) {
  if (event !== "request") return originalEmit.call(this, event, ...args);
  const [req, res] = args;
  const path = pathnameOf(req);
  if (path === "/api/health" || path === "/api/health/db" || path === "/api/health/live" || path === "/api/health/ready" || path === "/api/health/metrics") return originalEmit.call(this, event, ...args);
  if (globalThis.__erpRuntimeShuttingDown) {
    reject(res, 503, "SERVER_SHUTTING_DOWN", "Server is restarting. Please retry shortly.", 5);
    return true;
  }
  sampleMemory("request");
  if (pressureState.level === "critical" && path.startsWith("/api/")) {
    reject(res, 503, "MEMORY_PRESSURE", "Server is temporarily protecting itself from high memory usage.", 10);
    return true;
  }
  const rule = pathLimits.find((candidate) => candidate.test(path));
  if (!rule) return originalEmit.call(this, event, ...args);
  const current = activeByName.get(rule.name) ?? 0;
  if (current >= rule.max) {
    reject(res, 429, "ENDPOINT_BUSY", "This heavy operation is already running. Please retry shortly.", 5);
    return true;
  }
  activeByName.set(rule.name, current + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeByName.set(rule.name, Math.max(0, (activeByName.get(rule.name) ?? 1) - 1));
  };
  res.once("finish", release);
  res.once("close", release);
  return originalEmit.call(this, event, ...args);
};

const timer = setInterval(() => sampleMemory("interval"), SAMPLE_INTERVAL_MS);
timer.unref();
sampleMemory("startup");
console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "INFO", message: "Runtime memory guard enabled", module: "memory-guard", action: "startup", softRssMb: SOFT_RSS_MB, hardRssMb: HARD_RSS_MB, sampleIntervalMs: SAMPLE_INTERVAL_MS, hardSamplesBeforeExit: HARD_SAMPLES_BEFORE_EXIT }));