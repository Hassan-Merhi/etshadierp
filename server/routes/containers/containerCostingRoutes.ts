import { parseId, parseOptionalId } from "../../lib/parseId";
import { getClientDate } from "../../lib/dateUtils";
import type { Express, Request, Response, NextFunction } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../../auth";
import { upload, logAudit, getCurrentExchangeRate } from "../_helpers";
import {
  inventory,
  stockItems,
  stockGroups,
  stockItemCodeAliases,
  stockItemLocationPrices,
  stockTransferVouchers,
  stockTransferItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  containers,
  containerOffloads,
  containerOffloadItems,
  containerSales,
  containerCharges,
  containerTrackingImportRowSchema,
  updateContainerTrackingSchema,
  bankAccounts,
  fixedAssets,
  insertBankAccountSchema,
  insertFixedAssetSchema,
  insertStockGroupSchema,
  insertStockItemSchema,
  insertStockItemCodeAliasSchema,
  insertContainerSchema,
  offloadRequestSchema,
  purchaseOrders,
  poLineItems,
  insertContainerSaleSchema,
  vouchers,
  voucherEntries,
  salesItems,
  suppliers,
  customers,
  locations,
  employees,
  userLocations,
  auditLog,
  interCompanyTransfers,
  insertInterCompanyTransferSchema,
  FEATURE_KEYS,
  ledgerAccounts,
  intercompanyPosConfigs,
  stockItemMergeLogs,
} from "@shared/schema";
import {
  eq,
  and,
  or,
  desc,
  asc,
  lt,
  gt,
  ne,
  inArray,
  sql,
  isNull,
  isNotNull,
  not,
  gte,
  lte,
  like,
  ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../../inventoryHelper";

export function registerContainerCostingRoutes(app: Express) {
  app.post("/api/containers/:id/price-import/preview", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseId(req.params.id);

      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      const rows: { barcode: string; price: string }[] = req.body.rows || [];
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No rows provided" });
      }

      // Get all POs for this container
      const containerPOs = await storage.getPurchaseOrdersByContainer(containerId);
      if (containerPOs.length === 0) {
        return res.status(400).json({ message: "No purchase orders found for this container" });
      }
      const poIds = containerPOs.map((po: any) => po.id);

      // Load all line items for those POs in one query
      const allLineItems =
        poIds.length > 0
          ? await db
              .select({
                id: poLineItems.id,
                poId: poLineItems.poId,
                stockItemId: poLineItems.stockItemId,
                itemName: poLineItems.itemName,
                quantity: poLineItems.quantity,
                rate: poLineItems.rate,
                stockItemCode: stockItems.code,
              })
              .from(poLineItems)
              .leftJoin(stockItems, eq(poLineItems.stockItemId, stockItems.id))
              .where(inArray(poLineItems.poId, poIds))
          : [];

      const preview = await Promise.all(
        rows.map(async (row) => {
          const barcode = String(row.barcode || "").trim();
          const newRate = parseFloat(String(row.price || ""));
          if (!barcode) return { barcode, status: "invalid", itemName: null, currentRate: null, newRate: null };
          if (isNaN(newRate) || newRate < 0)
            return { barcode, status: "invalid_price", itemName: null, currentRate: null, newRate: null };

          // Find matching stock item (code or alias)
          const stockItem = await storage.getStockItemByCodeOrAlias(barcode, companyId);
          if (!stockItem) return { barcode, status: "not_found", itemName: null, currentRate: null, newRate };

          // Find matching line items in container POs
          const matched = allLineItems.filter((li: any) => li.stockItemId === stockItem.id);
          if (matched.length === 0) {
            return { barcode, itemName: stockItem.name, status: "not_in_container", currentRate: null, newRate };
          }

          const lineItemIds = matched.map((li: any) => li.id);
          const currentRate = parseFloat(matched[0].rate);
          const noChange = Math.abs(currentRate - newRate) < 0.001;

          return {
            barcode,
            itemName: matched[0].itemName || stockItem.name,
            lineItemIds,
            status: noChange ? "no_change" : "will_update",
            currentRate,
            newRate,
          };
        })
      );

      res.json({ preview });
    } catch (error: any) {
      console.error("Error in container price-import preview:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/containers/:id/price-import/apply", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseId(req.params.id);

      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      const rows: { lineItemIds: number[]; newRate: number }[] = req.body.rows || [];
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No rows provided" });
      }

      // Collect all line item IDs to update
      const allLineItemIds = rows.flatMap((r) => r.lineItemIds || []);
      if (allLineItemIds.length === 0) return res.json({ success: true, updated: 0 });

      await db.transaction(async (tx) => {
        // Update each line item with its new rate
        for (const row of rows) {
          const newRate = parseFloat(String(row.newRate));
          if (isNaN(newRate) || newRate < 0) continue;
          for (const lineItemId of row.lineItemIds || []) {
            // Get the current line item to know its quantity
            const [item] = await tx.select().from(poLineItems).where(eq(poLineItems.id, lineItemId)).limit(1);
            if (!item) continue;
            const qty = parseFloat(item.quantity);
            const newLineTotal = qty * newRate;
            await tx
              .update(poLineItems)
              .set({ rate: newRate.toFixed(2), lineTotal: newLineTotal.toFixed(2) })
              .where(eq(poLineItems.id, lineItemId));
          }
        }

        // Recalculate itemsTotal for all affected POs, then the container
        const containerPOs = await storage.getPurchaseOrdersByContainer(containerId);
        const poIds = containerPOs.map((po: any) => po.id);

        let containerItemsTotal = 0;
        let containerChargesTotal = 0;

        for (const po of containerPOs) {
          const lineItems = await tx.select().from(poLineItems).where(eq(poLineItems.poId, po.id));
          const newItemsTotal = lineItems.reduce((sum: number, li: any) => sum + parseFloat(li.lineTotal || "0"), 0);
          await tx
            .update(purchaseOrders)
            .set({ itemsTotal: newItemsTotal.toFixed(2) })
            .where(eq(purchaseOrders.id, po.id));
          containerItemsTotal += newItemsTotal;
          containerChargesTotal +=
            parseFloat(po.freight || "0") +
            parseFloat(po.surcharge || "0") +
            parseFloat(po.fumigation || "0") +
            parseFloat(po.documentCharges || "0") -
            parseFloat(po.discount || "0") +
            parseFloat(po.otherCharges || "0");
        }

        await tx
          .update(containers)
          .set({
            itemsTotal: containerItemsTotal.toFixed(2),
            chargesTotal: containerChargesTotal.toFixed(2),
            grandTotal: (containerItemsTotal + containerChargesTotal).toFixed(2),
          })
          .where(eq(containers.id, containerId));
      });

      res.json({ success: true, updated: allLineItemIds.length });
    } catch (error: any) {
      console.error("Error in container price-import apply:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get all accounts (combined from ledgers, bank accounts, fixed assets, and suppliers)
}
