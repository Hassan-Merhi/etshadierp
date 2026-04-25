import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import fs from "fs";
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

// Build version for cache busting and deployment tracking
const BUILD_VERSION = process.env.BUILD_VERSION || 
                      process.env.RENDER_GIT_COMMIT?.substring(0, 8) || 
                      Date.now().toString();

const app = express();

// Compress all HTTP responses (gzip/deflate) — reduces bandwidth by 60-80%
app.use(compression());

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

app.use(express.json({
  limit: "50mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false, limit: "50mb" }));
app.use("/uploads", express.static("uploads"));

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
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
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

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
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
      advance_id integer NOT NULL REFERENCES employee_advances(id),
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
    // WhatsApp recipients (individual numbers or group chatIds)
    `CREATE TABLE IF NOT EXISTS whatsapp_recipients (
      id serial PRIMARY KEY,
      chat_id varchar(255) NOT NULL UNIQUE,
      name varchar(255) NOT NULL DEFAULT '',
      is_group boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
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

    // net_position_export_settings (id=1)
    `INSERT INTO net_position_export_settings (id, frequency, send_hour, enabled, auto_send)
     VALUES (1, 'daily', 18, false, false)
     ON CONFLICT (id) DO NOTHING`,
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
