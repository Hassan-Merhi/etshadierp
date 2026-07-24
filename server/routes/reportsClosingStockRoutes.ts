/**
 * Closing-stock report routes.
 *
 * Current inventory value by stock group, plus the transfer / carry-forward
 * of closing stock and the per-group item breakdown. Extracted from
 * reportsRoutes.ts as a sub-registrar; behaviour is unchanged.
 */
import type { Express } from "express";
import { logger } from "../lib/logger";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { adjustInventory } from "../inventoryHelper";
import {
  inventory,
  stockItems,
  vouchers,
  containers,
  containerOffloads,
  containerOffloadItems,
  locations,
  salesItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
} from "@shared/schema";

export function registerReportsClosingStockRoutes(app: Express) {
  // Closing Stock Summary - Current inventory values by stock group
  app.get("/api/reports/closing-stock-summary", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all stock groups for the company
      const allStockGroups = await storage.getAllStockGroups(companyId);

      // Get all stock items for the company
      const allStockItems = await storage.getAllStockItems(companyId);

      // Get inventory data from active locations only
      const inventoryData = await db
        .select({
          stockItemId: inventory.stockItemId,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(and(eq(inventory.companyId, companyId), eq(locations.active, true), isNull(locations.deletedAt)))
        .execute();

      // Aggregate inventory by stock item - calculate value dynamically as qty * rate
      const inventoryByItem = new Map<number, { quantity: number; totalValue: number }>();
      for (const inv of inventoryData) {
        const qty = parseFloat(inv.quantity) || 0;
        const rate = parseFloat(inv.averageRate) || 0;
        const val = qty * rate;

        if (inventoryByItem.has(inv.stockItemId)) {
          const existing = inventoryByItem.get(inv.stockItemId)!;
          existing.quantity += qty;
          existing.totalValue += val;
        } else {
          inventoryByItem.set(inv.stockItemId, {
            quantity: qty,
            totalValue: val,
          });
        }
      }

      // Build stock groups summary
      const stockGroupSummary = allStockGroups
        .map((group) => {
          const groupItems = allStockItems.filter((item) => item.stockGroupId === group.id);

          let closingQuantity = 0;
          let closingValue = 0;

          for (const item of groupItems) {
            const invData = inventoryByItem.get(item.id);
            if (invData) {
              closingQuantity += invData.quantity;
              closingValue += invData.totalValue;
            }
          }

          const closingRate = closingQuantity > 0 ? closingValue / closingQuantity : 0;

          return {
            id: group.id,
            code: group.code,
            name: group.name,
            closing: {
              quantity: closingQuantity,
              rate: closingRate,
              value: closingValue,
            },
            itemCount: groupItems.length,
          };
        })
        .filter((g) => g.closing.quantity > 0 || g.closing.value > 0);

      // Calculate grand totals
      const grandTotal = {
        quantity: stockGroupSummary.reduce((sum, g) => sum + g.closing.quantity, 0),
        value: stockGroupSummary.reduce((sum, g) => sum + g.closing.value, 0),
      };

      const grandTotalRate = grandTotal.quantity > 0 ? grandTotal.value / grandTotal.quantity : 0;

      res.json({
        stockGroups: stockGroupSummary,
        grandTotal: {
          quantity: grandTotal.quantity,
          rate: grandTotalRate,
          value: grandTotal.value,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Transfer Closing Stock to Another Company as Opening Stock
  app.post("/api/reports/transfer-closing-stock", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const sourceCompanyId = req.session.currentCompanyId;
      if (!sourceCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { targetCompanyId: rawTargetId } = req.body;
      if (!rawTargetId) {
        return res.status(400).json({ message: "Target company is required" });
      }

      const targetCompanyId = typeof rawTargetId === "string" ? parseInt(rawTargetId, 10) : rawTargetId;
      if (isNaN(targetCompanyId)) {
        return res.status(400).json({ message: "Invalid target company ID" });
      }

      if (sourceCompanyId === targetCompanyId) {
        return res.status(400).json({ message: "Cannot transfer to the same company" });
      }

      // Verify user has access to target company
      const userCompanies = await storage.getUserCompaniesWithRoles(req.user!.id);
      const hasAccessToTarget = userCompanies.some((uc) => uc.companyId === targetCompanyId);
      if (!hasAccessToTarget) {
        return res.status(403).json({ message: "You don't have access to the target company" });
      }

      // Get source company inventory from active locations
      const sourceInventory = await db
        .select({
          stockItemId: inventory.stockItemId,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(and(eq(inventory.companyId, sourceCompanyId), eq(locations.active, true), isNull(locations.deletedAt)))
        .execute();

      if (sourceInventory.length === 0) {
        return res.status(400).json({ message: "No inventory found in source company" });
      }

      // Aggregate by stock item (combine quantities from multiple locations)
      const aggregatedInventory = new Map<number, { quantity: number; totalValue: number }>();
      for (const inv of sourceInventory) {
        const qty = parseFloat(inv.quantity) || 0;
        const rate = parseFloat(inv.averageRate) || 0;
        const val = qty * rate;

        if (aggregatedInventory.has(inv.stockItemId)) {
          const existing = aggregatedInventory.get(inv.stockItemId)!;
          existing.quantity += qty;
          existing.totalValue += val;
        } else {
          aggregatedInventory.set(inv.stockItemId, { quantity: qty, totalValue: val });
        }
      }

      // Check if target company already has inventory
      const existingTargetInventory = await db
        .select({ id: inventory.id })
        .from(inventory)
        .where(eq(inventory.companyId, targetCompanyId))
        .limit(1);

      if (existingTargetInventory.length > 0) {
        return res.status(400).json({ message: "Target company already has inventory. Please reset it first." });
      }

      // Get the first location in target company (or create a default one)
      const targetLocations = await storage.getAllLocations(targetCompanyId);
      if (targetLocations.length === 0) {
        return res
          .status(400)
          .json({ message: "Target company has no locations. Please create at least one location first." });
      }
      const defaultLocation = targetLocations[0];

      // Get stock items that exist in source - we need to ensure they exist in target
      const sourceStockItemIds = Array.from(aggregatedInventory.keys());
      const sourceStockItems = await db.select().from(stockItems).where(inArray(stockItems.id, sourceStockItemIds));

      // Map source stock item codes to target stock items — single batch query (was N queries)
      const sourceCodes = sourceStockItems.map((i) => i.code).filter(Boolean) as string[];
      const targetItemsInBatch =
        sourceCodes.length > 0
          ? await db
              .select({ id: stockItems.id, code: stockItems.code })
              .from(stockItems)
              .where(and(eq(stockItems.companyId, targetCompanyId), inArray(stockItems.code, sourceCodes)))
              .execute()
          : [];
      const targetItemsByCode = new Map(targetItemsInBatch.map((i) => [i.code, i.id]));

      const stockItemMapping = new Map<number, number>();
      for (const sourceItem of sourceStockItems) {
        const targetId = targetItemsByCode.get(sourceItem.code);
        if (targetId !== undefined) {
          stockItemMapping.set(sourceItem.id, targetId);
        } else {
          return res.status(400).json({
            message: `Stock item "${sourceItem.name}" (code: ${sourceItem.code}) doesn't exist in target company. Please create matching stock items first.`,
          });
        }
      }

      // Calculate total value for the opening balance voucher
      let totalTransferValue = 0;
      for (const [, data] of Array.from(aggregatedInventory)) {
        totalTransferValue += data.totalValue;
      }

      // Create opening inventory records in target company
      await db.transaction(async (tx) => {
        for (const [sourceStockItemId, data] of Array.from(aggregatedInventory)) {
          const targetStockItemId = stockItemMapping.get(sourceStockItemId);
          if (!targetStockItemId) continue;

          const avgRate = data.quantity > 0 ? data.totalValue / data.quantity : 0;

          await adjustInventory(tx, defaultLocation.id, targetStockItemId, data.quantity, targetCompanyId, avgRate);
        }
      });

      // Get company names for response
      const sourceCompany = await storage.getCompanyById(sourceCompanyId);
      const targetCompany = await storage.getCompanyById(targetCompanyId);

      res.json({
        success: true,
        message: `Successfully transferred closing stock from ${sourceCompany?.name} to ${targetCompany?.name}`,
        itemsTransferred: aggregatedInventory.size,
        totalValue: totalTransferValue.toFixed(2),
        targetLocation: defaultLocation.name,
      });
    } catch (error: any) {
      logger.error("Error transferring closing stock:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  // Carry Forward Closing Stock to Opening Stock (same company)
  app.post("/api/reports/carryforward-closing-stock", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { asOfDate } = req.body;
      const targetDate = asOfDate ? new Date(asOfDate) : new Date();
      const targetDateStr = targetDate.toISOString().split("T")[0];

      // Get current inventory from active locations, aggregated by stock item
      const currentInventory = await db
        .select({
          stockItemId: inventory.stockItemId,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(and(eq(inventory.companyId, companyId), eq(locations.active, true), isNull(locations.deletedAt)))
        .execute();

      // Aggregate by stock item (combine quantities from multiple locations)
      const aggregatedInventory = new Map<number, { quantity: number; totalValue: number }>();
      for (const inv of currentInventory) {
        const qty = parseFloat(inv.quantity) || 0;
        const rate = parseFloat(inv.averageRate) || 0;
        const val = qty * rate;

        if (aggregatedInventory.has(inv.stockItemId)) {
          const existing = aggregatedInventory.get(inv.stockItemId)!;
          existing.quantity += qty;
          existing.totalValue += val;
        } else {
          aggregatedInventory.set(inv.stockItemId, { quantity: qty, totalValue: val });
        }
      }

      // Get sales items from vouchers AFTER the target date and add them back
      // (Sales reduce inventory, so we add them back to get historical inventory)
      const salesAfterDate = await db
        .select({
          stockItemId: salesItems.stockItemId,
          quantity: salesItems.quantity,
          costPrice: salesItems.costPrice,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.optional, false),
            sql`${vouchers.voucherDate} > ${targetDateStr}`
          )
        )
        .execute();

      for (const sale of salesAfterDate) {
        const qty = parseFloat(sale.quantity) || 0;
        const cost = parseFloat(sale.costPrice) || 0;
        const val = qty * cost;

        if (aggregatedInventory.has(sale.stockItemId)) {
          const existing = aggregatedInventory.get(sale.stockItemId)!;
          existing.quantity += qty;
          existing.totalValue += val;
        } else {
          aggregatedInventory.set(sale.stockItemId, { quantity: qty, totalValue: val });
        }
      }

      // Get stock adjustments AFTER the target date and reverse them
      // Production (positive qty) reduces historical inventory (subtract)
      // Consumption (negative qty) increases historical inventory (add back the consumed amount)
      const adjustmentsAfterDate = await db
        .select({
          stockItemId: stockAdjustmentItems.stockItemId,
          quantity: stockAdjustmentItems.quantity,
          rate: stockAdjustmentItems.rate,
        })
        .from(stockAdjustmentItems)
        .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
        .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.optional, false),
            sql`${vouchers.voucherDate} > ${targetDateStr}`
          )
        )
        .execute();

      for (const adj of adjustmentsAfterDate) {
        const qty = parseFloat(adj.quantity) || 0;
        const rate = parseFloat(adj.rate) || 0;
        const val = Math.abs(qty) * rate;

        if (aggregatedInventory.has(adj.stockItemId)) {
          const existing = aggregatedInventory.get(adj.stockItemId)!;
          // Reverse the adjustment: subtract what was added (production), add back what was consumed
          existing.quantity -= qty;
          existing.totalValue -= qty >= 0 ? val : -val;
        } else {
          // If no current inventory, create with reversed values
          aggregatedInventory.set(adj.stockItemId, {
            quantity: -qty,
            totalValue: qty >= 0 ? -val : val,
          });
        }
      }

      // Get container offloads AFTER the target date and subtract them
      // (Container offloads add inventory, so we subtract them to get historical inventory)
      const offloadsAfterDate = await db
        .select({
          stockItemId: containerOffloadItems.stockItemId,
          quantity: containerOffloadItems.quantity,
          rate: containerOffloadItems.rate,
        })
        .from(containerOffloadItems)
        .innerJoin(containerOffloads, eq(containerOffloadItems.offloadId, containerOffloads.id))
        .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
        .where(and(eq(containers.companyId, companyId), sql`${containerOffloads.offloadedAt} > ${targetDate}`))
        .execute();

      for (const offload of offloadsAfterDate) {
        const qty = parseFloat(offload.quantity) || 0;
        const rate = parseFloat(offload.rate) || 0;
        const val = qty * rate;

        if (aggregatedInventory.has(offload.stockItemId)) {
          const existing = aggregatedInventory.get(offload.stockItemId)!;
          // Subtract offloaded items to reverse the inbound transaction
          existing.quantity -= qty;
          existing.totalValue -= val;
        } else {
          // If no current inventory, create with negative values (unlikely but handle it)
          aggregatedInventory.set(offload.stockItemId, { quantity: -qty, totalValue: -val });
        }
      }

      // Filter out items with zero or negative quantities
      for (const [stockItemId, data] of Array.from(aggregatedInventory)) {
        if (data.quantity <= 0) {
          aggregatedInventory.delete(stockItemId);
        }
      }

      if (aggregatedInventory.size === 0) {
        return res.status(400).json({ message: "No inventory found for the selected date" });
      }

      // Get all stock items for this company to update those with zero inventory
      const allStockItems = await db
        .select({ id: stockItems.id })
        .from(stockItems)
        .where(and(eq(stockItems.companyId, companyId), eq(stockItems.active, true), isNull(stockItems.deletedAt)))
        .execute();

      let itemsUpdated = 0;
      let totalValue = 0;

      // Update stock items with calculated historical inventory as new opening stock
      await db.transaction(async (tx) => {
        // First, reset all stock items opening to zero
        for (const item of allStockItems) {
          if (!aggregatedInventory.has(item.id)) {
            await tx
              .update(stockItems)
              .set({
                openingQty: "0",
                openingRate: "0",
                openingValue: "0",
              })
              .where(eq(stockItems.id, item.id));
          }
        }

        // Then update items that have historical inventory
        for (const [stockItemId, data] of Array.from(aggregatedInventory)) {
          const avgRate = data.quantity > 0 ? data.totalValue / data.quantity : 0;

          await tx
            .update(stockItems)
            .set({
              openingQty: data.quantity.toFixed(3),
              openingRate: avgRate.toFixed(2),
              openingValue: data.totalValue.toFixed(2),
            })
            .where(eq(stockItems.id, stockItemId));

          itemsUpdated++;
          totalValue += data.totalValue;
        }
      });

      const company = await storage.getCompanyById(companyId);

      res.json({
        success: true,
        message: `Successfully set opening stock for ${company?.name} as of ${targetDateStr}. ${itemsUpdated} items updated with total value $${totalValue.toFixed(2)}`,
        itemsUpdated,
        totalValue: totalValue.toFixed(2),
        asOfDate: targetDateStr,
      });
    } catch (error: any) {
      logger.error("Error carrying forward closing stock:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  // Closing Stock Detail - Items in a stock group
  app.get("/api/reports/closing-stock-summary/:stockGroupId/items", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { stockGroupId } = req.params;

      // Get stock items in this group
      const groupItems = await db
        .select()
        .from(stockItems)
        .where(
          and(
            eq(stockItems.companyId, companyId),
            eq(stockItems.stockGroupId, parseInt(stockGroupId)),
            eq(stockItems.active, true)
          )
        )
        .execute();

      // Get inventory for these items from active locations
      const itemIds = groupItems.map((i) => i.id);

      const inventoryData =
        itemIds.length > 0
          ? await db
              .select({
                stockItemId: inventory.stockItemId,
                quantity: inventory.quantity,
                averageRate: inventory.averageRate,
              })
              .from(inventory)
              .innerJoin(locations, eq(inventory.locationId, locations.id))
              .where(
                and(
                  eq(inventory.companyId, companyId),
                  inArray(inventory.stockItemId, itemIds),
                  eq(locations.active, true),
                  isNull(locations.deletedAt)
                )
              )
              .execute()
          : [];

      // Aggregate by stock item - calculate value dynamically as qty * rate
      const inventoryByItem = new Map<number, { quantity: number; totalValue: number }>();
      for (const inv of inventoryData) {
        const qty = parseFloat(inv.quantity) || 0;
        const rate = parseFloat(inv.averageRate) || 0;
        const val = qty * rate;

        if (inventoryByItem.has(inv.stockItemId)) {
          const existing = inventoryByItem.get(inv.stockItemId)!;
          existing.quantity += qty;
          existing.totalValue += val;
        } else {
          inventoryByItem.set(inv.stockItemId, {
            quantity: qty,
            totalValue: val,
          });
        }
      }

      // Build items list
      const items = groupItems
        .map((item) => {
          const invData = inventoryByItem.get(item.id) || { quantity: 0, totalValue: 0 };
          const rate = invData.quantity > 0 ? invData.totalValue / invData.quantity : 0;
          return {
            id: item.id,
            code: item.code,
            name: item.name,
            closing: {
              quantity: invData.quantity,
              rate: rate,
              value: invData.totalValue,
            },
          };
        })
        .filter((i) => i.closing.quantity > 0 || i.closing.value > 0);

      // Calculate totals
      const totals = {
        quantity: items.reduce((sum, i) => sum + i.closing.quantity, 0),
        value: items.reduce((sum, i) => sum + i.closing.value, 0),
      };
      const avgRate = totals.quantity > 0 ? totals.value / totals.quantity : 0;

      res.json({
        items,
        totals: {
          quantity: totals.quantity,
          rate: avgRate,
          value: totals.value,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
