/**
 * voucherSalesUpdateRoutes: VoucherUpdate endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { db } from "../../../db";
import { storage } from "../../../storage";
import { requireAuth } from "../../../auth";
import { isReadonlyMigratedVoucher, READONLY_MIGRATED_VOUCHER_MESSAGE } from "../../../lib/migratedVoucherGuard";
import { logAudit, syncEmployeeBalancesFromEntries, buildVoucherChangesForUpdate } from "../../_helpers";
import {
  stockTransferVouchers,
  stockTransferItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  vouchers,
  voucherEntries,
  salesItems,
  creditNoteItems,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { adjustInventory } from "../../../inventoryHelper";

export function registerVoucherUpdateRoutes(app: Express) {
  app.patch("/api/vouchers/:id", requireAuth, async (req, res) => {
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

      if (isReadonlyMigratedVoucher(existingVoucher)) {
        return res.status(403).json({ message: READONLY_MIGRATED_VOUCHER_MESSAGE });
      }

      // Verify voucher belongs to current company (respect factory mode company)
      const effectiveCompanyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (existingVoucher.companyId !== effectiveCompanyId) {
        return res.status(403).json({
          message: "Access denied: Voucher belongs to a different company",
        });
      }

      // POS users may only update the date on their own StockTransfer vouchers.
      // All other voucher types and complex accounting paths remain admin-only.
      const isPOS = req.session.currentRole === "POS";
      if (isPOS) {
        if (existingVoucher.voucherType !== "Stock Transfer") {
          return res.status(403).json({ message: "Access denied: This resource is not available for POS users" });
        }
        const updates: Partial<unknown> = {};
        if (req.body.voucherDate !== undefined) updates.voucherDate = req.body.voucherDate;
        if (Object.keys(updates).length > 0) {
          await db.update(vouchers).set(updates).where(eq(vouchers.id, id));
        }
        return res.json({ id, ...updates });
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

      // Get old entries before updating (for balance sync)
      const oldEntries = await storage.getVoucherEntriesByVoucher(id);
      const wasOptional = existingVoucher.optional;

      // Update voucher and entries in a transaction
      await db.transaction(async (tx) => {
        // Update voucher header
        const voucherUpdates: Partial<unknown> = {};
        if (req.body.voucherDate !== undefined) voucherUpdates.voucherDate = req.body.voucherDate;
        if (req.body.description !== undefined) voucherUpdates.description = req.body.description;
        if (req.body.optional !== undefined) voucherUpdates.optional = req.body.optional;

        // Handle inventory changes when toggling optional status
        if (req.body.optional !== undefined && existingVoucher.optional !== req.body.optional) {
          const _wasOptional = existingVoucher.optional;
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
              const destinationLocId = transfer.destinationLocationId;
              if (sourceLocId == null || destinationLocId == null) {
                throw new Error("Stock transfer is missing source or destination location");
              }
              const quantity = parseFloat(item.quantity);
              const rate = parseFloat(item.rate);

              // Guard on inventoryApplied: only reverse if inventory was actually applied,
              // only apply if inventory was not already applied. This prevents stock
              // corruption for legacy transfers (inventoryApplied=false on non-optional)
              // and for any edge case where the flag is out of sync with the optional flag.
              if (willBeOptional && transfer.inventoryApplied) {
                // Reverse: inventory was applied, now marking optional → undo it
                await adjustInventory(tx, sourceLocId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                await adjustInventory(tx, destinationLocId, item.stockItemId, -quantity, existingVoucher.companyId);
              } else if (!willBeOptional && !transfer.inventoryApplied) {
                // Apply: inventory was not applied, now marking non-optional → apply it
                await adjustInventory(tx, sourceLocId, item.stockItemId, -quantity, existingVoucher.companyId);
                await adjustInventory(
                  tx,
                  destinationLocId,
                  item.stockItemId,
                  quantity,
                  existingVoucher.companyId,
                  rate
                );
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
              const isProduction = adjustmentType === "Production" || (adjustmentType === "Mixed" && rawQuantity > 0);

              if (willBeOptional) {
                // Reversing the adjustment
                if (isProduction) {
                  // Reverse production: subtract what was added
                  await adjustInventory(
                    tx,
                    adjustment.locationId,
                    item.stockItemId,
                    -quantity,
                    existingVoucher.companyId
                  );
                } else {
                  // Reverse consumption: add back what was subtracted
                  await adjustInventory(
                    tx,
                    adjustment.locationId,
                    item.stockItemId,
                    quantity,
                    existingVoucher.companyId,
                    rate
                  );
                }
              } else {
                // Applying the adjustment
                if (isProduction) {
                  // Apply production: add to inventory
                  await adjustInventory(
                    tx,
                    adjustment.locationId,
                    item.stockItemId,
                    quantity,
                    existingVoucher.companyId,
                    rate
                  );
                } else {
                  // Apply consumption: subtract from inventory
                  await adjustInventory(
                    tx,
                    adjustment.locationId,
                    item.stockItemId,
                    -quantity,
                    existingVoucher.companyId
                  );
                }
              }
            }
          }

          // Handle Sales items inventory when toggling optional
          const hasSalesItems = await tx.select().from(salesItems).where(eq(salesItems.voucherId, id));

          if (hasSalesItems.length > 0 && existingVoucher.locationId) {
            for (const item of hasSalesItems) {
              const quantity = parseFloat(item.quantity);
              const costPrice = parseFloat(item.costPrice);
              if (willBeOptional) {
                // Reverse: add back stock that was deducted by the sale
                await adjustInventory(
                  tx,
                  existingVoucher.locationId,
                  item.stockItemId,
                  quantity,
                  existingVoucher.companyId,
                  costPrice
                );
              } else {
                // Apply: deduct stock for the sale
                await adjustInventory(
                  tx,
                  existingVoucher.locationId,
                  item.stockItemId,
                  -quantity,
                  existingVoucher.companyId
                );
              }
            }
          }

          // Handle Credit Note items inventory when toggling optional
          const hasCreditNoteItems = await tx.select().from(creditNoteItems).where(eq(creditNoteItems.voucherId, id));

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

        await tx.update(vouchers).set(voucherUpdates).where(eq(vouchers.id, id));

        // Delete all existing entries
        await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, id));

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
      if (!updated) {
        return res.status(404).json({ message: "Voucher not found after update" });
      }
      const newEntries = await storage.getVoucherEntriesByVoucher(id);

      // Sync employee balances: reverse old entries if voucher was non-optional
      if (!wasOptional && req.session.currentCompanyId) {
        await syncEmployeeBalancesFromEntries(
          oldEntries.map((e) => ({
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
          newEntries.map((e) => ({
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
          username: req.session.username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "update",
          tableName: "vouchers",
          recordId: updated.id,
          recordIdentifier: updated.voucherNumber,
          changes: buildVoucherChangesForUpdate(existingVoucher, updated, oldEntries, newEntries),
        });
      } catch {
        /* non-fatal */
      }
      res.json({ ...updated, entries: newEntries });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Custom error class for validation errors
  class _ValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ValidationError";
    }
  }
}
