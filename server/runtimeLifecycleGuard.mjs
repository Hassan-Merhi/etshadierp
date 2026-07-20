import { Server } from "node:http";
import process from "node:process";

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

  let shuttingDown = false;
  const closeServers = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    globalThis.__erpRuntimeShuttingDown = true;

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      module: "runtime-lifecycle",
      action: "shutdown-start",
      signal,
      trackedServers: servers.size,
    }));

    const timeoutMs = Number.parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS || "25000", 10);
    const timeout = setTimeout(() => {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "ERROR",
        module: "runtime-lifecycle",
        action: "shutdown-timeout",
        signal,
        timeoutMs,
      }));
      process.exitCode = 1;
    }, timeoutMs);
    timeout.unref();

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
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      module: "runtime-lifecycle",
      action: "http-closed",
      signal,
    }));
  };

  // Register before the application entrypoint so new requests stop before its
  // existing database-pool shutdown handler runs. Repeated signals are idempotent.
  process.prependListener("SIGTERM", () => void closeServers("SIGTERM"));
  process.prependListener("SIGINT", () => void closeServers("SIGINT"));

  process.on("beforeExit", () => {
    for (const server of servers) server.closeIdleConnections?.();
  });
}
