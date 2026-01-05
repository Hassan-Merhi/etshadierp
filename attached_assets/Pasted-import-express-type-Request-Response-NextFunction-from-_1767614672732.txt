import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import fs from "fs";
import { registerRoutes } from "./routes";
import { setupVite, log } from "./vite";
import type { User } from "@shared/schema";

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
        canEditDaybook?: boolean;
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
    canEditDaybook?: boolean;
  }
}

app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

// Trust proxy for HTTPS termination
// This is required for both Replit (development) and Render (production)
// as both run behind reverse proxies
app.set("trust proxy", 1);

// Session middleware
const PgSession = connectPgSimple(session);

const sessionConfig: session.SessionOptions = {
  name: 'erp.session', // Explicit cookie name
  secret: process.env.SESSION_SECRET || "your-secret-key-change-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: {
    // Replit serves over HTTPS even in dev mode, so we need secure cookies
    secure: process.env.NODE_ENV === "production" || !!process.env.REPL_ID,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/', // Explicit path
    sameSite: 'lax', // Lax allows same-site requests and top-level navigation
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
  // Build info endpoint for frontend version checking (must be before registerRoutes)
  app.get("/api/build-info", (_req, res) => {
    res.json({ version: BUILD_VERSION });
  });

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

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
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
