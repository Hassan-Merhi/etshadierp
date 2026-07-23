import type { Express } from "express";
import { logger } from "../lib/logger";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { logAudit } from "./_helpers";
import { adjustInventory } from "../inventoryHelper";
import { registerInventoryMovementRoutes } from "./inventoryMovementRoutes";
import {
  locations,
  inventory,
  stockItems,
  stockGroups,
  companies,
} from "@shared/schema";
import { eq, and, or, asc, sql, isNull, ilike } from "drizzle-orm";

export function registerInventoryRoutes(app: Express) {
  app.get("/api/inventory", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const companyId = req.session.currentCompanyId;
      const { page, pageSize, search, locationId, stockGroupId } = req.query;

      // Always return paginated format { data, page, pageSize, total, totalPages }.
      // Page and pageSize are optional and default when not supplied so that legacy
      // callers (offline prep, cache invalidation) still work without changes.
      const pageNum = Math.max(1, parseInt((page as string) || "1") || 1);
      const pageSizeNum = Math.min(250, Math.max(1, parseInt((pageSize as string) || "100") || 100));
      const offset = (pageNum - 1) * pageSizeNum;

      const conditions: any[] = [
        eq(inventory.companyId, companyId),
        isNull(locations.deletedAt),
        isNull(stockItems.deletedAt),
      ];
      if (locationId) {
        conditions.push(eq(inventory.locationId, parseInt(locationId as string)));
      }
      if (stockGroupId && stockGroupId !== "all") {
        conditions.push(eq(stockItems.stockGroupId, parseInt(stockGroupId as string)));
      }
      if (search && typeof search === "string" && search.trim()) {
        const q = `%${search.trim()}%`;
        conditions.push(or(ilike(stockItems.name, q), ilike(stockItems.code, q)));
      }
      const where = and(...conditions);

      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(inventory)
        .leftJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(where);

      const data = await db
        .select({
          inventoryId: inventory.id,
          locationId: inventory.locationId,
          locationName: locations.name,
          locationCode: locations.code,
          stockItemId: inventory.stockItemId,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
          totalValue: inventory.totalValue,
          lastUpdated: inventory.lastUpdated,
          stockItemCode: stockItems.code,
          stockItemName: stockItems.name,
          stockItemUom: stockItems.uom,
          stockGroupId: stockItems.stockGroupId,
          stockGroupName: sql<string>`COALESCE(${stockGroups.name}, '')`,
          stockGroupCode: sql<string>`COALESCE(${stockGroups.code}, '')`,
        })
        .from(inventory)
        .leftJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(where)
        .orderBy(asc(stockItems.code), asc(locations.name))
        .limit(pageSizeNum)
        .offset(offset);

      return res.json({
        data,
        page: pageNum,
        pageSize: pageSizeNum,
        total,
        totalPages: Math.ceil(total / pageSizeNum),
      });
    } catch (error: any) {
      logger.error("Inventory fetch failed", { module: "inventory", action: "getInventory", companyId: req.session.currentCompanyId, error });
      res.status(500).json({ message: error.message });
    }
  });

  // Quick stock adjustment - manually add or subtract quantity at a location
  app.post("/api/inventory/quick-adjust", requireAuth, async (req, res) => {
    try {
      const { stockItemId, locationId, quantity, type } = req.body;

      if (!stockItemId || !locationId || !quantity || !type) {
        return res.status(400).json({ message: "Missing required fields: stockItemId, locationId, quantity, type" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const companyId = req.session.currentCompanyId;
      // Block quick-adjust for supplier_partner companies (bypasses sp_stock_movements)
      {
        const [spCo] = await db
          .select({ companyType: companies.companyType })
          .from(companies)
          .where(eq(companies.id, companyId))
          .limit(1);
        if (spCo?.companyType === "supplier_partner") {
          return res
            .status(403)
            .json({ message: "Supplier Partner companies must use SP Sales / SP Containers for this action." });
        }
      }
      const qty = parseFloat(quantity);

      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ message: "Quantity must be a positive number" });
      }

      if (type !== "add" && type !== "subtract") {
        return res.status(400).json({ message: "Type must be 'add' or 'subtract'" });
      }

      // Verify location belongs to current company
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      if (location.companyId !== companyId) {
        return res.status(403).json({ message: "Location belongs to a different company" });
      }

      // Verify stock item exists and belongs to current company
      const stockItem = await storage.getStockItemById(stockItemId);
      if (!stockItem) {
        return res.status(404).json({ message: "Stock item not found" });
      }
      if (stockItem.companyId !== companyId) {
        return res.status(403).json({ message: "Stock item belongs to a different company" });
      }

      // Get or create inventory record - wrapped in transaction for atomicity
      const result = await db.transaction(async (tx) => {
        // Pre-check: get existing inventory to validate quantities
        const [existingInv] = await tx
          .select()
          .from(inventory)
          .where(and(eq(inventory.stockItemId, stockItemId), eq(inventory.locationId, locationId)))
          .limit(1);

        const currentQty = existingInv ? parseFloat(existingInv.quantity || "0") : 0;
        const adjustedQty = type === "add" ? qty : -qty;
        const newQty = currentQty + adjustedQty;

        // Validate: cannot subtract more than available
        if (newQty < 0) {
          throw new Error(`Cannot subtract ${qty} units. Only ${currentQty} units available at this location.`);
        }

        // Use adjustInventory helper to handle both insert and update
        const adjustResult = await adjustInventory(tx, locationId, stockItemId, adjustedQty, companyId);

        return {
          currentQty: adjustResult.previousQuantity,
          newQty: adjustResult.newQuantity,
          adjustedQty,
        };
      });
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: companyId,
          action: "update",
          tableName: "inventory",
          recordId: stockItem.id,
          recordIdentifier: `${stockItem.code} @ ${location.name}`,
          changes: {
            item: { old: stockItem.code, new: stockItem.code },
            location: { new: location.name },
            adjustmentType: { new: type === "add" ? "Add Stock" : "Subtract Stock" },
            quantity: { old: String(result.currentQty), new: String(result.newQty) },
            adjustment: { new: `${type === "add" ? "+" : "-"}${qty}` },
          },
        });
      } catch {
        /* non-fatal */
      }
      res.json({
        message: `Successfully ${type === "add" ? "added" : "subtracted"} ${qty} units. New quantity: ${result.newQty}`,
        previousQuantity: result.currentQty,
        newQuantity: result.newQty,
        adjustment: result.adjustedQty,
      });
    } catch (error: any) {
      console.error("Quick adjust error:", error);
      const isBusinessError =
        error.message?.includes("Cannot subtract") || error.message?.includes("non-existent inventory");
      res.status(isBusinessError ? 400 : 500).json({ message: error.message });
    }
  });

  registerInventoryMovementRoutes(app);

  // Ledger Accounts
}
