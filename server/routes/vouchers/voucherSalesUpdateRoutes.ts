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

export function registerVoucherSalesUpdateRoutes(app: Express) {
  app.patch(
    "/api/vouchers/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid voucher ID" });
        }

        // Get the existing voucher to check company and permissions
        const existingVoucher = await storage.getVoucherById(id);
        if (!existingVoucher) {
          return res.status(404).json({ message: "Voucher not found" });
        }

        // Verify voucher belongs to current company (respect factory mode company)
        const effectiveCompanyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
        if (existingVoucher.companyId !== effectiveCompanyId) {
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
            const voucherDate = new Date(existingVoucher.voucherDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
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

        // Get old entries before updating (for balance sync)
        const oldEntries = await storage.getVoucherEntriesByVoucher(id);
        const wasOptional = existingVoucher.optional;

        // Update voucher and entries in a transaction
        await db.transaction(async (tx) => {
          // Update voucher header
          const voucherUpdates: Partial<any> = {};
          if (req.body.voucherDate !== undefined)
            voucherUpdates.voucherDate = req.body.voucherDate;
          if (req.body.description !== undefined)
            voucherUpdates.description = req.body.description;
          if (req.body.optional !== undefined)
            voucherUpdates.optional = req.body.optional;

          // Handle inventory changes when toggling optional status
          if (req.body.optional !== undefined && existingVoucher.optional !== req.body.optional) {
            const wasOptional = existingVoucher.optional;
            const willBeOptional = req.body.optional;

            // Check if there are stock operations linked to this voucher
            const hasStockTransfer = await tx
              .select()
              .from(stockTransferVouchers)
              .where(eq(stockTransferVouchers.voucherId, id))
              .limit(1);
            
            const hasStockAdjustment = await tx
              .select()
              .from(stockAdjustmentVouchers)
              .where(eq(stockAdjustmentVouchers.voucherId, id))
              .limit(1);

            if (hasStockTransfer.length > 0) {
              const transfer = hasStockTransfer[0];
              const items = await tx
                .select()
                .from(stockTransferItems)
                .where(eq(stockTransferItems.transferId, transfer.id));

              for (const item of items) {
                const sourceLocId = item.sourceLocationId ?? transfer.sourceLocationId;
                const quantity = parseFloat(item.quantity);
                const rate = parseFloat(item.rate);

                // Guard on inventoryApplied: only reverse if inventory was actually applied,
                // only apply if inventory was not already applied. This prevents stock
                // corruption for legacy transfers (inventoryApplied=false on non-optional)
                // and for any edge case where the flag is out of sync with the optional flag.
                if (willBeOptional && transfer.inventoryApplied) {
                  // Reverse: inventory was applied, now marking optional → undo it
                  await adjustInventory(tx, sourceLocId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                  await adjustInventory(tx, transfer.destinationLocationId, item.stockItemId, -quantity, existingVoucher.companyId);
                } else if (!willBeOptional && !transfer.inventoryApplied) {
                  // Apply: inventory was not applied, now marking non-optional → apply it
                  await adjustInventory(tx, sourceLocId, item.stockItemId, -quantity, existingVoucher.companyId);
                  await adjustInventory(tx, transfer.destinationLocationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                }
                // else: inventory state already matches target state — no-op (prevents double moves)
              }

              // CRITICAL: sync inventoryApplied so that a subsequent PUT /api/stock-transfers/:id
              // call (e.g. from StockTransferOrder edit) does not double-apply or double-reverse
              // inventory. This mirrors the same update in PATCH /api/vouchers/:id/optional.
              await tx
                .update(stockTransferVouchers)
                .set({ inventoryApplied: !willBeOptional })
                .where(eq(stockTransferVouchers.id, transfer.id));
            }

            if (hasStockAdjustment.length > 0) {
              const adjustment = hasStockAdjustment[0];
              const items = await tx
                .select()
                .from(stockAdjustmentItems)
                .where(eq(stockAdjustmentItems.adjustmentId, adjustment.id));

              for (const item of items) {
                const rawQuantity = parseFloat(item.quantity);
                const quantity = Math.abs(rawQuantity);
                const rate = parseFloat(item.rate);
                
                // For Mixed adjustments, check the item's quantity sign:
                //   - Positive quantity = production (added)
                //   - Negative quantity = consumption (subtracted)
                const adjustmentType = adjustment.adjustmentType;
                const isProduction = adjustmentType === "Production" || 
                  (adjustmentType === "Mixed" && rawQuantity > 0);

                if (willBeOptional) {
                  // Reversing the adjustment
                  if (isProduction) {
                    // Reverse production: subtract what was added
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
                  } else {
                    // Reverse consumption: add back what was subtracted
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                  }
                } else {
                  // Applying the adjustment
                  if (isProduction) {
                    // Apply production: add to inventory
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                  } else {
                    // Apply consumption: subtract from inventory
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
                  }
                }
              }
            }

            // Handle Sales items inventory when toggling optional
            const hasSalesItems = await tx
              .select()
              .from(salesItems)
              .where(eq(salesItems.voucherId, id));

            if (hasSalesItems.length > 0 && existingVoucher.locationId) {
              for (const item of hasSalesItems) {
                const quantity = parseFloat(item.quantity);
                const costPrice = parseFloat(item.costPrice);
                if (willBeOptional) {
                  // Reverse: add back stock that was deducted by the sale
                  await adjustInventory(tx, existingVoucher.locationId, item.stockItemId, quantity, existingVoucher.companyId, costPrice);
                } else {
                  // Apply: deduct stock for the sale
                  await adjustInventory(tx, existingVoucher.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
                }
              }
            }

            // Handle Credit Note items inventory when toggling optional
            const hasCreditNoteItems = await tx
              .select()
              .from(creditNoteItems)
              .where(eq(creditNoteItems.voucherId, id));

            if (hasCreditNoteItems.length > 0) {
              for (const item of hasCreditNoteItems) {
                const quantity = parseFloat(item.quantity);
                const rate = parseFloat(item.rate);
                if (willBeOptional) {
                  // Reverse: remove stock that was added by the credit note (customer return)
                  await adjustInventory(tx, item.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
                } else {
                  // Apply: add stock back for the credit note (customer return)
                  await adjustInventory(tx, item.locationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                }
              }
            }
          }

          await tx
            .update(vouchers)
            .set(voucherUpdates)
            .where(eq(vouchers.id, id));

          // Delete all existing entries
          await tx
            .delete(voucherEntries)
            .where(eq(voucherEntries.voucherId, id));

          // Insert new entries if provided
          if (req.body.entries && Array.isArray(req.body.entries)) {
            for (const entry of req.body.entries) {
              await tx.insert(voucherEntries).values({
                voucherId: id,
                ledgerAccountId: entry.ledgerAccountId || null,
                bankAccountId: entry.bankAccountId || null,
                supplierId: entry.supplierId || null,
                employeeId: entry.employeeId || null,
                fixedAssetId: entry.fixedAssetId || null,
                debitAmount: entry.debitAmount || "0",
                creditAmount: entry.creditAmount || "0",
                narration: entry.narration || "",
              });
            }
          }
        });

        // Fetch updated voucher with entries
        const updated = await storage.getVoucherById(id);
        const newEntries = await storage.getVoucherEntriesByVoucher(id);

        // Sync employee balances: reverse old entries if voucher was non-optional
        if (!wasOptional && req.session.currentCompanyId) {
          await syncEmployeeBalancesFromEntries(
            oldEntries.map(e => ({
              ledgerAccountId: e.ledgerAccountId,
              employeeId: e.employeeId,
              debitAmount: e.debitAmount,
              creditAmount: e.creditAmount,
            })),
            req.session.currentCompanyId,
            true // reverse
          );
        }

        // Apply new entries if voucher is now non-optional
        const isNowOptional = req.body.optional !== undefined ? req.body.optional : wasOptional;
        if (!isNowOptional && req.session.currentCompanyId) {
          await syncEmployeeBalancesFromEntries(
            newEntries.map(e => ({
              ledgerAccountId: e.ledgerAccountId,
              employeeId: e.employeeId,
              debitAmount: e.debitAmount,
              creditAmount: e.creditAmount,
            })),
            req.session.currentCompanyId
          );
        }

        try {
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || "unknown",
            companyId: req.session.currentCompanyId!,
            action: "update",
            tableName: "vouchers",
            recordId: updated.id,
            recordIdentifier: updated.voucherNumber,
            changes: buildVoucherChangesForUpdate(existingVoucher, updated, oldEntries, newEntries),
          });
        } catch { /* non-fatal */ }
        res.json({ ...updated, entries: newEntries });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Custom error class for validation errors
  class ValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ValidationError';
    }
  }

  // Toggle optional status for a voucher
  app.patch(
    "/api/vouchers/:id/optional",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid voucher ID" });
        }

        const { optional } = req.body;
        if (typeof optional !== "boolean") {
          return res
            .status(400)
            .json({ message: "Optional must be a boolean value" });
        }

        // Get the existing voucher to check company and permissions
        const existingVoucher = await storage.getVoucherById(id);
        if (!existingVoucher) {
          return res.status(404).json({ message: "Voucher not found" });
        }

        // Verify voucher belongs to current company
        if (existingVoucher.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Voucher belongs to a different company",
            });
        }

        // Only Admin and Owner can toggle optional status
        const userRole = req.session.currentRole;
        if (userRole !== "Admin" && userRole !== "Owner" && userRole !== "Developer") {
          return res
            .status(403)
            .json({
              message: "Only Admin and Owner can toggle optional status",
            });
        }

        const wasOptional = existingVoucher.optional;
        const willBeOptional = optional;

        // Wrap entire optional toggle in a transaction
        await db.transaction(async (tx) => {
          // Check if there are stock operations linked to this voucher
          const hasStockTransfer = await tx
            .select()
            .from(stockTransferVouchers)
            .where(eq(stockTransferVouchers.voucherId, id))
            .limit(1);
          
          const hasStockAdjustment = await tx
            .select()
            .from(stockAdjustmentVouchers)
            .where(eq(stockAdjustmentVouchers.voucherId, id))
            .limit(1);

          // Handle inventory changes when toggling optional status
          // If changing from false→true: reverse inventory changes
          // If changing from true→false: apply inventory changes
          if (wasOptional !== willBeOptional) {
          if (hasStockTransfer.length > 0) {
            const transfer = hasStockTransfer[0];
            const items = await tx
              .select()
              .from(stockTransferItems)
              .where(eq(stockTransferItems.transferId, transfer.id));

              for (const item of items) {
                const sourceLocId = item.sourceLocationId ?? transfer.sourceLocationId;
                const quantity = parseFloat(item.quantity);
                const rate = parseFloat(item.rate);

                // Guard on inventoryApplied: only reverse if inventory was actually applied,
                // only apply if inventory was not already applied. Prevents stock corruption
                // from double-toggling or legacy transfers with mismatched flag states.
                if (willBeOptional && transfer.inventoryApplied) {
                  // Reverse: inventory was applied, now marking optional → undo it
                  await adjustInventory(tx, sourceLocId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                  await adjustInventory(tx, transfer.destinationLocationId, item.stockItemId, -quantity, existingVoucher.companyId);
                } else if (!willBeOptional && !transfer.inventoryApplied) {
                  // Apply: inventory was not applied, now marking non-optional → apply it
                  await adjustInventory(tx, sourceLocId, item.stockItemId, -quantity, existingVoucher.companyId);
                  await adjustInventory(tx, transfer.destinationLocationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                }
                // else: already in the correct applied/unapplied state — no-op
              }

              // CRITICAL: sync inventoryApplied on the transfer record so that
              // a subsequent updateStockTransfer call knows the correct state and
              // does not double-apply or double-reverse inventory.
              await tx
                .update(stockTransferVouchers)
                .set({ inventoryApplied: !willBeOptional })
                .where(eq(stockTransferVouchers.id, transfer.id));
          }

          if (hasStockAdjustment.length > 0) {
            const adjustment = hasStockAdjustment[0];
            const items = await tx
              .select()
              .from(stockAdjustmentItems)
              .where(eq(stockAdjustmentItems.adjustmentId, adjustment.id));

              for (const item of items) {
                const rawQuantity = parseFloat(item.quantity);
                const quantity = Math.abs(rawQuantity);
                const rate = parseFloat(item.rate);
                
                // For Mixed adjustments, check the item's quantity sign:
                //   - Positive quantity = production (added)
                //   - Negative quantity = consumption (subtracted)
                const adjustmentType = adjustment.adjustmentType;
                const isProduction = adjustmentType === "Production" || 
                  (adjustmentType === "Mixed" && rawQuantity > 0);

                if (willBeOptional) {
                  // Reversing the adjustment
                  if (isProduction) {
                    // Reverse production: subtract what was added
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
                  } else {
                    // Reverse consumption: add back what was subtracted
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                  }
                } else {
                  // Applying the adjustment
                  if (isProduction) {
                    // Apply production: add to inventory
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                  } else {
                    // Apply consumption: subtract from inventory
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
                  }
                }
              }
          }

          // Handle Sales items inventory when toggling optional
          const hasSalesItems = await tx
            .select()
            .from(salesItems)
            .where(eq(salesItems.voucherId, id));

          if (hasSalesItems.length > 0 && existingVoucher.locationId) {
            for (const item of hasSalesItems) {
              const quantity = parseFloat(item.quantity);
              const costPrice = parseFloat(item.costPrice);
              if (willBeOptional) {
                // Reverse: add back stock that was deducted by the sale
                await adjustInventory(tx, existingVoucher.locationId, item.stockItemId, quantity, existingVoucher.companyId, costPrice);
              } else {
                // Apply: deduct stock for the sale
                await adjustInventory(tx, existingVoucher.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
              }
            }
          }

          // Handle Credit Note items inventory when toggling optional
          const hasCreditNoteItems = await tx
            .select()
            .from(creditNoteItems)
            .where(eq(creditNoteItems.voucherId, id));

          if (hasCreditNoteItems.length > 0) {
            for (const item of hasCreditNoteItems) {
              const quantity = parseFloat(item.quantity);
              const rate = parseFloat(item.rate);
              if (willBeOptional) {
                // Reverse: remove stock that was added by the credit note (customer return)
                await adjustInventory(tx, item.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
              } else {
                // Apply: add stock back for the credit note (customer return)
                await adjustInventory(tx, item.locationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
              }
            }
          }
          }

          // Update the optional field inside transaction
          await tx
            .update(vouchers)
            .set({ optional })
            .where(eq(vouchers.id, id));
        });
        // Log the optional status change to audit log
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "update",
          tableName: "vouchers",
          recordId: id,
          recordIdentifier: existingVoucher.voucherNumber,
          changes: { optional: { old: wasOptional, new: willBeOptional } },
        });

        // Sync employee balances when optional status changes
        if (wasOptional !== willBeOptional && req.session.currentCompanyId) {
          const entries = await storage.getVoucherEntriesByVoucher(id);
          if (willBeOptional) {
            // Voucher is becoming optional - reverse entries' effects
            await syncEmployeeBalancesFromEntries(
              entries.map(e => ({
                ledgerAccountId: e.ledgerAccountId,
                employeeId: e.employeeId,
                debitAmount: e.debitAmount,
                creditAmount: e.creditAmount,
              })),
              req.session.currentCompanyId,
              true // reverse
            );
          } else {
            // Voucher is becoming active - apply entries' effects
            await syncEmployeeBalancesFromEntries(
              entries.map(e => ({
                ledgerAccountId: e.ledgerAccountId,
                employeeId: e.employeeId,
                debitAmount: e.debitAmount,
                creditAmount: e.creditAmount,
              })),
              req.session.currentCompanyId
            );
          }
        }

        // Fetch updated voucher outside transaction
        const updated = await storage.getVoucherById(id);
        res.json(updated);
      } catch (error: any) {
        if (error.name === 'ValidationError') {
          return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Update a sales voucher with line items
  app.patch("/api/vouchers/:id/sales", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const {
        voucherDate,
        description,
        locationId,
        items,
        paymentAccountType,
        paymentAccountId,
        isCreditSale,
      } = req.body;

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

      // Verify this is a Sales voucher
      if (existingVoucher.voucherType !== "Sales") {
        return res
          .status(400)
          .json({ message: "This endpoint only updates Sales vouchers" });
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
          // POS users can edit if they have daybookEditDays permission > 0
          const daybookEditDays = req.session.daybookEditDays || 0;
          if (daybookEditDays <= 0) {
            return res
              .status(403)
              .json({ message: "Insufficient permissions to edit vouchers" });
          }
          // Check if voucher date is within allowed days
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const voucherDate = new Date(existingVoucher.voucherDate);
          voucherDate.setHours(0, 0, 0, 0);

          const daysDiff = Math.floor((today.getTime() - voucherDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff >= daybookEditDays) {
            return res
              .status(403)
              .json({ message: `You can only edit vouchers from the last ${daybookEditDays} day(s)` });
          }
        }
      }

      // Validate and authorize location if provided
      let validatedLocationId: number | null = null;
      if (locationId !== undefined && locationId !== null) {
        const parsedLocationId = parseInt(locationId);
        if (isNaN(parsedLocationId) || parsedLocationId <= 0) {
          return res.status(400).json({ message: "Invalid location ID" });
        }

        // Verify location belongs to current company
        const [targetLocation] = await db
          .select()
          .from(locations)
          .where(eq(locations.id, parsedLocationId));

        if (!targetLocation) {
          return res.status(404).json({ message: "Location not found" });
        }

        if (targetLocation.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Location belongs to a different company",
            });
        }

        validatedLocationId = parsedLocationId;
      }

      // Fetch stock items to calculate cost prices
      const stockItemIds = items.map((item) => item.stockItemId);
      const stockItemsData = await db
        .select()
        .from(stockItems)
        .where(inArray(stockItems.id, stockItemIds));

      const stockItemsMap = new Map(
        stockItemsData.map((item) => [item.id, item]),
      );

      // Calculate totals and prepare items data
      let totalSalesAmount = 0;
      const salesItemsData = items.map((item: any) => {
        const stockItem = stockItemsMap.get(item.stockItemId);
        if (!stockItem) {
          throw new Error(`Stock item ${item.stockItemId} not found`);
        }

        const quantity = parseFloat(item.quantity);
        const sellingPrice = parseFloat(item.sellingPrice);
        const costPrice = parseFloat(stockItem.openingRate || "0");

        const totalSales = quantity * sellingPrice;
        const totalCost = quantity * costPrice;
        const profit = totalSales - totalCost;

        totalSalesAmount += totalSales;

        return {
          voucherId: id,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          sellingPrice: item.sellingPrice,
          costPrice: costPrice.toFixed(2),
          totalSales: totalSales.toFixed(2),
          totalCost: totalCost.toFixed(2),
          profit: profit.toFixed(2),
        };
      });

      // STEPS 1-4: Reverse old inventory, delete old items, deduct new inventory, insert new items - all atomically
      const oldSalesItems = await db
        .select()
        .from(salesItems)
        .where(eq(salesItems.voucherId, id));

      const targetLocationId =
        validatedLocationId !== null
          ? validatedLocationId
          : existingVoucher.locationId;

      await db.transaction(async (tx) => {
        // STEP 1: Reverse inventory for old sales items
        if (existingVoucher.locationId) {
          for (const oldItem of oldSalesItems) {
            const quantity = parseFloat(oldItem.quantity);
            const costPrice = parseFloat(oldItem.costPrice);
            await adjustInventory(tx, existingVoucher.locationId, oldItem.stockItemId, quantity, existingVoucher.companyId, costPrice);
          }
        }

        // STEP 2: Delete existing sales items
        await tx.delete(salesItems).where(eq(salesItems.voucherId, id));

        // STEP 3: Deduct inventory for new sales items from the new location
        if (targetLocationId) {
          const updatedSalesItemsData: typeof salesItemsData = [];
          
          for (const newItem of salesItemsData) {
            const quantity = parseFloat(newItem.quantity);

            // Get current average rate before deducting to use as cost price
            const invResult = await adjustInventory(tx, targetLocationId, newItem.stockItemId, -quantity, existingVoucher.companyId);
            const actualCostPrice = invResult.averageRate || parseFloat(newItem.costPrice);
            
            const sellingPrice = parseFloat(newItem.sellingPrice);
            const totalSales = quantity * sellingPrice;
            const totalCost = quantity * actualCostPrice;
            const profit = totalSales - totalCost;

            // Look up configured price for this location
            const [patchLocPrice] = await tx
              .select()
              .from(stockItemLocationPrices)
              .where(
                and(
                  eq(stockItemLocationPrices.stockItemId, newItem.stockItemId),
                  eq(stockItemLocationPrices.locationId, targetLocationId)
                )
              )
              .limit(1);
            const patchConfiguredPriceNum = parseFloat(patchLocPrice?.sellingPrice || "0");

            updatedSalesItemsData.push({
              ...newItem,
              costPrice: actualCostPrice.toFixed(2),
              totalCost: totalCost.toFixed(2),
              profit: profit.toFixed(2),
              configuredPrice: patchConfiguredPriceNum > 0 ? patchConfiguredPriceNum.toFixed(6) : null,
            });
          }
          
          salesItemsData.length = 0;
          salesItemsData.push(...updatedSalesItemsData);
        } else {
          // No targetLocationId — still try to add configuredPrice if we know it
          for (const newItem of salesItemsData) {
            (newItem as any).configuredPrice = null;
          }
        }

        // STEP 4: Insert new sales items
        await tx.insert(salesItems).values(salesItemsData);
      });

      // STEP 5: Update voucher entries (accounting transactions)
      // NOTE: POS Sales vouchers in this system are ALWAYS 2-entry transactions:
      //   1. Debit: Cash/Bank/Customer Account (payment account)
      //   2. Credit: Sales Revenue Account
      // This is confirmed by the POST /api/pos/sales endpoint (lines ~5420-5446) which creates exactly 2 entries.
      // No taxes, COGS, or other entries exist for POS sales in the current implementation.
      // If payment info is not provided, derive it from existing entries
      let finalPaymentAccountId = paymentAccountId;
      let finalPaymentAccountType = paymentAccountType;
      let finalIsCreditSale = isCreditSale;
      let finalCreditCustomerName = ""; // captured when credit-sale customer account is found

      if (!finalPaymentAccountId || !finalPaymentAccountType) {
        // Fetch existing voucher entries to derive payment account
        const existingEntries = await db
          .select()
          .from(voucherEntries)
          .where(eq(voucherEntries.voucherId, id));

        // Find the debit entry that represents the payment account
        // Priority: bank account > cash ledger > other ledger (customer/receivable)
        const debitEntries = existingEntries.filter(
          (entry) => parseFloat(entry.debitAmount || "0") > 0,
        );

        // Check for bank account first
        let existingDebitEntry = debitEntries.find(
          (entry) => entry.bankAccountId !== null,
        );
        if (existingDebitEntry) {
          finalPaymentAccountId = String(existingDebitEntry.bankAccountId);
          finalPaymentAccountType = "bank";
          finalIsCreditSale = false;
        } else {
          // Check for ledger accounts - need to fetch ledger details to identify type
          for (const entry of debitEntries) {
            if (entry.ledgerAccountId) {
              const [ledgerAccount] = await db
                .select()
                .from(ledgerAccounts)
                .where(eq(ledgerAccounts.id, entry.ledgerAccountId))
                .limit(1);

              if (ledgerAccount) {
                if (ledgerAccount.accountType === "Cash") {
                  // Found cash account
                  finalPaymentAccountId = String(entry.ledgerAccountId);
                  finalPaymentAccountType = "cash";
                  finalIsCreditSale = false;
                  existingDebitEntry = entry;
                  break;
                } else if (
                  ledgerAccount.accountType === "Asset" ||
                  entry.narration?.includes("Credit Sale") ||
                  entry.narration?.startsWith("POS - ")
                ) {
                  // Found customer receivable account (credit sale)
                  finalPaymentAccountId = String(entry.ledgerAccountId);
                  finalPaymentAccountType = "credit";
                  finalIsCreditSale = true;
                  finalCreditCustomerName = ledgerAccount.name; // save for narration
                  existingDebitEntry = entry;
                  break;
                }
              }
            }
          }
        }
      }

      // Only proceed if we have payment account information
      if (finalPaymentAccountId && finalPaymentAccountType) {
        // EARLY VALIDATION: Check Sales account type BEFORE any destructive operations
        const allAccountsForValidation = await storage.getAllLedgerAccounts(existingVoucher.companyId);
        let salesAccountCheck = allAccountsForValidation.find((a: any) => a.code === "SALES");
        
        if (salesAccountCheck && salesAccountCheck.accountType !== "Income") {
          return res.status(400).json({
            message: `The SALES account is configured with type "${salesAccountCheck.accountType}" but must be type "Income" for POS sales to work correctly.`,
          });
        }
        
        // Delete old voucher entries
        await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, id));

        const accountId = parseInt(finalPaymentAccountId);
        const accountType = finalPaymentAccountType;

        // If credit sale customer name wasn't captured during detection (came from request body),
        // look it up now so we can build the correct narration
        if (finalIsCreditSale && !finalCreditCustomerName && accountType === "credit") {
          const [customerLedger] = await db
            .select({ name: ledgerAccounts.name })
            .from(ledgerAccounts)
            .where(eq(ledgerAccounts.id, accountId))
            .limit(1);
          if (customerLedger) finalCreditCustomerName = customerLedger.name;
        }

        // Debit: Cash/Bank/Customer Account (Asset increases)
        const debitEntry: any = {
          voucherId: id,
          debitAmount: totalSalesAmount.toFixed(2),
          creditAmount: "0",
          narration: finalIsCreditSale
            ? `POS - ${finalCreditCustomerName} - ${existingVoucher.locationName || ""}`
            : `POS Sale - ${existingVoucher.voucherNumber}`,
        };

        if (
          finalIsCreditSale ||
          accountType === "cash" ||
          accountType === "credit"
        ) {
          // For credit sales and cash accounts, use ledgerAccountId
          debitEntry.ledgerAccountId = accountId;
        } else {
          // For bank accounts, use bankAccountId
          debitEntry.bankAccountId = accountId;
        }

        await db.insert(voucherEntries).values(debitEntry);

        // Credit: Sales Account (Revenue increases)
        // Get or create SALES revenue account for this company
        const allAccounts = await storage.getAllLedgerAccounts(existingVoucher.companyId);
        let salesAccount = allAccounts.find((a: any) => a.code === "SALES");

        if (!salesAccount) {
          salesAccount = await storage.createLedgerAccount({
            companyId: existingVoucher.companyId,
            code: "SALES",
            name: "Sales Revenue",
            accountType: "Income",
            openingBalance: "0",
            active: true,
          });
        }

        await db.insert(voucherEntries).values({
          voucherId: id,
          ledgerAccountId: salesAccount.id,
          debitAmount: "0",
          creditAmount: totalSalesAmount.toFixed(2),
          narration: finalIsCreditSale
            ? `POS - ${finalCreditCustomerName} - ${existingVoucher.locationName || ""}`
            : `POS Sale - ${existingVoucher.voucherNumber}`,
        });
      } else {
        throw new Error(
          "Unable to determine payment account for voucher update",
        );
      }

      // Update the voucher
      const voucherUpdates: any = {
        totalAmount: totalSalesAmount.toFixed(2),
      };
      if (voucherDate !== undefined) voucherUpdates.voucherDate = voucherDate;
      if (description !== undefined) voucherUpdates.description = description;
      if (validatedLocationId !== null) {
        voucherUpdates.locationId = validatedLocationId;
        // Also save the location name for when the location is later deleted
        const location = await storage.getLocationById(validatedLocationId);
        if (location) {
          voucherUpdates.locationName = location.name;
        }
      }

      const updated = await db
        .update(vouchers)
        .set(voucherUpdates)
        .where(eq(vouchers.id, id))
        .returning();

      res.json(updated[0]);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update a purchase voucher with line items
}
