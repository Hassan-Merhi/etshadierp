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

export function registerStockSummaryRoutes(app: Express) {
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

  // Location transactions for a date range (used by "Show all months" feature)
  app.get("/api/locations/:locationId/stock-items/:stockItemId/transactions", requireAuth, async (req, res) => {
    try {
      const locationId = parseInt(req.params.locationId);
      const stockItemId = parseInt(req.params.stockItemId);
      const companyId = req.session.currentCompanyId;
      const startDate = (req.query.startDate as string) || "";
      const endDate = (req.query.endDate as string) || "";

      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate are required" });

      const stockItem = await storage.getStockItemById(stockItemId);
      if (!stockItem) return res.status(404).json({ message: "Stock item not found" });

      const location = await storage.getLocationById(locationId);
      if (!location) return res.status(404).json({ message: "Location not found" });

      // ── OPENING BALANCE (all movements strictly before startDate) ──────────
      let priorInQty = 0, priorInValue = 0, priorOutQty = 0, priorOutValue = 0;

      const priorTransfers = await db
        .select({ quantity: stockTransferItems.quantity, totalAmount: stockTransferItems.totalAmount,
                  sourceLocationId: stockTransferItems.sourceLocationId,
                  destinationLocationId: stockTransferVouchers.destinationLocationId })
        .from(stockTransferItems)
        .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
        .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
        .where(and(eq(stockTransferItems.stockItemId, stockItemId), eq(vouchers.companyId, companyId),
                   isNull(vouchers.deletedAt), eq(vouchers.optional, false),
                   sql`${vouchers.voucherDate}::date < ${startDate}::date`,
                   or(eq(stockTransferItems.sourceLocationId, locationId),
                      eq(stockTransferVouchers.destinationLocationId, locationId))));
      for (const t of priorTransfers) {
        const q = parseFloat(t.quantity), v = parseFloat(t.totalAmount);
        if (t.sourceLocationId === locationId) { priorOutQty += q; priorOutValue += v; }
        if (t.destinationLocationId === locationId) { priorInQty += q; priorInValue += v; }
      }

      const priorAdj = await db
        .select({ quantity: stockAdjustmentItems.quantity, totalAmount: stockAdjustmentItems.totalAmount })
        .from(stockAdjustmentItems)
        .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
        .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
        .where(and(eq(stockAdjustmentItems.stockItemId, stockItemId), eq(vouchers.companyId, companyId),
                   isNull(vouchers.deletedAt), eq(vouchers.optional, false),
                   eq(stockAdjustmentVouchers.locationId, locationId),
                   sql`${vouchers.voucherDate}::date < ${startDate}::date`));
      for (const a of priorAdj) {
        const q = parseFloat(a.quantity), v = parseFloat(a.totalAmount);
        if (q > 0) { priorInQty += q; priorInValue += v; }
        else { priorOutQty += Math.abs(q); priorOutValue += Math.abs(v); }
      }

      const priorSales = await db
        .select({ quantity: salesItems.quantity, totalCost: salesItems.totalCost })
        .from(salesItems).innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(eq(salesItems.stockItemId, stockItemId), eq(vouchers.companyId, companyId),
                   isNull(vouchers.deletedAt), eq(vouchers.optional, false),
                   eq(vouchers.locationId, locationId),
                   sql`${vouchers.voucherDate}::date < ${startDate}::date`));
      for (const s of priorSales) { priorOutQty += parseFloat(s.quantity); priorOutValue += parseFloat(s.totalCost); }

      const priorOffloads = await db
        .select({ quantity: poLineItems.quantity, lineTotal: poLineItems.lineTotal,
                  additionalCostPerBale: containerOffloads.additionalCostPerBale })
        .from(containerOffloads)
        .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
        .innerJoin(purchaseOrders, eq(purchaseOrders.containerId, containers.id))
        .innerJoin(poLineItems, eq(poLineItems.poId, purchaseOrders.id))
        .where(and(eq(poLineItems.stockItemId, stockItemId), eq(containers.companyId, companyId),
                   eq(containerOffloads.locationId, locationId),
                   sql`${containerOffloads.offloadedAt}::date < ${startDate}::date`));
      for (const o of priorOffloads) {
        const q = parseFloat(o.quantity);
        priorInQty += q;
        priorInValue += parseFloat(o.lineTotal) + parseFloat(o.additionalCostPerBale) * q;
      }

      const openingQty = priorInQty - priorOutQty;
      const openingValue = priorInValue - priorOutValue;
      const openingRate = openingQty > 0 ? openingValue / openingQty : 0;

      // ── TRANSACTIONS IN DATE RANGE ────────────────────────────────────────
      type TxRaw = { date: string; particulars: string; vchType: string;
                     voucherId: number; poId?: number;
                     inwardQty: number; inwardRate: number; inwardValue: number;
                     outwardQty: number; outwardRate: number; outwardValue: number;
                     isPOS?: boolean; posSellingRate?: number; posSellingValue?: number; };
      const txns: TxRaw[] = [];

      // Stock Transfers
      const rangeTransfers = await db
        .select({ voucherDate: vouchers.voucherDate, voucherId: vouchers.id,
                  quantity: stockTransferItems.quantity, rate: stockTransferItems.rate,
                  totalAmount: stockTransferItems.totalAmount,
                  sourceLocationId: stockTransferItems.sourceLocationId,
                  destinationLocationId: stockTransferVouchers.destinationLocationId })
        .from(stockTransferItems)
        .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
        .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
        .where(and(eq(stockTransferItems.stockItemId, stockItemId), eq(vouchers.companyId, companyId),
                   isNull(vouchers.deletedAt), eq(vouchers.optional, false),
                   sql`${vouchers.voucherDate}::date >= ${startDate}::date`,
                   sql`${vouchers.voucherDate}::date <= ${endDate}::date`,
                   or(eq(stockTransferItems.sourceLocationId, locationId),
                      eq(stockTransferVouchers.destinationLocationId, locationId))))
        .orderBy(vouchers.voucherDate);

      const locIds = new Set<number>();
      for (const t of rangeTransfers) {
        if (t.sourceLocationId) locIds.add(t.sourceLocationId);
        if (t.destinationLocationId) locIds.add(t.destinationLocationId);
      }
      const locMap: Record<number, string> = {};
      for (const lid of Array.from(locIds)) {
        const l = await storage.getLocationById(lid);
        if (l) locMap[lid] = l.name;
      }
      for (const t of rangeTransfers) {
        const q = parseFloat(t.quantity), rate = parseFloat(t.rate), v = parseFloat(t.totalAmount);
        const srcName = t.sourceLocationId ? (locMap[t.sourceLocationId] || 'Unknown') : 'Unknown';
        const dstName = locMap[t.destinationLocationId] || 'Unknown';
        if (t.sourceLocationId === locationId)
          txns.push({ date: t.voucherDate, particulars: `To ${dstName}`, vchType: 'Stock Transfer',
                      voucherId: t.voucherId, inwardQty: 0, inwardRate: 0, inwardValue: 0,
                      outwardQty: q, outwardRate: rate, outwardValue: v });
        if (t.destinationLocationId === locationId)
          txns.push({ date: t.voucherDate, particulars: `From ${srcName}`, vchType: 'Stock Transfer',
                      voucherId: t.voucherId, inwardQty: q, inwardRate: rate, inwardValue: v,
                      outwardQty: 0, outwardRate: 0, outwardValue: 0 });
      }

      // Stock Adjustments
      const rangeAdj = await db
        .select({ voucherDate: vouchers.voucherDate, voucherId: vouchers.id,
                  quantity: stockAdjustmentItems.quantity, rate: stockAdjustmentItems.rate,
                  totalAmount: stockAdjustmentItems.totalAmount })
        .from(stockAdjustmentItems)
        .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
        .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
        .where(and(eq(stockAdjustmentItems.stockItemId, stockItemId), eq(vouchers.companyId, companyId),
                   isNull(vouchers.deletedAt), eq(vouchers.optional, false),
                   eq(stockAdjustmentVouchers.locationId, locationId),
                   sql`${vouchers.voucherDate}::date >= ${startDate}::date`,
                   sql`${vouchers.voucherDate}::date <= ${endDate}::date`))
        .orderBy(vouchers.voucherDate);
      for (const a of rangeAdj) {
        const raw = parseFloat(a.quantity), val = parseFloat(a.totalAmount);
        const q = Math.abs(raw), rate = parseFloat(a.rate), v = Math.abs(val);
        const isIn = raw > 0;
        txns.push({ date: a.voucherDate, particulars: isIn ? 'Production' : 'Consumption',
                    vchType: isIn ? 'Production' : 'Consumption', voucherId: a.voucherId,
                    inwardQty: isIn ? q : 0, inwardRate: isIn ? rate : 0, inwardValue: isIn ? val : 0,
                    outwardQty: isIn ? 0 : q, outwardRate: isIn ? 0 : rate, outwardValue: isIn ? 0 : v });
      }

      // Sales
      const rangeSales = await db
        .select({ voucherDate: vouchers.voucherDate, voucherId: vouchers.id,
                  quantity: salesItems.quantity, sellingPrice: salesItems.sellingPrice,
                  totalSales: salesItems.totalSales, costPrice: salesItems.costPrice, totalCost: salesItems.totalCost })
        .from(salesItems).innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(eq(salesItems.stockItemId, stockItemId), eq(vouchers.companyId, companyId),
                   isNull(vouchers.deletedAt), eq(vouchers.optional, false),
                   eq(vouchers.locationId, locationId),
                   sql`${vouchers.voucherDate}::date >= ${startDate}::date`,
                   sql`${vouchers.voucherDate}::date <= ${endDate}::date`))
        .orderBy(vouchers.voucherDate);
      for (const s of rangeSales) {
        txns.push({ date: s.voucherDate, particulars: 'Cash', vchType: 'POS', voucherId: s.voucherId,
                    inwardQty: 0, inwardRate: 0, inwardValue: 0,
                    outwardQty: parseFloat(s.quantity), outwardRate: 0, outwardValue: 0,
                    isPOS: true, posSellingRate: parseFloat(s.sellingPrice), posSellingValue: parseFloat(s.totalSales) });
      }

      // Container Offloads
      const rangeOffloads = await db
        .select({ offloadedAt: containerOffloads.offloadedAt, poId: purchaseOrders.id,
                  containerCode: containers.containerNumber, poNumber: purchaseOrders.poNumber,
                  quantity: poLineItems.quantity, rate: poLineItems.rate, lineTotal: poLineItems.lineTotal,
                  additionalCostPerBale: containerOffloads.additionalCostPerBale })
        .from(containerOffloads)
        .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
        .innerJoin(purchaseOrders, eq(purchaseOrders.containerId, containers.id))
        .innerJoin(poLineItems, eq(poLineItems.poId, purchaseOrders.id))
        .where(and(eq(poLineItems.stockItemId, stockItemId), eq(containers.companyId, companyId),
                   eq(containerOffloads.locationId, locationId),
                   sql`${containerOffloads.offloadedAt}::date >= ${startDate}::date`,
                   sql`${containerOffloads.offloadedAt}::date <= ${endDate}::date`))
        .orderBy(containerOffloads.offloadedAt);
      for (const o of rangeOffloads) {
        const q = parseFloat(o.quantity);
        const landedValue = parseFloat(o.lineTotal) + parseFloat(o.additionalCostPerBale) * q;
        const dateStr = o.offloadedAt instanceof Date
          ? o.offloadedAt.toISOString().split('T')[0] : String(o.offloadedAt).split('T')[0];
        txns.push({ date: dateStr, particulars: `Container: ${o.containerCode} / PO: ${o.poNumber}`,
                    vchType: 'PO Offload', voucherId: 0, poId: o.poId,
                    inwardQty: q, inwardRate: landedValue / q, inwardValue: landedValue,
                    outwardQty: 0, outwardRate: 0, outwardValue: 0 });
      }

      // Sort by date (inward before outward on same date)
      txns.sort((a, b) => {
        const d = new Date(a.date).getTime() - new Date(b.date).getTime();
        if (d !== 0) return d;
        if (a.inwardQty > 0 && b.outwardQty > 0) return -1;
        if (a.outwardQty > 0 && b.inwardQty > 0) return 1;
        return 0;
      });

      // Build running balance
      let runQty = openingQty > 0 ? openingQty : 0;
      let runValue = openingQty > 0 ? openingValue : 0;

      type TxOut = TxRaw & { closingQty: number; closingRate: number; closingValue: number; isOpeningBalance?: boolean; };
      const out: TxOut[] = [];

      if (runQty > 0 || runValue > 0) {
        out.push({ date: startDate, particulars: 'Opening Balance', vchType: '', voucherId: 0,
                   inwardQty: runQty, inwardRate: openingRate, inwardValue: runValue,
                   outwardQty: 0, outwardRate: 0, outwardValue: 0,
                   closingQty: runQty, closingRate: openingRate, closingValue: runValue, isOpeningBalance: true });
      }

      for (const t of txns) {
        const avgRate = runQty > 0 ? runValue / runQty : 0;
        runQty += t.inwardQty - t.outwardQty;
        const outCost = t.outwardQty * avgRate;
        runValue += t.inwardValue - outCost;
        const closingRate = runQty > 0 ? runValue / runQty : 0;
        out.push({ ...t, outwardRate: t.outwardQty > 0 ? avgRate : 0, outwardValue: t.outwardQty > 0 ? outCost : 0,
                   closingQty: runQty, closingRate, closingValue: runValue });
      }

      const nonOpening = out.filter(t => !t.isOpeningBalance);
      const totals = {
        inwardQty: nonOpening.reduce((s, t) => s + t.inwardQty, 0),
        inwardValue: nonOpening.reduce((s, t) => s + t.inwardValue, 0),
        outwardQty: nonOpening.reduce((s, t) => s + t.outwardQty, 0),
        outwardValue: nonOpening.reduce((s, t) => s + t.outwardValue, 0),
        closingQty: runQty, closingRate: runQty > 0 ? runValue / runQty : 0, closingValue: runValue,
        inwardRate: 0, outwardRate: 0,
      };
      totals.inwardRate = totals.inwardQty > 0 ? totals.inwardValue / totals.inwardQty : 0;
      totals.outwardRate = totals.outwardQty > 0 ? totals.outwardValue / totals.outwardQty : 0;

      res.json({ stockItem, location, startDate, endDate, transactions: out, totals });
    } catch (error: any) {
      console.error('Location stock item transactions range error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Location Summary - Matrix view of all stock groups/items across selected locations
}
