import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import {
  upload,
  logAudit,
  getCurrentExchangeRate,
  calculateHistoricalLocationInventory,
  syncEmployeeBalancesFromEntries,
  buildItemLevelChanges,
} from "./_helpers";
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
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../netPositionHelper";
import path from "path";
import fs from "fs";

/**
 * Find the "Sales Returns & Allowances" account for a company, or create one
 * if it doesn't exist. Used to post the variance between refund price and
 * inventory cost on Credit / Debit Notes.
 * Never falls back to a random Indirect Expense account.
 */
async function getOrCreateSalesReturnsAccount(companyId: number, txOrDb: any = db): Promise<number | null> {
  // 1. Existing account whose name contains "sales return" (case-insensitive)
  const byName = await txOrDb
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.companyId, companyId),
        or(ilike(ledgerAccounts.name, "%sales return%"), ilike(ledgerAccounts.name, "%return%allowance%"))
      )
    )
    .limit(1);
  if (byName.length > 0) return byName[0].id;

  // 2. Already auto-created under the canonical code
  const byCode = await txOrDb
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, "SALES-RETURNS")))
    .limit(1);
  if (byCode.length > 0) return byCode[0].id;

  // 3. Create it — Income type because it's a contra-revenue account
  const [created] = await txOrDb
    .insert(ledgerAccounts)
    .values({
      companyId,
      code: "SALES-RETURNS",
      name: "Sales Returns & Allowances",
      accountType: "Income",
      active: true,
      isHidden: false,
    })
    .returning({ id: ledgerAccounts.id });
  return created?.id ?? null;
}

export function registerCreditNoteRoutes(app: Express) {
  app.post("/api/credit-notes", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const {
        noteType, // "Credit Note" or "Debit Note"
        voucherDate,
        cashAccountId,
        cashAccountType, // "ledger" or "bank"
        description,
        items, // Array of { stockItemId, locationId, quantity, refundRate, inventoryCost }
      } = req.body;

      if (!noteType || !["Credit Note", "Debit Note"].includes(noteType)) {
        return res.status(400).json({ message: "Invalid note type. Must be 'Credit Note' or 'Debit Note'" });
      }

      if (!voucherDate) {
        return res.status(400).json({ message: "Voucher date is required" });
      }

      if (!cashAccountId || !cashAccountType) {
        return res.status(400).json({ message: "Cash/Bank account is required" });
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      // Input validation assertions for inventory safety
      for (const item of items) {
        if (!item.stockItemId || isNaN(Number(item.stockItemId))) {
          return res.status(400).json({ message: `Invalid stockItemId: ${item.stockItemId}` });
        }
        if (!item.locationId || isNaN(Number(item.locationId))) {
          return res
            .status(400)
            .json({ message: `Invalid locationId for item ${item.stockItemId}: ${item.locationId}` });
        }
        const qty = parseFloat(item.quantity);
        if (isNaN(qty) || !isFinite(qty) || qty <= 0) {
          return res.status(400).json({ message: `Invalid quantity for item ${item.stockItemId}: ${item.quantity}` });
        }
      }

      // Calculate totals - refund amount (customer gets) and inventory value (goes to stock)
      let totalRefundAmount = 0;
      let totalInventoryValue = 0;
      for (const item of items) {
        const qty = parseFloat(item.quantity);
        const refundRate = parseFloat(item.refundRate || item.rate || "0");
        const inventoryCost = parseFloat(item.inventoryCost || item.rate || "0");
        if (isNaN(qty) || qty <= 0) {
          return res.status(400).json({ message: "Invalid quantity for item" });
        }
        if (isNaN(refundRate) || refundRate < 0) {
          return res.status(400).json({ message: "Invalid refund rate for item" });
        }
        totalRefundAmount += qty * refundRate;
        totalInventoryValue += qty * inventoryCost;
      }

      // Generate voucher number
      const timestamp = Date.now();
      const prefix = noteType === "Credit Note" ? "CN" : "DN";
      const voucherNumber = `${prefix}-${timestamp}`;

      // Create the voucher (total is the refund amount)
      const voucher = await db.transaction(async (tx) => {
        const [createdVoucher] = await tx
          .insert(vouchers)
          .values({
            companyId,
            voucherNumber,
            voucherType: noteType,
            voucherDate,
            description: description || `${noteType} for customer return`,
            totalAmount: totalRefundAmount.toFixed(2),
          })
          .returning();

        // Create voucher entries for the cash account using the REFUND amount
        if (cashAccountType === "bank") {
          await tx.insert(voucherEntries).values({
            voucherId: createdVoucher.id,
            bankAccountId: cashAccountId,
            debitAmount: noteType === "Debit Note" ? totalRefundAmount.toFixed(2) : "0",
            creditAmount: noteType === "Credit Note" ? totalRefundAmount.toFixed(2) : "0",
            narration: `${noteType} - cash ${noteType === "Credit Note" ? "refund" : "receipt"}`,
          });
        } else {
          await tx.insert(voucherEntries).values({
            voucherId: createdVoucher.id,
            ledgerAccountId: cashAccountId,
            debitAmount: noteType === "Debit Note" ? totalRefundAmount.toFixed(2) : "0",
            creditAmount: noteType === "Credit Note" ? totalRefundAmount.toFixed(2) : "0",
            narration: `${noteType} - cash ${noteType === "Credit Note" ? "refund" : "receipt"}`,
          });
        }

        // For each item, process inventory (using inventoryCost) and track refund amounts
        for (const item of items) {
          const {
            stockItemId,
            locationId,
            quantity,
            refundRate: itemRefundRate,
            inventoryCost: itemInventoryCost,
          } = item;
          const qty = parseFloat(quantity);
          const refundRateVal = parseFloat(itemRefundRate || "0");
          const inventoryCostVal = parseFloat(itemInventoryCost || "0");
          const inventoryValue = qty * inventoryCostVal;

          const [location] = await tx.select().from(locations).where(eq(locations.id, locationId));

          if (!location) {
            throw new Error(`Location ${locationId} not found`);
          }

          if (noteType === "Credit Note") {
            // Do NOT pass a rate — cost price must never change due to POS/credit-note returns.
            await adjustInventory(tx, locationId, stockItemId, qty, companyId);

            const inventoryAccount = await tx
              .select()
              .from(ledgerAccounts)
              .where(
                and(
                  eq(ledgerAccounts.companyId, companyId),
                  or(ilike(ledgerAccounts.name, "%inventory%"), ilike(ledgerAccounts.name, "%stock in hand%"))
                )
              )
              .limit(1);

            if (inventoryAccount.length > 0) {
              await tx.insert(voucherEntries).values({
                voucherId: createdVoucher.id,
                ledgerAccountId: inventoryAccount[0].id,
                debitAmount: inventoryValue.toFixed(2),
                creditAmount: "0",
                narration: `Inventory restored - ${noteType}`,
              });
            }
          } else {
            await adjustInventory(tx, locationId, stockItemId, -qty, companyId);

            const inventoryAccount = await tx
              .select()
              .from(ledgerAccounts)
              .where(
                and(
                  eq(ledgerAccounts.companyId, companyId),
                  or(ilike(ledgerAccounts.name, "%inventory%"), ilike(ledgerAccounts.name, "%stock in hand%"))
                )
              )
              .limit(1);

            if (inventoryAccount.length > 0) {
              await tx.insert(voucherEntries).values({
                voucherId: createdVoucher.id,
                ledgerAccountId: inventoryAccount[0].id,
                debitAmount: "0",
                creditAmount: inventoryValue.toFixed(2),
                narration: `Inventory reduced - ${noteType}`,
              });
            }
          }

          await tx.insert(creditNoteItems).values({
            voucherId: createdVoucher.id,
            stockItemId,
            locationId,
            quantity: qty.toFixed(3),
            rate: refundRateVal.toFixed(2),
            inventoryCost: inventoryCostVal.toFixed(2),
            totalValue: (qty * refundRateVal).toFixed(2),
          });
        }

        // Handle variance
        const variance = totalRefundAmount - totalInventoryValue;
        if (Math.abs(variance) > 0.01) {
          const salesReturnsAccountId = await getOrCreateSalesReturnsAccount(companyId, tx);
          if (salesReturnsAccountId) {
            if (noteType === "Credit Note") {
              await tx.insert(voucherEntries).values({
                voucherId: createdVoucher.id,
                ledgerAccountId: salesReturnsAccountId,
                debitAmount: variance > 0 ? variance.toFixed(2) : "0",
                creditAmount: variance < 0 ? Math.abs(variance).toFixed(2) : "0",
                narration: `Variance between refund and inventory cost`,
              });
            } else {
              await tx.insert(voucherEntries).values({
                voucherId: createdVoucher.id,
                ledgerAccountId: salesReturnsAccountId,
                debitAmount: variance < 0 ? Math.abs(variance).toFixed(2) : "0",
                creditAmount: variance > 0 ? variance.toFixed(2) : "0",
                narration: `Variance between debit note amount and inventory cost`,
              });
            }
          }
        }

        return createdVoucher;
      });

      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: companyId,
          action: "create",
          tableName: "vouchers",
          recordId: voucher.id,
          recordIdentifier: voucher.voucherNumber,
          changes: {
            voucherType: { new: noteType },
            date: { new: voucherDate },
            totalAmount: { new: totalRefundAmount.toFixed(2) },
            itemCount: { new: items.length },
            cashAccount: { new: cashAccountId },
          },
        });
      } catch {
        /* non-fatal */
      }
      res.json({
        success: true,
        voucherId: voucher.id,
        voucherNumber: voucher.voucherNumber,
        message: `${noteType} created successfully`,
      });
    } catch (error: any) {
      console.error("Credit/Debit note error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET credit note details for editing
  app.get("/api/credit-notes/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const voucherId = parseInt(req.params.id);
      if (isNaN(voucherId)) {
        return res.status(400).json({ message: "Invalid credit note ID" });
      }

      // Get voucher
      const [voucher] = await db
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, companyId)));

      if (!voucher) {
        return res.status(404).json({ message: "Credit note not found" });
      }

      if (!["Credit Note", "Debit Note"].includes(voucher.voucherType || "")) {
        return res.status(400).json({ message: "Not a credit/debit note" });
      }

      // Get voucher entries
      const entries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));

      // Get credit note items
      const noteItems = await db
        .select({
          id: creditNoteItems.id,
          stockItemId: creditNoteItems.stockItemId,
          locationId: creditNoteItems.locationId,
          quantity: creditNoteItems.quantity,
          rate: creditNoteItems.rate,
          totalValue: creditNoteItems.totalValue,
          stockItemName: stockItems.name,
          stockItemCode: stockItems.code,
          stockItemUom: stockItems.uom,
          locationName: locations.name,
        })
        .from(creditNoteItems)
        .leftJoin(stockItems, eq(creditNoteItems.stockItemId, stockItems.id))
        .leftJoin(locations, eq(creditNoteItems.locationId, locations.id))
        .where(eq(creditNoteItems.voucherId, voucherId));

      // Find cash account from entries
      let cashAccountId = 0;
      let cashAccountType = "";
      for (const entry of entries) {
        if (entry.bankAccountId) {
          cashAccountId = entry.bankAccountId;
          cashAccountType = "bank";
          break;
        } else if (entry.ledgerAccountId) {
          // Check if this is a cash-type account
          const [ledger] = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, entry.ledgerAccountId));
          if (ledger && ["Cash", "Bank"].includes(ledger.accountType || "")) {
            cashAccountId = entry.ledgerAccountId;
            cashAccountType = "ledger";
            break;
          }
        }
      }
      // Fetch current inventory costs for each item at its location
      // Fallback order: 1) Specific location, 2) Any location, 3) Container offload history
      const itemsWithCosts = await Promise.all(
        noteItems.map(async (item) => {
          let costRate = "0";

          // First try to find inventory at the item's location
          const [inv] = await db
            .select()
            .from(inventory)
            .where(and(eq(inventory.stockItemId, item.stockItemId), eq(inventory.locationId, item.locationId)));

          if (inv?.averageRate && parseFloat(inv.averageRate) > 0) {
            costRate = inv.averageRate;
          } else {
            // Try to find from any location
            const [anyInv] = await db
              .select()
              .from(inventory)
              .where(eq(inventory.stockItemId, item.stockItemId))
              .orderBy(desc(inventory.quantity))
              .limit(1);

            if (anyInv?.averageRate && parseFloat(anyInv.averageRate) > 0) {
              costRate = anyInv.averageRate;
            } else {
              // Final fallback: check container offload history for this item's cost
              const [offloadItem] = await db
                .select()
                .from(containerOffloadItems)
                .where(eq(containerOffloadItems.stockItemId, item.stockItemId))
                .orderBy(desc(containerOffloadItems.id))
                .limit(1);

              if (offloadItem?.rate && parseFloat(offloadItem.rate) > 0) {
                costRate = offloadItem.rate;
              }
            }
          }

          return {
            stockItemId: item.stockItemId,
            stockItemName: item.stockItemName || "",
            stockItemCode: item.stockItemCode || "",
            locationId: item.locationId,
            locationName: item.locationName || "",
            quantity: item.quantity,
            refundRate: item.rate,
            inventoryCost: costRate,
            uom: item.stockItemUom || "",
          };
        })
      );

      res.json({
        voucher: {
          id: voucher.id,
          voucherNumber: voucher.voucherNumber,
          voucherType: voucher.voucherType,
          voucherDate: voucher.voucherDate,
          description: voucher.description,
          totalAmount: voucher.totalAmount,
        },
        cashAccountId,
        cashAccountType,
        items: itemsWithCosts,
      });
    } catch (error: any) {
      console.error("Get credit note error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH credit note - reverse old entries and apply new ones
  app.patch("/api/credit-notes/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const voucherId = parseInt(req.params.id);
      if (isNaN(voucherId)) {
        return res.status(400).json({ message: "Invalid credit note ID" });
      }

      const { voucherDate, cashAccountId, cashAccountType, description, items } = req.body;

      // Get existing voucher
      const [voucher] = await db
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, companyId)));

      if (!voucher) {
        return res.status(404).json({ message: "Credit note not found" });
      }

      const noteType = voucher.voucherType;
      if (!["Credit Note", "Debit Note"].includes(noteType || "")) {
        return res.status(400).json({ message: "Not a credit/debit note" });
      }

      // Input validation assertions for inventory safety
      if (items && Array.isArray(items)) {
        for (const item of items) {
          if (!item.stockItemId || isNaN(Number(item.stockItemId))) {
            return res.status(400).json({ message: `Invalid stockItemId: ${item.stockItemId}` });
          }
          if (!item.locationId || isNaN(Number(item.locationId))) {
            return res
              .status(400)
              .json({ message: `Invalid locationId for item ${item.stockItemId}: ${item.locationId}` });
          }
          const qty = parseFloat(item.quantity);
          if (isNaN(qty) || !isFinite(qty) || qty <= 0) {
            return res.status(400).json({ message: `Invalid quantity for item ${item.stockItemId}: ${item.quantity}` });
          }
        }
      }

      // Snapshot old credit note items BEFORE the transaction (for audit diff)
      const _oldCNItems = await db.select().from(creditNoteItems).where(eq(creditNoteItems.voucherId, voucherId));

      // Wrap all mutations in a transaction
      await db.transaction(async (tx) => {
        // Get existing credit note items to reverse inventory
        const existingItems = await tx.select().from(creditNoteItems).where(eq(creditNoteItems.voucherId, voucherId));

        // REVERSE: Undo inventory changes from existing items
        for (const item of existingItems) {
          const qty = parseFloat(item.quantity || "0");
          const rate = parseFloat(item.rate || "0");
          const itemValue = qty * rate;

          if (noteType === "Credit Note") {
            await adjustInventory(tx, item.locationId, item.stockItemId, -qty, companyId);
          } else {
            // Do NOT pass a rate — cost price must never change due to POS/credit-note activity.
            await adjustInventory(tx, item.locationId, item.stockItemId, qty, companyId);
          }
        }

        // Delete old voucher entries and credit note items
        await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));
        await tx.delete(creditNoteItems).where(eq(creditNoteItems.voucherId, voucherId));

        // Calculate new totals
        let totalRefundAmount = 0;
        let totalInventoryValue = 0;
        for (const item of items) {
          const qty = parseFloat(item.quantity);
          const refundRate = parseFloat(item.refundRate || "0");
          const inventoryCost = parseFloat(item.inventoryCost || "0");
          totalRefundAmount += qty * refundRate;
          totalInventoryValue += qty * inventoryCost;
        }

        // Update voucher
        await tx
          .update(vouchers)
          .set({
            voucherDate,
            description: description || voucher.description,
            totalAmount: totalRefundAmount.toFixed(2),
          })
          .where(eq(vouchers.id, voucherId));

        // Create new cash entry
        if (cashAccountType === "bank") {
          await tx.insert(voucherEntries).values({
            voucherId,
            bankAccountId: cashAccountId,
            debitAmount: noteType === "Debit Note" ? totalRefundAmount.toFixed(2) : "0",
            creditAmount: noteType === "Credit Note" ? totalRefundAmount.toFixed(2) : "0",
            narration: `${noteType} - cash ${noteType === "Credit Note" ? "refund" : "receipt"}`,
          });
        } else {
          await tx.insert(voucherEntries).values({
            voucherId,
            ledgerAccountId: cashAccountId,
            debitAmount: noteType === "Debit Note" ? totalRefundAmount.toFixed(2) : "0",
            creditAmount: noteType === "Credit Note" ? totalRefundAmount.toFixed(2) : "0",
            narration: `${noteType} - cash ${noteType === "Credit Note" ? "refund" : "receipt"}`,
          });
        }

        // Apply new items
        for (const item of items) {
          const {
            stockItemId,
            locationId,
            quantity,
            refundRate: itemRefundRate,
            inventoryCost: itemInventoryCost,
          } = item;
          const qty = parseFloat(quantity);
          const refundRateVal = parseFloat(itemRefundRate || "0");
          const inventoryCostVal = parseFloat(itemInventoryCost || "0");
          const inventoryValue = qty * inventoryCostVal;

          const [location] = await tx.select().from(locations).where(eq(locations.id, locationId));

          if (!location) {
            throw new Error(`Location ${locationId} not found`);
          }

          if (noteType === "Credit Note") {
            // Do NOT pass a rate — cost price must never change due to POS/credit-note returns.
            await adjustInventory(tx, locationId, stockItemId, qty, companyId);

            const inventoryAccount = await tx
              .select()
              .from(ledgerAccounts)
              .where(
                and(
                  eq(ledgerAccounts.companyId, companyId),
                  or(ilike(ledgerAccounts.name, "%inventory%"), ilike(ledgerAccounts.name, "%stock in hand%"))
                )
              )
              .limit(1);

            if (inventoryAccount.length > 0) {
              await tx.insert(voucherEntries).values({
                voucherId,
                ledgerAccountId: inventoryAccount[0].id,
                debitAmount: inventoryValue.toFixed(2),
                creditAmount: "0",
                narration: `Inventory restored - ${noteType}`,
              });
            }
          } else {
            await adjustInventory(tx, locationId, stockItemId, -qty, companyId);

            const inventoryAccount = await tx
              .select()
              .from(ledgerAccounts)
              .where(
                and(
                  eq(ledgerAccounts.companyId, companyId),
                  or(ilike(ledgerAccounts.name, "%inventory%"), ilike(ledgerAccounts.name, "%stock in hand%"))
                )
              )
              .limit(1);

            if (inventoryAccount.length > 0) {
              await tx.insert(voucherEntries).values({
                voucherId,
                ledgerAccountId: inventoryAccount[0].id,
                debitAmount: "0",
                creditAmount: inventoryValue.toFixed(2),
                narration: `Inventory reduced - ${noteType}`,
              });
            }
          }

          await tx.insert(creditNoteItems).values({
            voucherId,
            stockItemId,
            locationId,
            quantity: qty.toFixed(3),
            rate: refundRateVal.toFixed(2),
            inventoryCost: inventoryCostVal.toFixed(2),
            totalValue: (qty * refundRateVal).toFixed(2),
          });
        }

        // Handle variance
        const variance = totalRefundAmount - totalInventoryValue;
        if (Math.abs(variance) > 0.01) {
          const salesReturnsAccountId = await getOrCreateSalesReturnsAccount(companyId, tx);
          if (salesReturnsAccountId) {
            if (noteType === "Credit Note") {
              await tx.insert(voucherEntries).values({
                voucherId,
                ledgerAccountId: salesReturnsAccountId,
                debitAmount: variance > 0 ? variance.toFixed(2) : "0",
                creditAmount: variance < 0 ? Math.abs(variance).toFixed(2) : "0",
                narration: `Variance between refund and inventory cost`,
              });
            } else {
              await tx.insert(voucherEntries).values({
                voucherId,
                ledgerAccountId: salesReturnsAccountId,
                debitAmount: variance < 0 ? Math.abs(variance).toFixed(2) : "0",
                creditAmount: variance > 0 ? variance.toFixed(2) : "0",
                narration: `Variance between debit note amount and inventory cost`,
              });
            }
          }
        }
      });

      try {
        const _cnChanges: Record<string, any> = {};
        if (voucherDate && voucher.voucherDate !== voucherDate)
          _cnChanges.date = { old: voucher.voucherDate, new: voucherDate };
        if (cashAccountId !== undefined)
          _cnChanges.cashAccount = { old: _oldCNItems[0]?.voucherId ?? null, new: cashAccountId };
        const _resolveCNName = async (id: number) => (await storage.getStockItemById(id))?.name ?? `Item #${id}`;
        const _cnItemDiff = items?.length
          ? await buildItemLevelChanges(
              _oldCNItems.map((it) => ({
                stockItemId: it.stockItemId,
                quantity: it.quantity,
                rate: it.rate,
                totalValue: it.totalValue,
              })),
              (items as any[]).map((it) => ({
                stockItemId: Number(it.stockItemId),
                quantity: String(it.quantity ?? ""),
                rate: String(it.refundRate ?? it.rate ?? ""),
                totalValue: String(
                  parseFloat(String(it.quantity ?? 0)) * parseFloat(String(it.refundRate ?? it.rate ?? 0))
                ),
              })),
              _resolveCNName
            )
          : {};
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: companyId,
          action: "update",
          tableName: "vouchers",
          recordId: voucherId,
          recordIdentifier: voucher.voucherNumber,
          changes: { ..._cnChanges, ..._cnItemDiff },
        });
      } catch {
        /* non-fatal */
      }
      res.json({
        success: true,
        voucherId,
        message: `${noteType} updated successfully`,
      });
    } catch (error: any) {
      console.error("Update credit note error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
