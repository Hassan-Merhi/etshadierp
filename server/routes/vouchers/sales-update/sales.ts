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
import { nextCanonicalSourceRevision } from "../../../services/inventory/canonicalSourceRevision";
import { createDatabaseStockMovementAdapter } from "../../../services/inventory/databaseStockMovementAdapter";
import { postStockMovementTx } from "../../../services/inventory/stockMovementIntegrityService";

const canonicalStockMovementAdapter = createDatabaseStockMovementAdapter();

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

      const existingVoucher = await storage.getVoucherById(id);
      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      if (isReadonlyMigratedVoucher(existingVoucher)) {
        return res.status(403).json({ message: READONLY_MIGRATED_VOUCHER_MESSAGE });
      }

      if (existingVoucher.voucherType !== "Sales") {
        return res.status(400).json({ message: "This endpoint only updates Sales vouchers" });
      }

      if (existingVoucher.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({
          message: "Access denied: Voucher belongs to a different company",
        });
      }

      const userRole = req.session.currentRole;
      if (!userRole) {
        return res.status(403).json({ message: "User role not found" });
      }

      if (userRole !== "Admin" && userRole !== "Owner" && userRole !== "Developer") {
        if (userRole === "Manager") {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const existingVoucherDate = new Date(existingVoucher.voucherDate);
          existingVoucherDate.setHours(0, 0, 0, 0);
          if (existingVoucherDate.getTime() !== today.getTime()) {
            return res.status(403).json({ message: "Managers can only edit today's vouchers" });
          }
        } else {
          const daybookEditDays = req.session.daybookEditDays || 0;
          if (daybookEditDays <= 0) {
            return res.status(403).json({ message: "Insufficient permissions to edit vouchers" });
          }
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const existingVoucherDate = new Date(existingVoucher.voucherDate);
          existingVoucherDate.setHours(0, 0, 0, 0);
          const daysDiff = Math.floor((today.getTime() - existingVoucherDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff >= daybookEditDays) {
            return res
              .status(403)
              .json({ message: `You can only edit vouchers from the last ${daybookEditDays} day(s)` });
          }
        }
      }

      let validatedLocationId: number | null = null;
      if (locationId !== undefined && locationId !== null) {
        const parsedLocationId = parseInt(locationId);
        if (isNaN(parsedLocationId) || parsedLocationId <= 0) {
          return res.status(400).json({ message: "Invalid location ID" });
        }
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

      const stockItemIds = items.map((item) => item.stockItemId);
      const stockItemsData = await db.select().from(stockItems).where(inArray(stockItems.id, stockItemIds));
      const stockItemsMap = new Map(stockItemsData.map((item) => [item.id, item]));

      let totalSalesAmount = 0;
      const salesItemsData = items.map((item) => {
        const stockItem = stockItemsMap.get(item.stockItemId);
        if (!stockItem) throw new Error(`Stock item ${item.stockItemId} not found`);
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

      const targetLocationId = validatedLocationId !== null ? validatedLocationId : existingVoucher.locationId;

      await db.transaction(async (tx) => {
        const oldSalesItems = await tx.select().from(salesItems).where(eq(salesItems.voucherId, id)).for("update");
        const evidenceRevision = await nextCanonicalSourceRevision(
          tx,
          existingVoucher.companyId,
          "voucher-sales-edit",
          String(id)
        );
        const occurredAt = new Date().toISOString();
        const evidenceActor = {
          userId: req.session.userId,
          username: req.session.username,
          reason: `Edit sales voucher ${existingVoucher.voucherNumber}`,
        };

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
            await postStockMovementTx(
              tx,
              {
                companyId: existingVoucher.companyId,
                stockItemId: oldItem.stockItemId,
                kind: "adjustment",
                quantity: String(Math.abs(quantity)),
                unitCost: String(Math.max(costPrice || 0, 0)),
                toLocationId: existingVoucher.locationId,
                occurredAt,
                source: {
                  sourceType: "voucher-sales-edit-reverse",
                  sourceId: String(id),
                  idempotencyKey: `voucher-sales-edit:rev${evidenceRevision}:reverse:${oldItem.id}`,
                },
                actor: evidenceActor,
                allowNegativeStock: true,
              },
              canonicalStockMovementAdapter
            );
          }
        }

        await tx.delete(salesItems).where(eq(salesItems.voucherId, id));

        if (targetLocationId) {
          const updatedSalesItemsData: typeof salesItemsData = [];

          for (let index = 0; index < salesItemsData.length; index += 1) {
            const newItem = salesItemsData[index];
            const quantity = parseFloat(newItem.quantity);
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

            await postStockMovementTx(
              tx,
              {
                companyId: existingVoucher.companyId,
                stockItemId: newItem.stockItemId,
                kind: "issue",
                quantity: String(Math.abs(quantity)),
                unitCost: String(Math.max(actualCostPrice || 0, 0)),
                fromLocationId: targetLocationId,
                occurredAt,
                source: {
                  sourceType: "voucher-sales-edit-apply",
                  sourceId: String(id),
                  idempotencyKey: `voucher-sales-edit:rev${evidenceRevision}:apply:${index}:${newItem.stockItemId}`,
                },
                actor: evidenceActor,
                allowNegativeStock: true,
              },
              canonicalStockMovementAdapter
            );
          }

          salesItemsData.length = 0;
          salesItemsData.push(...updatedSalesItemsData);
        } else {
          for (const newItem of salesItemsData) newItem.configuredPrice = null;
        }

        await tx.insert(salesItems).values(salesItemsData);
      });

      let finalPaymentAccountId = paymentAccountId;
      let finalPaymentAccountType = paymentAccountType;
      let finalIsCreditSale = isCreditSale;
      let finalCreditCustomerName = "";

      if (!finalPaymentAccountId || !finalPaymentAccountType) {
        const existingEntries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, id));
        const debitEntries = existingEntries.filter((entry) => parseFloat(entry.debitAmount || "0") > 0);
        let existingDebitEntry = debitEntries.find((entry) => entry.bankAccountId !== null);
        if (existingDebitEntry) {
          finalPaymentAccountId = String(existingDebitEntry.bankAccountId);
          finalPaymentAccountType = "bank";
          finalIsCreditSale = false;
        } else {
          for (const entry of debitEntries) {
            if (entry.ledgerAccountId) {
              const [ledgerAccount] = await db
                .select()
                .from(ledgerAccounts)
                .where(eq(ledgerAccounts.id, entry.ledgerAccountId))
                .limit(1);
              if (ledgerAccount) {
                if (ledgerAccount.accountType === "Cash") {
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
                  finalPaymentAccountId = String(entry.ledgerAccountId);
                  finalPaymentAccountType = "credit";
                  finalIsCreditSale = true;
                  finalCreditCustomerName = ledgerAccount.name;
                  existingDebitEntry = entry;
                  break;
                }
              }
            }
          }
        }
      }

      if (finalPaymentAccountId && finalPaymentAccountType) {
        const allAccountsForValidation = await storage.getAllLedgerAccounts(existingVoucher.companyId);
        const salesAccountCheck = allAccountsForValidation.find((a) => a.code === "SALES");
        if (salesAccountCheck && salesAccountCheck.accountType !== "Income") {
          return res.status(400).json({
            message: `The SALES account is configured with type "${salesAccountCheck.accountType}" but must be type "Income" for POS sales to work correctly.`,
          });
        }

        await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, id));
        const accountId = parseInt(finalPaymentAccountId);
        const accountType = finalPaymentAccountType;

        if (finalIsCreditSale && !finalCreditCustomerName && accountType === "credit") {
          const [customerLedger] = await db
            .select({ name: ledgerAccounts.name })
            .from(ledgerAccounts)
            .where(eq(ledgerAccounts.id, accountId))
            .limit(1);
          if (customerLedger) finalCreditCustomerName = customerLedger.name;
        }

        const debitEntry: any = {
          voucherId: id,
          debitAmount: totalSalesAmount.toFixed(2),
          creditAmount: "0",
          narration: finalIsCreditSale
            ? `POS - ${finalCreditCustomerName} - ${existingVoucher.locationName || ""}`
            : `POS Sale - ${existingVoucher.voucherNumber}`,
        };

        if (finalIsCreditSale || accountType === "cash" || accountType === "credit") {
          debitEntry.ledgerAccountId = accountId;
        } else {
          debitEntry.bankAccountId = accountId;
        }

        await db.insert(voucherEntries).values(debitEntry);
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

      const voucherUpdates: any = { totalAmount: totalSalesAmount.toFixed(2) };
      if (voucherDate !== undefined) voucherUpdates.voucherDate = voucherDate;
      if (description !== undefined) voucherUpdates.description = description;
      if (validatedLocationId !== null) {
        voucherUpdates.locationId = validatedLocationId;
        const location = await storage.getLocationById(validatedLocationId);
        if (location) voucherUpdates.locationName = location.name;
      }

      const updated = await db.update(vouchers).set(voucherUpdates).where(eq(vouchers.id, id)).returning();
      res.json(updated[0]);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Update a purchase voucher with line items
}
