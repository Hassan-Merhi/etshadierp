import { type Express } from "express";
import { getClientDate } from "../../lib/dateUtils";
import { logger } from "../../lib/logger";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth, canModifyDate } from "../../auth";
import { logAudit, recalculateIntercompanyForDate } from "../_helpers";
import {
  companies,
  ledgerAccounts,
  vouchers,
  voucherEntries,
  salesItems,
  locations,
  stockItems,
  inventory,
  stockItemLocationPrices,
} from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { adjustInventory } from "../../inventoryHelper";

export function registerPosEditSaleRoutes(app: Express): void {
  // Update existing sales voucher
  app.put("/api/vouchers/:id/sales", requireAuth, canModifyDate("voucherDate"), async (req, res) => {
    const _t = Date.now();
    const _uid = req.session.userId;
    const _cid = req.session.currentCompanyId;
    try {
      logger.info("POS sale update started", { module: "pos", action: "updateSale", userId: _uid, companyId: _cid });
      const voucherId = parseInt(req.params.id);
      if (isNaN(voucherId)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Detect supplier_partner for SP-specific accounting on edit
      const [editCoRow] = await db
        .select({ companyType: companies.companyType })
        .from(companies)
        .where(eq(companies.id, req.session.currentCompanyId!))
        .limit(1);
      const isSpCompanyEdit = editCoRow?.companyType === "supplier_partner";

      // For SP companies fetch configured POS payable/profit accounts upfront
      let editSpPayableAccountId: number | null = null;
      let editSpProfitAccountId: number | null = null;
      let editSpCostClrAccountId: number | null = null;
      let editSpDeductionClrAccountId: number | null = null;
      if (isSpCompanyEdit) {
        const spSettings = await storage.getCompanySettings(req.session.currentCompanyId!);
        editSpPayableAccountId = spSettings?.spPosPayableAccountId ?? null;
        editSpProfitAccountId = spSettings?.spPosProfitAccountId ?? null;
        if (!editSpPayableAccountId || !editSpProfitAccountId) {
          return res.status(400).json({
            message: "Supplier POS payable/profit accounts are not configured. Go to SP Setup to set them up.",
          });
        }
        // Look up Stock Cost Payable Clearing account (sp_cost_clearing subType)
        const [clrAcct] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, req.session.currentCompanyId!),
              eq(ledgerAccounts.subType, "sp_cost_clearing"),
              isNull(ledgerAccounts.deletedAt)
            )
          )
          .limit(1);
        editSpCostClrAccountId = clrAcct?.id ?? null;
        // Look up Supplier Payable Deduction Clearing account (sp_pay_deduction_clearing subType)
        const [ddcAcct] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, req.session.currentCompanyId!),
              eq(ledgerAccounts.subType, "sp_pay_deduction_clearing"),
              isNull(ledgerAccounts.deletedAt)
            )
          )
          .limit(1);
        editSpDeductionClrAccountId = ddcAcct?.id ?? null;
      }

      const {
        description,
        items,
        paymentAccountType,
        paymentAccountId,
        isCreditSale,
        voucherDate,
        locationId: newLocationId,
      } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      // Validate all items have positive quantities and prices
      for (const item of items) {
        const qty = parseFloat(item.quantity);
        const price = parseFloat(item.sellingPrice);

        if (isNaN(qty) || qty <= 0) {
          throw new Error(`Invalid quantity: ${item.quantity}. Must be greater than 0.`);
        }
        if (isNaN(price) || price <= 0) {
          throw new Error(`Invalid price: ${item.sellingPrice}. Must be greater than 0.`);
        }
      }

      // Get existing voucher to validate it's a Sales voucher in the current company
      const [existingVoucher] = await db
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, req.session.currentCompanyId)))
        .limit(1);

      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      if (existingVoucher.voucherType !== "Sales") {
        return res.status(400).json({ message: "Only Sales vouchers can be updated with this endpoint" });
      }

      // POS restrictions on existing sales:
      //   - Cannot change location: block if a different locationId is sent.
      //   - Cannot change payment account: silently strip paymentAccountType/paymentAccountId
      //     so the handler's preservation branch runs. Returning 403 here would break
      //     the POS edit form which always sends these fields even when unchanged.
      //   - Date changes are blocked by the canModifyDate middleware above.
      if (req.user?.role === "POS") {
        if (newLocationId && parseInt(newLocationId) !== existingVoucher.locationId) {
          return res.status(403).json({ message: "POS users cannot change the location of an existing sale" });
        }
        // Strip payment account fields — force the handler to preserve the original account
        (req.body as any).paymentAccountType = undefined;
        (req.body as any).paymentAccountId = undefined;
      }

      // Determine target location - use new location if provided, otherwise keep existing
      const oldLocationId = existingVoucher.locationId!;
      const targetLocationId = newLocationId ? parseInt(newLocationId) : oldLocationId;
      const locationChanged = targetLocationId !== oldLocationId;

      // SP edit: load target location's per-qty deduction rate
      let editSpDeductionPerQty = 0;
      if (isSpCompanyEdit) {
        const [editTargetLoc] = await db
          .select({ supplierPartnerPayableDeductionPerQty: locations.supplierPartnerPayableDeductionPerQty })
          .from(locations)
          .where(eq(locations.id, targetLocationId))
          .limit(1);
        editSpDeductionPerQty = parseFloat(String(editTargetLoc?.supplierPartnerPayableDeductionPerQty ?? "0")) || 0;
      }

      // Validate new location belongs to company if changed
      if (locationChanged) {
        const [newLocation] = await db
          .select()
          .from(locations)
          .where(
            and(
              eq(locations.id, targetLocationId),
              eq(locations.companyId, req.session.currentCompanyId!),
              isNull(locations.deletedAt)
            )
          )
          .limit(1);

        if (!newLocation) {
          return res.status(400).json({ message: "Invalid location or location not found" });
        }
        console.log(`[POS Sales Edit] Location changing from ${oldLocationId} to ${targetLocationId}`);
      }

      // Get old sales items to reverse inventory and preserve historical cost
      const oldSalesItems = await db.select().from(salesItems).where(eq(salesItems.voucherId, voucherId));
      // Sort by stockItemId so the reversal loop always acquires locks in a
      // consistent order — prevents deadlocks with concurrent sale transactions.
      oldSalesItems.sort((a, b) => a.stockItemId - b.stockItemId);

      // Create map of old items by line ID for cost preservation (not stockItemId to handle duplicates)
      const oldItemsMap = new Map(oldSalesItems.map((item) => [item.id, item]));

      // Get existing voucher entries to recreate them
      const oldEntries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));

      // Begin transaction
      await db.transaction(async (tx) => {
        // Reverse old inventory movements
        for (const oldItem of oldSalesItems) {
          const oldQty = parseFloat(oldItem.quantity);
          const oldCost = parseFloat(oldItem.costPrice || "0");

          // Add back the old quantity to inventory (reversal of sale).
          // Do NOT pass a rate — cost price must never change due to POS activity.
          await adjustInventory(
            tx,
            existingVoucher.locationId!,
            oldItem.stockItemId,
            oldQty,
            existingVoucher.companyId
          );
        }

        // Delete old sales items and voucher entries
        await tx.delete(salesItems).where(eq(salesItems.voucherId, voucherId));
        await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));

        // Check if user can sell negative stock
        const canSellNegativeStock = req.user?.canSellNegativeStock || false;

        // Create new sales items and apply new inventory movements
        // Sort by stockItemId for consistent lock ordering (same reason as reversal above).
        const sortedNewItems = [...items].sort((a: any, b: any) => a.stockItemId - b.stockItemId);
        let grandTotal = 0;
        let totalSupplierCostEdit = 0;
        let totalQtySoldEdit = 0;
        for (const item of sortedNewItems) {
          const { id, stockItemId, quantity, sellingPrice } = item;

          // Get inventory record for validation and deduction
          const [inventoryRecord] = await tx
            .select()
            .from(inventory)
            .where(and(eq(inventory.locationId, targetLocationId), eq(inventory.stockItemId, stockItemId)))
            .limit(1);

          const currentQty = inventoryRecord ? parseFloat(inventoryRecord.quantity) : 0;
          const sellQty = parseFloat(quantity);

          // Only check stock if user cannot sell negative stock
          if (currentQty < sellQty && !canSellNegativeStock) {
            throw new Error(
              `Insufficient stock for item ${stockItemId}. Available: ${currentQty}, Requested: ${sellQty}`
            );
          }

          // Preserve historical cost from old sale line if it exists (by line ID), otherwise use current cost
          // Items with id field are existing items, items without id are new items
          const oldItem = id !== undefined && id > 0 ? oldItemsMap.get(id) : null;
          const costPrice = oldItem
            ? parseFloat(oldItem.costPrice || "0")
            : parseFloat(inventoryRecord?.averageRate || "0");

          // Use the entered selling price directly - don't override with configured price during edits
          // This preserves the original sale price and prevents unintended cash balance changes
          const effectiveSellingPrice = parseFloat(sellingPrice);

          const totalSales = sellQty * effectiveSellingPrice;
          const totalCost = sellQty * costPrice;
          const profit = totalSales - totalCost;

          // Look up configured price for this item at this location
          const [editLocPrice] = await tx
            .select()
            .from(stockItemLocationPrices)
            .where(
              and(
                eq(stockItemLocationPrices.stockItemId, stockItemId),
                eq(stockItemLocationPrices.locationId, targetLocationId)
              )
            )
            .limit(1);
          const editConfiguredPriceNum = parseFloat(editLocPrice?.sellingPrice || "0");

          // Create new sales item
          await tx.insert(salesItems).values({
            voucherId,
            stockItemId,
            quantity: quantity,
            sellingPrice: effectiveSellingPrice.toFixed(2),
            costPrice: costPrice.toString(),
            totalSales: totalSales.toFixed(2),
            totalCost: totalCost.toFixed(2),
            profit: profit.toFixed(2),
            configuredPrice: editConfiguredPriceNum > 0 ? editConfiguredPriceNum.toFixed(6) : null,
          });

          // Deduct from inventory using adjustInventory (sale = negative delta)
          await adjustInventory(tx, targetLocationId, stockItemId, -sellQty, existingVoucher.companyId);

          grandTotal += totalSales;
          totalSupplierCostEdit += totalCost;
          totalQtySoldEdit += sellQty;
        }

        // Update voucher description, total amount, location, and optionally date
        const voucherUpdate: any = {
          description: description || null,
          totalAmount: grandTotal.toString(),
        };
        if (locationChanged) {
          voucherUpdate.locationId = targetLocationId;
          console.log(
            `[POS Sales Edit] Updated voucher ${voucherId} location from ${oldLocationId} to ${targetLocationId}`
          );
        }
        if (voucherDate) {
          voucherUpdate.voucherDate = new Date(voucherDate);
        }
        await tx.update(vouchers).set(voucherUpdate).where(eq(vouchers.id, voucherId));

        // Recreate voucher entries with new total
        // Get original entries for reference
        const paymentEntry = oldEntries.find((e) => parseFloat(e.debitAmount || "0") > 0);
        const revenueEntry = oldEntries.find((e) => parseFloat(e.creditAmount || "0") > 0);

        if (!paymentEntry || !revenueEntry) {
          throw new Error("Original voucher entries not found");
        }

        // Determine payment account - use new values if provided, otherwise preserve original
        const newDebitEntry: any = {
          voucherId,
          debitAmount: grandTotal.toString(),
          creditAmount: "0",
          narration: paymentEntry.narration || "",
        };

        if (paymentAccountType && paymentAccountId) {
          // User changed payment account - use new values
          if (paymentAccountType === "cash" || paymentAccountType === "credit") {
            newDebitEntry.ledgerAccountId = parseInt(paymentAccountId);
            newDebitEntry.bankAccountId = null;
          } else if (paymentAccountType === "bank") {
            newDebitEntry.bankAccountId = parseInt(paymentAccountId);
            newDebitEntry.ledgerAccountId = null;
          }
          newDebitEntry.supplierId = null;
          newDebitEntry.employeeId = null;
          newDebitEntry.fixedAssetId = null;
        } else {
          // Preserve original payment account
          newDebitEntry.ledgerAccountId = paymentEntry.ledgerAccountId;
          newDebitEntry.bankAccountId = paymentEntry.bankAccountId;
          newDebitEntry.supplierId = paymentEntry.supplierId;
          newDebitEntry.employeeId = paymentEntry.employeeId;
          newDebitEntry.fixedAssetId = paymentEntry.fixedAssetId;
        }

        // Create new debit entry (payment account)
        await tx.insert(voucherEntries).values(newDebitEntry);

        if (!isSpCompanyEdit) {
          // Normal ERP: single credit to Sales Revenue account
          await tx.insert(voucherEntries).values({
            voucherId,
            ledgerAccountId: revenueEntry.ledgerAccountId,
            bankAccountId: revenueEntry.bankAccountId,
            supplierId: revenueEntry.supplierId,
            employeeId: revenueEntry.employeeId,
            fixedAssetId: revenueEntry.fixedAssetId,
            debitAmount: "0",
            creditAmount: grandTotal.toString(),
            narration: revenueEntry.narration || "",
          });
        } else {
          // Supplier Partner edit accounting (mirrors new-sale logic):
          //   Dr Cash / Receivable              = grandTotal  (debit entry already written above)
          //   Cr Supplier Cash Payable          = grandTotal − deductionAmount
          //   Cr Deduction Clearing (hidden)    = deductionAmount          (if deduction > 0)
          const grandTotalRounded = Number(grandTotal.toFixed(2));
          const editDeductionAmount = Number((totalQtySoldEdit * editSpDeductionPerQty).toFixed(2));
          if (editDeductionAmount > Math.abs(grandTotalRounded)) {
            throw new Error(
              `Supplier payable deduction (${editDeductionAmount}) exceeds the sale total (${grandTotalRounded}). ` +
                `Adjust the deduction per qty setting on this location.`
            );
          }
          const editSpPayableAmount = Number((grandTotalRounded - editDeductionAmount).toFixed(2));

          if (grandTotalRounded > 0) {
            if (editSpPayableAmount > 0) {
              await tx.insert(voucherEntries).values({
                voucherId,
                ledgerAccountId: editSpPayableAccountId!,
                debitAmount: "0",
                creditAmount: editSpPayableAmount.toFixed(2),
                narration: `Supplier Cash Payable`,
              });
            }
            if (editDeductionAmount > 0 && editSpDeductionClrAccountId) {
              await tx.insert(voucherEntries).values({
                voucherId,
                ledgerAccountId: editSpDeductionClrAccountId,
                debitAmount: "0",
                creditAmount: editDeductionAmount.toFixed(2),
                narration: `Supplier Payable Deduction (${totalQtySoldEdit} qty × ${editSpDeductionPerQty})`,
              });
            }
          } else if (grandTotalRounded < 0) {
            if (editSpPayableAmount < 0) {
              await tx.insert(voucherEntries).values({
                voucherId,
                ledgerAccountId: editSpPayableAccountId!,
                debitAmount: Math.abs(editSpPayableAmount).toFixed(2),
                creditAmount: "0",
                narration: `Supplier Cash Payable reversal`,
              });
            }
            if (editDeductionAmount > 0 && editSpDeductionClrAccountId) {
              await tx.insert(voucherEntries).values({
                voucherId,
                ledgerAccountId: editSpDeductionClrAccountId,
                debitAmount: editDeductionAmount.toFixed(2),
                creditAmount: "0",
                narration: `Supplier Payable Deduction reversal`,
              });
            }
          }
        }
      });

      // Fetch updated data to return for print template
      const [updatedVoucher] = await db.select().from(vouchers).where(eq(vouchers.id, voucherId)).limit(1);

      const updatedSalesItems = await db
        .select({
          id: salesItems.id,
          stockItemId: salesItems.stockItemId,
          stockItemName: stockItems.name,
          stockItemCode: stockItems.code,
          quantity: salesItems.quantity,
          sellingPrice: salesItems.sellingPrice,
          costPrice: salesItems.costPrice,
          totalSales: salesItems.totalSales,
          totalCost: salesItems.totalCost,
          profit: salesItems.profit,
          rate: salesItems.sellingPrice,
          rateUSD: salesItems.sellingPrice,
        })
        .from(salesItems)
        .innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
        .where(eq(salesItems.voucherId, voucherId));

      const updatedLocation = await storage.getLocationById(targetLocationId);

      let customerAccount = null;
      if (isCreditSale) {
        const updatedEntries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));
        const debitEntry = updatedEntries.find((e) => parseFloat(e.debitAmount || "0") > 0);
        if (debitEntry?.ledgerAccountId) {
          customerAccount = await storage.getLedgerAccountById(debitEntry.ledgerAccountId);
        }
      }

      // ── Recalculate INTERCO vouchers for affected date(s) (non-blocking) ──
      // Always recalculate old date; if date changed, also recalculate new date.
      const oldDate = existingVoucher.voucherDate;
      const newDate = voucherDate || oldDate;
      const datesToRecalc = new Set<string>([oldDate]);
      if (newDate !== oldDate) datesToRecalc.add(newDate);
      for (const d of datesToRecalc) {
        recalculateIntercompanyForDate(req.session.currentCompanyId!, d).catch((err) =>
          console.error("[IntercompanyPOS Recalc] Unhandled:", err)
        );
      }

      try {
        const _posChanges: Record<string, { old: any; new: any }> = {};
        if (existingVoucher.totalAmount !== updatedVoucher.totalAmount)
          _posChanges.totalAmount = { old: existingVoucher.totalAmount, new: updatedVoucher.totalAmount };
        if (existingVoucher.voucherDate !== updatedVoucher.voucherDate)
          _posChanges.date = { old: existingVoucher.voucherDate, new: updatedVoucher.voucherDate };
        if (existingVoucher.locationId !== updatedVoucher.locationId)
          _posChanges.locationId = { old: existingVoucher.locationId, new: updatedVoucher.locationId };
        _posChanges.itemCount = { new: updatedSalesItems.length };
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "update",
          tableName: "vouchers",
          recordId: voucherId,
          recordIdentifier: updatedVoucher.voucherNumber,
          changes: _posChanges,
        });
      } catch {
        /* non-fatal */
      }
      logger.info("POS sale update succeeded", { module: "pos", action: "updateSale", userId: _uid, companyId: _cid, voucherId: updatedVoucher.id, durationMs: Date.now() - _t });
      res.json({
        voucher: updatedVoucher,
        location: updatedLocation,
        items: updatedSalesItems,
        grandTotal: updatedVoucher.totalAmount,
        voucherNumber: updatedVoucher.voucherNumber,
        saleDate: updatedVoucher.voucherDate,
        isCreditSale: !!isCreditSale,
        customer: customerAccount
          ? { id: customerAccount.id, code: customerAccount.code, name: customerAccount.name }
          : null,
      });
    } catch (error: any) {
      logger.error("POS sale update failed", { module: "pos", action: "updateSale", userId: _uid, companyId: _cid, durationMs: Date.now() - _t, error });
      if (error.message.includes("Inventory not found")) {
        return res.status(404).json({ message: error.message });
      }
      if (error.message.includes("Insufficient stock")) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: error.message });
    }
  });
}
