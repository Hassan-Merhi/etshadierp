import type { Express } from "express";

import { requireAuth } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { inventoryErrorStatus } from "./inventoryErrors";
import { quickAdjustInventory } from "./inventoryQuickAdjustService";
import {
  getActiveInventoryCompanyId,
  getInventoryAuditActor,
  parseQuickAdjustmentInput,
} from "./inventoryRequestContext";

export function registerInventoryQuickAdjustRoutes(app: Express) {
  app.post("/api/inventory/quick-adjust", requireAuth, async (req, res) => {
    try {
      const companyId = getActiveInventoryCompanyId(req);
      const input = parseQuickAdjustmentInput(req.body);
      const result = await quickAdjustInventory(companyId, input, getInventoryAuditActor(req));
      return res.json(result);
    } catch (error: unknown) {
      logger.error("Quick adjust error:", { error });
      return res.status(inventoryErrorStatus(error)).json({ message: getErrorMessage(error) });
    }
  });
}
