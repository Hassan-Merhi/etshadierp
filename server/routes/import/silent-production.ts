/**
 * importRoutes: SilentProduction endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { db } from "../../db";
import { requireAuth, requireNonPOS } from "../../auth";
import {} from "@shared/schema";
import { adjustInventory } from "../../inventoryHelper";

export function registerSilentProductionRoutes(app: Express) {
  // POST /api/inventory/silent-production — Developer-only silent production/consumption adjustment
  app.post("/api/inventory/silent-production", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (req.user?.role !== "Developer") {
        return res.status(403).json({ message: "Developer access required" });
      }
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { locationId, type, items } = req.body;
      if (!locationId || !type || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "locationId, type, and items are required" });
      }
      if (type !== "Production" && type !== "Consumption") {
        return res.status(400).json({ message: "type must be Production or Consumption" });
      }

      const locId = parseInt(locationId);
      let applied = 0;

      await db.transaction(async (tx) => {
        for (const item of items) {
          const qty = parseFloat(item.quantity);
          const rate = parseFloat(item.rate || "0");
          if (!qty || !item.stockItemId) continue;
          const delta = type === "Production" ? Math.abs(qty) : -Math.abs(qty);
          await adjustInventory(
            tx,
            locId,
            parseInt(item.stockItemId),
            delta,
            companyId,
            type === "Production" ? rate : undefined
          );
          applied++;
        }
      });

      res.json({ success: true, applied, type });
    } catch (err: unknown) {
      logger.error("Silent production/consumption error:", { error: err });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });
}
