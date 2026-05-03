import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory, syncEmployeeBalancesFromEntries } from "./_helpers";
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
  
  propertyPayments, propertyMonthlyLedger,
  erpPayrollRuns, erpPayrollRunItems,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../netPositionHelper";
import { generatePDF } from "../pdfHelper";
import path from "path";
import fs from "fs";


export function registerVoucherEntryRoutes(app: Express) {
  app.get("/api/vouchers/:id/entries", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      // Verify voucher exists and belongs to current company
      const voucher = await storage.getVoucherById(id);
      if (!voucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      if (voucher.companyId !== req.session.currentCompanyId) {
        return res
          .status(403)
          .json({
            message: "Access denied: Voucher belongs to a different company",
          });
      }

      // Use storage method to get entries with account names from joins
      const entries = await storage.getVoucherEntriesByVoucher(id);
      
      // Transform entries to include accountType for the Daybook editor
      const transformedEntries = entries.map(entry => {
        let accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" | "customer" = "ledger";
        let accountId = entry.ledgerAccountId;
        
        if (entry.bankAccountId) {
          accountType = "bank";
          accountId = entry.bankAccountId;
        } else if (entry.supplierId) {
          accountType = "supplier";
          accountId = entry.supplierId;
        } else if (entry.employeeId) {
          accountType = "employee";
          accountId = entry.employeeId;
        } else if (entry.fixedAssetId) {
          accountType = "fixedAsset";
          accountId = entry.fixedAssetId;
        } else if (entry.customerId) {
          accountType = "customer";
          accountId = entry.customerId;
        }
        
        return {
          ...entry,
          accountType,
          accountId: accountId || 0,
        };
      });
      
      res.json(transformedEntries);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get voucher entries with full details for viewing (includes account names and stock items)
  app.get("/api/vouchers/:id/view-entries", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      // Verify voucher exists and belongs to current company
      const voucher = await storage.getVoucherById(id);
      if (!voucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      if (voucher.companyId !== req.session.currentCompanyId) {
        return res
          .status(403)
          .json({
            message: "Access denied: Voucher belongs to a different company",
          });
      }

      // Get regular voucher entries with account names
      const entries = await storage.getVoucherEntriesByVoucher(id);

      // For Sales vouchers, also get sales items
      if (voucher.voucherType === "Sales") {
        const userRole = req.session.currentRole;
        const isPOSUser = userRole?.startsWith("POS");

        const salesItemsList = await db
          .select({
            id: salesItems.id,
            voucherId: salesItems.voucherId,
            stockItemId: salesItems.stockItemId,
            quantity: salesItems.quantity,
            sellingPrice: salesItems.sellingPrice,
            costPrice: salesItems.costPrice,
            totalSales: salesItems.totalSales,
            profit: salesItems.profit,
            configuredPrice: salesItems.configuredPrice,
            stockItemName: stockItems.name,
            stockItemCode: stockItems.code,
          })
          .from(salesItems)
          .leftJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
          .where(eq(salesItems.voucherId, id));

        if (salesItemsList.length > 0) {
          const itemsWithDetails = salesItemsList.map((item) => {
            const qty = parseFloat(item.quantity) || 0;
            const actualPrice = parseFloat(item.sellingPrice) || 0;
            const configuredPriceNum = parseFloat(item.configuredPrice || "0");
            const hassansProfit = configuredPriceNum > 0 ? (actualPrice - configuredPriceNum) * qty : 0;
            const hassansTotal = configuredPriceNum > 0 ? configuredPriceNum * qty : 0;
            const hassansPercentage = hassansTotal > 0 ? (hassansProfit / hassansTotal) * 100 : 0;

            return {
              id: item.id,
              voucherId: item.voucherId,
              stockItemId: item.stockItemId,
              stockItemName: item.stockItemName || 'Unknown Item',
              stockItemCode: item.stockItemCode || '-',
              quantity: item.quantity,
              rate: item.sellingPrice,
              sellingPrice: item.sellingPrice,
              costPrice: isPOSUser ? null : item.costPrice,
              totalSales: item.totalSales,
              profit: isPOSUser ? null : item.profit,
              configuredPrice: configuredPriceNum > 0 ? item.configuredPrice : null,
              hassansPrice: configuredPriceNum > 0 ? configuredPriceNum.toFixed(2) : null,
              hassansProfit: configuredPriceNum > 0 ? hassansProfit.toFixed(2) : null,
              hassansPercentage: configuredPriceNum > 0 ? hassansPercentage.toFixed(1) : null,
              debitAmount: "0",
              creditAmount: item.totalSales,
              narration: `Sale of ${item.quantity} x ${item.stockItemName || 'Unknown Item'} @ $${item.sellingPrice}`,
              accountName: item.stockItemName || 'Unknown Item',
              accountCode: item.stockItemCode || '-',
              isStockItem: true,
            };
          });
          return res.json([...entries, ...itemsWithDetails]);
        }
      }

      // Check if user is a POS role (should not see cost prices)
      const userRole = req.session.currentRole;
      const isPOSUser = userRole?.startsWith("POS");

      // For Purchase vouchers, get purchase order line items
      if (voucher.voucherType === "Purchase") {
        // Find the purchase order linked to this voucher
        const allPOs = await storage.getAllPurchaseOrders(voucher.companyId);
        const purchaseOrder = allPOs.find((po: any) => po.voucherId === id);
        
        if (purchaseOrder) {
          const lineItems = await storage.getLineItemsByPO(purchaseOrder.id);
          
          if (lineItems.length > 0) {
            // Get supplier info (use legalName field from suppliers table)
            const supplier = await storage.getSupplierById(purchaseOrder.supplierId);
            const supplierName = supplier?.legalName || 'Unknown Supplier';
            const supplierCode = supplier?.code || '';
            
            // Get container info
            const container = await storage.getContainerById(purchaseOrder.containerId);
            const containerNumber = container?.containerNumber || '';
            
            const itemsWithDetails = lineItems.map((item: any) => ({
              id: item.id,
              voucherId: id,
              purchaseOrderId: purchaseOrder.id,
              stockItemId: item.stockItemId,
              stockItemName: item.stockItemName || item.itemName || 'Unknown Item',
              stockItemCode: item.stockItemCode || '-',
              quantity: item.quantity,
              // SECURITY: Redact cost prices for POS users
              rate: isPOSUser ? null : item.rate,
              totalAmount: isPOSUser ? null : (item.lineTotal || item.totalCost),
              debitAmount: isPOSUser ? "0" : (item.lineTotal || item.totalCost),
              creditAmount: "0",
              narration: isPOSUser 
                ? `${item.quantity} x ${item.stockItemName || item.itemName}`
                : `${item.quantity} x ${item.stockItemName || item.itemName} @ $${item.rate}`,
              accountName: item.stockItemName || item.itemName || 'Unknown Item',
              accountCode: item.stockItemCode || '-',
              isStockItem: true,
              isPurchaseItem: true,
            }));
            
            // SECURITY: Also redact ledger entries for POS users
            const redactedEntries = isPOSUser 
              ? entries.map((entry: any) => ({
                  ...entry,
                  debitAmount: "0",
                  creditAmount: "0",
                  narration: entry.accountName || "Account entry",
                }))
              : entries;
            
            // Add supplier entry and purchase order metadata
            const result = [
              ...redactedEntries,
              ...itemsWithDetails,
            ];
            
            // Add purchase order metadata to response (hide totals for POS users)
            return res.json({
              entries: result,
              purchaseOrder: {
                id: purchaseOrder.id,
                poNumber: purchaseOrder.poNumber,
                supplierId: purchaseOrder.supplierId,
                supplierName: supplierName,
                supplierCode: supplierCode,
                containerId: purchaseOrder.containerId,
                containerNumber: containerNumber,
                currency: purchaseOrder.currency,
                itemsTotal: isPOSUser ? null : purchaseOrder.itemsTotal,
                status: purchaseOrder.status,
                // Include individual charges for display
                freight: isPOSUser ? null : purchaseOrder.freight,
                fumigation: isPOSUser ? null : purchaseOrder.fumigation,
                surcharge: isPOSUser ? null : purchaseOrder.surcharge,
                documentCharges: isPOSUser ? null : purchaseOrder.documentCharges,
                otherCharges: isPOSUser ? null : purchaseOrder.otherCharges,
                discount: isPOSUser ? null : purchaseOrder.discount,
              }
            });
          }
        }
      }

      // For Production/Consumption/Mixed vouchers, get stock adjustment items
      if (voucher.voucherType === "Production" || voucher.voucherType === "Consumption" || voucher.voucherType === "Mixed") {
        const adjustmentVoucher = await db.query.stockAdjustmentVouchers.findFirst({
          where: eq(stockAdjustmentVouchers.voucherId, id),
        });

        if (adjustmentVoucher) {
          const adjustmentItemsList = await db
            .select({
              id: stockAdjustmentItems.id,
              adjustmentId: stockAdjustmentItems.adjustmentId,
              stockItemId: stockAdjustmentItems.stockItemId,
              quantity: stockAdjustmentItems.quantity,
              rate: stockAdjustmentItems.rate,
              totalAmount: stockAdjustmentItems.totalAmount,
              stockItemName: stockItems.name,
              stockItemCode: stockItems.code,
            })
            .from(stockAdjustmentItems)
            .leftJoin(stockItems, eq(stockAdjustmentItems.stockItemId, stockItems.id))
            .where(eq(stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));

          if (adjustmentItemsList.length > 0) {
            const itemsWithDetails = adjustmentItemsList.map((item) => {
              // For Mixed vouchers, determine Production vs Consumption by quantity sign
              // Positive quantity = Production (adding stock), Negative = Consumption (removing stock)
              const qty = parseFloat(item.quantity || "0");
              const isProduction = voucher.voucherType === "Production" || (voucher.voucherType === "Mixed" && qty > 0);
              const adjustmentLabel = voucher.voucherType === "Mixed" 
                ? (qty > 0 ? "Production" : "Consumption")
                : voucher.voucherType;
              
              return {
                id: item.id,
                voucherId: id,
                stockItemId: item.stockItemId,
                stockItemName: item.stockItemName || 'Unknown Item',
                stockItemCode: item.stockItemCode || '-',
                quantity: item.quantity,
                rate: isPOSUser ? null : item.rate,
                debitAmount: isPOSUser ? "0" : (isProduction ? item.totalAmount : "0"),
                creditAmount: isPOSUser ? "0" : (isProduction ? "0" : item.totalAmount),
                narration: isPOSUser 
                  ? `${adjustmentLabel} of ${Math.abs(qty)} x ${item.stockItemName || 'Unknown Item'}`
                  : `${adjustmentLabel} of ${Math.abs(qty)} x ${item.stockItemName || 'Unknown Item'} @ $${item.rate}`,
                accountName: item.stockItemName || 'Unknown Item',
                accountCode: item.stockItemCode || '-',
                isStockItem: true,
                totalAmount: isPOSUser ? null : item.totalAmount,
                adjustmentType: adjustmentLabel,
              };
            });
            return res.json(itemsWithDetails);
          }
        }
      }

      // For Stock Transfer vouchers, get stock transfer items
      if (voucher.voucherType === "Stock Transfer" || voucher.voucherType === "StockTransfer") {
        const transferVoucher = await db.query.stockTransferVouchers.findFirst({
          where: eq(stockTransferVouchers.voucherId, id),
        });

        if (transferVoucher) {
          const transferItemsList = await db
            .select({
              id: stockTransferItems.id,
              transferId: stockTransferItems.transferId,
              stockItemId: stockTransferItems.stockItemId,
              quantity: stockTransferItems.quantity,
              rate: stockTransferItems.rate,
              totalAmount: stockTransferItems.totalAmount,
              stockItemName: stockItems.name,
              stockItemCode: stockItems.code,
            })
            .from(stockTransferItems)
            .leftJoin(stockItems, eq(stockTransferItems.stockItemId, stockItems.id))
            .where(eq(stockTransferItems.transferId, transferVoucher.id));

          if (transferItemsList.length > 0) {
            const itemsWithDetails = transferItemsList.map((item) => ({
              id: item.id,
              voucherId: id,
              stockItemId: item.stockItemId,
              stockItemName: item.stockItemName || 'Unknown Item',
              stockItemCode: item.stockItemCode || '-',
              quantity: item.quantity,
              rate: isPOSUser ? null : item.rate,
              debitAmount: "0",
              creditAmount: isPOSUser ? "0" : item.totalAmount,
              narration: isPOSUser
                ? `Transfer of ${item.quantity} x ${item.stockItemName || 'Unknown Item'}`
                : `Transfer of ${item.quantity} x ${item.stockItemName || 'Unknown Item'} @ $${item.rate}`,
              accountName: item.stockItemName || 'Unknown Item',
              accountCode: item.stockItemCode || '-',
              isStockItem: true,
              totalAmount: isPOSUser ? null : item.totalAmount,
            }));
            return res.json(itemsWithDetails);
          }
        }
      }

      // SECURITY: Final fallback redaction for POS users - ensure no cost data leaks
      if (isPOSUser) {
        const redactedFallbackEntries = entries.map((entry: any) => ({
          ...entry,
          debitAmount: "0",
          creditAmount: "0",
          narration: entry.accountName || "Account entry",
        }));
        return res.json(redactedFallbackEntries);
      }
      
      res.json(entries);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create a new voucher entry
  app.post("/api/voucher-entries", requireAuth, async (req, res) => {
    try {
      // Verify the voucher exists and belongs to current company
      if (!req.body.voucherId) {
        return res.status(400).json({ message: "Voucher ID is required" });
      }

      const voucher = await storage.getVoucherById(req.body.voucherId);
      if (!voucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Verify voucher belongs to current company
      if (voucher.companyId !== req.session.currentCompanyId) {
        return res
          .status(403)
          .json({
            message: "Access denied: Voucher belongs to a different company",
          });
      }

      // Check permissions based on role (same logic as voucher edit)
      const userRole = req.session.currentRole;
      if (!userRole) {
        return res.status(403).json({ message: "User role not found" });
      }

      // Admin and Owner can create entries for all vouchers
      if (userRole !== "Admin" && userRole !== "Owner") {
        // Manager can only create entries for today's vouchers
        if (userRole === "Manager") {
          const voucherDate = new Date(voucher.voucherDate);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          voucherDate.setHours(0, 0, 0, 0);

          if (voucherDate.getTime() !== today.getTime()) {
            return res
              .status(403)
              .json({
                message:
                  "Managers can only create entries for today's vouchers",
              });
          }
        } else {
          // Other roles cannot create entries
          return res
            .status(403)
            .json({
              message: "Insufficient permissions to create voucher entries",
            });
        }
      }

      const entry = await storage.createVoucherEntry(req.body);
      res.json(entry);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update a voucher entry
  app.patch("/api/voucher-entries/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher entry ID" });
      }

      // Get the existing entry to find its voucher
      const existingEntry = await db.query.voucherEntries.findFirst({
        where: eq(voucherEntries.id, id),
      });

      if (!existingEntry) {
        return res.status(404).json({ message: "Voucher entry not found" });
      }

      // Get the voucher to check company and permissions
      const voucher = await storage.getVoucherById(existingEntry.voucherId);
      if (!voucher) {
        return res
          .status(404)
          .json({ message: "Associated voucher not found" });
      }

      // Verify voucher belongs to current company
      if (voucher.companyId !== req.session.currentCompanyId) {
        return res
          .status(403)
          .json({
            message: "Access denied: Voucher belongs to a different company",
          });
      }

      // Check edit permissions based on role (same logic as voucher edit)
      const userRole = req.session.currentRole;
      if (!userRole) {
        return res.status(403).json({ message: "User role not found" });
      }

      // Admin and Owner can edit all vouchers
      if (userRole !== "Admin" && userRole !== "Owner") {
        // Manager can only edit today's vouchers
        if (userRole === "Manager") {
          const voucherDate = new Date(voucher.voucherDate);
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
            .json({
              message: "Insufficient permissions to edit voucher entries",
            });
        }
      }

      // Only allow updating debit/credit amounts and narration
      const allowedUpdates: Partial<any> = {};
      if (req.body.debitAmount !== undefined)
        allowedUpdates.debitAmount = req.body.debitAmount;
      if (req.body.creditAmount !== undefined)
        allowedUpdates.creditAmount = req.body.creditAmount;
      if (req.body.narration !== undefined)
        allowedUpdates.narration = req.body.narration;

      const updated = await storage.updateVoucherEntry(id, allowedUpdates);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete a voucher (Admin only)
  app.delete(
    "/api/vouchers/:id",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid voucher ID" });
        }

        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Get voucher and entries before deleting for balance sync
        const voucher = await storage.getVoucherById(id);
        if (!voucher) {
          return res.status(404).json({ message: "Voucher not found" });
        }

        // Wrap balance sync and deletion in a transaction
        await db.transaction(async (tx) => {
          // IMPORTANT: Reverse inventory movements for Stock Transfer vouchers
          // Note: Database stores as "StockTransfer" (no space), but some code uses "Stock Transfer"
          if (voucher.voucherType === "Stock Transfer" || voucher.voucherType === "StockTransfer") {
            // Get the stock transfer record
            const [transferVoucher] = await tx
              .select()
              .from(stockTransferVouchers)
              .where(eq(stockTransferVouchers.voucherId, id))
              .limit(1);

            // Reverse inventory if: inventory was explicitly applied (inventoryApplied=true)
            // OR voucher is non-optional (legacy behaviour before inventoryApplied column existed).
            // This ensures optional transfers that incorrectly applied inventory (old bug) are
            // also reversed on delete, while correctly-optional transfers (inventoryApplied=false)
            // are left alone.
            if (transferVoucher && (transferVoucher.inventoryApplied || !voucher.optional)) {
              // Get the transfer items
              const transferItemsList = await tx
                .select()
                .from(stockTransferItems)
                .where(eq(stockTransferItems.transferId, transferVoucher.id));

              // Reverse each item's inventory movement
              // NOTE: The forward transfer logic:
              // - Source: reduces qty, keeps existing averageRate
              // - Destination: adds qty with weighted average calculation
              // Reversal must be the exact inverse:
              // - Source: add back qty at existing rate (no average change needed)
              // - Destination: subtract qty and reverse the weighted average
              for (const item of transferItemsList) {
                const qty = parseFloat(item.quantity);
                const transferRate = parseFloat(item.rate);
                // Use per-item sourceLocationId (multi-source transfers may have different sources per item)
                const itemSourceId = item.sourceLocationId || transferVoucher.sourceLocationId!;

                // Add back to source location (reverse the deduction)
                await adjustInventory(tx, itemSourceId, item.stockItemId, qty, req.session.currentCompanyId!, transferRate);

                // Remove from destination location (reverse the addition)
                await adjustInventory(tx, transferVoucher.destinationLocationId!, item.stockItemId, -qty, req.session.currentCompanyId!);
              }
            }

            if (transferVoucher) {
              // Delete stock transfer items
              await tx
                .delete(stockTransferItems)
                .where(eq(stockTransferItems.transferId, transferVoucher.id));

              // Delete stock transfer voucher record
              await tx
                .delete(stockTransferVouchers)
                .where(eq(stockTransferVouchers.id, transferVoucher.id));
            }
          }

          // IMPORTANT: Reverse inventory movements for Stock Adjustment (Production/Consumption/Mixed) vouchers
          if ((voucher.voucherType === "Production" || voucher.voucherType === "Consumption" || voucher.voucherType === "Mixed") && !voucher.optional) {
            // Get the stock adjustment record
            const [adjustmentVoucher] = await tx
              .select()
              .from(stockAdjustmentVouchers)
              .where(eq(stockAdjustmentVouchers.voucherId, id))
              .limit(1);

            if (adjustmentVoucher) {
              // Get the adjustment items
              const adjustmentItemsList = await tx
                .select()
                .from(stockAdjustmentItems)
                .where(eq(stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));

              // Reverse each item's inventory movement
              // Production forward logic: adds qty with weighted average
              // Consumption forward logic: subtracts qty, keeps rate
              // Mixed: depends on the individual item qty sign
              for (const item of adjustmentItemsList) {
                const qty = parseFloat(item.quantity);
                const adjustmentRate = parseFloat(item.rate);
                const absoluteQty = Math.abs(qty);

                const isProduction = adjustmentVoucher.adjustmentType === "Production" || 
                                     (adjustmentVoucher.adjustmentType === "Mixed" && qty > 0);

                if (isProduction) {
                  // Production added inventory, so reverse by subtracting
                  await adjustInventory(tx, adjustmentVoucher.locationId, item.stockItemId, -absoluteQty, req.session.currentCompanyId!);
                } else {
                  // Consumption subtracted inventory, so reverse by adding back
                  await adjustInventory(tx, adjustmentVoucher.locationId, item.stockItemId, absoluteQty, req.session.currentCompanyId!, adjustmentRate);
                }
              }

              // Delete stock adjustment items
              await tx
                .delete(stockAdjustmentItems)
                .where(eq(stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));

              // Delete stock adjustment voucher record
              await tx
                .delete(stockAdjustmentVouchers)
                .where(eq(stockAdjustmentVouchers.id, adjustmentVoucher.id));
            }
          }

          // IMPORTANT: Reverse inventory movements for POS Sales vouchers (Receipt type with sales items)
          // Also handle "Sales" voucher type for completeness
          // POS Sale forward logic: subtracts qty, keeps existing rate
          // Reversal: add back qty at existing rate
          if ((voucher.voucherType === "Receipt" || voucher.voucherType === "Sales") && !voucher.optional) {
            // Check if this is a POS sale by looking for sales items
            const saleItems = await tx
              .select()
              .from(salesItems)
              .where(eq(salesItems.voucherId, id));

            if (saleItems.length > 0) {
              console.log(`[POS Delete] Voucher ${id}: Found ${saleItems.length} sale items to reverse`);
              
              // Only reverse inventory if we have a definite location from the voucher
              // We don't guess the location to avoid restoring stock to the wrong place
              if (voucher.locationId) {
                const targetLocationId = voucher.locationId;
                // This is a POS sale - add sold items back to inventory
                for (const item of saleItems) {
                  const qty = parseFloat(item.quantity);
                  const costPrice = parseFloat(item.costPrice || "0");
                  
                  console.log(`[POS Delete] Restoring item ${item.stockItemId}: qty=${qty}, costPrice=${costPrice}`);

                  const result = await adjustInventory(tx, targetLocationId, item.stockItemId, qty, req.session.currentCompanyId!, costPrice);
                  console.log(`[POS Delete] Item ${item.stockItemId}: qty ${result.previousQuantity} + ${qty} = ${result.newQuantity}, rate: ${result.averageRate.toFixed(2)}`);
                }
              } else {
                // Log warning: can't reverse inventory without location
                console.warn(`[POS Delete] Voucher ${id}: Cannot reverse inventory - no locationId on voucher`);
              }

              // Delete sales items regardless of whether inventory was reversed
              console.log(`[POS Delete] Deleting ${saleItems.length} sales items for voucher ${id}`);
              await tx
                .delete(salesItems)
                .where(eq(salesItems.voucherId, id));
            }
          }

          // IMPORTANT: Reverse inventory movements for Credit Note / Debit Note vouchers
          if ((voucher.voucherType === "Credit Note" || voucher.voucherType === "Debit Note") && !voucher.optional) {
            // Get the credit note items
            const noteItems = await tx
              .select()
              .from(creditNoteItems)
              .where(eq(creditNoteItems.voucherId, id));

            if (noteItems.length > 0) {
              console.log(`[Credit/Debit Note Delete] Voucher ${id}: Found ${noteItems.length} items to reverse`);

              for (const item of noteItems) {
                const qty = parseFloat(item.quantity);
                const inventoryCost = parseFloat(item.inventoryCost || item.rate || "0");

                if (voucher.voucherType === "Credit Note") {
                  // Credit Note forward: added qty to inventory
                  // Reversal: subtract qty from inventory
                  const result = await adjustInventory(tx, item.locationId, item.stockItemId, -qty, req.session.currentCompanyId!);
                  console.log(`[Credit Note Delete] Item ${item.stockItemId} at location ${item.locationId}: qty ${result.previousQuantity} - ${qty} = ${result.newQuantity}`);
                } else {
                  // Debit Note forward: removed qty from inventory
                  // Reversal: add qty back to inventory
                  const result = await adjustInventory(tx, item.locationId, item.stockItemId, qty, req.session.currentCompanyId!, inventoryCost);
                  console.log(`[Debit Note Delete] Item ${item.stockItemId} at location ${item.locationId}: qty ${result.previousQuantity} + ${qty} = ${result.newQuantity}`);
                }
              }

              // Delete the credit note items
              console.log(`[Credit/Debit Note Delete] Deleting ${noteItems.length} credit_note_items for voucher ${id}`);
              await tx
                .delete(creditNoteItems)
                .where(eq(creditNoteItems.voucherId, id));
            }
          }

          if (!voucher.optional) {
            const entries = await tx
              .select()
              .from(voucherEntries)
              .where(eq(voucherEntries.voucherId, id));
            
            // Reverse the entries' effect on employee balances
            await syncEmployeeBalancesFromEntries(
              entries.map(e => ({
                ledgerAccountId: e.ledgerAccountId,
                employeeId: e.employeeId,
                debitAmount: e.debitAmount,
                creditAmount: e.creditAmount,
              })),
              req.session.currentCompanyId!,
              true // reverse
            );
          }

          // Soft delete: Keep voucher entries but set deletedAt on voucher
          // This automatically excludes entries from balance calculations
          // (calculateAccountBalance filters by isNull(vouchers.deletedAt))
          await tx
            .update(vouchers)
            .set({ deletedAt: new Date() })
            .where(eq(vouchers.id, id));
        });

        // Log the deletion to audit log
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "delete",
          tableName: "vouchers",
          recordId: id,
          recordIdentifier: voucher.voucherNumber,
          changes: null,
        });

        res.json({ message: "Voucher deleted successfully" });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Bulk delete vouchers (Admin only) - uses same deletion logic as single delete
  app.post("/api/vouchers/bulk-delete", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      // Validate request body with Zod
      const bodySchema = z.object({
        voucherIds: z.array(z.union([z.number(), z.string()])).min(1, "At least one voucher ID required"),
      });
      
      const parseResult = bodySchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: parseResult.error.errors[0].message });
      }
      
      const { voucherIds } = parseResult.data;

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const currentCompanyId = req.session.currentCompanyId;
      let deletedCount = 0;
      const errors: string[] = [];

      // Process each voucher deletion using the same logic as single delete
      for (const voucherId of voucherIds) {
        const id = typeof voucherId === 'string' ? parseInt(voucherId) : voucherId;
        if (isNaN(id)) {
          errors.push(`Invalid voucher ID: ${voucherId}`);
          continue;
        }

        try {
          // Get voucher and verify it belongs to current company
          const voucher = await storage.getVoucherById(id);
          if (!voucher) {
            errors.push(`Voucher ${id} not found`);
            continue;
          }

          if (voucher.companyId !== currentCompanyId) {
            errors.push(`Voucher ${id} does not belong to current company`);
            continue;
          }

          // Use the same transaction-wrapped deletion logic as the single delete endpoint
          await db.transaction(async (tx) => {
            // IMPORTANT: Reverse inventory movements for Stock Transfer vouchers
            if (voucher.voucherType === "Stock Transfer" || voucher.voucherType === "StockTransfer") {
              const [transferVoucher] = await tx
                .select()
                .from(stockTransferVouchers)
                .where(eq(stockTransferVouchers.voucherId, id))
                .limit(1);

              // Reverse inventory if: inventory was explicitly applied (inventoryApplied=true)
              // OR voucher is non-optional (legacy behaviour before inventoryApplied column existed).
              if (transferVoucher && (transferVoucher.inventoryApplied || !voucher.optional)) {
                const transferItemsList = await tx
                  .select()
                  .from(stockTransferItems)
                  .where(eq(stockTransferItems.transferId, transferVoucher.id));

                for (const item of transferItemsList) {
                  const qty = parseFloat(item.quantity);
                  const transferRate = parseFloat(item.rate);
                  // Use per-item sourceLocationId (multi-source transfers may differ per item)
                  const itemSourceId = item.sourceLocationId || transferVoucher.sourceLocationId!;

                  // Add back to source location (reverse the deduction)
                  await adjustInventory(tx, itemSourceId, item.stockItemId, qty, currentCompanyId, transferRate);

                  // Remove from destination location (reverse the addition)
                  await adjustInventory(tx, transferVoucher.destinationLocationId!, item.stockItemId, -qty, currentCompanyId);
                }
              }

              if (transferVoucher) {
                await tx.delete(stockTransferItems).where(eq(stockTransferItems.transferId, transferVoucher.id));
                await tx.delete(stockTransferVouchers).where(eq(stockTransferVouchers.id, transferVoucher.id));
              }
            }

            // IMPORTANT: Reverse inventory movements for Stock Adjustment (Production/Consumption/Mixed) vouchers
            if ((voucher.voucherType === "Production" || voucher.voucherType === "Consumption" || voucher.voucherType === "Mixed") && !voucher.optional) {
              const [adjustmentVoucher] = await tx
                .select()
                .from(stockAdjustmentVouchers)
                .where(eq(stockAdjustmentVouchers.voucherId, id))
                .limit(1);

              if (adjustmentVoucher) {
                const adjustmentItemsList = await tx
                  .select()
                  .from(stockAdjustmentItems)
                  .where(eq(stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));

                for (const item of adjustmentItemsList) {
                  const qty = parseFloat(item.quantity);
                  const adjustmentRate = parseFloat(item.rate);
                  const absoluteQty = Math.abs(qty);
                  const isProduction = adjustmentVoucher.adjustmentType === "Production" || 
                                       (adjustmentVoucher.adjustmentType === "Mixed" && qty > 0);

                  if (isProduction) {
                    // Production added inventory, so reverse by subtracting
                    await adjustInventory(tx, adjustmentVoucher.locationId, item.stockItemId, -absoluteQty, currentCompanyId);
                  } else {
                    // Consumption subtracted inventory, so reverse by adding back
                    await adjustInventory(tx, adjustmentVoucher.locationId, item.stockItemId, absoluteQty, currentCompanyId, adjustmentRate);
                  }
                }

                await tx.delete(stockAdjustmentItems).where(eq(stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));
                await tx.delete(stockAdjustmentVouchers).where(eq(stockAdjustmentVouchers.id, adjustmentVoucher.id));
              }
            }

            // IMPORTANT: Reverse inventory movements for POS Sales vouchers (Receipt/Sales with sales items)
            if ((voucher.voucherType === "Receipt" || voucher.voucherType === "Sales") && !voucher.optional) {
              const saleItems = await tx
                .select()
                .from(salesItems)
                .where(eq(salesItems.voucherId, id));

              if (saleItems.length > 0) {
                // Only reverse inventory if we have a definite location from the voucher
                if (voucher.locationId) {
                  for (const item of saleItems) {
                    const qty = parseFloat(item.quantity);
                    const costPrice = parseFloat(item.costPrice || "0");

                    // Add back sold items to inventory (reverse the sale deduction)
                    await adjustInventory(tx, voucher.locationId, item.stockItemId, qty, currentCompanyId, costPrice);
                  }
                }

                // Delete sales items regardless of whether inventory was reversed
                await tx.delete(salesItems).where(eq(salesItems.voucherId, id));
              }
            }

            // IMPORTANT: Reverse inventory movements for Credit Note / Debit Note vouchers
            if ((voucher.voucherType === "Credit Note" || voucher.voucherType === "Debit Note") && !voucher.optional) {
              const noteItems = await tx
                .select()
                .from(creditNoteItems)
                .where(eq(creditNoteItems.voucherId, id));

              if (noteItems.length > 0) {
                console.log(`[Bulk Delete Credit/Debit Note] Voucher ${id}: Found ${noteItems.length} items to reverse`);

                for (const item of noteItems) {
                  const qty = parseFloat(item.quantity);
                  const inventoryCost = parseFloat(item.inventoryCost || item.rate || "0");

                  if (voucher.voucherType === "Credit Note") {
                    // Credit Note forward: added qty to inventory
                    // Reversal: subtract qty from inventory
                    await adjustInventory(tx, item.locationId, item.stockItemId, -qty, currentCompanyId);
                  } else {
                    // Debit Note forward: removed qty from inventory
                    // Reversal: add qty back to inventory
                    await adjustInventory(tx, item.locationId, item.stockItemId, qty, currentCompanyId, inventoryCost);
                  }
                }

                // Delete the credit note items
                await tx.delete(creditNoteItems).where(eq(creditNoteItems.voucherId, id));
              }
            }

            // Reverse employee balance effects for non-optional vouchers
            if (!voucher.optional) {
              const entries = await tx
                .select()
                .from(voucherEntries)
                .where(eq(voucherEntries.voucherId, id));

              await syncEmployeeBalancesFromEntries(
                entries.map(e => ({
                  ledgerAccountId: e.ledgerAccountId,
                  employeeId: e.employeeId,
                  debitAmount: e.debitAmount,
                  creditAmount: e.creditAmount,
                })),
                currentCompanyId,
                true // reverse
              );
            }

            // IMPORTANT: If this voucher is linked to a property payment entry,
            // reverse the monthly ledger and delete the payment log row so the
            // rent balance and payment history stay consistent.
            const linkedPayments = await tx
              .select()
              .from(propertyPayments)
              .where(eq(propertyPayments.voucherId, id));
            for (const pmt of linkedPayments) {
              if (pmt.ledgerRowId) {
                await tx.execute(sql`
                  UPDATE property_monthly_ledger
                  SET paid_amount = GREATEST(0, paid_amount - ${pmt.amount}::numeric)
                  WHERE id = ${pmt.ledgerRowId}
                `);
              }
              await tx.delete(propertyPayments).where(eq(propertyPayments.id, pmt.id));
            }

            // IMPORTANT: If this voucher is one side of an inter-company transfer,
            // also delete the OTHER side's entries + voucher and the transfer record,
            // so both companies' books are fully clean.
            const linkedTransfers = await tx
              .select()
              .from(interCompanyTransfers)
              .where(or(
                eq(interCompanyTransfers.fromVoucherId, id),
                eq(interCompanyTransfers.toVoucherId, id),
              ));
            for (const transfer of linkedTransfers) {
              const otherVoucherId = transfer.fromVoucherId === id
                ? transfer.toVoucherId
                : transfer.fromVoucherId;
              if (otherVoucherId && otherVoucherId !== id) {
                await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, otherVoucherId));
                await tx.delete(vouchers).where(eq(vouchers.id, otherVoucherId));
              }
              await tx.delete(interCompanyTransfers).where(eq(interCompanyTransfers.id, transfer.id));
            }

            // Soft delete: Set deletedAt instead of hard delete
            await tx.update(vouchers).set({ deletedAt: new Date() }).where(eq(vouchers.id, id));

            // Cascade: remove factory daybook entries linked to this voucher
            await tx.execute(sql`DELETE FROM factory_daybook_entries WHERE reference_table = 'vouchers' AND reference_id = ${id}`);

            // If this is a SAL- payroll voucher, also reverse the payroll run
            if (voucher.voucherNumber && /^SAL-\d+-/.test(voucher.voucherNumber)) {
              const runIdMatch = voucher.voucherNumber.match(/^SAL-(\d+)-/);
              if (runIdMatch) {
                const payRunId = parseInt(runIdMatch[1]);
                const [payRun] = await tx.select().from(erpPayrollRuns)
                  .where(and(eq(erpPayrollRuns.id, payRunId), eq(erpPayrollRuns.companyId, currentCompanyId), eq(erpPayrollRuns.status, "PAID")));
                if (payRun) {
                  const runItems = await tx.select().from(erpPayrollRunItems).where(eq(erpPayrollRunItems.runId, payRunId));
                  const payMonth = payRun.date.substring(0, 7);
                  for (const item of runItems) {
                    if (parseFloat(item.deduction || "0") <= 0 || !item.employeeId) continue;
                    const empAdvances = await tx.select({ id: salaryAdvances.id })
                      .from(salaryAdvances).where(and(eq(salaryAdvances.employeeId, item.employeeId), eq(salaryAdvances.companyId, currentCompanyId)));
                    const advIds = empAdvances.map(a => a.id);
                    if (advIds.length === 0) continue;
                    const deductions = await tx.select().from(salaryAdvanceDeductions)
                      .where(and(inArray(salaryAdvanceDeductions.salaryAdvanceId, advIds), eq(salaryAdvanceDeductions.payrollMonth, payMonth)));
                    for (const ded of deductions) {
                      const dedAmt = parseFloat(ded.deductionAmount || "0");
                      const [adv] = await tx.select().from(salaryAdvances).where(eq(salaryAdvances.id, ded.salaryAdvanceId));
                      if (!adv) continue;
                      const newBal = Math.min(parseFloat(adv.remainingBalance || "0") + dedAmt, parseFloat(adv.amount || "0"));
                      await tx.update(salaryAdvances).set({ remainingBalance: newBal.toFixed(2), fullyPaid: false }).where(eq(salaryAdvances.id, adv.id));
                      await tx.delete(salaryAdvanceDeductions).where(eq(salaryAdvanceDeductions.id, ded.id));
                    }
                  }
                  await tx.update(erpPayrollRuns).set({ status: "DRAFT", paymentAccountId: null, paidAt: null }).where(eq(erpPayrollRuns.id, payRunId));
                }
              }
            }
          });

        // Log the deletion to audit log
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "delete",
          tableName: "vouchers",
          recordId: id,
          recordIdentifier: voucher.voucherNumber,
          changes: null,
        });

          deletedCount++;
        } catch (err: any) {
          errors.push(`Failed to delete voucher ${id}: ${err.message}`);
        }
      }

      res.json({
        message: `Deleted ${deletedCount} voucher(s)`,
        deletedCount,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Fiscal Period Closing
  // Close a fiscal period (Admin/Owner only)
}
