import { Server } from "node:http";
import process from "node:process";
import { deploymentRuntimeConfig } from "./deploymentPreflight.mjs";

const FLAG = Symbol.for("erp.runtime-lifecycle-guard");

if (!globalThis[FLAG]) {
  globalThis[FLAG] = true;

  const servers = new Set();
  const originalListen = Server.prototype.listen;
  const originalClose = Server.prototype.close;

  Server.prototype.listen = function trackedListen(...args) {
    servers.add(this);
    this.once("close", () => servers.delete(this));
    return originalListen.apply(this, args);
  };

  Server.prototype.close = function trackedClose(...args) {
    servers.delete(this);
    return originalClose.apply(this, args);
  };

  // ── Runtime snapshot (no secrets, no SQL, no headers) ────────────────────
  function buildRuntimeSnapshot(reason, exitCode, signal) {
    const mem = process.memoryUsage();
    const mb = (b) => Math.round(b / 1024 / 1024);
    const pressure = globalThis.__erpMemoryPressure ?? {};
    const poolSnap =
      typeof globalThis.__erpDatabasePoolSnapshot === "function"
        ? globalThis.__erpDatabasePoolSnapshot()
        : { totalCount: 0, idleCount: 0, waitingCount: 0 };
    const counters = globalThis.__erpConcurrencyCounters;
    const activeHeavyRequests =
      counters instanceof Map ? Object.fromEntries(counters) : {};
    return {
      reason,
      exitCode,
      signal: signal ?? null,
      buildVersion: deploymentRuntimeConfig.buildVersion ?? "unknown",
      rssMb: mb(mem.rss),
      heapUsedMb: mb(mem.heapUsed),
      heapTotalMb: mb(mem.heapTotal),
      externalMb: mb(mem.external),
      arrayBuffersMb: mb(mem.arrayBuffers ?? 0),
      pressureLevel: pressure.level ?? "unknown",
      hardSamples: pressure.hardSamples ?? 0,
      dbTotalCount: poolSnap.totalCount ?? 0,
      dbIdleCount: poolSnap.idleCount ?? 0,
      dbWaitingCount: poolSnap.waitingCount ?? 0,
      activeHeavyRequests,
      trackedServers: servers.size,
    };
  }

  // ── Shared graceful shutdown ──────────────────────────────────────────────
  let shuttingDown = false;

  async function gracefulShutdown(reason, exitCode = 0, signal = null) {
    if (shuttingDown) return;
    shuttingDown = true;
    globalThis.__erpRuntimeShuttingDown = true;

    const snapshot = buildRuntimeSnapshot(reason, exitCode, signal);
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        module: "runtime-lifecycle",
        action: "shutdown-start",
        ...snapshot,
      })
    );

    const timeoutMs = deploymentRuntimeConfig.shutdownGraceMs ?? 25_000;
    const timeout = setTimeout(() => {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "ERROR",
          module: "runtime-lifecycle",
          action: "shutdown-timeout",
          reason,
          signal,
          timeoutMs,
          buildVersion: deploymentRuntimeConfig.buildVersion ?? "unknown",
        })
      );
      process.exitCode = exitCode || 1;
    }, timeoutMs);
    timeout.unref();

    // Close tracked HTTP servers (drains in-flight requests up to the grace period).
    await Promise.allSettled(
      [...servers].map(
        (server) =>
          new Promise((resolve) => {
            server.closeIdleConnections?.();
            server.close((error) => resolve(error));
          })
      )
    );

    clearTimeout(timeout);
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        module: "runtime-lifecycle",
        action: "shutdown-complete",
        reason,
        exitCode,
        buildVersion: deploymentRuntimeConfig.buildVersion ?? "unknown",
      })
    );

    process.exitCode = exitCode;
    // Allow Node to exit naturally once all async resources close.
  }

  // Exposed for runtimeMemoryGuard.mjs and any other module that needs a
  // controlled shutdown.  Signature: (reason: string, exitCode?: number, signal?: string|null)
  globalThis.__erpRequestGracefulShutdown = gracefulShutdown;

  // ── Signal handlers ───────────────────────────────────────────────────────
  process.prependListener("SIGTERM", () => void gracefulShutdown("SIGTERM", 0, "SIGTERM"));
  process.prependListener("SIGINT",  () => void gracefulShutdown("SIGINT",  0, "SIGINT"));

  // ── Process-level error handlers ──────────────────────────────────────────
  // Log + request graceful shutdown; never continue after an uncaught error.

  process.on("uncaughtException", (err) => {
    const safe = {
      name:    err?.name    ?? "UnknownError",
      message: err?.message ?? String(err),
      stack:   (err?.stack  ?? "").slice(0, 2000),
    };
    const snapshot = buildRuntimeSnapshot("uncaughtException", 1, null);
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "FATAL",
        module: "runtime-lifecycle",
        action: "uncaught-exception",
        error: safe,
        ...snapshot,
      })
    );
    void gracefulShutdown("uncaughtException", 1, null);
  });

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    const safe = {
      name:    err?.name    ?? "UnhandledRejection",
      message: err?.message ?? String(reason),
      stack:   (err?.stack  ?? "").slice(0, 2000),
    };
    const snapshot = buildRuntimeSnapshot("unhandledRejection", 1, null);
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "FATAL",
        module: "runtime-lifecycle",
        action: "unhandled-rejection",
        error: safe,
        ...snapshot,
      })
    );
    void gracefulShutdown("unhandledRejection", 1, null);
  });

  process.on("beforeExit", () => {
    for (const server of servers) server.closeIdleConnections?.();
  });
}
