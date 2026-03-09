import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import fs from "fs";
import { registerRoutes } from "./routes";
import { setupVite, log } from "./vite";
import type { User } from "@shared/schema";
import { db } from "./db";

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

(async () => {
  // Run database migrations to ensure all tables and columns exist in production
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
  ];
  for (const migration of migrations) {
    try {
      await db.execute(migration);
    } catch (err: any) {
      console.warn(`Migration skipped: ${err.message?.split('\n')[0]}`);
    }
  }
  console.log("✓ Database tables and columns verified/migrated");

  // Build info endpoint for frontend version checking (must be before registerRoutes)
  app.get("/api/build-info", (_req, res) => {
    res.json({ version: BUILD_VERSION });
  });

  const server = await registerRoutes(app);

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
          // Never cache index.html to prevent serving stale bundles
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        } else {
          // Allow long-term caching for hashed assets
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }));

    // Fallback to index.html with no-cache headers
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

  const doListen = () => {
    server.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
      log(`serving on port ${port}`);
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
