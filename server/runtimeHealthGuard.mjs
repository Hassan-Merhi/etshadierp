import { Server } from "node:http";
import { Client } from "pg";
import { deploymentRuntimeConfig } from "./deploymentPreflight.mjs";
import { runtimeReleaseState } from "./runtimeReleaseState.mjs";

const hasDatabaseConfig = deploymentRuntimeConfig.databaseSource !== "missing-development-database";
const startedAt = Date.now();
let listening = false;
let shuttingDown = false;

process.once("SIGTERM", () => { shuttingDown = true; });
process.once("SIGINT", () => { shuttingDown = true; });

async function probeDatabase() {
  if (!hasDatabaseConfig) return { ok: false, reason: "database configuration missing" };
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DATABASE_URL ? undefined : process.env.PGHOST,
    port: process.env.DATABASE_URL ? undefined : Number(process.env.PGPORT || 5432),
    user: process.env.DATABASE_URL ? undefined : process.env.PGUSER,
    password: process.env.DATABASE_URL ? undefined : process.env.PGPASSWORD,
    database: process.env.DATABASE_URL ? undefined : process.env.PGDATABASE,
    connectionTimeoutMillis: 3000,
    ssl: process.env.PGSSLMODE === "disable" || process.env.PGHOST === "helium" ? false : { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

function sendJson(res, statusCode, body) {
  if (res.headersSent || res.writableEnded) return;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

const originalListen = Server.prototype.listen;
Server.prototype.listen = function healthAwareListen(...args) {
  this.once("listening", () => { listening = true; });
  this.once("close", () => { listening = false; });
  return originalListen.apply(this, args);
};

const originalEmit = Server.prototype.emit;
Server.prototype.emit = function healthAwareEmit(event, ...args) {
  if (event !== "request") return originalEmit.call(this, event, ...args);
  const [req, res] = args;
  let pathname = "/";
  try { pathname = new URL(req.url || "/", "http://localhost").pathname; } catch {}

  if (pathname === "/api/health/live") {
    sendJson(res, 200, {
      status: "live",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      release: runtimeReleaseState,
    });
    return true;
  }

  if (pathname === "/api/health/ready") {
    void probeDatabase().then((database) => {
      const ready = listening && !shuttingDown && database.ok;
      sendJson(res, ready ? 200 : 503, {
        status: ready ? "ready" : "not_ready",
        listening,
        shuttingDown,
        environmentValid: true,
        database,
        release: runtimeReleaseState,
      });
    });
    return true;
  }

  return originalEmit.call(this, event, ...args);
};
