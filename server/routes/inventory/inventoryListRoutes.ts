import type { Express } from "express";

import { requireAuth } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { getInventoryPage } from "./inventoryQueryService";
import { getActiveInventoryCompanyId, parseInventoryListFilters } from "./inventoryRequestContext";

export function registerInventoryListRoutes(app: Express) {
  app.get("/api/inventory", requireAuth, async (req, res) => {
    try {
      const companyId = getActiveInventoryCompanyId(req);
      const filters = parseInventoryListFilters(req);
      return res.json(await getInventoryPage(companyId, filters));
    } catch (error: unknown) {
      logger.error("Inventory fetch failed", {
        module: "inventory",
        action: "getInventory",
        companyId: req.session.currentCompanyId,
        error,
      });
      const status = error instanceof Error && "statusCode" in error ? Number(error.statusCode) || 500 : 500;
      return res.status(status).json({ message: getErrorMessage(error) });
    }
  });
}
