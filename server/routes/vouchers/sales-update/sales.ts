/**
 * voucherSalesUpdateRoutes: VoucherSalesLineUpdate endpoints.
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
import {
  stockItems,
  stockItemLocationPrices,
  vouchers,
  voucherEntries,
  salesItems,
  locations,
  ledgerAccounts,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { adjustInventory } from "../../../inventoryHelper";

export function registerVoucherSalesLineUpdateRoutes(app: Express) {
  // Update a sales voucher with line items
  app.patch("/api/vouchers/:id/sales", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const { voucherDate, description, locationId, items, paymentAccountType, paymentAccountId, isCreditSale } =
        req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      // Get the existing voucher to check company and permissions
      const existingVoucher = await storage.getVoucherById(id);
      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      if (isReadonlyMigratedVoucher(existingVoucher)) {
        return res.status(403).json({ message: READONLY_MIGRATED_VOUCHER_MESSAGE });
      }

      // Verify this is a Sales voucher
      if (existingVoucher.voucherType !== "Sales") {
        return res.status(400).json({ message: "This endpoint only updates Sales vouchers" });
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
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const voucherDate = new Date(existingVoucher.voucherDate);
          voucherDate.setHours(0, 0, 0, 0);

          if (voucherDate.getTime() !== today.getTime()) {
            return res.status(403).json({ message: "Managers can only edit today's vouchers" });
          }
        } else {
          // POS users can edit if they have daybookEditDays permission > 0
          const daybookEditDays = req.session.daybookEditDays || 0;
          if (daybookEditDays <= 0) {
            return res.status(403).json({ message: "Insufficient permissions to edit vouchers" });
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
        const [targetLocation] = await db.select().from(locations).where(eq(locations.id, parsedLocationId));

        if (!targetLocation) {
          return res.status(404).json({ message: "Location not found" });
        }

        if (targetLocation.companyId !== req.session.currentCompanyId) {
          return res.status(403).json({
            message: "Access denied: Location belongs to a different company",
          });
        }

        validatedLocationId = parsedLocationId;
      }

      // Fetch stock items to calculate cost prices
      const stockItemIds = items.map((item) => item.stockItemId);
      const stockItemsData = await db.select().from(stockItems).where(inArray(stockItems.id, stockItemIds));

      const stockItemsMap = new Map(stockItemsData.map((item) => [item.id, item]));

      // Calculate totals and prepare items data
      let totalSalesAmount = 0;
      const salesItemsData = items.map((item) => {
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
          configuredPrice: null as string | null,
        };
      });

      // STEPS 1-4: Reverse old inventory, delete old items, deduct new inventory, insert new items - all atomically
      const targetLocationId = validatedLocationId !== null ? validatedLocationId : existingVoucher.locationId;

      await db.transaction(async (tx) => {
        // Read + lock the CURRENT old sales items INSIDE the transaction (not before
        // it starts). If two edits of the same voucher race (e.g. two browser tabs,
        // a double-submit, or a network retry), this FOR UPDATE lock forces them to
        // run strictly one after the other: the second edit sees the first edit's
        // already-committed items as its "old" state, instead of both reversing the
        // same stale pre-transaction snapshot and double-counting inventory.
        const oldSalesItems = await tx.select().from(salesItems).where(eq(salesItems.voucherId, id)).for("update");

        // STEP 1: Reverse inventory for old sales items
        if (existingVoucher.locationId) {
          for (const oldItem of oldSalesItems) {
            const quantity = parseFloat(oldItem.quantity);
            const costPrice = parseFloat(oldItem.costPrice);
            await adjustInventory(
              tx,
              existingVoucher.locationId,
              oldItem.stockItemId,
              quantity,
              existingVoucher.companyId,
              costPrice
            );
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
            const invResult = await adjustInventory(
              tx,
              targetLocationId,
              newItem.stockItemId,
              -quantity,
              existingVoucher.companyId
            );
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
        const existingEntries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, id));

        // Find the debit entry that represents the payment account
        // Priority: bank account > cash ledger > other ledger (customer/receivable)
        const debitEntries = existingEntries.filter((entry) => parseFloat(entry.debitAmount || "0") > 0);

        // Check for bank account first
        let existingDebitEntry = debitEntries.find((entry) => entry.bankAccountId !== null);
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
        const salesAccountCheck = allAccountsForValidation.find((a) => a.code === "SALES");

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

        if (finalIsCreditSale || accountType === "cash" || accountType === "credit") {
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
        let salesAccount = allAccounts.find((a) => a.code === "SALES");

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
        throw new Error("Unable to determine payment account for voucher update");
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

      const updated = await db.update(vouchers).set(voucherUpdates).where(eq(vouchers.id, id)).returning();

      res.json(updated[0]);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Update a purchase voucher with line items
}
