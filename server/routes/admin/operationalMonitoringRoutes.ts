import type { Express, Request, Response } from "express";
import { requireAuth, requireRole } from "../../auth";
import { getPrivateApiCacheStats } from "../../middleware/privateApiCache";
import { getOperationalHealthSnapshot } from "../../services/operations/operationalHealthService";

/**
 * Read-only operational monitoring endpoint. It exposes aggregate process,
 * request, database-pool, bandwidth/integrity event, cache, and threshold information.
 * It never returns request bodies, cookies, authorization headers, SQL text, or
 * bound database parameters.
 */
export function registerOperationalMonitoringRoutes(app: Express): void {
  app.get(
    "/api/admin/operational-monitoring",
    requireAuth,
    requireRole("Admin", "Owner"),
    (_req: Request, res: Response) => {
      res.status(200).json({
        ...getOperationalHealthSnapshot(),
        privateApiCache: getPrivateApiCacheStats(),
      });
    },
  );
}
