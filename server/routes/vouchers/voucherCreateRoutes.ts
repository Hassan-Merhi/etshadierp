import type { Express } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../../auth";
import { requireActionAccess } from "../../lib/permissionMiddleware";
import {
  upload,
  logAudit,
  getCurrentExchangeRate,
  calculateHistoricalLocationInventory,
  syncEmployeeBalancesFromEntries,
  snapshotVoucherEntries,
  buildVoucherChangesForCreate,
  buildVoucherChangesForUpdate,
  buildItemLevelChanges,
} from "../_helpers";
import { triggerIntercompanyNotifications } from "../intercompanyNotificationRoutes";
import { autoReallocateLoansAccounts } from "../../lib/transporterAllocation";
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
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../../inventoryHelper";
import { checkAccountWhatsAppRule } from "../factoryWhatsappRoutes";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../../netPositionHelper";
import path from "path";
import fs from "fs";

import { registerVoucherEntryRoutes } from "../voucherEntryRoutes";
import { recalculateOrderTotals } from "../factory/_helpers";
import {
  customerOrderCharges,
  customerOrders,
  customerOrderBales,
  customerOrderLines,
  factorySettings as fSettings,
  factoryDaybookEntries as fde,
} from "@shared/schema";

/**
 * After saving a journal voucher, if it has a customer entry + a ledger account entry,
 * look for order charges linked to that ledger account for that customer.
 * If exactly one charge is found, update its amount and recalculate the order totals.
 */

export function registerVoucherCreateRoutes(app: Express) {
  app.post("/api/vouchers", requireAuth, async (req, res) => {
    try {
      const isPOS = (req as any).user?.role === "POS";
      const voucherType = req.body.voucherType;
      if (isPOS && voucherType !== "StockTransfer" && voucherType !== "Stock Transfer") {
        return res.status(403).json({ message: "Access denied: This resource is not available for POS users" });
      }
      const companyId = req.session.currentCompanyId;
      const exchangeRate = companyId ? await getCurrentExchangeRate(companyId) : null;
      const voucher = await storage.createVoucher({ ...req.body, exchangeRate });
      res.json(voucher);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create a voucher with entries in one transaction
  app.post("/api/vouchers/with-entries", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const { voucher, entries } = req.body;

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Validate voucher data
      if (!voucher || !entries || !Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ message: "Voucher and entries are required" });
      }

      // Validate that debits equal credits (only for non-optional vouchers)
      const totalDebits = entries.reduce((sum: number, entry: any) => sum + parseFloat(entry.debitAmount || "0"), 0);
      const totalCredits = entries.reduce((sum: number, entry: any) => sum + parseFloat(entry.creditAmount || "0"), 0);

      // For active (non-optional) vouchers, enforce debit=credit balance
      if (!voucher.optional && Math.abs(totalDebits - totalCredits) >= 0.01) {
        return res.status(400).json({
          message: "Total debits must equal total credits for active vouchers",
        });
      }

      // Create voucher with error handling
      let createdVoucher;
      const createdEntries = [];

      try {
        // Get current exchange rate for multi-currency companies
        const exchangeRate = await getCurrentExchangeRate(req.session.currentCompanyId!);
        [createdVoucher] = await db
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId!,
            locationId: voucher.locationId || null,
            voucherNumber: voucher.voucherNumber,
            voucherType: voucher.voucherType,
            voucherDate: voucher.voucherDate,
            description: voucher.description || null,
            totalAmount: Math.max(totalDebits, totalCredits).toFixed(2),
            optional: voucher.optional ?? false,
          })
          .returning();

        // Create voucher entries
        for (const entry of entries) {
          // Cross-field validation: when an entry references a customer/
          // supplier/employee that has a linked ledger account, fill in
          // the missing ledger so the linked-ledger view stays consistent.
          // Reject the request if the user provided a *different* ledger
          // than the one the party is linked to.
          let ledgerAccountId = entry.ledgerAccountId || null;

          if (entry.customerId) {
            // Scope the customer lookup by current company to prevent
            // cross-company customer IDs from being used in this voucher.
            const [linkedCust] = await db
              .select({ ledgerAccountId: customers.ledgerAccountId })
              .from(customers)
              .where(and(eq(customers.id, entry.customerId), eq(customers.companyId, req.session.currentCompanyId!)))
              .limit(1);
            if (!linkedCust) {
              throw new Error(`Customer ${entry.customerId} not found in current company.`);
            }
            const linkedLedgerId = linkedCust.ledgerAccountId ?? null;
            if (linkedLedgerId) {
              if (ledgerAccountId && ledgerAccountId !== linkedLedgerId) {
                throw new Error(
                  `Customer ${entry.customerId} is linked to ledger ${linkedLedgerId}, ` +
                    `but the entry specifies ledger ${ledgerAccountId}. ` +
                    `Use the customer's linked ledger or remove the customer reference.`
                );
              }
              ledgerAccountId = linkedLedgerId;
            }
          }

          const [createdEntry] = await db
            .insert(voucherEntries)
            .values({
              voucherId: createdVoucher.id,
              ledgerAccountId,
              bankAccountId: entry.bankAccountId || null,
              fixedAssetId: entry.fixedAssetId || null,
              supplierId: entry.supplierId || null,
              employeeId: entry.employeeId || null,
              customerId: entry.customerId || null,
              factorySupplierId: entry.factorySupplierId || null,
              debitAmount: entry.debitAmount || "0",
              creditAmount: entry.creditAmount || "0",
              narration: entry.narration || null,
            })
            .returning();
          createdEntries.push(createdEntry);
        }
      } catch (error: any) {
        // Cleanup: Delete voucher and entries if anything failed
        if (createdVoucher?.id) {
          await db
            .delete(voucherEntries)
            .where(eq(voucherEntries.voucherId, createdVoucher.id))
            .catch(() => {});
          await db
            .delete(vouchers)
            .where(eq(vouchers.id, createdVoucher.id))
            .catch(() => {});
        }
        throw error;
      }

      // Sync employee balances from voucher entries (only for non-optional vouchers)
      if (!createdVoucher.optional) {
        await syncEmployeeBalancesFromEntries(
          createdEntries.map((e) => ({
            ledgerAccountId: e.ledgerAccountId,
            employeeId: e.employeeId,
            debitAmount: e.debitAmount,
            creditAmount: e.creditAmount,
          })),
          req.session.currentCompanyId!
        );
      }

      const result = { voucher: createdVoucher, entries: createdEntries };

      // Log the creation to audit log
      const _createEntriesSnap = await snapshotVoucherEntries(createdEntries).catch(() => []);
      await logAudit({
        userId: req.session.userId!,
        username: (req.session as any).username || "unknown",
        companyId: req.session.currentCompanyId!,
        action: "create",
        tableName: "vouchers",
        recordId: createdVoucher.id,
        recordIdentifier: createdVoucher.voucherNumber,
        changes: buildVoucherChangesForCreate(createdVoucher, _createEntriesSnap),
      });

      // Fire-and-forget intercompany notification check (Payment/Receipt only)
      triggerIntercompanyNotifications(
        req.session.currentCompanyId!,
        createdVoucher.id,
        createdVoucher.voucherNumber,
        createdVoucher.voucherDate,
        createdVoucher.totalAmount || "0",
        createdVoucher.description,
        createdEntries.map((e) => e.ledgerAccountId),
        createdVoucher.voucherType
      ).catch(() => {});

      // Fire-and-forget: auto-rerun FIFO allocation for any Loans accounts touched
      autoReallocateLoansAccounts(
        req.session.currentCompanyId!,
        createdEntries.map((e) => e.ledgerAccountId)
      ).catch(() => {});

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create Payment or Receipt voucher with all entries in one batch
}
