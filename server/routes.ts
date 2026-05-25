import type { Express } from "express";
import { createServer, type Server } from "http";
import { broadcast } from "./wsServer";
import multer from "multer";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "./excelHelper";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import CryptoJS from "crypto-js";
import { storage } from "./storage";
import { db } from "./db";
import { chat, saveMessage, getConversationHistory, getConversationHistoryForAI, getAllChatHistory } from "./chatService";
import { adjustInventory, reverseInventoryByExactValue } from "./inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance } from "./netPositionHelper";
import { registerFactoryRoutes } from "./routes/factoryRoutes";
import { registerFactoryWorkerRoutes } from "./routes/factoryWorkerRoutes";
import { registerFactoryPayrollRoutes } from "./routes/factoryPayrollRoutes";
import { registerFactoryReportRoutes } from "./routes/factoryReportRoutes";
import { registerFactoryIntelligenceRoutes } from "./routes/factoryIntelligenceRoutes";
import { registerFactoryAttendanceRoutes } from "./routes/factoryAttendanceRoutes";
import { registerSupplierProformaRoutes } from "./routes/supplierProformaRoutes";
import { registerAuthRoutes } from "./routes/authRoutes";
import { registerScreenFeedRoutes } from "./routes/screenFeedRoutes";
import { registerLocationRoutes } from "./routes/locationRoutes";
import { registerInventoryRoutes } from "./routes/inventoryRoutes";
import { registerLedgerRoutes } from "./routes/ledgerRoutes";
import { registerEmployeeRoutes } from "./routes/employeeRoutes";
import { registerSupplierRoutes } from "./routes/supplierRoutes";
import { registerCustomerRoutes } from "./routes/customerRoutes";
import { registerStockRoutes } from "./routes/stockRoutes";
import { registerBankAssetRoutes } from "./routes/bankAssetRoutes";
import { registerContainerRoutes } from "./routes/containerRoutes";
import { registerImportRoutes } from "./routes/importRoutes";
import { registerAccountRoutes } from "./routes/accountRoutes";
import { registerPosRoutes } from "./routes/posRoutes";
import { registerStatsRoutes } from "./routes/statsRoutes";
import { registerVoucherRoutes } from "./routes/voucherRoutes";
import { registerVoucherEntryRoutes } from "./routes/voucherEntryRoutes";
import { registerFiscalTransferRoutes } from "./routes/fiscalTransferRoutes";
import { registerReportsRoutes } from "./routes/reportsRoutes";
import { registerBaleRoutes } from "./routes/baleRoutes";
import { registerAdminRoutes } from "./routes/adminRoutes";
import { registerBalanceRepairRoutes } from "./routes/balanceRepairRoutes";
import { registerStockSummaryRoutes } from "./routes/stockSummaryRoutes";
import { registerChatbotRoutes } from "./routes/chatbotRoutes";
import { registerCreditNoteRoutes } from "./routes/creditNoteRoutes";
import { registerNetProfitExcelRoute } from "./routes/netProfitExcelRoute";
import { registerNetPositionMonthlyExcelRoute } from "./routes/netPositionMonthlyExcelRoute";
import { registerWhatsAppRoutes } from "./routes/whatsappRoutes";
import { registerImportCycleRoutes } from "./routes/importCycleRoutes";
import { registerDebugRoutes } from "./routes/debugRoutes";
import { registerExportRoutes } from "./routes/exportRoutes";
import { registerGlobalTransactionRoutes } from "./routes/globalTransactionRoutes";
import { registerGitRoutes } from "./routes/gitRoutes";
import { registerContainerTrackingRoutes } from "./routes/containerTrackingRoutes";
import { registerUserNotesRoutes } from "./routes/userNotesRoutes";
import { registerPropertiesRentalRoutes } from "./routes/propertiesRentalRoutes";
import { registerErpRentalRoutes } from "./routes/erpRentalRoutes";
import { registerFactoryRentalRoutes } from "./routes/factoryRentalRoutes";
import { registerProductionPlannerRoutes } from "./routes/factory/factoryProductionPlannerRoutes";
import { registerFactorySheetsRoutes } from "./routes/factory/factorySheetsRoutes";
import { registerFactoryStockAllocationV3Routes } from "./routes/factory/factoryStockAllocationV3Routes";
import { registerFactoryInvoiceLoadingRoutes } from "./routes/factory/factoryInvoiceLoadingRoutes";
import { registerFactoryWhatsappRoutes } from "./routes/factoryWhatsappRoutes";
import { registerEndProductionRoutes } from "./routes/factory/endProductionRoutes";
import { registerFactoryStatusBuilderRoutes } from "./routes/factory/factoryStatusBuilderRoutes";
import { registerFactoryStatusBuilderSheetsRoutes } from "./routes/factory/factoryStatusBuilderSheetsRoutes";
import { registerDispatchBatchRoutes } from "./routes/factory/factoryDispatchBatchRoutes";
import { registerSpRoutes } from "./routes/spRoutes";
import { registerSpMigrationRoutes } from "./routes/spMigrationRoutes";
import { registerAiImportRoutes } from "./routes/aiImportRoutes";
import {
  requireAuth,
  requireRole,
  canDelete,
  checkPOSLocation,
  requireNonPOS,
} from "./auth";
import {
  requireModuleAccess,
  requireActionAccess,
  requireExportAccess,
} from "./lib/permissionMiddleware";
import {
  insertLocationSchema,
  insertLedgerAccountSchema,
  updateLedgerAccountSchema,
  insertEmployeeSchema,
  insertEmployeeGroupSchema,
  insertSupplierSchema,
  insertStockGroupSchema,
  insertStockItemSchema,
  insertStockItemCodeAliasSchema,
  insertBankAccountSchema,
  insertFixedAssetSchema,
  insertContainerSchema,
  offloadRequestSchema,
  insertStockTransferVoucherSchema,
  insertStockAdjustmentVoucherSchema,
  updateStockTransferSchema,
  updateStockAdjustmentSchema,
  insertUserSchema,
  insertUserCompanyRoleSchema,
  InsertPurchaseOrder,
  insertCustomerSchema,
  insertContainerSaleSchema,
  insertInterCompanyTransferSchema,
  insertSalaryAdvanceSchema,
  insertSalaryAdvanceDeductionSchema,
  insertDraftPosSaleSchema,
  InsertDraftPosSale,
  inventory,
  stockItems,
  stockGroups,
  vouchers,
  voucherEntries,
  locations,
  salesItems,
  employees,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  stockTransferVouchers,
  stockTransferItems,
  purchaseOrders,
  poLineItems,
  containers,
  containerOffloads,
  containerOffloadItems,
  containerCharges,
  suppliers,
  fixedAssets,
  ledgerAccounts,
  bankAccounts,
  customers,
  containerSales,
  interCompanyTransfers,
  salaryAdvances,
  salaryAdvanceDeductions,
  stockItemLocationPrices,
  userPreferences,
  insertUserPreferencesSchema,
  stockItemCodeAliases,
  users,
  chatMessages,
  customerBalances,
  customerOrders,
  companySettings,
  bales,
  fiscalPeriodClosures,
  creditNoteItems,
  systemSettings,
  updateContainerTrackingSchema,
  containerTrackingImportRowSchema,
  userPresence,
  updatePresenceSchema,
  auditLog,
  insertExchangeRateSchema,
  exchangeRates,
  userLocations,
  userCompanyRoles,
  factoryBales,
  factorySuppliers,
  factoryContainers,
  factoryRawStock,
  factorySupplierPayments,
  loginHistory,
  storedFiles,
  liveSpreadsheets,
  insertLiveSpreadsheetSchema,
  erpWorkerDocs,
  insertErpWorkerDocSchema,
  factoryUserProfiles,
  erpPayrollRuns,
  erpPayrollRunItems,
  intercompanyPosConfigs,
  companies,
  wasteDispatches,
  wasteDispatchItems,
  dashboardCashAccounts,
  dashboardPayableAccounts,
  dashboardAccountSelections,
  insertDashboardCashAccountSchema,
  insertDashboardPayableAccountSchema,
  insertDashboardAccountSelectionSchema,
  insertCompanySettingsSchema,
  insertBaleSchema,
  pendingBarcodes,
  insertPendingBarcodeSchema,
  productionRawStock,
  mixBatches,
  mixBatchSources,
  insertMixBatchSourceSchema,
  baleProductCategories,
  insertBaleProductCategorySchema,
  baleProducts,
  insertBaleProductSchema,
  baleSequences,
  pressingBatches,
  productionBales,
  insertProductionBaleSchema,
  baleTransfers,
  baleTransferItems,
  referenceSequences,
  factoryBaleSequences,
  baleLabelPrints,
  factoryDaybookEntries,
  factorySettings,
  agentAccounts,
  FEATURE_KEYS,
  employeeGroups,
  employeeGroupMembers,
} from "@shared/schema";
import { z } from "zod";
import { eq, and, inArray, sql, like, ne, desc, or, isNotNull, lt, gte, lte, not, isNull, gt, ilike } from "drizzle-orm";
import { format } from "date-fns";

// Helper function to get current exchange rate for a company
async function getCurrentExchangeRate(companyId: number): Promise<string | null> {
  try {
    const company = await storage.getCompanyById(companyId);
    if (!company || !company.displayCurrency || !company.baseCurrency) {
      return null;
    }
    const rate = await storage.getLatestExchangeRate(
      companyId,
      company.baseCurrency,
      company.displayCurrency
    );
    return rate?.rate || null;
  } catch (error) {
    console.error("Error fetching exchange rate:", error);
    return null;
  }
}

// ─── Intercompany POS auto-transfer helper ────────────────────────────────────
// Called after every successful POS cash sale.  Creates/updates one consolidated
// journal voucher per company per day so the ledger stays clean.
//
// SOURCE company (e.g. GC-L'shi):
//   Dr  [sourceIntercoAccount]          full day running total
//   Cr  [cash outlet that received $$]  amount for this sale
//
// DEST company (e.g. Hadi-L'shi):
//   Dr  [matching cash outlet by name]  amount for this sale
//   Cr  [destIntercoAccount]            full day running total
//
async function runIntercompanyPosTransfer(
  sourceCompanyId: number,
  cashAccountId: number,    // ledger account id used as cash in the POS sale
  saleAmount: number,
  saleDateStr: string,       // "YYYY-MM-DD"
) {
  try {
    // 1. Load config for the source company
    const [config] = await db
      .select()
      .from(intercompanyPosConfigs)
      .where(eq(intercompanyPosConfigs.sourceCompanyId, sourceCompanyId));
    if (!config || !config.enabled) return;

    // 2. Fetch both company names for use in narrations
    const [srcCompanyRow] = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, sourceCompanyId));
    const [dstCompanyRow] = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, config.destCompanyId));
    const srcCompanyName = srcCompanyRow?.name ?? `Company ${sourceCompanyId}`;
    const dstCompanyName = dstCompanyRow?.name ?? `Company ${config.destCompanyId}`;

    // 3. Get the cash account name so we can match it in the dest company
    const [cashAccount] = await db
      .select({ name: ledgerAccounts.name })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, cashAccountId));
    if (!cashAccount) return;
    const cashName = cashAccount.name;

    // 3. Find matching cash account in dest company (exact then ilike)
    let destCashAccounts = await db
      .select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.companyId, config.destCompanyId),
          eq(ledgerAccounts.name, cashName),
        )
      );
    if (destCashAccounts.length === 0) {
      // try case-insensitive
      destCashAccounts = await db
        .select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.companyId, config.destCompanyId),
            ilike(ledgerAccounts.name, cashName),
          )
        );
    }
    const destCashAccount = destCashAccounts[0] ?? null;

    // 4. Create/update SOURCE voucher
    const srcVoucherNum = `INTERCO-SRC-${sourceCompanyId}-${saleDateStr}`;
    const srcNarration = `GC Cash transferred to ${dstCompanyName} – ${saleDateStr}`;
    await upsertIntercompanyVoucher({
      companyId: sourceCompanyId,
      voucherNumber: srcVoucherNum,
      date: saleDateStr,
      narration: srcNarration,
      debitAccountId: config.sourceIntercoAccountId,   // interco receivable
      creditAccountId: cashAccountId,                   // cash outlet
      amount: saleAmount,
    });

    // 5. Create/update DEST voucher (only if we found a matching cash account)
    if (destCashAccount) {
      const dstVoucherNum = `INTERCO-DST-${config.destCompanyId}-${saleDateStr}`;
      const dstNarration = `GC Cash transferred from ${srcCompanyName} – ${saleDateStr}`;
      await upsertIntercompanyVoucher({
        companyId: config.destCompanyId,
        voucherNumber: dstVoucherNum,
        date: saleDateStr,
        narration: dstNarration,
        debitAccountId: destCashAccount.id,             // cash outlet in dest (per-sale)
        creditAccountId: config.destIntercoAccountId,   // interco payable (running total)
        amount: saleAmount,
        debitIsRunningTotal: false,  // DEST: CR is running total, DR is per-sale cash outlet
      });
    } else {
      console.warn(`[IntercompanyPOS] Could not find cash account "${cashName}" in company ${config.destCompanyId}. Dest voucher skipped.`);
    }
  } catch (err: any) {
    console.error("[IntercompanyPOS] Auto-transfer failed:", err?.message ?? err);
  }
}

// Upsert the daily intercompany voucher for one side (source or dest).
//
// SOURCE company  (debitIsRunningTotal = true, the default):
//   One DR entry  [debitAccountId  = interco]  → running total, updated every call
//   Many CR entries [creditAccountId = cash outlet] → one per unique outlet
//
// DEST company  (debitIsRunningTotal = false):
//   Many DR entries [debitAccountId = cash outlet] → one per unique outlet, specific amount
//   One CR entry  [creditAccountId = interco]  → running total, updated every call
//
async function upsertIntercompanyVoucher(opts: {
  companyId: number;
  voucherNumber: string;
  date: string;
  narration: string;
  debitAccountId: number;
  creditAccountId: number;
  amount: number;
  debitIsRunningTotal?: boolean;   // true = SOURCE (default), false = DEST
}) {
  const {
    companyId, voucherNumber, date, narration,
    debitAccountId, creditAccountId, amount,
  } = opts;
  const debitIsRunningTotal = opts.debitIsRunningTotal ?? true;

  // Find existing daily voucher
  const [existing] = await db
    .select()
    .from(vouchers)
    .where(
      and(
        eq(vouchers.companyId, companyId),
        eq(vouchers.voucherNumber, voucherNumber),
      )
    );

  if (existing) {
    // Update description in case narration format changed
    await db
      .update(vouchers)
      .set({ description: narration })
      .where(eq(vouchers.id, existing.id));

    const entries = await db
      .select()
      .from(voucherEntries)
      .where(eq(voucherEntries.voucherId, existing.id));

    if (debitIsRunningTotal) {
      // ── SOURCE MODE ───────────────────────────────────────────────────────
      // CR side = per-sale cash outlet (many accounts, one entry each)
      // DR side = single interco account, always the running total of all CRs

      // 1. Find or insert CR entry for this cash outlet
      const existingCrEntry = entries.find(
        (e) => e.ledgerAccountId === creditAccountId && parseFloat(e.creditAmount ?? "0") > 0
      );
      if (existingCrEntry) {
        const newCr = (parseFloat(existingCrEntry.creditAmount ?? "0") + amount).toFixed(2);
        await db
          .update(voucherEntries)
          .set({ creditAmount: newCr })
          .where(eq(voucherEntries.id, existingCrEntry.id));
      } else {
        await db.insert(voucherEntries).values({
          voucherId: existing.id,
          ledgerAccountId: creditAccountId,
          debitAmount: "0",
          creditAmount: amount.toFixed(2),
          narration,
        });
      }

      // 2. Re-fetch and recalculate running total, then update the single DR entry
      const refreshed = await db
        .select()
        .from(voucherEntries)
        .where(eq(voucherEntries.voucherId, existing.id));
      const totalCr = refreshed
        .filter((e) => e.ledgerAccountId !== debitAccountId)
        .reduce((s, e) => s + parseFloat(e.creditAmount ?? "0"), 0);

      const existingDrEntry = refreshed.find(
        (e) => e.ledgerAccountId === debitAccountId && parseFloat(e.debitAmount ?? "0") > 0
      );
      if (existingDrEntry) {
        await db
          .update(voucherEntries)
          .set({ debitAmount: totalCr.toFixed(2) })
          .where(eq(voucherEntries.id, existingDrEntry.id));
      } else {
        await db.insert(voucherEntries).values({
          voucherId: existing.id,
          ledgerAccountId: debitAccountId,
          debitAmount: totalCr.toFixed(2),
          creditAmount: "0",
          narration,
        });
      }
      // Keep voucher totalAmount in sync with the running total
      await db.update(vouchers).set({ totalAmount: totalCr.toFixed(2) }).where(eq(vouchers.id, existing.id));
    } else {
      // ── DEST MODE ─────────────────────────────────────────────────────────
      // DR side = per-sale cash outlet (many accounts, one entry each, specific amount)
      // CR side = single interco account, always the running total of all DRs

      // 1. Find or insert DR entry for this cash outlet (specific amount, not running total)
      const existingDrEntry = entries.find(
        (e) => e.ledgerAccountId === debitAccountId && parseFloat(e.debitAmount ?? "0") > 0
      );
      if (existingDrEntry) {
        const newDr = (parseFloat(existingDrEntry.debitAmount ?? "0") + amount).toFixed(2);
        await db
          .update(voucherEntries)
          .set({ debitAmount: newDr })
          .where(eq(voucherEntries.id, existingDrEntry.id));
      } else {
        await db.insert(voucherEntries).values({
          voucherId: existing.id,
          ledgerAccountId: debitAccountId,
          debitAmount: amount.toFixed(2),
          creditAmount: "0",
          narration,
        });
      }

      // 2. Re-fetch and recalculate running total, then update the single CR entry
      const refreshed = await db
        .select()
        .from(voucherEntries)
        .where(eq(voucherEntries.voucherId, existing.id));
      const totalDr = refreshed
        .filter((e) => e.ledgerAccountId !== creditAccountId)
        .reduce((s, e) => s + parseFloat(e.debitAmount ?? "0"), 0);

      const existingCrEntry = refreshed.find(
        (e) => e.ledgerAccountId === creditAccountId && parseFloat(e.creditAmount ?? "0") > 0
      );
      if (existingCrEntry) {
        await db
          .update(voucherEntries)
          .set({ creditAmount: totalDr.toFixed(2) })
          .where(eq(voucherEntries.id, existingCrEntry.id));
      } else {
        await db.insert(voucherEntries).values({
          voucherId: existing.id,
          ledgerAccountId: creditAccountId,
          debitAmount: "0",
          creditAmount: totalDr.toFixed(2),
          narration,
        });
      }
      // Keep voucher totalAmount in sync with the running total
      await db.update(vouchers).set({ totalAmount: totalDr.toFixed(2) }).where(eq(vouchers.id, existing.id));
    }
  } else {
    // ── CREATE new voucher with initial two entries ────────────────────────
    const [newVoucher] = await db
      .insert(vouchers)
      .values({
        companyId,
        voucherNumber,
        voucherType: "Journal",
        description: narration,
        voucherDate: date,
        totalAmount: amount.toFixed(2),
        sourceModule: "ERP",
      })
      .returning();

    await db.insert(voucherEntries).values({
      voucherId: newVoucher.id,
      ledgerAccountId: debitAccountId,
      debitAmount: amount.toFixed(2),
      creditAmount: "0",
      narration,
    });
    await db.insert(voucherEntries).values({
      voucherId: newVoucher.id,
      ledgerAccountId: creditAccountId,
      debitAmount: "0",
      creditAmount: amount.toFixed(2),
      narration,
    });
  }
}

// Helper function to calculate historical inventory for a specific location as of a given date
async function calculateHistoricalLocationInventory(
  locationId: number,
  companyId: number,
  asOfDate: string
): Promise<any[]> {
  // Use the date string directly for DATE column comparisons
  // Use Date object only for TIMESTAMP columns (offloadedAt)
  const cutoffDateStr = asOfDate; // For vouchers.voucherDate (DATE type)
  const cutoffTimestamp = new Date(asOfDate + 'T23:59:59.999'); // For containerOffloads.offloadedAt (TIMESTAMP type)
  
  // STEP 1: Build seed set of ALL stockItemIds that ever existed at this location
  const seedStockItemIds = new Set<number>();

  // 1a. From current inventory
  const currentInventory = await db
    .select({
      stockItemId: inventory.stockItemId,
      quantity: inventory.quantity,
      averageRate: inventory.averageRate,
    })
    .from(inventory)
    .where(
      and(
        eq(inventory.locationId, locationId),
        eq(inventory.companyId, companyId)
      )
    )
    .execute();

  for (const inv of currentInventory) {
    seedStockItemIds.add(inv.stockItemId);
  }

  // 1b. From sales at this location (any time)
  const salesStockItems = await db
    .selectDistinct({ stockItemId: salesItems.stockItemId })
    .from(salesItems)
    .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
    .where(
      and(
        eq(vouchers.companyId, companyId),
        eq(vouchers.locationId, locationId)
      )
    )
    .execute();

  for (const item of salesStockItems) {
    seedStockItemIds.add(item.stockItemId);
  }

  // 1c. From container offloads at this location (any time) - WITH company filter
  const offloadStockItems = await db
    .selectDistinct({ stockItemId: containerOffloadItems.stockItemId })
    .from(containerOffloadItems)
    .innerJoin(containerOffloads, eq(containerOffloadItems.offloadId, containerOffloads.id))
    .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
    .where(
      and(
        eq(containers.companyId, companyId),
        eq(containerOffloads.locationId, locationId)
      )
    )
    .execute();

  for (const item of offloadStockItems) {
    seedStockItemIds.add(item.stockItemId);
  }

  // 1d. From stock adjustments at this location (any time)
  const adjustmentStockItems = await db
    .selectDistinct({ stockItemId: stockAdjustmentItems.stockItemId })
    .from(stockAdjustmentItems)
    .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
    .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
    .where(
      and(
        eq(vouchers.companyId, companyId),
        eq(stockAdjustmentVouchers.locationId, locationId)
      )
    )
    .execute();

  for (const item of adjustmentStockItems) {
    seedStockItemIds.add(item.stockItemId);
  }

  // 1e. From transfers INTO this location (destination on voucher level)
  const transfersInStockItems = await db
    .selectDistinct({ stockItemId: stockTransferItems.stockItemId })
    .from(stockTransferItems)
    .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
    .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
    .where(
      and(
        eq(vouchers.companyId, companyId),
        eq(stockTransferVouchers.destinationLocationId, locationId)
      )
    )
    .execute();

  for (const item of transfersInStockItems) {
    seedStockItemIds.add(item.stockItemId);
  }

  // 1f. From transfers OUT of this location (source on item level)
  const transfersOutStockItems = await db
    .selectDistinct({ stockItemId: stockTransferItems.stockItemId })
    .from(stockTransferItems)
    .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
    .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
    .where(
      and(
        eq(vouchers.companyId, companyId),
        eq(stockTransferItems.sourceLocationId, locationId)
      )
    )
    .execute();

  for (const item of transfersOutStockItems) {
    seedStockItemIds.add(item.stockItemId);
  }

  const finalSeedCount = seedStockItemIds.size;

  if (finalSeedCount === 0) {
    return [];
  }

  // STEP 2: Initialize inventoryMap with all seeded items at zero
  const inventoryMap = new Map<number, { quantity: number; totalValue: number; rate: number }>();
  
  for (const stockItemId of Array.from(seedStockItemIds)) {
    inventoryMap.set(stockItemId, { quantity: 0, totalValue: 0, rate: 0 });
  }

  // STEP 3: Overlay current inventory values
  for (const inv of currentInventory) {
    const qty = parseFloat(inv.quantity) || 0;
    const rate = parseFloat(inv.averageRate) || 0;
    inventoryMap.set(inv.stockItemId, { quantity: qty, totalValue: qty * rate, rate });
  }

  // STEP 4: Add back sales that occurred AFTER the target date
  const salesAfterDate = await db
    .select({
      stockItemId: salesItems.stockItemId,
      quantity: salesItems.quantity,
      costPrice: salesItems.costPrice,
    })
    .from(salesItems)
    .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
    .where(
      and(
        eq(vouchers.companyId, companyId),
        eq(vouchers.locationId, locationId),
        eq(vouchers.optional, false),
        sql`${vouchers.voucherDate} > ${cutoffDateStr}`
      )
    )
    .execute();

  for (const sale of salesAfterDate) {
    const qty = parseFloat(sale.quantity) || 0;
    const cost = parseFloat(sale.costPrice) || 0;
    const existing = inventoryMap.get(sale.stockItemId) || { quantity: 0, totalValue: 0, rate: 0 };
    existing.quantity += qty;
    existing.totalValue += qty * cost;
    if (existing.quantity > 0) existing.rate = existing.totalValue / existing.quantity;
    inventoryMap.set(sale.stockItemId, existing);
  }

  // STEP 5: Reverse stock adjustments AFTER the target date
  const adjustmentsAfterDate = await db
    .select({
      stockItemId: stockAdjustmentItems.stockItemId,
      quantity: stockAdjustmentItems.quantity,
      rate: stockAdjustmentItems.rate,
      adjustmentType: stockAdjustmentVouchers.adjustmentType,
    })
    .from(stockAdjustmentItems)
    .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
    .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
    .where(
      and(
        eq(vouchers.companyId, companyId),
        eq(stockAdjustmentVouchers.locationId, locationId),
        eq(vouchers.optional, false),
        sql`${vouchers.voucherDate} > ${cutoffDateStr}`
      )
    )
    .execute();

  for (const adj of adjustmentsAfterDate) {
    const qty = parseFloat(adj.quantity) || 0;
    const rate = parseFloat(adj.rate) || 0;
    const existing = inventoryMap.get(adj.stockItemId) || { quantity: 0, totalValue: 0, rate: 0 };
    const adjType = (adj.adjustmentType || '').toLowerCase().trim();
    
    if (adjType === 'production' || adjType === 'produce') {
      existing.quantity -= qty;
      existing.totalValue -= qty * rate;
    } else {
      existing.quantity += qty;
      existing.totalValue += qty * rate;
    }
    if (existing.quantity > 0) existing.rate = existing.totalValue / existing.quantity;
    inventoryMap.set(adj.stockItemId, existing);
  }

  // STEP 6: Reverse stock transfers AFTER the target date
  // Transfers INTO this location - subtract
  const transfersInAfterDate = await db
    .select({
      stockItemId: stockTransferItems.stockItemId,
      quantity: stockTransferItems.quantity,
      rate: stockTransferItems.rate,
    })
    .from(stockTransferItems)
    .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
    .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
    .where(
      and(
        eq(vouchers.companyId, companyId),
        eq(stockTransferVouchers.destinationLocationId, locationId),
        eq(vouchers.optional, false),
        sql`${vouchers.voucherDate} > ${cutoffDateStr}`
      )
    )
    .execute();

  for (const transfer of transfersInAfterDate) {
    const qty = parseFloat(transfer.quantity) || 0;
    const rate = parseFloat(transfer.rate) || 0;
    const existing = inventoryMap.get(transfer.stockItemId) || { quantity: 0, totalValue: 0, rate: 0 };
    existing.quantity -= qty;
    existing.totalValue -= qty * rate;
    if (existing.quantity > 0) existing.rate = existing.totalValue / existing.quantity;
    inventoryMap.set(transfer.stockItemId, existing);
  }

  // Transfers OUT of this location - add back (source on item level)
  const transfersOutAfterDate = await db
    .select({
      stockItemId: stockTransferItems.stockItemId,
      quantity: stockTransferItems.quantity,
      rate: stockTransferItems.rate,
    })
    .from(stockTransferItems)
    .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
    .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
    .where(
      and(
        eq(vouchers.companyId, companyId),
        eq(stockTransferItems.sourceLocationId, locationId),
        eq(vouchers.optional, false),
        sql`${vouchers.voucherDate} > ${cutoffDateStr}`
      )
    )
    .execute();

  for (const transfer of transfersOutAfterDate) {
    const qty = parseFloat(transfer.quantity) || 0;
    const rate = parseFloat(transfer.rate) || 0;
    const existing = inventoryMap.get(transfer.stockItemId) || { quantity: 0, totalValue: 0, rate: 0 };
    existing.quantity += qty;
    existing.totalValue += qty * rate;
    if (existing.quantity > 0) existing.rate = existing.totalValue / existing.quantity;
    inventoryMap.set(transfer.stockItemId, existing);
  }

  // STEP 7: Reverse container offloads AFTER the target date (use timestamp comparison)
  const offloadsAfterDate = await db
    .select({
      stockItemId: containerOffloadItems.stockItemId,
      quantity: containerOffloadItems.quantity,
      rate: containerOffloadItems.rate,
    })
    .from(containerOffloadItems)
    .innerJoin(containerOffloads, eq(containerOffloadItems.offloadId, containerOffloads.id))
    .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
    .where(
      and(
        eq(containers.companyId, companyId),
        eq(containerOffloads.locationId, locationId),
        gt(containerOffloads.offloadedAt, cutoffTimestamp)
      )
    )
    .execute();

  for (const offload of offloadsAfterDate) {
    const qty = parseFloat(offload.quantity) || 0;
    const cost = parseFloat(offload.rate) || 0;
    const existing = inventoryMap.get(offload.stockItemId) || { quantity: 0, totalValue: 0, rate: 0 };
    existing.quantity -= qty;
    existing.totalValue -= qty * cost;
    if (existing.quantity > 0) existing.rate = existing.totalValue / existing.quantity;
    inventoryMap.set(offload.stockItemId, existing);
  }

  // Count nonzero items
  let nonzeroCount = 0;
  for (const [, data] of Array.from(inventoryMap)) {
    if (data.quantity !== 0) nonzeroCount++;
  }

  // STEP 8: Build the result array
  const stockItemDetails = await db
    .select({
      id: stockItems.id,
      code: stockItems.code,
      name: stockItems.name,
      uom: stockItems.uom,
      stockGroupId: stockItems.stockGroupId,
      stockGroupName: stockGroups.name,
      stockGroupCode: stockGroups.code,
    })
    .from(stockItems)
    .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
    .where(eq(stockItems.companyId, companyId))
    .execute();

  const stockItemMap = new Map(stockItemDetails.map(item => [item.id, item]));

  const result: any[] = [];
  for (const [stockItemId, data] of Array.from(inventoryMap)) {
    const itemDetails = stockItemMap.get(stockItemId);
    if (itemDetails) {
      result.push({
        inventoryId: 0,
        locationId,
        stockItemId,
        quantity: data.quantity.toFixed(3),
        averageRate: data.rate.toFixed(2),
        totalValue: data.totalValue.toFixed(2),
        stockItemCode: itemDetails.code,
        stockItemName: itemDetails.name,
        stockItemUom: itemDetails.uom,
        stockGroupId: itemDetails.stockGroupId,
        stockGroupName: itemDetails.stockGroupName,
        stockGroupCode: itemDetails.stockGroupCode,
      });
    }
  }

  return result;
}

// Audit logging helper function
async function logAudit(params: {
  userId: string;
  username: string;
  companyId?: number | null;
  action: "create" | "update" | "delete";
  tableName: string;
  recordId?: number | null;
  recordIdentifier?: string | null;
  changes?: Record<string, { old: any; new: any }> | null;
}) {
  try {
    await db.insert(auditLog).values({
      userId: params.userId,
      username: params.username,
      companyId: params.companyId,
      action: params.action,
      tableName: params.tableName,
      recordId: params.recordId,
      recordIdentifier: params.recordIdentifier,
      changes: params.changes,
    });
  } catch (error) {
    console.error("Error logging audit:", error);
    throw error; // Rethrow to ensure audit failures are not silently ignored
  }
}

// Configure multer with file size limit (10MB) to prevent memory exhaustion
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
});

// Bcrypt configuration
const BCRYPT_SALT_ROUNDS = 12;

// Helper function to hash passwords with bcrypt (async)
async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

// Check if a hash is a legacy SHA256 hash
function isLegacySHA256Hash(hash: string): boolean {
  return hash.length === 64 && /^[a-f0-9]+$/i.test(hash);
}

// Verify password using legacy SHA256 (for migration)
// Normalize case since some hashes may be stored uppercase
function verifyLegacyPassword(password: string, hash: string): boolean {
  const sha256Hash = CryptoJS.SHA256(password).toString().toLowerCase();
  return sha256Hash === (hash || "").toLowerCase();
}

// Helper function to verify password against hash
async function verifyPassword(password: string, hash: string): Promise<{ valid: boolean; needsMigration: boolean }> {
  // Handle legacy SHA256 hashes (for backward compatibility during migration)
  if (isLegacySHA256Hash(hash)) {
    // Verify using legacy SHA256
    const isValid = verifyLegacyPassword(password, hash);
    return { valid: isValid, needsMigration: isValid }; // Flag for migration if valid
  }
  // Use bcrypt for new hashes
  const isValid = await bcrypt.compare(password, hash);
  return { valid: isValid, needsMigration: false };
}

// Helper function to sync employee payroll balances from voucher entries
// Handles both:
// 1. Entries with ledgerAccountId pointing to EMP-* accounts
// 2. Entries with employeeId set directly
// When debited, decrease balance; when credited, increase balance
async function syncEmployeeBalancesFromEntries(
  entries: Array<{ 
    ledgerAccountId: number | null; 
    employeeId?: number | null;
    debitAmount: string | null; 
    creditAmount: string | null;
  }>,
  companyId: number,
  reverse: boolean = false
): Promise<void> {
  // Get all ledger accounts for the company to find EMP-* accounts
  const allAccounts = await storage.getAllLedgerAccounts(companyId);
  
  // Find employee accounts (code starts with EMP-)
  const employeeAccountMap = new Map<number, { code: string; employeeCode: string }>();
  for (const account of allAccounts) {
    if (account.code && account.code.startsWith("EMP-")) {
      const employeeCode = account.code.replace("EMP-", "");
      employeeAccountMap.set(account.id, { code: account.code, employeeCode });
    }
  }
  
  // Track balance changes AND deposits/withdrawals per employee
  // deposits = sum of credits, withdrawals = sum of debits
  const employeeChangesById = new Map<number, { balanceChange: number; deposits: number; withdrawals: number }>();
  const employeeChangesByCode = new Map<string, { balanceChange: number; deposits: number; withdrawals: number }>();
  
  for (const entry of entries) {
    const debit = parseFloat(entry.debitAmount || "0");
    const credit = parseFloat(entry.creditAmount || "0");
    
    // Balance change:
    // - Debit to employee account = decrease balance (money going out/payment to employee)
    // - Credit to employee account = increase balance (owed to employee)
    // When reversing (e.g., deleting voucher), flip the balance change sign
    let balanceChange = credit - debit;
    if (reverse) {
      balanceChange = -balanceChange;
    }
    
    // Deposits/Withdrawals track raw amounts:
    // - Forward: deposits += credit, withdrawals += debit
    // - Reverse: deposits -= credit, withdrawals -= debit
    const depositChange = reverse ? -credit : credit;
    const withdrawalChange = reverse ? -debit : debit;
    
    // Check if entry has direct employeeId
    if (entry.employeeId) {
      const current = employeeChangesById.get(entry.employeeId) || { balanceChange: 0, deposits: 0, withdrawals: 0 };
      employeeChangesById.set(entry.employeeId, {
        balanceChange: current.balanceChange + balanceChange,
        deposits: current.deposits + depositChange,
        withdrawals: current.withdrawals + withdrawalChange
      });
      continue;
    }
    
    // Check if entry has ledgerAccountId pointing to EMP-* account
    if (entry.ledgerAccountId) {
      const employeeAccount = employeeAccountMap.get(entry.ledgerAccountId);
      if (employeeAccount) {
        const current = employeeChangesByCode.get(employeeAccount.employeeCode) || { balanceChange: 0, deposits: 0, withdrawals: 0 };
        employeeChangesByCode.set(employeeAccount.employeeCode, {
          balanceChange: current.balanceChange + balanceChange,
          deposits: current.deposits + depositChange,
          withdrawals: current.withdrawals + withdrawalChange
        });
      }
    }
  }
  
  // Apply balance changes for direct employee entries (by ID)
  for (const [employeeId, changes] of Array.from(employeeChangesById.entries())) {
    if (changes.balanceChange === 0 && changes.deposits === 0 && changes.withdrawals === 0) continue;
    
    const employee = await storage.getEmployeeById(employeeId);
    if (!employee) continue;
    
    const currentBalance = parseFloat(employee.currentBalance || "0");
    const newBalance = currentBalance + changes.balanceChange;
    
    const currentDeposits = parseFloat(employee.totalDeposits || "0");
    const currentWithdrawals = parseFloat(employee.totalWithdrawals || "0");
    
    // Apply changes - use Math.max(0, ...) only to prevent floating point errors from causing negatives
    const newDeposits = Math.max(0, currentDeposits + changes.deposits);
    const newWithdrawals = Math.max(0, currentWithdrawals + changes.withdrawals);
    
    const updateData: any = { 
      currentBalance: newBalance.toFixed(2),
      totalDeposits: newDeposits.toFixed(2),
      totalWithdrawals: newWithdrawals.toFixed(2)
    };
    
    await db.update(employees).set(updateData).where(eq(employees.id, employee.id));
  }
  
  // Apply balance changes for ledger account entries (by code)
  for (const [employeeCode, changes] of Array.from(employeeChangesByCode.entries())) {
    if (changes.balanceChange === 0 && changes.deposits === 0 && changes.withdrawals === 0) continue;
    
    const employee = await storage.getEmployeeByCode(employeeCode);
    if (!employee) continue;
    
    const currentBalance = parseFloat(employee.currentBalance || "0");
    const newBalance = currentBalance + changes.balanceChange;
    
    const currentDeposits = parseFloat(employee.totalDeposits || "0");
    const currentWithdrawals = parseFloat(employee.totalWithdrawals || "0");
    
    // Apply changes - use Math.max(0, ...) only to prevent floating point errors from causing negatives
    const newDeposits = Math.max(0, currentDeposits + changes.deposits);
    const newWithdrawals = Math.max(0, currentWithdrawals + changes.withdrawals);
    
    const updateData: any = { 
      currentBalance: newBalance.toFixed(2),
      totalDeposits: newDeposits.toFixed(2),
      totalWithdrawals: newWithdrawals.toFixed(2)
    };
    
    await db.update(employees).set(updateData).where(eq(employees.id, employee.id));
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Broadcast a cache-invalidation signal to all WS clients after any successful write
  app.use((req, res, next) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      res.on("finish", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          broadcast({ type: "invalidate" });
        }
      });
    }
    next();
  });

  // ─── Phase 3: Module-level permission enforcement ────────────────────────────
  // Must be registered BEFORE individual route handlers so the middleware fires
  // first on every matching request.
  // Semantics (per permissionHelpers.ts):
  //   Developer/Admin  → always allowed
  //   Owner/Manager/POS → allowed by default; explicit enabled=false = restricted
  //   Normal User       → denied by default; explicit enabled=true = allowed
  // Unauthenticated requests pass through (session has no userId); per-route
  // requireAuth will return 401 as normal.

  // Factory module
  app.use("/api/factory", requireModuleAccess("mod_factory"));

  // POS module (also covers /api/pos/price-list from stockRoutes)
  app.use("/api/pos", requireModuleAccess("mod_pos"));

  // Properties / Rentals module
  app.use("/api/properties", requireModuleAccess("mod_properties"));

  // ERP module: customers, suppliers, employees, purchase orders, ERP rental
  for (const p of ["/api/customers", "/api/suppliers", "/api/employees",
                   "/api/purchase-orders", "/api/erp"]) {
    app.use(p, requireModuleAccess("mod_erp"));
  }

  // Accounting module: vouchers, accounts, ledger, bank accounts, fiscal
  for (const p of [
    "/api/vouchers", "/api/voucher-entries", "/api/voucher-detail",
    "/api/accounts",  "/api/ledger-accounts",
    "/api/bank-accounts", "/api/fixed-assets",
    "/api/fiscal-period", "/api/financial",
    "/api/credit-notes",
  ]) {
    app.use(p, requireModuleAccess("mod_accounting"));
  }

  // Inventory module: stock, bales, containers, locations, transfers
  for (const p of [
    "/api/inventory", "/api/stock-items", "/api/stock-groups",
    "/api/bales", "/api/containers",
    "/api/locations", "/api/pending-barcodes",
    "/api/stock-transfers", "/api/stock-transfer-revisions",
    "/api/stock-summary", "/api/offload-item-search",
    "/api/location-price-groups",
  ]) {
    app.use(p, requireModuleAccess("mod_inventory"));
  }

  // Analytics module: reports, stats, dashboard data
  for (const p of [
    "/api/reports", "/api/stats",
    "/api/dashboard", "/api/sales-report",
  ]) {
    app.use(p, requireModuleAccess("mod_analytics"));
  }

  // ─── Action-level guards (write operations) ──────────────────────────────────
  // These fire before the actual route handler via Express middleware chaining.
  // The action middleware calls next() on success, so the real handler still runs.

  // Create / edit vouchers (journals, purchases, payments)
  app.post("/api/vouchers",          requireActionAccess("act_create_voucher"));
  app.put( "/api/vouchers/:id/with-entries", requireActionAccess("act_create_voucher"));

  // Void / cancel sales
  app.patch("/api/vouchers/:id/sales", requireActionAccess("act_void_sale"));

  // Stock adjustments (manual inventory corrections)
  app.post("/api/inventory/quick-adjust", requireActionAccess("act_adjust_stock"));

  // Stock transfers (approve / create revision)
  app.post("/api/stock-transfer-revisions/:id/approve", requireActionAccess("act_transfer_stock"));

  // Import data operations
  for (const p of [
    "/api/stock-items/import-opening-balances",
    "/api/bales/import",
    "/api/factory/workers/import-excel",
    "/api/containers/tracking/import",
  ]) {
    app.post(p, requireActionAccess("act_import_data"));
  }

  // Bulk operations (mass-edit / mass-delete)
  for (const p of [
    "/api/stock-items/bulk-delete",
    "/api/stock-items/bulk-update-prices",
    "/api/stock-items/bulk-update-uom",
    "/api/stock-items/bulk-rename",
    "/api/vouchers/bulk-delete",
  ]) {
    app.post(p, requireActionAccess("act_bulk_operations"));
  }

  // Export endpoints (PDF / Excel download tools)
  for (const p of [
    "/api/factory/payroll/export-pdf",
    "/api/factory/payroll/export-excel",
    "/api/stats/net-position-excel",
    "/api/accounts/:type/:id/statement-pdf",
  ]) {
    app.use(p, requireExportAccess("exp_pdf"));
  }

  // ─── End Phase 3 guards ──────────────────────────────────────────────────────

  registerFactoryRoutes(app, requireAuth, db);
  registerFactoryWorkerRoutes(app, requireAuth, db);
  registerFactoryPayrollRoutes(app, requireAuth, db);
  registerFactoryReportRoutes(app, requireAuth, db);
  registerFactoryIntelligenceRoutes(app, requireAuth, db);
  registerFactoryAttendanceRoutes(app, requireAuth, db);
  registerSupplierProformaRoutes(app, requireAuth);
  registerGlobalTransactionRoutes(app, requireAuth);
  registerPropertiesRentalRoutes(app);
  registerErpRentalRoutes(app);
  registerFactoryRentalRoutes(app);
  registerProductionPlannerRoutes(app);
  registerFactorySheetsRoutes(app);
  registerFactoryStockAllocationV3Routes(app);
  registerFactoryInvoiceLoadingRoutes(app);
  registerFactoryWhatsappRoutes(app, requireAuth);
  registerEndProductionRoutes(app, requireAuth);
  registerFactoryStatusBuilderRoutes(app);
  registerFactoryStatusBuilderSheetsRoutes(app);
  registerDispatchBatchRoutes(app);

  // Lightweight health check for offline ping detection
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // Database health check endpoint
  app.get("/api/health/db", async (_req, res) => {
    try {
      const result = await db.execute(sql`SELECT 1 as test`);
      res.json({ status: "ok", message: "Database connection successful" });
    } catch (error: any) {
      console.error("Database connection failed:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  registerAuthRoutes(app);
  registerScreenFeedRoutes(app);

  // Locations
  registerLocationRoutes(app);
  // Locations
  registerInventoryRoutes(app);
  registerLedgerRoutes(app);
  registerEmployeeRoutes(app);
  registerSupplierRoutes(app);
  registerCustomerRoutes(app);
  app.get("/api/intercompany-pos-config", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const [config] = await db.select().from(intercompanyPosConfigs).where(eq(intercompanyPosConfigs.sourceCompanyId, companyId));
      res.json(config || null);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/intercompany-pos-config", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { destCompanyId, sourceIntercoAccountId, destIntercoAccountId, enabled } = req.body;
      if (!destCompanyId || !sourceIntercoAccountId || !destIntercoAccountId) {
        return res.status(400).json({ message: "destCompanyId, sourceIntercoAccountId, and destIntercoAccountId are required" });
      }
      const [existing] = await db.select().from(intercompanyPosConfigs).where(eq(intercompanyPosConfigs.sourceCompanyId, companyId));
      if (existing) {
        const [updated] = await db.update(intercompanyPosConfigs).set({
          destCompanyId: parseInt(destCompanyId),
          sourceIntercoAccountId: parseInt(sourceIntercoAccountId),
          destIntercoAccountId: parseInt(destIntercoAccountId),
          enabled: enabled !== false,
          updatedAt: new Date(),
        }).where(eq(intercompanyPosConfigs.sourceCompanyId, companyId)).returning();
        return res.json(updated);
      } else {
        const [created] = await db.insert(intercompanyPosConfigs).values({
          sourceCompanyId: companyId,
          destCompanyId: parseInt(destCompanyId),
          sourceIntercoAccountId: parseInt(sourceIntercoAccountId),
          destIntercoAccountId: parseInt(destIntercoAccountId),
          enabled: enabled !== false,
        }).returning();
        return res.status(201).json(created);
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get ledger accounts for any company (for config UI)
  app.get("/api/intercompany-pos-config/dest-accounts", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const { companyId } = req.query;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const accounts = await storage.getAllLedgerAccounts(parseInt(companyId as string));
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── ERP Worker Docs (fully isolated from Factory docs) ─────────────────────

  app.get("/api/employees/:id/docs", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const employeeId = parseInt(req.params.id);
      if (isNaN(employeeId)) return res.status(400).json({ message: "Invalid employee ID" });
      const docs = await db
        .select({ id: erpWorkerDocs.id, employeeId: erpWorkerDocs.employeeId, companyId: erpWorkerDocs.companyId,
          fileName: erpWorkerDocs.fileName, fileType: erpWorkerDocs.fileType, fileSize: erpWorkerDocs.fileSize,
          description: erpWorkerDocs.description, uploadedBy: erpWorkerDocs.uploadedBy, uploadedAt: erpWorkerDocs.uploadedAt })
        .from(erpWorkerDocs)
        .where(and(eq(erpWorkerDocs.companyId, companyId), eq(erpWorkerDocs.employeeId, employeeId)))
        .orderBy(desc(erpWorkerDocs.uploadedAt));
      res.json(docs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/employees/:id/docs", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const employeeId = parseInt(req.params.id);
      if (isNaN(employeeId)) return res.status(400).json({ message: "Invalid employee ID" });
      const parsed = insertErpWorkerDocSchema.parse({ ...req.body, companyId, employeeId });
      const [doc] = await db.insert(erpWorkerDocs).values(parsed).returning();
      res.status(201).json(doc);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/erp-worker-docs/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const docId = parseInt(req.params.id);
      if (isNaN(docId)) return res.status(400).json({ message: "Invalid doc ID" });
      const [existing] = await db.select().from(erpWorkerDocs).where(and(eq(erpWorkerDocs.id, docId), eq(erpWorkerDocs.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Document not found" });
      const { description, fileName } = req.body;
      const [updated] = await db.update(erpWorkerDocs).set({ description, fileName }).where(eq(erpWorkerDocs.id, docId)).returning();
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/erp-worker-docs/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const docId = parseInt(req.params.id);
      if (isNaN(docId)) return res.status(400).json({ message: "Invalid doc ID" });
      const [existing] = await db.select().from(erpWorkerDocs).where(and(eq(erpWorkerDocs.id, docId), eq(erpWorkerDocs.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Document not found" });
      await db.delete(erpWorkerDocs).where(eq(erpWorkerDocs.id, docId));
      res.json({ message: "Document deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/erp-worker-docs/:id/download", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const docId = parseInt(req.params.id);
      if (isNaN(docId)) return res.status(400).json({ message: "Invalid doc ID" });
      const [doc] = await db.select().from(erpWorkerDocs).where(and(eq(erpWorkerDocs.id, docId), eq(erpWorkerDocs.companyId, companyId)));
      if (!doc) return res.status(404).json({ message: "Document not found" });
      const base64Data = doc.fileData.split(",").pop() || doc.fileData;
      const buffer = Buffer.from(base64Data, "base64");
      res.set("Content-Type", doc.fileType);
      res.set("Content-Disposition", `attachment; filename="${doc.fileName}"`);
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────

  // Salary Advances
  app.get(
    "/api/salary-advances",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }
        const advances = await storage.getAllSalaryAdvances(
          req.session.currentCompanyId,
        );
        res.json(advances);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  app.get(
    "/api/salary-advances/employee/:employeeId",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const employeeId = parseInt(req.params.employeeId);
        if (isNaN(employeeId)) {
          return res.status(400).json({ message: "Invalid employee ID" });
        }

        const advances = await storage.getSalaryAdvancesByEmployee(employeeId);
        res.json(advances);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  app.post(
    "/api/salary-advances",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Inject companyId before schema validation
        const dataWithCompany = {
          ...req.body,
          companyId: req.session.currentCompanyId,
          remainingBalance: req.body.amount, // Initially, remaining balance equals full amount
          isOpeningBalance: req.body.isOpeningBalance || false,
        };

        const parsed = insertSalaryAdvanceSchema.parse(dataWithCompany);

        // Verify employee exists and belongs to current company
        const employee = await db
          .select()
          .from(employees)
          .where(eq(employees.id, parsed.employeeId))
          .limit(1);

        if (!employee || employee.length === 0) {
          return res.status(404).json({ message: "Employee not found" });
        }

        if (employee[0].companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({ message: "Employee belongs to a different company" });
        }

        let voucherId: number | null = null;

        // Only create cash voucher if NOT an opening balance
        if (!parsed.isOpeningBalance) {
          // Get default cash account from request or use a default one
          const cashAccountId =
            req.body.cashAccountId || req.session.cashAccountId;
          if (!cashAccountId) {
            return res.status(400).json({ message: "Cash account is required" });
          }

          // Create voucher for the salary advance
          const voucherNumber = `SA-${Date.now()}`;
          const [voucher] = await db
            .insert(vouchers)
            .values({
              companyId: req.session.currentCompanyId,
              voucherNumber,
              voucherType: "Payment",
              voucherDate: parsed.advanceDate,
              description:
                parsed.notes ||
                `Salary advance for ${employee[0].firstName} ${employee[0].lastName}`,
              totalAmount: parsed.amount,
            })
            .returning();

          voucherId = voucher.id;

          // Create voucher entries (double-entry)
          // Debit: Employee (using employeeId field directly - they owe us)
          await db.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: null,
            employeeId: employee[0].id,
            debitAmount: parsed.amount,
            creditAmount: "0",
            narration: `Salary advance - ${voucherNumber}`,
          });

          // Credit: Cash Account
          await db.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: cashAccountId,
            debitAmount: "0",
            creditAmount: parsed.amount,
            narration: `Salary advance - ${voucherNumber}`,
          });
        }

        // Create salary advance record
        const advance = await storage.createSalaryAdvance({
          ...parsed,
          voucherId,
        });

        res.status(201).json(advance);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  app.post(
    "/api/salary-advances/:id/deduction",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const advanceId = parseInt(req.params.id);
        if (isNaN(advanceId)) {
          return res.status(400).json({ message: "Invalid salary advance ID" });
        }

        const parsed = insertSalaryAdvanceDeductionSchema.parse(req.body);

        // Verify salary advance exists and belongs to current company
        const advance = await storage.getSalaryAdvanceById(advanceId);
        if (!advance) {
          return res.status(404).json({ message: "Salary advance not found" });
        }

        if (advance.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({ message: "Salary advance belongs to a different company" });
        }

        if (advance.fullyPaid) {
          return res
            .status(400)
            .json({ message: "Salary advance is already fully paid" });
        }

        const deductionAmount = parseFloat(parsed.deductionAmount);
        const remainingBalance = parseFloat(advance.remainingBalance);

        if (deductionAmount > remainingBalance) {
          return res
            .status(400)
            .json({
              message: `Deduction amount cannot exceed remaining balance of ${remainingBalance}`,
            });
        }

        // Create salary advance deduction record
        await db.insert(salaryAdvanceDeductions).values({
          salaryAdvanceId: advanceId,
          payrollMonth: parsed.payrollMonth,
          deductionAmount: parsed.deductionAmount,
        });

        // Update salary advance remaining balance
        const newRemainingBalance = remainingBalance - deductionAmount;
        const isFullyPaid = newRemainingBalance <= 0.01; // Use small threshold for floating point comparison

        await db
          .update(salaryAdvances)
          .set({
            remainingBalance: newRemainingBalance.toFixed(2),
            fullyPaid: isFullyPaid,
          })
          .where(eq(salaryAdvances.id, advanceId));

        res.json({
          message: "Deduction recorded successfully",
          newRemainingBalance: newRemainingBalance.toFixed(2),
          fullyPaid: isFullyPaid,
        });
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  app.delete("/api/salary-advances/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const advanceId = parseInt(req.params.id);
      if (isNaN(advanceId)) return res.status(400).json({ message: "Invalid salary advance ID" });

      const advance = await storage.getSalaryAdvanceById(advanceId);
      if (!advance) return res.status(404).json({ message: "Salary advance not found" });
      if (advance.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Salary advance belongs to a different company" });
      }

      await storage.deleteSalaryAdvance(advanceId);
      res.json({ message: "Salary advance deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/salary-advances/reconcile", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // 1. Load all advances (oldest first per employee)
      const allAdvances = await db
        .select()
        .from(salaryAdvances)
        .where(eq(salaryAdvances.companyId, companyId))
        .orderBy(salaryAdvances.employeeId, salaryAdvances.advanceDate);

      // 2. Load all manual deduction records (linked to specific advance IDs)
      const allManualDeductions = await db
        .select()
        .from(salaryAdvanceDeductions)
        .where(
          allAdvances.length > 0
            ? inArray(salaryAdvanceDeductions.salaryAdvanceId, allAdvances.map((a) => a.id))
            : sql`false`
        );

      const manualDeductionByAdvance = new Map<number, number>();
      for (const d of allManualDeductions) {
        manualDeductionByAdvance.set(
          d.salaryAdvanceId,
          (manualDeductionByAdvance.get(d.salaryAdvanceId) || 0) + parseFloat(d.deductionAmount || "0")
        );
      }

      // 3. Load all PAID payroll run items with deductions
      const paidRuns = await db
        .select({ id: erpPayrollRuns.id })
        .from(erpPayrollRuns)
        .where(and(eq(erpPayrollRuns.companyId, companyId), eq(erpPayrollRuns.status, "PAID")));

      const payrollDeductionByEmployee = new Map<number, number>();
      if (paidRuns.length > 0) {
        const paidItems = await db
          .select({ employeeId: erpPayrollRunItems.employeeId, deduction: erpPayrollRunItems.deduction })
          .from(erpPayrollRunItems)
          .where(inArray(erpPayrollRunItems.runId, paidRuns.map((r) => r.id)));

        for (const item of paidItems) {
          const amt = parseFloat(item.deduction || "0");
          if (amt > 0 && item.employeeId) {
            payrollDeductionByEmployee.set(
              item.employeeId,
              (payrollDeductionByEmployee.get(item.employeeId) || 0) + amt
            );
          }
        }
      }

      // 4. Group advances by employee
      const advancesByEmployee = new Map<number, typeof allAdvances>();
      for (const adv of allAdvances) {
        const list = advancesByEmployee.get(adv.employeeId) || [];
        list.push(adv);
        advancesByEmployee.set(adv.employeeId, list);
      }

      // 5. Recompute each employee's advance balances
      let fixed = 0;
      await db.transaction(async (tx: any) => {
        for (const [employeeId, advances] of advancesByEmployee) {
          // Step A: Start with original amount minus manual deductions (per advance)
          const balances: { id: number; bal: number }[] = [];
          for (const adv of advances) {
            const original = parseFloat(adv.amount || "0");
            const manualPaid = manualDeductionByAdvance.get(adv.id) || 0;
            balances.push({ id: adv.id, bal: Math.max(0, original - manualPaid) });
          }

          // Step B: Apply total payroll deductions FIFO (oldest advance first)
          let remaining = payrollDeductionByEmployee.get(employeeId) || 0;
          for (const entry of balances) {
            if (remaining <= 0) break;
            const deduct = Math.min(entry.bal, remaining);
            entry.bal = entry.bal - deduct;
            remaining -= deduct;
          }

          // Step C: Persist updated balances
          for (let i = 0; i < advances.length; i++) {
            const newBal = parseFloat(Math.max(0, balances[i].bal).toFixed(2));
            const fullyPaid = newBal <= 0.01;
            const adv = advances[i];
            const currentBal = parseFloat(adv.remainingBalance || "0");
            if (Math.abs(currentBal - newBal) > 0.01 || adv.fullyPaid !== fullyPaid) {
              await tx.update(salaryAdvances)
                .set({ remainingBalance: newBal.toFixed(2), fullyPaid })
                .where(eq(salaryAdvances.id, adv.id));
              fixed++;
            }
          }
        }
      });

      res.json({ message: `Reconciliation complete. ${fixed} advance(s) corrected.`, fixed });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/salary-advance-deductions", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const rows = await db
        .select({
          id: salaryAdvanceDeductions.id,
          salaryAdvanceId: salaryAdvanceDeductions.salaryAdvanceId,
          payrollMonth: salaryAdvanceDeductions.payrollMonth,
          deductionAmount: salaryAdvanceDeductions.deductionAmount,
          createdAt: salaryAdvanceDeductions.createdAt,
          advanceDate: salaryAdvances.advanceDate,
          advanceAmount: salaryAdvances.amount,
          advanceRemaining: salaryAdvances.remainingBalance,
          employeeId: salaryAdvances.employeeId,
          employeeFirstName: employees.firstName,
          employeeLastName: employees.lastName,
        })
        .from(salaryAdvanceDeductions)
        .innerJoin(salaryAdvances, eq(salaryAdvanceDeductions.salaryAdvanceId, salaryAdvances.id))
        .innerJoin(employees, eq(salaryAdvances.employeeId, employees.id))
        .where(eq(salaryAdvances.companyId, companyId))
        .orderBy(sql`${salaryAdvanceDeductions.createdAt} DESC`);
      res.json(rows.map((r) => ({
        ...r,
        workerName: `${r.employeeFirstName} ${r.employeeLastName}`.trim(),
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Groups
  registerStockRoutes(app);
  registerBankAssetRoutes(app);
  registerContainerRoutes(app);
  registerImportRoutes(app);
  registerAccountRoutes(app);
  registerVoucherRoutes(app);
  registerVoucherEntryRoutes(app);
  registerFiscalTransferRoutes(app);
  registerPosRoutes(app);
  registerStatsRoutes(app);
  registerImportCycleRoutes(app);
  registerDebugRoutes(app);
  registerReportsRoutes(app);
  registerBaleRoutes(app);
  registerAdminRoutes(app);
  registerBalanceRepairRoutes(app);
  registerStockSummaryRoutes(app);
  registerChatbotRoutes(app);
  registerCreditNoteRoutes(app);
  registerNetProfitExcelRoute(app);
  registerNetPositionMonthlyExcelRoute(app);
  registerWhatsAppRoutes(app);
  registerExportRoutes(app);
  registerGitRoutes(app);
  registerContainerTrackingRoutes(app);
  registerUserNotesRoutes(app);

  registerSpRoutes(app);
  registerSpMigrationRoutes(app);
  registerAiImportRoutes(app);

  const httpServer = createServer(app);

  return httpServer;
}
