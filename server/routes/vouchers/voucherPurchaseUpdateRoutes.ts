import type { Express } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../../auth";
import { requireActionAccess } from "../../lib/permissionMiddleware";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory, syncEmployeeBalancesFromEntries, snapshotVoucherEntries, buildVoucherChangesForCreate, buildVoucherChangesForUpdate, buildItemLevelChanges } from "../_helpers";
import { triggerIntercompanyNotifications } from "../intercompanyNotificationRoutes";
import { autoReallocateLoansAccounts } from "../../lib/transporterAllocation";
import {
  inventory, stockItems, stockGroups, stockItemCodeAliases,
  stockItemLocationPrices, stockTransferVouchers, stockTransferItems,
  stockAdjustmentVouchers, stockAdjustmentItems,
  containers, containerOffloads, containerOffloadItems, containerSales,
  containerCharges, containerTrackingImportRowSchema, updateContainerTrackingSchema,
  bankAccounts, fixedAssets, insertBankAccountSchema, insertFixedAssetSchema,
  insertStockGroupSchema, insertStockItemSchema, insertStockItemCodeAliasSchema,
  insertContainerSchema, offloadRequestSchema,
  purchaseOrders, poLineItems, insertContainerSaleSchema,
  vouchers, voucherEntries, salesItems, insertVoucherSchema, insertVoucherEntrySchema,
  insertSalesItemSchema,
  suppliers, customers, customerBalances, locations, employees, userLocations,
  auditLog, interCompanyTransfers, insertInterCompanyTransferSchema,
  ledgerAccounts, insertLedgerAccountSchema, 
  companies, users, userCompanyRoles, companySettings,
  FEATURE_KEYS, fiscalPeriodClosures,
  wasteDispatches, wasteDispatchItems, insertWasteDispatchSchema,
  bales, baleProducts, baleProductCategories, baleTransfers,
  insertBaleSchema, insertBaleTransferSchema,
  
  dashboardCashAccounts, dashboardPayableAccounts, dashboardAccountSelections,
  insertDashboardCashAccountSchema, insertDashboardPayableAccountSchema,
  insertDashboardAccountSelectionSchema,
  creditNoteItems, 
  pendingBarcodes, insertPendingBarcodeSchema,
  storedFiles, spreadsheets, liveSpreadsheets,
  agentAccounts, insertAgentAccountSchema,
  salaryAdvances, salaryAdvanceDeductions,
  insertSalaryAdvanceSchema, insertSalaryAdvanceDeductionSchema,
  chatMessages,
  
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../../inventoryHelper";
import { checkAccountWhatsAppRule } from "../factoryWhatsappRoutes";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../../netPositionHelper";
import path from "path";
import fs from "fs";

import { registerVoucherEntryRoutes } from "../voucherEntryRoutes";
import { recalculateOrderTotals } from "../factory/_helpers";
import {
  customerOrderCharges, customerOrders, customerOrderBales, customerOrderLines,
  factorySettings as fSettings,
  factoryDaybookEntries as fde,
} from "@shared/schema";

/**
 * After saving a journal voucher, if it has a customer entry + a ledger account entry,
 * look for order charges linked to that ledger account for that customer.
 * If exactly one charge is found, update its amount and recalculate the order totals.
 */

export function registerVoucherPurchaseUpdateRoutes(app: Express) {
  app.patch(
    "/api/vouchers/:id/purchase",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid voucher ID" });
        }

        const { voucherDate, description, items } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
          return res
            .status(400)
            .json({ message: "At least one item is required" });
        }

        // Get the existing voucher to check company and permissions
        const existingVoucher = await storage.getVoucherById(id);
        if (!existingVoucher) {
          return res.status(404).json({ message: "Voucher not found" });
        }

        // Verify this is a Purchase voucher
        if (existingVoucher.voucherType !== "Purchase") {
          return res
            .status(400)
            .json({ message: "This endpoint only updates Purchase vouchers" });
        }

        // Verify voucher belongs to current company
        if (existingVoucher.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Voucher belongs to a different company",
            });
        }

        // Check edit permissions based on role
        const userRole = req.session.currentRole;
        if (!userRole) {
          return res.status(403).json({ message: "User role not found" });
        }

        // Admin and Owner can edit all vouchers
        if (userRole !== "Admin" && userRole !== "Owner" && userRole !== "Developer") {
          // Manager can only edit today's vouchers
          if (userRole === "Manager") {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const voucherDate = new Date(existingVoucher.voucherDate);
            voucherDate.setHours(0, 0, 0, 0);

            if (voucherDate.getTime() !== today.getTime()) {
              return res
                .status(403)
                .json({ message: "Managers can only edit today's vouchers" });
            }
          } else {
            // Other roles cannot edit
            return res
              .status(403)
              .json({ message: "Insufficient permissions to edit vouchers" });
          }
        }

        // Find the associated purchase order
        const [po] = await db
          .select()
          .from(purchaseOrders)
          .where(eq(purchaseOrders.voucherId, id))
          .limit(1);

        if (!po) {
          return res
            .status(404)
            .json({ message: "Associated purchase order not found" });
        }

        // Store old total for container update calculation
        const oldPOTotal = parseFloat(po.itemsTotal || "0");

        // Calculate totals and prepare items data
        let totalAmount = 0;

        const poItemsData = items.map((item: any) => {
          const quantity = parseFloat(item.quantity);
          const rate = parseFloat(item.rate);
          const lineTotal = quantity * rate;

          totalAmount += lineTotal;

          return {
            poId: po.id,
            stockItemId: item.stockItemId || 0, // Default to 0 if not provided
            itemName: item.itemName,
            quantity: item.quantity,
            rate: item.rate,
            lineTotal: lineTotal.toFixed(2),
          };
        });

        // Snapshot old PO line items for audit diff (before delete)
        const _oldPOItems = await db.select().from(poLineItems).where(eq(poLineItems.poId, po.id));

        // Delete existing PO line items
        await db.delete(poLineItems).where(eq(poLineItems.poId, po.id));

        // Insert new PO line items
        await db.insert(poLineItems).values(poItemsData);

        // Update the purchase order total
        await db
          .update(purchaseOrders)
          .set({ itemsTotal: totalAmount.toFixed(2) })
          .where(eq(purchaseOrders.id, po.id));

        // Update the container totals to reflect the PO change
        const [container] = await db
          .select()
          .from(containers)
          .where(eq(containers.id, po.containerId))
          .limit(1);

        if (container) {
          const containerItemsTotal = parseFloat(container.itemsTotal || "0");
          const containerChargesTotal = parseFloat(
            container.chargesTotal || "0",
          );

          // Calculate the difference and update container
          const difference = totalAmount - oldPOTotal;
          const newContainerItemsTotal = containerItemsTotal + difference;
          const newContainerGrandTotal =
            newContainerItemsTotal + containerChargesTotal;

          await db
            .update(containers)
            .set({
              itemsTotal: newContainerItemsTotal.toFixed(2),
              grandTotal: newContainerGrandTotal.toFixed(2),
            })
            .where(eq(containers.id, po.containerId));
        }

        // Update the voucher
        const voucherUpdates: any = {
          totalAmount: totalAmount.toFixed(2),
        };
        if (voucherDate !== undefined) voucherUpdates.voucherDate = voucherDate;
        if (description !== undefined) voucherUpdates.description = description;

        const updated = await db
          .update(vouchers)
          .set(voucherUpdates)
          .where(eq(vouchers.id, id))
          .returning();

        try {
          const _purChanges: Record<string, any> = {};
          if (existingVoucher.voucherDate !== updated[0].voucherDate)
            _purChanges.date = { old: existingVoucher.voucherDate, new: updated[0].voucherDate };
          if (existingVoucher.totalAmount !== updated[0].totalAmount)
            _purChanges.totalAmount = { old: existingVoucher.totalAmount, new: updated[0].totalAmount };
          if (existingVoucher.description !== updated[0].description)
            _purChanges.description = { old: existingVoucher.description ?? "", new: updated[0].description ?? "" };
          const _itemDiff = await buildItemLevelChanges(
            _oldPOItems.map(it => ({
              stockItemId: it.stockItemId,
              itemName: it.itemName,
              quantity: it.quantity,
              rate: it.rate,
              lineTotal: it.lineTotal,
            })),
            poItemsData.map(it => ({
              stockItemId: it.stockItemId,
              itemName: it.itemName,
              quantity: it.quantity,
              rate: it.rate,
              lineTotal: it.lineTotal,
            }))
          );
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || "unknown",
            companyId: req.session.currentCompanyId!,
            action: "update",
            tableName: "vouchers",
            recordId: updated[0].id,
            recordIdentifier: updated[0].voucherNumber,
            changes: { ..._purChanges, ..._itemDiff },
          });
        } catch { /* non-fatal */ }
        res.json(updated[0]);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Update an adjustment voucher (Consumption, Production, or Mixed) with line items
  app.patch(
    "/api/vouchers/:id/adjustment",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid voucher ID" });
        }

        const { voucherDate, description, locationId, items } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
          return res
            .status(400)
            .json({ message: "At least one item is required" });
        }

        if (!locationId) {
          return res.status(400).json({ message: "Location ID is required" });
        }

        // Get the existing voucher to check company and permissions
        const existingVoucher = await storage.getVoucherById(id);
        if (!existingVoucher) {
          return res.status(404).json({ message: "Voucher not found" });
        }

        // Verify this is a Consumption, Production, or Mixed voucher
        if (
          existingVoucher.voucherType !== "Consumption" &&
          existingVoucher.voucherType !== "Production" &&
          existingVoucher.voucherType !== "Mixed"
        ) {
          return res
            .status(400)
            .json({
              message:
                "This endpoint only updates Consumption, Production, or Mixed vouchers",
            });
        }

        // Verify voucher belongs to current company
        if (existingVoucher.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Voucher belongs to a different company",
            });
        }

        // Check edit permissions
        const userRole = req.session.currentRole;
        if (!userRole) {
          return res.status(403).json({ message: "User role not found" });
        }

        if (userRole !== "Admin" && userRole !== "Owner" && userRole !== "Developer") {
          if (userRole === "Manager") {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const voucherDate = new Date(existingVoucher.voucherDate);
            voucherDate.setHours(0, 0, 0, 0);

            if (voucherDate.getTime() !== today.getTime()) {
              return res
                .status(403)
                .json({ message: "Managers can only edit today's vouchers" });
            }
          } else {
            return res
              .status(403)
              .json({ message: "Insufficient permissions to edit vouchers" });
          }
        }

        // Find or create the associated adjustment voucher
        let adjustmentVoucher = await db
          .select()
          .from(stockAdjustmentVouchers)
          .where(eq(stockAdjustmentVouchers.voucherId, id))
          .limit(1)
          .then((rows) => rows[0]);

        // Snapshot old adjustment items before creating/replacing (empty if just created)
        const _oldAdjItems = adjustmentVoucher
          ? await db.select().from(stockAdjustmentItems)
              .where(eq(stockAdjustmentItems.adjustmentId, adjustmentVoucher.id))
          : [];

        // If no adjustment voucher exists, create one
        if (!adjustmentVoucher) {
          let adjustmentType = "production";
          if (existingVoucher.voucherType === "Consumption")
            adjustmentType = "consumption";
          else if (existingVoucher.voucherType === "Mixed")
            adjustmentType = "mixed";

          const [newAdjustment] = await db
            .insert(stockAdjustmentVouchers)
            .values({
              voucherId: id,
              locationId: parseInt(locationId),
              adjustmentType: adjustmentType,
              notes: description || "",
            })
            .returning();
          adjustmentVoucher = newAdjustment;
        }

        // Calculate totals and prepare items data
        // For Mixed: net totalAmount = production (positive qty) - consumption (negative qty)
        // For Production/Consumption only: use absolute value
        let signedTotal = 0;

        const adjustmentItemsData = items.map((item: any) => {
          const quantity = parseFloat(item.quantity);
          const rate = parseFloat(item.rate);
          const absItemTotal = Math.abs(quantity) * rate;  // always positive (consistent with createStockAdjustment)
          signedTotal += quantity * rate;  // signed: negative for consumption items

          return {
            adjustmentId: adjustmentVoucher.id,
            stockItemId: item.stockItemId,
            quantity: item.quantity,
            rate: item.rate,
            totalAmount: absItemTotal.toFixed(2),
          };
        });

        // Voucher totalAmount: net for Mixed, absolute for Production/Consumption
        const totalAmount = existingVoucher.voucherType === "Mixed"
          ? signedTotal
          : Math.abs(signedTotal);

        // Wrap all inventory mutations + related writes in a transaction
        const updated = await db.transaction(async (tx) => {
          // STEP 1: Reverse inventory for old adjustment items before deleting
          const oldAdjustmentItems = await tx
            .select()
            .from(stockAdjustmentItems)
            .where(eq(stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));

          const oldLocationId = adjustmentVoucher.locationId;

          for (const oldItem of oldAdjustmentItems) {
            const quantity = parseFloat(oldItem.quantity);
            const rate = parseFloat(oldItem.rate);

            await adjustInventory(tx, oldLocationId, oldItem.stockItemId, -quantity, existingVoucher.companyId);
          }

          // STEP 2: Delete existing adjustment items
          await tx
            .delete(stockAdjustmentItems)
            .where(eq(stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));

          // STEP 3: Apply inventory for new adjustment items
          const newLocationId = parseInt(locationId);

          for (const newItem of adjustmentItemsData) {
            const quantity = parseFloat(newItem.quantity);
            const rate = parseFloat(newItem.rate);

            await adjustInventory(tx, newLocationId, newItem.stockItemId, quantity, existingVoucher.companyId, rate);
          }

          // STEP 4: Insert new adjustment items
          await tx.insert(stockAdjustmentItems).values(adjustmentItemsData);

          // Update the adjustment voucher
          await tx
            .update(stockAdjustmentVouchers)
            .set({ locationId: parseInt(locationId), notes: description || "" })
            .where(eq(stockAdjustmentVouchers.id, adjustmentVoucher.id));

          // Update the main voucher
          const parsedLocationId = parseInt(locationId);
          const voucherUpdates: any = {
            totalAmount: totalAmount.toFixed(2),
            locationId: parsedLocationId,
          };
          const location = await storage.getLocationById(parsedLocationId);
          if (location) {
            voucherUpdates.locationName = location.name;
          }
          if (voucherDate !== undefined) voucherUpdates.voucherDate = voucherDate;
          if (description !== undefined) voucherUpdates.description = description;

          const [updatedVoucher] = await tx
            .update(vouchers)
            .set(voucherUpdates)
            .where(eq(vouchers.id, id))
            .returning();

          return updatedVoucher;
        });

        try {
          const _adjChanges: Record<string, any> = {};
          if (existingVoucher.voucherDate !== updated.voucherDate)
            _adjChanges.date = { old: existingVoucher.voucherDate, new: updated.voucherDate };
          if (existingVoucher.totalAmount !== updated.totalAmount)
            _adjChanges.totalAmount = { old: existingVoucher.totalAmount, new: updated.totalAmount };
          if (existingVoucher.locationId !== updated.locationId)
            _adjChanges.location = { old: existingVoucher.locationId, new: updated.locationId };
          if ((existingVoucher.description ?? "") !== (updated.description ?? ""))
            _adjChanges.description = { old: existingVoucher.description ?? "", new: updated.description ?? "" };
          const _resolveAdjName = async (id: number) =>
            (await storage.getStockItemById(id))?.name ?? `Item #${id}`;
          const _adjItemDiff = await buildItemLevelChanges(
            _oldAdjItems.map(it => ({
              stockItemId: it.stockItemId,
              quantity: it.quantity,
              rate: it.rate,
              totalAmount: it.totalAmount,
            })),
            adjustmentItemsData.map(it => ({
              stockItemId: it.stockItemId,
              quantity: it.quantity,
              rate: it.rate,
              totalAmount: it.totalAmount,
            })),
            _resolveAdjName
          );
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || "unknown",
            companyId: req.session.currentCompanyId!,
            action: "update",
            tableName: "vouchers",
            recordId: updated.id,
            recordIdentifier: updated.voucherNumber,
            changes: { ..._adjChanges, ..._adjItemDiff },
          });
        } catch { /* non-fatal */ }
        res.json(updated);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Update a stock transfer voucher with line items
}
