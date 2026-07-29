import type { Express } from "express";
import { sql } from "drizzle-orm";

import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";

export function registerLegacyHealthRoutes(app: Express): void {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.get("/api/health/db", async (_req, res) => {
    try {
      await db.execute(sql`SELECT 1 as test`);
      res.json({ status: "ok", message: "Database connection successful" });
    } catch (error: unknown) {
      logger.error("Database connection failed:", { error });
      res.status(500).json({ status: "error", message: getErrorMessage(error) });
    }
  });
}
