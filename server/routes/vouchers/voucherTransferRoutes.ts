import type { Express } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../../auth";
import { requireActionAccess } from "../../lib/permissionMiddleware";
import {
  upload,
  logAudit,
  getCurrentExchangeRate,
  calculateHistoricalLocationInventory,
  syncEmployeeBalancesFromEntries,
  snapshotVoucherEntries,
  buildVoucherChangesForCreate,
  buildVoucherChangesForUpdate,
  buildItemLevelChanges,
} from "../_helpers";
import { triggerIntercompanyNotifications } from "../intercompanyNotificationRoutes";
import { autoReallocateLoansAccounts } from "../../lib/transporterAllocation";
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
  insertVoucherSchema,
  insertVoucherEntrySchema,
  insertSalesItemSchema,
  suppliers,
  customers,
  customerBalances,
  locations,
  employees,
  userLocations,
  auditLog,
  interCompanyTransfers,
  insertInterCompanyTransferSchema,
  ledgerAccounts,
  insertLedgerAccountSchema,
  companies,
  users,
  userCompanyRoles,
  companySettings,
  FEATURE_KEYS,
  fiscalPeriodClosures,
  wasteDispatches,
  wasteDispatchItems,
  insertWasteDispatchSchema,
  bales,
  baleProducts,
  baleProductCategories,
  baleTransfers,
  insertBaleSchema,
  insertBaleTransferSchema,
  dashboardCashAccounts,
  dashboardPayableAccounts,
  dashboardAccountSelections,
  insertDashboardCashAccountSchema,
  insertDashboardPayableAccountSchema,
  insertDashboardAccountSelectionSchema,
  creditNoteItems,
  pendingBarcodes,
  insertPendingBarcodeSchema,
  storedFiles,
  spreadsheets,
  liveSpreadsheets,
  agentAccounts,
  insertAgentAccountSchema,
  salaryAdvances,
  salaryAdvanceDeductions,
  insertSalaryAdvanceSchema,
  insertSalaryAdvanceDeductionSchema,
  chatMessages,
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
import { checkAccountWhatsAppRule } from "../factoryWhatsappRoutes";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../../netPositionHelper";
import path from "path";
import fs from "fs";

import { registerVoucherEntryRoutes } from "../voucherEntryRoutes";
import { recalculateOrderTotals } from "../factory/_helpers";
import {
  customerOrderCharges,
  customerOrders,
  customerOrderBales,
  customerOrderLines,
  factorySettings as fSettings,
  factoryDaybookEntries as fde,
} from "@shared/schema";

/**
 * After saving a journal voucher, if it has a customer entry + a ledger account entry,
 * look for order charges linked to that ledger account for that customer.
 * If exactly one charge is found, update its amount and recalculate the order totals.
 */

export function registerVoucherTransferRoutes(app: Express) {
  app.patch("/api/vouchers/:id/transfer", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const { voucherDate, description, sourceLocationId, destinationLocationId, items } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      if (!sourceLocationId || !destinationLocationId) {
        return res.status(400).json({ message: "Source and destination locations are required" });
      }

      // Get the existing voucher to check company and permissions
      const existingVoucher = await storage.getVoucherById(id);
      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Verify this is a Stock Transfer voucher
      if (existingVoucher.voucherType !== "Stock Transfer") {
        return res.status(400).json({
          message: "This endpoint only updates Stock Transfer vouchers",
        });
      }

      // Verify voucher belongs to current company
      if (existingVoucher.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({
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
            return res.status(403).json({ message: "Managers can only edit today's vouchers" });
          }
        } else {
          return res.status(403).json({ message: "Insufficient permissions to edit vouchers" });
        }
      }

      console.log(`[Stock Transfer Edit] Starting update for voucher ${id}`);

      // Snapshot old transfer items before the transaction mutates them
      const _preTransfer = await db
        .select()
        .from(stockTransferVouchers)
        .where(eq(stockTransferVouchers.voucherId, id))
        .limit(1)
        .then((rows) => rows[0]);
      const _oldXfrItems = _preTransfer
        ? await db.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, _preTransfer.id))
        : [];

      // Wrap the entire operation in a transaction for atomicity
      const updated = await db.transaction(async (tx) => {
        // Find or create the associated transfer voucher
        let transferVoucher = await tx
          .select()
          .from(stockTransferVouchers)
          .where(eq(stockTransferVouchers.voucherId, id))
          .limit(1)
          .then((rows) => rows[0]);

        // If no transfer voucher exists, create one
        if (!transferVoucher) {
          const [newTransfer] = await tx
            .insert(stockTransferVouchers)
            .values({
              voucherId: id,
              sourceLocationId: parseInt(sourceLocationId),
              destinationLocationId: parseInt(destinationLocationId),
              notes: description || "",
            })
            .returning();
          transferVoucher = newTransfer;
        }

        // Calculate totals and prepare items data
        let totalAmount = 0;

        const transferItemsData = items.map((item: any) => {
          const quantity = parseFloat(item.quantity);
          const rate = parseFloat(item.rate);
          const itemTotal = quantity * rate;

          totalAmount += itemTotal;

          return {
            transferId: transferVoucher.id,
            stockItemId: item.stockItemId,
            quantity: item.quantity,
            rate: item.rate,
            totalAmount: itemTotal.toFixed(2),
            sourceLocationId: parseInt(sourceLocationId),
          };
        });

        // STEP 1: Reverse inventory for old transfer items before deleting
        const oldTransferItems = await tx
          .select()
          .from(stockTransferItems)
          .where(eq(stockTransferItems.transferId, transferVoucher.id));

        const oldSourceLocationId = transferVoucher.sourceLocationId;
        const oldDestinationLocationId = transferVoucher.destinationLocationId;

        for (const oldItem of oldTransferItems) {
          const quantity = parseFloat(oldItem.quantity);
          const rate = parseFloat(oldItem.rate);

          // Add back to source location (reverse the subtraction)
          await adjustInventory(
            tx,
            oldSourceLocationId,
            oldItem.stockItemId,
            quantity,
            existingVoucher.companyId!,
            rate
          );

          // Subtract from destination location (reverse the addition)
          await adjustInventory(
            tx,
            oldDestinationLocationId,
            oldItem.stockItemId,
            -quantity,
            existingVoucher.companyId!
          );
        }

        // STEP 2: Delete existing transfer items
        await tx.delete(stockTransferItems).where(eq(stockTransferItems.transferId, transferVoucher.id));

        // STEP 3: Apply inventory for new transfer items
        const newSourceLocationId = parseInt(sourceLocationId);
        const newDestinationLocationId = parseInt(destinationLocationId);

        for (const newItem of transferItemsData) {
          const quantity = parseFloat(newItem.quantity);
          const rate = parseFloat(newItem.rate);

          // Subtract from new source location
          await adjustInventory(tx, newSourceLocationId, newItem.stockItemId, -quantity, existingVoucher.companyId);

          // Add to new destination location
          await adjustInventory(
            tx,
            newDestinationLocationId,
            newItem.stockItemId,
            quantity,
            existingVoucher.companyId,
            rate
          );
        }

        // STEP 4: Insert new transfer items
        await tx.insert(stockTransferItems).values(transferItemsData);

        // Update the transfer voucher (locations can be changed, but shouldn't affect old inventory)
        await tx
          .update(stockTransferVouchers)
          .set({
            sourceLocationId: parseInt(sourceLocationId),
            destinationLocationId: parseInt(destinationLocationId),
            notes: description || "",
          })
          .where(eq(stockTransferVouchers.id, transferVoucher.id));

        // Update the main voucher
        const parsedSourceLocationId = parseInt(sourceLocationId);
        const voucherUpdates: any = {
          totalAmount: totalAmount.toFixed(2),
          locationId: parsedSourceLocationId, // Use source location as the primary location for the voucher
        };
        // Also save the location name for when the location is later deleted
        const sourceLocation = await storage.getLocationById(parsedSourceLocationId);
        if (sourceLocation) {
          voucherUpdates.locationName = sourceLocation.name;
        }
        if (voucherDate !== undefined) voucherUpdates.voucherDate = voucherDate;
        if (description !== undefined) voucherUpdates.description = description;

        const [updatedVoucher] = await tx.update(vouchers).set(voucherUpdates).where(eq(vouchers.id, id)).returning();

        return updatedVoucher;
      });

      try {
        const _xfrChanges: Record<string, any> = {};
        if (existingVoucher.voucherDate !== updated.voucherDate)
          _xfrChanges.date = { old: existingVoucher.voucherDate, new: updated.voucherDate };
        if (existingVoucher.totalAmount !== updated.totalAmount)
          _xfrChanges.totalAmount = { old: existingVoucher.totalAmount, new: updated.totalAmount };
        if (_preTransfer && parseInt(sourceLocationId) !== _preTransfer.sourceLocationId)
          _xfrChanges.sourceLocation = { old: _preTransfer.sourceLocationId, new: parseInt(sourceLocationId) };
        if (_preTransfer && parseInt(destinationLocationId) !== _preTransfer.destinationLocationId)
          _xfrChanges.destinationLocation = {
            old: _preTransfer.destinationLocationId,
            new: parseInt(destinationLocationId),
          };
        if ((existingVoucher.description ?? "") !== (updated.description ?? ""))
          _xfrChanges.description = { old: existingVoucher.description ?? "", new: updated.description ?? "" };
        const _resolveXfrName = async (id: number) => (await storage.getStockItemById(id))?.name ?? `Item #${id}`;
        const _xfrItemDiff = await buildItemLevelChanges(
          _oldXfrItems.map((it) => ({
            stockItemId: it.stockItemId,
            quantity: it.quantity,
            rate: it.rate,
            totalAmount: it.totalAmount,
          })),
          transferItemsData.map((it) => ({
            stockItemId: it.stockItemId,
            quantity: it.quantity,
            rate: it.rate,
            totalAmount: it.totalAmount,
          })),
          _resolveXfrName
        );
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "update",
          tableName: "vouchers",
          recordId: updated.id,
          recordIdentifier: updated.voucherNumber,
          changes: { ..._xfrChanges, ..._xfrItemDiff },
        });
      } catch {
        /* non-fatal */
      }
      console.log(`[Stock Transfer Edit] Successfully updated voucher ${id}`);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update a voucher with all entries (completely replace entries)
  app.put("/api/vouchers/:id/with-entries", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const { voucher, entries } = req.body;

      if (!voucher || !entries || !Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ message: "Voucher and entries are required" });
      }

      // Get the existing voucher to check company and permissions
      const existingVoucher = await storage.getVoucherById(id);
      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Verify voucher belongs to current company
      if (existingVoucher.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({
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
            return res.status(403).json({ message: "Managers can only edit today's vouchers" });
          }
        } else {
          // Other roles cannot edit
          return res.status(403).json({ message: "Insufficient permissions to edit vouchers" });
        }
      }

      // Validate that debits equal credits (only for non-optional vouchers)
      const totalDebits = entries.reduce((sum: number, entry: any) => sum + parseFloat(entry.debitAmount || "0"), 0);
      const totalCredits = entries.reduce((sum: number, entry: any) => sum + parseFloat(entry.creditAmount || "0"), 0);

      // For active (non-optional) vouchers, enforce debit=credit balance
      if (!voucher.optional && Math.abs(totalDebits - totalCredits) >= 0.01) {
        return res.status(400).json({
          message: "Total debits must equal total credits for active vouchers",
        });
      }

      // Update voucher with error handling
      let updatedVoucher;
      const createdEntries = [];
      let oldEntries: any[] = [];

      // SALES VOUCHER INVENTORY HANDLING
      // If this is a Sales voucher and location is changing, we need to reverse inventory at old location
      // and apply inventory at new location
      const oldLocationId = existingVoucher.locationId;
      const newLocationId = voucher.locationId !== undefined ? voucher.locationId : oldLocationId;
      const locationChanged = oldLocationId !== newLocationId;

      if (existingVoucher.voucherType === "Sales" && locationChanged) {
        await db.transaction(async (tx) => {
          // Get sales items for this voucher
          const oldSalesItemsList = await tx.select().from(salesItems).where(eq(salesItems.voucherId, id));

          // STEP 1: Reverse inventory at old location (add back the quantities)
          if (oldLocationId && oldSalesItemsList.length > 0) {
            for (const oldItem of oldSalesItemsList) {
              const quantity = parseFloat(oldItem.quantity);
              const costPrice = parseFloat(oldItem.costPrice);

              const result = await adjustInventory(
                tx,
                oldLocationId,
                oldItem.stockItemId,
                quantity,
                existingVoucher.companyId,
                costPrice
              );
              console.log(
                `[Sales Edit] Reversed inventory at old location ${oldLocationId}: ${oldItem.stockItemId} qty +${quantity} (was ${result.previousQuantity}, now ${result.newQuantity})`
              );
            }
          }

          // STEP 2: Deduct inventory at new location
          if (newLocationId && oldSalesItemsList.length > 0) {
            for (const item of oldSalesItemsList) {
              const quantity = parseFloat(item.quantity);

              const result = await adjustInventory(
                tx,
                newLocationId,
                item.stockItemId,
                -quantity,
                existingVoucher.companyId
              );
              console.log(
                `[Sales Edit] Deducted inventory at new location ${newLocationId}: ${item.stockItemId} qty -${quantity} (was ${result.previousQuantity}, now ${result.newQuantity})`
              );
            }
          }
        });
      }

      try {
        // Backup old entries before deleting
        oldEntries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, id));

        // Update voucher metadata
        const voucherUpdates: any = {
          voucherType: voucher.voucherType,
          voucherDate: voucher.voucherDate,
          description: voucher.description !== undefined ? voucher.description || null : existingVoucher.description,
          optional: voucher.optional ?? false,

          totalAmount: Math.max(totalDebits, totalCredits).toFixed(2),
        };
        // If locationId is being updated, also save the location name
        if (voucher.locationId !== undefined) {
          voucherUpdates.locationId = voucher.locationId;
          if (voucher.locationId) {
            const location = await storage.getLocationById(voucher.locationId);
            if (location) {
              voucherUpdates.locationName = location.name;
            }
          } else {
            voucherUpdates.locationName = null;
          }
        }
        [updatedVoucher] = await db.update(vouchers).set(voucherUpdates).where(eq(vouchers.id, id)).returning();

        if (voucher.voucherDate) {
          await db
            .update(fde)
            .set({ txDate: voucher.voucherDate })
            .where(and(eq(fde.referenceTable, "vouchers"), eq(fde.referenceId, id)));
        }

        // Delete all existing entries
        await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, id));

        // Create new entries
        for (const entry of entries) {
          const [createdEntry] = await db
            .insert(voucherEntries)
            .values({
              voucherId: id,
              ledgerAccountId: entry.ledgerAccountId || null,
              bankAccountId: entry.bankAccountId || null,
              fixedAssetId: entry.fixedAssetId || null,
              supplierId: entry.supplierId || null,
              employeeId: entry.employeeId || null,
              factorySupplierId: entry.factorySupplierId || null,
              debitAmount: entry.debitAmount || "0",
              creditAmount: entry.creditAmount || "0",
              narration: entry.narration || null,
            })
            .returning();
          createdEntries.push(createdEntry);
        }

        // Resync factory daybook entry amounts for this voucher
        const newTotal = Math.max(totalDebits, totalCredits).toFixed(2);
        await db
          .update(fde)
          .set({ amountCurrency: newTotal, amountUsd: newTotal })
          .where(and(eq(fde.referenceTable, "vouchers"), eq(fde.referenceId, id)));
      } catch (error: any) {
        // Cleanup: Restore old entries if update failed after deletion
        if (oldEntries.length > 0 && createdEntries.length === 0) {
          for (const oldEntry of oldEntries) {
            await db
              .insert(voucherEntries)
              .values({
                voucherId: oldEntry.voucherId,
                ledgerAccountId: oldEntry.ledgerAccountId,
                bankAccountId: oldEntry.bankAccountId,
                fixedAssetId: oldEntry.fixedAssetId,
                supplierId: oldEntry.supplierId,
                employeeId: oldEntry.employeeId,
                debitAmount: oldEntry.debitAmount,
                creditAmount: oldEntry.creditAmount,
                narration: oldEntry.narration,
              })
              .catch(() => {});
          }
        }
        throw error;
      }

      // Log the update to audit log
      const _oldEntriesSnap = await snapshotVoucherEntries(oldEntries).catch(() => []);
      const _newEntriesSnap = await snapshotVoucherEntries(createdEntries).catch(() => []);
      await logAudit({
        userId: req.session.userId!,
        username: (req.session as any).username || "unknown",
        companyId: req.session.currentCompanyId!,
        action: "update",
        tableName: "vouchers",
        recordId: id,
        recordIdentifier: updatedVoucher.voucherNumber,
        changes: buildVoucherChangesForUpdate(existingVoucher, updatedVoucher, _oldEntriesSnap, _newEntriesSnap),
      });

      // ── Intercompany counterpart sync ────────────────────────────────────
      // If this voucher is one side of an intercompany transfer pair, scale the
      // counterpart voucher's totalAmount and entries to match the new amount.
      try {
        const [ict] = await db
          .select()
          .from(interCompanyTransfers)
          .where(or(eq(interCompanyTransfers.fromVoucherId, id), eq(interCompanyTransfers.toVoucherId, id)))
          .limit(1);
        if (ict) {
          const otherVoucherId = ict.fromVoucherId === id ? ict.toVoucherId : ict.fromVoucherId;
          if (otherVoucherId) {
            const newTotal = parseFloat(updatedVoucher.totalAmount || "0");
            const [otherVoucher] = await db.select().from(vouchers).where(eq(vouchers.id, otherVoucherId));
            if (otherVoucher) {
              const oldTotal = parseFloat(otherVoucher.totalAmount || "0");
              const ratio = oldTotal > 0 ? newTotal / oldTotal : 1;
              const otherEntries = await db
                .select()
                .from(voucherEntries)
                .where(eq(voucherEntries.voucherId, otherVoucherId));
              for (const e of otherEntries) {
                await db
                  .update(voucherEntries)
                  .set({
                    debitAmount: (parseFloat(e.debitAmount || "0") * ratio).toFixed(2),
                    creditAmount: (parseFloat(e.creditAmount || "0") * ratio).toFixed(2),
                  })
                  .where(eq(voucherEntries.id, e.id));
              }
              await db
                .update(vouchers)
                .set({ totalAmount: newTotal.toFixed(2) })
                .where(eq(vouchers.id, otherVoucherId));
              await db
                .update(fde)
                .set({ amountCurrency: newTotal.toFixed(2), amountUsd: newTotal.toFixed(2) })
                .where(and(eq(fde.referenceTable, "vouchers"), eq(fde.referenceId, otherVoucherId)));
            }
          }
        }
      } catch (ictErr: any) {
        console.error("[ICT sync] Counterpart update failed (non-fatal):", ictErr?.message);
      }

      // ── CHARGE voucher sync ──────────────────────────────────────────────
      // If this voucher was auto-created during invoice finalization (number
      // format: CHARGE-{invoiceNumber}-{chargeId}-{timestamp}), sync the new
      // amount back to customer_order_charges and recalculate the invoice totals.
      const chargeMatch = existingVoucher.voucherNumber?.match(/^CHARGE-.+-(\d+)-\d+$/);
      if (chargeMatch && existingVoucher.sourceModule === "FACTORY") {
        const chargeId = parseInt(chargeMatch[1]);
        const newAmount = Math.max(totalDebits, totalCredits);
        const [charge] = await db
          .select({ orderId: customerOrderCharges.orderId })
          .from(customerOrderCharges)
          .where(eq(customerOrderCharges.id, chargeId));
        if (charge) {
          const chargeUpdate: { amount: string; name?: string } = { amount: String(newAmount) };
          if (updatedVoucher.description?.trim()) {
            chargeUpdate.name = updatedVoucher.description.trim();
          }
          await db.update(customerOrderCharges).set(chargeUpdate).where(eq(customerOrderCharges.id, chargeId));
          await recalculateOrderTotals(db, charge.orderId);
          // Also update the customer balance ledger debit for this invoice
          const [updatedOrd] = await db
            .select({ grandTotal: customerOrders.grandTotal, status: customerOrders.status })
            .from(customerOrders)
            .where(eq(customerOrders.id, charge.orderId));
          if (updatedOrd?.status === "FINALIZED") {
            await db
              .update(customerBalances)
              .set({ debitAmount: String(updatedOrd.grandTotal), balance: String(updatedOrd.grandTotal) })
              .where(
                and(eq(customerBalances.referenceId, charge.orderId), eq(customerBalances.referenceType, "INVOICE"))
              );
          }
        }
      }

      const result = { voucher: updatedVoucher, entries: createdEntries };

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Fix inventory for Sales vouchers that were edited with location changes
  // This recalculates inventory based on current voucher locations
  app.post("/api/admin/fix-sales-inventory", requireAuth, async (req, res) => {
    try {
      // Admin only
      if (req.session.currentRole !== "Admin" && req.session.currentRole !== "Developer") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all Sales vouchers for this company
      const salesVouchers = await db
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.companyId, companyId), eq(vouchers.voucherType, "Sales")));

      const fixes: any[] = [];

      for (const voucher of salesVouchers) {
        if (!voucher.locationId) continue;

        // Get sales items for this voucher
        const items = await db.select().from(salesItems).where(eq(salesItems.voucherId, voucher.id));

        for (const item of items) {
          const quantity = parseFloat(item.quantity);
          const costPrice = parseFloat(item.costPrice);

          // Check if inventory at this location has this deduction
          const [inv] = await db
            .select()
            .from(inventory)
            .where(and(eq(inventory.locationId, voucher.locationId), eq(inventory.stockItemId, item.stockItemId)));

          fixes.push({
            voucherId: voucher.id,
            voucherNumber: voucher.voucherNumber,
            locationId: voucher.locationId,
            stockItemId: item.stockItemId,
            saleQuantity: quantity,
            currentInventory: inv ? parseFloat(inv.quantity) : null,
          });
        }
      }

      // Find inventory records with negative quantities that shouldn't have them
      const negativeInventory = await db
        .select({
          id: inventory.id,
          locationId: inventory.locationId,
          stockItemId: inventory.stockItemId,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
          totalValue: inventory.totalValue,
          locationName: locations.name,
          stockItemName: stockItems.name,
        })
        .from(inventory)
        .leftJoin(locations, eq(inventory.locationId, locations.id))
        .leftJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .where(and(eq(inventory.companyId, companyId), sql`CAST(${inventory.quantity} AS DECIMAL) < 0`));

      // For each negative inventory, set it to 0 (cleanup orphaned deductions)
      const cleaned: any[] = [];
      for (const inv of negativeInventory) {
        // Check if there's actually a sale at this location that would cause this
        const salesAtLocation = await db
          .select()
          .from(salesItems)
          .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
          .where(
            and(
              eq(vouchers.locationId, inv.locationId),
              eq(salesItems.stockItemId, inv.stockItemId),
              eq(vouchers.companyId, companyId)
            )
          );

        if (salesAtLocation.length === 0) {
          // No sales at this location for this item - this is orphaned negative inventory
          // Reset to 0
          await db
            .update(inventory)
            .set({
              quantity: "0",
              totalValue: "0",
            })
            .where(eq(inventory.id, inv.id));

          cleaned.push({
            id: inv.id,
            locationName: inv.locationName,
            stockItemName: inv.stockItemName,
            oldQuantity: inv.quantity,
            action: "Reset to 0 (orphaned negative inventory)",
          });
        }
      }

      res.json({
        message: `Fixed ${cleaned.length} orphaned negative inventory records`,
        cleaned,
        salesVoucherCount: salesVouchers.length,
        negativeInventoryFound: negativeInventory.length,
      });
    } catch (error: any) {
      console.error("[Fix Sales Inventory] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get voucher entries for a specific voucher (for editing)
}
