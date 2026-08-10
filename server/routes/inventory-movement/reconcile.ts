/**
 * inventoryMovementRoutes: InventoryReconcile endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth, requireRole } from "../../auth";
import { inventory } from "@shared/schema";

export function registerInventoryReconcileRoutes(app: Express) {
  app.get("/api/inventory/reconcile", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId!;
      const issues = [];

      const allInventory = await db.select().from(inventory).where(eq(inventory.companyId, companyId));

      for (const inv of allInventory) {
        const qty = parseFloat(inv.quantity || "0");
        const rate = parseFloat(inv.averageRate || "0");
        const totalValue = parseFloat(inv.totalValue || "0");
        const expectedValue = qty * rate;

        if (qty < 0) {
          issues.push({
            type: "negative_inventory",
            severity: "info",
            stockItemId: inv.stockItemId,
            locationId: inv.locationId,
            quantity: qty,
            message: `Negative inventory: ${qty} units`,
          });
        }

        if (qty > 0 && Math.abs(totalValue - expectedValue) > 0.02) {
          issues.push({
            type: "value_mismatch",
            severity: "error",
            stockItemId: inv.stockItemId,
            locationId: inv.locationId,
            quantity: qty,
            averageRate: rate,
            totalValue,
            expectedValue: parseFloat(expectedValue.toFixed(2)),
            difference: parseFloat((totalValue - expectedValue).toFixed(2)),
            message: `Value mismatch: stored=${totalValue}, expected=${expectedValue.toFixed(2)}`,
          });
        }

        if (rate < 0) {
          issues.push({
            type: "negative_rate",
            severity: "error",
            stockItemId: inv.stockItemId,
            locationId: inv.locationId,
            averageRate: rate,
            message: `Negative average rate: ${rate}`,
          });
        }

        if (qty === 0 && totalValue !== 0) {
          issues.push({
            type: "zero_qty_nonzero_value",
            severity: "warning",
            stockItemId: inv.stockItemId,
            locationId: inv.locationId,
            quantity: qty,
            totalValue,
            message: `Zero quantity but non-zero total value: ${totalValue}`,
          });
        }
      }

      const locationIds = Array.from(new Set(allInventory.map((i) => i.locationId)));
      const stockItemIds = Array.from(new Set(allInventory.map((i) => i.stockItemId)));

      const duplicateCheck = new Map<string, number>();
      for (const inv of allInventory) {
        const key = `${inv.locationId}-${inv.stockItemId}`;
        duplicateCheck.set(key, (duplicateCheck.get(key) || 0) + 1);
      }
      for (const [key, count] of Array.from(duplicateCheck.entries())) {
        if (count > 1) {
          const [locId, itemId] = key.split("-").map(Number);
          issues.push({
            type: "duplicate_inventory",
            severity: "critical",
            stockItemId: itemId,
            locationId: locId,
            duplicateCount: count,
            message: `${count} duplicate inventory records found`,
          });
        }
      }

      const summary = {
        totalRecords: allInventory.length,
        totalLocations: locationIds.length,
        totalStockItems: stockItemIds.length,
        issueCount: issues.length,
        criticalIssues: issues.filter((i) => i.severity === "critical").length,
        errorIssues: issues.filter((i) => i.severity === "error").length,
        warningIssues: issues.filter((i) => i.severity === "warning").length,
        infoIssues: issues.filter((i) => i.severity === "info").length,
        totalInventoryValue: allInventory.reduce((sum, inv) => sum + parseFloat(inv.totalValue || "0"), 0).toFixed(2),
      };

      res.json({ summary, issues });
    } catch (error: unknown) {
      logger.error("Inventory reconciliation error:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
