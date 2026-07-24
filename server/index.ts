import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import fs from "fs";
import { randomBytes } from "crypto";
import { registerRoutes } from "./routes";
import { blockViewOnlyWrites } from "./auth";
import { setupWS } from "./wsServer";
import { startScheduler, checkAndRecoverDailyExport } from "./services/schedulerService";
import { setupVite, log } from "./vite";
import type { User } from "@shared/schema";
import { pool } from "./db";
import { Client } from "pg";
import { requestLogger } from "./middleware/requestLogger";
import { bandwidthDebugMiddleware } from "./middleware/bandwidthDebug";
import { logger } from "./lib/logger";
import { startupMigrations } from "./startupSchema";

// Global error handlers
// In production: log and exit so the process manager (Render/Replit) restarts cleanly.
// In development: log only — keeps the dev server alive for investigation.
const isProduction = process.env.NODE_ENV === "production";

process.on("unhandledRejection", (reason: any) => {
  logger.error("[UnhandledRejection]", { reason: reason?.message ?? reason, stack: reason?.stack ?? "" });
  if (isProduction) process.exit(1);
});
process.on("uncaughtException", (err: Error) => {
  logger.error("[UncaughtException]", { message: err.message, error: err.stack });
  if (isProduction) process.exit(1);
});

// Build version for cache-busting and deployment tracking.
// IMPORTANT: never use Date.now() as the fallback — it changes on every restart
// and causes the browser to think the app was updated, triggering false reload prompts.
const BUILD_VERSION = process.env.BUILD_VERSION || process.env.RENDER_GIT_COMMIT?.substring(0, 8) || "dev";

// Unique ID generated fresh on every server start.
// The frontend polls /api/boot and reloads when this changes, which recovers
// stale Vite chunks in Replit's dev environment (where HMR WebSocket can't connect).
const SERVER_BOOT_ID = Math.random().toString(36).slice(2);

const app = express();

// Compress text-based HTTP responses (gzip/deflate) — reduces bandwidth by 60-80%.
// Binary/already-compressed types (xlsx, zip, pdf, images) are excluded because:
//   1. They are already compressed internally (xlsx = ZIP) so gzip yields minimal savings.
//   2. Routes set Content-Length to the uncompressed buffer size; if compression then
//      shrinks the body, the browser sees a length mismatch and discards the download (0 B).
const SKIP_COMPRESSION_RE =
  /spreadsheet|zip|pdf|octet-stream|image\//i;
app.use(
  compression({
    filter: (req, res) => {
      const type = String(res.getHeader("Content-Type") ?? "");
      if (SKIP_COMPRESSION_RE.test(type)) return false;
      return compression.filter(req, res);
    },
  })
);

// Security headers (X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy, etc.)
// CSP is intentionally disabled — the SPA relies on inline scripts/styles via Vite,
// and a wrong CSP would break the app silently. Other defaults are safe.
// crossOriginEmbedderPolicy is disabled to allow loading external images (logos, etc.).
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

declare global {
  namespace Express {
    interface Request {
      user?: User & {
        role?: string;
        assignedLocationId?: number | null;
        posStation?: number | null;
        cashAccountId?: number | null;
        canSellNegativeStock?: boolean;
        daybookEditDays?: number;
        canAccessCustomers?: boolean;
      };
    }
  }
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    userId?: string;
    username?: string;
    currentCompanyId?: number;
    currentRole?: string;
    currentLocationId?: number | null;
    currentPOSStation?: number | null;
    cashAccountId?: number | null;
    canSellNegativeStock?: boolean;
    daybookEditDays?: number;
    canAccessCustomers?: boolean;
    canDeleteRecords?: boolean;
    /** Unix timestamp (ms) when user last confirmed their password via POST /api/auth/confirm-password */
    passwordConfirmedAt?: number;
  }
}

// General API body limit is 2 MB. Upload routes specify their own higher limit via multer.
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
// /uploads is NOT served publicly — file access goes through authenticated endpoints.

// Trust proxy for HTTPS termination
// This is required for both Replit (development) and Render (production)
// as both run behind reverse proxies
app.set("trust proxy", 1);

// ── Capacitor / Mobile CORS ─────────────────────────────────────────────────
// Browser WebViews (iOS Capacitor, Android Capacitor, Ionic) send these origins
// when calling the production API. They cannot be spoofed by web-based CSRF
// attacks. We must echo the exact origin back (not "*") so that the browser
// also honours Access-Control-Allow-Credentials: true.
const CAPACITOR_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  "https://localhost",
  "http://localhost",
]);
app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  if (origin && CAPACITOR_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,X-CSRF-Token,X-Client-Date,X-Requested-With"
    );
    res.setHeader("Access-Control-Max-Age", "86400"); // 24h preflight cache
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
  }
  next();
});

// Disable ETag generation globally so Express never sends ETags for API responses.
// ETags cause 304 "Not Modified" responses which prevent balance/data from refreshing.
app.set("etag", false);

// Session middleware
const PgSession = connectPgSimple(session);

if (!process.env.SESSION_SECRET) {
  logger.error("CRITICAL: SESSION_SECRET environment variable is not set!");
  logger.error("Please set a strong, random SESSION_SECRET for production security.");
  if (process.env.NODE_ENV === "production") {
    process.exit(1);
  }
}

const sessionConfig: session.SessionOptions = {
  name: "erp.session",
  secret: process.env.SESSION_SECRET || randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: process.env.NODE_ENV === "production" || !!process.env.REPL_ID || process.env.CAPACITOR_ENABLED === "true",
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: "/",
    // SameSite=None is required for Capacitor WebView cross-origin requests.
    // Origin guard + CSRF token remain primary CSRF protection.
    // Set CAPACITOR_ENABLED=true on the server used by the Capacitor app.
    sameSite: process.env.CAPACITOR_ENABLED === "true" ? "none" : "lax",
  },
};

// Use PostgreSQL session store when a database is available
// This ensures sessions persist across server restarts
if (process.env.DATABASE_URL || process.env.PGHOST) {
  const connectionString =
    process.env.DATABASE_URL ||
    `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;

  // Match SSL configuration with main database connection
  const isLocalReplitDB = process.env.PGHOST === "helium";
  const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
  const requiresSSL = !isLocalReplitDB && !sslExplicitlyDisabled;

  sessionConfig.store = new PgSession({
    conObject: {
      connectionString,
      ssl: requiresSSL ? { rejectUnauthorized: false } : false,
      // Allow a small pool so concurrent session reads don't serialize behind one connection.
      max: Number(process.env.PG_SESSION_POOL_MAX || 3),
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 30000,
    },
    createTableIfMissing: true,
  });

  logger.info(`✓ PostgreSQL session store configured (SSL: ${requiresSSL ? "enabled" : "disabled"})`);
}

app.use(session(sessionConfig));

// Globally block all mutation requests (POST/PUT/PATCH/DELETE) for View Only role.
// Must run after session middleware so req.session.currentRole is populated.
app.use(blockViewOnlyWrites);

// Add build version header to all responses for cache tracking
app.use((_req, res, next) => {
  res.setHeader("X-Build-Version", BUILD_VERSION);
  next();
});

// Structured HTTP request logger — fires on res.finish, never logs secrets
app.use(requestLogger);

// Bandwidth debug logging — only active when BANDWIDTH_DEBUG=true.
// Logs any response ≥ 500 KB: method, path, status, size, duration.
// Never logs body content, cookies, auth headers, or sensitive data.
app.use(bandwidthDebugMiddleware);

// Disable HTTP-level caching for all API routes.
// Without this, Express generates ETags and the browser returns 304 "Not Modified"
// for every subsequent request — causing TanStack Query's invalidateQueries to have
// no effect (the browser hands back its cached response instead of hitting the server).
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

// Structured request logging — never logs response bodies to avoid leaking sensitive data.
app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (reqPath.startsWith("/api") && duration > 500) {
      log(`[SLOW API] ${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`);
    }
  });
  next();
});

// ── Phase D: Origin / Referer guard (CSRF defense layer 1) ─────────────────
// Rejects state-changing API requests whose Origin (or Referer fallback) host
// does not match the request host. Blocks classic cross-site form-post CSRF
// attacks regardless of cookie SameSite setting. GET/HEAD/OPTIONS pass through.
// Allowlist: same-origin only. Replit dev URLs naturally satisfy this since
// the browser sends them as Origin and Express sees the same Host.
const ORIGIN_GUARD_EXEMPT_PATHS = new Set<string>([
  "/api/health",
  "/api/health/db",
  "/api/build-info",
  "/api/boot",
  // /api/user-presence/leave is the only sendBeacon-driven write path (fired
  // on tab close from use-presence.ts:53). sendBeacon cannot attach custom
  // headers so it cannot send X-CSRF-Token. The endpoint only marks the user
  // as offline — non-sensitive. The PATCH /api/user-presence heartbeat goes
  // through window.fetch and IS subject to CSRF + Origin enforcement.
  "/api/user-presence/leave",
]);
app.use((req, res, next) => {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (!req.path.startsWith("/api")) return next();
  if (ORIGIN_GUARD_EXEMPT_PATHS.has(req.path)) return next();

  const host = req.headers.host;
  if (!host) return next(); // pathological — let downstream handle

  const originHeader = req.headers.origin;
  const refererHeader = req.headers.referer;
  let sourceHost: string | null = null;
  try {
    if (originHeader) sourceHost = new URL(originHeader).host;
    else if (refererHeader) sourceHost = new URL(refererHeader).host;
  } catch {
    sourceHost = null;
  }

  // Native (non-browser) clients (curl, Postman, server-to-server, mobile)
  // typically omit both headers — allow them since they cannot be CSRF'd.
  if (!sourceHost) return next();

  if (sourceHost === host) return next();

  // Capacitor WebView origins — cannot be spoofed by web-based CSRF attacks.
  // iOS:     capacitor://localhost
  // Android: http://localhost or https://localhost (depending on androidScheme)
  // Ionic:   ionic://localhost
  if (
    originHeader &&
    (originHeader === "capacitor://localhost" ||
      originHeader === "http://localhost" ||
      originHeader === "https://localhost" ||
      originHeader === "ionic://localhost")
  )
    return next();

  logger.warn(
    `[OriginGuard] BLOCKED ${method} ${req.path} | host=${host} origin=${originHeader || "-"} referer=${refererHeader || "-"}`
  );
  return res.status(403).json({
    message: "Cross-origin state-changing request rejected by origin guard.",
    code: "CSRF_ORIGIN_MISMATCH",
  });
});

// ── Phase E: CSRF synchroniser-token middleware (ENFORCING by default) ─────
// Generates a per-session CSRF token, exposes it via GET /api/csrf-token, and
// inspects state-changing requests for a matching X-CSRF-Token header. The
// frontend's window.fetch interceptor (client/src/lib/queryClient.ts) auto-
// attaches the token to every state-changing /api/* request — covering both
// apiRequest() callers and the ~350 raw fetch sites in legacy pages. Set
// CSRF_ENFORCE=0 to fall back to warn-only mode if a regression surfaces.
const CSRF_ENFORCE = process.env.CSRF_ENFORCE !== "0";
app.get("/api/csrf-token", (req, res) => {
  const sess: any = req.session as any;
  if (!sess.csrfToken) {
    sess.csrfToken = randomBytes(32).toString("hex");
  }
  res.json({ csrfToken: sess.csrfToken });
});
app.use((req, res, next) => {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (!req.path.startsWith("/api")) return next();
  if (ORIGIN_GUARD_EXEMPT_PATHS.has(req.path)) return next();
  if (req.path === "/api/csrf-token") return next();

  const sess: any = req.session as any;
  const expected: string | undefined = sess?.csrfToken;
  const got = req.headers["x-csrf-token"];

  // No token in session yet means user is not authenticated / hasn't fetched one.
  // Don't gate auth/login endpoints on CSRF — first-touch endpoints by design.
  if (!expected) return next();

  if (typeof got === "string" && got === expected) return next();

  if (CSRF_ENFORCE) {
    logger.warn(
      `[CSRF] BLOCKED ${method} ${req.path} | expected=${expected.slice(0, 8)}… got=${typeof got === "string" ? got.slice(0, 8) + "…" : "<missing>"}`
    );
    return res.status(403).json({
      message: "CSRF token missing or invalid.",
      code: "CSRF_TOKEN_MISMATCH",
    });
  } else {
    logger.warn(`[CSRF warn-only] ${method} ${req.path} | got=${typeof got === "string" ? "present" : "missing"}`);
    next();
  }
});

// Flag used by /api/health/db to signal readiness to Render's health check.
// Port opens immediately; migrations run in background. Render holds traffic
// on the old instance (via health check 503) until this flips to true.
let migrationsDone = false;

(async () => {
  const migrations = startupMigrations;

  // /api/health/db — reports migration status but does NOT block deployment.
  // The deployment health check uses /api/health (always 200) so Render never times out.
  app.get("/api/health/db", (_req, res) => {
    res.json({
      status: migrationsDone ? "ok" : "starting",
      message: migrationsDone ? "Database ready" : "Running startup migrations, please wait...",
    });
  });

  // Build info endpoint for frontend version checking (must be before registerRoutes)
  app.get("/api/build-info", (_req, res) => {
    res.json({ version: BUILD_VERSION });
  });

  // Boot ID endpoint — returns a random ID generated once per server process start.
  // The frontend polls this in dev mode and reloads when it changes, recovering
  // stale Vite chunks after a server restart (Replit's HMR WS can't connect).
  app.get("/api/boot", (_req, res) => {
    res.json({ bootId: SERVER_BOOT_ID });
  });

  const server = await registerRoutes(app);
  // Keep connections alive longer than Render's 60-second proxy idle timeout.
  // Without this, Express closes sockets at 5 s (Node default), causing the
  // proxy to send a request on a dead connection → socket hang-up retries.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  setupWS(server);
  if (process.env.ENABLE_SCHEDULERS !== "false") {
    startScheduler();
    logger.info("[Schedulers] Started (ENABLE_SCHEDULERS != false)");
  } else {
    logger.info("[Schedulers] Disabled via ENABLE_SCHEDULERS=false");
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    // DB unavailable errors — return 503 immediately instead of a generic 500.
    const isPoolTimeout =
      err?.cause?.message?.includes("timeout exceeded when trying to connect") ||
      err?.message?.includes("timeout exceeded when trying to connect");
    const isLockTimeout =
      err?.cause?.message?.includes("lock timeout") ||
      err?.message?.includes("lock timeout") ||
      err?.cause?.message?.includes("canceling statement due to lock timeout") ||
      err?.message?.includes("canceling statement due to lock timeout");
    if (isPoolTimeout || isLockTimeout) {
      logger.error("DB connection/lock timeout — pool exhausted or DDL lock contention", {
        module: "db",
        action: "poolTimeout",
        error: err,
      });
      return res.status(503).json({ message: "Service temporarily unavailable — please retry." });
    }

    const status = err.status || err.statusCode || 500;
    const isProduction = process.env.NODE_ENV === "production";

    if (status >= 500) {
      logger.error("Unhandled server error", { module: "server", action: "errorHandler", status, error: err });
    }

    const message =
      isProduction && status >= 500
        ? "An unexpected error occurred. Please try again."
        : err.message || "Internal Server Error";

    res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    // Custom static file serving with proper cache headers
    const distPath = path.resolve(import.meta.dirname, "public");

    if (!fs.existsSync(distPath)) {
      throw new Error(`Could not find the build directory: ${distPath}, make sure to build the client first`);
    }

    // Serve static assets with cache control
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (
            filePath.endsWith("index.html") ||
            filePath.endsWith("sw.js") ||
            filePath.endsWith("manifest.json")
          ) {
            // Never cache index.html, sw.js, or manifest — must always be fresh
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
          } else {
            // Allow long-term caching for hashed assets
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      })
    );

    // Return 404 for /assets/* that express.static didn't find.
    // This prevents the SPA index.html fallback from being served as JavaScript,
    // which would corrupt the service worker cache and cause MIME type errors in Safari.
    app.use("/assets", (_req, res) => {
      res.status(404).end();
    });

    // Fallback to index.html with no-cache headers (SPA routing)
    app.use("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.sendFile(path.resolve(distPath, "index.html"));
    });
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);

  const runMigrations = async () => {
    // Use a dedicated single Client for migrations — completely separate from the
    // shared connection pool so migrations never starve user requests of connections.
    const connectionString =
      process.env.DATABASE_URL ||
      `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;
    const isLocalReplitDB = process.env.PGHOST === "helium" || connectionString.includes("@helium:");
    const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
    const requiresSSL = !isLocalReplitDB && !sslExplicitlyDisabled;

    let migrationClient = new Client({
      connectionString,
      ssl: requiresSSL ? { rejectUnauthorized: false } : false,
    });

    try {
      await migrationClient.connect();
      // 30 s lock_timeout: generous enough for a busy production DB to release
      // in-flight queries before the DDL lock is granted, but still bounded so a
      // truly stuck table doesn't hang the server indefinitely.
      await migrationClient.query(`SET lock_timeout = '30s'`);
      await migrationClient.query(`SET statement_timeout = '120s'`);
      // Convert any "ALTER TABLE t ADD COLUMN IF NOT EXISTS col ..."  to a DO
      // block that first checks information_schema.columns.  If the column
      // already exists the DO block is a no-op and never requests an ACCESS
      // EXCLUSIVE lock, preventing it from blocking concurrent SELECT queries.
      const addColRe = /^\s*ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+([\s\S]+?)\s*$/i;
      function safeMigration(sql: string): string {
        const m = sql.match(addColRe);
        if (!m) return sql;
        const [, table, column, rest] = m;
        return `DO $mig$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = '${table}' AND column_name = '${column}'
  ) THEN
    ALTER TABLE ${table} ADD COLUMN ${column} ${rest};
  END IF;
END $mig$`;
      }

      const failedMigrations: Array<{ sql: string; error: string }> = [];

      for (const migration of migrations) {
        try {
          await migrationClient.query(safeMigration(migration));
        } catch (err: any) {
          const errMsg: string = err.message ?? String(err);
          const errCode: string = err.code ?? "";
          // PG connection-drop codes: 57P01 admin_shutdown, 08006 connection_failure,
          // 08003 connection_does_not_exist, 08001 unable_to_connect
          const isConnDrop =
            ["57P01", "08006", "08003", "08001", "08004"].includes(errCode) ||
            /terminating connection|connection.*reset|could not connect|connection closed|socket.*hang/i.test(errMsg);

          // PG lock_timeout code is 55P03
          const isLockTimeout =
            errCode === "55P03" || /lock timeout|canceling statement due to lock timeout/i.test(errMsg);

          if (isConnDrop) {
            // Reconnect and retry once — if retry also fails, record as a failure
            logger.error(`[Migration] Connection dropped — reconnecting... (${errMsg.split("\n")[0]})`);
            try {
              await migrationClient.end().catch(() => {});
              migrationClient = new Client({
                connectionString,
                ssl: requiresSSL ? { rejectUnauthorized: false } : false,
              });
              await migrationClient.connect();
              await migrationClient.query(`SET lock_timeout = '30s'`);
              await migrationClient.query(`SET statement_timeout = '120s'`);
              await migrationClient.query(safeMigration(migration));
              logger.info(`[Migration] Reconnected and retried successfully`);
            } catch (retryErr: any) {
              const retryMsg: string = retryErr.message ?? String(retryErr);
              failedMigrations.push({
                sql: migration.trim().substring(0, 120),
                error: retryMsg.split("\n")[0],
              });
            }
          } else if (isLockTimeout) {
            // Lock timeout — wait 5 s for in-flight queries to drain, then retry once
            logger.warn(
              `[Migration] Lock timeout — waiting 5s before retry... (${migration.trim().substring(0, 80)})`
            );
            await new Promise((r) => setTimeout(r, 5000));
            try {
              await migrationClient.query(safeMigration(migration));
              logger.info(`[Migration] Lock-timeout retry succeeded`);
            } catch (retryErr: any) {
              const retryMsg: string = retryErr.message ?? String(retryErr);
              failedMigrations.push({
                sql: migration.trim().substring(0, 120),
                error: `lock-timeout retry failed: ${retryMsg.split("\n")[0]}`,
              });
            }
          } else {
            // All other errors (syntax error, constraint, etc.) are
            // recorded as failures so the ops team has full visibility at ERROR level.
            failedMigrations.push({
              sql: migration.trim().substring(0, 120),
              error: errMsg.split("\n")[0],
            });
          }
        }
      }

      if (failedMigrations.length > 0) {
        logger.error(`✗ ${failedMigrations.length} migration(s) failed at startup:`);
        for (const { sql, error } of failedMigrations) {
          logger.error(`  SQL: ${sql}`);
          logger.error(`  ERR: ${error}`);
        }
      } else {
        logger.info("✓ Database tables and columns verified/migrated");
      }

      // ── Post-migration critical-table existence check ────────────────────────
      // If any IC tables are missing (e.g. migration silently failed on a prior
      // deploy) log a clear startup ERROR so the ops team can act immediately.
      try {
        const IC_TABLES = [
          "intercompany_account_links",
          "intercompany_link_recipients",
          "intercompany_payment_requests",
        ];
        const tableCheck = await migrationClient.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = ANY($1)`,
          [IC_TABLES]
        );
        const found = new Set<string>(tableCheck.rows.map((r: any) => r.table_name as string));
        const missing = IC_TABLES.filter((t) => !found.has(t));
        if (missing.length > 0) {
          logger.error(
            `✗ Missing critical tables after migration: ${missing.join(", ")} — ` +
              `IC notification feature will not work. Run the CREATE TABLE statements manually.`
          );
        }
      } catch (tableCheckErr: any) {
        logger.error(`[Migration] ✗ Could not verify IC table existence: ${tableCheckErr.message}`);
      }

      // Backfill POS_EXPENSE daybook entries for any factory POS sales
      // that have expenses_json stored but no corresponding daybook rows yet
      try {
        await migrationClient.query(`
          INSERT INTO factory_daybook_entries
            (company_id, tx_date, tx_type, reference_id, reference_table,
             description, currency_code, amount_currency, fx_rate_to_usd, amount_usd)
          SELECT
            s.company_id,
            s.tx_date,
            'POS_EXPENSE',
            s.id,
            'factory_pos_sales',
            CONCAT(
              COALESCE(NULLIF(exp->>'description',''), 'Deduction'),
              ' – POS ', s.sale_number,
              CASE WHEN s.customer_name IS NOT NULL
                   THEN CONCAT(' (', s.customer_name, ')')
                   ELSE '' END
            ),
            COALESCE(s.currency_code, 'USD'),
            ROUND((exp->>'amount')::numeric, 2),
            1,
            ROUND((exp->>'amount')::numeric, 2)
          FROM factory_pos_sales s,
               jsonb_array_elements(s.expenses_json::jsonb) AS exp
          WHERE s.expenses_json IS NOT NULL
            AND s.expenses_json <> 'null'
            AND (exp->>'amount')::numeric > 0
            AND NOT EXISTS (
              SELECT 1 FROM factory_daybook_entries d
              WHERE d.reference_table = 'factory_pos_sales'
                AND d.reference_id = s.id
                AND d.tx_type = 'POS_EXPENSE'
            )
        `);
      } catch {
        /* table may not exist yet — skip */
      }

      // Ensure customer invoice sequences start at 11827 (or higher if already advanced)
      try {
        await migrationClient.query(`
          UPDATE customer_invoice_sequences
          SET next_number = 11827
          WHERE next_number < 11827
        `);
      } catch {
        /* skip if table not ready */
      }

      // One-time fix: correct reversed rental auto-transfer entries on the TO company side.
      // Previously, TR-IN vouchers incorrectly DEBITED the clearing account and CREDITED the
      // destination account. The correct pattern is DR destination, CR clearing.
      // This query finds only the wrong ones (where clearing is debited) and swaps them.
      try {
        await migrationClient.query(`
          UPDATE voucher_entries ve
          SET
            debit_amount  = ve.credit_amount,
            credit_amount = ve.debit_amount
          WHERE ve.voucher_id IN (
            SELECT DISTINCT ve2.voucher_id
            FROM voucher_entries ve2
            JOIN inter_company_transfers ict ON ict.to_voucher_id = ve2.voucher_id
            JOIN ledger_accounts la ON la.id = ve2.ledger_account_id
            WHERE la.code = 'TRANSFER-CLEARING'
              AND ve2.debit_amount::numeric > 0
          )
        `);
      } catch {
        /* skip if tables not ready */
      }

      // Fix: cascade overpaid rental months to the correct next available month.
      // Handles two cases:
      //   A) Current/past month with paid > expected (expected > 0)
      //   B) Future prepaid month with paid > contract rental_amount (expected = 0)
      // For each overpaid row the excess is moved to the FIRST month that still has
      // remaining capacity (paid < rental_amount), searching forward month by month.
      // Safe to re-run — idempotent as long as data is already clean.
      // Written as plain JS (not PL/pgSQL) so every step is logged and errors are visible.
      try {
        const now = new Date();
        const nowYear = now.getFullYear();
        const nowMonth = now.getMonth() + 1;

        const overpaidResult = await migrationClient.query(
          `
          SELECT
            pml.id,
            pml.company_id,
            pml.module,
            pml.contract_id,
            pml.unit_id,
            pml.year,
            pml.month,
            pml.expected_amount::numeric AS expected_amount,
            pml.paid_amount::numeric     AS paid_amount,
            pc.rental_amount::numeric    AS rental_amount
          FROM property_monthly_ledger pml
          JOIN property_contracts pc ON pc.id = pml.contract_id
          WHERE (
            (
              pml.expected_amount::numeric > 0
              AND pml.paid_amount::numeric > pml.expected_amount::numeric
              AND (pml.year < $1 OR (pml.year = $1 AND pml.month <= $2))
            )
            OR
            (
              pml.expected_amount::numeric = 0
              AND pml.paid_amount::numeric > pc.rental_amount::numeric
              AND pc.rental_amount::numeric > 0
            )
          )
          ORDER BY pml.contract_id, pml.year, pml.month
        `,
          [nowYear, nowMonth]
        );

        logger.info(`[RentalFix] Found ${overpaidResult.rows.length} overpaid ledger row(s) to fix`);

        for (const row of overpaidResult.rows) {
          const paidAmt = Number(row.paid_amount);
          const expectedAmt = Number(row.expected_amount);
          const rentalAmt = Number(row.rental_amount);

          const capacity = expectedAmt > 0 ? expectedAmt : rentalAmt;
          const excess = paidAmt - capacity;

          if (excess < 0.005) continue;

          logger.info(
            `[RentalFix] contract=${row.contract_id} ledger=${row.id} ` +
              `month=${row.year}/${row.month} paid=${paidAmt} capacity=${capacity} excess=${excess}`
          );

          // 1. Reduce the overpaid row
          await migrationClient.query(
            `UPDATE property_monthly_ledger SET paid_amount = paid_amount - $1 WHERE id = $2`,
            [excess.toFixed(2), row.id]
          );

          // 2. Search forward for the first month with remaining capacity
          let checkYear = row.year;
          let checkMonth = row.month + 1;
          if (checkMonth > 12) {
            checkMonth = 1;
            checkYear++;
          }

          let targetYear: number | null = null;
          let targetMonth: number | null = null;

          for (let i = 0; i < 200; i++) {
            const slotResult = await migrationClient.query(
              `SELECT paid_amount::numeric AS paid_amount
               FROM property_monthly_ledger
               WHERE contract_id = $1 AND year = $2 AND month = $3`,
              [row.contract_id, checkYear, checkMonth]
            );

            const slotPaid = slotResult.rows.length > 0 ? Number(slotResult.rows[0].paid_amount) : null;

            // Available if: row doesn't exist yet, OR paid < rental_amount
            if (slotPaid === null || slotPaid < rentalAmt) {
              targetYear = checkYear;
              targetMonth = checkMonth;
              break;
            }

            checkMonth++;
            if (checkMonth > 12) {
              checkMonth = 1;
              checkYear++;
            }
          }

          if (targetYear === null || targetMonth === null) {
            logger.warn(
              `[RentalFix] No target slot found for contract=${row.contract_id} ledger=${row.id} — skipping`
            );
            continue;
          }

          logger.info(`[RentalFix] → moving excess $${excess} to ${targetYear}/${targetMonth}`);

          // 3. Create or top-up the target month
          await migrationClient.query(
            `
            INSERT INTO property_monthly_ledger
              (company_id, module, contract_id, unit_id, year, month, expected_amount, paid_amount, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, 0, $7, NOW())
            ON CONFLICT (contract_id, year, month)
            DO UPDATE SET paid_amount = property_monthly_ledger.paid_amount + EXCLUDED.paid_amount
          `,
            [row.company_id, row.module, row.contract_id, row.unit_id, targetYear, targetMonth, excess.toFixed(2)]
          );

          // 4. Reassign the most-recent payment from the overpaid month → target month
          const newLedger = await migrationClient.query(
            `SELECT id FROM property_monthly_ledger
             WHERE contract_id = $1 AND year = $2 AND month = $3`,
            [row.contract_id, targetYear, targetMonth]
          );
          if (newLedger.rows.length > 0) {
            const newLedgerId = newLedger.rows[0].id;
            await migrationClient.query(
              `
              UPDATE property_payments
              SET for_year = $1, for_month = $2, ledger_row_id = $3
              WHERE id = (
                SELECT id FROM property_payments
                WHERE contract_id = $4 AND for_year = $5 AND for_month = $6
                ORDER BY created_at DESC
                LIMIT 1
              )
            `,
              [targetYear, targetMonth, newLedgerId, row.contract_id, row.year, row.month]
            );
          }

          logger.info(
            `[RentalFix] Done: contract=${row.contract_id} fixed ${row.year}/${row.month} → ${targetYear}/${targetMonth}`
          );
        }

        logger.info("[RentalFix] Rental overpayment fix complete");
      } catch (e: any) {
        logger.error("[RentalFix] Migration error:", { error: e.message });
      }

      // One-time: convert all PARTIALLY_OFFLOADED containers to OFFLOADED.
      // "Partially offloaded" is no longer a distinct status — partial offloads
      // are treated as fully OFFLOADED.
      try {
        await migrationClient.query(`
          UPDATE factory_containers
          SET status = 'OFFLOADED'
          WHERE status = 'PARTIALLY_OFFLOADED'
        `);
      } catch {
        /* skip if table not ready */
      }

      // ── Fix misallocated property payments ──────────────────────────────────────
      // Phase 1 (JS): For each active contract, re-process payments in date order
      // and assign each to the oldest outstanding month, updating ledger_row_id,
      // for_year, and for_month on misallocated payment records.
      // Phase 2 (SQL): After ledger_row_id is correct, sync each ledger row's
      // paid_amount to the actual sum of payments pointing to it.
      // Safe to re-run — idempotent once data is correct.
      try {
        const contractsResult = await migrationClient.query(`
          SELECT pc.id, pc.company_id, pc.rental_amount::numeric AS rental_amount
          FROM property_contracts pc
          WHERE pc.status = 'ACTIVE'
        `);

        let pmtFixed = 0;

        for (const contract of contractsResult.rows) {
          const cid = Number(contract.id);
          const compId = Number(contract.company_id);

          // Load all payments that link to a ledger row (rent + guarantee-applied)
          const pmts = (
            await migrationClient.query(
              `
            SELECT id, amount::numeric AS amount, for_year, for_month, ledger_row_id
            FROM property_payments
            WHERE contract_id = $1 AND company_id = $2
              AND ledger_row_id IS NOT NULL
            ORDER BY payment_date, id
          `,
              [cid, compId]
            )
          ).rows;
          if (!pmts.length) continue;

          // Load all ledger rows ordered oldest first
          const ledger = (
            await migrationClient.query(
              `
            SELECT id, year, month, expected_amount::numeric AS expected
            FROM property_monthly_ledger
            WHERE contract_id = $1 AND company_id = $2
            ORDER BY year, month
          `,
              [cid, compId]
            )
          ).rows;
          if (!ledger.length) continue;

          // In-memory map: key="year-month", value={id, expected, paid(reset to 0)}
          const lmap = new Map<string, { id: number; expected: number; paid: number }>();
          for (const r of ledger) {
            lmap.set(`${r.year}-${r.month}`, { id: Number(r.id), expected: Number(r.expected), paid: 0 });
          }

          // Re-allocate: each payment fills the oldest outstanding month
          for (const pmt of pmts) {
            let rem = Number(pmt.amount);
            let firstChunk = true;

            while (rem > 0.005) {
              // Find oldest month with remaining capacity
              let tgt: { key: string; year: number; month: number; id: number; expected: number; paid: number } | null =
                null;
              for (const [key, row] of lmap) {
                if (row.expected - row.paid > 0.005) {
                  const [y, m] = key.split("-").map(Number);
                  tgt = { key, year: y, month: m, ...row };
                  break;
                }
              }
              if (!tgt) break;

              const chunk = Math.min(rem, tgt.expected - tgt.paid);
              tgt.paid += chunk;
              rem = Math.round((rem - chunk) * 100) / 100;
              lmap.set(tgt.key, { ...tgt });

              if (firstChunk) {
                firstChunk = false;
                // Update payment if it points to wrong ledger row
                const origLedgerId = Number(pmt.ledger_row_id);
                const origForYear = Number(pmt.for_year);
                const origForMonth = Number(pmt.for_month);
                if (origLedgerId !== tgt.id || origForYear !== tgt.year || origForMonth !== tgt.month) {
                  await migrationClient.query(
                    `
                    UPDATE property_payments
                    SET ledger_row_id = $1, for_year = $2, for_month = $3
                    WHERE id = $4
                  `,
                    [tgt.id, tgt.year, tgt.month, Number(pmt.id)]
                  );
                  pmtFixed++;
                  logger.info(
                    `[AllocationFix] pmt=${pmt.id} contract=${cid} moved ${origForYear}/${origForMonth} → ${tgt.year}/${tgt.month}`
                  );
                }
              }
            }
          }
        }

        if (pmtFixed > 0) {
          logger.info(`[AllocationFix] Phase 1 complete — reassigned ${pmtFixed} payment record(s)`);
        }

        // Phase 2: sync every ledger row's paid_amount to sum of its linked payments
        const syncResult = await migrationClient.query(`
          UPDATE property_monthly_ledger pml
          SET paid_amount = COALESCE((
            SELECT SUM(pp.amount::numeric)
            FROM property_payments pp
            WHERE pp.ledger_row_id = pml.id
          ), 0)
          WHERE ABS(pml.paid_amount::numeric - COALESCE((
            SELECT SUM(pp.amount::numeric)
            FROM property_payments pp
            WHERE pp.ledger_row_id = pml.id
          ), 0)) > 0.01
        `);
        const ledgerFixed = syncResult.rowCount ?? 0;

        if (pmtFixed > 0 || ledgerFixed > 0) {
          logger.info(`[AllocationFix] Phase 2 complete — corrected ${ledgerFixed} ledger paid_amount(s)`);
        } else {
          logger.info(`[AllocationFix] All payment allocations and ledger amounts are correct`);
        }
      } catch (e: any) {
        logger.error("[AllocationFix] Error:", { error: e.message });
      }

      // ── Merge split Production/Consumption ledger accounts ───────────────────
      // Old setup created two accounts per company: PRODUCTION_ADJUSTMENT (Liability)
      // and CONSUMPTION_EXPENSE (Indirect Expense). Now a single STOCK_ADJUSTMENT
      // account is used for both sides. This runs once per company and is idempotent.
      try {
        const companies = await migrationClient.query(`SELECT id FROM companies`);
        let mergedCount = 0;
        for (const { id: cid } of companies.rows) {
          const oldAccts = await migrationClient.query(
            `SELECT id, code FROM ledger_accounts
             WHERE company_id = $1
               AND code IN ('PRODUCTION_ADJUSTMENT', 'CONSUMPTION_EXPENSE')
               AND deleted_at IS NULL`,
            [cid]
          );
          if (oldAccts.rows.length === 0) continue;

          // Find or create the unified account
          let unifiedId: number;
          const existing = await migrationClient.query(
            `SELECT id FROM ledger_accounts
             WHERE company_id = $1 AND code = 'STOCK_ADJUSTMENT' AND deleted_at IS NULL
             LIMIT 1`,
            [cid]
          );
          if (existing.rows.length > 0) {
            unifiedId = existing.rows[0].id;
          } else {
            const created = await migrationClient.query(
              `INSERT INTO ledger_accounts
                 (company_id, code, name, account_type, sub_type,
                  opening_balance, opening_balance_side, created_at)
               VALUES
                 ($1, 'STOCK_ADJUSTMENT', 'Stock Adjustment (Production/Consumption)',
                  'Indirect Expense', 'Indirect Expense', '0', 'Dr', NOW())
               RETURNING id`,
              [cid]
            );
            unifiedId = created.rows[0].id;
          }

          // Re-point all voucher_entries from the old accounts to the unified one
          const oldIds: number[] = oldAccts.rows.map((r: any) => Number(r.id));
          if (oldIds.length > 0) {
            const idList = oldIds.join(",");
            await migrationClient.query(
              `UPDATE voucher_entries
               SET ledger_account_id = ${unifiedId}
               WHERE ledger_account_id IN (${idList})`
            );
            // Soft-delete the now-empty old accounts
            await migrationClient.query(
              `UPDATE ledger_accounts
               SET deleted_at = NOW()
               WHERE id IN (${idList})`
            );
          }

          mergedCount++;
        }
        if (mergedCount > 0) {
          logger.info(
            `[StockAdjFix] Merged Production/Consumption accounts → unified STOCK_ADJUSTMENT for ${mergedCount} company(ies)`
          );
        } else {
          logger.info(`[StockAdjFix] All companies already use unified STOCK_ADJUSTMENT — nothing to merge`);
        }
      } catch (e: any) {
        logger.error("[StockAdjFix] Error:", { error: e.message });
      }

      // ── Fix bonus expense accounts: update accountType → "Indirect Expense" ──
      try {
        const bonusFix = await migrationClient.query(`
          UPDATE ledger_accounts
          SET account_type = 'Indirect Expense'
          WHERE (code = 'BONUS_EXPENSE' OR code LIKE 'BONUS_EXP_%')
            AND account_type != 'Indirect Expense'
          RETURNING id
        `);
        if (bonusFix.rowCount && bonusFix.rowCount > 0) {
          logger.info(`[BonusExpFix] Updated ${bonusFix.rowCount} bonus expense account(s) → Indirect Expense`);
        }
      } catch (e: any) {
        logger.error("[BonusExpFix] Error:", { error: e.message });
      }

      // ── Auto-fix credit note variance entries posted to wrong account ────────
      // Voucher entries narrated "Variance between refund and inventory cost"
      // used to fall back to a random Indirect Expense account when no
      // "Sales Returns" account existed. Re-route them to the correct account.
      try {
        const badVariance = await migrationClient.query(`
          SELECT ve.id, v.company_id
          FROM voucher_entries ve
          JOIN vouchers v ON v.id = ve.voucher_id
          JOIN ledger_accounts la ON la.id = ve.ledger_account_id
          WHERE ve.narration IN (
                  'Variance between refund and inventory cost',
                  'Variance between debit note amount and inventory cost'
                )
            AND LOWER(la.name) NOT LIKE '%sales return%'
            AND LOWER(la.name) NOT LIKE '%return%allowance%'
            AND la.code != 'SALES-RETURNS'
        `);

        if (badVariance.rows.length > 0) {
          const companyIds: number[] = [...new Set<number>(badVariance.rows.map((r: any) => Number(r.company_id)))];
          let totalFixed = 0;

          for (const cid of companyIds) {
            // Find existing "Sales Returns" account or create one
            const { rows: existing } = await migrationClient.query(
              `
              SELECT id FROM ledger_accounts
              WHERE company_id = $1
                AND (LOWER(name) LIKE '%sales return%' OR code = 'SALES-RETURNS')
              LIMIT 1
            `,
              [cid]
            );

            let accountId: number;
            if (existing.length > 0) {
              accountId = existing[0].id;
            } else {
              const { rows: created } = await migrationClient.query(
                `
                INSERT INTO ledger_accounts (company_id, code, name, account_type, active, is_hidden)
                VALUES ($1, 'SALES-RETURNS', 'Sales Returns & Allowances', 'Income', true, false)
                ON CONFLICT DO NOTHING
                RETURNING id
              `,
                [cid]
              );
              if (created.length === 0) {
                const { rows: refetch } = await migrationClient.query(
                  `SELECT id FROM ledger_accounts WHERE company_id = $1 AND code = 'SALES-RETURNS' LIMIT 1`,
                  [cid]
                );
                accountId = refetch[0]?.id;
              } else {
                accountId = created[0].id;
              }
            }
            if (!accountId!) continue;

            const entryIds = badVariance.rows.filter((r: any) => Number(r.company_id) === cid).map((r: any) => r.id);

            await migrationClient.query(`UPDATE voucher_entries SET ledger_account_id = $1 WHERE id = ANY($2)`, [
              accountId,
              entryIds,
            ]);
            totalFixed += entryIds.length;
          }

          logger.info(
            `[CreditNoteVarianceFix] Moved ${totalFixed} variance entry/entries → Sales Returns & Allowances`
          );
        }
      } catch (e: any) {
        logger.error("[CreditNoteVarianceFix] Error:", { error: e.message });
      }

      // ── Auto-fix orphaned RESERVED_FOR_ORDER bales ───────────────────────────
      // Bales stuck in RESERVED_FOR_ORDER with no active customer order referencing
      // them (order deleted / container row deleted) are returned to IN_STOCK.
      try {
        const orphanResult = await migrationClient.query(`
          UPDATE factory_bales
          SET status = 'IN_STOCK', updated_at = NOW()
          WHERE status = 'RESERVED_FOR_ORDER'
            AND deleted_at IS NULL
            AND id NOT IN (
              SELECT cob.bale_id
              FROM customer_order_bales cob
              INNER JOIN customer_orders co ON co.id = cob.order_id
              WHERE co.deleted_at IS NULL
                AND co.status IN ('LOADING', 'PENDING_VERIFICATION', 'VERIFIED')
            )
          RETURNING id
        `);
        const fixed = orphanResult.rows.length;
        if (fixed > 0) {
          logger.info(`[BaleOrphanFix] Restored ${fixed} orphaned RESERVED_FOR_ORDER bale(s) → IN_STOCK`);
        }
      } catch (e: any) {
        logger.error("[BaleOrphanFix] Error:", { error: e.message });
      }

      // ── Back-fill insurance_members from existing "Insurance - …" accounts ───
      // When ledger accounts named "Insurance - <name>" exist under a factory
      // company but have no corresponding insurance_members row (e.g. after a
      // DB restore or a bulk import), create the member rows so the Insurance
      // page shows them.  Idempotent: skipped if a member already points to
      // the account.  Must run BEFORE the orphan-cleanup below.
      try {
        const memberBackfill = await migrationClient.query(`
          INSERT INTO insurance_members (company_id, name, active, ledger_account_id, start_date, amount)
          SELECT la.company_id,
                 SUBSTRING(la.name FROM 13),
                 true,
                 la.id,
                 CURRENT_DATE,
                 0
          FROM ledger_accounts la
          JOIN companies c ON c.id = la.company_id
          WHERE la.name LIKE 'Insurance - %'
            AND la.deleted_at IS NULL
            AND c.company_type IN ('factory', 'factory_v2')
            AND NOT EXISTS (
              SELECT 1 FROM insurance_members im
              WHERE im.ledger_account_id = la.id
            )
          ON CONFLICT DO NOTHING
          RETURNING id
        `);
        if (memberBackfill.rowCount && memberBackfill.rowCount > 0) {
          logger.info(`[InsuranceMemberBackfill] Created ${memberBackfill.rowCount} missing insurance_members row(s) from ledger accounts`);
        }
      } catch (e: any) {
        logger.error("[InsuranceMemberBackfill] Error:", { error: e.message });
      }

      // ── Soft-delete orphaned Insurance ledger accounts ───────────────────────
      // Insurance member deletion previously left the linked "Insurance - Name"
      // ledger account alive. Clean up any that no longer have a member row.
      // (Runs after the back-fill above so legitimate accounts are not removed.)
      try {
        const insuranceFix = await migrationClient.query(`
          UPDATE ledger_accounts la
          SET deleted_at = NOW()
          WHERE la.deleted_at IS NULL
            AND la.name LIKE 'Insurance - %'
            AND NOT EXISTS (
              SELECT 1 FROM insurance_members im
              WHERE im.ledger_account_id = la.id
            )
          RETURNING id
        `);
        if (insuranceFix.rowCount && insuranceFix.rowCount > 0) {
          logger.info(`[InsuranceFix] Soft-deleted ${insuranceFix.rowCount} orphaned Insurance ledger account(s)`);
        }
      } catch (e: any) {
        logger.error("[InsuranceFix] Error:", { error: e.message });
      }

      // Auto-fix sequence desyncs (can happen after data restores / bulk imports with explicit IDs)
      const seqFixes: Array<[string, string]> = [
        ["ledger_accounts", "ledger_accounts_id_seq"],
        ["factory_suppliers", "factory_suppliers_id_seq"],
        ["factory_containers", "factory_containers_id_seq"],
        ["factory_supplier_payments", "factory_supplier_payments_id_seq"],
        ["factory_supplier_fx_transfers", "factory_supplier_fx_transfers_id_seq"],
        ["factory_container_other_charges", "factory_container_other_charges_id_seq"],
        ["vouchers", "vouchers_id_seq"],
        ["voucher_entries", "voucher_entries_id_seq"],
        ["login_history", "login_history_id_seq"],
      ];
      for (const [table, seq] of seqFixes) {
        try {
          await migrationClient.query(
            `SELECT setval('${seq}', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${table}), 1))`
          );
        } catch {
          /* table may not exist yet on first run — skip */
        }
      }
    } catch (err: any) {
      logger.error("Migration connection error:", { error: err.message });
    } finally {
      await migrationClient.end();
      migrationsDone = true;
    }
  };

  // Pre-warm the DB connection pool so the first user request
  // (e.g. login) doesn't bear the cost of the initial TCP handshake + SSL
  // negotiation to the database. Retries up to 3 times with a short delay
  // so Render's database has time to wake from cold-start sleep.
  const warmupDb = async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await pool.query("SELECT 1");
        logger.info(`✓ DB connection pool warmed up (attempt ${attempt})`);
        return;
      } catch (err: any) {
        logger.warn(`⚠️  DB warmup attempt ${attempt} failed: ${err.message}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 3000));
      }
    }
    logger.error("✗ DB warmup failed after 3 attempts — queries will connect lazily");
  };

  // Ensure Puppeteer's Chrome binary is present before the server starts
  // accepting tracking requests.  Runs in background — does not block startup.
  import("./lib/parcelsAppScraper")
    .then(({ ensureChromiumAvailable }) => {
      ensureChromiumAvailable().catch(() => {});
    })
    .catch(() => {});

  // ── Post-startup background jobs (run after port is open) ───────────────────
  const runPostStartupJobs = () => {
    // Delayed 30 s so diagnostics don't compete with user requests for pool
    // connections the moment the server goes live.
    setTimeout(async () => {
      try {
        const [posRows, posWithStation, normalUserRows, oldRoleRows, canDeleteCol] = await Promise.all([
          pool.query(`SELECT COUNT(*) AS n FROM user_company_roles WHERE role = 'POS'`),
          pool.query(`SELECT COUNT(*) AS n FROM user_company_roles WHERE role = 'POS' AND pos_station IS NOT NULL`),
          pool.query(`SELECT COUNT(*) AS n FROM user_company_roles WHERE role = 'Normal User'`),
          pool.query(
            `SELECT COUNT(*) AS n FROM user_company_roles WHERE role IN ('POS1','POS2','POS3','POS4','POS5','POS6','User')`
          ),
          pool.query(
            `SELECT COUNT(*) AS n FROM information_schema.columns
             WHERE table_name = 'user_company_roles' AND column_name = 'can_delete_records'`
          ),
        ]);
        const posCount = parseInt(posRows.rows[0]?.n ?? "0", 10);
        const posWithStn = parseInt(posWithStation.rows[0]?.n ?? "0", 10);
        const normalCount = parseInt(normalUserRows.rows[0]?.n ?? "0", 10);
        const oldRoleCount = parseInt(oldRoleRows.rows[0]?.n ?? "0", 10);
        const canDeleteOk = parseInt(canDeleteCol.rows[0]?.n ?? "0", 10) > 0;
        logger.info(
          `[MigrationDiag] POS roles: ${posCount} (${posWithStn} with pos_station set) | ` +
            `Normal User roles: ${normalCount} | ` +
            `Old roles remaining: ${oldRoleCount} | ` +
            `can_delete_records column: ${canDeleteOk ? "✓ present" : "✗ MISSING"}`
        );
        if (oldRoleCount > 0) {
          logger.warn(
            `[MigrationDiag] ⚠️  ${oldRoleCount} row(s) still have old roles (POS1–POS6 or User) — check /api/admin/deployment-diagnostics`
          );
        }
      } catch (e: any) {
        logger.warn("[MigrationDiag] Could not run startup diagnostic:", { error: e.message });
      }
    }, 30000);

    // ── Fix bales where deletedAt is set but status is not DELETED ────────────
    void (async () => {
      try {
        const r = await pool.query(`
          UPDATE factory_bales
             SET status = 'DELETED', updated_at = NOW()
           WHERE deleted_at IS NOT NULL
             AND status != 'DELETED'
          RETURNING id, reference_number
        `);
        if (r.rowCount && r.rowCount > 0) {
          logger.info(
            `[BaleStatusFix] Fixed ${r.rowCount} bale(s) with deletedAt set but status != DELETED`,
            { detail: r.rows.map((x: any) => x.reference_number).join(", ") }
          );
        }
      } catch (e: any) {
        logger.warn("[BaleStatusFix] Could not fix inconsistent bale statuses:", { error: e.message });
      }
    })();

    // ── Clean up orphaned export runs ────────────────────────────────────────
    const cleanupOrphanedRuns = async () => {
      try {
        const r = await pool.query(`
          UPDATE daily_export_runs
             SET status         = 'failed',
                 finished_at    = NOW(),
                 skipped_reason = 'Server restarted or timed out while export was in progress'
           WHERE status         = 'running'
             AND started_at     < NOW() - INTERVAL '5 minutes'
          RETURNING id, run_type
        `);
        if (r.rowCount && r.rowCount > 0) {
          logger.info(
            `[ExportRun] Startup: marked ${r.rowCount} orphaned run(s) as failed`,
            { detail: r.rows.map((x: any) => `#${x.id} ${x.run_type}`).join(", ") }
          );
        }
      } catch (e: any) {
        logger.warn("[ExportRun] Startup orphan-cleanup failed:", { error: e.message });
      }
    };

    const cleanupHungRuns = async () => {
      try {
        const r = await pool.query(`
          UPDATE daily_export_runs
             SET status         = 'failed',
                 finished_at    = NOW(),
                 skipped_reason = 'Export timed out — exceeded 3-hour safety limit'
           WHERE status         = 'running'
             AND started_at     < NOW() - INTERVAL '3 hours'
          RETURNING id, run_type
        `);
        if (r.rowCount && r.rowCount > 0) {
          logger.info(
            `[ExportRun] Periodic: timed out ${r.rowCount} hung run(s)`,
            { detail: r.rows.map((x: any) => `#${x.id} ${x.run_type}`).join(", ") }
          );
        }
      } catch (e: any) {
        logger.warn("[ExportRun] Periodic hung-run cleanup failed:", { error: e.message });
      }
    };

    setTimeout(cleanupOrphanedRuns, 3000);
    setInterval(cleanupHungRuns, 30 * 60 * 1000);

    setTimeout(async () => {
      try {
        await checkAndRecoverDailyExport();
      } catch (e: any) {
        logger.warn("[DailyExport] Startup recovery call failed:", { error: e?.message });
      }
    }, 90 * 1000);
  };

  // ── Open the port ─────────────────────────────────────────────────────────
  // Called only after migrations have completed (see startServer below).
  const doListen = () => {
    server.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
      log(`serving on port ${port}`);
      runPostStartupJobs();
    });
  };

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      logger.warn(`Port ${port} in use — killing zombie process and retrying...`);
      try {
        const { execSync } = require("child_process");
        execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
      } catch {}
      setTimeout(() => {
        server.removeAllListeners("error");
        server.on("error", (e: any) => {
          logger.error("Server error:", { error: e });
        });
        doListen();
      }, 600);
    } else {
      logger.error("Server error:", { error: err });
    }
  });

  // Graceful shutdown: close DB pool so zero-downtime deploys don't leave
  // zombie connections that exhaust max_connections on the next instance.
  const shutdown = async (signal: string) => {
    logger.info(`[Shutdown] ${signal} received — closing DB pool...`);
    try {
      await pool.end();
      logger.info("[Shutdown] DB pool closed cleanly.");
    } catch (e: any) {
      logger.warn("[Shutdown] DB pool close error:", { error: e.message });
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // ── Startup sequence: warmup → migrations → listen ────────────────────────
  // Migrations run to completion BEFORE the port opens. This guarantees:
  //   1. The schema is always up-to-date before any request reaches new code.
  //   2. A failed migration aborts startup, keeping the old deployment alive
  //      instead of serving requests against a stale or broken schema.
  // Set RUN_STARTUP_MIGRATIONS=false to skip migrations entirely (emergency
  // kill-switch for severe lock contention).
  const migrationsEnabled = process.env.RUN_STARTUP_MIGRATIONS !== "false";
  if (!migrationsEnabled) {
    logger.info("⚠ Startup migrations DISABLED via RUN_STARTUP_MIGRATIONS=false");
    migrationsDone = true;
  }

  warmupDb()
    .then(async () => {
      // ── Always-running critical index: exchange_rates upsert constraint ───────
      // This index is required for the exchange_rates upsert to work correctly.
      // It runs unconditionally (even when RUN_STARTUP_MIGRATIONS=false) so that
      // production environments that skipped the bulk migration still get it.
      // CREATE UNIQUE INDEX IF NOT EXISTS is a no-op if the index already exists.
      try {
        await pool.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS exchange_rates_company_date_pair_unique
           ON exchange_rates (company_id, effective_date, from_currency, to_currency)`
        );
      } catch (idxErr: any) {
        // Non-fatal: upsertExchangeRate has a fallback that works without the index.
        logger.warn("[startup] Could not ensure exchange_rates unique index:", { error: idxErr?.message });
      }

      // ── Always-running multi-currency schema columns ──────────────────────────
      // These columns were added by migrations 0011, 0012, 20260720_002–006, but
      // production uses RUN_STARTUP_MIGRATIONS=false so those migrations never ran.
      // ALTER TABLE … ADD COLUMN IF NOT EXISTS is idempotent — safe to run every
      // startup.  Without these columns, /api/stats/net-profit returns 500 and the
      // dashboard shows the "Some financial data could not be loaded" error banner.
      try {
        await pool.query(`
          -- vouchers: currency column (migration 0011)
          ALTER TABLE vouchers
            ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'USD';

          -- user_preferences: preferred_currency (migration 0012)
          ALTER TABLE user_preferences
            ADD COLUMN IF NOT EXISTS preferred_currency VARCHAR(10);

          -- voucher_entries: multi-currency audit columns (migration 20260720_002)
          ALTER TABLE voucher_entries
            ADD COLUMN IF NOT EXISTS transaction_currency        VARCHAR(3),
            ADD COLUMN IF NOT EXISTS transaction_debit_amount    NUMERIC(20,6),
            ADD COLUMN IF NOT EXISTS transaction_credit_amount   NUMERIC(20,6),
            ADD COLUMN IF NOT EXISTS base_debit_amount           NUMERIC(20,6),
            ADD COLUMN IF NOT EXISTS base_credit_amount          NUMERIC(20,6),
            ADD COLUMN IF NOT EXISTS historical_exchange_rate    NUMERIC(20,10),
            ADD COLUMN IF NOT EXISTS rate_convention             VARCHAR(30);

          -- ledger_accounts: opening balance currency (migrations 20260720_003 + 006)
          -- ledger_accounts: category column for net-profit classification
          ALTER TABLE ledger_accounts
            ADD COLUMN IF NOT EXISTS opening_balance_currency         VARCHAR(10),
            ADD COLUMN IF NOT EXISTS opening_balance_historical_rate  NUMERIC(20,10),
            ADD COLUMN IF NOT EXISTS opening_balance_base_amount      NUMERIC(20,6),
            ADD COLUMN IF NOT EXISTS opening_balance_native_amount    NUMERIC(20,6),
            ADD COLUMN IF NOT EXISTS category                         TEXT;

          -- bank_accounts: opening balance currency (migrations 20260720_004 + 006)
          ALTER TABLE bank_accounts
            ADD COLUMN IF NOT EXISTS opening_balance_currency         VARCHAR(10),
            ADD COLUMN IF NOT EXISTS opening_balance_historical_rate  NUMERIC(20,10),
            ADD COLUMN IF NOT EXISTS opening_balance_base_amount      NUMERIC(20,6),
            ADD COLUMN IF NOT EXISTS opening_balance_native_amount    NUMERIC(20,6);

          -- customers: opening balance currency (migration 20260720_006)
          ALTER TABLE customers
            ADD COLUMN IF NOT EXISTS opening_balance_native_amount    NUMERIC(20,6),
            ADD COLUMN IF NOT EXISTS opening_balance_currency         VARCHAR(10),
            ADD COLUMN IF NOT EXISTS opening_balance_historical_rate  NUMERIC(20,10),
            ADD COLUMN IF NOT EXISTS opening_balance_base_amount      NUMERIC(20,6);

          -- suppliers: opening balance currency + side (migration 20260720_006)
          ALTER TABLE suppliers
            ADD COLUMN IF NOT EXISTS opening_balance_side             VARCHAR(2) DEFAULT 'Cr',
            ADD COLUMN IF NOT EXISTS opening_balance_native_amount    NUMERIC(20,6),
            ADD COLUMN IF NOT EXISTS opening_balance_currency         VARCHAR(10),
            ADD COLUMN IF NOT EXISTS opening_balance_historical_rate  NUMERIC(20,10),
            ADD COLUMN IF NOT EXISTS opening_balance_base_amount      NUMERIC(20,6);

          -- employees: opening balance currency + side (migration 20260720_006)
          ALTER TABLE employees
            ADD COLUMN IF NOT EXISTS opening_balance_side             VARCHAR(2) DEFAULT 'Cr',
            ADD COLUMN IF NOT EXISTS opening_balance_native_amount    NUMERIC(20,6),
            ADD COLUMN IF NOT EXISTS opening_balance_currency         VARCHAR(10),
            ADD COLUMN IF NOT EXISTS opening_balance_historical_rate  NUMERIC(20,10),
            ADD COLUMN IF NOT EXISTS opening_balance_base_amount      NUMERIC(20,6);

          -- fixed_assets: purchase currency (migration 20260720_006)
          ALTER TABLE fixed_assets
            ADD COLUMN IF NOT EXISTS purchase_native_amount           NUMERIC(20,6),
            ADD COLUMN IF NOT EXISTS purchase_currency                VARCHAR(10),
            ADD COLUMN IF NOT EXISTS purchase_historical_rate         NUMERIC(20,10),
            ADD COLUMN IF NOT EXISTS purchase_base_amount             NUMERIC(20,6);

          -- salary_advances: remaining_balance + fully_paid (added in a later drizzle migration
          -- that never ran on production because RUN_STARTUP_MIGRATIONS=false).
          -- Without these columns /api/stats/net-profit throws "column does not exist" and
          -- the dashboard shows the financial-data error banner.
          ALTER TABLE salary_advances
            ADD COLUMN IF NOT EXISTS remaining_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS fully_paid        BOOLEAN       NOT NULL DEFAULT false;

          -- fiscal_period_closures: the startup migration at index 2673 only adds an FK
          -- constraint but never creates the table itself. Add it here idempotently so the
          -- table exists before the FK migration runs (it is a no-op if already present).
          CREATE TABLE IF NOT EXISTS fiscal_period_closures (
            id                          SERIAL PRIMARY KEY,
            company_id                  INTEGER      NOT NULL,
            period_start_date           DATE         NOT NULL,
            period_end_date             DATE         NOT NULL,
            closure_date                TIMESTAMP    NOT NULL DEFAULT NOW(),
            closed_by_user_id           VARCHAR      NOT NULL,
            closing_voucher_id          INTEGER      NOT NULL,
            retained_earnings_account_id INTEGER     NOT NULL,
            total_income                DECIMAL(15,2) NOT NULL,
            total_expense               DECIMAL(15,2) NOT NULL,
            net_income                  DECIMAL(15,2) NOT NULL,
            status                      TEXT         NOT NULL DEFAULT 'CLOSED',
            notes                       TEXT,
            created_at                  TIMESTAMP    NOT NULL DEFAULT NOW()
          );
          CREATE UNIQUE INDEX IF NOT EXISTS fiscal_closures_company_period_unique
            ON fiscal_period_closures (company_id, period_end_date);
        `);
        logger.info("[startup] ✓ Multi-currency schema columns ensured");
      } catch (colErr: any) {
        logger.error("[startup] ✗ Could not ensure multi-currency columns:", { error: colErr?.message });
        // Non-fatal: the app will start but the dashboard net-profit query may still fail
        // if the columns are genuinely absent.
      }

      if (migrationsEnabled) {
        try {
          await runMigrations();
        } catch (err: any) {
          logger.error("Migration error (non-fatal — server will still start):", { error: err?.message ?? err });
          migrationsDone = true;
        }
      }
    })
    .then(() => {
      doListen();
    })
    .catch((err: any) => {
      logger.error("Fatal startup error:", { error: err?.message ?? err });
      process.exit(1);
    });
})();
