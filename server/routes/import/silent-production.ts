/**
 * importRoutes: SilentProduction endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { db } from "../../db";
import { requireAuth, requireNonPOS } from "../../auth";
import {} from "@shared/schema";
import { adjustInventory } from "../../inventoryHelper";
import { createDatabaseStockMovementAdapter } from "../../services/inventory/databaseStockMovementAdapter";
import { postStockMovementTx } from "../../services/inventory/stockMovementIntegrityService";

const canonicalStockMovementAdapter = createDatabaseStockMovementAdapter();

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
      const operationId = randomUUID();
      const occurredAt = new Date().toISOString();
      let applied = 0;

      await db.transaction(async (tx) => {
        for (let index = 0; index < items.length; index++) {
          const item = items[index];
          const qty = parseFloat(item.quantity);
          const parsedRate = parseFloat(item.rate || "0");
          const rate = Number.isFinite(parsedRate) && parsedRate >= 0 ? parsedRate : 0;
          if (!qty || !item.stockItemId) continue;
          const stockItemId = parseInt(item.stockItemId);
          const delta = type === "Production" ? Math.abs(qty) : -Math.abs(qty);
          const inventoryResult = await adjustInventory(
            tx,
            locId,
            stockItemId,
            delta,
            companyId,
            type === "Production" ? rate : undefined
          );
          await postStockMovementTx(
            tx,
            {
              companyId,
              stockItemId,
              kind: "adjustment",
              quantity: String(Math.abs(qty)),
              unitCost: String(type === "Production" ? rate : inventoryResult.averageRate),
              fromLocationId: type === "Consumption" ? locId : undefined,
              toLocationId: type === "Production" ? locId : undefined,
              occurredAt,
              source: {
                sourceType: type === "Production" ? "silent_production" : "silent_consumption",
                sourceId: operationId,
                idempotencyKey: `silent-production:${companyId}:${operationId}:${index}:${stockItemId}`,
              },
              allowNegativeStock: true,
            },
            canonicalStockMovementAdapter
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
