import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory, syncEmployeeBalancesFromEntries } from "./_helpers";
import {
  inventory, stockItems, stockGroups, stockGroupArchives, stockItemCodeAliases,
  stockItemLocationPrices, stockTransferVouchers, stockTransferItems,
  stockAdjustmentVouchers, stockAdjustmentItems,
  containers, containerOffloads, containerOffloadItems, containerSales,
  containerCharges, containerTrackingImportRowSchema, updateContainerTrackingSchema,
  bankAccounts, fixedAssets, insertBankAccountSchema, insertFixedAssetSchema,
  insertStockGroupSchema, insertStockItemSchema, insertStockItemCodeAliasSchema,
  insertContainerSchema, offloadRequestSchema,
  purchaseOrders, poLineItems, insertContainerSaleSchema,
  vouchers, voucherEntries, salesItems, insertVoucherSchema, insertVoucherEntrySchema,
  updateVoucherEntrySchema, insertSalesItemSchema,
  suppliers, customers, customerBalances, locations, employees, userLocations,
  auditLog, interCompanyTransfers, insertInterCompanyTransferSchema,
  ledgerAccounts, insertLedgerAccountSchema, insertLedgerEntrySchema,
  companies, users, userCompanyRoles, companySettings,
  FEATURE_KEYS, fiscalPeriodClosures,
  wasteDispatches, wasteDispatchItems, insertWasteDispatchSchema,
  bales, baleProducts, baleProductCategories, baleTransfers,
  insertBaleSchema, insertBaleTransferSchema,
  orphanedRecords, orphanedCharges,
  dashboardCashAccounts, dashboardPayableAccounts, dashboardAccountSelections,
  insertDashboardCashAccountSchema, insertDashboardPayableAccountSchema,
  insertDashboardAccountSelectionSchema,
  creditNoteItems, creditNotes, insertCreditNoteSchema,
  pendingBarcodes, insertPendingBarcodeSchema,
  storedFiles, spreadsheets, liveSpreadsheets,
  agentAccounts, insertAgentAccountSchema,
  salaryAdvances, salaryAdvanceDeductions,
  insertSalaryAdvanceSchema, insertSalaryAdvanceDeductionSchema,
  chatSessions, chatMessages,
  inventoryValueAdjustments,
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

export function registerAdminRoutes(app: Express) {
  app.get("/api/orphaned-records", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      
      // Find vouchers that have a locationId but the location is deleted or no longer exists
      const orphanedVouchers = await db
        .select({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          locationId: vouchers.locationId,
          locationName: vouchers.locationName,
          totalAmount: vouchers.totalAmount,
          description: vouchers.description,
          createdAt: vouchers.createdAt,
        })
        .from(vouchers)
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            sql`${vouchers.locationId} IS NOT NULL`,
            or(
              sql`${locations.id} IS NULL`,
              isNotNull(locations.deletedAt)
            )
          )
        )
        .orderBy(sql`${vouchers.createdAt} DESC`);
      
      // Find unbalanced vouchers (debits != credits)
      const unbalancedVouchers = await db
        .select({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          locationId: vouchers.locationId,
          locationName: vouchers.locationName,
          totalAmount: vouchers.totalAmount,
          description: vouchers.description,
          createdAt: vouchers.createdAt,
          totalDebits: sql<string>`COALESCE(SUM(${voucherEntries.debitAmount}::numeric), 0)::text`,
          totalCredits: sql<string>`COALESCE(SUM(${voucherEntries.creditAmount}::numeric), 0)::text`,
          imbalance: sql<string>`(COALESCE(SUM(${voucherEntries.debitAmount}::numeric), 0) - COALESCE(SUM(${voucherEntries.creditAmount}::numeric), 0))::text`,
        })
        .from(vouchers)
        .leftJoin(voucherEntries, eq(vouchers.id, voucherEntries.voucherId))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        )
        .groupBy(vouchers.id)
        .having(sql`ABS(COALESCE(SUM(${voucherEntries.debitAmount}::numeric), 0) - COALESCE(SUM(${voucherEntries.creditAmount}::numeric), 0)) > 0.01`)
        .orderBy(sql`${vouchers.createdAt} DESC`);
      
      res.json({
        orphanedVouchers,
        unbalancedVouchers,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/orphaned-records/reassign", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      
      const { voucherIds, newLocationId } = req.body;
      
      if (!voucherIds || !Array.isArray(voucherIds) || voucherIds.length === 0) {
        return res.status(400).json({ message: "No vouchers selected" });
      }
      
      if (!newLocationId) {
        return res.status(400).json({ message: "New location is required" });
      }
      
      // Verify the new location exists and belongs to current company
      const newLocation = await storage.getLocationById(newLocationId);
      if (!newLocation || newLocation.companyId !== companyId) {
        return res.status(400).json({ message: "Invalid location" });
      }
      
      // Verify all vouchers belong to current company
      const vouchersToUpdate = await db
        .select()
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            inArray(vouchers.id, voucherIds)
          )
        );
      
      if (vouchersToUpdate.length !== voucherIds.length) {
        return res.status(400).json({ message: "Some vouchers not found or belong to different company" });
      }
      
      // Update vouchers with new location
      await db
        .update(vouchers)
        .set({
          locationId: newLocationId,
          locationName: newLocation.name,
        })
        .where(inArray(vouchers.id, voucherIds));
      
      res.json({ success: true, updated: voucherIds.length, newLocationName: newLocation.name });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete all orphaned vouchers permanently
  app.delete("/api/orphaned-records/delete-all", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      console.log("[DELETE-ALL] Starting delete-all for companyId:", companyId);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      
      // Find all orphaned vouchers (those with deleted or non-existent locations)
      // Must match the exact same query as GET /api/orphaned-records (NO deletedAt filter!)
      const orphanedVouchers = await db
        .select({ id: vouchers.id, voucherNumber: vouchers.voucherNumber, locationId: vouchers.locationId, voucherCompanyId: vouchers.companyId })
        .from(vouchers)
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            sql`${vouchers.locationId} IS NOT NULL`,
            or(
              sql`${locations.id} IS NULL`,
              isNotNull(locations.deletedAt)
            )
          )
        );
      
      console.log("[DELETE-ALL] Found orphaned vouchers:", orphanedVouchers.length);
      if (orphanedVouchers.length > 0) {
        console.log("[DELETE-ALL] First 3 vouchers:", JSON.stringify(orphanedVouchers.slice(0, 3)));
      }
      
      if (orphanedVouchers.length === 0) {
        // Debug: check what vouchers exist for this company at all
        const allVouchers = await db.select({ id: vouchers.id, locationId: vouchers.locationId }).from(vouchers).where(eq(vouchers.companyId, companyId)).limit(5);
        console.log("[DELETE-ALL] Sample vouchers for company:", JSON.stringify(allVouchers));
        return res.json({ success: true, deleted: 0, message: "No orphaned vouchers found", debug: { companyId, sampleVouchers: allVouchers.length } });
      }
      
      const orphanedIds = orphanedVouchers.map(v => v.id);
      
      // Delete all related records using raw SQL for maximum compatibility across schema versions
      // Build a comma-separated list of IDs for SQL
      const idList = orphanedIds.join(',');
      console.log("[DELETE-ALL] Deleting from related tables for", orphanedIds.length, "vouchers");
      
      await db.transaction(async (tx) => {
        // Delete from core tables that definitely exist
        await tx.execute(sql`DELETE FROM voucher_entries WHERE voucher_id IN (${sql.raw(idList)})`);
        await tx.execute(sql`DELETE FROM stock_transfer_vouchers WHERE voucher_id IN (${sql.raw(idList)})`);
        await tx.execute(sql`DELETE FROM stock_adjustment_vouchers WHERE voucher_id IN (${sql.raw(idList)})`);
        await tx.execute(sql`DELETE FROM sales_items WHERE voucher_id IN (${sql.raw(idList)})`);
        await tx.execute(sql`DELETE FROM salary_advances WHERE voucher_id IN (${sql.raw(idList)})`);
        
        // Finally delete the vouchers themselves
        await tx.execute(sql`DELETE FROM vouchers WHERE id IN (${sql.raw(idList)})`);
      });
      
      res.json({ success: true, deleted: orphanedIds.length });
    } catch (error: any) {
      console.error("Error deleting orphaned vouchers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Item Monthly Summary - Get aggregated monthly data for a stock item
  app.get("/api/stock-items/:id/monthly-summary", requireAuth, async (req, res) => {
    try {
      const stockItemId = parseInt(req.params.id);
      const year = parseInt(req.query.year as string) || (req.query.startDate ? new Date(req.query.startDate as string).getFullYear() : new Date().getFullYear());
      const companyId = req.session.currentCompanyId;
      
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      
      // Get the stock item info
      const stockItem = await storage.getStockItemById(stockItemId);
      if (!stockItem) {
        return res.status(404).json({ message: "Stock item not found" });
      }
      
      // Initialize monthly data
      const monthlyData: Array<{
        month: number;
        monthName: string;
        inwardQty: number;
        inwardValue: number;
        outwardQty: number;
        outwardValue: number;
        closingQty: number;
        closingValue: number;
      }> = [];
      
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                          'July', 'August', 'September', 'October', 'November', 'December'];
      
      // Query all relevant transactions for this stock item in the year
      // 1. PO Line Items (Inwards - container imports)
      const poInwards = await db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM ${purchaseOrders.createdAt})`,
          quantity: poLineItems.quantity,
          rate: poLineItems.rate,
          lineTotal: poLineItems.lineTotal,
        })
        .from(poLineItems)
        .innerJoin(purchaseOrders, eq(poLineItems.poId, purchaseOrders.id))
        .where(and(
          eq(poLineItems.stockItemId, stockItemId),
          eq(purchaseOrders.companyId, companyId),
          sql`EXTRACT(YEAR FROM ${purchaseOrders.createdAt}) = ${year}`
        ));
      
      // 2. Credit / Debit Note Items (company-wide, all locations)
      // Credit Notes restore stock (INWARD), Debit Notes reduce stock (OUTWARD)
      const creditDebitNotes = await db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM ${vouchers.voucherDate})`,
          quantity: creditNoteItems.quantity,
          inventoryCost: creditNoteItems.inventoryCost,
          noteType: vouchers.voucherType,
        })
        .from(creditNoteItems)
        .innerJoin(vouchers, eq(creditNoteItems.voucherId, vouchers.id))
        .where(and(
          eq(creditNoteItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          sql`EXTRACT(YEAR FROM ${vouchers.voucherDate}) = ${year}`
        ));

      // 3. Stock Adjustments (Production = In, Consumption = Out)
      const stockAdjustments = await db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM ${vouchers.voucherDate})`,
          quantity: stockAdjustmentItems.quantity,
          rate: stockAdjustmentItems.rate,
          totalAmount: stockAdjustmentItems.totalAmount,
          adjustmentType: stockAdjustmentVouchers.adjustmentType,
          optional: vouchers.optional,
        })
        .from(stockAdjustmentItems)
        .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
        .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
        .where(and(
          eq(stockAdjustmentItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          sql`EXTRACT(YEAR FROM ${vouchers.voucherDate}) = ${year}`
        ));
      
      // 4. Sales (Outwards)
      const salesData = await db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM ${vouchers.voucherDate})`,
          quantity: salesItems.quantity,
          costPrice: salesItems.costPrice,
          totalCost: salesItems.totalCost,
          optional: vouchers.optional,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(
          eq(salesItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          sql`EXTRACT(YEAR FROM ${vouchers.voucherDate}) = ${year}`
        ));
      
      // Initialize monthly buckets
      const monthBuckets: Record<number, { inQty: number; inVal: number; outQty: number; outVal: number }> = {};
      for (let m = 1; m <= 12; m++) {
        monthBuckets[m] = { inQty: 0, inVal: 0, outQty: 0, outVal: 0 };
      }
      
      // Process PO Inwards
      for (const row of poInwards) {
        const month = Number(row.month);
        monthBuckets[month].inQty += parseFloat(row.quantity);
        monthBuckets[month].inVal += parseFloat(row.lineTotal);
      }
      
      // Process Credit / Debit Notes
      // Credit Notes = customer returned goods = INWARD; Debit Notes = stock reduced = OUTWARD
      for (const row of creditDebitNotes) {
        const month = Number(row.month);
        const qty = parseFloat(row.quantity);
        const val = parseFloat(row.inventoryCost || "0") * qty;
        if (row.noteType === "Credit Note") {
          monthBuckets[month].inQty += qty;
          monthBuckets[month].inVal += val;
        } else {
          monthBuckets[month].outQty += qty;
          monthBuckets[month].outVal += val;
        }
      }

      // Process Stock Adjustments
      for (const row of stockAdjustments) {
        const month = Number(row.month);
        const qty = Math.abs(parseFloat(row.quantity));
        const val = parseFloat(row.totalAmount);
        if (row.adjustmentType === 'Production' || parseFloat(row.quantity) > 0) {
          monthBuckets[month].inQty += qty;
          monthBuckets[month].inVal += val;
        } else {
          monthBuckets[month].outQty += qty;
          monthBuckets[month].outVal += val;
        }
      }
      
      // Process Sales (always outward)
      for (const row of salesData) {
        const month = Number(row.month);
        monthBuckets[month].outQty += parseFloat(row.quantity);
        monthBuckets[month].outVal += parseFloat(row.totalCost);
      }
      
      // Calculate running closing balance
      let runningQty = 0;
      let runningVal = 0;
      
      // Get opening balance from inventory or assume 0 for start of year
      // For simplicity, we'll calculate it as prior year closing balance would be opening
      
      for (let m = 1; m <= 12; m++) {
        const bucket = monthBuckets[m];
        runningQty += bucket.inQty - bucket.outQty;
        runningVal += bucket.inVal - bucket.outVal;
        
        monthlyData.push({
          month: m,
          monthName: monthNames[m - 1],
          inwardQty: bucket.inQty,
          inwardValue: bucket.inVal,
          outwardQty: bucket.outQty,
          outwardValue: bucket.outVal,
          closingQty: runningQty,
          closingValue: runningVal,
        });
      }
      
      // Calculate grand totals
      const grandTotal = {
        inwardQty: Object.values(monthBuckets).reduce((s, b) => s + b.inQty, 0),
        inwardValue: Object.values(monthBuckets).reduce((s, b) => s + b.inVal, 0),
        outwardQty: Object.values(monthBuckets).reduce((s, b) => s + b.outQty, 0),
        outwardValue: Object.values(monthBuckets).reduce((s, b) => s + b.outVal, 0),
        closingQty: runningQty,
        closingValue: runningVal,
      };
      
      res.json({
        stockItem,
        year,
        monthlyData,
        grandTotal,
      });
    } catch (error: any) {
      console.error('Stock item monthly summary error:', error);
      res.status(500).json({ message: error.message });
    }
  });
  
  // Stock Item Monthly Vouchers - Get detailed transactions for a specific month
  app.get("/api/stock-items/:id/vouchers/:year/:month", requireAuth, async (req, res) => {
    try {
      const stockItemId = parseInt(req.params.id);
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);
      const companyId = req.session.currentCompanyId;
      
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      
      const stockItem = await storage.getStockItemById(stockItemId);
      if (!stockItem) {
        return res.status(404).json({ message: "Stock item not found" });
      }
      
      // Calculate the first day of the selected month for opening balance cutoff
      const monthStart = new Date(year, month - 1, 1);
      const monthStartStr = monthStart.toISOString().split('T')[0];
      
      // ============ CALCULATE OPENING BALANCE (all transactions BEFORE selected month) ============
      let openingQty = 0;
      let openingValue = 0;
      
      // Opening from PO Line Items
      const priorPOItems = await db
        .select({
          quantity: poLineItems.quantity,
          lineTotal: poLineItems.lineTotal,
        })
        .from(poLineItems)
        .innerJoin(purchaseOrders, eq(poLineItems.poId, purchaseOrders.id))
        .innerJoin(containers, eq(purchaseOrders.containerId, containers.id))
        .where(and(
          eq(poLineItems.stockItemId, stockItemId),
          eq(purchaseOrders.companyId, companyId),
          sql`${purchaseOrders.createdAt} < ${monthStartStr}::date`
        ));
      
      for (const item of priorPOItems) {
        openingQty += parseFloat(item.quantity);
        openingValue += parseFloat(item.lineTotal);
      }
      
      // Opening from Stock Transfers (net effect - transfers IN minus transfers OUT)
      const priorTransfers = await db
        .select({
          quantity: stockTransferItems.quantity,
          totalAmount: stockTransferItems.totalAmount,
          sourceLocationId: stockTransferItems.sourceLocationId,
          destinationLocationId: stockTransferVouchers.destinationLocationId,
        })
        .from(stockTransferItems)
        .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
        .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
        .where(and(
          eq(stockTransferItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          sql`${vouchers.voucherDate}::date < ${monthStartStr}::date`
        ));
      
      // Stock transfers: each transfer creates both an outward (from source) and inward (to destination)
      // For company-wide view, these cancel out (net zero) but we process them for consistency
      // This mirrors how in-month transfers are handled in the running balance calculation
      for (const item of priorTransfers) {
        const qty = parseFloat(item.quantity);
        const val = parseFloat(item.totalAmount);
        // Outward from source: -qty, -val
        openingQty -= qty;
        openingValue -= val;
        // Inward to destination: +qty, +val
        openingQty += qty;
        openingValue += val;
        // Net effect: 0 (correct for company-wide view)
      }
      
      // Opening from Stock Adjustments (Production adds, Consumption subtracts)
      const priorAdjustments = await db
        .select({
          quantity: stockAdjustmentItems.quantity,
          totalAmount: stockAdjustmentItems.totalAmount,
        })
        .from(stockAdjustmentItems)
        .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
        .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
        .where(and(
          eq(stockAdjustmentItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          sql`${vouchers.voucherDate}::date < ${monthStartStr}::date`
        ));
      
      // totalAmount is already signed (positive for production, negative for consumption)
      // Just add the signed values directly
      for (const item of priorAdjustments) {
        openingQty += parseFloat(item.quantity);
        openingValue += parseFloat(item.totalAmount);
      }
      
      // Opening from Sales (reduces stock)
      const priorSales = await db
        .select({
          quantity: salesItems.quantity,
          totalCost: salesItems.totalCost,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(
          eq(salesItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          sql`${vouchers.voucherDate}::date < ${monthStartStr}::date`
        ));
      
      for (const item of priorSales) {
        openingQty -= parseFloat(item.quantity);
        openingValue -= parseFloat(item.totalCost);
      }
      
      const openingRate = openingQty > 0 ? openingValue / openingQty : 0;
      
      // ============ COLLECT CURRENT MONTH TRANSACTIONS ============
      const transactions: Array<{
        date: string;
        particulars: string;
        vchType: string;
        voucherId: number;
        poId?: number;
        inwardQty: number;
        inwardRate: number;
        inwardValue: number;
        outwardQty: number;
        outwardRate: number;
        outwardValue: number;
        isOpeningBalance?: boolean;
        isPOS?: boolean;
        posSellingRate?: number;
        posSellingValue?: number;
      }> = [];
      
      // 1. PO Line Items (Inwards)
      const poItems = await db
        .select({
          date: purchaseOrders.createdAt,
          poId: purchaseOrders.id,
          poNumber: purchaseOrders.poNumber,
          containerNumber: containers.containerNumber,
          quantity: poLineItems.quantity,
          rate: poLineItems.rate,
          lineTotal: poLineItems.lineTotal,
        })
        .from(poLineItems)
        .innerJoin(purchaseOrders, eq(poLineItems.poId, purchaseOrders.id))
        .innerJoin(containers, eq(purchaseOrders.containerId, containers.id))
        .where(and(
          eq(poLineItems.stockItemId, stockItemId),
          eq(purchaseOrders.companyId, companyId),
          sql`EXTRACT(YEAR FROM ${purchaseOrders.createdAt}) = ${year}`,
          sql`EXTRACT(MONTH FROM ${purchaseOrders.createdAt}) = ${month}`
        ))
        .orderBy(purchaseOrders.createdAt);
      
      for (const item of poItems) {
        transactions.push({
          date: item.date.toISOString().split('T')[0],
          particulars: item.containerNumber,
          vchType: 'PURCHASE IMPORT',
          voucherId: 0,
          poId: item.poId,
          inwardQty: parseFloat(item.quantity),
          inwardRate: parseFloat(item.rate),
          inwardValue: parseFloat(item.lineTotal),
          outwardQty: 0,
          outwardRate: 0,
          outwardValue: 0,
        });
      }
      
      // 2. Stock Transfers
      const transferItems = await db
        .select({
          voucherDate: vouchers.voucherDate,
          voucherNumber: vouchers.voucherNumber,
          voucherId: vouchers.id,
          quantity: stockTransferItems.quantity,
          rate: stockTransferItems.rate,
          totalAmount: stockTransferItems.totalAmount,
          sourceLocationId: stockTransferItems.sourceLocationId,
          destinationLocationId: stockTransferVouchers.destinationLocationId,
          optional: vouchers.optional,
        })
        .from(stockTransferItems)
        .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
        .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
        .where(and(
          eq(stockTransferItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          sql`EXTRACT(YEAR FROM ${vouchers.voucherDate}) = ${year}`,
          sql`EXTRACT(MONTH FROM ${vouchers.voucherDate}) = ${month}`
        ))
        .orderBy(vouchers.voucherDate);
      
      // Get location names for transfers
      const locationIds = new Set<number>();
      for (const item of transferItems) {
        if (item.sourceLocationId) locationIds.add(item.sourceLocationId);
        if (item.destinationLocationId) locationIds.add(item.destinationLocationId);
      }
      
      const locationMap: Record<number, string> = {};
      for (const locId of Array.from(locationIds)) {
        const loc = await storage.getLocationById(locId);
        if (loc) locationMap[locId] = loc.name;
      }
      
      for (const item of transferItems) {
        const qty = parseFloat(item.quantity);
        const rate = parseFloat(item.rate);
        const val = parseFloat(item.totalAmount);
        const sourceName = item.sourceLocationId ? (locationMap[item.sourceLocationId] || 'Unknown') : 'Unknown';
        const destName = locationMap[item.destinationLocationId] || 'Unknown';
        
        // Add as Outward from source
        transactions.push({
          date: item.voucherDate,
          particulars: `To ${destName}`,
          vchType: `Stock Transfer - ${sourceName}`,
          voucherId: item.voucherId,
          inwardQty: 0,
          inwardRate: 0,
          inwardValue: 0,
          outwardQty: qty,
          outwardRate: rate,
          outwardValue: val,
        });
        
        // Add as Inward to destination
        transactions.push({
          date: item.voucherDate,
          particulars: `From ${sourceName}`,
          vchType: `Stock Transfer - ${destName}`,
          voucherId: item.voucherId,
          inwardQty: qty,
          inwardRate: rate,
          inwardValue: val,
          outwardQty: 0,
          outwardRate: 0,
          outwardValue: 0,
        });
      }
      
      // 3. Stock Adjustments
      const adjustmentItems = await db
        .select({
          voucherDate: vouchers.voucherDate,
          voucherNumber: vouchers.voucherNumber,
          voucherId: vouchers.id,
          quantity: stockAdjustmentItems.quantity,
          rate: stockAdjustmentItems.rate,
          totalAmount: stockAdjustmentItems.totalAmount,
          adjustmentType: stockAdjustmentVouchers.adjustmentType,
          locationId: stockAdjustmentVouchers.locationId,
          optional: vouchers.optional,
        })
        .from(stockAdjustmentItems)
        .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
        .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
        .where(and(
          eq(stockAdjustmentItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          sql`EXTRACT(YEAR FROM ${vouchers.voucherDate}) = ${year}`,
          sql`EXTRACT(MONTH FROM ${vouchers.voucherDate}) = ${month}`
        ))
        .orderBy(vouchers.voucherDate);
      
      for (const item of adjustmentItems) {
        const rawQty = parseFloat(item.quantity);
        const rawValue = parseFloat(item.totalAmount);
        const qty = Math.abs(rawQty);
        const rate = parseFloat(item.rate);
        const value = Math.abs(rawValue); // Use absolute value for outward
        const locName = locationMap[item.locationId] || (await storage.getLocationById(item.locationId))?.name || 'Unknown';
        const isProduction = rawQty > 0;
        
        transactions.push({
          date: item.voucherDate,
          particulars: locName,
          vchType: isProduction ? 'Production' : 'Consumption',
          voucherId: item.voucherId,
          inwardQty: isProduction ? qty : 0,
          inwardRate: isProduction ? rate : 0,
          inwardValue: isProduction ? rawValue : 0, // Use raw (positive) value for production
          outwardQty: isProduction ? 0 : qty,
          outwardRate: isProduction ? 0 : rate,
          outwardValue: isProduction ? 0 : value, // Use absolute value for consumption
        });
      }
      
      // 4. Sales (Outwards) - show each line item individually for this stock item
      const salesData = await db
        .select({
          voucherDate: vouchers.voucherDate,
          voucherNumber: vouchers.voucherNumber,
          voucherId: vouchers.id,
          locationId: vouchers.locationId,
          locationName: vouchers.locationName,
          quantity: salesItems.quantity,
          sellingPrice: salesItems.sellingPrice,
          totalSales: salesItems.totalSales,
          costPrice: salesItems.costPrice,
          totalCost: salesItems.totalCost,
          optional: vouchers.optional,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(
          eq(salesItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          sql`EXTRACT(YEAR FROM ${vouchers.voucherDate}) = ${year}`,
          sql`EXTRACT(MONTH FROM ${vouchers.voucherDate}) = ${month}`
        ))
        .orderBy(vouchers.voucherDate);
      
      // Each sales item for this stock item gets its own row (not grouped)
      // Store selling price separately, use cost for balance calculations
      for (const item of salesData) {
        const locName = item.locationName || (item.locationId ? (await storage.getLocationById(item.locationId))?.name : null) || 'Cash';
        const qty = parseFloat(item.quantity);
        const sellingRate = parseFloat(item.sellingPrice);
        const totalSalesValue = parseFloat(item.totalSales);
        
        transactions.push({
          date: item.voucherDate,
          particulars: locName,
          vchType: `POS - ${locName}`,
          voucherId: item.voucherId,
          inwardQty: 0,
          inwardRate: 0,
          inwardValue: 0,
          outwardQty: qty,
          outwardRate: 0, // Will be set to weighted avg cost in running balance loop
          outwardValue: 0, // Will be set to weighted avg cost in running balance loop
          isPOS: true,
          posSellingRate: sellingRate,
          posSellingValue: totalSalesValue,
        });
      }
      
      // Sort transactions by date
      transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      // START running balance from OPENING BALANCE (not zero!)
      let runningQty = openingQty;
      let runningValue = openingValue;
      
      // Build final transaction list with Opening Balance row first
      const transactionsWithBalance: Array<{
        date: string;
        particulars: string;
        vchType: string;
        voucherId: number;
        inwardQty: number;
        inwardRate: number;
        inwardValue: number;
        outwardQty: number;
        outwardRate: number;
        outwardValue: number;
        closingQty: number;
        closingRate: number;
        closingValue: number;
        isOpeningBalance?: boolean;
      }> = [];
      
      // Add Opening Balance row (only if there's a prior balance or prior transactions)
      // Per Tally's format: Opening Balance shows values in CLOSING columns only, not Inwards/Outwards
      if (openingQty !== 0 || openingValue !== 0) {
        transactionsWithBalance.push({
          date: monthStartStr,
          particulars: 'Opening Balance',
          vchType: '',
          voucherId: 0,
          inwardQty: 0,  // Tally shows nothing in Inwards for opening
          inwardRate: 0,
          inwardValue: 0,
          outwardQty: 0,
          outwardRate: 0,
          outwardValue: 0,
          closingQty: openingQty,  // Only Closing columns show values
          closingRate: openingRate,
          closingValue: openingValue,
          isOpeningBalance: true,
        });
      }
      
      // Calculate running balance for each transaction
      // Using weighted average cost method: outward items are valued at the current average rate for closing balance
      // POS transactions have SEPARATE posSellingRate/posSellingValue fields for display
      
      for (const t of transactions) {
        // Calculate current weighted average rate BEFORE processing this transaction
        const currentAvgRate = runningQty > 0 ? runningValue / runningQty : 0;
        
        // Update running quantity
        runningQty += t.inwardQty - t.outwardQty;
        
        // For value: 
        // - Inward: add the actual transaction value (brings in inventory at transaction's rate)
        // - Outward: deduct at the CURRENT weighted average rate (not the stored transaction rate)
        // This ensures closing value = closingQty × closingRate (consistency)
        const actualOutwardCost = t.outwardQty * currentAvgRate;
        runningValue += t.inwardValue - actualOutwardCost;
        
        // Weighted average rate after this transaction
        const avgClosingRate = runningQty > 0 ? runningValue / runningQty : 0;
        
        // ALL outward transactions use weighted average cost for rate/value
        const displayOutwardRate = t.outwardQty !== 0 ? currentAvgRate : 0;
        const displayOutwardValue = t.outwardQty !== 0 ? actualOutwardCost : 0;
        
        transactionsWithBalance.push({
          ...t,
          outwardRate: displayOutwardRate,
          outwardValue: displayOutwardValue,
          closingQty: runningQty,
          closingRate: avgClosingRate,
          closingValue: runningValue,
        });
      }
      
      // Calculate totals from processed transactions (all now using cost basis)
      const processedTransactions = transactionsWithBalance.filter(t => !t.isOpeningBalance);
      const inwardQtyTotal = processedTransactions.reduce((s, t) => s + t.inwardQty, 0);
      const inwardValueTotal = processedTransactions.reduce((s, t) => s + t.inwardValue, 0);
      const outwardQtyTotal = processedTransactions.reduce((s, t) => s + t.outwardQty, 0);
      const outwardValueTotal = processedTransactions.reduce((s, t) => s + t.outwardValue, 0);
      
      // Closing totals should be the FINAL running balance (same as last row)
      const totals = {
        inwardQty: inwardQtyTotal,
        inwardRate: inwardQtyTotal > 0 ? inwardValueTotal / inwardQtyTotal : 0,
        inwardValue: inwardValueTotal,
        outwardQty: outwardQtyTotal,
        outwardRate: outwardQtyTotal > 0 ? outwardValueTotal / outwardQtyTotal : 0,
        outwardValue: outwardValueTotal,
        closingQty: runningQty,
        closingRate: runningQty > 0 ? runningValue / runningQty : 0,
        closingValue: runningValue,
      };
      
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                          'July', 'August', 'September', 'October', 'November', 'December'];
      
      res.json({
        stockItem,
        year,
        month,
        monthName: monthNames[month - 1],
        openingBalance: {
          qty: openingQty,
          rate: openingRate,
          value: openingValue,
        },
        transactions: transactionsWithBalance,
        totals,
      });
    } catch (error: any) {
      console.error('Stock item monthly vouchers error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Location Stock Item Monthly Summary - Get aggregated monthly data for a stock item at a specific location
  app.get("/api/locations/:locationId/stock-items/:stockItemId/monthly-summary", requireAuth, async (req, res) => {
    try {
      const locationId = parseInt(req.params.locationId);
      const stockItemId = parseInt(req.params.stockItemId);
      const year = parseInt(req.query.year as string) || (req.query.startDate ? new Date(req.query.startDate as string).getFullYear() : new Date().getFullYear());
      const companyId = req.session.currentCompanyId;
      
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      
      // Get the stock item and location info
      const stockItem = await storage.getStockItemById(stockItemId);
      if (!stockItem) {
        return res.status(404).json({ message: "Stock item not found" });
      }
      
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                          'July', 'August', 'September', 'October', 'November', 'December'];
      
      // Initialize monthly buckets
      const monthBuckets: Record<number, { inQty: number; inVal: number; outQty: number; outVal: number }> = {};
      for (let m = 1; m <= 12; m++) {
        monthBuckets[m] = { inQty: 0, inVal: 0, outQty: 0, outVal: 0 };
      }
      
      // 1. Stock Transfers - In and Out based on source/destination matching this location
      const stockTransfers = await db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM ${vouchers.voucherDate})`,
          quantity: stockTransferItems.quantity,
          totalAmount: stockTransferItems.totalAmount,
          sourceLocationId: stockTransferItems.sourceLocationId,
          destinationLocationId: stockTransferVouchers.destinationLocationId,
        })
        .from(stockTransferItems)
        .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
        .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
        .where(and(
          eq(stockTransferItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          sql`EXTRACT(YEAR FROM ${vouchers.voucherDate}) = ${year}`,
          or(
            eq(stockTransferItems.sourceLocationId, locationId),
            eq(stockTransferVouchers.destinationLocationId, locationId)
          )
        ));
      
      for (const row of stockTransfers) {
        const month = Number(row.month);
        const qty = parseFloat(row.quantity);
        const val = parseFloat(row.totalAmount);
        
        // Transfer OUT from this location (source = this location)
        if (row.sourceLocationId === locationId) {
          monthBuckets[month].outQty += qty;
          monthBuckets[month].outVal += val;
        }
        // Transfer IN to this location (destination = this location)
        if (row.destinationLocationId === locationId) {
          monthBuckets[month].inQty += qty;
          monthBuckets[month].inVal += val;
        }
      }
      
      // 2. Stock Adjustments at this location
      const stockAdjustments = await db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM ${vouchers.voucherDate})`,
          quantity: stockAdjustmentItems.quantity,
          totalAmount: stockAdjustmentItems.totalAmount,
          adjustmentType: stockAdjustmentVouchers.adjustmentType,
        })
        .from(stockAdjustmentItems)
        .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
        .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
        .where(and(
          eq(stockAdjustmentItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          eq(stockAdjustmentVouchers.locationId, locationId),
          sql`EXTRACT(YEAR FROM ${vouchers.voucherDate}) = ${year}`
        ));
      
      for (const row of stockAdjustments) {
        const month = Number(row.month);
        const qty = Math.abs(parseFloat(row.quantity));
        const val = Math.abs(parseFloat(row.totalAmount));
        if (row.adjustmentType === 'Production' || parseFloat(row.quantity) > 0) {
          monthBuckets[month].inQty += qty;
          monthBuckets[month].inVal += val;
        } else {
          monthBuckets[month].outQty += qty;
          monthBuckets[month].outVal += val;
        }
      }
      
      // 3. Sales at this location (Outwards)
      const salesData = await db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM ${vouchers.voucherDate})`,
          quantity: salesItems.quantity,
          totalCost: salesItems.totalCost,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(
          eq(salesItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          eq(vouchers.locationId, locationId),
          sql`EXTRACT(YEAR FROM ${vouchers.voucherDate}) = ${year}`
        ));
      
      for (const row of salesData) {
        const month = Number(row.month);
        monthBuckets[month].outQty += parseFloat(row.quantity);
        monthBuckets[month].outVal += parseFloat(row.totalCost || "0");
      }

      // 4. Credit / Debit Note Items at this location
      // Credit Notes restore stock (INWARD), Debit Notes reduce stock (OUTWARD)
      const creditDebitNotes = await db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM ${vouchers.voucherDate})`,
          quantity: creditNoteItems.quantity,
          inventoryCost: creditNoteItems.inventoryCost,
          noteType: vouchers.voucherType,
        })
        .from(creditNoteItems)
        .innerJoin(vouchers, eq(creditNoteItems.voucherId, vouchers.id))
        .where(and(
          eq(creditNoteItems.stockItemId, stockItemId),
          eq(creditNoteItems.locationId, locationId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          sql`EXTRACT(YEAR FROM ${vouchers.voucherDate}) = ${year}`
        ));

      for (const row of creditDebitNotes) {
        const month = Number(row.month);
        const qty = parseFloat(row.quantity);
        const val = parseFloat(row.inventoryCost || "0") * qty;
        if (row.noteType === "Credit Note") {
          monthBuckets[month].inQty += qty;
          monthBuckets[month].inVal += val;
        } else {
          monthBuckets[month].outQty += qty;
          monthBuckets[month].outVal += val;
        }
      }

      // 5. Container Offloads at this location (Inwards - from PO imports)
      const containerOffloadData = await db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM ${containerOffloads.offloadedAt})`,
          quantity: poLineItems.quantity,
          lineTotal: poLineItems.lineTotal,
          additionalCostPerBale: containerOffloads.additionalCostPerBale,
        })
        .from(containerOffloads)
        .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
        .innerJoin(purchaseOrders, eq(purchaseOrders.containerId, containers.id))
        .innerJoin(poLineItems, eq(poLineItems.poId, purchaseOrders.id))
        .where(and(
          eq(poLineItems.stockItemId, stockItemId),
          eq(containers.companyId, companyId),
          eq(containerOffloads.locationId, locationId),
          sql`EXTRACT(YEAR FROM ${containerOffloads.offloadedAt}) = ${year}`
        ));
      
      for (const row of containerOffloadData) {
        const month = Number(row.month);
        const qty = parseFloat(row.quantity);
        const baseValue = parseFloat(row.lineTotal);
        const additionalCost = parseFloat(row.additionalCostPerBale || "0") * qty;
        const landedValue = baseValue + additionalCost;
        
        monthBuckets[month].inQty += qty;
        monthBuckets[month].inVal += landedValue;
      }
      
      // Get ACTUAL current inventory for this location and item (source of truth)
      const currentInventoryResult = await db
        .select({
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .where(and(
          eq(inventory.stockItemId, stockItemId),
          eq(inventory.locationId, locationId)
        ))
        .limit(1);
      
      const actualQty = currentInventoryResult.length > 0 ? parseFloat(currentInventoryResult[0].quantity) : 0;
      const actualRate = currentInventoryResult.length > 0 ? parseFloat(currentInventoryResult[0].averageRate) : 0;
      // Calculate value dynamically as qty * rate
      const actualValue = actualQty * actualRate;
      
      // Calculate total movements for the year from vouchers
      const totalYearInQty = Object.values(monthBuckets).reduce((s, b) => s + b.inQty, 0);
      const totalYearInVal = Object.values(monthBuckets).reduce((s, b) => s + b.inVal, 0);
      const totalYearOutQty = Object.values(monthBuckets).reduce((s, b) => s + b.outQty, 0);
      const totalYearOutVal = Object.values(monthBuckets).reduce((s, b) => s + b.outVal, 0);
      const totalYearNetQty = totalYearInQty - totalYearOutQty;
      const totalYearNetVal = totalYearInVal - totalYearOutVal;
      
      const currentYear = new Date().getFullYear();
      
      // For current year: work backwards from actual inventory to derive opening
      // For past years: we use voucher-based calculation (no inventory history)
      let derivedOpeningQty: number;
      let derivedOpeningVal: number;
      
      if (year === currentYear) {
        // Current Inventory = Opening + YearNetMovements
        // Opening = Current Inventory - YearNetMovements
        derivedOpeningQty = actualQty - totalYearNetQty;
        derivedOpeningVal = actualValue - totalYearNetVal;
      } else {
        // For past years, start from 0 (no inventory history available)
        derivedOpeningQty = 0;
        derivedOpeningVal = 0;
      }
      
      // Calculate running closing balance starting from derived opening
      let runningQty = derivedOpeningQty;
      let runningVal = derivedOpeningVal;
      
      const rate = (val: number, qty: number) => qty > 0 ? val / qty : 0;

      const monthlyData: Array<{
        month: number;
        monthName: string;
        openingQty: number;
        openingValue: number;
        openingRate: number;
        inwardQty: number;
        inwardValue: number;
        inwardRate: number;
        outwardQty: number;
        outwardValue: number;
        outwardRate: number;
        closingQty: number;
        closingValue: number;
        closingRate: number;
      }> = [];
      
      for (let m = 1; m <= 12; m++) {
        const bucket = monthBuckets[m];
        const openingQty = runningQty;
        const openingVal = runningVal;
        runningQty += bucket.inQty - bucket.outQty;
        runningVal += bucket.inVal - bucket.outVal;
        const closingQty = Math.round(runningQty * 1000) / 1000;
        const closingVal = runningVal;
        
        monthlyData.push({
          month: m,
          monthName: monthNames[m - 1],
          openingQty: Math.round(openingQty * 1000) / 1000,
          openingValue: openingVal,
          openingRate: rate(openingVal, openingQty),
          inwardQty: bucket.inQty,
          inwardValue: bucket.inVal,
          inwardRate: rate(bucket.inVal, bucket.inQty),
          outwardQty: bucket.outQty,
          outwardValue: bucket.outVal,
          outwardRate: rate(bucket.outVal, bucket.outQty),
          closingQty,
          closingValue: closingVal,
          closingRate: rate(closingVal, closingQty),
        });
      }
      
      // For current year: force December closing to match actual inventory
      if (year === currentYear) {
        monthlyData[11].closingQty = Math.round(actualQty * 1000) / 1000;
        monthlyData[11].closingValue = actualValue;
        monthlyData[11].closingRate = rate(actualValue, actualQty);
      }
      
      const grandTotal = {
        openingQty: Math.round(derivedOpeningQty * 1000) / 1000,
        openingValue: derivedOpeningVal,
        openingRate: rate(derivedOpeningVal, derivedOpeningQty),
        inwardQty: totalYearInQty,
        inwardValue: totalYearInVal,
        inwardRate: rate(totalYearInVal, totalYearInQty),
        outwardQty: totalYearOutQty,
        outwardValue: totalYearOutVal,
        outwardRate: rate(totalYearOutVal, totalYearOutQty),
        closingQty: year === currentYear ? Math.round(actualQty * 1000) / 1000 : Math.round(runningQty * 1000) / 1000,
        closingValue: year === currentYear ? actualValue : runningVal,
        closingRate: year === currentYear ? rate(actualValue, actualQty) : rate(runningVal, runningQty),
      };
      
      res.json({
        stockItem,
        location,
        year,
        monthlyData,
        grandTotal,
      });
    } catch (error: any) {
      console.error('Location stock item monthly summary error:', error);
      res.status(500).json({ message: error.message });
    }
  });
  
  // Location Stock Item Monthly Vouchers - Get detailed transactions for a specific month at a location
  app.get("/api/locations/:locationId/stock-items/:stockItemId/vouchers/:year/:month", requireAuth, async (req, res) => {
    try {
      const locationId = parseInt(req.params.locationId);
      const stockItemId = parseInt(req.params.stockItemId);
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);
      const companyId = req.session.currentCompanyId;
      
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      
      const stockItem = await storage.getStockItemById(stockItemId);
      if (!stockItem) {
        return res.status(404).json({ message: "Stock item not found" });
      }
      
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0); // Last day of month
      const monthStartStr = monthStart.toISOString().split('T')[0];
      const monthEndStr = monthEnd.toISOString().split('T')[0];
      
      // ============ CALCULATE OPENING BALANCE (all transactions BEFORE selected month) ============
      // Query all prior movements and aggregate them to get opening balance
      let priorInwardQty = 0;
      let priorInwardValue = 0;
      let priorOutwardQty = 0;
      let priorOutwardValue = 0;
      
      // Prior Stock Transfers
      const priorTransfers = await db
        .select({
          quantity: stockTransferItems.quantity,
          totalAmount: stockTransferItems.totalAmount,
          sourceLocationId: stockTransferItems.sourceLocationId,
          destinationLocationId: stockTransferVouchers.destinationLocationId,
        })
        .from(stockTransferItems)
        .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
        .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
        .where(and(
          eq(stockTransferItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          sql`${vouchers.voucherDate}::date < ${monthStartStr}::date`,
          or(
            eq(stockTransferItems.sourceLocationId, locationId),
            eq(stockTransferVouchers.destinationLocationId, locationId)
          )
        ));
      
      for (const item of priorTransfers) {
        const qty = parseFloat(item.quantity);
        const val = parseFloat(item.totalAmount);
        if (item.sourceLocationId === locationId) {
          priorOutwardQty += qty;
          priorOutwardValue += val;
        }
        if (item.destinationLocationId === locationId) {
          priorInwardQty += qty;
          priorInwardValue += val;
        }
      }
      
      // Prior Stock Adjustments (production adds, consumption subtracts)
      const priorAdjustments = await db
        .select({
          quantity: stockAdjustmentItems.quantity,
          totalAmount: stockAdjustmentItems.totalAmount,
        })
        .from(stockAdjustmentItems)
        .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
        .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
        .where(and(
          eq(stockAdjustmentItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          eq(stockAdjustmentVouchers.locationId, locationId),
          sql`${vouchers.voucherDate}::date < ${monthStartStr}::date`
        ));
      
      for (const item of priorAdjustments) {
        const qty = parseFloat(item.quantity);
        const val = parseFloat(item.totalAmount);
        if (qty > 0) {
          priorInwardQty += qty;
          priorInwardValue += val;
        } else {
          priorOutwardQty += Math.abs(qty);
          priorOutwardValue += Math.abs(val);
        }
      }
      
      // Prior Sales
      const priorSales = await db
        .select({
          quantity: salesItems.quantity,
          costPrice: salesItems.costPrice,
          totalCost: salesItems.totalCost,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(
          eq(salesItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          eq(vouchers.locationId, locationId),
          sql`${vouchers.voucherDate}::date < ${monthStartStr}::date`
        ));
      
      for (const item of priorSales) {
        priorOutwardQty += parseFloat(item.quantity);
        priorOutwardValue += parseFloat(item.totalCost);
      }
      
      // Prior Container Offloads
      const priorOffloads = await db
        .select({
          quantity: poLineItems.quantity,
          lineTotal: poLineItems.lineTotal,
          additionalCostPerBale: containerOffloads.additionalCostPerBale,
        })
        .from(containerOffloads)
        .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
        .innerJoin(purchaseOrders, eq(purchaseOrders.containerId, containers.id))
        .innerJoin(poLineItems, eq(poLineItems.poId, purchaseOrders.id))
        .where(and(
          eq(poLineItems.stockItemId, stockItemId),
          eq(containers.companyId, companyId),
          eq(containerOffloads.locationId, locationId),
          sql`${containerOffloads.offloadedAt}::date < ${monthStartStr}::date`
        ));
      
      for (const item of priorOffloads) {
        const qty = parseFloat(item.quantity);
        const baseValue = parseFloat(item.lineTotal);
        const additionalCost = parseFloat(item.additionalCostPerBale) * qty;
        priorInwardQty += qty;
        priorInwardValue += baseValue + additionalCost;
      }
      
      // ============ GET CURRENT INVENTORY (to check for unexplained stock from imports) ============
      const [currentInventory] = await db
        .select({
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .where(and(
          eq(inventory.locationId, locationId),
          eq(inventory.stockItemId, stockItemId)
        ));
      
      const currentQty = currentInventory ? parseFloat(currentInventory.quantity) : 0;
      const currentRate = currentInventory ? parseFloat(currentInventory.averageRate) : 0;
      // Calculate value dynamically as qty * rate
      const currentValue = currentQty * currentRate;
      
      // Calculate voucher-derived opening balance
      let voucherOpeningQty = priorInwardQty - priorOutwardQty;
      let voucherOpeningValue = priorInwardValue - priorOutwardValue;
      const voucherOpeningRate = voucherOpeningQty > 0 ? voucherOpeningValue / voucherOpeningQty : 0;
      
      // ============ CALCULATE MOVEMENTS AFTER THE SELECTED MONTH ============
      // To reconcile with inventory, we need to work backwards from current inventory
      let afterMonthNetQty = 0;
      let afterMonthNetValue = 0;
      
      // After-month Stock Transfers
      const afterTransfers = await db
        .select({
          quantity: stockTransferItems.quantity,
          totalAmount: stockTransferItems.totalAmount,
          sourceLocationId: stockTransferItems.sourceLocationId,
          destinationLocationId: stockTransferVouchers.destinationLocationId,
        })
        .from(stockTransferItems)
        .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
        .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
        .where(and(
          eq(stockTransferItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          sql`${vouchers.voucherDate}::date > ${monthEndStr}::date`,
          or(
            eq(stockTransferItems.sourceLocationId, locationId),
            eq(stockTransferVouchers.destinationLocationId, locationId)
          )
        ));
      
      for (const item of afterTransfers) {
        const qty = parseFloat(item.quantity);
        const val = parseFloat(item.totalAmount);
        if (item.sourceLocationId === locationId) {
          afterMonthNetQty -= qty;
          afterMonthNetValue -= val;
        }
        if (item.destinationLocationId === locationId) {
          afterMonthNetQty += qty;
          afterMonthNetValue += val;
        }
      }
      
      // After-month Stock Adjustments
      const afterAdjustments = await db
        .select({
          quantity: stockAdjustmentItems.quantity,
          totalAmount: stockAdjustmentItems.totalAmount,
        })
        .from(stockAdjustmentItems)
        .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
        .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
        .where(and(
          eq(stockAdjustmentItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          eq(stockAdjustmentVouchers.locationId, locationId),
          sql`${vouchers.voucherDate}::date > ${monthEndStr}::date`
        ));
      
      for (const item of afterAdjustments) {
        afterMonthNetQty += parseFloat(item.quantity);
        afterMonthNetValue += parseFloat(item.totalAmount);
      }
      
      // After-month Sales
      const afterSales = await db
        .select({
          quantity: salesItems.quantity,
          totalCost: salesItems.totalCost,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(
          eq(salesItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          eq(vouchers.locationId, locationId),
          sql`${vouchers.voucherDate}::date > ${monthEndStr}::date`
        ));
      
      for (const item of afterSales) {
        afterMonthNetQty -= parseFloat(item.quantity);
        afterMonthNetValue -= parseFloat(item.totalCost);
      }
      
      // After-month Container Offloads
      const afterOffloads = await db
        .select({
          quantity: poLineItems.quantity,
          lineTotal: poLineItems.lineTotal,
          additionalCostPerBale: containerOffloads.additionalCostPerBale,
        })
        .from(containerOffloads)
        .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
        .innerJoin(purchaseOrders, eq(purchaseOrders.containerId, containers.id))
        .innerJoin(poLineItems, eq(poLineItems.poId, purchaseOrders.id))
        .where(and(
          eq(poLineItems.stockItemId, stockItemId),
          eq(containers.companyId, companyId),
          eq(containerOffloads.locationId, locationId),
          sql`${containerOffloads.offloadedAt}::date > ${monthEndStr}::date`
        ));
      
      for (const item of afterOffloads) {
        const qty = parseFloat(item.quantity);
        const baseValue = parseFloat(item.lineTotal);
        const additionalCost = parseFloat(item.additionalCostPerBale) * qty;
        afterMonthNetQty += qty;
        afterMonthNetValue += baseValue + additionalCost;
      }
      
      // Calculate expected end-of-month closing from inventory (working backwards)
      const expectedClosingQty = currentQty - afterMonthNetQty;
      const expectedClosingValue = currentValue - afterMonthNetValue;
      const expectedClosingRate = expectedClosingQty > 0 ? expectedClosingValue / expectedClosingQty : 0;
      
      // ============ COLLECT CURRENT MONTH TRANSACTIONS AT THIS LOCATION ============
      const transactions: Array<{
        date: string;
        particulars: string;
        vchType: string;
        voucherId: number;
        poId?: number;
        inwardQty: number;
        inwardRate: number;
        inwardValue: number;
        outwardQty: number;
        outwardRate: number;
        outwardValue: number;
        isPOS?: boolean;
        posSellingRate?: number;
        posSellingValue?: number;
      }> = [];
      
      // 1. Stock Transfers involving this location
      const transferItems = await db
        .select({
          voucherDate: vouchers.voucherDate,
          voucherId: vouchers.id,
          quantity: stockTransferItems.quantity,
          rate: stockTransferItems.rate,
          totalAmount: stockTransferItems.totalAmount,
          sourceLocationId: stockTransferItems.sourceLocationId,
          destinationLocationId: stockTransferVouchers.destinationLocationId,
        })
        .from(stockTransferItems)
        .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
        .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
        .where(and(
          eq(stockTransferItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          sql`EXTRACT(YEAR FROM ${vouchers.voucherDate}) = ${year}`,
          sql`EXTRACT(MONTH FROM ${vouchers.voucherDate}) = ${month}`,
          or(
            eq(stockTransferItems.sourceLocationId, locationId),
            eq(stockTransferVouchers.destinationLocationId, locationId)
          )
        ))
        .orderBy(vouchers.voucherDate);
      
      // Get location names for transfers
      const locationIds = new Set<number>();
      for (const item of transferItems) {
        if (item.sourceLocationId) locationIds.add(item.sourceLocationId);
        if (item.destinationLocationId) locationIds.add(item.destinationLocationId);
      }
      
      const locationMap: Record<number, string> = {};
      for (const locId of Array.from(locationIds)) {
        const loc = await storage.getLocationById(locId);
        if (loc) locationMap[locId] = loc.name;
      }
      
      for (const item of transferItems) {
        const qty = parseFloat(item.quantity);
        const rate = parseFloat(item.rate);
        const val = parseFloat(item.totalAmount);
        const sourceName = item.sourceLocationId ? (locationMap[item.sourceLocationId] || 'Unknown') : 'Unknown';
        const destName = locationMap[item.destinationLocationId] || 'Unknown';
        
        // Transfer OUT from this location
        if (item.sourceLocationId === locationId) {
          transactions.push({
            date: item.voucherDate,
            particulars: `To ${destName}`,
            vchType: 'Stock Transfer',
            voucherId: item.voucherId,
            inwardQty: 0,
            inwardRate: 0,
            inwardValue: 0,
            outwardQty: qty,
            outwardRate: rate,
            outwardValue: val,
          });
        }
        
        // Transfer IN to this location
        if (item.destinationLocationId === locationId) {
          transactions.push({
            date: item.voucherDate,
            particulars: `From ${sourceName}`,
            vchType: 'Stock Transfer',
            voucherId: item.voucherId,
            inwardQty: qty,
            inwardRate: rate,
            inwardValue: val,
            outwardQty: 0,
            outwardRate: 0,
            outwardValue: 0,
          });
        }
      }
      
      // 2. Stock Adjustments at this location
      const adjustmentItems = await db
        .select({
          voucherDate: vouchers.voucherDate,
          voucherId: vouchers.id,
          quantity: stockAdjustmentItems.quantity,
          rate: stockAdjustmentItems.rate,
          totalAmount: stockAdjustmentItems.totalAmount,
          adjustmentType: stockAdjustmentVouchers.adjustmentType,
        })
        .from(stockAdjustmentItems)
        .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
        .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
        .where(and(
          eq(stockAdjustmentItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          eq(stockAdjustmentVouchers.locationId, locationId),
          sql`EXTRACT(YEAR FROM ${vouchers.voucherDate}) = ${year}`,
          sql`EXTRACT(MONTH FROM ${vouchers.voucherDate}) = ${month}`
        ))
        .orderBy(vouchers.voucherDate);
      
      for (const item of adjustmentItems) {
        const rawQty = parseFloat(item.quantity);
        const rawValue = parseFloat(item.totalAmount);
        const qty = Math.abs(rawQty);
        const rate = parseFloat(item.rate);
        const value = Math.abs(rawValue);
        const isProduction = rawQty > 0;
        
        transactions.push({
          date: item.voucherDate,
          particulars: isProduction ? 'Production' : 'Consumption',
          vchType: isProduction ? 'Production' : 'Consumption',
          voucherId: item.voucherId,
          inwardQty: isProduction ? qty : 0,
          inwardRate: isProduction ? rate : 0,
          inwardValue: isProduction ? rawValue : 0,
          outwardQty: isProduction ? 0 : qty,
          outwardRate: isProduction ? 0 : rate,
          outwardValue: isProduction ? 0 : value,
        });
      }
      
      // 3. Sales at this location
      const salesData = await db
        .select({
          voucherDate: vouchers.voucherDate,
          voucherId: vouchers.id,
          quantity: salesItems.quantity,
          sellingPrice: salesItems.sellingPrice,
          totalSales: salesItems.totalSales,
          costPrice: salesItems.costPrice,
          totalCost: salesItems.totalCost,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(
          eq(salesItems.stockItemId, stockItemId),
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          eq(vouchers.locationId, locationId),
          sql`EXTRACT(YEAR FROM ${vouchers.voucherDate}) = ${year}`,
          sql`EXTRACT(MONTH FROM ${vouchers.voucherDate}) = ${month}`
        ))
        .orderBy(vouchers.voucherDate);
      
      for (const item of salesData) {
        const qty = parseFloat(item.quantity);
        const sellingRate = parseFloat(item.sellingPrice);
        const totalSalesValue = parseFloat(item.totalSales);
        
        transactions.push({
          date: item.voucherDate,
          particulars: 'Cash',
          vchType: 'POS',
          voucherId: item.voucherId,
          inwardQty: 0,
          inwardRate: 0,
          inwardValue: 0,
          outwardQty: qty,
          outwardRate: 0,
          outwardValue: 0,
          isPOS: true,
          posSellingRate: sellingRate,
          posSellingValue: totalSalesValue,
        });
      }
      
      // 4. Container Offloads at this location (Inwards from PO imports)
      const offloadData = await db
        .select({
          offloadedAt: containerOffloads.offloadedAt,
          containerId: containerOffloads.containerId,
          containerCode: containers.containerNumber,
          poId: purchaseOrders.id,
          poNumber: purchaseOrders.poNumber,
          quantity: poLineItems.quantity,
          rate: poLineItems.rate,
          lineTotal: poLineItems.lineTotal,
          additionalCostPerBale: containerOffloads.additionalCostPerBale,
        })
        .from(containerOffloads)
        .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
        .innerJoin(purchaseOrders, eq(purchaseOrders.containerId, containers.id))
        .innerJoin(poLineItems, eq(poLineItems.poId, purchaseOrders.id))
        .where(and(
          eq(poLineItems.stockItemId, stockItemId),
          eq(containers.companyId, companyId),
          eq(containerOffloads.locationId, locationId),
          sql`EXTRACT(YEAR FROM ${containerOffloads.offloadedAt}) = ${year}`,
          sql`EXTRACT(MONTH FROM ${containerOffloads.offloadedAt}) = ${month}`
        ))
        .orderBy(containerOffloads.offloadedAt);
      
      for (const item of offloadData) {
        const qty = parseFloat(item.quantity);
        const baseRate = parseFloat(item.rate);
        const baseValue = parseFloat(item.lineTotal);
        const additionalCostPerBale = parseFloat(item.additionalCostPerBale);
        const additionalCost = additionalCostPerBale * qty;
        const landedValue = baseValue + additionalCost;
        const landedRate = landedValue / qty;
        
        const offloadDateStr = item.offloadedAt instanceof Date 
          ? item.offloadedAt.toISOString().split('T')[0] 
          : String(item.offloadedAt).split('T')[0];
        
        transactions.push({
          date: offloadDateStr,
          particulars: `Container: ${item.containerCode} / PO: ${item.poNumber}`,
          vchType: 'PO Offload',
          voucherId: 0,
          poId: item.poId,
          inwardQty: qty,
          inwardRate: landedRate,
          inwardValue: landedValue,
          outwardQty: 0,
          outwardRate: 0,
          outwardValue: 0,
        });
      }
      
      // Sort transactions by date, with inward transactions before outward on same date
      transactions.sort((a, b) => {
        const dateCompare = new Date(a.date).getTime() - new Date(b.date).getTime();
        if (dateCompare !== 0) return dateCompare;
        // On same date, inward before outward (so opening stock shows first)
        if (a.inwardQty > 0 && b.outwardQty > 0) return -1;
        if (a.outwardQty > 0 && b.inwardQty > 0) return 1;
        return 0;
      });
      
      // Calculate in-month net movements from transactions
      let inMonthInwardQty = 0;
      let inMonthInwardValue = 0;
      let inMonthOutwardQty = 0;
      
      for (const t of transactions) {
        inMonthInwardQty += t.inwardQty;
        inMonthInwardValue += t.inwardValue;
        inMonthOutwardQty += t.outwardQty;
      }
      
      // Calculate what the opening balance SHOULD be based on:
      // expectedClosing = expectedOpening + inMonthInward - inMonthOutward
      // Therefore: expectedOpening = expectedClosing - inMonthInward + inMonthOutward
      const expectedOpeningQty = expectedClosingQty - inMonthInwardQty + inMonthOutwardQty;
      const expectedOpeningRate = expectedClosingRate; // Use the expected rate
      const expectedOpeningValue = expectedOpeningQty * expectedOpeningRate;
      
      // Compare voucher-derived opening with expected opening
      // The difference represents imported/adjusted stock not captured by vouchers
      const importedQty = expectedOpeningQty - voucherOpeningQty;
      const importedValue = expectedOpeningValue - voucherOpeningValue;
      const importedRate = importedQty > 0 ? importedValue / importedQty : 0;
      
      // Use the expected opening (which reconciles with inventory) as the actual opening
      // For value, use the expected rate from inventory (this ensures consistency)
      let openingQty = Math.round(expectedOpeningQty * 1000) / 1000;
      let openingRate = expectedClosingRate; // Use inventory's rate for consistency
      let openingValue = openingQty * openingRate;
      
      // Handle edge cases: if opening is negative, something is wrong
      if (openingQty < 0) {
        // Negative opening means more was sold than could have existed
        // This indicates data issues - clamp to zero for display
        openingQty = 0;
        openingValue = 0;
        openingRate = 0;
      }
      
      // Calculate running balance - start with the full expected opening (includes imports)
      let runningQty = openingQty;
      let runningValue = openingValue;
      
      const transactionsWithBalance: Array<{
        date: string;
        particulars: string;
        vchType: string;
        voucherId: number;
        poId?: number;
        inwardQty: number;
        inwardRate: number;
        inwardValue: number;
        outwardQty: number;
        outwardRate: number;
        outwardValue: number;
        closingQty: number;
        closingRate: number;
        closingValue: number;
        isOpeningBalance?: boolean;
        isPOS?: boolean;
        posSellingRate?: number;
        posSellingValue?: number;
      }> = [];
      
      // Add Opening Balance row if there's opening stock
      if (openingQty > 0 || openingValue > 0) {
        transactionsWithBalance.push({
          date: monthStartStr,
          particulars: 'Opening Balance',
          vchType: '',
          voucherId: 0,
          inwardQty: openingQty,
          inwardRate: openingRate,
          inwardValue: openingValue,
          outwardQty: 0,
          outwardRate: 0,
          outwardValue: 0,
          closingQty: openingQty,
          closingRate: openingRate,
          closingValue: openingValue,
          isOpeningBalance: true,
        });
      }
      
      // Calculate running balance for each transaction using weighted average cost
      for (const t of transactions) {
        const currentAvgRate = runningQty > 0 ? runningValue / runningQty : 0;
        runningQty += t.inwardQty - t.outwardQty;
        const actualOutwardCost = t.outwardQty * currentAvgRate;
        runningValue += t.inwardValue - actualOutwardCost;
        const avgClosingRate = runningQty > 0 ? runningValue / runningQty : 0;
        
        const displayOutwardRate = t.outwardQty !== 0 ? currentAvgRate : 0;
        const displayOutwardValue = t.outwardQty !== 0 ? actualOutwardCost : 0;
        
        transactionsWithBalance.push({
          ...t,
          outwardRate: displayOutwardRate,
          outwardValue: displayOutwardValue,
          closingQty: runningQty,
          closingRate: avgClosingRate,
          closingValue: runningValue,
        });
      }
      
      // Use expected closing values (derived from inventory) for totals to ensure reconciliation
      // This guarantees the report's closing balance matches actual inventory
      const finalClosingQty = Math.round(expectedClosingQty * 1000) / 1000;
      const finalClosingValue = expectedClosingValue;
      const finalClosingRate = finalClosingQty > 0 ? finalClosingValue / finalClosingQty : 0;
      
      // Update last transaction's closing to match expected closing
      if (transactionsWithBalance.length > 0) {
        const lastTx = transactionsWithBalance[transactionsWithBalance.length - 1];
        lastTx.closingQty = finalClosingQty;
        lastTx.closingRate = finalClosingRate;
        lastTx.closingValue = finalClosingValue;
      }
      
      const processedTransactions = transactionsWithBalance.filter(t => !t.isOpeningBalance);
      const totals = {
        inwardQty: processedTransactions.reduce((s, t) => s + t.inwardQty, 0),
        inwardRate: 0,
        inwardValue: processedTransactions.reduce((s, t) => s + t.inwardValue, 0),
        outwardQty: processedTransactions.reduce((s, t) => s + t.outwardQty, 0),
        outwardRate: 0,
        outwardValue: processedTransactions.reduce((s, t) => s + t.outwardValue, 0),
        closingQty: finalClosingQty,
        closingRate: finalClosingRate,
        closingValue: finalClosingValue,
      };
      totals.inwardRate = totals.inwardQty > 0 ? totals.inwardValue / totals.inwardQty : 0;
      totals.outwardRate = totals.outwardQty > 0 ? totals.outwardValue / totals.outwardQty : 0;
      
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                          'July', 'August', 'September', 'October', 'November', 'December'];
      
      res.json({
        stockItem,
        location,
        year,
        month,
        monthName: monthNames[month - 1],
        openingBalance: {
          qty: openingQty,
          rate: openingRate,
          value: openingValue,
        },
        transactions: transactionsWithBalance,
        totals,
      });
    } catch (error: any) {
      console.error('Location stock item monthly vouchers error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Location Summary - Matrix view of all stock groups/items across selected locations
  app.get("/api/location-summary", requireAuth, async (req, res) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.session.currentCompanyId;
      const locationIds = req.query.locationIds ? (req.query.locationIds as string).split(',').map(id => parseInt(id)) : [];
      const asOfDate = req.query.asOfDate as string || new Date().toISOString().split('T')[0];
      
      if (!companyId) {
        return res.status(400).json({ message: "Company ID is required" });
      }
      
      if (locationIds.length === 0) {
        return res.json({ stockGroups: [], grandTotals: {} });
      }
      
      // Get all stock groups for the company
      const allStockGroups = await db
        .select()
        .from(stockGroups)
        .where(and(eq(stockGroups.companyId, companyId), eq(stockGroups.active, true)))
        .orderBy(stockGroups.name);
      
      // Get all stock items with their groups
      const allStockItems = await db
        .select()
        .from(stockItems)
        .where(and(eq(stockItems.companyId, companyId), eq(stockItems.active, true)))
        .orderBy(stockItems.name);
      
      // Get inventory for the selected locations
      const inventoryData = await db
        .select({
          locationId: inventory.locationId,
          stockItemId: inventory.stockItemId,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .where(
          and(
            eq(inventory.companyId, companyId),
            inArray(inventory.locationId, locationIds)
          )
        );
      
      // Create lookup maps for inventory data - calculate value dynamically as qty * rate
      const inventoryMap = new Map<string, { quantity: number; rate: number; value: number }>();
      for (const inv of inventoryData) {
        const key = `${inv.locationId}-${inv.stockItemId}`;
        const qty = parseFloat(inv.quantity || "0");
        const rate = parseFloat(inv.averageRate || "0");
        inventoryMap.set(key, {
          quantity: qty,
          rate: rate,
          value: qty * rate,
        });
      }
      
      // Build response structure with stock groups containing items
      const result: Array<{
        id: number;
        code: string;
        name: string;
        locationData: Record<number, { quantity: number; rate: number; value: number }>;
        items: Array<{
          id: number;
          code: string;
          name: string;
          uom: string;
          locationData: Record<number, { quantity: number; rate: number; value: number }>;
        }>;
      }> = [];
      
      // Group stock items by their stockGroupId
      const itemsByGroup = new Map<number, typeof allStockItems>();
      const ungroupedItems: typeof allStockItems = [];
      
      for (const item of allStockItems) {
        if (item.stockGroupId) {
          if (!itemsByGroup.has(item.stockGroupId)) {
            itemsByGroup.set(item.stockGroupId, []);
          }
          itemsByGroup.get(item.stockGroupId)!.push(item);
        } else {
          ungroupedItems.push(item);
        }
      }
      
      // Build stock groups with their items and location data
      for (const group of allStockGroups) {
        const groupItems = itemsByGroup.get(group.id) || [];
        
        // Skip groups with no items that have inventory
        const groupHasInventory = groupItems.some(item => 
          locationIds.some(locId => {
            const key = `${locId}-${item.id}`;
            const inv = inventoryMap.get(key);
            return inv && inv.quantity !== 0;
          })
        );
        
        if (!groupHasInventory) continue;
        
        const groupLocationData: Record<number, { quantity: number; rate: number; value: number }> = {};
        
        // Initialize location totals for the group
        for (const locId of locationIds) {
          groupLocationData[locId] = { quantity: 0, rate: 0, value: 0 };
        }
        
        const itemsData: Array<{
          id: number;
          code: string;
          name: string;
          uom: string;
          locationData: Record<number, { quantity: number; rate: number; value: number }>;
        }> = [];
        
        for (const item of groupItems) {
          const itemLocationData: Record<number, { quantity: number; rate: number; value: number }> = {};
          let itemHasInventory = false;
          
          for (const locId of locationIds) {
            const key = `${locId}-${item.id}`;
            const inv = inventoryMap.get(key);
            
            if (inv && inv.quantity !== 0) {
              itemHasInventory = true;
              itemLocationData[locId] = inv;
              
              // Add to group totals
              groupLocationData[locId].quantity += inv.quantity;
              groupLocationData[locId].value += inv.value;
            } else {
              itemLocationData[locId] = { quantity: 0, rate: 0, value: 0 };
            }
          }
          
          if (itemHasInventory) {
            itemsData.push({
              id: item.id,
              code: item.code,
              name: item.name,
              uom: item.uom,
              locationData: itemLocationData,
            });
          }
        }
        
        // Calculate average rate for group totals
        for (const locId of locationIds) {
          if (groupLocationData[locId].quantity > 0) {
            groupLocationData[locId].rate = groupLocationData[locId].value / groupLocationData[locId].quantity;
          }
        }
        
        result.push({
          id: group.id,
          code: group.code,
          name: group.name,
          locationData: groupLocationData,
          items: itemsData,
        });
      }
      
      // Handle ungrouped items
      if (ungroupedItems.length > 0) {
        const ungroupedLocationData: Record<number, { quantity: number; rate: number; value: number }> = {};
        for (const locId of locationIds) {
          ungroupedLocationData[locId] = { quantity: 0, rate: 0, value: 0 };
        }
        
        const ungroupedItemsData: Array<{
          id: number;
          code: string;
          name: string;
          uom: string;
          locationData: Record<number, { quantity: number; rate: number; value: number }>;
        }> = [];
        
        for (const item of ungroupedItems) {
          const itemLocationData: Record<number, { quantity: number; rate: number; value: number }> = {};
          let itemHasInventory = false;
          
          for (const locId of locationIds) {
            const key = `${locId}-${item.id}`;
            const inv = inventoryMap.get(key);
            
            if (inv && inv.quantity !== 0) {
              itemHasInventory = true;
              itemLocationData[locId] = inv;
              ungroupedLocationData[locId].quantity += inv.quantity;
              ungroupedLocationData[locId].value += inv.value;
            } else {
              itemLocationData[locId] = { quantity: 0, rate: 0, value: 0 };
            }
          }
          
          if (itemHasInventory) {
            ungroupedItemsData.push({
              id: item.id,
              code: item.code,
              name: item.name,
              uom: item.uom,
              locationData: itemLocationData,
            });
          }
        }
        
        if (ungroupedItemsData.length > 0) {
          for (const locId of locationIds) {
            if (ungroupedLocationData[locId].quantity > 0) {
              ungroupedLocationData[locId].rate = ungroupedLocationData[locId].value / ungroupedLocationData[locId].quantity;
            }
          }
          
          result.push({
            id: 0,
            code: "UNGROUPED",
            name: "Ungrouped Items",
            locationData: ungroupedLocationData,
            items: ungroupedItemsData,
          });
        }
      }
      
      // Calculate grand totals per location
      const grandTotals: Record<number, { quantity: number; rate: number; value: number }> = {};
      for (const locId of locationIds) {
        grandTotals[locId] = { quantity: 0, rate: 0, value: 0 };
      }
      
      for (const group of result) {
        for (const locId of locationIds) {
          grandTotals[locId].quantity += group.locationData[locId]?.quantity || 0;
          grandTotals[locId].value += group.locationData[locId]?.value || 0;
        }
      }
      
      // Calculate average rate for grand totals
      for (const locId of locationIds) {
        if (grandTotals[locId].quantity > 0) {
          grandTotals[locId].rate = grandTotals[locId].value / grandTotals[locId].quantity;
        }
      }
      
      res.json({
        stockGroups: result,
        grandTotals,
        asOfDate,
      });
    } catch (error: any) {
      console.error('Location summary error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Cleanup endpoint to remove orphaned charge vouchers (no auth required for cleanup operations)
  app.post("/api/cleanup/orphaned-charges", async (req, res) => {
    try {
      // Find all CHARGE vouchers
      const chargeVouchers = await db
        .select()
        .from(vouchers)
        .where(sql`${vouchers.voucherNumber} LIKE 'CHARGE-%'`);

      let deletedCount = 0;

      for (const chargeVoucher of chargeVouchers) {
        // Extract container number from voucher number (format: CHARGE-CONT-XXXX-YYYY-...)
        const containerNumber = chargeVoucher.voucherNumber.split('-')[1] + '-' + chargeVoucher.voucherNumber.split('-')[2];
        
        // Check if any POs exist for this container
        const remainingPOs = await db
          .select()
          .from(purchaseOrders)
          .leftJoin(containers, eq(purchaseOrders.containerId, containers.id))
          .where(eq(containers.containerNumber, containerNumber))
          .limit(1);

        // If no POs for this container, delete the charge voucher
        if (remainingPOs.length === 0) {
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, chargeVoucher.id));
          await db.delete(vouchers).where(eq(vouchers.id, chargeVoucher.id));
          deletedCount++;
        }
      }

      res.json({
        message: `Cleaned up ${deletedCount} orphaned charge vouchers`,
        deletedCount,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================
  // DELETED ITEMS MANAGEMENT (Trash/Recycle Bin)
  // ============================================================

  // Get all deleted items (soft-deleted records)
  app.get("/api/deleted-items", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get deleted locations
      const deletedLocations = await db
        .select()
        .from(locations)
        .where(and(
          eq(locations.companyId, companyId),
          isNotNull(locations.deletedAt)
        ))
        .orderBy(desc(locations.deletedAt));

      // Get deleted stock items
      const deletedStockItems = await db
        .select()
        .from(stockItems)
        .where(and(
          eq(stockItems.companyId, companyId),
          isNotNull(stockItems.deletedAt)
        ))
        .orderBy(desc(stockItems.deletedAt));

      // Get deleted stock groups
      const deletedStockGroups = await db
        .select()
        .from(stockGroups)
        .where(and(
          eq(stockGroups.companyId, companyId),
          isNotNull(stockGroups.deletedAt)
        ))
        .orderBy(desc(stockGroups.deletedAt));

      // Get deleted ledger accounts
      const deletedLedgerAccounts = await db
        .select()
        .from(ledgerAccounts)
        .where(and(
          eq(ledgerAccounts.companyId, companyId),
          isNotNull(ledgerAccounts.deletedAt)
        ))
        .orderBy(desc(ledgerAccounts.deletedAt));

      // Get deleted employees
      const deletedEmployees = await db
        .select()
        .from(employees)
        .where(and(
          eq(employees.companyId, companyId),
          isNotNull(employees.deletedAt)
        ))
        .orderBy(desc(employees.deletedAt));

      // Get deleted customers
      const deletedCustomers = await db
        .select()
        .from(customers)
        .where(and(
          eq(customers.companyId, companyId),
          isNotNull(customers.deletedAt)
        ))
        .orderBy(desc(customers.deletedAt));

      // Note: Vouchers are not included in deleted items because they are hard-deleted
      // with inventory reversal due to complex business logic. They cannot be recovered.

      // Get deleted suppliers (suppliers are global, not company-specific)
      const deletedSuppliers = await db
        .select()
        .from(suppliers)
        .where(isNotNull(suppliers.deletedAt))
        .orderBy(desc(suppliers.deletedAt));

      // Get deleted bank accounts
      const deletedBankAccounts = await db
        .select()
        .from(bankAccounts)
        .where(and(
          eq(bankAccounts.companyId, companyId),
          isNotNull(bankAccounts.deletedAt)
        ))
        .orderBy(desc(bankAccounts.deletedAt));

      // Get deleted vouchers (payments, receipts, journals, stock transfers, POS sales, etc.)
      const deletedVouchers = await db
        .select()
        .from(vouchers)
        .where(and(
          eq(vouchers.companyId, companyId),
          isNotNull(vouchers.deletedAt)
        ))
        .orderBy(desc(vouchers.deletedAt));

      // Get orphaned POS sales - vouchers with locationId pointing to deleted or non-existent locations
      // Wrap in try-catch to prevent breaking the entire endpoint if this query fails
      let orphanedPosSales: any[] = [];
      try {
        orphanedPosSales = await db
          .select({
            id: vouchers.id,
            voucherNumber: vouchers.voucherNumber,
            voucherType: vouchers.voucherType,
            date: vouchers.voucherDate,
            totalAmount: vouchers.totalAmount,
            locationId: vouchers.locationId,
            locationName: locations.name,
            locationDeletedAt: locations.deletedAt,
          })
          .from(vouchers)
          .leftJoin(locations, eq(vouchers.locationId, locations.id))
          .where(
            and(
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              isNotNull(vouchers.locationId),
              or(
                isNull(locations.name), // Location doesn't exist (null from left join)
                isNotNull(locations.deletedAt) // Location is soft-deleted
              )
            )
          )
          .orderBy(desc(vouchers.voucherDate));
      } catch (err) {
        console.error("Error fetching orphaned POS sales:", err);
        orphanedPosSales = [];
      }

      res.json({
        locations: deletedLocations.map(l => ({
          id: l.id,
          type: "location",
          name: l.name,
          code: l.code,
          deletedAt: l.deletedAt,
        })),
        stockItems: deletedStockItems.map(s => ({
          id: s.id,
          type: "stockItem",
          name: s.name,
          code: s.code,
          deletedAt: s.deletedAt,
        })),
        stockGroups: deletedStockGroups.map(g => ({
          id: g.id,
          type: "stockGroup",
          name: g.name,
          code: g.code,
          deletedAt: g.deletedAt,
        })),
        ledgerAccounts: deletedLedgerAccounts.map(a => ({
          id: a.id,
          type: "ledgerAccount",
          name: a.name,
          code: a.code,
          accountType: a.accountType,
          deletedAt: a.deletedAt,
        })),
        employees: deletedEmployees.map(e => ({
          id: e.id,
          type: "employee",
          name: `${e.firstName} ${e.lastName}`,
          code: e.code,
          deletedAt: e.deletedAt,
        })),
        customers: deletedCustomers.map(c => ({
          id: c.id,
          type: "customer",
          name: c.legalName,
          code: c.code,
          deletedAt: c.deletedAt,
        })),
        suppliers: deletedSuppliers.map(s => ({
          id: s.id,
          type: "supplier",
          name: s.legalName,
          code: s.code,
          deletedAt: s.deletedAt,
        })),
        bankAccounts: deletedBankAccounts.map(b => ({
          id: b.id,
          type: "bankAccount",
          name: b.name,
          code: b.code,
          deletedAt: b.deletedAt,
        })),
        vouchers: deletedVouchers.map(v => ({
          id: v.id,
          type: "voucher",
          name: v.voucherNumber || "Unknown Voucher",
          code: v.voucherType || "-",
          voucherType: v.voucherType,
          amount: v.totalAmount != null ? Number(v.totalAmount) : 0,
          date: v.voucherDate,
          locationName: v.locationName || null,
          deletedAt: v.deletedAt,
        })),
        orphanedPosSales: (orphanedPosSales || []).map(v => ({
          id: v.id,
          type: "orphanedPosSale",
          name: v.voucherNumber || "Unknown Voucher",
          code: v.voucherType || "-",
          amount: v.totalAmount != null ? Number(v.totalAmount) : 0,
          date: v.date != null ? v.date : null,
          locationName: v.locationName ? `${v.locationName} (Deleted)` : "(Location Missing)",
          deletedAt: v.locationDeletedAt != null ? v.locationDeletedAt : (v.date != null ? v.date : null),
        })),
        totalCount: deletedLocations.length + deletedStockItems.length + deletedStockGroups.length + deletedVouchers.length +
          deletedLedgerAccounts.length + deletedEmployees.length + deletedCustomers.length +
          deletedSuppliers.length + deletedBankAccounts.length + (orphanedPosSales || []).length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Restore a deleted item
  app.post("/api/deleted-items/:type/:id/restore", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const { type, id } = req.params;
      const itemId = parseInt(id);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      switch (type) {
        case "location":
          await db.update(locations)
            .set({ deletedAt: null, active: true })
            .where(and(eq(locations.id, itemId), eq(locations.companyId, companyId)));
          break;
        case "stockItem":
          await db.update(stockItems)
            .set({ deletedAt: null, active: true })
            .where(and(eq(stockItems.id, itemId), eq(stockItems.companyId, companyId)));
          break;
        case "stockGroup":
          await db.update(stockGroups)
            .set({ deletedAt: null, active: true })
            .where(and(eq(stockGroups.id, itemId), eq(stockGroups.companyId, companyId)));
          break;
        case "ledgerAccount":
          await db.update(ledgerAccounts)
            .set({ deletedAt: null, active: true })
            .where(and(eq(ledgerAccounts.id, itemId), eq(ledgerAccounts.companyId, companyId)));
          break;
        case "employee":
          await db.update(employees)
            .set({ deletedAt: null, active: true })
            .where(and(eq(employees.id, itemId), eq(employees.companyId, companyId)));
          break;
        case "customer":
          await db.update(customers)
            .set({ deletedAt: null, active: true })
            .where(and(eq(customers.id, itemId), eq(customers.companyId, companyId)));
          break;
        case "supplier":
          await db.update(suppliers)
            .set({ deletedAt: null, active: true })
            .where(eq(suppliers.id, itemId));
          break;
        case "bankAccount":
          await db.update(bankAccounts)
            .set({ deletedAt: null, active: true })
            .where(and(eq(bankAccounts.id, itemId), eq(bankAccounts.companyId, companyId)));
          break;
        case "voucher":
          await db.update(vouchers)
            .set({ deletedAt: null })
            .where(and(eq(vouchers.id, itemId), eq(vouchers.companyId, companyId)));
          break;
        default:
          return res.status(400).json({ message: "Invalid item type" });
      }

      res.json({ message: `${type} restored successfully` });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Permanently delete an item
  app.delete("/api/deleted-items/:type/:id/permanent", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const { type, id } = req.params;
      const itemId = parseInt(id);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      switch (type) {
        case "location":
          await db.delete(locations)
            .where(and(eq(locations.id, itemId), eq(locations.companyId, companyId)));
          break;
        case "stockItem":
          // Also delete related aliases
          await db.delete(stockItemCodeAliases)
            .where(eq(stockItemCodeAliases.stockItemId, itemId));
          await db.delete(stockItems)
            .where(and(eq(stockItems.id, itemId), eq(stockItems.companyId, companyId)));
          break;
        case "stockGroup":
          await db.delete(stockGroups)
            .where(and(eq(stockGroups.id, itemId), eq(stockGroups.companyId, companyId)));
          break;
        case "ledgerAccount":
          await db.delete(ledgerAccounts)
            .where(and(eq(ledgerAccounts.id, itemId), eq(ledgerAccounts.companyId, companyId)));
          break;
        case "employee":
          await db.delete(employees)
            .where(and(eq(employees.id, itemId), eq(employees.companyId, companyId)));
          break;
        case "customer":
          await db.delete(customers)
            .where(and(eq(customers.id, itemId), eq(customers.companyId, companyId)));
          break;
        case "supplier":
          await db.delete(suppliers)
            .where(eq(suppliers.id, itemId));
          break;
        case "bankAccount":
          await db.delete(bankAccounts)
            .where(and(eq(bankAccounts.id, itemId), eq(bankAccounts.companyId, companyId)));
          break;
        case "voucher":
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, itemId));
          await db.delete(vouchers)
            .where(and(eq(vouchers.id, itemId), eq(vouchers.companyId, companyId)));
          break;
        case "orphanedPosSale":
          // Permanently delete an orphaned voucher and its entries
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, itemId));
          await db.delete(vouchers).where(
            and(
              eq(vouchers.id, itemId),
              eq(vouchers.companyId, companyId)
            )
          );
          break;
        default:
          return res.status(400).json({ message: "Invalid item type" });
      }

      res.json({ message: `${type} permanently deleted` });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============ AI Chatbot API Endpoints ============

  // Check if chatbot is enabled for current user
  app.get("/api/chatbot/status", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const companyId = req.session.currentCompanyId;
      const userRole = req.session.currentRole;
      
      if (!userId || !companyId) {
        return res.json({ enabled: false });
      }

      // Get user chatbot status
      const [user] = await db.select({ chatbotEnabled: users.chatbotEnabled })
        .from(users)
        .where(eq(users.id, userId));

      // Get selected AI provider and check if its API key is configured
      const providerSetting = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, "ai_provider")).limit(1);
      const selectedProvider = (providerSetting.length > 0 && providerSetting[0].value) ? providerSetting[0].value.toLowerCase() : "gemini";
      let hasApiKey = false;
      let providerName = "Gemini";
      if (selectedProvider === "chatgpt") {
        hasApiKey = !!process.env.OPENAI_API_KEY;
        providerName = "OpenAI";
      } else if (selectedProvider === "grok") {
        hasApiKey = !!process.env.XAI_API_KEY;
        providerName = "Grok";
      } else {
        hasApiKey = !!process.env.GEMINI_API_KEY;
        providerName = "Gemini";
      }

      res.json({
        enabled: true,
        providerName,
        selectedProvider,
        hasApiKey,
        isAdminOrOwner: userRole === "Admin" || userRole === "Owner",
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Send a chat message

  // Update AI provider setting
  app.patch("/api/chatbot/provider", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const userRole = req.session.currentRole;
      if (userRole !== "Admin" && userRole !== "Owner") {
        return res.status(403).json({ message: "Only admins can change AI provider" });
      }

      const { provider } = req.body;
      if (!provider || !["gemini", "chatgpt", "grok"].includes(provider.toLowerCase())) {
        return res.status(400).json({ message: "Invalid provider. Must be gemini, chatgpt, or grok" });
      }

      const normalizedProvider = provider.toLowerCase();
      
      // Check if setting exists
      const existing = await db.select().from(systemSettings).where(eq(systemSettings.key, "ai_provider")).limit(1);
      
      if (existing.length > 0) {
        await db.update(systemSettings)
          .set({ value: normalizedProvider, updatedAt: new Date() })
          .where(eq(systemSettings.key, "ai_provider"));
      } else {
        await db.insert(systemSettings).values({
          key: "ai_provider",
          value: normalizedProvider,
        } as any);
      }

      res.json({ success: true, provider: normalizedProvider });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  app.post("/api/chatbot/message", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const companyId = req.session.currentCompanyId;
      
      if (!userId || !companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { message, sessionId } = req.body;
      if (!message || !sessionId) {
        return res.status(400).json({ message: "Message and sessionId are required" });
      }

      // Save user message
      await saveMessage(companyId, userId, "user", message, sessionId);

      // Get conversation history for AI context (excluding current message)
      const history = await getConversationHistoryForAI(sessionId, 10);

      // Get AI response (excluding current message from history context)
      const result = await chat(message, companyId, history.slice(0, -1));

      // Save assistant response
      await saveMessage(companyId, userId, "assistant", result.response, sessionId);

      res.json({ response: result.response, suggestions: result.suggestions });
    } catch (error: any) {
      console.error("[Chatbot] ERROR:", error.message);
      console.error("[Chatbot] Stack:", error.stack);
      res.status(500).json({ message: "Chat error: " + error.message });
    }
  });

  // Get chat history for current session
  app.get("/api/chatbot/history/:sessionId", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { sessionId } = req.params;
      // Pass userId to ensure users can only access their own chat history
      const history = await getConversationHistory(sessionId, userId, 50);
      res.json(history);
    } catch (error: any) {
      console.error("[Chatbot] History ERROR:", error.message);
      console.error("[Chatbot] History Stack:", error.stack);
      res.status(500).json({ message: "History error: " + error.message });
    }
  });

  // Get all chat history (Admin/Owner only)
  app.get("/api/chatbot/all-history", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      const userRole = req.session.currentRole;
      
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Only Admin/Owner can view all chat history
      if (userRole !== "Admin" && userRole !== "Owner") {
        return res.status(403).json({ message: "Access denied" });
      }

      const history = await getAllChatHistory(companyId, 200);
      
      // Enrich with username
      const userIds = Array.from(new Set(history.map(h => h.userId)));
      const usersList = userIds.length > 0 
        ? await db.select({ id: users.id, username: users.username })
            .from(users)
            .where(inArray(users.id, userIds))
        : [];
      
      const userMap = new Map(usersList.map(u => [u.id, u.username]));
      
      const enrichedHistory = history.map(h => ({
        ...h,
        username: userMap.get(h.userId) || "Unknown",
      }));

      res.json(enrichedHistory);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Toggle chatbot for a user (Admin/Owner only)
  app.patch("/api/users/:userId/chatbot", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const userRole = req.session.currentRole;
      
      // Only Admin/Owner can toggle chatbot
      if (userRole !== "Admin" && userRole !== "Owner") {
        return res.status(403).json({ message: "Access denied" });
      }

      const { userId } = req.params;
      const { enabled } = req.body;

      await db.update(users)
        .set({ chatbotEnabled: enabled })
        .where(eq(users.id, userId));

      res.json({ message: `Chatbot ${enabled ? "enabled" : "disabled"} for user` });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get users with their chatbot status (Admin/Owner only)
  app.get("/api/users/chatbot-status", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const userRole = req.session.currentRole;
      
      if (userRole !== "Admin" && userRole !== "Owner") {
        return res.status(403).json({ message: "Access denied" });
      }

      const allUsers = await db.select({
        id: users.id,
        username: users.username,
        chatbotEnabled: users.chatbotEnabled,
        active: users.active,
      })
        .from(users)
        .where(eq(users.active, true));

      res.json(allUsers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================
  // EMPLOYEE SALARY ACCOUNT CLEANUP
  // Migrate legacy EMP-* ledger accounts to use employeeId directly
  // ============================================================

  // Get list of legacy EMP-* salary accounts
  app.get("/api/admin/legacy-employee-accounts", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Find all EMP-* ledger accounts (both active and soft-deleted)
      const allAccounts = await db
        .select()
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.companyId, companyId),
            like(ledgerAccounts.code, "EMP-%")
          )
        );

      // For each account, get usage count in voucher entries
      const accountsWithUsage = await Promise.all(
        allAccounts.map(async (account) => {
          const entries = await db
            .select({ count: sql<number>`count(*)` })
            .from(voucherEntries)
            .where(eq(voucherEntries.ledgerAccountId, account.id));
          
          const usageCount = entries[0]?.count || 0;
          
          // Extract employee code from EMP-{code}
          const employeeCode = account.code.replace("EMP-", "");
          
          // Try to find matching employee in the same company
          const employee = await storage.getEmployeeByCode(employeeCode);
          const employeeInSameCompany = employee && employee.companyId === companyId ? employee : null;
          
          return {
            id: account.id,
            code: account.code,
            name: account.name,
            accountType: account.accountType,
            isDeleted: !!account.deletedAt,
            deletedAt: account.deletedAt,
            usageCount,
            employeeCode,
            employeeId: employeeInSameCompany?.id || null,
            employeeName: employeeInSameCompany ? `${employeeInSameCompany.firstName} ${employeeInSameCompany.lastName}` : null,
            canMigrate: !!employeeInSameCompany && usageCount > 0,
            canDelete: usageCount === 0,
          };
        })
      );

      res.json({
        accounts: accountsWithUsage,
        totalCount: accountsWithUsage.length,
        activeCount: accountsWithUsage.filter(a => !a.isDeleted).length,
        withEntriesCount: accountsWithUsage.filter(a => a.usageCount > 0).length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Migrate voucher entries from EMP-* ledger account to use employeeId directly
  app.post("/api/admin/migrate-employee-account/:accountId", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const accountId = parseInt(req.params.accountId);
      if (isNaN(accountId)) {
        return res.status(400).json({ message: "Invalid account ID" });
      }

      // Get the EMP-* account
      const account = await storage.getLedgerAccountById(accountId);
      if (!account) {
        return res.status(404).json({ message: "Account not found" });
      }
      if (!account.code || !account.code.startsWith("EMP-")) {
        return res.status(400).json({ message: "Not an EMP-* legacy account" });
      }
      if (account.companyId !== companyId) {
        return res.status(403).json({ message: "Account belongs to a different company" });
      }

      // Extract employee code and find matching employee in the same company
      const employeeCode = account.code.replace("EMP-", "");
      const employee = await storage.getEmployeeByCode(employeeCode);
      if (!employee) {
        return res.status(400).json({ 
          message: `Cannot migrate: No employee found with code "${employeeCode}"` 
        });
      }
      if (employee.companyId !== companyId) {
        return res.status(400).json({ 
          message: `Cannot migrate: Employee "${employeeCode}" belongs to a different company` 
        });
      }

      // Migrate all voucher entries from ledgerAccountId to employeeId
      const result = await db
        .update(voucherEntries)
        .set({
          ledgerAccountId: null,
          employeeId: employee.id,
        })
        .where(eq(voucherEntries.ledgerAccountId, accountId))
        .returning();

      // Soft-delete the EMP-* account since it's no longer needed
      await db
        .update(ledgerAccounts)
        .set({ deletedAt: new Date(), active: false })
        .where(eq(ledgerAccounts.id, accountId));

      res.json({
        message: `Migrated ${result.length} voucher entries from ${account.code} to employee ${employee.code}`,
        migratedCount: result.length,
        accountDeleted: true,
        employeeId: employee.id,
        employeeCode: employee.code,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk migrate and cleanup all EMP-* accounts for the current company
  app.post("/api/admin/cleanup-legacy-employee-accounts", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Find all active EMP-* ledger accounts
      const empAccounts = await db
        .select()
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.companyId, companyId),
            like(ledgerAccounts.code, "EMP-%"),
            isNull(ledgerAccounts.deletedAt)
          )
        );

      const results: Array<{
        accountCode: string;
        accountId: number;
        employeeCode: string;
        migratedEntries: number;
        status: "migrated" | "deleted" | "skipped";
        message: string;
      }> = [];

      for (const account of empAccounts) {
        const employeeCode = account.code.replace("EMP-", "");
        const employeeRaw = await storage.getEmployeeByCode(employeeCode);
        // Only use employee if in same company
        const employee = employeeRaw && employeeRaw.companyId === companyId ? employeeRaw : null;

        // Get voucher entries count for this account
        const entries = await db
          .select()
          .from(voucherEntries)
          .where(eq(voucherEntries.ledgerAccountId, account.id));

        if (entries.length === 0) {
          // No entries - just soft-delete the account
          await db
            .update(ledgerAccounts)
            .set({ deletedAt: new Date(), active: false })
            .where(eq(ledgerAccounts.id, account.id));

          results.push({
            accountCode: account.code,
            accountId: account.id,
            employeeCode,
            migratedEntries: 0,
            status: "deleted",
            message: "Account had no entries, soft-deleted",
          });
        } else if (employee) {
          // Has entries and matching employee - migrate then delete
          await db
            .update(voucherEntries)
            .set({
              ledgerAccountId: null,
              employeeId: employee.id,
            })
            .where(eq(voucherEntries.ledgerAccountId, account.id));

          await db
            .update(ledgerAccounts)
            .set({ deletedAt: new Date(), active: false })
            .where(eq(ledgerAccounts.id, account.id));

          results.push({
            accountCode: account.code,
            accountId: account.id,
            employeeCode,
            migratedEntries: entries.length,
            status: "migrated",
            message: `Migrated ${entries.length} entries to employee ${employee.code}`,
          });
        } else {
          // Has entries but no matching employee - skip
          results.push({
            accountCode: account.code,
            accountId: account.id,
            employeeCode,
            migratedEntries: 0,
            status: "skipped",
            message: `Skipped: No matching employee found for code "${employeeCode}"`,
          });
        }
      }

      const migrated = results.filter(r => r.status === "migrated").length;
      const deleted = results.filter(r => r.status === "deleted").length;
      const skipped = results.filter(r => r.status === "skipped").length;

      res.json({
        message: `Cleanup complete: ${migrated} migrated, ${deleted} deleted, ${skipped} skipped`,
        results,
        summary: { migrated, deleted, skipped, total: results.length },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Shared helper: compute the raw import cycle balance for a given company.
  // Uses the identical formula as /api/stats/import-cycle-balance (without the stored equity adjustment).
  // Shared by both the single-company and all-companies recalculate endpoints.
  const computeRawBalance = async (companyId: number): Promise<number> => {

    const getBalance = async (accountType: string, isLiability = false): Promise<number> => {
      const accts = await db.select().from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.accountType, accountType), isNull(ledgerAccounts.deletedAt)));
      let total = 0;
      for (const acct of accts) {
        const entries = await db.select({ cr: voucherEntries.creditAmount, dr: voucherEntries.debitAmount })
          .from(voucherEntries).innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(and(eq(voucherEntries.ledgerAccountId, acct.id), eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));
        const raw = parseFloat(acct.openingBalance || "0");
        const side = acct.openingBalanceSide || "Dr";
        const signedOpening = isLiability ? (side === "Cr" ? raw : -raw) : (side === "Dr" ? raw : -raw);
        total += entries.reduce((s, e) => {
          const cr = parseFloat(e.cr || "0"); const dr = parseFloat(e.dr || "0");
          return s + (isLiability ? cr - dr : dr - cr);
        }, signedOpening);
      }
      return total;
    };

    const getTxBalance = async (accountType: string, isLiability = true): Promise<number> => {
      const r = await db.select({
        totalCredit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.creditAmount} AS DECIMAL)), 0)`,
        totalDebit:  sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount}  AS DECIMAL)), 0)`,
      }).from(voucherEntries).innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .innerJoin(ledgerAccounts, eq(voucherEntries.ledgerAccountId, ledgerAccounts.id))
        .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.accountType, accountType),
          isNull(ledgerAccounts.deletedAt), eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));
      const cr = parseFloat(r[0]?.totalCredit || "0"); const dr = parseFloat(r[0]?.totalDebit || "0");
      return isLiability ? cr - dr : dr - cr;
    };

    const supplierEntries = await db.select({ supplierId: voucherEntries.supplierId, cr: voucherEntries.creditAmount, dr: voucherEntries.debitAmount })
      .from(voucherEntries).innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .where(and(isNotNull(voucherEntries.supplierId), eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));
    const allSuppliersRaw = await storage.getAllSuppliers();
    const activeSupplierIds = new Set(supplierEntries.map(e => e.supplierId).filter(Boolean));
    const coContainers = await db.select({ supplierId: containers.supplierId }).from(containers).where(eq(containers.companyId, companyId));
    for (const c of coContainers) { if (c.supplierId) activeSupplierIds.add(c.supplierId); }
    const supplierOpeningTotal = allSuppliersRaw.filter(s => activeSupplierIds.has(s.id)).reduce((s, sup) => s + parseFloat(sup.openingBalance || "0"), 0);
    const supplierBalance = supplierEntries.reduce((s, e) => s + parseFloat(e.cr || "0") - parseFloat(e.dr || "0"), supplierOpeningTotal);

    const otwRows = await db.select({ grandTotal: containers.grandTotal }).from(containers)
      .where(and(eq(containers.companyId, companyId), eq(containers.status, "OTW")));
    const stockOtwValue = otwRows.reduce((s, c) => s + parseFloat(c.grandTotal || "0"), 0);

    const dutyAgentBalance        = await getBalance("Duty Agent", true);
    const transporterAgentBalance = await getBalance("Transporter Agent", true);
    const loansBalance            = await getBalance("Loans", true);
    const cashBalance             = await getBalance("Cash", false);

    const ledgerBankBalance = await getBalance("Bank", false);
    const standaloneBankEntries = await db.select({ cr: voucherEntries.creditAmount, dr: voucherEntries.debitAmount })
      .from(voucherEntries).innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .innerJoin(bankAccounts, eq(voucherEntries.bankAccountId, bankAccounts.id))
      .where(and(isNotNull(voucherEntries.bankAccountId), isNull(voucherEntries.ledgerAccountId),
        isNull(bankAccounts.linkedLedgerId), eq(bankAccounts.companyId, companyId),
        isNull(bankAccounts.deletedAt), eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));
    const standaloneBankAccts = await db.select().from(bankAccounts)
      .where(and(eq(bankAccounts.companyId, companyId), isNull(bankAccounts.deletedAt), isNull(bankAccounts.linkedLedgerId)));
    const standaloneOpening = standaloneBankAccts.reduce((s, a) => {
      const raw = parseFloat(a.openingBalance || "0"); return s + ((a.openingBalanceSide || "Dr") === "Dr" ? raw : -raw);
    }, 0);
    const standaloneVoucher = standaloneBankEntries.reduce((s, e) => s + parseFloat(e.dr || "0") - parseFloat(e.cr || "0"), 0);
    const bankBalance = ledgerBankBalance + standaloneOpening + standaloneVoucher;

    const indirectExpenseBalance = await getBalance("Indirect Expense", false);
    const incomeBalance          = await getBalance("Income", true);

    const invRows = await db.select({ quantity: inventory.quantity, averageRate: inventory.averageRate })
      .from(inventory).innerJoin(locations, eq(inventory.locationId, locations.id))
      .where(and(eq(inventory.companyId, companyId), isNull(locations.deletedAt)));
    const stockOnFloorValue = invRows.reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.averageRate || "0"), 0);

    const cogsRows = await db.select({ totalCost: salesItems.totalCost }).from(salesItems)
      .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
      .where(and(eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));
    const cogsBalance = cogsRows.reduce((s, i) => s + parseFloat(i.totalCost || "0"), 0);

    const payrollAccts = await db.select({ id: ledgerAccounts.id, openingBalance: ledgerAccounts.openingBalance })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.accountType, "Expense"),
        sql`(${ledgerAccounts.name} ILIKE '%salary%' OR ${ledgerAccounts.name} ILIKE '%payroll%' OR ${ledgerAccounts.name} ILIKE '%wage%')`,
        isNull(ledgerAccounts.deletedAt)));
    let payrollExpenseBalance = 0;
    if (payrollAccts.length > 0) {
      const payrollIds = payrollAccts.map(a => a.id);
      const payrollEntries = await db.select({ cr: voucherEntries.creditAmount, dr: voucherEntries.debitAmount })
        .from(voucherEntries).innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(inArray(voucherEntries.ledgerAccountId, payrollIds), eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));
      const openingTot = payrollAccts.reduce((s, a) => s + parseFloat(a.openingBalance || "0"), 0);
      const txTot = payrollEntries.reduce((s, e) => s + parseFloat(e.dr || "0") - parseFloat(e.cr || "0"), 0);
      payrollExpenseBalance = openingTot + txTot;
    }

    const advRows = await db.select({ remainingBalance: salaryAdvances.remainingBalance }).from(salaryAdvances)
      .where(and(eq(salaryAdvances.companyId, companyId), eq(salaryAdvances.fullyPaid, false)));
    const salaryAdvancesBalance = advRows.reduce((s, a) => s + parseFloat(a.remainingBalance || "0"), 0);

    const empRows = await db.select({ currentBalance: employees.currentBalance }).from(employees)
      .where(and(eq(employees.companyId, companyId), isNull(employees.deletedAt)));
    const payrollLiabilitiesBalance = empRows.reduce((s, e) => { const b = parseFloat(e.currentBalance || "0"); return s + (b > 0 ? b : 0); }, 0);

    const assetBalance             = await getBalance("Asset", false);
    const governmentTaxesBalance   = await getBalance("Government Taxes", false);
    const liabilityBalance         = await getBalance("Liability", true);
    const profitBalance            = await getBalance("Profit", true);
    const equityTransactionBalance = await getTxBalance("Equity", true);
    const apTransactionBalance     = await getTxBalance("Accounts Payable", true);

    const allLedgerAccts = await db.select({ openingBalance: ledgerAccounts.openingBalance, openingBalanceSide: ledgerAccounts.openingBalanceSide })
      .from(ledgerAccounts).where(and(eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt)));
    let totalDrOpenings = 0; let totalCrOpenings = 0;
    for (const a of allLedgerAccts) {
      const raw = parseFloat(a.openingBalance || "0");
      if (raw === 0) continue;
      if ((a.openingBalanceSide || "Dr") === "Dr") totalDrOpenings += raw; else totalCrOpenings += raw;
    }
    const empOpenings = await db.select({ openingBalance: employees.openingBalance }).from(employees)
      .where(and(eq(employees.companyId, companyId), isNull(employees.deletedAt)));
    totalCrOpenings += empOpenings.reduce((s, e) => s + parseFloat(e.openingBalance || "0"), 0);
    let openingBalanceEquity = totalCrOpenings - totalDrOpenings;

    const stockItemOpenings = await db.select({ openingValue: stockItems.openingValue }).from(stockItems)
      .where(and(eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)));
    openingBalanceEquity -= stockItemOpenings.reduce((s, i) => s + parseFloat(i.openingValue || "0"), 0);

    return Math.round((
      (stockOtwValue + cashBalance + bankBalance + stockOnFloorValue + assetBalance +
       indirectExpenseBalance + payrollExpenseBalance + governmentTaxesBalance + cogsBalance + salaryAdvancesBalance) -
      (supplierBalance + dutyAgentBalance + transporterAgentBalance + loansBalance + liabilityBalance +
       profitBalance + equityTransactionBalance + apTransactionBalance + incomeBalance + payrollLiabilitiesBalance -
       openingBalanceEquity)
    ) * 100) / 100;
  };

  // Recalculate Opening Balance Equity adjustment
  // Self-sufficient: computes rawBalance server-side so no body params are needed.
  app.post("/api/admin/recalculate-equity-adjustment", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Compute raw balance server-side using the canonical formula.
      // Formula: newAdjustment = -rawBalance  →  rawBalance + newAdjustment = 0
      const rawBalance = await computeRawBalance(companyId);

      // Get current equity adjustment for the "previous" value in the response
      const settingKey = `equity_adjustment_${companyId}`;
      const existingAdjustment = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, settingKey));
      const currentAdjustment = existingAdjustment.length > 0
        ? parseFloat(existingAdjustment[0].value || "0")
        : 0;

      const newAdjustment = -rawBalance;

      // Atomic upsert — avoids race conditions and duplicate key errors
      await db.insert(systemSettings)
        .values({ key: settingKey, value: newAdjustment.toFixed(2) })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: newAdjustment.toFixed(2), updatedAt: new Date() } });

      res.json({
        success: true,
        message: `Equity adjustment updated. The import cycle balance should now be $0.`,
        previousAdjustment: currentAdjustment.toFixed(2),
        newAdjustment: newAdjustment.toFixed(2),
        balanceZeroed: rawBalance.toFixed(2),
      });
    } catch (error: any) {
      console.error("Recalculate equity adjustment error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Recalculate equity adjustment for ALL companies in one operation.
  // Uses the identical formula as /api/stats/import-cycle-balance so each company
  // gets the exact same precision as the single-company endpoint.
  app.post("/api/admin/recalculate-equity-adjustment-all", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const allCompanies = await storage.getAllCompanies();

      // computeRawBalance is defined at module scope above — shared with single-company endpoint.
      // Kept as a placeholder comment for readability only.

      const results: Array<{ companyId: number; companyName: string; rawBalance: number; newAdjustment: number | null; skipped: boolean }> = [];

      for (const company of allCompanies) {
        const rawBalance = await computeRawBalance(company.id);
        const skipped = Math.abs(rawBalance) <= 0.01;
        const newAdjustment = skipped ? null : -rawBalance;

        if (!skipped) {
          const settingKey = `equity_adjustment_${company.id}`;
          await db.insert(systemSettings)
            .values({ key: settingKey, value: newAdjustment!.toFixed(2) })
            .onConflictDoUpdate({ target: systemSettings.key, set: { value: newAdjustment!.toFixed(2), updatedAt: new Date() } });
        }

        results.push({ companyId: company.id, companyName: company.name, rawBalance, newAdjustment, skipped });
      }

      const adjustedCount = results.filter(r => !r.skipped).length;
      const skippedCount  = results.filter(r =>  r.skipped).length;

      res.json({
        success: true,
        message: `Processed ${results.length} ${results.length === 1 ? "company" : "companies"} — ${adjustedCount} adjusted, ${skippedCount} already balanced.`,
        results,
      });
    } catch (error: any) {
      console.error("Recalculate equity adjustment all error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Fix orphaned POS data that might be causing Import Cycle imbalance
  // This finds sales items linked to deleted vouchers and cleans them up
  app.post("/api/admin/fix-orphaned-pos-data", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const results: any[] = [];

      // 1. Find orphaned salesItems for THIS COMPANY (voucher is deleted but companyId matches)
      // We only clean up items where we can verify the company to prevent cross-company data loss
      const orphanedSalesItemsForCompany = await db
        .select({
          id: salesItems.id,
          voucherId: salesItems.voucherId,
          stockItemId: salesItems.stockItemId,
          quantity: salesItems.quantity,
          totalCost: salesItems.totalCost,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNotNull(vouchers.deletedAt)
          )
        );

      // Also find completely orphaned salesItems (no voucher at all) - these are dangerous orphans
      // Get all salesItem voucherIds that don't have corresponding vouchers
      const allSalesItemVoucherIds = await db
        .selectDistinct({ voucherId: salesItems.voucherId })
        .from(salesItems);
      
      const existingVoucherIds = new Set(
        (await db.select({ id: vouchers.id }).from(vouchers))
          .map(v => v.id)
      );
      
      const trulyOrphanedVoucherIds = allSalesItemVoucherIds
        .filter(item => !existingVoucherIds.has(item.voucherId))
        .map(item => item.voucherId);

      let trulyOrphanedSalesItems: typeof orphanedSalesItemsForCompany = [];
      if (trulyOrphanedVoucherIds.length > 0) {
        trulyOrphanedSalesItems = await db
          .select({
            id: salesItems.id,
            voucherId: salesItems.voucherId,
            stockItemId: salesItems.stockItemId,
            quantity: salesItems.quantity,
            totalCost: salesItems.totalCost,
          })
          .from(salesItems)
          .where(inArray(salesItems.voucherId, trulyOrphanedVoucherIds));
      }

      const allOrphanedSalesItems = [...orphanedSalesItemsForCompany, ...trulyOrphanedSalesItems];

      if (allOrphanedSalesItems.length > 0) {
        results.push({
          type: "orphaned_sales_items",
          count: allOrphanedSalesItems.length,
          companyScoped: orphanedSalesItemsForCompany.length,
          trulyOrphaned: trulyOrphanedSalesItems.length,
          totalCost: allOrphanedSalesItems.reduce((sum, item) => sum + parseFloat(item.totalCost || "0"), 0),
          details: allOrphanedSalesItems.slice(0, 10),
        });

        // Delete orphaned sales items
        for (const item of allOrphanedSalesItems) {
          await db.delete(salesItems).where(eq(salesItems.id, item.id));
        }
      }

      // 2. Find orphaned voucherEntries for THIS COMPANY (voucher is deleted but companyId matches)
      const orphanedEntriesForCompany = await db
        .select({
          id: voucherEntries.id,
          voucherId: voucherEntries.voucherId,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNotNull(vouchers.deletedAt)
          )
        );

      // Also find completely orphaned entries (no voucher at all)
      const allEntryVoucherIds = await db
        .selectDistinct({ voucherId: voucherEntries.voucherId })
        .from(voucherEntries);
      
      const trulyOrphanedEntryVoucherIds = allEntryVoucherIds
        .filter(item => item.voucherId && !existingVoucherIds.has(item.voucherId))
        .map(item => item.voucherId);

      let trulyOrphanedEntries: typeof orphanedEntriesForCompany = [];
      if (trulyOrphanedEntryVoucherIds.length > 0) {
        trulyOrphanedEntries = await db
          .select({
            id: voucherEntries.id,
            voucherId: voucherEntries.voucherId,
            debitAmount: voucherEntries.debitAmount,
            creditAmount: voucherEntries.creditAmount,
          })
          .from(voucherEntries)
          .where(inArray(voucherEntries.voucherId, trulyOrphanedEntryVoucherIds as number[]));
      }

      const allOrphanedEntries = [...orphanedEntriesForCompany, ...trulyOrphanedEntries];

      if (allOrphanedEntries.length > 0) {
        const totalDebits = allOrphanedEntries.reduce((sum, e) => sum + parseFloat(e.debitAmount || "0"), 0);
        const totalCredits = allOrphanedEntries.reduce((sum, e) => sum + parseFloat(e.creditAmount || "0"), 0);
        
        results.push({
          type: "orphaned_voucher_entries",
          count: allOrphanedEntries.length,
          companyScoped: orphanedEntriesForCompany.length,
          trulyOrphaned: trulyOrphanedEntries.length,
          totalDebits,
          totalCredits,
        });

        // Delete orphaned entries
        for (const entry of allOrphanedEntries) {
          await db.delete(voucherEntries).where(eq(voucherEntries.id, entry.id));
        }
      }

      // 3. Check for negative inventory and log (don't fix automatically)
      const negativeInventory = await db
        .select({
          id: inventory.id,
          locationId: inventory.locationId,
          stockItemId: inventory.stockItemId,
          quantity: inventory.quantity,
        })
        .from(inventory)
        .where(
          and(
            eq(inventory.companyId, companyId),
            sql`CAST(${inventory.quantity} AS DECIMAL) < 0`
          )
        );

      if (negativeInventory.length > 0) {
        results.push({
          type: "negative_inventory",
          count: negativeInventory.length,
          warning: "These need manual review - might indicate overselling or data issues",
          items: negativeInventory.slice(0, 10),
        });
      }

      res.json({
        message: `Cleanup complete: Fixed ${allOrphanedSalesItems.length} orphaned sales items, ${allOrphanedEntries.length} orphaned entries. Found ${negativeInventory.length} negative inventory items.`,
        results,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get orphaned POS sales (vouchers at deleted locations)
  app.get("/api/admin/orphaned-pos-sales", requireAuth, requireRole("Admin", "Owner"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Find all vouchers with locationId pointing to deleted or non-existent locations
      const orphanedVouchers = await db
        .select({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          locationId: vouchers.locationId,
          notes: vouchers.description,
        })
        .from(vouchers)
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            isNotNull(vouchers.locationId),
            or(
              isNull(locations.id), // Location doesn't exist
              isNotNull(locations.deletedAt) // Location is soft-deleted
            )
          )
        );

      // Get entry totals for each orphaned voucher
      const vouchersWithTotals = await Promise.all(
        orphanedVouchers.map(async (v) => {
          const entries = await db
            .select({
              debitAmount: voucherEntries.debitAmount,
              creditAmount: voucherEntries.creditAmount,
            })
            .from(voucherEntries)
            .where(eq(voucherEntries.voucherId, v.id));

          const totalDebit = entries.reduce((sum, e) => sum + parseFloat(e.debitAmount || "0"), 0);
          const totalCredit = entries.reduce((sum, e) => sum + parseFloat(e.creditAmount || "0"), 0);

          // Check if it has sales items
          const saleItems = await db
            .select({ id: salesItems.id, quantity: salesItems.quantity, totalCost: salesItems.totalCost })
            .from(salesItems)
            .where(eq(salesItems.voucherId, v.id));

          return {
            ...v,
            totalDebit,
            totalCredit,
            salesItemCount: saleItems.length,
            salesItemsTotalCost: saleItems.reduce((sum, s) => sum + parseFloat(s.totalCost || "0"), 0),
          };
        })
      );

      const totalImpact = vouchersWithTotals.reduce((sum, v) => sum + Math.abs(v.totalDebit - v.totalCredit), 0);

      res.json({
        count: vouchersWithTotals.length,
        totalImpact,
        vouchers: vouchersWithTotals,
        explanation: "These vouchers have a locationId that points to a deleted or non-existent location. They are orphaned and can be safely deleted.",
      });
    } catch (error: any) {
      console.error("Orphaned POS sales check error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Delete orphaned POS sales (vouchers at deleted locations)
  app.post("/api/admin/delete-orphaned-pos-sales", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Find all vouchers with locationId pointing to deleted or non-existent locations
      const orphanedVouchers = await db
        .select({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
        })
        .from(vouchers)
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            isNotNull(vouchers.locationId),
            or(
              isNull(locations.id), // Location doesn't exist
              isNotNull(locations.deletedAt) // Location is soft-deleted
            )
          )
        );

      if (orphanedVouchers.length === 0) {
        return res.json({ message: "No orphaned POS sales found", deleted: 0 });
      }

      const voucherIds = orphanedVouchers.map(v => v.id);

      // Use batch deletes with inArray for efficiency
      // Delete sales items first (foreign key constraint)
      const salesResult = await db.delete(salesItems).where(inArray(salesItems.voucherId, voucherIds));
      const deletedSalesItems = (salesResult as any).rowCount || voucherIds.length;

      // Delete voucher entries
      const entriesResult = await db.delete(voucherEntries).where(inArray(voucherEntries.voucherId, voucherIds));
      const deletedEntries = (entriesResult as any).rowCount || voucherIds.length;

      // Delete the vouchers themselves (hard delete since they're orphaned garbage)
      const vouchersResult = await db.delete(vouchers).where(inArray(vouchers.id, voucherIds));
      const deletedVouchers = (vouchersResult as any).rowCount || voucherIds.length;

      res.json({
        message: `Deleted ${deletedVouchers} orphaned POS vouchers, ${deletedEntries} entries, and ${deletedSalesItems} sales items`,
        deleted: deletedVouchers,
        deletedEntries,
        deletedSalesItems,
        voucherNumbers: orphanedVouchers.map(v => v.voucherNumber),
      });
    } catch (error: any) {
      console.error("Delete orphaned POS sales error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Role Feature Permissions API
  // Get all role permissions for the current company
  app.get(
    "/api/settings/role-permissions",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const permissions = await storage.getRoleFeaturePermissions(companyId);
        res.json(permissions);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // Update role permissions (bulk upsert)
  app.put(
    "/api/settings/role-permissions",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { permissions } = req.body;
        if (!Array.isArray(permissions)) {
          return res.status(400).json({ message: "permissions must be an array" });
        }

        // Add companyId to each permission
        const permissionsWithCompany = permissions.map((p: any) => ({
          ...p,
          companyId,
        }));

        const results = await storage.bulkUpsertRoleFeaturePermissions(permissionsWithCompany);
        res.json({ message: "Permissions updated successfully", permissions: results });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // Get permissions for the current user's role (used by sidebar)
  app.get(
    "/api/my-permissions",
    requireAuth,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        const role = req.session.currentRole;

        if (!companyId || !role) {
          return res.status(400).json({ message: "No company or role selected" });
        }

        // Get all permissions for this company and role
        const allPermissions = await storage.getRoleFeaturePermissions(companyId);
        const rolePermissions = allPermissions.filter(p => p.role === role);

        res.json(rolePermissions);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // ==========================================
  // Test Data Import API (for testing Net Profit)
  // ==========================================
  
  // Create a test data voucher (Journal entry marked as optional with TEST- prefix)
  app.post(
    "/api/test-data/vouchers",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { date, debitAccountId, creditAccountId, amount, description } = req.body;

        // Validate required fields
        if (!date || !debitAccountId || !creditAccountId || !amount) {
          return res.status(400).json({ message: "Missing required fields: date, debitAccountId, creditAccountId, amount" });
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
          return res.status(400).json({ message: "Amount must be a positive number" });
        }

        // Verify debit account exists and belongs to current company
        const debitAccount = await storage.getLedgerAccountById(debitAccountId);
        if (!debitAccount || debitAccount.companyId !== companyId) {
          return res.status(404).json({ message: "Debit account not found or doesn't belong to current company" });
        }

        // Verify credit account exists and belongs to current company
        const creditAccount = await storage.getLedgerAccountById(creditAccountId);
        if (!creditAccount || creditAccount.companyId !== companyId) {
          return res.status(404).json({ message: "Credit account not found or doesn't belong to current company" });
        }

        // Generate a unique voucher number with TEST- prefix
        const voucherNumber = `TEST-${Date.now()}`;

        // Create the voucher as optional (excluded from calculations by default)
        const [voucher] = await db
          .insert(vouchers)
          .values({
            companyId,
            voucherNumber,
            voucherType: "Journal",
            voucherDate: date,
            description: description || `Test data entry`,
            totalAmount: parsedAmount.toFixed(2),
            optional: true, // Start as draft/optional
          })
          .returning();

        // Create debit entry
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: debitAccountId,
          debitAmount: parsedAmount.toFixed(2),
          creditAmount: "0",
          narration: `Test data - ${description || debitAccount.name}`,
        });

        // Create credit entry
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: creditAccountId,
          debitAmount: "0",
          creditAmount: parsedAmount.toFixed(2),
          narration: `Test data - ${description || creditAccount.name}`,
        });

        res.status(201).json({
          voucher,
          message: "Test entry created as optional (draft). Toggle to apply to calculations.",
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // ==========================================
  // Fix Old PO Inter-Company Credits
  // ==========================================
  
  app.post(
    "/api/fix-old-po-credits",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { companyId, parentCompanyId } = req.body;
        
        if (!companyId) {
          return res.status(400).json({ 
            message: "Please select a subsidiary company to process." 
          });
        }
        
        if (!parentCompanyId) {
          return res.status(400).json({ 
            message: "Please select a parent company." 
          });
        }
        
        const allCompanies = await storage.getAllCompanies();
        
        const parentCompany = allCompanies.find(c => c.id === parentCompanyId);
        
        if (!parentCompany) {
          return res.status(400).json({ 
            message: "Selected parent company not found." 
          });
        }
        
        // Find the selected subsidiary company
        const selectedCompany = allCompanies.find(c => c.id === companyId);
        
        if (!selectedCompany) {
          return res.status(400).json({ 
            message: "Selected subsidiary company not found." 
          });
        }
        
        if (selectedCompany.id === parentCompany.id) {
          return res.status(400).json({ 
            message: "Subsidiary and parent company cannot be the same." 
          });
        }
        
        // Process only the selected subsidiary
        const companiesToProcess = [selectedCompany];
        
        let totalFixed = 0;
        let totalAmount = 0;

      // First, group offloaded containers by agent
      for (const container of offloadedContainers) {
        const agent = container.agent || "Unassigned";
        if (!byAgent[agent]) byAgent[agent] = { containers: [], offloadedContainers: [], total: 0, offloadedTotal: 0, balance: agentBalances[agent] || 0 };
        byAgent[agent].offloadedContainers.push(container);
        byAgent[agent].offloadedTotal += parseFloat(container.dutyFee || "0");
      }
        const details: Array<{ company: string; poNumber: string; amount: number }> = [];
        
        // Process each company
        for (const company of companiesToProcess) {
          // Get or create "[Parent Company] Credit" account for this subsidiary
          const parentCreditCode = parentCompany.name.toUpperCase().replace(/\s+/g, '_') + "_CREDIT";
          const parentCreditName = parentCompany.name + " Credit";
          
          let creditAccount = await db
            .select()
            .from(ledgerAccounts)
            .where(
              and(
                eq(ledgerAccounts.companyId, company.id),
                eq(ledgerAccounts.code, parentCreditCode),
                isNull(ledgerAccounts.deletedAt)
              )
            )
            .limit(1);
          
          if (!creditAccount.length) {
            const [newAccount] = await db.insert(ledgerAccounts).values({
              companyId: company.id,
              code: parentCreditCode,
              name: parentCreditName,
              accountType: "Liability",
              subType: "Current Liability",
              openingBalance: "0",
              openingBalanceSide: "Cr",
            }).returning();
            creditAccount = [newAccount];
          }
          
          // Get all purchase orders for this company
          const companyPOs = await db
            .select()
            .from(purchaseOrders)
            .where(eq(purchaseOrders.companyId, company.id));
          
          for (const po of companyPOs) {
            // Check if this PO is for an offloaded container
            const [container] = await db
              .select()
              .from(containers)
              .where(eq(containers.id, po.containerId));
            
            if (!container || container.status !== "OFFLOADED") {
              continue; // Skip non-offloaded containers
            }
            
            // Check if credit entry already exists for this PO
            // For OLD fixed POs: fix endpoint uses INTERCO-* in subsidiary and INTERCO-LUB-* in Lubumbashi
            // Check voucher patterns to prevent duplicates
            // NOTE: po.voucherId is for the import voucher (DR Purchases, CR Supplier), NOT inter-company vouchers
            
            // Check for existing INTERCO vouchers in subsidiary
            // Use both PO number AND container number to identify duplicates (same PO number can apply to multiple containers)
            const existingSubsidiaryVoucher = await db
              .select()
              .from(vouchers)
              .where(
                and(
                  eq(vouchers.companyId, company.id),
                  like(vouchers.voucherNumber, `INTERCO-%`),
                  like(vouchers.description, `%${container.containerNumber}%`)
                )
              )
              .limit(1);
            
            if (existingSubsidiaryVoucher.length > 0) {
              continue; // Skip - already has credit entry in subsidiary for this container
            }
            
            // Check for existing INTERCO-PARENT vouchers in parent company for this container
            const existingParentVoucher = await db
              .select()
              .from(vouchers)
              .where(
                and(
                  eq(vouchers.companyId, parentCompany.id),
                  or(
                    like(vouchers.voucherNumber, `INTERCO-PARENT-%`),
                    like(vouchers.voucherNumber, `INTERCO-LUB-%`) // Legacy format
                  ),
                  like(vouchers.description, `%${container.containerNumber}%`)
                )
              )
              .limit(1);
            
            if (existingParentVoucher.length > 0) {
              continue; // Skip - already has credit entry in parent company for this container
            }
            
            // Calculate PO total: items + freight + charges
            const poItemsTotal = parseFloat(po.itemsTotal || "0");
            const poFreight = parseFloat(po.freight || "0");
            const poSurcharge = parseFloat(po.surcharge || "0");
            const poFumigation = parseFloat(po.fumigation || "0");
            const poDocumentCharges = parseFloat(po.documentCharges || "0");
            const poDiscount = parseFloat(po.discount || "0");
            const poOtherCharges = parseFloat(po.otherCharges || "0");
            const poTotal = poItemsTotal + poFreight + poSurcharge + poFumigation + poDocumentCharges - poDiscount + poOtherCharges;
            
            const poSupplier = po.supplierId ? await db.query.suppliers.findFirst({ where: eq(suppliers.id, po.supplierId) }) : null;
            if (poTotal <= 0) {
              continue; // Skip zero or negative amounts
            }
            
            // Get offload date from container offload record
            const [offloadRecord] = await db
              .select()
              .from(containerOffloads)
              .where(eq(containerOffloads.containerId, container.id))
              .limit(1);
            
            const voucherDate = offloadRecord?.offloadedAt 
              ? new Date(offloadRecord.offloadedAt).toISOString().split('T')[0]
              : new Date().toISOString().split('T')[0];
            
            // ============================================================
            // SUBSIDIARY VOUCHER - Transfer liability from Supplier to Parent Credit
            // ============================================================
            const voucherNumber = `INTERCO-${po.poNumber}-${Date.now()}`;
            const [voucher] = await db.insert(vouchers).values({
              companyId: company.id,
              voucherNumber,
              voucherType: "Journal",
              voucherDate,
              description: `Transfer supplier liability to ${parentCompany.name} Credit - PO ${po.poNumber} - Container ${container.containerNumber}`,
              totalAmount: poTotal.toFixed(2),
            }).returning();
            
            // Debit: Supplier account (reduce payable - they got paid by parent company)
            if (po.supplierId) {
              await db.insert(voucherEntries).values({
                voucherId: voucher.id,
                supplierId: po.supplierId,
                debitAmount: poTotal.toFixed(2),
                creditAmount: "0",
                narration: `Transfer to ${parentCompany.name} Credit - PO ${po.poNumber}`,
              });
            }
            
            // Credit: Parent Credit account (we owe parent company, who paid the supplier)
            await db.insert(voucherEntries).values({
              voucherId: voucher.id,
              ledgerAccountId: creditAccount[0].id,
              debitAmount: "0",
              creditAmount: poTotal.toFixed(2),
              narration: `PO ${po.poNumber} - Container ${container.containerNumber} (${parentCompany.name} paid)`,
            });
            
            // ============================================================
            // PARENT COMPANY VOUCHER - Record receivable from subsidiary + supplier payable
            // ============================================================
            // Get or create "[Subsidiary] Credit" receivable account in parent company
            const subsidiaryCode = company.name.toUpperCase().replace(/\s+/g, '_') + "_CREDIT";
            const subsidiaryName = company.name + " Credit";
            
            let subsidiaryReceivableAccount = await db
              .select()
              .from(ledgerAccounts)
              .where(
                and(
                  eq(ledgerAccounts.companyId, parentCompany.id),
                  eq(ledgerAccounts.code, subsidiaryCode),
                  isNull(ledgerAccounts.deletedAt)
                )
              )
              .limit(1);
            
            if (!subsidiaryReceivableAccount.length) {
              const [newAccount] = await db.insert(ledgerAccounts).values({
                companyId: parentCompany.id,
                code: subsidiaryCode,
                name: subsidiaryName,
                accountType: "Asset",
                subType: "Current Asset",
                openingBalance: "0",
                openingBalanceSide: "Dr",
              }).returning();
              subsidiaryReceivableAccount = [newAccount];
            }
            
            // Create Journal voucher in parent company
            const parentVoucherNumber = `INTERCO-PARENT-${po.poNumber}-${Date.now()}`;
            const [parentVoucher] = await db.insert(vouchers).values({
              companyId: parentCompany.id,
              voucherNumber: parentVoucherNumber,
              voucherType: "Journal",
              voucherDate,
              description: `${container.containerNumber} ${poSupplier?.legalName || 'Unknown Supplier'}`,
              totalAmount: poTotal.toFixed(2),
            }).returning();
            
            // DR [Subsidiary] Credit (they owe us)
            await db.insert(voucherEntries).values({
              voucherId: parentVoucher.id,
              ledgerAccountId: subsidiaryReceivableAccount[0].id,
              debitAmount: poTotal.toFixed(2),
              creditAmount: "0",
              narration: `PO ${po.poNumber} - ${company.name} owes us`,
            });
            
            // CR Supplier (we owe supplier)
            if (po.supplierId) {
              await db.insert(voucherEntries).values({
                voucherId: parentVoucher.id,
                supplierId: po.supplierId,
                debitAmount: "0",
                creditAmount: poTotal.toFixed(2),
                narration: `PO ${po.poNumber} - Supplier payment`,
              });
            }
            
            totalFixed++;
            totalAmount += poTotal;
            details.push({
              company: company.name,
              poNumber: po.poNumber,
              amount: poTotal
            });
          }
        }
        
        res.json({
          message: `Fixed ${totalFixed} POs for ${selectedCompany.name} (parent: ${parentCompany.name})`,
          fixed: totalFixed,
          totalAmount: totalAmount.toFixed(2),
          details,
          processedCompanies: 1
        });
      } catch (error: any) {
        console.error("Fix old PO credits error:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // ==========================================
  // Fix Parent Company POs Missing Supplier Entries
  // ==========================================
  
  app.post(
    "/api/fix-parent-po-supplier-entries",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const parentCompanyId = await storage.getParentCompanyId();
        
        if (!parentCompanyId) {
          return res.status(400).json({ 
            message: "No parent company configured. Please set the parent company in Settings first." 
          });
        }
        
        // Get the parent company
        const parentCompany = await storage.getCompanyById(parentCompanyId);
        if (!parentCompany) {
          return res.status(404).json({ message: "Parent company not found" });
        }
        
        // Find all POs in the parent company
        const allPOs = await db
          .select()
          .from(purchaseOrders)
          .where(eq(purchaseOrders.companyId, parentCompanyId));
        
        let fixed = 0;
        let skipped = 0;
        let totalAmount = 0;

      // First, group offloaded containers by agent
      for (const container of offloadedContainers) {
        const agent = container.agent || "Unassigned";
        if (!byAgent[agent]) byAgent[agent] = { containers: [], offloadedContainers: [], total: 0, offloadedTotal: 0, balance: agentBalances[agent] || 0 };
        byAgent[agent].offloadedContainers.push(container);
        byAgent[agent].offloadedTotal += parseFloat(container.dutyFee || "0");
      }
        const details: any[] = [];
        
        for (const po of allPOs) {
          if (!po.voucherId || !po.supplierId) {
            skipped++;
            continue;
          }
          
          // Calculate PO total
          const itemsTotal = parseFloat(po.itemsTotal || "0");
          const freight = parseFloat(po.freight || "0");
          const surcharge = parseFloat(po.surcharge || "0");
          const fumigation = parseFloat(po.fumigation || "0");
          const documentCharges = parseFloat(po.documentCharges || "0");
          const discount = parseFloat(po.discount || "0");
          const otherCharges = parseFloat(po.otherCharges || "0");
          const poTotal = itemsTotal + freight + surcharge + fumigation + documentCharges - discount + otherCharges;
          
            const poSupplier = po.supplierId ? await db.query.suppliers.findFirst({ where: eq(suppliers.id, po.supplierId) }) : null;
          if (poTotal <= 0) {
            skipped++;
            continue;
          }
          
          // Get or create Purchases account
          let purchasesAccount = await storage.getLedgerAccountByName("Purchases", parentCompanyId);
          if (!purchasesAccount) {
            purchasesAccount = await storage.getLedgerAccountByCode("PURCHASES", parentCompanyId);
          }
          if (!purchasesAccount) {
            purchasesAccount = await storage.createLedgerAccount({
              companyId: parentCompanyId,
              name: "Purchases",
              code: "PURCHASES",
              accountType: "Expense",
              subType: "Direct Expense",
            });
          }
          
          // Check if voucher already has purchase entry
          const existingPurchaseEntry = await db
            .select()
            .from(voucherEntries)
            .where(and(
              eq(voucherEntries.voucherId, po.voucherId),
              eq(voucherEntries.ledgerAccountId, purchasesAccount.id)
            ))
            .limit(1);
          
          // Check if this voucher already has a supplier entry
          const existingSupplierEntry = await db
            .select()
            .from(voucherEntries)
            .where(and(
              eq(voucherEntries.voucherId, po.voucherId),
              eq(voucherEntries.supplierId, po.supplierId)
            ))
            .limit(1);
          
          // Skip if both entries already exist
          if (existingPurchaseEntry.length > 0 && existingSupplierEntry.length > 0) {
            skipped++;
            continue;
          }
          
          let fixedThisPO = false;
          
          // Add DR Purchases entry if missing
          if (existingPurchaseEntry.length === 0) {
            await db.insert(voucherEntries).values({
              voucherId: po.voucherId,
              ledgerAccountId: purchasesAccount.id,
              debitAmount: poTotal.toFixed(2),
              creditAmount: "0",
              narration: `PO ${po.poNumber} - Fix missing entry`,
            });
            fixedThisPO = true;
          }
          
          // Add CR Supplier entry if missing
          if (existingSupplierEntry.length === 0) {
            await db.insert(voucherEntries).values({
              voucherId: po.voucherId,
              supplierId: po.supplierId,
              debitAmount: "0",
              creditAmount: poTotal.toFixed(2),
              narration: `PO ${po.poNumber} - Fix missing supplier entry`,
            });
            fixedThisPO = true;
          }
          
          if (fixedThisPO) {
            fixed++;
            totalAmount += poTotal;
            details.push({
              poNumber: po.poNumber,
              amount: poTotal.toFixed(2),
              fixedPurchases: existingPurchaseEntry.length === 0,
              fixedSupplier: existingSupplierEntry.length === 0,
            });
          } else {
            skipped++;
          }
        }
        
        res.json({
          message: `Fixed ${fixed} POs in ${parentCompany.name}. Skipped ${skipped} (already had entries or invalid).`,
          fixed,
          skipped,
          totalAmount: totalAmount.toFixed(2),
          details,
        });
      } catch (error: any) {
        console.error("Fix parent PO supplier entries error:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // ==========================================
  // Reverse Fix Old PO Inter-Company Credits
  // ==========================================
  
  app.post(
    "/api/reverse-po-credits",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { companyId, parentCompanyId } = req.body;
        
        if (!companyId) {
          return res.status(400).json({ 
            message: "Please select a subsidiary company to reverse." 
          });
        }
        
        if (!parentCompanyId) {
          return res.status(400).json({ 
            message: "Please select a parent company." 
          });
        }
        
        const allCompanies = await storage.getAllCompanies();
        const company = allCompanies.find(c => c.id === companyId);
        const parentCompany = allCompanies.find(c => c.id === parentCompanyId);
        
        if (!company) {
          return res.status(400).json({ message: "Subsidiary company not found." });
        }
        
        if (!parentCompany) {
          return res.status(400).json({ 
            message: "Parent company not found." 
          });
        }
        
        if (company.id === parentCompany.id) {
          return res.status(400).json({ 
            message: "Subsidiary and parent company cannot be the same." 
          });
        }
        
        // Process only the selected subsidiary
        const targetCompany = company;
        
        let totalReversed = 0;
        const details: Array<{ company: string; voucherNumber: string; amount: string }> = [];
        
        // Delete INTERCO vouchers in this subsidiary company
        const companyIntercoVouchers = await db
          .select()
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, targetCompany.id),
              like(vouchers.voucherNumber, "INTERCO-%")
            )
          );
        
        for (const v of companyIntercoVouchers) {
          // Delete voucher entries first
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, v.id));
          // Delete voucher
          await db.delete(vouchers).where(eq(vouchers.id, v.id));
          totalReversed++;
          details.push({ company: targetCompany.name, voucherNumber: v.voucherNumber, amount: v.totalAmount || "0" });
        }
        
        // Also delete corresponding INTERCO-PARENT vouchers in parent company for this subsidiary
        const parentIntercoVouchers = await db
          .select()
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, parentCompany.id),
              or(
                like(vouchers.voucherNumber, "INTERCO-PARENT-%"),
                like(vouchers.voucherNumber, "INTERCO-LUB-%") // Also match old format
              ),
              like(vouchers.description, `%${targetCompany.name}%`)
            )
          );
        
        for (const v of parentIntercoVouchers) {
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, v.id));
          await db.delete(vouchers).where(eq(vouchers.id, v.id));
          totalReversed++;
          details.push({ company: `${parentCompany.name} (for ${targetCompany.name})`, voucherNumber: v.voucherNumber, amount: v.totalAmount || "0" });
        }
        
        res.json({
          message: `Reversed ${totalReversed} inter-company vouchers for ${company.name} (parent: ${parentCompany.name})`,
          reversed: totalReversed,
          details,
          processedCompanies: 1
        });
      } catch (error: any) {
        console.error("Reverse PO credits error:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // ==========================================
  // Reset Company Data (Admin only)
  // Deletes Payment/Receipt/Journal vouchers for selected company
  // ==========================================
  
  app.post(
    "/api/admin/reset-company-data",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { companyId } = req.body;
        
        if (!companyId) {
          return res.status(400).json({ message: "Please select a company to reset." });
        }
        
        const company = await storage.getCompanyById(companyId);
        if (!company) {
          return res.status(400).json({ message: "Company not found." });
        }
        
        // Define voucher types to DELETE (Payment, Receipt, Journal - excluding POS, Production, Consumption, Stock Transfer)
        const voucherTypesToDelete = ["Payment", "Receipt", "Journal"];
        
        // Get all vouchers of these types for this company
        const vouchersToDelete = await db
          .select()
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              inArray(vouchers.voucherType, voucherTypesToDelete)
            )
          );
        
        let deletedVoucherCount = 0;
        let deletedEntryCount = 0;
        const details: Array<{ voucherType: string; voucherNumber: string; amount: string }> = [];
        
        // Delete voucher entries first, then vouchers (respecting foreign keys)
        for (const v of vouchersToDelete) {
          // Count entries for this voucher
          const entries = await db
            .select()
            .from(voucherEntries)
            .where(eq(voucherEntries.voucherId, v.id));
          
          deletedEntryCount += entries.length;
          
          // Delete entries
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, v.id));
          
          // Delete voucher
          await db.delete(vouchers).where(eq(vouchers.id, v.id));
          deletedVoucherCount++;
          
          details.push({
            voucherType: v.voucherType,
            voucherNumber: v.voucherNumber,
            amount: v.totalAmount || "0"
          });
        }
        
        // Summary by type
        const typeSummary = voucherTypesToDelete.map(type => ({
          type,
          count: details.filter(d => d.voucherType === type).length
        }));
        
        res.json({
          message: `Reset complete for ${company.name}. Deleted ${deletedVoucherCount} voucher(s) and ${deletedEntryCount} entries.`,
          deletedVouchers: deletedVoucherCount,
          deletedEntries: deletedEntryCount,
          typeSummary,
          preserved: ["Containers", "Container Offloads", "Inventory", "Locations", "Ledger Accounts", "POS Vouchers", "Production/Consumption/Stock Transfer Vouchers", "Purchase Orders"]
        });
      } catch (error: any) {
        console.error("Reset company data error:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // System Settings - Parent Company (Admin only)
  app.get(
    "/api/system/parent-company",
    requireAuth,
    async (req, res) => {
      try {
        const parentCompanyId = await storage.getParentCompanyId();
        res.json({ parentCompanyId });
      } catch (error: any) {
        console.error("Get parent company error:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  app.post(
    "/api/system/parent-company",
    requireAuth,
    async (req, res) => {
      try {
        // Only Admin can change parent company setting
        const userRole = req.session.currentRole;
        if (userRole !== "Admin") {
          return res.status(403).json({ message: "Only Admin users can change the parent company setting" });
        }

        const { parentCompanyId } = req.body;
        
        // Validate parentCompanyId is null or a valid number
        if (parentCompanyId !== null && parentCompanyId !== undefined) {
          const numericId = typeof parentCompanyId === 'string' ? parseInt(parentCompanyId, 10) : parentCompanyId;
          if (typeof numericId !== 'number' || isNaN(numericId)) {
            return res.status(400).json({ message: "Invalid parent company ID: must be a number or null" });
          }
          
          // Validate the company exists
          const company = await storage.getCompanyById(numericId);
          if (!company) {
            return res.status(400).json({ message: "Company not found" });
          }
          
          await storage.setParentCompanyId(numericId);
          res.json({ success: true, parentCompanyId: numericId });
        } else {
          // Setting to null (clear the parent company)
          await storage.setParentCompanyId(null);
          res.json({ success: true, parentCompanyId: null });
        }
      } catch (error: any) {
        console.error("Set parent company error:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // Company Data Reset - Delete vouchers (keep OTW container vouchers only) and clear opening balances
  app.post("/api/admin/company-data-reset", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const { companyId, accountIds, clearStockOpeningBalances } = req.body;

      if (!companyId || !Array.isArray(accountIds)) {
        return res.status(400).json({ message: "companyId and accountIds array are required" });
      }

      const results = {
        vouchersDeleted: 0,
        openingBalancesCleared: 0,
        stockOpeningBalancesCleared: 0,
      };

      // Start a transaction
      await db.transaction(async (tx) => {
        // 1. Get OTW container numbers to preserve their Purchase vouchers
        const otwContainers = await tx
          .select({ containerNumber: containers.containerNumber })
          .from(containers)
          .where(
            and(
              eq(containers.companyId, companyId),
              eq(containers.status, "OTW")
            )
          );
        
        const otwContainerNumbers = otwContainers.map(c => c.containerNumber);
        console.log("OTW containers to preserve:", otwContainerNumbers);

        // 2. Get inter-company credit account IDs (accounts with "Credit" in name - e.g., "KINSHASA Credit")
        const interCompanyAccounts = await tx
          .select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, companyId),
              sql`"ledger_accounts"."name" ILIKE '%Credit%'`
            )
          );
        const interCompanyAccountIds = new Set(interCompanyAccounts.map(a => a.id));
        console.log("Inter-company credit accounts to preserve:", interCompanyAccounts.map(a => a.name));

        // 3. Get voucher IDs that have entries involving inter-company credit accounts
        const interCompanyAccountIdArray = [...interCompanyAccountIds];
        const interCompanyVoucherEntries = interCompanyAccountIdArray.length > 0 
          ? await tx
              .select({ voucherId: voucherEntries.voucherId })
              .from(voucherEntries)
              .where(inArray(voucherEntries.ledgerAccountId, interCompanyAccountIdArray))
          : [];
        const interCompanyVoucherIds = new Set(interCompanyVoucherEntries.map(e => e.voucherId));
        console.log("Vouchers involving inter-company accounts to preserve:", interCompanyVoucherIds.size);

        // 4. Get ALL vouchers for this company
        const allVouchers = await tx
          .select({ id: vouchers.id, voucherType: vouchers.voucherType, description: vouchers.description })
          .from(vouchers)
          .where(eq(vouchers.companyId, companyId));

        // 5. Filter out vouchers that should be preserved:
        //    - Purchase vouchers that belong to OTW containers
        //    - Any vouchers involving inter-company credit accounts
        const vouchersToDelete = allVouchers.filter(v => {
          // Preserve vouchers that involve inter-company credit accounts
          if (interCompanyVoucherIds.has(v.id)) {
            console.log("Preserving inter-company voucher:", v.id, v.voucherType, v.description);
            return false; // Don't delete
          }
          
          // If it's a Purchase voucher, check if it belongs to an OTW container
          if (v.voucherType === "Purchase") {
            // Check if any OTW container number is in the description
            const belongsToOtw = otwContainerNumbers.some(cn => 
              v.description && v.description.includes(cn)
            );
            if (belongsToOtw) {
              console.log("Preserving OTW voucher:", v.id, v.description);
              return false; // Don't delete - it's for an OTW container
            }
          }
          return true; // Delete all other vouchers
        });
        const voucherIdsToDelete = vouchersToDelete.map(v => v.id);
        console.log("Vouchers to delete:", voucherIdsToDelete.length);
        console.log("Vouchers preserved (OTW + inter-company):", allVouchers.length - voucherIdsToDelete.length);

        if (voucherIdsToDelete.length > 0) {
          // Format voucherIds as PostgreSQL array literal
          const voucherIdsArray = `ARRAY[${voucherIdsToDelete.join(',')}]::int[]`;
          
          // SOFT DELETE vouchers only - DON'T delete voucher entries
          // This allows undo to work properly
          await tx
            .update(vouchers)
            .set({ deletedAt: new Date() })
            .where(sql.raw(`"vouchers"."id" = ANY(${voucherIdsArray})`));
          
          results.vouchersDeleted = voucherIdsToDelete.length;
        }

        // 4. Clear opening balances for selected accounts
        if (accountIds.length > 0) {
          const accountIdsArray = `ARRAY[${accountIds.join(',')}]::int[]`;
          
          await tx
            .update(ledgerAccounts)
            .set({ openingBalance: "0", openingBalanceSide: null })
            .where(
              and(
                eq(ledgerAccounts.companyId, companyId),
                sql.raw(`"ledger_accounts"."id" = ANY(${accountIdsArray})`)
              )
            );
          
          results.openingBalancesCleared = accountIds.length;
        }

        // 5. Clear stock item opening balances if requested
        if (clearStockOpeningBalances) {
          // Count first
          const stockItemCount = await tx
            .select({ count: sql<number>`count(*)` })
            .from(stockItems)
            .where(eq(stockItems.companyId, companyId));
          
          results.stockOpeningBalancesCleared = Number(stockItemCount[0]?.count) || 0;

          await tx
            .update(stockItems)
            .set({ openingQty: "0", openingRate: "0", openingValue: "0" })
            .where(eq(stockItems.companyId, companyId));
        }
      });

      console.log(`Company data reset completed for company ${companyId}:`, results);
      res.json({ success: true, results });
    } catch (error: any) {
      console.error("Company data reset error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Undo Last Reset - Restore soft-deleted vouchers for a company
  app.post("/api/admin/undo-company-reset", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const { companyId } = req.body;

      if (!companyId) {
        return res.status(400).json({ message: "companyId is required" });
      }

      // Restore soft-deleted vouchers by clearing deletedAt
      const result = await db
        .update(vouchers)
        .set({ deletedAt: null })
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNotNull(vouchers.deletedAt)
          )
        )
        .returning({ id: vouchers.id });

      const restoredCount = result.length;

      console.log(`Undo reset completed for company ${companyId}: restored ${restoredCount} vouchers`);
      res.json({ 
        success: true, 
        message: `Restored ${restoredCount} vouchers`,
        vouchersRestored: restoredCount 
      });
    } catch (error: any) {
      console.error("Undo company reset error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/rebuild-inventory", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const { dryRun = true } = req.body;

      const staleOptionalTrue = await db
        .select({
          stId: stockTransferVouchers.id,
          voucherId: stockTransferVouchers.voucherId,
        })
        .from(stockTransferVouchers)
        .innerJoin(vouchers, eq(vouchers.id, stockTransferVouchers.voucherId))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.optional, true),
            eq(stockTransferVouchers.inventoryApplied, true),
            isNull(vouchers.deletedAt)
          )
        );

      const staleNonOptionalFalse = await db
        .select({
          stId: stockTransferVouchers.id,
          voucherId: stockTransferVouchers.voucherId,
        })
        .from(stockTransferVouchers)
        .innerJoin(vouchers, eq(vouchers.id, stockTransferVouchers.voucherId))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.optional, false),
            eq(stockTransferVouchers.inventoryApplied, false),
            isNull(vouchers.deletedAt)
          )
        );

      const staleFlagsTotalCount = staleOptionalTrue.length + staleNonOptionalFalse.length;

      if (!dryRun) {
        if (staleOptionalTrue.length > 0) {
          await db
            .update(stockTransferVouchers)
            .set({ inventoryApplied: false })
            .where(
              inArray(
                stockTransferVouchers.id,
                staleOptionalTrue.map((f) => f.stId)
              )
            );
        }
        if (staleNonOptionalFalse.length > 0) {
          await db
            .update(stockTransferVouchers)
            .set({ inventoryApplied: true })
            .where(
              inArray(
                stockTransferVouchers.id,
                staleNonOptionalFalse.map((f) => f.stId)
              )
            );
        }
      }

      const expectedInv = new Map<string, { quantity: number; totalValue: number }>();

      function addToExpected(locationId: number, stockItemId: number, qty: number, value: number) {
        const key = `${locationId}-${stockItemId}`;
        const existing = expectedInv.get(key) || { quantity: 0, totalValue: 0 };
        existing.quantity += qty;
        existing.totalValue += value;
        expectedInv.set(key, existing);
      }

      const allOffloads = await db
        .select({
          offloadId: containerOffloads.id,
          locationId: containerOffloads.locationId,
          containerId: containerOffloads.containerId,
        })
        .from(containerOffloads)
        .innerJoin(containers, eq(containers.id, containerOffloads.containerId))
        .where(eq(containers.companyId, companyId));

      for (const offload of allOffloads) {
        const offloadItems = await db
          .select()
          .from(containerOffloadItems)
          .where(eq(containerOffloadItems.offloadId, offload.offloadId));

        if (offloadItems.length > 0) {
          for (const item of offloadItems) {
            const qty = parseFloat(item.quantity || "0");
            const val = parseFloat(item.totalValue || "0");
            if (qty !== 0) {
              addToExpected(offload.locationId, item.stockItemId, qty, val);
            }
          }
        } else {
          const pos = await db
            .select()
            .from(purchaseOrders)
            .where(eq(purchaseOrders.containerId, offload.containerId));
          for (const po of pos) {
            const lineItems = await db
              .select()
              .from(poLineItems)
              .where(eq(poLineItems.poId, po.id));
            for (const li of lineItems) {
              const qty = parseFloat(li.quantity || "0");
              const val = parseFloat(li.lineTotal || "0");
              if (qty !== 0) {
                addToExpected(offload.locationId, li.stockItemId, qty, val);
              }
            }
          }
        }
      }

      const activeTransfers = await db
        .select({
          stId: stockTransferVouchers.id,
          sourceLocationId: stockTransferVouchers.sourceLocationId,
          destinationLocationId: stockTransferVouchers.destinationLocationId,
        })
        .from(stockTransferVouchers)
        .innerJoin(vouchers, eq(vouchers.id, stockTransferVouchers.voucherId))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );

      for (const transfer of activeTransfers) {
        const items = await db
          .select()
          .from(stockTransferItems)
          .where(eq(stockTransferItems.transferId, transfer.stId));

        for (const item of items) {
          const qty = parseFloat(item.quantity || "0");
          const rate = parseFloat(item.rate || "0");
          const val = qty * rate;
          if (qty !== 0) {
            const srcLoc = item.sourceLocationId || transfer.sourceLocationId;
            if (srcLoc) {
              addToExpected(srcLoc, item.stockItemId, -qty, -val);
            }
            addToExpected(transfer.destinationLocationId, item.stockItemId, qty, val);
          }
        }
      }

      const activeAdjustments = await db
        .select({
          adjId: stockAdjustmentVouchers.id,
          locationId: stockAdjustmentVouchers.locationId,
          adjustmentType: stockAdjustmentVouchers.adjustmentType,
        })
        .from(stockAdjustmentVouchers)
        .innerJoin(vouchers, eq(vouchers.id, stockAdjustmentVouchers.voucherId))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );

      for (const adj of activeAdjustments) {
        const items = await db
          .select()
          .from(stockAdjustmentItems)
          .where(eq(stockAdjustmentItems.adjustmentId, adj.adjId));

        for (const item of items) {
          let qty = parseFloat(item.quantity || "0");
          const rate = parseFloat(item.rate || "0");
          if (adj.adjustmentType === "Consumption") {
            qty = -Math.abs(qty);
          } else if (adj.adjustmentType === "Production") {
            qty = Math.abs(qty);
          }
          const val = qty * rate;
          if (qty !== 0) {
            addToExpected(adj.locationId, item.stockItemId, qty, val);
          }
        }
      }

      const activeSalesVouchers = await db
        .select({
          vId: vouchers.id,
          locationId: vouchers.locationId,
        })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.voucherType, "Sales"),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false),
            isNotNull(vouchers.locationId)
          )
        );

      for (const sale of activeSalesVouchers) {
        if (!sale.locationId) continue;
        const items = await db
          .select()
          .from(salesItems)
          .where(eq(salesItems.voucherId, sale.vId));

        for (const item of items) {
          const qty = parseFloat(item.quantity || "0");
          const costPrice = parseFloat(item.costPrice || "0");
          if (qty !== 0) {
            addToExpected(sale.locationId, item.stockItemId, -qty, -(qty * costPrice));
          }
        }
      }

      const activeCreditDebitVouchers = await db
        .select({
          vId: vouchers.id,
          voucherType: vouchers.voucherType,
        })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            or(
              eq(vouchers.voucherType, "Credit Note"),
              eq(vouchers.voucherType, "Debit Note")
            ),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );

      for (const note of activeCreditDebitVouchers) {
        const items = await db
          .select()
          .from(creditNoteItems)
          .where(eq(creditNoteItems.voucherId, note.vId));

        for (const item of items) {
          const qty = parseFloat(item.quantity || "0");
          const cost = parseFloat(item.inventoryCost || item.rate || "0");
          if (qty !== 0) {
            if (note.voucherType === "Credit Note") {
              addToExpected(item.locationId, item.stockItemId, qty, qty * cost);
            } else {
              addToExpected(item.locationId, item.stockItemId, -qty, -(qty * cost));
            }
          }
        }
      }

      const currentInventory = await db
        .select()
        .from(inventory)
        .where(eq(inventory.companyId, companyId));

      const currentMap = new Map<string, { id: number; quantity: number; totalValue: number }>();
      for (const inv of currentInventory) {
        const key = `${inv.locationId}-${inv.stockItemId}`;
        currentMap.set(key, {
          id: inv.id,
          quantity: parseFloat(inv.quantity || "0"),
          totalValue: parseFloat(inv.totalValue || "0"),
        });
      }

      const allKeys = new Set([...expectedInv.keys(), ...currentMap.keys()]);
      const discrepancies: Array<{
        locationId: number;
        stockItemId: number;
        currentQty: number;
        expectedQty: number;
        difference: number;
        currentValue: number;
        expectedValue: number;
      }> = [];

      for (const key of allKeys) {
        const [locStr, itemStr] = key.split("-");
        const locationId = parseInt(locStr);
        const stockItemId = parseInt(itemStr);
        const expected = expectedInv.get(key) || { quantity: 0, totalValue: 0 };
        const current = currentMap.get(key) || { id: 0, quantity: 0, totalValue: 0 };

        const qtyDiff = Math.abs(expected.quantity - current.quantity);
        const valDiff = Math.abs(expected.totalValue - current.totalValue);
        if (qtyDiff > 0.001 || valDiff > 0.01) {
          discrepancies.push({
            locationId,
            stockItemId,
            currentQty: current.quantity,
            expectedQty: parseFloat(expected.quantity.toFixed(3)),
            difference: parseFloat((expected.quantity - current.quantity).toFixed(3)),
            currentValue: current.totalValue,
            expectedValue: parseFloat(expected.totalValue.toFixed(2)),
          });
        }
      }

      let fixesApplied = 0;
      if (!dryRun && discrepancies.length > 0) {
        await db.transaction(async (tx) => {
          for (const d of discrepancies) {
            const key = `${d.locationId}-${d.stockItemId}`;
            const current = currentMap.get(key);
            const avgRate = d.expectedQty !== 0 ? d.expectedValue / d.expectedQty : 0;

            if (current && current.id) {
              await tx
                .update(inventory)
                .set({
                  quantity: d.expectedQty.toFixed(3),
                  totalValue: d.expectedValue.toFixed(2),
                  averageRate: avgRate.toFixed(2),
                  lastUpdated: new Date(),
                })
                .where(eq(inventory.id, current.id));
            } else {
              await tx.insert(inventory).values({
                companyId,
                locationId: d.locationId,
                stockItemId: d.stockItemId,
                quantity: d.expectedQty.toFixed(3),
                totalValue: d.expectedValue.toFixed(2),
                averageRate: avgRate.toFixed(2),
                lastUpdated: new Date(),
              });
            }
            fixesApplied++;
          }
        });
      }

      const companyLocations = await db.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.companyId, companyId));
      const companyStockItems = await db.select({ id: stockItems.id, name: stockItems.name, code: stockItems.code }).from(stockItems).where(eq(stockItems.companyId, companyId));
      const locationMap = new Map(companyLocations.map((l) => [l.id, l.name]));
      const stockItemMap = new Map(companyStockItems.map((s) => [s.id, { name: s.name, code: s.code }]));

      const enrichedDiscrepancies = discrepancies.map((d) => ({
        ...d,
        locationName: locationMap.get(d.locationId) || `Location #${d.locationId}`,
        stockItemName: stockItemMap.get(d.stockItemId)?.name || `Item #${d.stockItemId}`,
        stockItemCode: stockItemMap.get(d.stockItemId)?.code || "",
      }));

      res.json({
        success: true,
        dryRun,
        staleFlagsFound: staleFlagsTotalCount,
        staleFlagsFixed: dryRun ? 0 : staleFlagsTotalCount,
        staleFlagDetails: {
          optionalWithAppliedTrue: staleOptionalTrue.length,
          nonOptionalWithAppliedFalse: staleNonOptionalFalse.length,
        },
        totalInventoryRecords: currentInventory.length,
        discrepanciesFound: discrepancies.length,
        fixesApplied,
        discrepancies: enrichedDiscrepancies,
        warnings: [
          "Quick adjustments (manual add/subtract) are not backed by vouchers and cannot be replayed. They may appear as discrepancies.",
        ],
      });
    } catch (error: any) {
      console.error("Rebuild inventory error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Credit/Debit Note - handles customer returns with stock restoration
  // Separates refund rate (customer refund) from inventory cost (actual cost)
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
          return res.status(400).json({ message: `Invalid locationId for item ${item.stockItemId}: ${item.locationId}` });
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
          const { stockItemId, locationId, quantity, refundRate: itemRefundRate, inventoryCost: itemInventoryCost } = item;
          const qty = parseFloat(quantity);
          const refundRateVal = parseFloat(itemRefundRate || "0");
          const inventoryCostVal = parseFloat(itemInventoryCost || "0");
          const inventoryValue = qty * inventoryCostVal;

          const [location] = await tx
            .select()
            .from(locations)
            .where(eq(locations.id, locationId));

        if (!location) {
          throw new Error(`Location ${locationId} not found`);
        }

          if (noteType === "Credit Note") {
            await adjustInventory(tx, locationId, stockItemId, qty, companyId, inventoryCostVal);

            let inventoryAccount = await tx
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

            let inventoryAccount = await tx
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
          let salesReturnsAccount = await tx
            .select()
            .from(ledgerAccounts)
            .where(
              and(
                eq(ledgerAccounts.companyId, companyId),
                ilike(ledgerAccounts.name, "%sales return%")
              )
            )
            .limit(1);

          if (salesReturnsAccount.length === 0) {
            salesReturnsAccount = await tx
              .select()
              .from(ledgerAccounts)
              .where(
                and(
                  eq(ledgerAccounts.companyId, companyId),
                  eq(ledgerAccounts.accountType, "Indirect Expense")
                )
              )
              .limit(1);
          }

          if (salesReturnsAccount.length > 0) {
            if (noteType === "Credit Note") {
              await tx.insert(voucherEntries).values({
                voucherId: createdVoucher.id,
                ledgerAccountId: salesReturnsAccount[0].id,
                debitAmount: variance > 0 ? variance.toFixed(2) : "0",
                creditAmount: variance < 0 ? Math.abs(variance).toFixed(2) : "0",
                narration: `Variance between refund and inventory cost`,
              });
            } else {
              await tx.insert(voucherEntries).values({
                voucherId: createdVoucher.id,
                ledgerAccountId: salesReturnsAccount[0].id,
                debitAmount: variance < 0 ? Math.abs(variance).toFixed(2) : "0",
                creditAmount: variance > 0 ? variance.toFixed(2) : "0",
                narration: `Variance between debit note amount and inventory cost`,
              });
            }
          }
        }

        return createdVoucher;
      });

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
      const entries = await db
        .select()
        .from(voucherEntries)
        .where(eq(voucherEntries.voucherId, voucherId));

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
          const [ledger] = await db
            .select()
            .from(ledgerAccounts)
            .where(eq(ledgerAccounts.id, entry.ledgerAccountId));
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
            .where(
              and(
                eq(inventory.stockItemId, item.stockItemId),
                eq(inventory.locationId, item.locationId)
              )
            );
          
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
            return res.status(400).json({ message: `Invalid locationId for item ${item.stockItemId}: ${item.locationId}` });
          }
          const qty = parseFloat(item.quantity);
          if (isNaN(qty) || !isFinite(qty) || qty <= 0) {
            return res.status(400).json({ message: `Invalid quantity for item ${item.stockItemId}: ${item.quantity}` });
          }
        }
      }

      // Wrap all mutations in a transaction
      await db.transaction(async (tx) => {
        // Get existing credit note items to reverse inventory
        const existingItems = await tx
          .select()
          .from(creditNoteItems)
          .where(eq(creditNoteItems.voucherId, voucherId));

        // REVERSE: Undo inventory changes from existing items
        for (const item of existingItems) {
          const qty = parseFloat(item.quantity || "0");
          const rate = parseFloat(item.rate || "0");
          const itemValue = qty * rate;

          if (noteType === "Credit Note") {
            await adjustInventory(tx, item.locationId, item.stockItemId, -qty, companyId);
          } else {
            await adjustInventory(tx, item.locationId, item.stockItemId, qty, companyId, rate);
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
          const { stockItemId, locationId, quantity, refundRate: itemRefundRate, inventoryCost: itemInventoryCost } = item;
          const qty = parseFloat(quantity);
          const refundRateVal = parseFloat(itemRefundRate || "0");
          const inventoryCostVal = parseFloat(itemInventoryCost || "0");
          const inventoryValue = qty * inventoryCostVal;

          const [location] = await tx
            .select()
            .from(locations)
            .where(eq(locations.id, locationId));

          if (!location) {
            throw new Error(`Location ${locationId} not found`);
          }

          if (noteType === "Credit Note") {
            await adjustInventory(tx, locationId, stockItemId, qty, companyId, inventoryCostVal);

            let inventoryAccount = await tx
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

            let inventoryAccount = await tx
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
          let salesReturnsAccount = await tx
            .select()
            .from(ledgerAccounts)
            .where(
              and(
                eq(ledgerAccounts.companyId, companyId),
                ilike(ledgerAccounts.name, "%sales return%")
              )
            )
            .limit(1);

          if (salesReturnsAccount.length === 0) {
            salesReturnsAccount = await tx
              .select()
              .from(ledgerAccounts)
              .where(
                and(
                  eq(ledgerAccounts.companyId, companyId),
                  eq(ledgerAccounts.accountType, "Indirect Expense")
                )
              )
              .limit(1);
          }

          if (salesReturnsAccount.length > 0) {
            if (noteType === "Credit Note") {
              await tx.insert(voucherEntries).values({
                voucherId,
                ledgerAccountId: salesReturnsAccount[0].id,
                debitAmount: variance > 0 ? variance.toFixed(2) : "0",
                creditAmount: variance < 0 ? Math.abs(variance).toFixed(2) : "0",
                narration: `Variance between refund and inventory cost`,
              });
            } else {
              await tx.insert(voucherEntries).values({
                voucherId,
                ledgerAccountId: salesReturnsAccount[0].id,
                debitAmount: variance < 0 ? Math.abs(variance).toFixed(2) : "0",
                creditAmount: variance > 0 ? variance.toFixed(2) : "0",
                narration: `Variance between debit note amount and inventory cost`,
              });
            }
          }
        }
      });

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

  app.get("/api/inventory/negative", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { search, locationId, stockGroupId } = req.query;

      const conditions = [
        eq(inventory.companyId, companyId),
        sql`CAST(${inventory.quantity} AS numeric) < 0`,
      ];

      if (locationId) {
        conditions.push(eq(inventory.locationId, parseInt(locationId as string)));
      }

      const results = await db
        .select({
          inventoryId: inventory.id,
          locationId: inventory.locationId,
          locationName: locations.name,
          stockItemId: inventory.stockItemId,
          code: stockItems.code,
          name: stockItems.name,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
          totalValue: inventory.totalValue,
          groupName: stockGroups.name,
          groupId: stockItems.stockGroupId,
        })
        .from(inventory)
        .innerJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
        .where(and(...conditions))
        .orderBy(locations.name, stockItems.code);

      let filtered = results;

      if (stockGroupId) {
        const gid = parseInt(stockGroupId as string);
        filtered = filtered.filter(r => r.groupId === gid);
      }

      if (search) {
        const s = (search as string).toLowerCase();
        filtered = filtered.filter(r =>
          r.code.toLowerCase().includes(s) ||
          r.name.toLowerCase().includes(s) ||
          r.locationName.toLowerCase().includes(s)
        );
      }

      res.json(filtered);
    } catch (error: any) {
      console.error("Negative inventory error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/vouchers/:id/finalize", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const voucherId = parseInt(req.params.id);
      if (isNaN(voucherId)) return res.status(400).json({ message: "Invalid voucher ID" });

      const [voucher] = await db
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, companyId)));

      if (!voucher) return res.status(404).json({ message: "Voucher not found" });
      if (!voucher.optional) return res.status(400).json({ message: "Voucher is already finalized" });

      // For stock transfers: apply inventory changes on finalization
      const updated = await db.transaction(async (tx) => {
        if (voucher.voucherType === "Stock Transfer" || voucher.voucherType === "StockTransfer") {
          const [transferRecord] = await tx
            .select()
            .from(stockTransferVouchers)
            .where(eq(stockTransferVouchers.voucherId, voucherId));

          if (transferRecord) {
            const items = await tx
              .select()
              .from(stockTransferItems)
              .where(eq(stockTransferItems.transferId, transferRecord.id));

            for (const item of items) {
              const srcId = item.sourceLocationId || transferRecord.sourceLocationId;
              const qty = parseFloat(item.quantity);
              const rate = parseFloat(item.rate || "0");
              if (srcId && qty > 0) {
                await adjustInventory(tx, srcId, item.stockItemId, -qty, companyId);
                await adjustInventory(tx, transferRecord.destinationLocationId, item.stockItemId, qty, companyId, rate);
              }
            }

            await tx
              .update(stockTransferVouchers)
              .set({ inventoryApplied: true })
              .where(eq(stockTransferVouchers.id, transferRecord.id));
          }
        }

        const [updated] = await tx
          .update(vouchers)
          .set({ optional: false })
          .where(eq(vouchers.id, voucherId))
          .returning();
        return updated;
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Finalize voucher error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/dev/seed", async (req, res) => {
    if (process.env.NODE_ENV !== "development") {
      return res.status(403).json({ message: "Dev seed only available in development" });
    }
    try {
      const { runDevSeed } = await import("./seedDev");
      const summary = await runDevSeed();
      console.log("\n=== SEED DATA SUMMARY ===");
      console.log(`Products: ${summary.products}`);
      console.log(`Bales: ${summary.bales}`);
      console.log(`Label Prints: ${summary.labelPrints} (${summary.scannedLabels} scanned)`);
      console.log(`\nSample ARTICLE codes: ${summary.sampleArticleCodes.join(", ")}`);
      console.log(`Sample REFERENCE numbers: ${summary.sampleReferenceNumbers.join(", ")}`);
      console.log("========================\n");
      res.json(summary);
    } catch (error: any) {
      console.error("Seed error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ==========================================
  // ERP User Page Access
  // ==========================================

  app.get(
    "/api/erp-user-page-access/:userId",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const pageKeys = await storage.getErpUserPageAccess(companyId, req.params.userId);
        res.json({ pageKeys });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  app.put(
    "/api/erp-user-page-access/:userId",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const { pageKeys } = req.body;
        if (!Array.isArray(pageKeys)) return res.status(400).json({ message: "pageKeys must be an array" });
        await storage.setErpUserPageAccess(companyId, req.params.userId, pageKeys);
        res.json({ message: "Page access updated", pageKeys });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  app.get(
    "/api/erp-user-hidden-costs/:userId",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const fields = await storage.getErpUserHiddenCostFields(req.params.userId);
        res.json({ hiddenCostFields: fields });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  app.put(
    "/api/erp-user-hidden-costs/:userId",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { hiddenCostFields } = req.body;
        if (!Array.isArray(hiddenCostFields)) return res.status(400).json({ message: "hiddenCostFields must be an array" });
        await storage.setErpUserHiddenCostFields(req.params.userId, hiddenCostFields);
        res.json({ message: "Cost visibility updated", hiddenCostFields });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  app.get(
    "/api/my-erp-pages",
    requireAuth,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        const role = req.session.currentRole;
        const userId = req.user?.id;
        if (!companyId || !role || !userId) return res.status(400).json({ message: "No company or role selected" });
        const hiddenErpCostFields = await storage.getErpUserHiddenCostFields(userId);
        if (role === "Admin" || role === "Developer") {
          return res.json({ pageKeys: [...FEATURE_KEYS], fullAccess: true, hiddenErpCostFields: [] });
        }
        const pageKeys = await storage.getErpUserPageAccess(companyId, userId);
        res.json({ pageKeys, fullAccess: false, hiddenErpCostFields });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // ── File Storage ─────────────────────────────────────────────
  app.get("/api/files", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company context" });
      const files = await db
        .select({
          id: storedFiles.id,
          fileName: storedFiles.fileName,
          fileType: storedFiles.fileType,
          fileSize: storedFiles.fileSize,
          description: storedFiles.description,
          uploadedBy: storedFiles.uploadedBy,
          uploadedAt: storedFiles.uploadedAt,
        })
        .from(storedFiles)
        .where(eq(storedFiles.companyId, companyId))
        .orderBy(desc(storedFiles.uploadedAt));
      res.json(files);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/files/upload", requireAuth, upload.single("file"), async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company context" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const { description } = req.body;
      const fileData = req.file.buffer.toString("base64");
      const [inserted] = await db.insert(storedFiles).values({
        companyId,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
        fileData,
        description: description || null,
        uploadedBy: null,
      }).returning({ id: storedFiles.id });
      res.json({ id: inserted.id, message: "File uploaded successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/files/:id/download", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const fileId = parseInt(req.params.id);
      const [file] = await db.select().from(storedFiles).where(
        and(eq(storedFiles.id, fileId), eq(storedFiles.companyId, companyId))
      );
      if (!file) return res.status(404).json({ message: "File not found" });
      const buffer = Buffer.from(file.fileData, "base64");
      res.set("Content-Type", file.fileType);
      res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(file.fileName)}"`);
      res.set("Content-Length", buffer.length.toString());
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/files/:id", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const fileId = parseInt(req.params.id);
      const [deleted] = await db.delete(storedFiles).where(
        and(eq(storedFiles.id, fileId), eq(storedFiles.companyId, companyId))
      ).returning({ id: storedFiles.id });
      if (!deleted) return res.status(404).json({ message: "File not found" });
      res.json({ message: "File deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Spreadsheets ───────────────────────────────────────────────────────────
  app.get("/api/spreadsheets", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const list = await storage.listSpreadsheets(companyId);
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/spreadsheets/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const id = parseInt(req.params.id);
      const sheet = await storage.getSpreadsheet(id, companyId);
      if (!sheet) return res.status(404).json({ message: "Spreadsheet not found" });
      res.json(sheet);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/spreadsheets", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const username = req.session?.username ?? req.session?.userId ?? "Unknown";
      const { name, data } = req.body;
      const sheet = await storage.createSpreadsheet(companyId, name || "Untitled Spreadsheet", data ?? [], username);
      res.status(201).json(sheet);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/spreadsheets/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const id = parseInt(req.params.id);
      const { name, data } = req.body;
      const fields: { name?: string; data?: any } = {};
      if (name !== undefined) fields.name = name;
      if (data !== undefined) fields.data = data;
      const sheet = await storage.updateSpreadsheet(id, companyId, fields);
      if (!sheet) return res.status(404).json({ message: "Spreadsheet not found" });
      res.json(sheet);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/spreadsheets/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const id = parseInt(req.params.id);
      await storage.deleteSpreadsheet(id, companyId);
      res.json({ message: "Spreadsheet deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Live Spreadsheet Links ───

  app.get("/api/live-spreadsheets", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const isAdmin = req.session?.currentRole === "Admin" || req.session?.currentRole === "Owner";
      const sheets = await storage.getLiveSpreadsheets(companyId, !isAdmin);
      res.json(sheets);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/live-spreadsheets", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const role = req.session?.currentRole;
      if (role !== "Admin" && role !== "Owner") {
        return res.status(403).json({ message: "Admin or Owner role required" });
      }
      const companyId = req.session?.currentCompanyId;
      const parsed = insertLiveSpreadsheetSchema.parse({ ...req.body, companyId });
      const sheet = await storage.createLiveSpreadsheet(parsed);
      res.json(sheet);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/live-spreadsheets/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const role = req.session?.currentRole;
      if (role !== "Admin" && role !== "Owner") {
        return res.status(403).json({ message: "Admin or Owner role required" });
      }
      const companyId = req.session?.currentCompanyId;
      const id = parseInt(req.params.id);
      const fields = insertLiveSpreadsheetSchema.partial().parse(req.body);
      const sheet = await storage.updateLiveSpreadsheet(id, companyId, fields);
      if (!sheet) return res.status(404).json({ message: "Not found" });
      res.json(sheet);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/live-spreadsheets/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const role = req.session?.currentRole;
      if (role !== "Admin" && role !== "Owner") {
        return res.status(403).json({ message: "Admin or Owner role required" });
      }
      const companyId = req.session?.currentCompanyId;
      const id = parseInt(req.params.id);
      await storage.deleteLiveSpreadsheet(id, companyId);
      res.json({ message: "Deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/repair-inventory-values/preview", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const detectResult = await db.execute(
        sql`SELECT i.id, i.location_id, i.stock_item_id, i.quantity, i.average_rate, i.total_value,
                   l.name AS location_name,
                   si.name AS stock_item_name
            FROM inventory i
            LEFT JOIN locations l ON l.id = i.location_id
            LEFT JOIN stock_items si ON si.id = i.stock_item_id
            WHERE i.company_id = ${companyId}
            AND (
              (CAST(i.quantity AS DECIMAL) <= 0 AND CAST(i.total_value AS DECIMAL) > 0.01)
              OR CAST(i.average_rate AS DECIMAL) < 0
              OR (CAST(i.quantity AS DECIMAL) > 0 AND CAST(i.total_value AS DECIMAL) < -0.01)
              OR (CAST(i.quantity AS DECIMAL) <= 0 AND ABS(CAST(i.average_rate AS DECIMAL)) > 0.001)
            )`
      );

      const corruptedRows = detectResult.rows || detectResult;

      if (!corruptedRows || corruptedRows.length === 0) {
        return res.json({ rows: [] });
      }

      const previewRows: any[] = [];
      for (const row of corruptedRows as any[]) {
        const qty = parseFloat(row.quantity || "0");
        const oldRate = parseFloat(row.average_rate || "0");
        const oldValue = parseFloat(row.total_value || "0");

        let newValue = oldValue;
        let newRate = oldRate;
        const reasons: string[] = [];

        if (qty <= 0 && oldValue > 0.01) reasons.push("qty <= 0 but value > 0");
        if (oldRate < 0) reasons.push("negative average_rate");
        if (qty > 0 && oldValue < -0.01) reasons.push("qty > 0 but total_value < 0");
        if (qty <= 0 && Math.abs(oldRate) > 0.001) reasons.push("qty <= 0 but rate != 0");

        if (qty <= 0) {
          newValue = 0;
          newRate = 0;
        } else if (qty > 0 && oldValue < 0) {
          newValue = 0;
          newRate = 0;
        } else if (oldRate < 0) {
          newRate = 0;
        }

        previewRows.push({
          id: row.id,
          locationId: row.location_id,
          locationName: row.location_name || "Unknown",
          stockItemId: row.stock_item_id,
          stockItemName: row.stock_item_name || "Unknown",
          quantity: qty,
          oldRate,
          oldValue,
          newRate,
          newValue,
          reason: reasons.join("; "),
        });
      }

      res.json({ rows: previewRows });
    } catch (error: any) {
      console.error("Inventory repair preview error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/repair-inventory-values", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const detectResult = await db.execute(
        sql`SELECT id, location_id, stock_item_id, quantity, average_rate, total_value
            FROM inventory
            WHERE company_id = ${companyId}
            AND (
              (CAST(quantity AS DECIMAL) <= 0 AND CAST(total_value AS DECIMAL) > 0.01)
              OR CAST(average_rate AS DECIMAL) < 0
              OR (CAST(quantity AS DECIMAL) > 0 AND CAST(total_value AS DECIMAL) < -0.01)
              OR (CAST(quantity AS DECIMAL) <= 0 AND ABS(CAST(average_rate AS DECIMAL)) > 0.001)
            )`
      );

      const corruptedRows = detectResult.rows || detectResult;

      if (!corruptedRows || corruptedRows.length === 0) {
        return res.json({ message: "No corrupted inventory rows found", corrected: 0, rows: [] });
      }

      const correctedRows: any[] = [];
      for (const row of corruptedRows as any[]) {
        const qty = parseFloat(row.quantity || "0");
        const oldRate = parseFloat(row.average_rate || "0");
        const oldValue = parseFloat(row.total_value || "0");

        let newValue = oldValue;
        let newRate = oldRate;

        if (qty <= 0) {
          newValue = 0;
          newRate = 0;
        } else if (qty > 0 && oldValue < 0) {
          newValue = 0;
          newRate = 0;
        } else if (oldRate < 0) {
          newRate = 0;
        }

        await db.execute(
          sql`UPDATE inventory
              SET total_value = ${newValue.toFixed(2)},
                  average_rate = ${newRate.toFixed(2)},
                  last_updated = NOW()
              WHERE id = ${row.id}`
        );

        correctedRows.push({
          id: row.id,
          locationId: row.location_id,
          stockItemId: row.stock_item_id,
          quantity: qty,
          oldRate,
          oldValue,
          newRate,
          newValue,
        });

        console.log(`[InventoryRepair] Corrected row id=${row.id} loc=${row.location_id} item=${row.stock_item_id}: qty=${qty} rate=${oldRate}->${newRate} value=${oldValue}->${newValue}`);
      }

      res.json({
        message: `Repaired ${correctedRows.length} corrupted inventory rows`,
        corrected: correctedRows.length,
        rows: correctedRows,
      });
    } catch (error: any) {
      console.error("Inventory repair error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================
  // NET PROFIT EXCEL EXPORT
  // ============================================================
  app.get("/api/reports/net-profit-excel", requireAuth, async (req, res) => {
    try {
      const user = req.session.user as any;
      const isAdminOrDev = user?.role === "Admin" || user?.role === "Developer";
      const requestedCompanyId = req.query.companyId ? parseInt(req.query.companyId as string) : null;
      const companyId = (isAdminOrDev && requestedCompanyId) ? requestedCompanyId : req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allCompanies = await storage.getAllCompanies();
      const company = allCompanies.find((c: any) => c.id === companyId);
      const companyName = company?.name || "Company";

      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : null;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : null;
      const periodLabel = (req.query.periodLabel as string) || "All Time";

      const companyAccounts = await storage.getAllLedgerAccounts(companyId, true);

      // Fetch period vouchers WITH their dates for monthly grouping
      const voucherConditions: any[] = [eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)];
      if (startDate) voucherConditions.push(gte(vouchers.voucherDate, startDate.toISOString().split("T")[0]));
      if (endDate) voucherConditions.push(lte(vouchers.voucherDate, endDate.toISOString().split("T")[0]));

      const allPeriodVouchers = await db.select({ id: vouchers.id, voucherDate: vouchers.voucherDate })
        .from(vouchers).where(and(...voucherConditions)).execute();

      // Group voucher IDs by YYYY-MM
      const vouchersByMonth = new Map<string, number[]>();
      for (const v of allPeriodVouchers) {
        const d = new Date(v.voucherDate);
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!vouchersByMonth.has(mk)) vouchersByMonth.set(mk, []);
        vouchersByMonth.get(mk)!.push(v.id);
      }
      const sortedMonths = Array.from(vouchersByMonth.keys()).sort();

      // Fetch ALL entries for ALL period vouchers at once
      const allPeriodVoucherIds = allPeriodVouchers.map((v) => v.id);
      const allPeriodEntries = allPeriodVoucherIds.length > 0
        ? await db.select().from(voucherEntries).where(inArray(voucherEntries.voucherId, allPeriodVoucherIds)).execute()
        : [];

      // Map entries by voucherId for fast monthly lookup
      const entriesByVoucherId = new Map<number, any[]>();
      for (const e of allPeriodEntries) {
        if (!entriesByVoucherId.has(e.voucherId)) entriesByVoucherId.set(e.voucherId, []);
        entriesByVoucherId.get(e.voucherId)!.push(e);
      }

      // Fetch ALL sales with dates for the period
      const salesConditions: any[] = [eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)];
      if (startDate) salesConditions.push(gte(vouchers.voucherDate, startDate.toISOString().split("T")[0]));
      if (endDate) salesConditions.push(lte(vouchers.voucherDate, endDate.toISOString().split("T")[0]));
      const allSalesRows = await db.select({ voucherDate: vouchers.voucherDate, total: salesItems.totalSales })
        .from(salesItems).innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id)).where(and(...salesConditions)).execute();

      // Group POS sales by month
      const salesByMonth = new Map<string, number>();
      let totalSalesAll = 0;
      for (const s of allSalesRows) {
        const d = new Date(s.voucherDate);
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const v = parseFloat(s.total || "0");
        salesByMonth.set(mk, (salesByMonth.get(mk) || 0) + v);
        totalSalesAll += v;
      }

      // ERP voucher-based income: income accounts excluded from directIncomes/indirectIncomes
      // (SALES-named accounts and uncategorized income) that appear in non-POS vouchers.
      const xlsxMissedIncomeAccounts = companyAccounts.filter((acc: any) => {
        if (acc.accountType !== "Income") return false;
        if (acc.subType === "Indirect Income") return false;
        if (acc.subType === "Direct Income" && !acc.code?.includes("SALES") && !acc.name?.toLowerCase().includes("sales")) return false;
        return true;
      });
      // Re-fetch pos voucher IDs for the period to exclude from ERP income calculation
      const posPeriodVouchersXlsx = allPeriodVoucherIds.length > 0 && xlsxMissedIncomeAccounts.length > 0
        ? await db.select({ voucherId: salesItems.voucherId })
            .from(salesItems)
            .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
            .where(and(...salesConditions))
            .execute()
        : [];
      const posVIdSetXlsx = new Set(posPeriodVouchersXlsx.map((r) => r.voucherId));
      const nonPosVIdsXlsx = allPeriodVoucherIds.filter((id) => !posVIdSetXlsx.has(id));

      // Map voucherId → voucherDate for nonPosVouchers
      const voucherDateMap = new Map<number, string>();
      for (const v of allPeriodVouchers) voucherDateMap.set(v.id, v.voucherDate as string);

      if (xlsxMissedIncomeAccounts.length > 0 && nonPosVIdsXlsx.length > 0) {
        const missedAccIdsXlsx = xlsxMissedIncomeAccounts.map((a: any) => a.id);
        const erpIncEntries = await db.select()
          .from(voucherEntries)
          .where(and(inArray(voucherEntries.voucherId, nonPosVIdsXlsx), inArray(voucherEntries.ledgerAccountId, missedAccIdsXlsx)))
          .execute();
        for (const e of erpIncEntries) {
          const credit = parseFloat(e.creditAmount || "0");
          const debit = parseFloat(e.debitAmount || "0");
          const net = credit - debit;
          if (Math.abs(net) < 0.001) continue;
          const vDate = voucherDateMap.get(e.voucherId);
          if (!vDate) continue;
          const d = new Date(vDate);
          const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          salesByMonth.set(mk, (salesByMonth.get(mk) || 0) + net);
          totalSalesAll += net;
        }
      }

      // allTimeAccountBalances for Net Position (no startDate filter)
      const allTimeConds: any[] = [eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)];
      if (endDate) allTimeConds.push(lte(vouchers.voucherDate, endDate.toISOString().split("T")[0]));
      const allTimeVsXlsx = await db.select({ id: vouchers.id }).from(vouchers).where(and(...allTimeConds)).execute();
      const allTimeIdsXlsx = allTimeVsXlsx.map((v) => v.id);
      const allTimeEntriesXlsx = allTimeIdsXlsx.length > 0
        ? await db.select().from(voucherEntries).where(inArray(voucherEntries.voucherId, allTimeIdsXlsx)).execute()
        : [];
      const allTimeBalsXlsx = new Map<number, { debit: number; credit: number }>();
      for (const e of allTimeEntriesXlsx) {
        if (e.ledgerAccountId) {
          const d = parseFloat(e.debitAmount || "0"), c = parseFloat(e.creditAmount || "0");
          const cur = allTimeBalsXlsx.get(e.ledgerAccountId) || { debit: 0, credit: 0 };
          allTimeBalsXlsx.set(e.ledgerAccountId, { debit: cur.debit + d, credit: cur.credit + c });
        }
      }

      // Opening Stock
      const allStockItems = await storage.getAllStockItems(companyId);
      let openingStockValue = 0;
      for (const item of allStockItems) openingStockValue += parseFloat((item as any).openingValue || "0");

      // Closing Stock (current inventory)
      const activeLocData = await db.select({ id: locations.id }).from(locations)
        .where(and(eq(locations.companyId, companyId), eq(locations.active, true), isNull(locations.deletedAt))).execute();
      const activeLocIds = activeLocData.map((l) => l.id);
      let closingStockValue = 0;
      if (activeLocIds.length > 0) {
        const invData = await db.select({ quantity: inventory.quantity, averageRate: inventory.averageRate })
          .from(inventory).where(inArray(inventory.locationId, activeLocIds)).execute();
        for (const inv of invData) closingStockValue += parseFloat(inv.quantity || "0") * parseFloat(inv.averageRate || "0");
      }

      // Net Position - same calculation as dashboard (/api/stats/net-profit)
      const npRound2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

      // Build supplier balance map from all-time entries
      const xlsxSupplierBals = new Map<number, { debit: number; credit: number }>();
      for (const e of allTimeEntriesXlsx) {
        if ((e as any).supplierId) {
          const d = parseFloat((e as any).debitAmount || "0"), c = parseFloat((e as any).creditAmount || "0");
          const cur = xlsxSupplierBals.get((e as any).supplierId) || { debit: 0, credit: 0 };
          xlsxSupplierBals.set((e as any).supplierId, { debit: cur.debit + d, credit: cur.credit + c });
        }
      }

      // Account exclusion rules matching dashboard
      const npExcludedTypes = ["Income", "Profit", "Equity", "EQUITY", "Fixed Asset"];
      const npExpenseTypes = ["Expense", "Direct Expense", "Indirect Expense"];
      const npLiabilityTypes = ["Liability", "Duty Agent", "Transporter Agent", "Loan"];
      const npAssetTypes = ["Asset", "Current Asset", "Fixed Asset", "Bank", "Cash"];
      const npStockPatterns = ["closing stock", "opening stock", "stock in hand", "stock on hand", "inventory", "stock account", "goods in stock", "merchandise"];
      const npStockCodes = ["CLOSING_STOCK", "OPENING_STOCK", "STOCK", "INVENTORY", "STOCK_IN_HAND"];
      const npFixedAssetNames = ["rover", "toyota", "mercedes", "vehicle", "car", "truck", "land", "property", "building", "house", "rolex", "watch", "luxury", "jewelry", "guarantee", "deposit", "caution"];
      const isExcludedFromNp = (acc: any) => {
        if (npExcludedTypes.includes(acc.accountType || "")) return true;
        if (acc.code === "PRODUCTION_ADJUSTMENT" || acc.code === "CONSUMPTION_EXPENSE") return true;
        const nameLower = (acc.name || "").toLowerCase();
        const codeLower = (acc.code || "").toLowerCase();
        if (npAssetTypes.includes(acc.accountType || "")) {
          if (npStockPatterns.some((p: string) => nameLower.includes(p))) return true;
          if (npStockCodes.some((c: string) => codeLower === c.toLowerCase() || codeLower.startsWith(c.toLowerCase() + "_"))) return true;
          if (npFixedAssetNames.some((p: string) => nameLower.includes(p))) return true;
        }
        return false;
      };

      let npForUs = 0, npOnUs = 0;
      for (const acc of companyAccounts) {
        if (npExpenseTypes.includes(acc.accountType || "")) continue;
        if (acc.accountType === "Income") continue;
        if (isExcludedFromNp(acc)) continue;
        const opening = parseFloat((acc as any).openingBalance || "0");
        const openingSigned = (acc as any).openingBalanceSide === "Dr" ? opening : -opening;
        const bal = allTimeBalsXlsx.get(acc.id) || { debit: 0, credit: 0 };
        const net = openingSigned + bal.debit - bal.credit;
        if (net > 0) npForUs += net;
        else if (net < 0) npOnUs += Math.abs(net);
      }

      // For All Time (no endDate): include inventory, workers, OTW — current values match the dashboard.
      // For specific periods (endDate set): skip these non-date-bounded components.
      const xlsxIsAllTime = !endDate;
      if (xlsxIsAllTime) {
        // Add stock on floor (inventory) as asset
        npForUs += closingStockValue;

        // Add worker/employee liabilities
        const xlsxEmployees = await db.select().from(employees)
          .where(and(eq(employees.companyId, companyId), eq(employees.active, true), isNull(employees.deletedAt))).execute();
        let xlsxWorkerBal = 0;
        for (const emp of xlsxEmployees) xlsxWorkerBal += parseFloat((emp as any).currentBalance || "0");
        if (xlsxWorkerBal > 0) npOnUs += xlsxWorkerBal;
        else if (xlsxWorkerBal < 0) npForUs += Math.abs(xlsxWorkerBal);

        // Add OTW containers as assets
        const xlsxOtwContainers = await db.select().from(containers)
          .where(and(eq(containers.companyId, companyId), eq(containers.status, "OTW"))).execute();
        for (const c of xlsxOtwContainers) {
          npForUs += parseFloat((c as any).grandTotal || (c as any).itemsTotal || "0");
        }
      }

      // Add suppliers (always included — xlsxSupplierBals is already bounded by endDate)
      const xlsxParentCompanyId = await storage.getParentCompanyId();
      const xlsxShouldIncludeSuppliers = xlsxParentCompanyId === null || companyId === xlsxParentCompanyId;
      if (xlsxShouldIncludeSuppliers) {
        const xlsxAllSuppliers = await db.select().from(suppliers).where(isNull(suppliers.deletedAt)).execute();
        for (const sup of xlsxAllSuppliers) {
          const balance = xlsxSupplierBals.get((sup as any).id);
          if (balance) {
            const opening = parseFloat((sup as any).openingBalance || "0");
            const netBalance = opening + balance.credit - balance.debit;
            if (netBalance > 0) npOnUs += netBalance;
            else if (netBalance < 0) npForUs += Math.abs(netBalance);
          }
        }
      }

      const netPositionValue = npRound2(npForUs - npOnUs);

      // Import charges IDs
      const importChargesParent = companyAccounts.find((acc: any) => acc.code === "IMPORT_CHARGES");
      const importChargesIds = new Set<number>();
      if (importChargesParent) {
        importChargesIds.add((importChargesParent as any).id);
        companyAccounts.forEach((acc: any) => { if (acc.parentId === (importChargesParent as any).id) importChargesIds.add(acc.id); });
      }

      const fmt = (n: number) => parseFloat(n.toFixed(2));

      function computeBalancesFromEntries(entries: any[]): Map<number, { debit: number; credit: number }> {
        const bal = new Map<number, { debit: number; credit: number }>();
        for (const e of entries) {
          if (e.ledgerAccountId) {
            const d = parseFloat(e.debitAmount || '0'), c = parseFloat(e.creditAmount || '0');
            const cur = bal.get(e.ledgerAccountId) || { debit: 0, credit: 0 };
            bal.set(e.ledgerAccountId, { debit: cur.debit + d, credit: cur.credit + c });
          }
        }
        return bal;
      }

      function computeStats(balances: Map<number, { debit: number; credit: number }>, salesTotal: number, openingSt: number, closingSt: number, monthlyMode = false) {
        // Direct Incomes (non-sales income accounts)
        const directIncAccounts = companyAccounts.filter((acc: any) =>
          acc.accountType === 'Income' && acc.subType === 'Direct Income' &&
          !acc.code?.includes('SALES') && !acc.name?.toLowerCase().includes('sales')
        );
        let directIncTotal = 0;
        const directIncDetails = directIncAccounts.map((acc: any) => {
          const b = balances.get(acc.id) || { debit: 0, credit: 0 };
          const net = b.credit - b.debit; directIncTotal += net;
          return { id: acc.id, name: acc.name, debit: b.debit, credit: b.credit, balance: net };
        }).filter((r: any) => r.debit !== 0 || r.credit !== 0);

        const totalIncome = salesTotal + directIncTotal;

        // Purchases
        const purchaseAccounts = companyAccounts.filter((acc: any) => acc.code === 'PURCHASES' || acc.code?.startsWith('PURCHASES-'));
        let purchaseTotal = 0;
        const purchaseDetails = purchaseAccounts.map((acc: any) => {
          const b = balances.get(acc.id) || { debit: 0, credit: 0 };
          const net = b.debit - b.credit; purchaseTotal += net;
          return { id: acc.id, name: acc.name, debit: b.debit, credit: b.credit, balance: net };
        }).filter((r: any) => r.debit !== 0 || r.credit !== 0);

        // Direct Expenses
        const directExpAccounts = companyAccounts.filter((acc: any) =>
          (acc.code !== 'PURCHASES' && !acc.code?.startsWith('PURCHASES')) && (acc.accountType === 'Direct Expense' || (acc.accountType === 'Expense' && acc.subType === 'Direct Expense') || importChargesIds.has(acc.id))
        );
        let directExpTotal = 0;
        const directExpDetails = directExpAccounts.map((acc: any) => {
          const b = balances.get(acc.id) || { debit: 0, credit: 0 };
          const net = b.debit - b.credit; directExpTotal += net;
          return { id: acc.id, name: acc.name, debit: b.debit, credit: b.credit, balance: net };
        }).filter((r: any) => r.debit !== 0 || r.credit !== 0);

        // Indirect Expenses
        const indirectExpAccounts = companyAccounts.filter((acc: any) =>
          acc.accountType === 'Indirect Expense' && acc.code !== 'PRODUCTION_ADJUSTMENT' && acc.code !== 'CONSUMPTION_EXPENSE' && acc.code !== 'PURCHASES' && !acc.code?.startsWith('PURCHASES')
        );
        let indirectExpTotal = 0;
        const indirectExpDetails = indirectExpAccounts.map((acc: any) => {
          const b = balances.get(acc.id) || { debit: 0, credit: 0 };
          const net = b.debit - b.credit; indirectExpTotal += net;
          return { id: acc.id, name: acc.name, debit: b.debit, credit: b.credit, balance: net };
        }).filter((r: any) => r.debit !== 0 || r.credit !== 0);

        // COGS: Opening + Purchases + Direct + Indirect - Closing (monthlyMode: no opening/closing)
        const totalCOGS = monthlyMode
          ? purchaseTotal + directExpTotal + indirectExpTotal
          : openingSt + purchaseTotal + directExpTotal + indirectExpTotal - closingSt;

        const grossProfit = totalIncome - totalCOGS;
        const netProfit = grossProfit;
        const grossMarginPct = totalIncome > 0 ? (grossProfit / totalIncome) * 100 : 0;
        const netMarginPct = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;

        return {
          salesTotal, directIncTotal, directIncDetails, totalIncome,
          purchaseTotal, purchaseDetails, directExpTotal, directExpDetails,
          indirectExpTotal, indirectExpDetails,
          openingSt, closingSt, totalCOGS, grossProfit, netProfit, grossMarginPct, netMarginPct,
          monthlyMode
        };
      }

      function writeSheet(ws: any, stats: ReturnType<typeof computeStats>, sheetLabel: string, showNetPosition: boolean, npValue: number) {
        const { salesTotal, directIncTotal, directIncDetails, totalIncome, purchaseTotal, purchaseDetails, directExpTotal, directExpDetails, indirectExpTotal, indirectExpDetails, openingSt, closingSt, totalCOGS, grossProfit, netProfit, grossMarginPct, netMarginPct, monthlyMode } = stats;

        ws.properties.defaultColWidth = 20;

        // Title
        ws.mergeCells('A1:E1');
        const titleCell = ws.getCell('A1');
        titleCell.value = `Profit & Loss — ${companyName}`;
        titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(1).height = 36;

        ws.mergeCells('A2:E2');
        const subCell = ws.getCell('A2');
        subCell.value = `Period: ${sheetLabel}${monthlyMode ? '  |  COGS = Purchases + Direct + Indirect Expenses (no stock adjustment for individual months)' : ''}`;
        subCell.font = { italic: true, size: 11, color: { argb: 'FF555555' } };
        subCell.alignment = { horizontal: 'center' };
        ws.getRow(2).height = 22;
        ws.addRow([]);

        // KPI Summary block
        const kpiHdr = ws.addRow(['', 'SUMMARY', '', '', '']);
        kpiHdr.getCell(2).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        kpiHdr.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        ws.mergeCells(`B${kpiHdr.number}:E${kpiHdr.number}`);

        const kpiRows: [string, string | number, boolean][] = [
          ['Total Income (Sales + Direct Inc)', fmt(totalIncome), false],
          ['Total COGS', fmt(totalCOGS), false],
          ['Gross Profit', fmt(grossProfit), true],
          ['Net Profit', fmt(netProfit), true],
          ['Gross Margin %', grossMarginPct.toFixed(1) + '%', false],
          ['Net Margin %', netMarginPct.toFixed(1) + '%', false],
        ];

        for (const [label, value, isBold] of kpiRows) {
          const row = ws.addRow(['', label, '', '', value]);
          const numVal = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ''));
          const profColor = numVal >= 0 ? 'FF16A34A' : 'FFDC2626';
          row.getCell(2).font = { bold: isBold };
          row.getCell(5).font = { bold: isBold, color: { argb: isBold ? profColor : 'FF374151' } };
          if (typeof value === 'number' || (!String(value).includes('%'))) row.getCell(5).numFmt = '$#,##0.##';
          ws.mergeCells(`B${row.number}:D${row.number}`);
          if (isBold) {
            row.eachCell((cell: any) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: numVal >= 0 ? 'FFD1FAE5' : 'FFFEE2E2' } }; });
            row.getCell(2).font = { bold: true };
            row.getCell(5).font = { bold: true, color: { argb: profColor } };
          }
        }
        ws.addRow([]);

        // Helper: section header row
        const secHeader = (title: string, color: string) => {
          const hRow = ws.addRow([title, 'Account', 'Debit', 'Credit', 'Net']);
          hRow.eachCell((cell: any, col: number) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
            cell.alignment = { horizontal: col <= 2 ? 'left' : 'right' };
          });
        };

        // Helper: account detail rows
        const addAccRows = (rows: any[]) => {
          if (rows.length === 0) {
            const empty = ws.addRow(['', '(none)', '', '', '']);
            empty.getCell(2).font = { italic: true, color: { argb: 'FF888888' } };
            return;
          }
          for (const r of rows) {
            const dr = ws.addRow(['', r.name, fmt(r.debit), fmt(r.credit), fmt(r.balance)]);
            dr.getCell(3).numFmt = '$#,##0'; dr.getCell(4).numFmt = '$#,##0'; dr.getCell(5).numFmt = '$#,##0';
            dr.getCell(5).font = { color: { argb: r.balance >= 0 ? 'FF16A34A' : 'FFDC2626' } };
          }
        };

        // Helper: subtotal row
        const subTot = (label: string, value: number) => {
          const r = ws.addRow(['', label, '', '', fmt(value)]);
          r.eachCell((cell: any) => { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } }; });
          r.getCell(5).numFmt = '$#,##0'; r.getCell(5).font = { bold: true, color: { argb: value >= 0 ? 'FF16A34A' : 'FFDC2626' } };
          ws.addRow([]);
        };

        // === INCOME SECTION ===
        secHeader('INCOME', 'FF1E3A5F');
        // Sales row
        const salesRow = ws.addRow(['', 'Total Sales (POS & Revenue)', '', '', fmt(salesTotal)]);
        salesRow.getCell(5).numFmt = '$#,##0'; salesRow.getCell(5).font = { color: { argb: 'FF16A34A' } };
        // Direct Incomes
        if (directIncDetails.length > 0) {
          const diHdr = ws.addRow(['', '— Direct Incomes', '', '', '']);
          diHdr.getCell(2).font = { italic: true, color: { argb: 'FF555555' } };
          addAccRows(directIncDetails);
        }
        subTot('Total Income', totalIncome);

        // === COST OF GOODS SOLD ===
        secHeader('COST OF GOODS SOLD (COGS)', 'FFDC2626');
        if (!monthlyMode && openingSt > 0) {
          const osRow = ws.addRow(['', 'Opening Stock', '', '', fmt(openingSt)]);
          osRow.getCell(5).numFmt = '$#,##0'; osRow.getCell(5).font = { color: { argb: 'FFDC2626' } };
        }

        // Purchases sub-section
        const pHdr = ws.addRow(['', '— Purchases', '', '', '']);
        pHdr.getCell(2).font = { italic: true, bold: true, color: { argb: 'FFDC2626' } };
        addAccRows(purchaseDetails);
        const pTotRow = ws.addRow(['', 'Total Purchases', '', '', fmt(purchaseTotal)]);
        pTotRow.getCell(2).font = { bold: true }; pTotRow.getCell(5).numFmt = '$#,##0'; pTotRow.getCell(5).font = { bold: true, color: { argb: 'FFDC2626' } };

        // Direct Expenses sub-section
        const deHdr = ws.addRow(['', '— Direct Expenses', '', '', '']);
        deHdr.getCell(2).font = { italic: true, bold: true, color: { argb: 'FFB45309' } };
        addAccRows(directExpDetails);
        const deTotRow = ws.addRow(['', 'Total Direct Expenses', '', '', fmt(directExpTotal)]);
        deTotRow.getCell(2).font = { bold: true }; deTotRow.getCell(5).numFmt = '$#,##0'; deTotRow.getCell(5).font = { bold: true, color: { argb: 'FFDC2626' } };

        // Indirect Expenses sub-section
        const ieHdr = ws.addRow(['', '— Indirect Expenses', '', '', '']);
        ieHdr.getCell(2).font = { italic: true, bold: true, color: { argb: 'FF7C3AED' } };
        addAccRows(indirectExpDetails);
        const ieTotRow = ws.addRow(['', 'Total Indirect Expenses', '', '', fmt(indirectExpTotal)]);
        ieTotRow.getCell(2).font = { bold: true }; ieTotRow.getCell(5).numFmt = '$#,##0'; ieTotRow.getCell(5).font = { bold: true, color: { argb: 'FFDC2626' } };

        if (!monthlyMode && closingSt > 0) {
          const csRow = ws.addRow(['', 'Less: Closing Stock', '', '', fmt(-closingSt)]);
          csRow.getCell(5).numFmt = '$#,##0'; csRow.getCell(5).font = { color: { argb: 'FF16A34A' } };
        }

        // COGS total
        const cogsRow = ws.addRow(['TOTAL COGS', '', '', '', fmt(totalCOGS)]);
        cogsRow.eachCell((cell: any) => { cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } }; cell.alignment = { horizontal: 'center' }; });
        cogsRow.getCell(5).numFmt = '$#,##0.##';
        ws.mergeCells(`A${cogsRow.number}:D${cogsRow.number}`);
        ws.getRow(cogsRow.number).height = 24;
        ws.addRow([]);

        // GROSS PROFIT
        const gpRow = ws.addRow(['GROSS PROFIT', '', '', '', fmt(grossProfit)]);
        gpRow.eachCell((cell: any) => { cell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: grossProfit >= 0 ? 'FF059669' : 'FFDC2626' } }; cell.alignment = { horizontal: 'center' }; });
        gpRow.getCell(5).numFmt = '$#,##0.##';
        ws.mergeCells(`A${gpRow.number}:D${gpRow.number}`);
        ws.getRow(gpRow.number).height = 28;

        // NET PROFIT (= Gross Profit since all expenses are in COGS)
        const npRow = ws.addRow(['NET PROFIT', '', '', '', fmt(netProfit)]);
        npRow.eachCell((cell: any) => { cell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: netProfit >= 0 ? 'FF2563EB' : 'FFDC2626' } }; cell.alignment = { horizontal: 'center' }; });
        npRow.getCell(5).numFmt = '$#,##0.##';
        ws.mergeCells(`A${npRow.number}:D${npRow.number}`);
        ws.getRow(npRow.number).height = 28;
        ws.addRow([]);

        // RATIOS
        const ratioHdr = ws.addRow(['RATIOS', '', '', '', '']);
        ratioHdr.getCell(1).font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        ratioHdr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4B5563' } };

        const gmRow = ws.addRow(['', 'Gross Margin %', '', '', grossMarginPct.toFixed(2) + '%']);
        gmRow.getCell(2).font = { bold: false }; gmRow.getCell(5).font = { bold: true };
        ws.mergeCells(`B${gmRow.number}:D${gmRow.number}`);

        const nmRow = ws.addRow(['', 'Net Margin %', '', '', netMarginPct.toFixed(2) + '%']);
        nmRow.getCell(2).font = { bold: false }; nmRow.getCell(5).font = { bold: true };
        ws.mergeCells(`B${nmRow.number}:D${nmRow.number}`);

        ws.getColumn(1).width = 28;
        ws.getColumn(2).width = 38;
        ws.getColumn(3).width = 16;
        ws.getColumn(4).width = 16;
        ws.getColumn(5).width = 16;
      }

      function writeSummarySheet(ws: any, monthStatsList: ReturnType<typeof computeStats>[], totalStats: ReturnType<typeof computeStats>, monthLabels: string[], npValue: number) {
        const numMonths = monthLabels.length;
        const totalCol = numMonths + 2; // col B = month1, ..., last month col = B+numMonths-1, total = B+numMonths

        ws.properties.defaultColWidth = 16;

        // Title
        ws.mergeCells(1, 1, 1, totalCol);
        const titleCell = ws.getCell(1, 1);
        titleCell.value = `P&L Summary — ${companyName}`;
        titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(1).height = 36;

        // Header row: [blank] | Month1 | Month2 | ... | TOTAL
        const hdrRowData: any[] = [''];
        for (const ml of monthLabels) hdrRowData.push(ml);
        hdrRowData.push('TOTAL');
        const hdrRow = ws.addRow(hdrRowData);
        hdrRow.eachCell((cell: any, col: number) => {
          if (col === 1) return;
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col === totalCol ? 'FF1E3A5F' : 'FF374151' } };
          cell.alignment = { horizontal: 'right' };
        });
        ws.getRow(2).height = 22;

        // Helper: write a data row
        const numFmt = '$#,##0';
        const pctFmt = '0.00%';

        const writeRow = (label: string, monthVals: number[], totalVal: number, opts: { bold?: boolean; highlight?: boolean; colorize?: boolean; pct?: boolean; labelColor?: string; indent?: boolean } = {}) => {
          const rowData: any[] = [opts.indent ? '  ' + label : label];
          for (const v of monthVals) rowData.push(opts.pct ? v / 100 : fmt(v));
          rowData.push(opts.pct ? fmt(totalVal) / 100 : fmt(totalVal));
          const row = ws.addRow(rowData);
          if (opts.bold) row.getCell(1).font = { bold: true };
          if (opts.labelColor) row.getCell(1).font = { bold: opts.bold, color: { argb: opts.labelColor } };

          for (let c = 2; c <= totalCol; c++) {
            const cell = row.getCell(c);
            const val = c === totalCol ? totalVal : monthVals[c - 2];
            cell.numFmt = opts.pct ? '0.00%' : numFmt;
            if (opts.bold) cell.font = { bold: true };
            if (opts.colorize) cell.font = { bold: opts.bold, color: { argb: val >= 0 ? 'FF16A34A' : 'FFDC2626' } };
            if (opts.highlight) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: val >= 0 ? 'FFD1FAE5' : 'FFFEE2E2' } };
          }
          return row;
        };

        const writeSectionHdr = (label: string, color: string) => {
          const rowData: any[] = [label];
          for (let i = 0; i <= numMonths; i++) rowData.push('');
          const row = ws.addRow(rowData);
          row.eachCell((cell: any) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }; });
          ws.mergeCells(row.number, 1, row.number, totalCol);
          ws.getRow(row.number).height = 20;
        };

        const blankRow = () => ws.addRow(Array(totalCol).fill(''));

        // === INCOME ===
        writeSectionHdr('INCOME', 'FF1E3A5F');
        writeRow('Sales Revenue', monthStatsList.map(s => s.salesTotal), totalStats.salesTotal, { colorize: true });
        writeRow('Direct Incomes', monthStatsList.map(s => s.directIncTotal), totalStats.directIncTotal, { colorize: true });
        writeRow('TOTAL INCOME', monthStatsList.map(s => s.totalIncome), totalStats.totalIncome, { bold: true, colorize: true, highlight: true });
        blankRow();

        // === COGS ===
        writeSectionHdr('COST OF GOODS SOLD (COGS)', 'FFDC2626');
        // Opening Stock: only show in total column (not per-month)
        {
          const rowData: any[] = ['Opening Stock'];
          for (let i = 0; i < numMonths; i++) rowData.push('—');
          rowData.push(fmt(totalStats.openingSt));
          const row = ws.addRow(rowData);
          row.getCell(1).font = { italic: true };
          row.getCell(totalCol).numFmt = numFmt;
          row.getCell(totalCol).font = { color: { argb: 'FFDC2626' } };
        }
        writeRow('Purchases', monthStatsList.map(s => s.purchaseTotal), totalStats.purchaseTotal, { colorize: true, indent: true });
        writeRow('Direct Expenses', monthStatsList.map(s => s.directExpTotal), totalStats.directExpTotal, { colorize: true, indent: true });
        writeRow('Indirect Expenses', monthStatsList.map(s => s.indirectExpTotal), totalStats.indirectExpTotal, { colorize: true, indent: true });
        // Closing Stock: only show in total column (negative, reduces COGS)
        {
          const rowData: any[] = ['Less: Closing Stock'];
          for (let i = 0; i < numMonths; i++) rowData.push('—');
          rowData.push(fmt(-totalStats.closingSt));
          const row = ws.addRow(rowData);
          row.getCell(1).font = { italic: true };
          row.getCell(totalCol).numFmt = numFmt;
          row.getCell(totalCol).font = { color: { argb: 'FF16A34A' } };
        }
        writeRow('TOTAL COGS', monthStatsList.map(s => s.totalCOGS), totalStats.totalCOGS, { bold: true, colorize: true, highlight: true });
        blankRow();

        // === GROSS PROFIT ===
        writeSectionHdr('GROSS PROFIT', 'FF059669');
        writeRow('Gross Profit', monthStatsList.map(s => s.grossProfit), totalStats.grossProfit, { bold: true, colorize: true, highlight: true });
        blankRow();

        // === NET PROFIT ===
        writeSectionHdr('NET PROFIT', 'FF2563EB');
        writeRow('Net Profit', monthStatsList.map(s => s.netProfit), totalStats.netProfit, { bold: true, colorize: true, highlight: true });
        blankRow();

        // === RATIOS ===
        writeSectionHdr('RATIOS', 'FF4B5563');
        writeRow('Gross Margin %', monthStatsList.map(s => s.grossMarginPct), totalStats.grossMarginPct, { pct: true });
        writeRow('Net Margin %', monthStatsList.map(s => s.netMarginPct), totalStats.netMarginPct, { pct: true });
        blankRow();

        // Column widths
        ws.getColumn(1).width = 36;
        for (let c = 2; c <= totalCol; c++) ws.getColumn(c).width = 14;
      }

      function fmtMonthLabel(mk: string) {
        const [yr, mo] = mk.split('-');
        const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${names[parseInt(mo) - 1]} ${yr}`;
      }

      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.default.Workbook();
      workbook.creator = 'ERP System';
      workbook.created = new Date();

      if (sortedMonths.length > 1) {
        // Summary sheet first (one column per month + grand total)
        const allBalances = computeBalancesFromEntries(allPeriodEntries);
        const totalStats = computeStats(allBalances, totalSalesAll, openingStockValue, closingStockValue, false);
        const monthStatsList = sortedMonths.map((mk) => {
          const monthVIds = vouchersByMonth.get(mk)!;
          const monthEntries = monthVIds.flatMap((id) => entriesByVoucherId.get(id) || []);
          const monthBalances = computeBalancesFromEntries(monthEntries);
          const monthSales = salesByMonth.get(mk) || 0;
          return computeStats(monthBalances, monthSales, 0, 0, true);
        });
        const monthLabels = sortedMonths.map(fmtMonthLabel);

        const summaryWs = workbook.addWorksheet('Summary');
        writeSummarySheet(summaryWs, monthStatsList, totalStats, monthLabels, netPositionValue);

        // One detail sheet per month
        for (let i = 0; i < sortedMonths.length; i++) {
          const mk = sortedMonths[i];
          const ws = workbook.addWorksheet(fmtMonthLabel(mk));
          writeSheet(ws, monthStatsList[i], fmtMonthLabel(mk), false, 0);
        }
      } else {
        // Single sheet
        const allBalances = computeBalancesFromEntries(allPeriodEntries);
        const stats = computeStats(allBalances, totalSalesAll, openingStockValue, closingStockValue, false);
        const ws = workbook.addWorksheet('Net Profit Report');
        writeSheet(ws, stats, periodLabel, false, 0);
      }

      const safeCompanyName = companyName.replace(/[^a-z0-9]/gi, '_');
      const safePeriod = periodLabel.replace(/[^a-z0-9]/gi, '_');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="NetProfit_${safeCompanyName}_${safePeriod}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error('Net profit Excel export error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Agent Accounts ──────────────────────────────────────────────────────
  app.get("/api/agent-accounts", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const rows = await db.select().from(agentAccounts).where(eq(agentAccounts.companyId, companyId));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/agent-accounts", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { accountId, accountType, accountName } = req.body;
      if (!accountId || !accountType || !accountName) return res.status(400).json({ message: "accountId, accountType, and accountName are required" });
      const [row] = await db.insert(agentAccounts)
        .values({ companyId, accountId, accountType, accountName })
        .onConflictDoUpdate({ target: [agentAccounts.companyId, agentAccounts.accountId], set: { accountName, accountType } })
        .returning();
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/agent-accounts/:accountId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accountId = decodeURIComponent(req.params.accountId);
      await db.delete(agentAccounts).where(and(eq(agentAccounts.companyId, companyId), eq(agentAccounts.accountId, accountId)));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

}
