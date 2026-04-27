import { getClientDate } from "../lib/dateUtils";
import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation, canModifyDate } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory, runIntercompanyPosTransfer, recalculateIntercompanyForDate } from "./_helpers";
import {
  inventory, stockItems, stockGroups, stockGroupArchives,
  stockTransferVouchers, stockTransferItems,
  stockAdjustmentVouchers, stockAdjustmentItems,
  containers, containerOffloads, containerOffloadItems,
  bankAccounts, fixedAssets, ledgerAccounts, insertLedgerAccountSchema,
  insertStockGroupSchema, insertStockItemSchema, insertContainerSchema,
  insertStockTransferVoucherSchema, insertStockAdjustmentVoucherSchema,
  updateStockTransferSchema, updateStockAdjustmentSchema,
  vouchers, voucherEntries, salesItems, suppliers, customers, customerBalances,
  employees, locations, userLocations, userCompanyRoles, companies,
  auditLog, users, FEATURE_KEYS, companySettings,
  purchaseOrders, poLineItems, interCompanyTransfers,
  insertInterCompanyTransferSchema, insertContainerSaleSchema, containerSales,
  insertUserPreferencesSchema, userPreferences,
  insertDraftPosSaleSchema, InsertDraftPosSale,
  insertSalaryAdvanceSchema, insertSalaryAdvanceDeductionSchema,
  salaryAdvances, salaryAdvanceDeductions,
  fiscalPeriodClosures, wasteDispatches, wasteDispatchItems,
  dashboardCashAccounts, dashboardPayableAccounts, dashboardAccountSelections,
  insertDashboardCashAccountSchema, insertDashboardPayableAccountSchema,
  insertDashboardAccountSelectionSchema,
  creditNoteItems, pendingBarcodes, insertPendingBarcodeSchema,
  bales, baleProducts, baleProductCategories, storedFiles,
  stockItemLocationPrices, insertCustomerSchema,
  posShifts,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../netPositionHelper";
import { sendWhatsAppTextToChatId } from "../services/whatsappService";


export function registerPosRoutes(app: Express) {
  app.post("/api/pos/sales", requireAuth, canModifyDate("voucherDate"), async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const {
        locationId,
        cashAccountId,
        paymentAccountType,
        paymentAccountId,
        items,
        notes,
        isCreditSale,
        voucherDate: providedVoucherDate,
        shiftId,
        currency,
        exchangeRate,
      } = req.body;

      // Determine account type and ID by validating against actual database records
      let accountType: string;
      let accountId: number;
      let customerAccount: any = null;

      if (isCreditSale) {
        // Credit sales must use a customer receivable ledger account (Asset type)
        if (!paymentAccountId) {
          return res.status(400).json({
            message: "Customer account is required for credit sales",
          });
        }

        const [fetchedCustomerAccount] = await db
          .select()
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.id, paymentAccountId),
              eq(ledgerAccounts.companyId, req.session.currentCompanyId!)
            )
          )
          .limit(1);

        if (!fetchedCustomerAccount) {
          return res.status(400).json({
            message: "Invalid customer account - account not found or does not belong to this company",
          });
        }

        if (fetchedCustomerAccount.accountType !== "Asset") {
          return res.status(400).json({
            message: `Invalid customer account type: ${fetchedCustomerAccount.accountType}. Credit sales require Asset-type accounts (customer receivables).`,
          });
        }

        customerAccount = fetchedCustomerAccount;
        accountType = "credit";
        accountId = paymentAccountId;
      } else if (cashAccountId) {
        // Legacy: cashAccountId parameter - validate it's a cash ledger account in current company
        const [cashLedger] = await db
          .select()
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.id, cashAccountId),
              eq(ledgerAccounts.companyId, req.session.currentCompanyId!)
            )
          )
          .limit(1);

        if (!cashLedger) {
          return res.status(400).json({
            message: "Invalid cash account - account not found or does not belong to this company",
          });
        }

        if (cashLedger.accountType !== "Cash") {
          return res.status(400).json({
            message: `Invalid cash account type: ${cashLedger.accountType}. The cashAccountId parameter must refer to a Cash-type ledger account.`,
          });
        }

        accountType = "cash";
        accountId = cashAccountId;
      } else if (paymentAccountId) {
        // Infer account type by checking if ID exists in ledger accounts or bank accounts
        // IMPORTANT: Scope by company to prevent cross-tenant access
        const [ledgerAccount] = await db
          .select()
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.id, paymentAccountId),
              eq(ledgerAccounts.companyId, req.session.currentCompanyId!)
            )
          )
          .limit(1);

        if (ledgerAccount) {
          // It's a ledger account - validate it's appropriate for POS sales
          if (ledgerAccount.accountType === "Cash") {
            accountType = "cash";
            accountId = paymentAccountId;
          } else if (ledgerAccount.accountType === "Asset") {
            // Asset accounts are customer receivables - should only be used for credit sales
            return res.status(400).json({
              message: "Asset accounts (customer receivables) can only be used for credit sales. Please enable 'Credit Sale' or select a Cash/Bank account.",
            });
          } else {
            // Other ledger account types (Expense, Liability, etc.) are not valid for POS sales
            return res.status(400).json({
              message: `Invalid payment account type: ${ledgerAccount.accountType}. POS sales require Cash accounts or Bank accounts for cash/bank payments, or Asset accounts for credit sales.`,
            });
          }
        } else {
          // Check if it's a bank account
          const [bankAccount] = await db
            .select()
            .from(bankAccounts)
            .where(
              and(
                eq(bankAccounts.id, paymentAccountId),
                eq(bankAccounts.companyId, req.session.currentCompanyId!)
              )
            )
            .limit(1);

          if (bankAccount) {
            accountType = "bank";
            accountId = paymentAccountId;
          } else {
            return res.status(400).json({
              message: "Invalid payment account ID - account not found or does not belong to this company",
            });
          }
        }
      } else {
        return res.status(400).json({
          message: "Payment account is required",
        });
      }

      console.log("[POS Sale] Payment info:", {
        provided: { paymentAccountType, paymentAccountId, cashAccountId, isCreditSale },
        resolved: { accountType, accountId },
      });

      // Validate required fields
      if (!locationId) {
        return res.status(400).json({ message: "Location is required" });
      }

      // Validate shiftId if provided - must be open, owned by user, and in same company
      if (shiftId) {
        const shift = await storage.getShiftById(shiftId);
        if (!shift) {
          return res.status(400).json({ message: "Invalid shift ID" });
        }
        if (shift.companyId !== req.session.currentCompanyId) {
          return res.status(403).json({ message: "Shift does not belong to current company" });
        }
        if (shift.locationId !== locationId) {
          return res.status(400).json({ message: "Shift location does not match sale location" });
        }
        if (shift.status !== "open") {
          return res.status(400).json({ message: "Cannot add sale to closed shift" });
        }
        if (shift.userId !== req.user?.id) {
          return res.status(403).json({ message: "Cannot add sale to another user's shift" });
        }
      }
      if (!accountId) {
        return res
          .status(400)
          .json({
            message: isCreditSale
              ? "Customer is required"
              : "Payment account is required",
          });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res
          .status(400)
          .json({ message: "At least one item is required" });
      }

      // Input validation assertions for inventory safety
      const parsedLocationId = Number(locationId);
      if (!locationId || isNaN(parsedLocationId)) {
        return res.status(400).json({ message: `Invalid locationId: ${locationId}` });
      }
      for (const item of items) {
        if (!item.stockItemId || isNaN(Number(item.stockItemId))) {
          return res.status(400).json({ message: `Invalid stockItemId: ${item.stockItemId}` });
        }
        const qty = parseFloat(item.quantity);
        if (isNaN(qty) || !isFinite(qty) || qty <= 0) {
          return res.status(400).json({ message: `Invalid quantity for item ${item.stockItemId}: ${item.quantity}` });
        }
      }

      // Validate and calculate total
      let grandTotal = 0;
      for (const item of items) {
        if (!item.stockItemId) {
          return res
            .status(400)
            .json({ message: "Stock item ID is required for all items" });
        }
        if (!item.quantity || parseFloat(item.quantity) <= 0) {
          return res
            .status(400)
            .json({ message: "Quantity must be positive for all items" });
        }
        if (!item.rate || parseFloat(item.rate) < 0) {
          return res
            .status(400)
            .json({ message: "Rate must be non-negative for all items" });
        }
        grandTotal += parseFloat(item.quantity) * parseFloat(item.rate);
      }

      // Get or create SALES revenue account (outside transaction for simplicity)
      const allAccounts = await storage.getAllLedgerAccounts(
        req.session.currentCompanyId!,
      );
      let salesAccount = allAccounts.find((a: any) => a.code === "SALES");

      if (!salesAccount) {
        salesAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId!,
          code: "SALES",
          name: "Sales Revenue",
          accountType: "Income",
          openingBalance: "0",
          active: true,
        });
      } else if (salesAccount.accountType !== "Income") {
        // Validate that Sales account is of type Income for proper import cycle balance
        console.warn(`[POS Sale] WARNING: SALES account has type "${salesAccount.accountType}" instead of "Income". This will cause import cycle imbalance!`);
        return res.status(400).json({
          message: `The SALES account is configured with type "${salesAccount.accountType}" but must be type "Income" for POS sales to work correctly. Please update the SALES account type in Accounts page.`,
        });
      }

      // Get location details
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      if (location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Location does not belong to the current company" });
      }

      // STEP 1: Validate inventory availability
      const voucherNumber = `SALES-${Date.now()}`;
      const voucherDate = providedVoucherDate || getClientDate(req);

      // STEP 1a: Validate inventory rows
      const inventoryValidation: Array<{
        item: any;
        inventoryRecord: any;
        currentQty: number;
        saleQty: number;
        newQty: number;
        currentRate: number;
      }> = [];

      for (const item of items) {
        const [inventoryRecord] = await db
          .select({
            id: inventory.id,
            locationId: inventory.locationId,
            stockItemId: inventory.stockItemId,
            quantity: inventory.quantity,
            averageRate: inventory.averageRate,
            itemName: stockItems.name,
          })
          .from(inventory)
          .leftJoin(stockItems, eq(stockItems.id, inventory.stockItemId))
          .where(
            and(
              eq(inventory.locationId, locationId),
              eq(inventory.stockItemId, item.stockItemId),
            ),
          );

        if (!inventoryRecord) {
          throw new Error(
            `Inventory not found for item ${item.stockItemId} at location ${locationId}`,
          );
        }

        const currentQty = parseFloat(inventoryRecord.quantity);
        const saleQty = parseFloat(item.quantity);
        const itemDisplayName = inventoryRecord.itemName || `item ${item.stockItemId}`;

        // Check if user can sell negative stock
        const canSellNegativeStock = req.user?.canSellNegativeStock || false;

        if (currentQty < saleQty && !canSellNegativeStock) {
          throw new Error(
            `"${itemDisplayName}" quantity requested (${saleQty}) is more than available stock (${currentQty})`,
          );
        }

        inventoryValidation.push({
          item,
          inventoryRecord,
          currentQty,
          saleQty,
          newQty: currentQty - saleQty,
          currentRate: parseFloat(inventoryRecord.averageRate),
        });
      }

      // STEP 1b: Create accounting records, update inventory, and create sales items
      // All wrapped in a single DB transaction for atomicity
      let voucher: any;
      let saleItems: any[] = [];

      const txResult = await db.transaction(async (tx) => {
        const [txVoucher] = await tx
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId!,
            locationId,
            locationName: location.name,
            voucherNumber,
            voucherType: "Sales",
            voucherDate,
            description: notes || `POS Sale at ${location.name}`,
            totalAmount: grandTotal.toFixed(2),
            shiftId: shiftId || null,
            currency: currency || "USD",
            exchangeRate: exchangeRate || null,
            isCreditSale: !!isCreditSale,
          })
          .returning();

        const creditSaleNarration = isCreditSale
          ? `POS - ${(customerAccount as any).name} - ${location.name}`
          : `POS Sale - ${voucherNumber}`;

        const debitEntry: any = {
          voucherId: txVoucher.id,
          debitAmount: grandTotal.toFixed(2),
          creditAmount: "0",
          narration: creditSaleNarration,
        };

        if (
          isCreditSale ||
          accountType === "cash" ||
          accountType === "credit"
        ) {
          debitEntry.ledgerAccountId = accountId;
          console.log("[POS Sale] Using ledgerAccountId for cash/credit:", accountId);
        } else {
          debitEntry.bankAccountId = accountId;
          console.log("[POS Sale] Using bankAccountId for bank:", accountId);
        }

        console.log("[POS Sale] Debit entry:", debitEntry);
        await tx.insert(voucherEntries).values(debitEntry);

        await tx.insert(voucherEntries).values({
          voucherId: txVoucher.id,
          ledgerAccountId: salesAccount.id,
          debitAmount: "0",
          creditAmount: grandTotal.toFixed(2),
          narration: creditSaleNarration,
        });

        const txSaleItems: any[] = [];

        for (const validatedItem of inventoryValidation) {
          const { item, newQty, currentRate, inventoryRecord, currentQty, saleQty } =
            validatedItem;

          await adjustInventory(tx, locationId, item.stockItemId, -saleQty, req.session.currentCompanyId!);

          const [stockItem] = await tx
            .select()
            .from(stockItems)
            .where(eq(stockItems.id, item.stockItemId));

          const qty = parseFloat(item.quantity);
          const sellingPrice = parseFloat(item.rate) || 0;
          const costPrice = currentRate;
          const totalSales = qty * sellingPrice;
          const totalCost = qty * costPrice;
          const profit = totalSales - totalCost;

          // Get configured selling price from location prices BEFORE insert so we can persist it
          const [locPrice] = await tx
            .select()
            .from(stockItemLocationPrices)
            .where(
              and(
                eq(stockItemLocationPrices.stockItemId, item.stockItemId),
                eq(stockItemLocationPrices.locationId, locationId)
              )
            )
            .limit(1);
          const configuredPrice = locPrice?.sellingPrice || stockItem?.sellingPrice || "0";
          const configuredPriceNum = parseFloat(configuredPrice);

          await tx.insert(salesItems).values({
            voucherId: txVoucher.id,
            stockItemId: item.stockItemId,
            quantity: qty.toString(),
            sellingPrice: sellingPrice.toFixed(2),
            costPrice: costPrice.toFixed(2),
            totalSales: totalSales.toFixed(2),
            totalCost: totalCost.toFixed(2),
            profit: profit.toFixed(2),
            configuredPrice: configuredPriceNum.toFixed(6),
          });
          const profitPerUnit = sellingPrice - configuredPriceNum;
          const totalProfitVsConfigured = profitPerUnit * qty;

          txSaleItems.push({
            ...item,
            stockItemName: stockItem?.name || "",
            stockItemCode: stockItem?.code || "",
            amount: totalSales.toFixed(2),
            configuredPrice: configuredPriceNum.toFixed(2),
            profitPerUnit: profitPerUnit.toFixed(2),
            totalProfitVsConfigured: totalProfitVsConfigured.toFixed(2),
          });
        }

        return { voucher: txVoucher, saleItems: txSaleItems };
      });

      voucher = txResult.voucher;
      saleItems = txResult.saleItems;

      const result = { voucher, saleItems };

      // ── Intercompany POS auto-transfer (non-blocking, cash sales only) ──
      if (!isCreditSale && accountType === "cash") {
        // fire-and-forget; never let errors surface to the client
        runIntercompanyPosTransfer(
          req.session.currentCompanyId!,
          accountId,
          grandTotal,
          voucherDate,
        ).catch((err) => console.error("[IntercompanyPOS] Unhandled:", err));
      }

      // Return complete sale details
      res.json({
        voucher: result.voucher,
        location,
        items: result.saleItems,
        grandTotal: grandTotal.toFixed(2),
        voucherNumber,
        saleDate: voucherDate,
        isCreditSale,
        customer: customerAccount
          ? {
              id: customerAccount.id,
              code: customerAccount.code,
              name: customerAccount.name,
            }
          : null,
      });
    } catch (error: any) {
      // Return appropriate status codes for different error types
      if (error.message.includes("Inventory not found")) {
        return res.status(404).json({ message: error.message });
      }
      if (error.message.includes("Insufficient stock")) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: error.message });
    }
  });

  // Update existing sales voucher
  app.put("/api/vouchers/:id/sales", requireAuth, canModifyDate("voucherDate"), async (req, res) => {
    try {
      const voucherId = parseInt(req.params.id);
      if (isNaN(voucherId)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { description, items, paymentAccountType, paymentAccountId, isCreditSale, voucherDate, locationId: newLocationId } = req.body;

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
        .where(
          and(
            eq(vouchers.id, voucherId),
            eq(vouchers.companyId, req.session.currentCompanyId)
          )
        )
        .limit(1);

      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      if (existingVoucher.voucherType !== "Sales") {
        return res.status(400).json({ message: "Only Sales vouchers can be updated with this endpoint" });
      }

      // Determine target location - use new location if provided, otherwise keep existing
      const oldLocationId = existingVoucher.locationId!;
      const targetLocationId = newLocationId ? parseInt(newLocationId) : oldLocationId;
      const locationChanged = targetLocationId !== oldLocationId;

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
      const oldSalesItems = await db
        .select()
        .from(salesItems)
        .where(eq(salesItems.voucherId, voucherId));

      // Create map of old items by line ID for cost preservation (not stockItemId to handle duplicates)
      const oldItemsMap = new Map(
        oldSalesItems.map(item => [item.id, item])
      );

      // Get existing voucher entries to recreate them
      const oldEntries = await db
        .select()
        .from(voucherEntries)
        .where(eq(voucherEntries.voucherId, voucherId));

      // Begin transaction
      await db.transaction(async (tx) => {
        // Reverse old inventory movements
        for (const oldItem of oldSalesItems) {
          const oldQty = parseFloat(oldItem.quantity);
          const oldCost = parseFloat(oldItem.costPrice || "0");
          
          // Add back the old quantity to inventory (reversal of sale)
          await adjustInventory(tx, existingVoucher.locationId!, oldItem.stockItemId, oldQty, existingVoucher.companyId, oldCost);
        }

        // Delete old sales items and voucher entries
        await tx.delete(salesItems).where(eq(salesItems.voucherId, voucherId));
        await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));

        // Check if user can sell negative stock
        const canSellNegativeStock = req.user?.canSellNegativeStock || false;

        // Create new sales items and apply new inventory movements
        let grandTotal = 0;
        for (const item of items) {
          const { id, stockItemId, quantity, sellingPrice } = item;

          // Get inventory record for validation and deduction
          let [inventoryRecord] = await tx
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.locationId, targetLocationId),
                eq(inventory.stockItemId, stockItemId)
              )
            )
            .limit(1);

          const currentQty = inventoryRecord ? parseFloat(inventoryRecord.quantity) : 0;
          const sellQty = parseFloat(quantity);

          // Only check stock if user cannot sell negative stock
          if (currentQty < sellQty && !canSellNegativeStock) {
            throw new Error(`Insufficient stock for item ${stockItemId}. Available: ${currentQty}, Requested: ${sellQty}`);
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
        }

        // Update voucher description, total amount, location, and optionally date
        const voucherUpdate: any = {
          description: description || null,
          totalAmount: grandTotal.toString(),
        };
        if (locationChanged) {
          voucherUpdate.locationId = targetLocationId;
          console.log(`[POS Sales Edit] Updated voucher ${voucherId} location from ${oldLocationId} to ${targetLocationId}`);
        }
        if (voucherDate) {
          voucherUpdate.voucherDate = new Date(voucherDate);
        }
        await tx
          .update(vouchers)
          .set(voucherUpdate)
          .where(eq(vouchers.id, voucherId));

        // Recreate voucher entries with new total
        // Get original entries for reference
        const paymentEntry = oldEntries.find(e => parseFloat(e.debitAmount || "0") > 0);
        const revenueEntry = oldEntries.find(e => parseFloat(e.creditAmount || "0") > 0);

        if (!paymentEntry || !revenueEntry) {
          throw new Error("Original voucher entries not found");
        }

        // Determine payment account - use new values if provided, otherwise preserve original
        let newDebitEntry: any = {
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

        // Create new credit entry (sales revenue) - always preserve original
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
      });

      // Fetch updated data to return for print template
      const [updatedVoucher] = await db
        .select()
        .from(vouchers)
        .where(eq(vouchers.id, voucherId))
        .limit(1);

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
        const updatedEntries = await db
          .select()
          .from(voucherEntries)
          .where(eq(voucherEntries.voucherId, voucherId));
        const debitEntry = updatedEntries.find(e => parseFloat(e.debitAmount || "0") > 0);
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
        recalculateIntercompanyForDate(req.session.currentCompanyId!, d)
          .catch((err) => console.error("[IntercompanyPOS Recalc] Unhandled:", err));
      }

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
      if (error.message.includes("Inventory not found")) {
        return res.status(404).json({ message: error.message });
      }
      if (error.message.includes("Insufficient stock")) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: error.message });
    }
  });

  // POS Shift Management Routes
  // Get current open shift for user at location
  app.get("/api/pos/shifts/current", requireAuth, async (req, res) => {
    try {
      const locationId = parseInt(req.query.locationId as string);
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }
      if (!locationId) {
        return res.status(400).json({ message: "Location ID is required" });
      }

      // Verify location belongs to current company
      const location = await storage.getLocationById(locationId);
      if (!location || location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const shift = await storage.getCurrentShift(userId, locationId);
      res.json(shift || null);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get shift history for a location
  app.get("/api/pos/shifts/history", requireAuth, async (req, res) => {
    try {
      const locationId = parseInt(req.query.locationId as string);
      const limit = parseInt(req.query.limit as string) || 50;
      
      if (!locationId) {
        return res.status(400).json({ message: "Location ID is required" });
      }

      // Verify location belongs to current company
      const location = await storage.getLocationById(locationId);
      if (!location || location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const shifts = await storage.getShiftsByLocation(locationId, limit);
      res.json(shifts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get shift by ID with report data
  app.get("/api/pos/shifts/:id", requireAuth, async (req, res) => {
    try {
      const shiftId = parseInt(req.params.id);
      const shift = await storage.getShiftById(shiftId);
      
      if (!shift) {
        return res.status(404).json({ message: "Shift not found" });
      }

      // Verify shift belongs to current company
      if (shift.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(shift);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Open a new shift
  app.post("/api/pos/shifts/open", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.id;
      const username = req.user?.username;
      
      if (!userId || !username) {
        return res.status(401).json({ message: "User not authenticated" });
      }
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { locationId, cashAccountId, openingCash, posStation } = req.body;

      if (!locationId) {
        return res.status(400).json({ message: "Location is required" });
      }

      // Verify location belongs to current company
      const location = await storage.getLocationById(locationId);
      if (!location || location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Invalid location" });
      }

      // Check if user already has an open shift at this location
      const existingShift = await storage.getCurrentShift(userId, locationId);
      if (existingShift) {
        return res.status(400).json({ 
          message: "You already have an open shift at this location. Please close it first.",
          existingShiftId: existingShift.id
        });
      }

      const shift = await storage.openShift({
        companyId: req.session.currentCompanyId,
        locationId,
        userId,
        username,
        cashAccountId: cashAccountId || null,
        posStation: posStation || null,
        openingCash: openingCash || "0",
        status: "open",
      });

      res.json(shift);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Close a shift
  app.post("/api/pos/shifts/:id/close", requireAuth, async (req, res) => {
    try {
      const shiftId = parseInt(req.params.id);
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const shift = await storage.getShiftById(shiftId);
      if (!shift) {
        return res.status(404).json({ message: "Shift not found" });
      }

      // Verify user owns this shift and it belongs to current company
      if (shift.userId !== userId) {
        return res.status(403).json({ message: "You can only close your own shifts" });
      }
      if (shift.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (shift.status === "closed") {
        return res.status(400).json({ message: "Shift is already closed" });
      }

      const { closingCash, notes } = req.body;
      
      if (closingCash === undefined || closingCash === null) {
        return res.status(400).json({ message: "Closing cash amount is required" });
      }

      const closedShift = await storage.closeShift(shiftId, closingCash.toString(), notes);
      res.json(closedShift);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get last sold prices for all stock items in the company
  // Get last sold prices for all stock items (based on location's company)
  app.get("/api/pos/last-sold-prices", requireAuth, async (req, res) => {
    try {
      const locationId = parseInt(req.query.locationId as string);
      if (!locationId) {
        return res.status(400).json({ message: "Location ID is required" });
      }
      // Get the location to find its company
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      const prices = await storage.getLastSoldPrices(location.companyId);
      res.json(prices);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Draft POS Sales Routes
  // Get all drafts for current user
  app.get("/api/pos/drafts", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const locationId = req.query.locationId ? parseInt(req.query.locationId as string) : undefined;
      const drafts = await storage.getAllDraftPosSales(userId, locationId);
      res.json(drafts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get a specific draft by ID
  app.get("/api/pos/drafts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const draft = await storage.getDraftPosSaleById(id);
      
      if (!draft) {
        return res.status(404).json({ message: "Draft not found" });
      }

      // Verify the draft belongs to the current user
      if (draft.userId !== req.user?.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(draft);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create a new draft
  app.post("/api/pos/drafts", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const { locationId, paymentAccountType, paymentAccountId, isCreditSale, notes, items } = req.body;

      if (!locationId) {
        return res.status(400).json({ message: "Location is required" });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      const draftData: InsertDraftPosSale = {
        userId,
        locationId,
        paymentAccountType: paymentAccountType || null,
        paymentAccountId: paymentAccountId || null,
        isCreditSale: isCreditSale || false,
        notes: notes || null,
      };

      const draft = await storage.createDraftPosSale(draftData, items);
      res.status(201).json(draft);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update an existing draft
  app.patch("/api/pos/drafts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Verify the draft belongs to the current user
      const existingDraft = await storage.getDraftPosSaleById(id);
      if (!existingDraft) {
        return res.status(404).json({ message: "Draft not found" });
      }
      if (existingDraft.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { locationId, paymentAccountType, paymentAccountId, isCreditSale, notes, items } = req.body;

      const updateData: Partial<InsertDraftPosSale> = {};
      if (locationId !== undefined) updateData.locationId = locationId;
      if (paymentAccountType !== undefined) updateData.paymentAccountType = paymentAccountType;
      if (paymentAccountId !== undefined) updateData.paymentAccountId = paymentAccountId;
      if (isCreditSale !== undefined) updateData.isCreditSale = isCreditSale;
      if (notes !== undefined) updateData.notes = notes;

      const draft = await storage.updateDraftPosSale(id, updateData, items);
      res.json(draft);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete a draft
  app.delete("/api/pos/drafts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Verify the draft belongs to the current user
      const existingDraft = await storage.getDraftPosSaleById(id);
      if (!existingDraft) {
        return res.status(404).json({ message: "Draft not found" });
      }
      if (existingDraft.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      await storage.deleteDraftPosSale(id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POS Customers - GET endpoint (for POS users with canAccessCustomers permission)
  app.get("/api/pos/customers", requireAuth, async (req, res) => {
    try {
      if (!req.user?.canAccessCustomers) {
        return res.status(403).json({ message: "Access denied: You do not have permission to access customers" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const customers = await storage.getAllCustomers(req.session.currentCompanyId);

      const customersWithBalances = await Promise.all(
        customers.map(async (customer) => {
          if (customer.ledgerAccountId) {
            const entries = await storage.getVoucherEntriesByLedger(customer.ledgerAccountId);
            const openingBalance = parseFloat(customer.openingBalance || "0");
            const openingSide = customer.openingBalanceSide || "Dr";

            const balance = entries.reduce((sum, entry) => {
              const debit = parseFloat(entry.debitAmount || "0");
              const credit = parseFloat(entry.creditAmount || "0");

              if (debit > 0 && credit === 0) {
                return sum + debit;
              } else if (credit > 0 && debit === 0) {
                return sum - credit;
              }
              return sum;
            }, openingSide === "Dr" ? openingBalance : -openingBalance);

            return {
              ...customer,
              balance: Math.abs(balance),
              balanceSide: balance >= 0 ? "Dr" : "Cr",
            };
          }

          const customerBalance = await storage.getCustomerBalance(customer.id, req.session.currentCompanyId!);
          const openingBalance = parseFloat(customer.openingBalance || "0");
          const openingSide = customer.openingBalanceSide || "Dr";
          
          const totalBalance = (openingSide === "Dr" ? openingBalance : -openingBalance) + customerBalance;
          
          return {
            ...customer,
            balance: Math.abs(totalBalance),
            balanceSide: totalBalance >= 0 ? "Dr" : "Cr",
          };
        })
      );

      res.json(customersWithBalances);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POS Customers - POST endpoint (for POS users with canAccessCustomers permission)
  app.post("/api/pos/customers", requireAuth, async (req, res) => {
    try {
      if (!req.user?.canAccessCustomers) {
        return res.status(403).json({ message: "Access denied: You do not have permission to create customers" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const dataWithCompany = {
        ...req.body,
        companyId: req.session.currentCompanyId,
      };

      const parsed = insertCustomerSchema.parse(dataWithCompany);

      let code = "CUST001";
      let suffix = 1;
      const allCustomers = await storage.getAllCustomers(req.session.currentCompanyId);

      const existingCodes = allCustomers
        .map((c) => c.code)
        .filter((c) => c.startsWith("CUST"))
        .map((c) => parseInt(c.replace("CUST", "")))
        .filter((n) => !isNaN(n));

      if (existingCodes.length > 0) {
        const maxNumber = Math.max(...existingCodes);
        suffix = maxNumber + 1;
      }

      code = `CUST${suffix.toString().padStart(3, "0")}`;

      while (await storage.getCustomerByCode(code, req.session.currentCompanyId)) {
        suffix++;
        code = `CUST${suffix.toString().padStart(3, "0")}`;
      }

      const customer = await storage.createCustomer({ ...parsed, code } as any);

      const customerAccountCode = `CUST-${customer.code}`;
      let customerAccount = await storage.getLedgerAccountByCode(customerAccountCode, req.session.currentCompanyId!);

      if (!customerAccount) {
        customerAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId,
          code: customerAccountCode,
          name: `${customer.legalName} - Customer Account`,
          accountType: "Asset",
          subType: "Accounts Receivable",
          openingBalance: parsed.openingBalance || "0",
          openingBalanceSide: parsed.openingBalanceSide || "Dr",
          active: true,
        });

        await storage.updateCustomer(customer.id, {
          ledgerAccountId: customerAccount.id,
        });
      }

      res.status(201).json(customer);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ── POS WhatsApp Shift Report ─────────────────────────────────────────────
  app.post("/api/pos/send-shift-report", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const userId = req.session.userId!;

      // Determine location — POS users have an assigned location; admin can pass locationId
      let locationId: number | null = null;
      if (req.body.locationId) {
        locationId = parseInt(req.body.locationId as string);
      } else {
        const ucr = await db
          .select({ assignedLocationId: userCompanyRoles.assignedLocationId })
          .from(userCompanyRoles)
          .where(and(eq(userCompanyRoles.userId, userId), eq(userCompanyRoles.companyId, companyId)))
          .limit(1);
        locationId = ucr[0]?.assignedLocationId ?? null;
      }

      if (!locationId) return res.status(400).json({ message: "No location found for this user" });

      // Fetch location record (includes whatsapp_group_chat_id)
      const [location] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, locationId), eq(locations.companyId, companyId)))
        .limit(1);

      if (!location) return res.status(404).json({ message: "Location not found" });

      if (!location.whatsappGroupChatId) {
        return res.status(400).json({ message: "WhatsApp group not configured for this location" });
      }

      // Fetch current stock for this location
      const stockRows = await db
        .select({
          name: stockItems.name,
          unit: stockItems.uom,
          quantity: inventory.quantity,
          groupName: stockGroups.name,
        })
        .from(inventory)
        .innerJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
        .where(and(eq(inventory.locationId, locationId), eq(inventory.companyId, companyId)))
        .orderBy(asc(stockGroups.name), asc(stockItems.name));

      // Fetch today's open or most-recently-closed shift for context
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const shifts = await db
        .select()
        .from(posShifts)
        .where(
          and(
            eq(posShifts.locationId, locationId),
            eq(posShifts.companyId, companyId),
            gte(posShifts.openedAt, today),
          )
        )
        .orderBy(desc(posShifts.openedAt))
        .limit(1);

      const shift = shifts[0] ?? null;
      const now = new Date();
      const dateStr = format(now, "dd MMM yyyy, h:mm a");

      // Build grouped stock lines
      let lastGroup = "";
      const stockLines: string[] = [];
      for (const row of stockRows) {
        const qty = parseFloat(row.quantity ?? "0");
        const group = row.groupName ?? "General";
        if (group !== lastGroup) {
          stockLines.push(`\n*${group}*`);
          lastGroup = group;
        }
        const flag = qty < 0 ? " ⚠️" : "";
        const unitLabel = row.unit ? ` ${row.unit}` : "";
        stockLines.push(`  • ${row.name}: ${qty.toLocaleString()}${unitLabel}${flag}`);
      }

      const stockSection = stockLines.length
        ? stockLines.join("\n")
        : "  No stock data available";

      const salesLine = shift
        ? `*Sales Today:* ${shift.salesCount ?? 0} transactions | ${parseFloat(shift.salesTotal ?? "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "";

      const senderName = req.user?.username || userId;

      const message = [
        `📍 *${location.name} — Stock Report*`,
        `🕐 Sent by ${senderName} on ${dateStr}`,
        ``,
        `*Current Stock:*${stockSection}`,
        ``,
        salesLine,
      ]
        .filter((l) => l !== undefined)
        .join("\n")
        .trim();

      const result = await sendWhatsAppTextToChatId(location.whatsappGroupChatId, message);
      if (!result.success) {
        return res.status(502).json({ message: result.error ?? "Failed to send WhatsApp message" });
      }

      res.json({ success: true, message: "Stock report sent to WhatsApp" });
    } catch (error: any) {
      console.error("[/api/pos/send-shift-report]", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Transfers - LIST all for current company (with location names and item counts)
}
