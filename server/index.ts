import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import fs from "fs";
import { randomBytes } from "crypto";
import { registerRoutes } from "./routes";
import { setupWS } from "./wsServer";
import { startScheduler } from "./services/schedulerService";
import { setupVite, log } from "./vite";
import type { User } from "@shared/schema";
import { db, pool } from "./db";
import { Client } from "pg";

// Global error handlers — prevent unhandled rejections from crashing the process in production
process.on("unhandledRejection", (reason: any) => {
  console.error("[UnhandledRejection]", reason?.message || reason);
});
process.on("uncaughtException", (err: Error) => {
  console.error("[UncaughtException]", err.message, err.stack);
});

// Build version for cache-busting and deployment tracking.
// IMPORTANT: never use Date.now() as the fallback — it changes on every restart
// and causes the browser to think the app was updated, triggering false reload prompts.
const BUILD_VERSION =
  process.env.BUILD_VERSION ||
  process.env.RENDER_GIT_COMMIT?.substring(0, 8) ||
  "dev";

const app = express();

// Compress all HTTP responses (gzip/deflate) — reduces bandwidth by 60-80%
app.use(compression());

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

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

declare module 'express-session' {
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
  }
}

// General API body limit is 2 MB. Upload routes specify their own higher limit via multer.
app.use(express.json({
  limit: "2mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
// /uploads is NOT served publicly — file access goes through authenticated endpoints.

// Trust proxy for HTTPS termination
// This is required for both Replit (development) and Render (production)
// as both run behind reverse proxies
app.set("trust proxy", 1);

// Disable ETag generation globally so Express never sends ETags for API responses.
// ETags cause 304 "Not Modified" responses which prevent balance/data from refreshing.
app.set("etag", false);

// Session middleware
const PgSession = connectPgSimple(session);

if (!process.env.SESSION_SECRET) {
  console.error("CRITICAL: SESSION_SECRET environment variable is not set!");
  console.error("Please set a strong, random SESSION_SECRET for production security.");
  if (process.env.NODE_ENV === "production") {
    process.exit(1);
  }
}

const sessionConfig: session.SessionOptions = {
  name: 'erp.session',
  secret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: process.env.NODE_ENV === "production" || !!process.env.REPL_ID,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
    sameSite: 'lax',
  },
};

// Use PostgreSQL session store when a database is available
// This ensures sessions persist across server restarts
if (process.env.DATABASE_URL || process.env.PGHOST) {
  const connectionString = process.env.DATABASE_URL || 
    `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;
  
  // Match SSL configuration with main database connection
  const isLocalReplitDB = process.env.PGHOST === "helium";
  const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
  const requiresSSL = !isLocalReplitDB && !sslExplicitlyDisabled;
  
  sessionConfig.store = new PgSession({
    conObject: {
      connectionString,
      ssl: requiresSSL ? { rejectUnauthorized: false } : false,
      // Keep session pool small to stay within Render's connection limit.
      // Main pool: 7, session pool: 4 — total 11, well within Render's 25 limit.
      max: 4,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    },
    createTableIfMissing: true,
  });
  
  console.log(`✓ PostgreSQL session store configured (SSL: ${requiresSSL ? 'enabled' : 'disabled'})`);
}

app.use(session(sessionConfig));

// Add build version header to all responses for cache tracking
app.use((_req, res, next) => {
  res.setHeader('X-Build-Version', BUILD_VERSION);
  next();
});

// Disable HTTP-level caching for all API routes.
// Without this, Express generates ETags and the browser returns 304 "Not Modified"
// for every subsequent request — causing TanStack Query's invalidateQueries to have
// no effect (the browser hands back its cached response instead of hitting the server).
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Structured request logging — never logs response bodies to avoid leaking sensitive data.
app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (reqPath.startsWith("/api")) {
      // Intentionally omit response body — it may contain vouchers, balances, passwords, or documents.
      log(`${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`);
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

  console.warn(`[OriginGuard] BLOCKED ${method} ${req.path} | host=${host} origin=${originHeader || "-"} referer=${refererHeader || "-"}`);
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
    console.warn(`[CSRF] BLOCKED ${method} ${req.path} | expected=${expected.slice(0,8)}… got=${typeof got === "string" ? got.slice(0,8) + "…" : "<missing>"}`);
    return res.status(403).json({
      message: "CSRF token missing or invalid.",
      code: "CSRF_TOKEN_MISMATCH",
    });
  } else {
    console.warn(`[CSRF warn-only] ${method} ${req.path} | got=${typeof got === "string" ? "present" : "missing"}`);
    next();
  }
});

// Flag used by /api/health/db to signal readiness to Render's health check.
// Port opens immediately; migrations run in background. Render holds traffic
// on the old instance (via health check 503) until this flips to true.
let migrationsDone = false;

(async () => {
  const migrations = [
    // ── Create missing tables ──────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS user_presence (
      id serial PRIMARY KEY,
      session_id varchar(255) NOT NULL,
      user_id varchar NOT NULL,
      username text NOT NULL,
      current_route text NOT NULL DEFAULT '/',
      company_id integer,
      company_name text,
      role text,
      last_seen timestamp NOT NULL DEFAULT now(),
      CONSTRAINT user_presence_session_unique UNIQUE (session_id)
    )`,
    `CREATE TABLE IF NOT EXISTS direct_messages (
      id serial PRIMARY KEY,
      sender_id varchar NOT NULL,
      receiver_id varchar NOT NULL,
      message text NOT NULL,
      read_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS direct_messages_sender_idx ON direct_messages(sender_id)`,
    `CREATE INDEX IF NOT EXISTS direct_messages_receiver_idx ON direct_messages(receiver_id)`,
    `CREATE TABLE IF NOT EXISTS login_history (
      id serial PRIMARY KEY,
      user_id varchar NOT NULL,
      username text NOT NULL,
      company_id integer,
      company_name text,
      ip_address text,
      user_agent text,
      city text,
      country text,
      login_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS login_history_user_idx ON login_history(user_id)`,
    `CREATE INDEX IF NOT EXISTS login_history_login_at_idx ON login_history(login_at)`,
    // ── Add missing columns to companies table ────────────────────────────────
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS company_type text NOT NULL DEFAULT 'erp'`,
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS base_currency varchar(10) DEFAULT 'USD'`,
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS display_currency varchar(10)`,
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now()`,
    // ── Create exchange_rates table ────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS exchange_rates (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      from_currency varchar(10) NOT NULL,
      to_currency varchar(10) NOT NULL,
      rate decimal(20,6) NOT NULL,
      effective_date date NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS exchange_rates_company_idx ON exchange_rates(company_id)`,
    `CREATE INDEX IF NOT EXISTS exchange_rates_date_idx ON exchange_rates(effective_date)`,
    // ── Add missing columns to existing tables ─────────────────────────────────
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden_erp_cost_fields text[] NOT NULL DEFAULT '{}'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS chatbot_enabled boolean NOT NULL DEFAULT false`,
    `ALTER TABLE user_company_roles ADD COLUMN IF NOT EXISTS can_sell_negative_stock boolean NOT NULL DEFAULT false`,
    `ALTER TABLE user_company_roles ADD COLUMN IF NOT EXISTS daybook_edit_days integer NOT NULL DEFAULT 0`,
    `ALTER TABLE user_company_roles ADD COLUMN IF NOT EXISTS can_access_customers boolean NOT NULL DEFAULT false`,
    `ALTER TABLE user_company_roles ADD COLUMN IF NOT EXISTS cash_account_id integer`,
    `ALTER TABLE user_company_roles ADD COLUMN IF NOT EXISTS pos_station integer`,
    `ALTER TABLE stock_transfer_vouchers ADD COLUMN IF NOT EXISTS inventory_applied boolean DEFAULT false`,
    `ALTER TABLE direct_messages ALTER COLUMN message DROP NOT NULL`,
    `ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS file_url text`,
    `ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS file_name text`,
    `ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS file_type text`,
    `ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS file_size integer`,
    `CREATE TABLE IF NOT EXISTS stored_files (
      id serial PRIMARY KEY,
      company_id integer NOT NULL REFERENCES companies(id),
      file_name text NOT NULL,
      file_type text NOT NULL,
      file_size integer NOT NULL,
      file_data text NOT NULL,
      description text,
      uploaded_by integer,
      uploaded_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS spreadsheets (
      id serial PRIMARY KEY,
      company_id integer NOT NULL REFERENCES companies(id),
      name text NOT NULL DEFAULT 'Untitled Spreadsheet',
      data jsonb NOT NULL DEFAULT '[]',
      created_by text,
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
    // Factory supplier hierarchy
    `ALTER TABLE factory_suppliers ADD COLUMN IF NOT EXISTS parent_id integer`,
    // Factory supplier support in voucher entries
    `ALTER TABLE voucher_entries ADD COLUMN IF NOT EXISTS factory_supplier_id integer`,
    // Factory raw stock OB commission fields
    `ALTER TABLE factory_raw_stock ADD COLUMN IF NOT EXISTS commission_person_name text`,
    `ALTER TABLE factory_raw_stock ADD COLUMN IF NOT EXISTS commission_amount decimal(20,4)`,
    `ALTER TABLE factory_raw_stock ADD COLUMN IF NOT EXISTS commission_currency_code varchar(10)`,
    `ALTER TABLE factory_raw_stock ADD COLUMN IF NOT EXISTS commission_fx_rate_to_usd decimal(20,8)`,
    `ALTER TABLE factory_raw_stock ADD COLUMN IF NOT EXISTS commission_amount_usd decimal(20,4)`,
    `ALTER TABLE factory_raw_stock ADD COLUMN IF NOT EXISTS commission_ledger_account_id integer`,
    `ALTER TABLE factory_raw_stock ADD COLUMN IF NOT EXISTS commission_supplier_id integer`,
    // Factory supplier payments table
    `CREATE TABLE IF NOT EXISTS factory_supplier_payments (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      supplier_id integer NOT NULL,
      date varchar(20) NOT NULL,
      amount decimal(20,4) NOT NULL,
      currency_code varchar(10) NOT NULL DEFAULT 'USD',
      fx_rate_to_usd decimal(20,8) NOT NULL DEFAULT 1,
      amount_usd decimal(20,4) NOT NULL,
      paid_from_account_id integer,
      notes text,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS factory_supplier_fx_transfers (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      from_supplier_id integer NOT NULL,
      to_supplier_id integer NOT NULL,
      date varchar(20) NOT NULL,
      from_currency_code varchar(10) NOT NULL,
      from_amount decimal(20,4) NOT NULL,
      fx_rate_to_usd decimal(20,8) NOT NULL,
      to_amount_usd decimal(20,4) NOT NULL,
      notes text,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    // ── Fix stale factory page access keys (old Settings.tsx had wrong route keys) ──
    // factory/raw-stock → factory/raw-materials
    `UPDATE factory_user_page_access SET page_key = 'factory/raw-materials' WHERE page_key = 'factory/raw-stock' AND NOT EXISTS (SELECT 1 FROM factory_user_page_access b WHERE b.company_id = factory_user_page_access.company_id AND b.user_id = factory_user_page_access.user_id AND b.page_key = 'factory/raw-materials')`,
    `DELETE FROM factory_user_page_access WHERE page_key = 'factory/raw-stock'`,
    // factory/bales-history → factory/bales-hub
    `UPDATE factory_user_page_access SET page_key = 'factory/bales-hub' WHERE page_key = 'factory/bales-history' AND NOT EXISTS (SELECT 1 FROM factory_user_page_access b WHERE b.company_id = factory_user_page_access.company_id AND b.user_id = factory_user_page_access.user_id AND b.page_key = 'factory/bales-hub')`,
    `DELETE FROM factory_user_page_access WHERE page_key = 'factory/bales-history'`,
    // factory/sales/loading/new → factory/sales/loadings
    `UPDATE factory_user_page_access SET page_key = 'factory/sales/loadings' WHERE page_key = 'factory/sales/loading/new' AND NOT EXISTS (SELECT 1 FROM factory_user_page_access b WHERE b.company_id = factory_user_page_access.company_id AND b.user_id = factory_user_page_access.user_id AND b.page_key = 'factory/sales/loadings')`,
    `DELETE FROM factory_user_page_access WHERE page_key = 'factory/sales/loading/new'`,
    // factory/sales/loading/pending → factory/sales/loadings
    `UPDATE factory_user_page_access SET page_key = 'factory/sales/loadings' WHERE page_key = 'factory/sales/loading/pending' AND NOT EXISTS (SELECT 1 FROM factory_user_page_access b WHERE b.company_id = factory_user_page_access.company_id AND b.user_id = factory_user_page_access.user_id AND b.page_key = 'factory/sales/loadings')`,
    `DELETE FROM factory_user_page_access WHERE page_key = 'factory/sales/loading/pending'`,
    // factory/sales/pending-invoices → factory/sales/invoices (legacy step)
    `UPDATE factory_user_page_access SET page_key = 'factory/sales/invoices' WHERE page_key = 'factory/sales/pending-invoices' AND NOT EXISTS (SELECT 1 FROM factory_user_page_access b WHERE b.company_id = factory_user_page_access.company_id AND b.user_id = factory_user_page_access.user_id AND b.page_key = 'factory/sales/invoices')`,
    `DELETE FROM factory_user_page_access WHERE page_key = 'factory/sales/pending-invoices'`,
    // Consolidate proformas + invoices into unified invoicing page
    `UPDATE factory_user_page_access SET page_key = 'factory/invoicing' WHERE page_key = 'factory/sales/proformas' AND NOT EXISTS (SELECT 1 FROM factory_user_page_access b WHERE b.company_id = factory_user_page_access.company_id AND b.user_id = factory_user_page_access.user_id AND b.page_key = 'factory/invoicing')`,
    `UPDATE factory_user_page_access SET page_key = 'factory/invoicing' WHERE page_key = 'factory/sales/invoices' AND NOT EXISTS (SELECT 1 FROM factory_user_page_access b WHERE b.company_id = factory_user_page_access.company_id AND b.user_id = factory_user_page_access.user_id AND b.page_key = 'factory/invoicing')`,
    `DELETE FROM factory_user_page_access WHERE page_key IN ('factory/sales/proformas', 'factory/sales/invoices')`,
    // Delete obsolete keys that have no equivalent in the current sidebar
    `DELETE FROM factory_user_page_access WHERE page_key IN ('factory/mix-batches', 'factory/sales/new', 'factory/bale-transfers', 'factory/create', 'factory/users', 'factory/daybook')`,
    // Add ledger account link to customer order charges
    `ALTER TABLE customer_order_charges ADD COLUMN IF NOT EXISTS ledger_account_id integer`,
    // Bale recode / relabeling audit tables
    `CREATE TABLE IF NOT EXISTS bale_recode_sessions (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      performed_by varchar(255),
      uploaded_filename text,
      print_format text NOT NULL DEFAULT 'A4',
      design_color text,
      total_rows integer NOT NULL DEFAULT 0,
      valid_rows integer NOT NULL DEFAULT 0,
      invalid_rows integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS bale_recode_items (
      id serial PRIMARY KEY,
      session_id integer NOT NULL,
      old_reference_code text NOT NULL,
      new_reference_code text,
      product_name text,
      article_code text,
      weight_kg text,
      status text NOT NULL DEFAULT 'SUCCESS',
      error_message text
    )`,
    // Sync factory_mix_batches with production schema
    `ALTER TABLE factory_mix_batches ADD COLUMN IF NOT EXISTS batch_number text`,
    // Sync factory_mix_batch_sources with production schema
    `ALTER TABLE factory_mix_batch_sources ADD COLUMN IF NOT EXISTS source_type text`,
    `ALTER TABLE factory_mix_batch_sources ADD COLUMN IF NOT EXISTS source_id integer`,
    `ALTER TABLE factory_mix_batch_sources ADD COLUMN IF NOT EXISTS quantity_kg decimal(15,3)`,
    `ALTER TABLE factory_mix_batch_sources ADD COLUMN IF NOT EXISTS notes text`,
    `CREATE TABLE IF NOT EXISTS factory_worker_advances (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      worker_id integer NOT NULL REFERENCES factory_workers(id),
      advance_date date NOT NULL,
      amount decimal(20, 2) NOT NULL,
      remaining_balance decimal(20, 2) NOT NULL DEFAULT 0,
      cash_account_id integer,
      notes text,
      fully_paid boolean NOT NULL DEFAULT false,
      created_at timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS factory_worker_advances_company_idx ON factory_worker_advances (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_worker_advances_worker_idx ON factory_worker_advances (worker_id)`,
    `ALTER TABLE factory_worker_advances ADD COLUMN IF NOT EXISTS remaining_balance decimal(20,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE factory_worker_advances ADD COLUMN IF NOT EXISTS cash_account_id integer`,
    `ALTER TABLE factory_worker_advances ADD COLUMN IF NOT EXISTS fully_paid boolean NOT NULL DEFAULT false`,
    `ALTER TABLE factory_worker_advances ADD COLUMN IF NOT EXISTS repayment_type VARCHAR(30) NOT NULL DEFAULT 'salary_deduction'`,
    `CREATE TABLE IF NOT EXISTS factory_advance_repayments (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      advance_id integer NOT NULL REFERENCES factory_worker_advances(id),
      worker_id integer NOT NULL,
      repayment_date date NOT NULL,
      amount decimal(20, 2) NOT NULL,
      cash_account_id integer,
      notes text,
      created_at timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS factory_advance_repayments_advance_idx ON factory_advance_repayments (advance_id)`,
    `CREATE INDEX IF NOT EXISTS factory_advance_repayments_company_idx ON factory_advance_repayments (company_id)`,
    // Live spreadsheet links (shared Google Sheet / external links)
    `CREATE TABLE IF NOT EXISTS live_spreadsheets (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      name text NOT NULL,
      url text NOT NULL,
      description text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS inventory_negative_layers (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      location_id integer NOT NULL,
      stock_item_id integer NOT NULL,
      qty decimal(15,3) NOT NULL,
      provisional_rate decimal(20,4) NOT NULL DEFAULT 0,
      source_voucher_type varchar(100),
      source_voucher_id integer,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS inv_neg_layers_loc_item ON inventory_negative_layers (location_id, stock_item_id)`,
    // Mix batch daily consumption (Mar 2026)
    `ALTER TABLE factory_mix_batches ADD COLUMN IF NOT EXISTS operator_user text`,
    `ALTER TABLE factory_mix_batches ADD COLUMN IF NOT EXISTS batch_date date`,
    `ALTER TABLE factory_mix_batches ADD COLUMN IF NOT EXISTS carry_forward_from_id integer`,
    `CREATE TABLE IF NOT EXISTS factory_daily_usages (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      mix_batch_id integer NOT NULL,
      kg_used numeric NOT NULL,
      operator_user text,
      used_date date NOT NULL DEFAULT CURRENT_DATE,
      notes text,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS factory_daily_usages_batch_idx ON factory_daily_usages (mix_batch_id)`,
    `CREATE INDEX IF NOT EXISTS factory_daily_usages_company_date_idx ON factory_daily_usages (company_id, used_date)`,
    // Wipers Re-Entry by Date (Mar 2026) — backdated stock entry date per bale
    `ALTER TABLE factory_bales ADD COLUMN IF NOT EXISTS stock_entry_date date`,
    // Freight currency per container (Mar 2026)
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS freight_currency_code varchar(10) DEFAULT 'USD'`,
    // Container-level multiple other charges (Mar 2026)
    `CREATE TABLE IF NOT EXISTS factory_container_other_charges (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      container_id integer NOT NULL,
      description text NOT NULL,
      amount numeric(20,2) NOT NULL,
      ledger_account_id integer,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS factory_container_other_charges_container_idx ON factory_container_other_charges (container_id)`,
    `ALTER TABLE factory_container_other_charges ADD COLUMN IF NOT EXISTS currency_code text DEFAULT 'USD'`,
    // POS profit comparison on receipt (Mar 2026)
    `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS show_profit_comparison_on_pos boolean NOT NULL DEFAULT false`,
    // Store configured (Hassan's) price on each sales item so reprints are accurate (Mar 2026)
    `ALTER TABLE sales_items ADD COLUMN IF NOT EXISTS configured_price decimal(15,6)`,
    // Employee bonus configuration fields (Mar 2026)
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS sales_bonus_pct decimal(10,4)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS bales_bonus_rate decimal(10,4)`,
    // Per-employee per-location bale bonus rates (Mar 2026)
    `CREATE TABLE IF NOT EXISTS employee_bale_rates (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      employee_id integer NOT NULL,
      location_id integer NOT NULL,
      rate decimal(10,4) NOT NULL
    )`,
    // Cross-company sales bonus % source fields on employees (Mar 2026)
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS sales_bonus_pct_source_company_id integer`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS sales_bonus_pct_location_id integer`,
    // Cross-company source on bale rates (Mar 2026)
    `ALTER TABLE employee_bale_rates ADD COLUMN IF NOT EXISTS source_company_id integer`,
    // Per-employee per-location sales bonus % rates table (Mar 2026)
    `CREATE TABLE IF NOT EXISTS employee_bale_pct_rates (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      employee_id integer NOT NULL,
      location_id integer NOT NULL,
      pct decimal(10,4) NOT NULL,
      source_company_id integer
    )`,
    // Company settings table (logo, invoice footer, misc per-company config)
    `CREATE TABLE IF NOT EXISTS company_settings (
      id serial PRIMARY KEY,
      company_id integer NOT NULL UNIQUE,
      logo_url text,
      logo_file_name text,
      logo_updated_at timestamp,
      invoice_footer text,
      parent_credit_account_id integer,
      net_position_adjustment decimal(15,2) DEFAULT 0,
      pos_excel_import_enabled boolean DEFAULT false,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
    // Intercompany POS auto-transfer config (Mar 2026)
    `CREATE TABLE IF NOT EXISTS intercompany_pos_configs (
      id serial PRIMARY KEY,
      source_company_id integer NOT NULL UNIQUE,
      dest_company_id integer NOT NULL,
      source_interco_account_id integer NOT NULL,
      dest_interco_account_id integer NOT NULL,
      enabled boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
    // Factory Bale Waste Dispatch (Mar 2026)
    `CREATE TABLE IF NOT EXISTS factory_bale_waste_dispatches (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      dispatch_number text NOT NULL,
      dispatch_date date NOT NULL,
      notes text,
      total_bales integer NOT NULL DEFAULT 0,
      total_weight_kg decimal(15,3) NOT NULL DEFAULT 0,
      total_cost_written_off decimal(15,2) NOT NULL DEFAULT 0,
      created_by integer,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE factory_bales ADD COLUMN IF NOT EXISTS waste_dispatch_id integer`,
    // ERP Payroll Runs tables (Mar 2026)
    `CREATE TABLE IF NOT EXISTS erp_payroll_runs (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      status text NOT NULL DEFAULT 'DRAFT',
      date text NOT NULL,
      notes text,
      payment_account_id integer,
      paid_at text,
      created_at text NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS erp_payroll_run_items (
      id serial PRIMARY KEY,
      run_id integer NOT NULL,
      employee_id integer NOT NULL,
      employee_name text NOT NULL,
      group_name text,
      base_salary decimal(18,2) NOT NULL,
      deduction decimal(18,2) NOT NULL DEFAULT 0,
      net_pay decimal(18,2) NOT NULL
    )`,
    // Waste Dispatch tables (Mar 2026)
    `CREATE TABLE IF NOT EXISTS waste_dispatches (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      location_id integer NOT NULL,
      voucher_id integer,
      dispatch_number text NOT NULL,
      dispatch_date date NOT NULL,
      notes text,
      total_amount decimal(15,2) NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS waste_dispatch_items (
      id serial PRIMARY KEY,
      dispatch_id integer NOT NULL,
      stock_item_id integer NOT NULL,
      quantity decimal(15,3) NOT NULL,
      rate decimal(15,2) NOT NULL,
      total_amount decimal(15,2) NOT NULL
    )`,
    // Factory waste type column (missed in original factory_waste_entries creation)
    `ALTER TABLE factory_waste_entries ADD COLUMN IF NOT EXISTS waste_type varchar(50)`,
    // POS draft sales (saved cart state for POS users)
    `CREATE TABLE IF NOT EXISTS draft_pos_sales (
      id serial PRIMARY KEY,
      user_id varchar(255) NOT NULL,
      location_id integer NOT NULL,
      payment_account_type text,
      payment_account_id integer,
      is_credit_sale boolean DEFAULT false,
      notes text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS draft_pos_sale_items (
      id serial PRIMARY KEY,
      draft_id integer NOT NULL,
      stock_item_id integer NOT NULL,
      quantity decimal(15,3) NOT NULL,
      rate decimal(15,2) NOT NULL,
      amount decimal(15,2) NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    // Employee attendance tracking
    `CREATE TABLE IF NOT EXISTS employee_attendance (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      employee_id integer NOT NULL REFERENCES employees(id),
      attendance_date date NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'Present',
      notes text,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT employee_attendance_unique UNIQUE (employee_id, attendance_date)
    )`,
    `CREATE INDEX IF NOT EXISTS employee_attendance_company_date_idx ON employee_attendance (company_id, attendance_date)`,
    // Employee advances
    `CREATE TABLE IF NOT EXISTS employee_advances (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      employee_id integer NOT NULL REFERENCES employees(id),
      advance_date date NOT NULL,
      amount decimal(20,2) NOT NULL,
      remaining_balance decimal(20,2) NOT NULL DEFAULT 0,
      cash_account_id integer,
      notes text,
      fully_paid boolean NOT NULL DEFAULT false,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS employee_advances_company_idx ON employee_advances (company_id)`,
    `CREATE INDEX IF NOT EXISTS employee_advances_employee_idx ON employee_advances (employee_id)`,
    // Employee advance repayments
    `CREATE TABLE IF NOT EXISTS employee_advance_repayments (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      advance_id integer NOT NULL REFERENCES employee_advances(id) ON DELETE CASCADE,
      employee_id integer NOT NULL,
      repayment_date date NOT NULL,
      amount decimal(20,2) NOT NULL,
      cash_account_id integer,
      notes text,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS employee_advance_repayments_advance_idx ON employee_advance_repayments (advance_id)`,
    // Worker bonuses
    `CREATE TABLE IF NOT EXISTS worker_bonuses (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      worker_id integer NOT NULL REFERENCES factory_workers(id),
      bonus_date date NOT NULL,
      amount decimal(20,2) NOT NULL,
      notes text,
      status varchar(20) NOT NULL DEFAULT 'pending',
      cash_account_id integer,
      paid_date date,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS worker_bonuses_company_idx ON worker_bonuses (company_id)`,
    `CREATE INDEX IF NOT EXISTS worker_bonuses_worker_idx ON worker_bonuses (worker_id)`,
    // Employee bonuses
    `CREATE TABLE IF NOT EXISTS employee_bonuses (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      employee_id integer NOT NULL REFERENCES employees(id),
      bonus_date date NOT NULL,
      amount decimal(20,2) NOT NULL,
      notes text,
      voucher_id integer,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS employee_bonuses_company_idx ON employee_bonuses (company_id)`,
    `CREATE INDEX IF NOT EXISTS employee_bonuses_employee_idx ON employee_bonuses (employee_id)`,
    // ── factory_containers — columns added incrementally ──────────────────────
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS freight_account_id integer`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS freight_supplier_id integer`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS other_charges decimal(20,2) DEFAULT 0`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS other_charges_currency_code varchar(10)`,
    // Backfill: existing rows that had no other_charges_currency_code set should use USD (not container currency)
    `UPDATE factory_containers SET other_charges_currency_code = 'USD' WHERE other_charges_currency_code IS NULL AND COALESCE(other_charges::numeric, 0) > 0`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS other_charges_account_id integer`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS other_charges_supplier_id integer`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS commission_amount decimal(20,2) DEFAULT 0`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS commission_currency_code varchar(10) DEFAULT 'USD'`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS commission_account_id integer`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS commission_supplier_id integer`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS commission_notes text`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS duty_amount decimal(20,2)`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS duty_account_id integer`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS duty_status text NOT NULL DEFAULT 'NONE'`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS duty_notes text`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS fx_rate_to_usd_import decimal(20,8)`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS fx_rate_to_usd_offload decimal(20,8)`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS fx_rate_source text NOT NULL DEFAULT 'auto'`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS fx_rate_date_import date`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS fx_rate_date_offload date`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS rate_per_kg_usd decimal(20,4)`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS final_payable_amount_usd decimal(20,4)`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now()`,
    // Pre-offload snapshot columns — saved during offload, restored on reverse (Mar 2026)
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_freight decimal(20,2)`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_freight_currency_code varchar(10)`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_freight_account_id integer`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_freight_supplier_id integer`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_other_charges decimal(20,2)`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_other_charges_account_id integer`,
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS pre_offload_other_charges_supplier_id integer`,
    `CREATE TABLE IF NOT EXISTS factory_pos_sales (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      sale_number text NOT NULL,
      tx_date date NOT NULL,
      location_id integer,
      customer_name text,
      notes text,
      total_amount decimal(20,2) NOT NULL DEFAULT 0,
      currency_code varchar(10) NOT NULL DEFAULT 'USD',
      cash_account_id integer,
      status text NOT NULL DEFAULT 'COMPLETED',
      created_by integer,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS factory_pos_sale_items (
      id serial PRIMARY KEY,
      sale_id integer NOT NULL,
      company_id integer NOT NULL,
      product_id integer,
      product_name text NOT NULL,
      article_code text,
      quantity integer NOT NULL DEFAULT 1,
      unit_price decimal(20,2) NOT NULL DEFAULT 0,
      total_amount decimal(20,2) NOT NULL DEFAULT 0,
      currency_code varchar(10) NOT NULL DEFAULT 'USD'
    )`,
    `ALTER TABLE factory_pos_sales ADD COLUMN IF NOT EXISTS expenses_json text`,
    `ALTER TABLE factory_pos_sales ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'CASH'`,
    `ALTER TABLE factory_pos_sales ADD COLUMN IF NOT EXISTS customer_id integer`,
    `ALTER TABLE factory_pos_sales ADD COLUMN IF NOT EXISTS deposit_amount decimal(20,2) DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS factory_worker_categories (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      name varchar(200) NOT NULL,
      worker_ids jsonb NOT NULL DEFAULT '[]',
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE customer_proforma_lines ADD COLUMN IF NOT EXISTS price_fixed boolean NOT NULL DEFAULT false`,
    `ALTER TABLE customer_proforma_lines ADD COLUMN IF NOT EXISTS production_price_per_bale numeric(20,2) NOT NULL DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS factory_raw_material_adjustments (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      date varchar(20) NOT NULL,
      type varchar(10) NOT NULL,
      kg decimal(15,3) NOT NULL,
      cost_per_kg decimal(20,4) DEFAULT '0',
      currency_code varchar(10) DEFAULT 'USD',
      supplier_id integer,
      material_label varchar(200),
      notes text,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS agent_accounts (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      account_id varchar(50) NOT NULL,
      account_type varchar(50) NOT NULL,
      account_name varchar(300) NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      UNIQUE(company_id, account_id)
    )`,
    `CREATE TABLE IF NOT EXISTS proforma_stock_reservations (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      proforma_id integer NOT NULL,
      article_code varchar(50) NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      UNIQUE(company_id, proforma_id, article_code)
    )`,
    // factory_settings columns added in phases — add missing boolean columns
    `ALTER TABLE factory_settings ADD COLUMN IF NOT EXISTS net_profit_enabled boolean NOT NULL DEFAULT false`,
    `ALTER TABLE factory_settings ADD COLUMN IF NOT EXISTS production_summary_enabled boolean NOT NULL DEFAULT false`,
    `ALTER TABLE factory_settings ADD COLUMN IF NOT EXISTS supplier_report_enabled boolean NOT NULL DEFAULT false`,
    `ALTER TABLE factory_settings ADD COLUMN IF NOT EXISTS supplier_statement_enabled boolean NOT NULL DEFAULT false`,
    `ALTER TABLE factory_settings ADD COLUMN IF NOT EXISTS hide_selling_price boolean NOT NULL DEFAULT false`,
    `ALTER TABLE factory_settings ADD COLUMN IF NOT EXISTS hide_avg_cost boolean NOT NULL DEFAULT false`,
    // Several factory tables have created_by as integer but users now use UUID strings — migrate all
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'factory_daybook_entries' AND column_name = 'created_by' AND data_type = 'integer'
       ) THEN
         ALTER TABLE factory_daybook_entries
           ALTER COLUMN created_by TYPE character varying
           USING CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END;
       END IF;
     END $$`,
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'factory_bale_waste_dispatches' AND column_name = 'created_by' AND data_type = 'integer'
       ) THEN
         ALTER TABLE factory_bale_waste_dispatches
           ALTER COLUMN created_by TYPE character varying
           USING CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END;
       END IF;
     END $$`,
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'factory_pos_sales' AND column_name = 'created_by' AND data_type = 'integer'
       ) THEN
         ALTER TABLE factory_pos_sales
           ALTER COLUMN created_by TYPE character varying
           USING CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END;
       END IF;
     END $$`,
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'factory_pressing_batches' AND column_name = 'created_by' AND data_type = 'integer'
       ) THEN
         ALTER TABLE factory_pressing_batches
           ALTER COLUMN created_by TYPE character varying
           USING CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END;
       END IF;
     END $$`,
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'factory_waste_entries' AND column_name = 'created_by' AND data_type = 'integer'
       ) THEN
         ALTER TABLE factory_waste_entries
           ALTER COLUMN created_by TYPE character varying
           USING CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END;
       END IF;
     END $$`,
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'container_freight_payments' AND column_name = 'created_by' AND data_type = 'integer'
       ) THEN
         ALTER TABLE container_freight_payments
           ALTER COLUMN created_by TYPE character varying
           USING CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END;
       END IF;
     END $$`,
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'pressing_batches' AND column_name = 'created_by' AND data_type = 'integer'
       ) THEN
         ALTER TABLE pressing_batches
           ALTER COLUMN created_by TYPE character varying
           USING CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END;
       END IF;
     END $$`,
    // Backfill offload_date on containers that were offloaded before the column was written.
    // The offloadContainer() function previously set status=OFFLOADED but never wrote offload_date.
    // Pull the date from the container_offloads record (offloaded_at) so the Container Report
    // date filter and all ERP displays show the correct offload date for historical data.
    `UPDATE containers c
     SET offload_date = (
       SELECT DATE(co.offloaded_at)
       FROM container_offloads co
       WHERE co.container_id = c.id
       ORDER BY co.id DESC
       LIMIT 1
     )
     WHERE c.status = 'OFFLOADED'
       AND c.offload_date IS NULL`,
    // Financial Snapshot pinned accounts per company/card (Apr 2026)
    `CREATE TABLE IF NOT EXISTS snapshot_pinned_accounts (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      card_key varchar(50) NOT NULL,
      account_id varchar(50) NOT NULL,
      account_type varchar(50) NOT NULL,
      account_name varchar(300) NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT snapshot_pinned_accounts_unique UNIQUE (company_id, card_key, account_id)
    )`,
    `CREATE TABLE IF NOT EXISTS stock_transfer_revisions (
      id serial PRIMARY KEY,
      transfer_id integer NOT NULL,
      revision_number integer NOT NULL,
      note text,
      optional boolean NOT NULL DEFAULT false,
      revision_date timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS stock_transfer_revision_items (
      id serial PRIMARY KEY,
      revision_id integer NOT NULL,
      stock_item_id integer NOT NULL,
      stock_item_name text NOT NULL,
      source_location_id integer,
      source_location_name text,
      original_quantity decimal(15,3) NOT NULL,
      delta decimal(15,3) NOT NULL,
      new_quantity decimal(15,3) NOT NULL
    )`,
    `ALTER TABLE stock_transfer_revisions ADD COLUMN IF NOT EXISTS created_by varchar`,
    // Transport allowance on worker profile
    `ALTER TABLE factory_workers ADD COLUMN IF NOT EXISTS transport_allowance decimal(20,2) DEFAULT 0`,
    // Transport column on payroll records
    `ALTER TABLE factory_payrolls ADD COLUMN IF NOT EXISTS transport decimal(20,2) DEFAULT 0`,
    // Daily export recipients list
    `CREATE TABLE IF NOT EXISTS export_recipients (
      id serial PRIMARY KEY,
      email varchar(255) NOT NULL UNIQUE,
      active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    // Daily export settings (singleton row id=1)
    `CREATE TABLE IF NOT EXISTS export_settings (
      id integer PRIMARY KEY,
      gmail_user varchar(255) NOT NULL DEFAULT '',
      gmail_app_password text NOT NULL DEFAULT '',
      schedule_enabled boolean NOT NULL DEFAULT false,
      last_run_at timestamp
    )`,
    // WhatsApp (Green API) settings — singleton row id=1
    `CREATE TABLE IF NOT EXISTS whatsapp_settings (
      id integer PRIMARY KEY,
      instance_id varchar(255) NOT NULL DEFAULT '',
      api_token text NOT NULL DEFAULT '',
      enabled boolean NOT NULL DEFAULT false,
      monthly_auto_send boolean NOT NULL DEFAULT false,
      daily_auto_send boolean NOT NULL DEFAULT false
    )`,
    `ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS daily_auto_send boolean NOT NULL DEFAULT false`,
    `ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS daily_recipient_id integer`,
    // WhatsApp recipients (individual numbers or group chatIds) — per-tenant
    `CREATE TABLE IF NOT EXISTS whatsapp_recipients (
      id serial PRIMARY KEY,
      chat_id varchar(255) NOT NULL UNIQUE,
      name varchar(255) NOT NULL DEFAULT '',
      is_group boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    // Tenant isolation (May 2026): scope every recipient to a company
    `ALTER TABLE whatsapp_recipients ADD COLUMN IF NOT EXISTS company_id integer`,
    // Backfill any pre-existing rows to the lowest companyId (parent company convention)
    `UPDATE whatsapp_recipients SET company_id = (SELECT MIN(id) FROM companies) WHERE company_id IS NULL`,
    // Drop the old global UNIQUE on chat_id; replace with per-tenant uniqueness
    `ALTER TABLE whatsapp_recipients DROP CONSTRAINT IF EXISTS whatsapp_recipients_chat_id_key`,
    `CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_recipients_company_chat_unique ON whatsapp_recipients (company_id, chat_id)`,
    // Stock + Net Position report — per-company config sent to one specific group
    `CREATE TABLE IF NOT EXISTS whatsapp_stock_settings (
      id serial PRIMARY KEY,
      company_id integer,
      recipient_id integer,
      auto_send boolean NOT NULL DEFAULT false,
      enabled boolean NOT NULL DEFAULT false,
      frequency varchar(20) NOT NULL DEFAULT 'daily',
      send_hour integer NOT NULL DEFAULT 18,
      send_day_of_week integer,
      last_sent_at timestamp
    )`,
    `ALTER TABLE whatsapp_stock_settings ADD COLUMN IF NOT EXISTS frequency varchar(20) NOT NULL DEFAULT 'daily'`,
    `ALTER TABLE whatsapp_stock_settings ADD COLUMN IF NOT EXISTS send_hour integer NOT NULL DEFAULT 18`,
    `ALTER TABLE whatsapp_stock_settings ADD COLUMN IF NOT EXISTS send_day_of_week integer`,
    `ALTER TABLE whatsapp_stock_settings ADD COLUMN IF NOT EXISTS last_sent_at timestamp`,

    // Update ALL existing credit sale voucher entries to use new narration format:
    // "POS - [Customer Name] - [Location Name]" instead of old "Credit Sale - POSXXX"
    // Debit entries (customer receivable — Asset account) — use CTE to avoid ambiguity
    `WITH debit_narrations AS (
       SELECT ve.id AS entry_id,
              'POS - ' || la.name || ' - ' || COALESCE(v.location_name, '') AS new_narration
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id
       JOIN ledger_accounts la ON la.id = ve.ledger_account_id
       WHERE v.is_credit_sale = true
         AND ve.debit_amount::numeric > 0
         AND la.account_type = 'Asset'
     )
     UPDATE voucher_entries
     SET narration = debit_narrations.new_narration
     FROM debit_narrations
     WHERE voucher_entries.id = debit_narrations.entry_id`,

    // Credit entries (SALES account side of credit sale vouchers) — use CTE
    `WITH credit_narrations AS (
       SELECT credit_ve.id AS entry_id,
              'POS - ' || la.name || ' - ' || COALESCE(v.location_name, '') AS new_narration
       FROM vouchers v
       JOIN voucher_entries debit_ve ON (
         debit_ve.voucher_id = v.id AND debit_ve.debit_amount::numeric > 0
       )
       JOIN ledger_accounts la ON (
         la.id = debit_ve.ledger_account_id AND la.account_type = 'Asset'
       )
       JOIN voucher_entries credit_ve ON (
         credit_ve.voucher_id = v.id AND credit_ve.credit_amount::numeric > 0
       )
       WHERE v.is_credit_sale = true
     )
     UPDATE voucher_entries
     SET narration = credit_narrations.new_narration
     FROM credit_narrations
     WHERE voucher_entries.id = credit_narrations.entry_id`,

    // Net position scheduled export — configurable group + frequency
    `CREATE TABLE IF NOT EXISTS net_position_export_settings (
       id           integer PRIMARY KEY DEFAULT 1,
       recipient_id integer,
       frequency    varchar(20) NOT NULL DEFAULT 'daily',
       send_hour    integer NOT NULL DEFAULT 18,
       send_day_of_week integer,
       enabled      boolean NOT NULL DEFAULT false,
       auto_send    boolean NOT NULL DEFAULT false,
       last_sent_at timestamp
    )`,
    // container_offloads.optional — marks optional bale lines (added Apr 2026)
    `ALTER TABLE container_offloads ADD COLUMN IF NOT EXISTS optional BOOLEAN NOT NULL DEFAULT false`,
    // Rename waste-dispatched bale status from REMOVED → DISPATCHED (Apr 2026)
    `UPDATE factory_bales SET status = 'DISPATCHED' WHERE status = 'REMOVED' AND waste_dispatch_id IS NOT NULL`,
    // Any remaining REMOVED bales (manual deletions, no waste dispatch) → DELETED (Apr 2026)
    `UPDATE factory_bales SET status = 'DELETED' WHERE status = 'REMOVED'`,
    // Rename bale status FINALIZED → IN_STOCK (Apr 2026) — pressing finalization now sets IN_STOCK directly
    `UPDATE factory_bales SET status = 'IN_STOCK' WHERE status = 'FINALIZED'`,

    // ── Rental Management tables (Apr 2026) ───────────────────────────────────
    `CREATE TABLE IF NOT EXISTS property_units (
      id             SERIAL PRIMARY KEY,
      company_id     INTEGER NOT NULL,
      module         TEXT NOT NULL DEFAULT 'PROPERTIES',
      unit_type      TEXT NOT NULL,
      location_group TEXT NOT NULL,
      unit_number    TEXT NOT NULL,
      size           TEXT,
      dimensions     TEXT,
      notes          TEXT,
      active         BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS property_units_company_module_unit_unique
       ON property_units (company_id, module, unit_number)`,
    `CREATE INDEX IF NOT EXISTS property_units_company_idx
       ON property_units (company_id, module, unit_type)`,

    `CREATE TABLE IF NOT EXISTS property_contracts (
      id                            SERIAL PRIMARY KEY,
      company_id                    INTEGER NOT NULL,
      module                        TEXT NOT NULL DEFAULT 'PROPERTIES',
      unit_id                       INTEGER NOT NULL,
      tenant_name                   TEXT NOT NULL,
      guarantee_period              TEXT,
      guarantee_amount              NUMERIC(20,2) NOT NULL DEFAULT 0,
      rental_amount                 NUMERIC(20,2) NOT NULL DEFAULT 0,
      start_date                    DATE NOT NULL,
      end_date                      DATE,
      status                        TEXT NOT NULL DEFAULT 'ACTIVE',
      notes                         TEXT,
      guarantee_posted_to_statement BOOLEAN NOT NULL DEFAULT FALSE,
      guarantee_posted_amount       NUMERIC(20,2) DEFAULT 0,
      created_at                    TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS property_contracts_unit_idx
       ON property_contracts (unit_id, status)`,
    `CREATE INDEX IF NOT EXISTS property_contracts_company_idx
       ON property_contracts (company_id, status)`,

    `CREATE TABLE IF NOT EXISTS property_monthly_ledger (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER NOT NULL,
      module          TEXT NOT NULL DEFAULT 'PROPERTIES',
      contract_id     INTEGER NOT NULL,
      unit_id         INTEGER NOT NULL,
      year            INTEGER NOT NULL,
      month           INTEGER NOT NULL,
      expected_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
      paid_amount     NUMERIC(20,2) NOT NULL DEFAULT 0,
      notes           TEXT,
      created_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS property_monthly_ledger_unique
       ON property_monthly_ledger (contract_id, year, month)`,
    `CREATE INDEX IF NOT EXISTS property_monthly_ledger_unit_idx
       ON property_monthly_ledger (unit_id)`,

    `CREATE TABLE IF NOT EXISTS property_payments (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER NOT NULL,
      module          TEXT NOT NULL DEFAULT 'PROPERTIES',
      contract_id     INTEGER NOT NULL,
      unit_id         INTEGER NOT NULL,
      ledger_row_id   INTEGER,
      cash_account_id INTEGER,
      voucher_id      INTEGER,
      amount          NUMERIC(20,2) NOT NULL,
      payment_date    DATE NOT NULL,
      for_year        INTEGER NOT NULL,
      for_month       INTEGER NOT NULL,
      notes           TEXT,
      created_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS property_payments_contract_idx
       ON property_payments (contract_id)`,
    `CREATE INDEX IF NOT EXISTS property_payments_company_idx
       ON property_payments (company_id, payment_date)`,

    // ── Production Planner tables (Apr 2026) ──────────────────────────────────
    `CREATE TABLE IF NOT EXISTS factory_production_plans (
      id           SERIAL PRIMARY KEY,
      company_id   INTEGER NOT NULL,
      plan_date    DATE NOT NULL,
      category_ids TEXT NOT NULL DEFAULT '[]',
      notes        TEXT,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, plan_date)
    )`,
    `CREATE TABLE IF NOT EXISTS factory_production_plan_entries (
      id           SERIAL PRIMARY KEY,
      plan_id      INTEGER NOT NULL,
      worker_id    INTEGER NOT NULL,
      role         TEXT NOT NULL DEFAULT 'WORKER',
      target_bales INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )`,

    // ── Tables missing from prior migrations (added Apr 2026) ─────────────────

    // Offload additional charges (broker/extra costs logged at offload time)
    `CREATE TABLE IF NOT EXISTS factory_offload_additional_charges (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER NOT NULL,
      container_id     INTEGER NOT NULL,
      description      TEXT NOT NULL,
      amount           NUMERIC(20,2) NOT NULL,
      currency_code    TEXT DEFAULT 'USD',
      fx_rate_to_usd   NUMERIC(20,6) DEFAULT 1,
      ledger_account_id INTEGER,
      supplier_id      INTEGER,
      created_at       TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS factory_offload_addl_charges_container_idx
       ON factory_offload_additional_charges (container_id)`,

    // FX allocations — links fx transfers to specific containers
    `CREATE TABLE IF NOT EXISTS factory_fx_allocations (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER NOT NULL,
      fx_transfer_id   INTEGER NOT NULL,
      container_id     INTEGER NOT NULL,
      source_type      VARCHAR(20) NOT NULL DEFAULT 'supplier',
      allocated_amount NUMERIC(20,4) NOT NULL,
      currency_code    VARCHAR(10) NOT NULL,
      created_at       TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS factory_fx_alloc_transfer_idx ON factory_fx_allocations (fx_transfer_id)`,
    `CREATE INDEX IF NOT EXISTS factory_fx_alloc_container_idx ON factory_fx_allocations (container_id)`,
    `CREATE INDEX IF NOT EXISTS factory_fx_alloc_company_idx ON factory_fx_allocations (company_id)`,

    // Duty audit log — change history for container duty amounts/status
    `CREATE TABLE IF NOT EXISTS factory_duty_audit_log (
      id                  SERIAL PRIMARY KEY,
      company_id          INTEGER NOT NULL,
      container_id        INTEGER NOT NULL,
      old_duty_amount     NUMERIC(20,2),
      new_duty_amount     NUMERIC(20,2) NOT NULL,
      old_duty_status     TEXT,
      new_duty_status     TEXT NOT NULL,
      notes               TEXT,
      updated_by_user_id  TEXT NOT NULL,
      created_at          TIMESTAMP NOT NULL DEFAULT NOW()
    )`,

    // POS Shifts — open/close shift records per location/user
    `CREATE TABLE IF NOT EXISTS pos_shifts (
      id             SERIAL PRIMARY KEY,
      company_id     INTEGER NOT NULL,
      location_id    INTEGER NOT NULL,
      user_id        VARCHAR NOT NULL,
      username       TEXT NOT NULL,
      cash_account_id INTEGER,
      pos_station    INTEGER,
      status         TEXT NOT NULL DEFAULT 'open',
      opened_at      TIMESTAMP NOT NULL DEFAULT NOW(),
      closed_at      TIMESTAMP,
      opening_cash   NUMERIC(20,2) NOT NULL DEFAULT 0,
      closing_cash   NUMERIC(20,2),
      expected_cash  NUMERIC(20,2),
      variance       NUMERIC(20,2),
      sales_count    INTEGER DEFAULT 0,
      sales_total    NUMERIC(20,2) DEFAULT 0,
      notes          TEXT,
      created_at     TIMESTAMP NOT NULL DEFAULT NOW()
    )`,

    // POS Offline Queue — holds unsynced sales from offline POS clients
    `CREATE TABLE IF NOT EXISTS pos_offline_queue (
      id            SERIAL PRIMARY KEY,
      client_id     VARCHAR(100) NOT NULL,
      company_id    INTEGER NOT NULL,
      location_id   INTEGER NOT NULL,
      user_id       VARCHAR NOT NULL,
      payload       JSONB NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      retries       INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
      processed_at  TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS pos_offline_queue_client_unique ON pos_offline_queue (client_id)`,

    // Dashboard account selections — saved cash/payable account groups per company
    `CREATE TABLE IF NOT EXISTS dashboard_account_selections (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER NOT NULL,
      selection_type  TEXT NOT NULL,
      account_ids     INTEGER[] NOT NULL DEFAULT '{}',
      created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS dashboard_account_selections_company_type_unique
       ON dashboard_account_selections (company_id, selection_type)`,

    // ERP user page access — per-company page permission grants
    `CREATE TABLE IF NOT EXISTS erp_user_page_access (
      id         SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      user_id    VARCHAR NOT NULL,
      page_key   TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS erp_user_page_access_unique
       ON erp_user_page_access (company_id, user_id, page_key)`,

    // ERP worker docs — employee document store (base64 file data)
    `CREATE TABLE IF NOT EXISTS erp_worker_docs (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      file_name   TEXT NOT NULL,
      file_type   TEXT NOT NULL,
      file_size   INTEGER NOT NULL,
      file_data   TEXT NOT NULL,
      description TEXT,
      uploaded_by TEXT,
      uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,

    // factory_worker_advances — voucher_id column (Drizzle migration 0101)
    `ALTER TABLE factory_worker_advances ADD COLUMN IF NOT EXISTS voucher_id INTEGER`,
    // factory_worker_documents — store file contents in DB so docs survive
    // server redeploys/restarts (Render and Replit both have ephemeral disks).
    `ALTER TABLE factory_worker_documents ADD COLUMN IF NOT EXISTS file_data text`,

    // ── Rental Auto-Transfer Config (Apr 2026) ────────────────────────────────
    `CREATE TABLE IF NOT EXISTS rental_auto_transfer_configs (
      id                    SERIAL PRIMARY KEY,
      company_id            INTEGER NOT NULL,
      module                TEXT NOT NULL,
      dest_company_id       INTEGER NOT NULL,
      dest_ledger_account_id INTEGER NOT NULL,
      enabled               BOOLEAN NOT NULL DEFAULT TRUE,
      created_at            TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    // Dropped unique index so multiple rules per company+module are supported
    `DROP INDEX IF EXISTS rental_auto_transfer_unique`,
    `ALTER TABLE rental_auto_transfer_configs ADD COLUMN IF NOT EXISTS source_cash_account_ids INTEGER[] NOT NULL DEFAULT '{}'`,
    // Ensure inter_company_transfers table exists (may not exist on fresh DBs where Drizzle push was never run)
    `CREATE TABLE IF NOT EXISTS inter_company_transfers (
      id                    SERIAL PRIMARY KEY,
      transfer_type         TEXT NOT NULL,
      from_company_id       INTEGER NOT NULL,
      to_company_id         INTEGER NOT NULL,
      transfer_date         DATE NOT NULL,
      amount                NUMERIC(15,2) NOT NULL,
      from_ledger_account_id INTEGER NOT NULL,
      to_ledger_account_id  INTEGER NOT NULL,
      from_voucher_id       INTEGER,
      to_voucher_id         INTEGER,
      description           TEXT,
      source_payment_id     INTEGER,
      created_at            TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    // Link auto-transfers back to their originating payment for cascade reversal (for older DBs)
    `ALTER TABLE inter_company_transfers ADD COLUMN IF NOT EXISTS source_payment_id INTEGER`,
    // Free-form note shown on statement PDF/Excel per customer
    `ALTER TABLE property_contracts ADD COLUMN IF NOT EXISTS statement_note TEXT`,
    // Free-form note shown on factory customer statement PDF/Excel
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS statement_note TEXT`,
    // Per-row note on each transaction in the customer balance/statement
    `ALTER TABLE customer_balances ADD COLUMN IF NOT EXISTS row_note TEXT`,
    // Payment terms (days) for factory customers — used for overdue reminders
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_terms_days integer`,
    // Destination field on incoming containers (where the goods are going/warehouse)
    `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS destination TEXT`,
    // ── Factory/ERP User Profile Tables (may not exist on older prod DBs) ─────
    `CREATE TABLE IF NOT EXISTS factory_user_profiles (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER NOT NULL,
      user_id          VARCHAR NOT NULL,
      display_name     TEXT NOT NULL,
      has_erp_access   BOOLEAN NOT NULL DEFAULT TRUE,
      has_factory_access BOOLEAN NOT NULL DEFAULT TRUE,
      hidden_cost_fields TEXT[] NOT NULL DEFAULT '{}',
      hide_all_costs   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS factory_user_profiles_unique ON factory_user_profiles (company_id, user_id)`,
    `CREATE TABLE IF NOT EXISTS factory_user_page_access (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL,
      user_id     VARCHAR NOT NULL,
      page_key    TEXT NOT NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS factory_user_page_access_unique ON factory_user_page_access (company_id, user_id, page_key)`,
    `CREATE TABLE IF NOT EXISTS erp_user_page_access (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL,
      user_id     VARCHAR NOT NULL,
      page_key    TEXT NOT NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS erp_user_page_access_unique ON erp_user_page_access (company_id, user_id, page_key)`,
    // hide_all_costs column added later — ensure it exists on older rows
    `ALTER TABLE factory_user_profiles ADD COLUMN IF NOT EXISTS hide_all_costs BOOLEAN NOT NULL DEFAULT FALSE`,
    // Team leader linking — helpers can be assigned to a team leader in a production plan
    `ALTER TABLE factory_production_plan_entries ADD COLUMN IF NOT EXISTS team_leader_worker_id INTEGER`,
    // Bale removal log — records every bale removed from a loading for audit/history
    `CREATE TABLE IF NOT EXISTS customer_order_bale_removals (
      id                   SERIAL PRIMARY KEY,
      order_id             INTEGER NOT NULL,
      bale_id              INTEGER NOT NULL,
      reference_number     VARCHAR(100) NOT NULL,
      article_code         VARCHAR(50),
      product_name         TEXT,
      weight_kg            DECIMAL(15,3),
      removed_by_user_id   VARCHAR,
      removed_by_username  VARCHAR,
      removed_at           TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS location_price_groups (
      id                  SERIAL PRIMARY KEY,
      company_id          INTEGER NOT NULL,
      master_location_id  INTEGER NOT NULL,
      follower_location_id INTEGER NOT NULL,
      created_at          TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS location_price_groups_unique ON location_price_groups (company_id, master_location_id, follower_location_id)`,
    // Worker count per plan entry — how many workers are grouped under this person
    `ALTER TABLE factory_production_plan_entries ADD COLUMN IF NOT EXISTS worker_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE property_contracts ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE`,

    // ── Factory 2.0 Stock Allocation — proforma reservation tracking (Apr 2026) ──
    // Add reserved_qty to proforma_stock_reservations so the table stores the
    // pre-computed "not yet loaded" quantity per proforma+article.
    // Maintained by syncProformaReservations() after every proforma/line/loading mutation.
    // NOTE: the UNIQUE(company_id, proforma_id, article_code) constraint was already created
    // inline in the CREATE TABLE statement above — no separate index needed.
    `ALTER TABLE proforma_stock_reservations ADD COLUMN IF NOT EXISTS reserved_qty INTEGER NOT NULL DEFAULT 0`,
    // Performance index for the per-company aggregation used in computeStockTruth
    `CREATE INDEX IF NOT EXISTS proforma_stock_reservations_company_article_idx
       ON proforma_stock_reservations (company_id, article_code)`,
    // Company-level timezone setting (Apr 2026)
    `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS timezone text`,

    // ── Tables added post-initial-deploy that may be missing on production ──
    `CREATE TABLE IF NOT EXISTS supplier_proformas (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      supplier_id integer NOT NULL,
      reference varchar(200) NOT NULL,
      notes text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS supplier_proforma_lines (
      id serial PRIMARY KEY,
      proforma_id integer NOT NULL,
      barcode varchar(200) NOT NULL,
      item_name text NOT NULL,
      qty integer NOT NULL DEFAULT 0,
      weight_per_bale decimal(15,3) DEFAULT 0,
      price_per_bale decimal(15,2) DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS supplier_container_loaded_items (
      id serial PRIMARY KEY,
      container_id integer NOT NULL,
      barcode varchar(200) NOT NULL,
      item_name text,
      qty integer NOT NULL DEFAULT 0,
      weight_per_bale decimal(15,3),
      price_per_bale decimal(15,2)
    )`,
    `CREATE TABLE IF NOT EXISTS bale_recode_sessions (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      performed_by varchar(255),
      uploaded_filename text,
      print_format text NOT NULL DEFAULT 'A4',
      design_color text,
      total_rows integer NOT NULL DEFAULT 0,
      valid_rows integer NOT NULL DEFAULT 0,
      invalid_rows integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS bale_recode_items (
      id serial PRIMARY KEY,
      session_id integer NOT NULL,
      old_reference_code text NOT NULL,
      new_reference_code text,
      product_name text,
      article_code text,
      weight_kg text,
      status text NOT NULL DEFAULT 'pending',
      error_message text,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS erp_worker_docs (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      employee_id integer NOT NULL,
      file_name text NOT NULL,
      file_type text NOT NULL,
      file_size integer NOT NULL,
      file_data text NOT NULL,
      description text,
      uploaded_by text,
      uploaded_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS erp_payroll_runs (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      status text NOT NULL DEFAULT 'DRAFT',
      date text NOT NULL,
      notes text,
      payment_account_id integer,
      paid_at text,
      created_at text NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS erp_payroll_run_items (
      id serial PRIMARY KEY,
      run_id integer NOT NULL,
      employee_id integer NOT NULL,
      employee_name text NOT NULL,
      group_name text,
      base_salary decimal(18,2) NOT NULL,
      deduction decimal(18,2) NOT NULL DEFAULT 0,
      net_pay decimal(18,2) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS factory_worker_categories (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      name varchar(200) NOT NULL,
      worker_ids jsonb NOT NULL DEFAULT '[]',
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS freight_accounts (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      account_id varchar(50) NOT NULL,
      account_type varchar(50) NOT NULL,
      account_name varchar(300) NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS freight_accounts_company_account_unique ON freight_accounts (company_id, account_id)`,
    `CREATE TABLE IF NOT EXISTS snapshot_pinned_accounts (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      card_key varchar(50) NOT NULL,
      account_id varchar(50) NOT NULL,
      account_type varchar(50) NOT NULL,
      account_name varchar(300) NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS snapshot_pinned_accounts_unique ON snapshot_pinned_accounts (company_id, card_key, account_id)`,
    `CREATE TABLE IF NOT EXISTS property_units (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      module text NOT NULL DEFAULT 'PROPERTIES',
      unit_type text NOT NULL,
      location_group text NOT NULL,
      unit_number text NOT NULL,
      size text,
      dimensions text,
      notes text,
      active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS property_units_company_module_unit_unique ON property_units (company_id, module, unit_number)`,
    `CREATE INDEX IF NOT EXISTS property_units_company_idx ON property_units (company_id, module, unit_type)`,
    `CREATE TABLE IF NOT EXISTS property_contracts (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      module text NOT NULL DEFAULT 'PROPERTIES',
      unit_id integer NOT NULL,
      tenant_name text NOT NULL,
      guarantee_period text,
      guarantee_amount decimal(20,2) NOT NULL DEFAULT 0,
      rental_amount decimal(20,2) NOT NULL DEFAULT 0,
      start_date date NOT NULL,
      end_date date,
      status text NOT NULL DEFAULT 'ACTIVE',
      notes text,
      statement_note text,
      guarantee_posted_to_statement boolean NOT NULL DEFAULT false,
      guarantee_posted_amount decimal(20,2) DEFAULT 0,
      is_internal boolean NOT NULL DEFAULT false,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS property_contracts_unit_idx ON property_contracts (unit_id, status)`,
    `CREATE INDEX IF NOT EXISTS property_contracts_company_idx ON property_contracts (company_id, status)`,
    `CREATE TABLE IF NOT EXISTS property_monthly_ledger (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      module text NOT NULL DEFAULT 'PROPERTIES',
      contract_id integer NOT NULL,
      unit_id integer NOT NULL,
      year integer NOT NULL,
      month integer NOT NULL,
      expected_amount decimal(20,2) NOT NULL DEFAULT 0,
      paid_amount decimal(20,2) NOT NULL DEFAULT 0,
      notes text,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS property_monthly_ledger_unique ON property_monthly_ledger (contract_id, year, month)`,
    `CREATE INDEX IF NOT EXISTS property_monthly_ledger_unit_idx ON property_monthly_ledger (unit_id)`,
    `CREATE TABLE IF NOT EXISTS property_payments (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      module text NOT NULL DEFAULT 'PROPERTIES',
      contract_id integer NOT NULL,
      unit_id integer NOT NULL,
      ledger_row_id integer,
      cash_account_id integer,
      voucher_id integer,
      amount decimal(20,2) NOT NULL,
      payment_date date NOT NULL,
      for_year integer NOT NULL,
      for_month integer NOT NULL,
      notes text,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS property_payments_contract_idx ON property_payments (contract_id)`,
    `CREATE INDEX IF NOT EXISTS property_payments_company_idx ON property_payments (company_id, payment_date)`,
    `CREATE TABLE IF NOT EXISTS rental_auto_transfer_configs (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      module text NOT NULL,
      dest_company_id integer NOT NULL,
      dest_ledger_account_id integer NOT NULL,
      source_cash_account_ids integer[] NOT NULL DEFAULT '{}',
      enabled boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS rental_auto_transfer_unique ON rental_auto_transfer_configs (company_id, module)`,
    `CREATE TABLE IF NOT EXISTS factory_transporters (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      name text NOT NULL,
      phone varchar(50),
      notes text,
      ledger_account_id integer,
      active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS factory_transporters_company_idx ON factory_transporters (company_id)`,
    `CREATE TABLE IF NOT EXISTS factory_transporter_transactions (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      transporter_id integer NOT NULL,
      tx_type text NOT NULL,
      amount decimal(20,4) NOT NULL,
      tx_date date NOT NULL,
      description text,
      expense_account_id integer,
      cash_account_id integer,
      voucher_id integer,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS factory_transporter_tx_idx ON factory_transporter_transactions (transporter_id)`,
    `CREATE INDEX IF NOT EXISTS factory_transporter_tx_company_idx ON factory_transporter_transactions (company_id)`,
    `CREATE TABLE IF NOT EXISTS customer_order_bale_removals (
      id serial PRIMARY KEY,
      order_id integer NOT NULL,
      bale_id integer NOT NULL,
      reference_number varchar(100) NOT NULL,
      article_code varchar(50),
      product_name text,
      weight_kg decimal(15,3),
      removed_by_user_id varchar,
      removed_by_username varchar,
      removed_at timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS location_price_groups (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      master_location_id integer NOT NULL,
      follower_location_id integer NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`,

    // ── Apr 2026 — Bale Import Batch tracking ─────────────────────────────────
    `CREATE TABLE IF NOT EXISTS factory_bale_import_batches (
      id                  SERIAL PRIMARY KEY,
      company_id          INTEGER NOT NULL,
      file_name           TEXT NOT NULL,
      bale_count          INTEGER NOT NULL DEFAULT 0,
      error_count         INTEGER NOT NULL DEFAULT 0,
      total_weight_kg     DECIMAL(15,3) NOT NULL DEFAULT 0,
      imported_by_user_id VARCHAR(100),
      imported_by_name    TEXT,
      notes               TEXT,
      created_at          TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `ALTER TABLE factory_bales ADD COLUMN IF NOT EXISTS import_batch_id INTEGER`,

    // Daily export run tracking
    `CREATE TABLE IF NOT EXISTS daily_export_runs (
      id                  serial PRIMARY KEY,
      run_type            text NOT NULL,
      started_at          timestamp NOT NULL DEFAULT now(),
      finished_at         timestamp,
      status              text NOT NULL DEFAULT 'running',
      zip_size_bytes      integer,
      companies_count     integer,
      company_files_count integer,
      skipped_companies   text,
      email_attempted     boolean DEFAULT false,
      email_success       boolean DEFAULT false,
      email_error         text,
      email_attempts      integer DEFAULT 0,
      whatsapp_attempted  boolean DEFAULT false,
      whatsapp_success    boolean DEFAULT false,
      whatsapp_error      text,
      whatsapp_attempts   integer DEFAULT 0,
      skipped_reason      text,
      details             jsonb,
      created_at          timestamp NOT NULL DEFAULT now()
    )`,

    // User navigation activity log (for admin Watch User feature)
    `CREATE TABLE IF NOT EXISTS user_activity_log (
      id          serial PRIMARY KEY,
      user_id     varchar NOT NULL,
      username    text NOT NULL,
      company_id  integer,
      company_name text,
      route       text NOT NULL,
      occurred_at timestamp NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_user_activity_log_user ON user_activity_log(user_id, occurred_at DESC)`,

    // ── Seed singleton config rows so the scheduler always finds them ─────────
    // export_settings (id=1): email credentials + schedule toggle
    `INSERT INTO export_settings (id, gmail_user, gmail_app_password, schedule_enabled)
     VALUES (1, '', '', false)
     ON CONFLICT (id) DO NOTHING`,

    // whatsapp_settings (id=1): Green API credentials + enable toggles
    `INSERT INTO whatsapp_settings (id, instance_id, api_token, enabled, monthly_auto_send, daily_auto_send)
     VALUES (1, '', '', false, false, false)
     ON CONFLICT (id) DO NOTHING`,

    // whatsapp_settings (id=2): POS-specific Green API instance (optional; enabled by default so fallback to id=1 works)
    `INSERT INTO whatsapp_settings (id, instance_id, api_token, enabled, monthly_auto_send, daily_auto_send)
     VALUES (2, '', '', true, false, false)
     ON CONFLICT (id) DO NOTHING`,

    // net_position_export_settings (id=1)
    `INSERT INTO net_position_export_settings (id, frequency, send_hour, enabled, auto_send)
     VALUES (1, 'daily', 18, false, false)
     ON CONFLICT (id) DO NOTHING`,

    // ── Stock Allocation v3.0 — isolated test tables (Apr 2026) ───────────────
    `CREATE TABLE IF NOT EXISTS factory_v3_loads (
      id                  SERIAL PRIMARY KEY,
      company_id          INTEGER NOT NULL,
      proforma_id         INTEGER NOT NULL,
      load_name           TEXT NOT NULL,
      expected_load_date  DATE NOT NULL,
      notes               TEXT,
      status              TEXT NOT NULL DEFAULT 'expected_to_load',
      created_by          INTEGER,
      created_by_name     TEXT,
      created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
      started_at          TIMESTAMP,
      finalized_at        TIMESTAMP,
      finalized_by        INTEGER,
      finalized_by_name   TEXT,
      cancelled_at        TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS factory_v3_loads_company_idx ON factory_v3_loads (company_id, status)`,
    `CREATE TABLE IF NOT EXISTS factory_v3_load_bales (
      id              SERIAL PRIMARY KEY,
      load_id         INTEGER NOT NULL REFERENCES factory_v3_loads(id) ON DELETE CASCADE,
      bale_id         INTEGER NOT NULL,
      bale_reference  VARCHAR(100) NOT NULL,
      article_code    VARCHAR(50),
      product_name    TEXT,
      weight_kg       DECIMAL(15,3) NOT NULL DEFAULT 0,
      phase           TEXT NOT NULL DEFAULT 'scanned',
      added_by        INTEGER,
      added_by_name   TEXT,
      added_at        TIMESTAMP NOT NULL DEFAULT NOW(),
      removed_by      INTEGER,
      removed_by_name TEXT,
      removed_at      TIMESTAMP,
      notes           TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS factory_v3_load_bales_load_idx ON factory_v3_load_bales (load_id)`,
    `CREATE INDEX IF NOT EXISTS factory_v3_load_bales_bale_idx  ON factory_v3_load_bales (bale_id)`,
    `CREATE TABLE IF NOT EXISTS file_folders (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      name text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS folder_id integer REFERENCES file_folders(id) ON DELETE SET NULL`,
    `ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS display_name text`,
    `ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS destination text`,
    `ALTER TABLE locations ADD COLUMN IF NOT EXISTS whatsapp_group_chat_id text`,
    `CREATE TABLE IF NOT EXISTS factory_invoice_loading_sessions (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER NOT NULL,
      invoice_id       INTEGER NOT NULL,
      customer_id      INTEGER NOT NULL,
      location_id      INTEGER,
      status           TEXT NOT NULL DEFAULT 'OPEN',
      truck_no         TEXT,
      driver_name      TEXT,
      notes            TEXT,
      created_by       VARCHAR(100),
      created_by_name  TEXT,
      started_at       TIMESTAMP NOT NULL DEFAULT now(),
      completed_at     TIMESTAMP,
      cancelled_at     TIMESTAMP,
      created_at       TIMESTAMP NOT NULL DEFAULT now(),
      updated_at       TIMESTAMP NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS factory_invoice_loading_sessions_invoice_idx ON factory_invoice_loading_sessions (invoice_id)`,
    `CREATE INDEX IF NOT EXISTS factory_invoice_loading_sessions_company_idx ON factory_invoice_loading_sessions (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_invoice_loading_sessions_status_idx  ON factory_invoice_loading_sessions (status)`,
    `CREATE TABLE IF NOT EXISTS factory_invoice_loading_bales (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER NOT NULL,
      session_id       INTEGER NOT NULL,
      invoice_id       INTEGER NOT NULL,
      bale_id          INTEGER NOT NULL,
      bale_reference   VARCHAR(100) NOT NULL,
      article_code     VARCHAR(50),
      product_name     TEXT,
      weight_kg        DECIMAL(15,3) NOT NULL DEFAULT 0,
      scanned_at       TIMESTAMP NOT NULL DEFAULT now(),
      scanned_by       VARCHAR(100),
      scanned_by_name  TEXT,
      created_at       TIMESTAMP NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS factory_invoice_loading_bales_session_idx ON factory_invoice_loading_bales (session_id)`,
    `CREATE INDEX IF NOT EXISTS factory_invoice_loading_bales_invoice_idx ON factory_invoice_loading_bales (invoice_id)`,
    `CREATE INDEX IF NOT EXISTS factory_invoice_loading_bales_bale_idx    ON factory_invoice_loading_bales (bale_id)`,
    `ALTER TABLE factory_invoice_loading_sessions ALTER COLUMN created_by TYPE VARCHAR(100) USING created_by::VARCHAR`,
    `ALTER TABLE factory_invoice_loading_bales    ALTER COLUMN scanned_by TYPE VARCHAR(100) USING scanned_by::VARCHAR`,
    // V5 Stock Allocation — per-container locked expected quantities (Phase B, Apr 2026)
    // One row per (order_id × article_code). Created on POST proforma-with-loading; backfilled on first GET.
    `CREATE TABLE IF NOT EXISTS customer_order_expected_lines (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER NOT NULL,
      order_id         INTEGER NOT NULL,
      proforma_id      INTEGER,
      proforma_line_id INTEGER,
      article_code     VARCHAR(50) NOT NULL,
      product_name     TEXT,
      expected_qty     INTEGER NOT NULL,
      created_at       TIMESTAMP NOT NULL DEFAULT now(),
      updated_at       TIMESTAMP NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS coel_order_idx   ON customer_order_expected_lines (order_id)`,
    `CREATE INDEX IF NOT EXISTS coel_company_idx ON customer_order_expected_lines (company_id)`,
    // Uniqueness constraint: one expected line per container × article_code.
    // Prevents duplicate rows if two concurrent GET requests both trigger the backfill.
    // ON CONFLICT DO NOTHING in the backfill INSERT is the paired application-level guard.
    `CREATE UNIQUE INDEX IF NOT EXISTS coel_order_article_unique ON customer_order_expected_lines (order_id, article_code)`,

    // ── Customer Logos — per-customer brand logos for bale label printing (May 2026) ──
    `CREATE TABLE IF NOT EXISTS customer_logos (
      id          serial PRIMARY KEY,
      company_id  integer NOT NULL,
      customer_id integer NOT NULL,
      name        varchar(100) NOT NULL,
      file_path   varchar(500) NOT NULL,
      mime_type   varchar(50) NOT NULL,
      active      boolean NOT NULL DEFAULT true,
      created_at  timestamp NOT NULL DEFAULT now(),
      updated_at  timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS customer_logos_company_customer_idx ON customer_logos (company_id, customer_id)`,
    `ALTER TABLE bale_label_prints ADD COLUMN IF NOT EXISTS customer_logo_id integer`,

    // ── F-Phase 1 (May 2026) — companyId indexes for multi-tenant tables (security/data-integrity audit) ──
    `CREATE INDEX IF NOT EXISTS exchange_rates_company_idx ON exchange_rates (company_id)`,
    `CREATE INDEX IF NOT EXISTS user_company_roles_company_idx ON user_company_roles (company_id)`,
    `CREATE INDEX IF NOT EXISTS user_locations_company_idx ON user_locations (company_id)`,
    `CREATE INDEX IF NOT EXISTS locations_company_idx ON locations (company_id)`,
    `CREATE INDEX IF NOT EXISTS employees_company_idx ON employees (company_id)`,
    `CREATE INDEX IF NOT EXISTS employee_groups_company_idx ON employee_groups (company_id)`,
    `CREATE INDEX IF NOT EXISTS bank_accounts_company_idx ON bank_accounts (company_id)`,
    `CREATE INDEX IF NOT EXISTS fixed_assets_company_idx ON fixed_assets (company_id)`,
    `CREATE INDEX IF NOT EXISTS containers_company_idx ON containers (company_id)`,
    `CREATE INDEX IF NOT EXISTS purchase_orders_company_idx ON purchase_orders (company_id)`,
    `CREATE INDEX IF NOT EXISTS inventory_company_idx ON inventory (company_id)`,
    `CREATE INDEX IF NOT EXISTS vouchers_company_idx ON vouchers (company_id)`,
    `CREATE INDEX IF NOT EXISTS employee_bale_rates_company_idx ON employee_bale_rates (company_id)`,
    `CREATE INDEX IF NOT EXISTS employee_bale_pct_rates_company_idx ON employee_bale_pct_rates (company_id)`,
    `CREATE INDEX IF NOT EXISTS salary_advances_company_idx ON salary_advances (company_id)`,
    `CREATE INDEX IF NOT EXISTS dashboard_cash_accounts_company_idx ON dashboard_cash_accounts (company_id)`,
    `CREATE INDEX IF NOT EXISTS dashboard_payable_accounts_company_idx ON dashboard_payable_accounts (company_id)`,
    `CREATE INDEX IF NOT EXISTS mix_batches_company_idx ON mix_batches (company_id)`,
    `CREATE INDEX IF NOT EXISTS pressing_batches_company_idx ON pressing_batches (company_id)`,
    `CREATE INDEX IF NOT EXISTS bale_transfers_company_idx ON bale_transfers (company_id)`,
    `CREATE INDEX IF NOT EXISTS customer_balances_company_idx ON customer_balances (company_id)`,
    `CREATE INDEX IF NOT EXISTS stock_group_location_archives_company_idx ON stock_group_location_archives (company_id)`,
    `CREATE INDEX IF NOT EXISTS pos_shifts_company_idx ON pos_shifts (company_id)`,
    `CREATE INDEX IF NOT EXISTS pos_offline_queue_company_idx ON pos_offline_queue (company_id)`,
    `CREATE INDEX IF NOT EXISTS customer_logos_company_idx ON customer_logos (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_containers_company_idx ON factory_containers (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_offload_additional_charges_company_idx ON factory_offload_additional_charges (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_container_other_charges_company_idx ON factory_container_other_charges (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_raw_material_adjustments_company_idx ON factory_raw_material_adjustments (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_supplier_payments_company_idx ON factory_supplier_payments (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_supplier_fx_transfers_company_idx ON factory_supplier_fx_transfers (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_mix_batches_company_idx ON factory_mix_batches (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_daily_usages_company_idx ON factory_daily_usages (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_pressing_batches_company_idx ON factory_pressing_batches (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_bale_import_batches_company_idx ON factory_bale_import_batches (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_duty_audit_log_company_idx ON factory_duty_audit_log (company_id)`,
    `CREATE INDEX IF NOT EXISTS customer_proformas_company_idx ON customer_proformas (company_id)`,
    `CREATE INDEX IF NOT EXISTS container_documents_company_idx ON container_documents (company_id)`,
    `CREATE INDEX IF NOT EXISTS container_freight_company_idx ON container_freight (company_id)`,
    `CREATE INDEX IF NOT EXISTS container_freight_payments_company_idx ON container_freight_payments (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_worker_documents_company_idx ON factory_worker_documents (company_id)`,
    `CREATE INDEX IF NOT EXISTS supplier_proformas_company_idx ON supplier_proformas (company_id)`,
    `CREATE INDEX IF NOT EXISTS file_folders_company_idx ON file_folders (company_id)`,
    `CREATE INDEX IF NOT EXISTS stored_files_company_idx ON stored_files (company_id)`,
    `CREATE INDEX IF NOT EXISTS spreadsheets_company_idx ON spreadsheets (company_id)`,
    `CREATE INDEX IF NOT EXISTS bale_recode_sessions_company_idx ON bale_recode_sessions (company_id)`,
    `CREATE INDEX IF NOT EXISTS live_spreadsheets_company_idx ON live_spreadsheets (company_id)`,
    `CREATE INDEX IF NOT EXISTS erp_worker_docs_company_idx ON erp_worker_docs (company_id)`,
    `CREATE INDEX IF NOT EXISTS erp_payroll_runs_company_idx ON erp_payroll_runs (company_id)`,
    `CREATE INDEX IF NOT EXISTS waste_dispatches_company_idx ON waste_dispatches (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_bale_waste_dispatches_company_idx ON factory_bale_waste_dispatches (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_pos_sales_company_idx ON factory_pos_sales (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_pos_sale_items_company_idx ON factory_pos_sale_items (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_worker_categories_company_idx ON factory_worker_categories (company_id)`,
    `CREATE INDEX IF NOT EXISTS property_monthly_ledger_company_idx ON property_monthly_ledger (company_id)`,
    `CREATE INDEX IF NOT EXISTS location_price_groups_company_idx ON location_price_groups (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_sheets_company_idx ON factory_sheets (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_v3_loads_company_idx ON factory_v3_loads (company_id)`,
    `CREATE INDEX IF NOT EXISTS factory_invoice_loading_bales_company_idx ON factory_invoice_loading_bales (company_id)`,

    // ── F-Phase 0 (May 2026) — Add missing PRIMARY KEY (id) constraints ──
    // Historical drift: ~143 tables in dev (and presumably prod) were created
    // with `id integer NOT NULL DEFAULT nextval(...)` but no PRIMARY KEY
    // constraint. PostgreSQL refuses ADD FOREIGN KEY against an unconstrained
    // column, blocking F-Phase 2/3 (FK constraints).
    //
    // Idempotent: loops over every public table with an `id` column but no
    // PRIMARY KEY and adds one. No-op on a clean DB.
    //
    // Failure-handling design (per code-review feedback):
    //   - Inner per-table EXCEPTION collects failures into an array instead of
    //     silently swallowing them, so the outer migration-runner's
    //     "Migration skipped: …" log line carries the actual cause.
    //   - Mandatory post-check at end: if ANY table still lacks a PK after
    //     the loop, RAISE EXCEPTION with the failed-table list. This bubbles
    //     up to the outer try/catch in runMigrations() (loud, visible signal
    //     in Render logs), instead of pretending success.
    //   - On a healthy boot the post-check sees 0 missing PKs and the block
    //     exits silently.
    `DO $f_phase0$
     DECLARE
       r record;
       failed text[] := ARRAY[]::text[];
       still_missing int;
     BEGIN
       FOR r IN
         SELECT t.table_name
         FROM information_schema.tables t
         WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
           AND EXISTS (
             SELECT 1 FROM information_schema.columns c
             WHERE c.table_schema = t.table_schema
               AND c.table_name = t.table_name
               AND c.column_name = 'id'
           )
           AND NOT EXISTS (
             SELECT 1 FROM information_schema.table_constraints tc
             WHERE tc.table_schema = t.table_schema
               AND tc.table_name = t.table_name
               AND tc.constraint_type = 'PRIMARY KEY'
           )
       LOOP
         BEGIN
           EXECUTE format('ALTER TABLE public.%I ADD PRIMARY KEY (id)', r.table_name);
         EXCEPTION WHEN others THEN
           failed := failed || (r.table_name || ': ' || SQLERRM);
         END;
       END LOOP;

       -- Mandatory post-check: re-count tables still missing a PK.
       SELECT count(*) INTO still_missing
       FROM information_schema.tables t
       WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
         AND EXISTS (
           SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema = t.table_schema
             AND c.table_name = t.table_name
             AND c.column_name = 'id'
         )
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.table_constraints tc
           WHERE tc.table_schema = t.table_schema
             AND tc.table_name = t.table_name
             AND tc.constraint_type = 'PRIMARY KEY'
         );

       IF still_missing > 0 THEN
         RAISE EXCEPTION 'F-Phase 0 INCOMPLETE: % tables still missing PRIMARY KEY. Failures: %',
           still_missing, COALESCE(array_to_string(failed, ' | '), '(none captured)');
       END IF;
     END
     $f_phase0$;`,

    // ── F-Phase 2 (May 2026) — 12 FOREIGN KEY constraints (data integrity) ──
    // All 12 verified orphan-clean in dev before applying. Each ALTER is
    // wrapped in its own DO block that swallows ONLY duplicate_object
    // (constraint already exists from a prior boot) — every other error
    // surfaces through the migration-runner's outer "Migration skipped: …"
    // log line. Order matters only insofar as parents must already have a
    // PRIMARY KEY, which F-Phase 0 above guarantees on this same boot.
    `DO $$ BEGIN ALTER TABLE voucher_entries ADD CONSTRAINT voucher_entries_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_orders ADD CONSTRAINT customer_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_order_lines ADD CONSTRAINT customer_order_lines_order_id_fkey FOREIGN KEY (order_id) REFERENCES customer_orders(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_order_charges ADD CONSTRAINT customer_order_charges_order_id_fkey FOREIGN KEY (order_id) REFERENCES customer_orders(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_order_bales ADD CONSTRAINT customer_order_bales_order_id_fkey FOREIGN KEY (order_id) REFERENCES customer_orders(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_proforma_lines ADD CONSTRAINT customer_proforma_lines_proforma_id_fkey FOREIGN KEY (proforma_id) REFERENCES customer_proformas(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE po_line_items ADD CONSTRAINT po_line_items_po_id_fkey FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE container_offload_items ADD CONSTRAINT container_offload_items_offload_id_fkey FOREIGN KEY (offload_id) REFERENCES container_offloads(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_bale_photos ADD CONSTRAINT factory_bale_photos_bale_id_fkey FOREIGN KEY (bale_id) REFERENCES factory_bales(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_bale_cost_snapshots ADD CONSTRAINT factory_bale_cost_snapshots_bale_id_fkey FOREIGN KEY (bale_id) REFERENCES factory_bales(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE bale_recode_items ADD CONSTRAINT bale_recode_items_session_id_fkey FOREIGN KEY (session_id) REFERENCES bale_recode_sessions(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE salary_advance_deductions ADD CONSTRAINT salary_advance_deductions_salary_advance_id_fkey FOREIGN KEY (salary_advance_id) REFERENCES salary_advances(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

    // ── F-Phase 3 (May 2026) — 12 more FOREIGN KEY constraints (data integrity) ──
    // Same pattern/safety as F-Phase 2: orphan-clean in dev, idempotent on re-run.
    // Note: employee_advance_repayments.advance_id ALSO appears in the inline
    // REFERENCES of its CREATE TABLE above (line ~632) — that inline clause
    // already includes ON DELETE CASCADE so a fresh DB and an existing DB
    // converge to the same FK. Existing DBs (where the inline REFERENCES never
    // ran or ran without ON DELETE) get the correct constraint via the ALTER below.
    `DO $$ BEGIN ALTER TABLE credit_note_items ADD CONSTRAINT credit_note_items_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE sales_items ADD CONSTRAINT sales_items_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_adjustment_vouchers ADD CONSTRAINT stock_adjustment_vouchers_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_order_bale_removals ADD CONSTRAINT customer_order_bale_removals_order_id_fkey FOREIGN KEY (order_id) REFERENCES customer_orders(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_order_expected_lines ADD CONSTRAINT customer_order_expected_lines_order_id_fkey FOREIGN KEY (order_id) REFERENCES customer_orders(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_balances ADD CONSTRAINT customer_balances_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_logos ADD CONSTRAINT customer_logos_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_proformas ADD CONSTRAINT customer_proformas_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_v3_load_bales ADD CONSTRAINT factory_v3_load_bales_bale_id_fkey FOREIGN KEY (bale_id) REFERENCES factory_bales(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_advance_repayments ADD CONSTRAINT employee_advance_repayments_advance_id_fkey FOREIGN KEY (advance_id) REFERENCES employee_advances(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_advance_repayments ADD CONSTRAINT factory_advance_repayments_advance_id_fkey FOREIGN KEY (advance_id) REFERENCES factory_worker_advances(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_adjustment_items ADD CONSTRAINT stock_adjustment_items_adjustment_id_fkey FOREIGN KEY (adjustment_id) REFERENCES stock_adjustment_vouchers(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

    // ── F-Phase 4a (May 2026) — stock_items children (12 of 14 — po_line_items + container_offload_items deferred due to orphans) ──
    // CASCADE for records intrinsic to the stock item (aliases, prices, drafts).
    // RESTRICT for line items / inventory / archive — these carry audit value and must outlive any accidental hard-delete of a stock item.
    `DO $$ BEGIN ALTER TABLE stock_item_code_aliases ADD CONSTRAINT stock_item_code_aliases_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_item_location_prices ADD CONSTRAINT stock_item_location_prices_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE draft_pos_sale_items ADD CONSTRAINT draft_pos_sale_items_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE credit_note_items ADD CONSTRAINT credit_note_items_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE inventory ADD CONSTRAINT inventory_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE inventory_negative_layers ADD CONSTRAINT inventory_negative_layers_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE sales_items ADD CONSTRAINT sales_items_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_adjustment_items ADD CONSTRAINT stock_adjustment_items_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_group_location_archive_items ADD CONSTRAINT stock_group_location_archive_items_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_transfer_items ADD CONSTRAINT stock_transfer_items_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_transfer_revision_items ADD CONSTRAINT stock_transfer_revision_items_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE waste_dispatch_items ADD CONSTRAINT waste_dispatch_items_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

    // ── F-Phase 4a CLOSURE — orphan-cleanup + 2 final FKs (po_line_items + container_offload_items) ──
    // Pre-cleanup: hard-delete orphan rows (point to deleted stock_items 1989/2003/2004/2261, etc).
    // Idempotent: after first run, FK below prevents new orphans, so DELETE is a no-op forever.
    // Acceptable to delete because the rows already reference dead parents — data was already broken.
    `DELETE FROM po_line_items WHERE stock_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stock_items p WHERE p.id = po_line_items.stock_item_id)`,
    `DELETE FROM container_offload_items WHERE stock_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stock_items p WHERE p.id = container_offload_items.stock_item_id)`,
    `DO $$ BEGIN ALTER TABLE po_line_items ADD CONSTRAINT po_line_items_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE container_offload_items ADD CONSTRAINT container_offload_items_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

    // ── F-Phase 4b (May 2026) — locations children, 21 of 27 applied (6 deferred due to large historical orphan set) ──
    // Defensive: bales.location_id column may be missing on some older deploys (DB-only schema drift). Add idempotently before FK.
    `ALTER TABLE bales ADD COLUMN IF NOT EXISTS location_id integer`,
    // CASCADE for ephemeral / per-location config that has no meaning without the parent location.
    // RESTRICT for everything historical / financial / inventory — admin must explicitly clean up before deleting a location.
    `DO $$ BEGIN ALTER TABLE bale_transfers ADD CONSTRAINT bale_transfers_destination_location_id_fkey FOREIGN KEY (destination_location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE bale_transfers ADD CONSTRAINT bale_transfers_source_location_id_fkey FOREIGN KEY (source_location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE bales ADD CONSTRAINT bales_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE credit_note_items ADD CONSTRAINT credit_note_items_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_order_bales ADD CONSTRAINT customer_order_bales_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_orders ADD CONSTRAINT customer_orders_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE draft_pos_sales ADD CONSTRAINT draft_pos_sales_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_bale_pct_rates ADD CONSTRAINT employee_bale_pct_rates_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_bale_rates ADD CONSTRAINT employee_bale_rates_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_invoice_loading_sessions ADD CONSTRAINT factory_invoice_loading_sessions_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_pos_sales ADD CONSTRAINT factory_pos_sales_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE inventory_negative_layers ADD CONSTRAINT inventory_negative_layers_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE pos_offline_queue ADD CONSTRAINT pos_offline_queue_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE pos_shifts ADD CONSTRAINT pos_shifts_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE production_bales ADD CONSTRAINT production_bales_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_group_location_archives ADD CONSTRAINT stock_group_location_archives_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_item_location_prices ADD CONSTRAINT stock_item_location_prices_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_transfer_revision_items ADD CONSTRAINT stock_transfer_revision_items_source_location_id_fkey FOREIGN KEY (source_location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE user_locations ADD CONSTRAINT user_locations_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE vouchers ADD CONSTRAINT vouchers_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE waste_dispatches ADD CONSTRAINT waste_dispatches_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    // ── F-Phase 4b DEFERRED (6 candidates with large historical orphan sets — needs prod-DB orphan check + cleanup decision before applying) ──
    // inventory.location_id (14460 dev orphans), stock_transfer_items.source_location_id (1250),
    // stock_transfer_vouchers.destination_location_id (145), stock_transfer_vouchers.source_location_id (145),
    // container_offloads.location_id (55), stock_adjustment_vouchers.location_id (53).
    // All point to deleted location IDs 1-103 in dev (current locations table has IDs 113-143).
    // Treatment requires investigating prod-DB state first — do NOT auto-delete production rows.

    // ── F-Phase 4c (May 2026) — containers children, 17 of 21 applied (4 deferred due to historical orphans) ──
    // CASCADE for per-container detail (charges/docs/freight/snapshots — meaningless without parent container).
    // RESTRICT for everything historical / financial / inventory / audit.
    `DO $$ BEGIN ALTER TABLE bales ADD CONSTRAINT bales_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE container_charges ADD CONSTRAINT container_charges_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE container_documents ADD CONSTRAINT container_documents_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE container_freight ADD CONSTRAINT container_freight_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    // container_freight_payments.container_id was missing from schema.ts (drift) — add defensively before FK so prod gets the column too
    `ALTER TABLE container_freight_payments ADD COLUMN IF NOT EXISTS container_id integer;`,
    `DO $$ BEGIN ALTER TABLE container_freight_payments ADD CONSTRAINT container_freight_payments_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE container_offloads ADD CONSTRAINT container_offloads_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE container_sales ADD CONSTRAINT container_sales_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_container_other_charges ADD CONSTRAINT factory_container_other_charges_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_container_profit_snapshots ADD CONSTRAINT factory_container_profit_snapshots_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_duty_audit_log ADD CONSTRAINT factory_duty_audit_log_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_mix_batch_sources ADD CONSTRAINT factory_mix_batch_sources_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_offload_additional_charges ADD CONSTRAINT factory_offload_additional_charges_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_waste_entries ADD CONSTRAINT factory_waste_entries_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE mix_batch_sources ADD CONSTRAINT mix_batch_sources_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE production_raw_stock ADD CONSTRAINT production_raw_stock_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE supplier_container_loaded_items ADD CONSTRAINT supplier_container_loaded_items_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    // ── F-Phase 4c DEFERRED (4 with historical orphans — financial/audit, need user decision) ──
    // import_logs (54 orphans, IDs 1-208, NULLABLE — could NULL out safely),
    // factory_fx_allocations (8 orphans, IDs 51-64, NOT NULL — financial, need cleanup decision),
    // factory_container_commissions (7 orphans, IDs 51-64, NOT NULL — financial, need cleanup decision),
    // factory_raw_stock (7 orphans, IDs 51-64, NULLABLE — could NULL out).

    // ── F-Phase 4d (May 2026) — suppliers children, 6 of 15 candidates applied ──
    // All 6 RESTRICT — suppliers should never be deleted casually (financial/historical impact).
    // The remaining 9 candidates are factory_* columns that point to factory_suppliers (separate parent table), NOT suppliers — handled in a separate batch.
    `DO $$ BEGIN ALTER TABLE containers ADD CONSTRAINT containers_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE container_freight ADD CONSTRAINT container_freight_vendor_supplier_id_fkey FOREIGN KEY (vendor_supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE supplier_containers ADD CONSTRAINT supplier_containers_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE supplier_proformas ADD CONSTRAINT supplier_proformas_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE voucher_entries ADD CONSTRAINT voucher_entries_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

    // ── F-Phase 4e (May 2026) — factory_suppliers children, 9 of 10 candidates applied ──
    // factory_suppliers is a SEPARATE parent table from suppliers (factory subsystem). 7 rows in dev (IDs 26-32).
    // All 9 RESTRICT — financial / commission / production audit trail; supplier rows must not be casually deleted.
    // DEFERRED: voucher_entries.factory_supplier_id has 2 orphan rows (voucher_id 4468/4469, factory_supplier_id=10, NASSRA payments) — needs user decision: NULL them out (preserves accounting balance) or delete entire entries (would unbalance vouchers).
    `DO $$ BEGIN ALTER TABLE factory_containers ADD CONSTRAINT factory_containers_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES factory_suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_containers ADD CONSTRAINT factory_containers_commission_supplier_id_fkey FOREIGN KEY (commission_supplier_id) REFERENCES factory_suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_mix_batch_sources ADD CONSTRAINT factory_mix_batch_sources_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES factory_suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_offload_additional_charges ADD CONSTRAINT factory_offload_additional_charges_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES factory_suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_raw_material_adjustments ADD CONSTRAINT factory_raw_material_adjustments_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES factory_suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_raw_stock ADD CONSTRAINT factory_raw_stock_commission_supplier_id_fkey FOREIGN KEY (commission_supplier_id) REFERENCES factory_suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_supplier_payments ADD CONSTRAINT factory_supplier_payments_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES factory_suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_supplier_score_snapshots ADD CONSTRAINT factory_supplier_score_snapshots_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES factory_suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_waste_entries ADD CONSTRAINT factory_waste_entries_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES factory_suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

    // ── F-Phase 4f (May 2026) — voucher_entries.factory_supplier_id ──
    // Defensive SWEEP cleanup: NULL any factory_supplier_id that doesn't exist in factory_suppliers.
    // In dev this matched 2 NASSRA payment rows (ids 15999, 16001, voucher_ids 4468/4469, factory_supplier_id=10, dated 2026-03-10).
    // In prod this guarantees the FK ALTER below succeeds even if prod has different/additional orphan refs.
    // NULL preserves voucher accounting balance (debit/credit untouched); only the dangling pointer is severed.
    // The sweep is idempotent — once enforced by the FK, no rows will ever match the WHERE again.
    `UPDATE voucher_entries SET factory_supplier_id = NULL WHERE factory_supplier_id IS NOT NULL AND factory_supplier_id NOT IN (SELECT id FROM factory_suppliers);`,
    `DO $$ BEGIN ALTER TABLE voucher_entries ADD CONSTRAINT voucher_entries_factory_supplier_id_fkey FOREIGN KEY (factory_supplier_id) REFERENCES factory_suppliers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

    // ── F-Phase 4g (May 2026) — cash_account_id columns → ledger_accounts ──
    // No `cash_accounts` table exists; these 12 dangling cash_account_id (and 1 paid_from_account_id) columns all really point to ledger_accounts (444 rows).
    // Confirmed in dev: schema.ts comment on property_payments.cash_account_id says "FK to ledgerAccounts (the cash box used)" and 100% of non-null values (49 rows: 35 in factory_worker_advances + 14 in user_company_roles) match ledger_accounts ids; 0 orphans across all 12 columns.
    // RESTRICT on all — these are accounting/audit trail (advances, payrolls, POS sales, supplier payments, transporter txs, property payments, role assignments). Deleting a referenced cash-box ledger account would orphan financial history.
    // Excluded: rental_auto_transfer_configs.source_cash_account_ids (integer[] array column — Postgres can't FK an array directly; will be handled separately if needed).
    `DO $$ BEGIN ALTER TABLE employee_advance_repayments ADD CONSTRAINT employee_advance_repayments_cash_account_id_fkey FOREIGN KEY (cash_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_advances ADD CONSTRAINT employee_advances_cash_account_id_fkey FOREIGN KEY (cash_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_advance_repayments ADD CONSTRAINT factory_advance_repayments_cash_account_id_fkey FOREIGN KEY (cash_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_payrolls ADD CONSTRAINT factory_payrolls_cash_account_id_fkey FOREIGN KEY (cash_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_pos_sales ADD CONSTRAINT factory_pos_sales_cash_account_id_fkey FOREIGN KEY (cash_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_supplier_payments ADD CONSTRAINT factory_supplier_payments_paid_from_account_id_fkey FOREIGN KEY (paid_from_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_transporter_transactions ADD CONSTRAINT factory_transporter_transactions_cash_account_id_fkey FOREIGN KEY (cash_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_worker_advances ADD CONSTRAINT factory_worker_advances_cash_account_id_fkey FOREIGN KEY (cash_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE pos_shifts ADD CONSTRAINT pos_shifts_cash_account_id_fkey FOREIGN KEY (cash_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE property_payments ADD CONSTRAINT property_payments_cash_account_id_fkey FOREIGN KEY (cash_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE user_company_roles ADD CONSTRAINT user_company_roles_cash_account_id_fkey FOREIGN KEY (cash_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE worker_bonuses ADD CONSTRAINT worker_bonuses_cash_account_id_fkey FOREIGN KEY (cash_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

    // ── F-Phase 4h (May 2026) — employees parent FKs (10 clean + 1 sweep) ──
    // employees has 66 rows (ids 51–119); 10 of 11 children had 0 orphans.
    // voucher_entries.employee_id (nullable) had 32 orphan rows pointing at deleted employee ids 43–50 (all below current min). Defensive sweep NULLs them — preserves voucher accounting balance, only severs the dangling pointer.
    // RESTRICT on all — HR/payroll/audit history; deleting an employee with payroll/advances/bonuses/attendance must be blocked.
    `UPDATE voucher_entries SET employee_id = NULL WHERE employee_id IS NOT NULL AND employee_id NOT IN (SELECT id FROM employees);`,
    `DO $$ BEGIN ALTER TABLE employee_advance_repayments ADD CONSTRAINT employee_advance_repayments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_advances ADD CONSTRAINT employee_advances_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_attendance ADD CONSTRAINT employee_attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_bale_pct_rates ADD CONSTRAINT employee_bale_pct_rates_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_bale_rates ADD CONSTRAINT employee_bale_rates_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_bonuses ADD CONSTRAINT employee_bonuses_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_group_members ADD CONSTRAINT employee_group_members_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE erp_payroll_run_items ADD CONSTRAINT erp_payroll_run_items_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE erp_worker_docs ADD CONSTRAINT erp_worker_docs_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE salary_advances ADD CONSTRAINT salary_advances_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE voucher_entries ADD CONSTRAINT voucher_entries_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

    // ── F-Phase 4i (May 2026) — vouchers long-tail FKs (11 clean + 1 sweep) ──
    // vouchers has 3,787 rows (ids 28–5416); 12 of 13 candidate child columns clean. purchase_orders.voucher_id had 3 orphans (ids 56/57/104 → missing voucher_ids 67/68/120, all PO-36 from Nov 2025) — defensive sweep NULLs them.
    // DEFERRED: stock_transfer_vouchers.voucher_id has 17 orphan rows but the column is NOT NULL — can't sweep, would need user decision to DELETE the orphan stock_transfer_vouchers rows. Skipped this batch.
    // RESTRICT on all — vouchers are accounting source-of-truth (Receipt/Payment/Journal postings); a referenced voucher must not be deleted while child records still point at it.
    `UPDATE purchase_orders SET voucher_id = NULL WHERE voucher_id IS NOT NULL AND voucher_id NOT IN (SELECT id FROM vouchers);`,
    `DO $$ BEGIN ALTER TABLE container_sales ADD CONSTRAINT container_sales_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_order_charges ADD CONSTRAINT customer_order_charges_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_bonuses ADD CONSTRAINT employee_bonuses_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_transporter_transactions ADD CONSTRAINT factory_transporter_transactions_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_worker_advances ADD CONSTRAINT factory_worker_advances_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE inter_company_transfers ADD CONSTRAINT inter_company_transfers_from_voucher_id_fkey FOREIGN KEY (from_voucher_id) REFERENCES vouchers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE inter_company_transfers ADD CONSTRAINT inter_company_transfers_to_voucher_id_fkey FOREIGN KEY (to_voucher_id) REFERENCES vouchers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE inventory_negative_layers ADD CONSTRAINT inventory_negative_layers_source_voucher_id_fkey FOREIGN KEY (source_voucher_id) REFERENCES vouchers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE property_payments ADD CONSTRAINT property_payments_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE salary_advances ADD CONSTRAINT salary_advances_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE waste_dispatches ADD CONSTRAINT waste_dispatches_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

    // ── F-Phase 4k (May 2026) — stock_transfer_vouchers.voucher_id (1 FK, user-approved cascade-style cleanup) ──
    // 17 orphan stock_transfer_vouchers rows (Nov 1 – Dec 3 2025) had voucher_id pointing at deleted vouchers (3, 83-88, 134-137, 165, 240, 941, 942, 1046, 1047, 1088).
    // Column is NOT NULL so couldn't sweep-NULL — user explicitly approved DELETE.
    // All 17 had inventory_applied=false (never posted to stock), so deleting them and their child line items is non-destructive (no real inventory ever moved).
    // ORDER MATTERS: delete child line items FIRST (stock_transfer_items.transfer_id is a logical reference but no FK enforced yet — F-Phase 4l queued), THEN delete parents.
    // Idempotent: both DELETE filters return 0 rows after first run; ALTER guarded by EXCEPTION.
    // Note: this only cleans items whose parent is in the orphan-parent set. The broader stock_transfer_items orphan backlog (~953 pre-existing) is queued for F-Phase 4l alongside the FK on stock_transfer_items.transfer_id.
    `DELETE FROM stock_transfer_items WHERE transfer_id IN (SELECT id FROM stock_transfer_vouchers WHERE voucher_id NOT IN (SELECT id FROM vouchers));`,
    `DELETE FROM stock_transfer_vouchers WHERE voucher_id NOT IN (SELECT id FROM vouchers);`,
    `DO $$ BEGIN ALTER TABLE stock_transfer_vouchers ADD CONSTRAINT stock_transfer_vouchers_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

    // ── F-Phase 4j (May 2026) — customers long-tail FKs (5 clean, 0 orphans) ──
    // customers parent has 22 rows (ids 2–26); 4 children already had FKs (customer_balances, customer_logos, customer_orders, customer_proformas).
    // Remaining 5 unenforced columns surveyed — all ZERO orphans, no cleanup needed.
    // RESTRICT on all — customer-linked sales/POS/voucher entries are accounting/audit history; deleting a customer with bales/sales/POS history must be blocked.
    `DO $$ BEGIN ALTER TABLE bales ADD CONSTRAINT bales_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE container_sales ADD CONSTRAINT container_sales_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_invoice_loading_sessions ADD CONSTRAINT factory_invoice_loading_sessions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_pos_sales ADD CONSTRAINT factory_pos_sales_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE voucher_entries ADD CONSTRAINT voucher_entries_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

    // ── F-Phase 4l (May 2026) — stock_transfer_items.transfer_id (1 FK, NOT VALID — non-destructive future-only enforcement) ──
    // 953 pre-existing orphan rows ($659K total value, Nov 26 – Dec 31 2025, across 35 deleted parent transfers, ids 72–218).
    // We CANNOT determine retroactively whether each deleted parent had inventory_applied=true (real stock moved → these items are audit history) or false (pure metadata).
    // Per user safety mandate ("100% safe, no data loss"), we use NOT VALID: existing orphans preserved untouched, audit trail intact.
    // NOT VALID means: future inserts/updates ARE checked against the FK (no new orphans can be created), but existing rows are tolerated.
    // Could be promoted to fully-validated later via `ALTER TABLE ... VALIDATE CONSTRAINT ...` once a remediation plan exists, but that's a separate manual decision.
    // Idempotent: ALTER guarded by EXCEPTION duplicate_object.
    `DO $$ BEGIN ALTER TABLE stock_transfer_items ADD CONSTRAINT stock_transfer_items_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES stock_transfer_vouchers(id) ON DELETE RESTRICT NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

    // ── F-Phase 4c (May 2026) — containers long-tail FKs (4 children, ALL with orphans → NOT VALID, non-destructive) ──
    // Surveyed: factory_container_commissions (7/18 orphans), factory_fx_allocations (8/23), factory_raw_stock (7/19), import_logs (54/313).
    // All children have pre-existing orphans pointing to deleted container ids. Per user safety mandate ("100% safe, no data loss"),
    // we use NOT VALID for all 4 — existing orphans preserved, future inserts/updates blocked from creating new orphans.
    // RESTRICT on all — containers tie to physical shipments with downstream cost/profit records that must be retained.
    // Idempotent: ALTER guarded by EXCEPTION duplicate_object.
    `DO $$ BEGIN ALTER TABLE factory_container_commissions ADD CONSTRAINT factory_container_commissions_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE RESTRICT NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_fx_allocations ADD CONSTRAINT factory_fx_allocations_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE RESTRICT NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_raw_stock ADD CONSTRAINT factory_raw_stock_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE RESTRICT NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE import_logs ADD CONSTRAINT import_logs_container_id_fkey FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE RESTRICT NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

    // ── F-Phase 4b (May 2026) — locations long-tail FKs (14 children: 8 clean + 6 NOT VALID, non-destructive) ──
    // Survey results — orphans/non_null:
    //   CLEAN (0 orphans, fully validated FK): bales.erp_location_id (0/0), employees.sales_bonus_pct_location_id (0/1),
    //     factory_bales.erp_location_id (0/3642), factory_pressing_batches.finalized_location_id (0/0),
    //     location_price_groups.master_location_id (0/0), location_price_groups.follower_location_id (0/0),
    //     pressing_batches.finalized_location_id (0/0), user_company_roles.assigned_location_id (0/14).
    //   ORPHANS (NOT VALID, future-only enforcement):
    //     container_offloads.location_id (55/165), inventory.location_id (14460/17961),
    //     stock_adjustment_vouchers.location_id (53/109), stock_transfer_items.source_location_id (1239/3610),
    //     stock_transfer_vouchers.destination_location_id (128/316), stock_transfer_vouchers.source_location_id (128/314).
    // RESTRICT on all — locations tie to inventory positions, sales records, transfers; deletion must be blocked.
    // Idempotent: ALTER guarded by EXCEPTION duplicate_object. NOT VALID preserves existing orphans.
    `DO $$ BEGIN ALTER TABLE bales ADD CONSTRAINT bales_erp_location_id_fkey FOREIGN KEY (erp_location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE employees ADD CONSTRAINT employees_sales_bonus_pct_location_id_fkey FOREIGN KEY (sales_bonus_pct_location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_bales ADD CONSTRAINT factory_bales_erp_location_id_fkey FOREIGN KEY (erp_location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_pressing_batches ADD CONSTRAINT factory_pressing_batches_finalized_location_id_fkey FOREIGN KEY (finalized_location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE location_price_groups ADD CONSTRAINT location_price_groups_master_location_id_fkey FOREIGN KEY (master_location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE location_price_groups ADD CONSTRAINT location_price_groups_follower_location_id_fkey FOREIGN KEY (follower_location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE pressing_batches ADD CONSTRAINT pressing_batches_finalized_location_id_fkey FOREIGN KEY (finalized_location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE user_company_roles ADD CONSTRAINT user_company_roles_assigned_location_id_fkey FOREIGN KEY (assigned_location_id) REFERENCES locations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE container_offloads ADD CONSTRAINT container_offloads_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE inventory ADD CONSTRAINT inventory_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_adjustment_vouchers ADD CONSTRAINT stock_adjustment_vouchers_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_transfer_items ADD CONSTRAINT stock_transfer_items_source_location_id_fkey FOREIGN KEY (source_location_id) REFERENCES locations(id) ON DELETE RESTRICT NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_transfer_vouchers ADD CONSTRAINT stock_transfer_vouchers_destination_location_id_fkey FOREIGN KEY (destination_location_id) REFERENCES locations(id) ON DELETE RESTRICT NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_transfer_vouchers ADD CONSTRAINT stock_transfer_vouchers_source_location_id_fkey FOREIGN KEY (source_location_id) REFERENCES locations(id) ON DELETE RESTRICT NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,

      // ── F-Phase 5 (May 2026) — companies long-tail FKs (137 children: 136 clean + 1 NOT VALID, the "final boss" batch) ──
      // Survey: ALL 137 unenforced company_id children scanned. Surprisingly clean — only ONE child has orphans:
      //   chat_messages (16/141 orphans → NOT VALID).
      // Other 136 children all have ZERO orphans → fully validated FK.
      // RESTRICT on all — companies are tenant roots; deletion must be blocked while ANY child exists.
      // Schema.ts: NOT updated for any of these 137 tables — would create massive churn. Per project convention (replit.md),
      //   schema.ts is "authoritative for clean rebuilds" but the migrations array in server/index.ts is the runtime authority.
      //   Drizzle-kit push is blocked anyway, so schema.ts/DB drift on company_id is intentional and documented.
      //   This is the same pattern used for bales.erp_location_id in F-Phase 4b.
      // Idempotent: ALTER guarded by EXCEPTION duplicate_object. NOT VALID preserves chat_messages orphans.
      `DO $$ BEGIN ALTER TABLE agent_accounts ADD CONSTRAINT agent_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE audit_log ADD CONSTRAINT audit_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE bale_label_prints ADD CONSTRAINT bale_label_prints_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE bale_product_categories ADD CONSTRAINT bale_product_categories_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE bale_products ADD CONSTRAINT bale_products_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE bale_recode_sessions ADD CONSTRAINT bale_recode_sessions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE bale_sequences ADD CONSTRAINT bale_sequences_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE bale_transfers ADD CONSTRAINT bale_transfers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE bales ADD CONSTRAINT bales_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE company_settings ADD CONSTRAINT company_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE container_document_types ADD CONSTRAINT container_document_types_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE container_documents ADD CONSTRAINT container_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE container_freight ADD CONSTRAINT container_freight_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE container_freight_payments ADD CONSTRAINT container_freight_payments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE container_sales ADD CONSTRAINT container_sales_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE containers ADD CONSTRAINT containers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_balances ADD CONSTRAINT customer_balances_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_invoice_sequences ADD CONSTRAINT customer_invoice_sequences_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_logos ADD CONSTRAINT customer_logos_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_order_expected_lines ADD CONSTRAINT customer_order_expected_lines_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_orders ADD CONSTRAINT customer_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE customer_proformas ADD CONSTRAINT customer_proformas_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE customers ADD CONSTRAINT customers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE dashboard_account_selections ADD CONSTRAINT dashboard_account_selections_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE dashboard_cash_accounts ADD CONSTRAINT dashboard_cash_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE dashboard_payable_accounts ADD CONSTRAINT dashboard_payable_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_advance_repayments ADD CONSTRAINT employee_advance_repayments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_advances ADD CONSTRAINT employee_advances_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_attendance ADD CONSTRAINT employee_attendance_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_bale_pct_rates ADD CONSTRAINT employee_bale_pct_rates_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_bale_rates ADD CONSTRAINT employee_bale_rates_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_bonuses ADD CONSTRAINT employee_bonuses_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE employee_groups ADD CONSTRAINT employee_groups_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE employees ADD CONSTRAINT employees_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE erp_payroll_runs ADD CONSTRAINT erp_payroll_runs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE erp_user_page_access ADD CONSTRAINT erp_user_page_access_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE erp_worker_docs ADD CONSTRAINT erp_worker_docs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_account_whatsapp_rules ADD CONSTRAINT factory_account_whatsapp_rules_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_advance_repayments ADD CONSTRAINT factory_advance_repayments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_alerts ADD CONSTRAINT factory_alerts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_attendance ADD CONSTRAINT factory_attendance_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_bale_cost_snapshots ADD CONSTRAINT factory_bale_cost_snapshots_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_bale_import_batches ADD CONSTRAINT factory_bale_import_batches_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_bale_photos ADD CONSTRAINT factory_bale_photos_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_bale_product_images ADD CONSTRAINT factory_bale_product_images_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_bale_products ADD CONSTRAINT factory_bale_products_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_bale_sequences ADD CONSTRAINT factory_bale_sequences_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_bale_waste_dispatches ADD CONSTRAINT factory_bale_waste_dispatches_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_bales ADD CONSTRAINT factory_bales_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_categories ADD CONSTRAINT factory_categories_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_container_commissions ADD CONSTRAINT factory_container_commissions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_container_other_charges ADD CONSTRAINT factory_container_other_charges_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_container_profit_snapshots ADD CONSTRAINT factory_container_profit_snapshots_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_containers ADD CONSTRAINT factory_containers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_daily_kpi_snapshots ADD CONSTRAINT factory_daily_kpi_snapshots_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_daily_usages ADD CONSTRAINT factory_daily_usages_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_daybook_entries ADD CONSTRAINT factory_daybook_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_duty_audit_log ADD CONSTRAINT factory_duty_audit_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_fx_allocations ADD CONSTRAINT factory_fx_allocations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_fx_rates ADD CONSTRAINT factory_fx_rates_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_invoice_loading_bales ADD CONSTRAINT factory_invoice_loading_bales_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_invoice_loading_sessions ADD CONSTRAINT factory_invoice_loading_sessions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_mix_batches ADD CONSTRAINT factory_mix_batches_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_offload_additional_charges ADD CONSTRAINT factory_offload_additional_charges_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_payrolls ADD CONSTRAINT factory_payrolls_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_pos_sale_items ADD CONSTRAINT factory_pos_sale_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_pos_sales ADD CONSTRAINT factory_pos_sales_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_pressing_batches ADD CONSTRAINT factory_pressing_batches_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_production_plans ADD CONSTRAINT factory_production_plans_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_production_sessions ADD CONSTRAINT factory_production_sessions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_raw_material_adjustments ADD CONSTRAINT factory_raw_material_adjustments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_raw_stock ADD CONSTRAINT factory_raw_stock_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_settings ADD CONSTRAINT factory_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_sheets ADD CONSTRAINT factory_sheets_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_supplier_categories ADD CONSTRAINT factory_supplier_categories_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_supplier_fx_transfers ADD CONSTRAINT factory_supplier_fx_transfers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_supplier_payments ADD CONSTRAINT factory_supplier_payments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_supplier_score_snapshots ADD CONSTRAINT factory_supplier_score_snapshots_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_suppliers ADD CONSTRAINT factory_suppliers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_transporter_transactions ADD CONSTRAINT factory_transporter_transactions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_transporters ADD CONSTRAINT factory_transporters_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_user_page_access ADD CONSTRAINT factory_user_page_access_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_user_profiles ADD CONSTRAINT factory_user_profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_v3_loads ADD CONSTRAINT factory_v3_loads_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_waste_entries ADD CONSTRAINT factory_waste_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_worker_advances ADD CONSTRAINT factory_worker_advances_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_worker_categories ADD CONSTRAINT factory_worker_categories_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_worker_documents ADD CONSTRAINT factory_worker_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE factory_workers ADD CONSTRAINT factory_workers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE file_folders ADD CONSTRAINT file_folders_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE fiscal_period_closures ADD CONSTRAINT fiscal_period_closures_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE fixed_assets ADD CONSTRAINT fixed_assets_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE freight_accounts ADD CONSTRAINT freight_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE inventory ADD CONSTRAINT inventory_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE inventory_negative_layers ADD CONSTRAINT inventory_negative_layers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE live_spreadsheets ADD CONSTRAINT live_spreadsheets_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE location_price_groups ADD CONSTRAINT location_price_groups_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE locations ADD CONSTRAINT locations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE login_history ADD CONSTRAINT login_history_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE mix_batches ADD CONSTRAINT mix_batches_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE pending_barcodes ADD CONSTRAINT pending_barcodes_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE pos_offline_queue ADD CONSTRAINT pos_offline_queue_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE pos_shifts ADD CONSTRAINT pos_shifts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE pressing_batches ADD CONSTRAINT pressing_batches_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE production_bales ADD CONSTRAINT production_bales_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE production_raw_stock ADD CONSTRAINT production_raw_stock_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE proforma_stock_reservations ADD CONSTRAINT proforma_stock_reservations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE property_contracts ADD CONSTRAINT property_contracts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE property_monthly_ledger ADD CONSTRAINT property_monthly_ledger_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE property_payments ADD CONSTRAINT property_payments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE property_units ADD CONSTRAINT property_units_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE reference_sequences ADD CONSTRAINT reference_sequences_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE rental_auto_transfer_configs ADD CONSTRAINT rental_auto_transfer_configs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE role_feature_permissions ADD CONSTRAINT role_feature_permissions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE salary_advances ADD CONSTRAINT salary_advances_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE snapshot_pinned_accounts ADD CONSTRAINT snapshot_pinned_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE spreadsheets ADD CONSTRAINT spreadsheets_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_group_location_archives ADD CONSTRAINT stock_group_location_archives_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_groups ADD CONSTRAINT stock_groups_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_item_code_aliases ADD CONSTRAINT stock_item_code_aliases_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE stock_items ADD CONSTRAINT stock_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE stored_files ADD CONSTRAINT stored_files_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE supplier_proformas ADD CONSTRAINT supplier_proformas_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE user_activity_log ADD CONSTRAINT user_activity_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE user_company_roles ADD CONSTRAINT user_company_roles_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE user_locations ADD CONSTRAINT user_locations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE user_presence ADD CONSTRAINT user_presence_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE vouchers ADD CONSTRAINT vouchers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE waste_dispatches ADD CONSTRAINT waste_dispatches_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE whatsapp_recipients ADD CONSTRAINT whatsapp_recipients_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE whatsapp_stock_settings ADD CONSTRAINT whatsapp_stock_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
    `DO $$ BEGIN ALTER TABLE worker_bonuses ADD CONSTRAINT worker_bonuses_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,
      `DO $$ BEGIN ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL;  END $$;`,

      // ── NOT VALID promotion (Phases A, B, C — May 2026) ─────────────────────
      // After archiving 16,272 orphan rows in dev to _orphan_archive_* tables,
      // all 12 NOT VALID constraints were validated. These ALTER ... VALIDATE
      // statements are idempotent: once a constraint is validated, re-running
      // is a no-op. Only `undefined_object` (constraint name doesn't exist in
      // an older schema) is swallowed — `foreign_key_violation` (orphans still
      // present) intentionally propagates so production failures are loud and
      // forced to be remediated before deploy completes.
      `DO $$ BEGIN ALTER TABLE chat_messages VALIDATE CONSTRAINT chat_messages_company_id_fkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE container_offloads VALIDATE CONSTRAINT container_offloads_location_id_fkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE factory_container_commissions VALIDATE CONSTRAINT factory_container_commissions_container_id_fkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE factory_fx_allocations VALIDATE CONSTRAINT factory_fx_allocations_container_id_fkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE factory_raw_stock VALIDATE CONSTRAINT factory_raw_stock_container_id_fkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE import_logs VALIDATE CONSTRAINT import_logs_container_id_fkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE inventory VALIDATE CONSTRAINT inventory_location_id_fkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE stock_adjustment_vouchers VALIDATE CONSTRAINT stock_adjustment_vouchers_location_id_fkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE stock_transfer_items VALIDATE CONSTRAINT stock_transfer_items_source_location_id_fkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE stock_transfer_items VALIDATE CONSTRAINT stock_transfer_items_transfer_id_fkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE stock_transfer_vouchers VALIDATE CONSTRAINT stock_transfer_vouchers_destination_location_id_fkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE stock_transfer_vouchers VALIDATE CONSTRAINT stock_transfer_vouchers_source_location_id_fkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;`,

      // ── Phase 4+5 perf indexes (May 2026) — hot-path scoping ────────────────
      // 12 strategic indexes covering bale-pick, customer-order, voucher-entry,
      // and inventory hot paths surfaced by the Customer-Ledger Phase 9 / factory
      // override audit. All idempotent CREATE INDEX IF NOT EXISTS.
      `CREATE INDEX IF NOT EXISTS factory_bales_company_idx ON factory_bales(company_id)`,
      `CREATE INDEX IF NOT EXISTS factory_bales_status_idx ON factory_bales(status)`,
      `CREATE INDEX IF NOT EXISTS factory_bales_product_idx ON factory_bales(product_id)`,
      `CREATE INDEX IF NOT EXISTS factory_bales_company_status_idx ON factory_bales(company_id, status)`,
      `CREATE INDEX IF NOT EXISTS customer_orders_company_idx ON customer_orders(company_id)`,
      `CREATE INDEX IF NOT EXISTS customer_orders_customer_idx ON customer_orders(customer_id)`,
      `CREATE INDEX IF NOT EXISTS customer_orders_status_idx ON customer_orders(status)`,
      `CREATE INDEX IF NOT EXISTS customer_order_bales_order_idx ON customer_order_bales(order_id)`,
      `CREATE INDEX IF NOT EXISTS customer_order_bales_bale_idx ON customer_order_bales(bale_id)`,
      `CREATE INDEX IF NOT EXISTS voucher_entries_ledger_voucher_idx ON voucher_entries(ledger_account_id, voucher_id)`,
      `CREATE INDEX IF NOT EXISTS vouchers_company_date_idx ON vouchers(company_id, voucher_date)`,
      `CREATE INDEX IF NOT EXISTS inventory_location_idx ON inventory(location_id)`,

      // ── Tables flagged missing from runtime migrations by audit (May 2026) ────
      // These exist in shared/schema.ts but had no CREATE TABLE in this array,
      // so a fresh deploy on Render would fail. All idempotent.
      `CREATE TABLE IF NOT EXISTS bale_transfer_items (
        id serial PRIMARY KEY,
        transfer_id integer NOT NULL,
        production_bale_id integer NOT NULL,
        quantity integer NOT NULL DEFAULT 1,
        weight_kg numeric(15,3) NOT NULL,
        cost_per_kg numeric(20,2) NOT NULL,
        total_cost numeric(20,2) NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS factory_daybook_entry_edits (
        id serial PRIMARY KEY,
        daybook_entry_id integer NOT NULL,
        edited_at timestamp NOT NULL DEFAULT now(),
        edited_by varchar,
        before_json text,
        after_json text,
        reason text NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS daybook_edits_entry_idx ON factory_daybook_entry_edits(daybook_entry_id)`,
      `CREATE TABLE IF NOT EXISTS system_settings (
        id serial PRIMARY KEY,
        key varchar(100) NOT NULL UNIQUE,
        value text,
        updated_at timestamp NOT NULL DEFAULT now()
      )`,

      // ── Wave 1 soft-delete columns (Task #10) ──────────────────────────────
      // All idempotent: ADD COLUMN IF NOT EXISTS is safe to run repeatedly.
      `ALTER TABLE locations ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE ledger_accounts ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE stock_groups ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE stock_group_location_archives ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE factory_categories ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE factory_bale_products ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE factory_containers ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE factory_raw_stock ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE factory_raw_material_adjustments ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE factory_raw_material_adjustments ADD COLUMN IF NOT EXISTS reference varchar(200)`,
      `ALTER TABLE factory_mix_batches ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE factory_bales ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE customer_proformas ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
      `ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS deleted_at timestamp`,
    ];
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

  const server = await registerRoutes(app);
  setupWS(server);
  startScheduler();

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const isProduction = process.env.NODE_ENV === "production";
    
    if (status >= 500) {
      console.error("[Server Error]", isProduction ? err.message : err);
    }
    
    const message = isProduction && status >= 500
      ? "An unexpected error occurred. Please try again."
      : (err.message || "Internal Server Error");

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
      throw new Error(
        `Could not find the build directory: ${distPath}, make sure to build the client first`,
      );
    }

    // Serve static assets with cache control
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          // Never cache index.html to prevent suppress stale bundles
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        } else {
          // Allow long-term caching for hashed assets
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }));

    // Return 404 for /assets/* that express.static didn't find.
    // This prevents the SPA index.html fallback from being served as JavaScript,
    // which would corrupt the service worker cache and cause MIME type errors in Safari.
    app.use("/assets", (_req, res) => {
      res.status(404).end();
    });

    // Fallback to index.html with no-cache headers (SPA routing)
    app.use("*", (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.resolve(distPath, "index.html"));
    });
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);

  const runMigrations = async () => {
    // Use a dedicated single Client for migrations — completely separate from the
    // shared connection pool so migrations never starve user requests of connections.
    const connectionString = process.env.DATABASE_URL ||
      `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;
    const isLocalReplitDB = process.env.PGHOST === "helium" || connectionString.includes("@helium:");
    const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
    const requiresSSL = !isLocalReplitDB && !sslExplicitlyDisabled;

    const migrationClient = new Client({
      connectionString,
      ssl: requiresSSL ? { rejectUnauthorized: false } : false,
    });

    try {
      await migrationClient.connect();
      for (const migration of migrations) {
        try {
          await migrationClient.query(migration);
        } catch (err: any) {
          console.warn(`Migration skipped: ${err.message?.split('\n')[0]}`);
        }
      }
      console.log("✓ Database tables and columns verified/migrated");

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
      } catch { /* table may not exist yet — skip */ }

      // Ensure customer invoice sequences start at 11827 (or higher if already advanced)
      try {
        await migrationClient.query(`
          UPDATE customer_invoice_sequences
          SET next_number = 11827
          WHERE next_number < 11827
        `);
      } catch { /* skip if table not ready */ }

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
      } catch { /* skip if tables not ready */ }

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
        } catch { /* table may not exist yet on first run — skip */ }
      }
    } catch (err: any) {
      console.error("Migration connection error:", err.message);
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
        console.log(`✓ DB connection pool warmed up (attempt ${attempt})`);
        return;
      } catch (err: any) {
        console.warn(`⚠️  DB warmup attempt ${attempt} failed: ${err.message}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 3000));
      }
    }
    console.error("✗ DB warmup failed after 3 attempts — queries will connect lazily");
  };

  const doListen = () => {
    server.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
      log(`serving on port ${port}`);
      // Warm up the pool first, then run schema migrations.
      warmupDb().then(() =>
        runMigrations().catch((err) => {
          console.error("Migration error:", err);
          migrationsDone = true;
        })
      ).then(() => {
        // ── Clean up orphaned export runs ──────────────────────────────────────
        // In-memory export jobs are lost on server restart.  Any run that has
        // been 'running' for >5 minutes is almost certainly stuck — mark it failed.
        const cleanupStuckRuns = async () => {
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
              console.log(`[ExportRun] Cleaned up ${r.rowCount} stuck run(s):`,
                r.rows.map((x: any) => `#${x.id} ${x.run_type}`).join(", "));
            }
          } catch (e: any) {
            console.warn("[ExportRun] Stuck-run cleanup failed:", e.message);
          }
        };
        // Run once at startup (slight delay so pool is fully ready)
        setTimeout(cleanupStuckRuns, 3000);
        // Then check every 10 minutes to catch anything that stalls during a run
        setInterval(cleanupStuckRuns, 10 * 60 * 1000);
      });
    });
  };

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`Port ${port} in use — killing zombie process and retrying...`);
      try {
        const { execSync } = require("child_process");
        execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
      } catch {}
      setTimeout(() => {
        server.removeAllListeners("error");
        server.on("error", (e: any) => { console.error("Server error:", e); });
        doListen();
      }, 600);
    } else {
      console.error("Server error:", err);
    }
  });

  doListen();
})();
