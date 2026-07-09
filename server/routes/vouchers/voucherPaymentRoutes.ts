import type { Express } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { isReadonlyMigratedVoucher, READONLY_MIGRATED_VOUCHER_MESSAGE } from "../../lib/migratedVoucherGuard";
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

export function registerVoucherPaymentRoutes(app: Express) {
  app.post("/api/vouchers/payment-receipt", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const {
        voucherType, // "Payment" or "Receipt"
        voucherDate,
        paymentAccountType, // "ledger", "bank", "supplier", "employee", "fixedAsset"
        paymentAccountId,
        paymentAccountName,
        entries, // Array of { accountType, accountId, accountName, amount }
        notes,
        optional,
        currency,
        exchangeRate,
        effectiveDate,
      } = req.body;

      // Validate required fields
      if (
        !voucherType ||
        !voucherDate ||
        !paymentAccountId ||
        !entries ||
        !Array.isArray(entries) ||
        entries.length === 0
      ) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      if (voucherType !== "Payment" && voucherType !== "Receipt") {
        return res.status(400).json({ message: "voucherType must be 'Payment' or 'Receipt'" });
      }

      // Calculate total amount
      const total = entries.reduce((sum, entry) => sum + parseFloat(entry.amount || "0"), 0);

      // Generate voucher number
      const voucherNumber = `${voucherType.toUpperCase()}-${Date.now()}`;

      // Use database transaction for atomic operation
      const companyId = req.session.currentCompanyId!;

      // Helper: build the voucher-entry account field set for a given
      // (accountType, accountId).  Handles three things in one place:
      //   1. Validates the referenced row belongs to the current company
      //      (security: prevents cross-company injection).
      //   2. For accountType === "customer", also stamps ledgerAccountId
      //      from the linked customer ledger so the row shows up in BOTH
      //      the Customers view and the linked-ledger view (Phase 4).
      //   3. For accountType === "ledger" where the ledger is linked to a
      //      customer, also stamps customerId for the same reason.
      // The OR clause in factoryCustomerLedger.buildFactoryCustomerLedgerEntries
      // makes this denormalization safe (no double-counting).
      const buildAccountField = async (accountType: string, accountId: number): Promise<Record<string, number>> => {
        const field: Record<string, number> = {};
        if (accountType === "ledger") {
          const [acct] = await db
            .select({ id: ledgerAccounts.id, companyId: ledgerAccounts.companyId })
            .from(ledgerAccounts)
            .where(eq(ledgerAccounts.id, accountId))
            .limit(1);
          if (!acct || acct.companyId !== companyId) {
            throw new Error(`Ledger account ${accountId} not found in current company.`);
          }
          field.ledgerAccountId = accountId;
          // Auto-fill customerId if this ledger is customer-linked
          const [linkedCust] = await db
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.ledgerAccountId, accountId), eq(customers.companyId, companyId)))
            .limit(1);
          if (linkedCust) field.customerId = linkedCust.id;
        } else if (accountType === "customer") {
          const [cust] = await db
            .select({ id: customers.id, ledgerAccountId: customers.ledgerAccountId })
            .from(customers)
            .where(and(eq(customers.id, accountId), eq(customers.companyId, companyId)))
            .limit(1);
          if (!cust) {
            throw new Error(`Customer ${accountId} not found in current company.`);
          }
          field.customerId = accountId;
          if (cust.ledgerAccountId) field.ledgerAccountId = cust.ledgerAccountId;
        } else if (accountType === "bank") {
          field.bankAccountId = accountId;
        } else if (accountType === "supplier") {
          field.supplierId = accountId;
        } else if (accountType === "factorySupplier") {
          field.factorySupplierId = accountId;
        } else if (accountType === "employee") {
          field.employeeId = accountId;
        } else if (accountType === "fixedAsset") {
          field.fixedAssetId = accountId;
        }
        return field;
      };

      const result = await db.transaction(async (tx) => {
        // Create voucher
        const [createdVoucher] = await tx
          .insert(vouchers)
          .values({
            companyId,
            voucherNumber,
            voucherType,
            voucherDate,
            description: notes || null,
            totalAmount: total.toFixed(2),
            optional: optional ?? false,
            currency: currency || "USD",
            exchangeRate: exchangeRate || null,
            effectiveDate: effectiveDate || null,
          })
          .returning();

        const voucherEntriesToCreate = [];

        // Pre-compute the payment-account field once (same for every entry)
        const paymentAccountField = await buildAccountField(paymentAccountType, paymentAccountId);

        // Create entries based on voucher type
        for (const entry of entries) {
          const amount = entry.amount;
          const narration = notes || null;

          const entryAccountField = await buildAccountField(entry.accountType, entry.accountId);

          const isLiabilityPaymentAccount =
            paymentAccountType === "supplier" ||
            paymentAccountType === "factorySupplier" ||
            paymentAccountType === "employee";

          if (voucherType === "Payment") {
            if (isLiabilityPaymentAccount) {
              // Payment from liability account (supplier/employee):
              // DR payment account (reduce liability - we paid from what they owe/advanced)
              // CR contra account
              voucherEntriesToCreate.push({
                voucherId: createdVoucher.id,
                ...paymentAccountField,
                debitAmount: amount,
                creditAmount: "0",
                narration,
              });
              voucherEntriesToCreate.push({
                voucherId: createdVoucher.id,
                ...entryAccountField,
                debitAmount: "0",
                creditAmount: amount,
                narration,
              });
            } else {
              // Payment from asset account (cash/bank/ledger):
              // DR contra account (expense/asset purchased)
              // CR payment account (cash goes out)
              voucherEntriesToCreate.push({
                voucherId: createdVoucher.id,
                ...entryAccountField,
                debitAmount: amount,
                creditAmount: "0",
                narration,
              });
              voucherEntriesToCreate.push({
                voucherId: createdVoucher.id,
                ...paymentAccountField,
                debitAmount: "0",
                creditAmount: amount,
                narration,
              });
            }
          } else {
            if (isLiabilityPaymentAccount) {
              // Receipt into liability account (supplier/employee):
              // CR payment account (increase liability - we owe them more)
              // DR contra account (the source, e.g. loans)
              voucherEntriesToCreate.push({
                voucherId: createdVoucher.id,
                ...entryAccountField,
                debitAmount: amount,
                creditAmount: "0",
                narration,
              });
              voucherEntriesToCreate.push({
                voucherId: createdVoucher.id,
                ...paymentAccountField,
                debitAmount: "0",
                creditAmount: amount,
                narration,
              });
            } else {
              // Receipt into asset account (cash/bank/ledger):
              // DR payment account (cash comes in)
              // CR contra account (income/liability)
              voucherEntriesToCreate.push({
                voucherId: createdVoucher.id,
                ...paymentAccountField,
                debitAmount: amount,
                creditAmount: "0",
                narration,
              });
              voucherEntriesToCreate.push({
                voucherId: createdVoucher.id,
                ...entryAccountField,
                debitAmount: "0",
                creditAmount: amount,
                narration,
              });
            }
          }
        }

        // Batch insert all voucher entries
        const createdEntries = await tx.insert(voucherEntries).values(voucherEntriesToCreate).returning();

        return { voucher: createdVoucher, entries: createdEntries };
      });

      // Sync employee balances from voucher entries (only for non-optional vouchers)
      if (!result.voucher.optional) {
        await syncEmployeeBalancesFromEntries(
          result.entries.map((e) => ({
            ledgerAccountId: e.ledgerAccountId,
            employeeId: e.employeeId,
            debitAmount: e.debitAmount,
            creditAmount: e.creditAmount,
          })),
          req.session.currentCompanyId!
        );
      }

      // Write to factory daybook if this company has factory settings
      try {
        const cid = req.session.currentCompanyId!;
        const [fSetting] = await db.select().from(fSettings).where(eq(fSettings.companyId, cid));
        if (fSetting) {
          const vType = result.voucher.voucherType;
          const txType = vType === "Payment" ? "PAYMENT" : vType === "Receipt" ? "RECEIPT" : "JOURNAL";
          const currency = result.voucher.currency || "USD";
          const fxRate = parseFloat(result.voucher.exchangeRate || "1") || 1;
          const amtCurrency = parseFloat(result.voucher.totalAmount || "0");
          const amtUsd = currency === "USD" ? amtCurrency : amtCurrency * fxRate;
          await db.insert(fde).values({
            companyId: cid,
            txDate: result.voucher.voucherDate,
            txType,
            referenceId: result.voucher.id,
            referenceTable: "vouchers",
            description: result.voucher.description || `${vType} voucher #${result.voucher.voucherNumber}`,
            currencyCode: currency,
            amountCurrency: String(amtCurrency),
            fxRateToUsd: String(fxRate),
            amountUsd: String(amtUsd),
            createdBy: null,
            effectiveDate: result.voucher.effectiveDate || null,
          });
        }
      } catch (dbErr) {
        console.error("Factory daybook write failed (non-fatal):", dbErr);
      }

      // WhatsApp rule check — prompt the frontend instead of auto-sending
      let waResult: { prompt: boolean; accountId?: number; voucherDate?: string; month?: string } = { prompt: false };
      try {
        waResult = await checkAccountWhatsAppRule({
          companyId: req.session.currentCompanyId!,
          accountId: paymentAccountId,
          accountType: paymentAccountType,
          voucherType: voucherType as "Payment" | "Receipt",
          voucherDate: voucherDate,
        });
      } catch (waErr: any) {
        console.error("WhatsApp rule check error (non-fatal):", waErr);
      }

      // Log the payment/receipt creation
      try {
        const _prEntriesSnap = await snapshotVoucherEntries(result.entries);
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "create",
          tableName: "vouchers",
          recordId: result.voucher.id,
          recordIdentifier: result.voucher.voucherNumber,
          changes: buildVoucherChangesForCreate(result.voucher, _prEntriesSnap),
        });
      } catch {
        /* non-fatal */
      }

      // Fire-and-forget intercompany notification check (Payment/Receipt only)
      triggerIntercompanyNotifications(
        req.session.currentCompanyId!,
        result.voucher.id,
        result.voucher.voucherNumber,
        result.voucher.voucherDate,
        result.voucher.totalAmount || "0",
        result.voucher.description,
        result.entries.map((e) => e.ledgerAccountId),
        result.voucher.voucherType
      ).catch(() => {});

      // Fire-and-forget: auto-rerun FIFO allocation for any Loans accounts touched
      autoReallocateLoansAccounts(
        req.session.currentCompanyId!,
        result.entries.map((e) => e.ledgerAccountId)
      ).catch(() => {});

      res.json({ ...result, whatsapp: waResult });
    } catch (error: any) {
      console.error("Error creating payment/receipt voucher:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Update Payment or Receipt voucher with all entries in one batch
  app.patch("/api/vouchers/:id/payment-receipt", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const voucherId = parseInt(req.params.id);
      if (isNaN(voucherId)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const {
        voucherType, // "Payment" or "Receipt"
        voucherDate,
        paymentAccountType,
        paymentAccountId,
        paymentAccountName,
        entries,
        notes,
        optional,
        currency,
        exchangeRate,
        effectiveDate,
      } = req.body;

      // Validate required fields
      if (
        !voucherType ||
        !voucherDate ||
        !paymentAccountId ||
        !entries ||
        !Array.isArray(entries) ||
        entries.length === 0
      ) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      if (voucherType !== "Payment" && voucherType !== "Receipt") {
        return res.status(400).json({ message: "voucherType must be 'Payment' or 'Receipt'" });
      }

      // Calculate total amount
      const total = entries.reduce((sum, entry) => sum + parseFloat(entry.amount || "0"), 0);

      // Use database transaction for atomic operation
      const result = await db.transaction(async (tx) => {
        // Verify voucher exists and belongs to current company
        const [existingVoucher] = await tx.select().from(vouchers).where(eq(vouchers.id, voucherId));

        if (!existingVoucher) {
          throw new Error("Voucher not found");
        }

        if (existingVoucher.companyId !== req.session.currentCompanyId) {
          throw new Error("Access denied: Voucher belongs to a different company");
        }

        if (isReadonlyMigratedVoucher(existingVoucher)) {
          throw new Error(READONLY_MIGRATED_VOUCHER_MESSAGE);
        }

        // Get existing entries before deleting (for balance sync)
        const oldEntries = await tx.select().from(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));

        // Update voucher
        const [updatedVoucher] = await tx
          .update(vouchers)
          .set({
            voucherType,
            voucherDate,
            description: notes || null,
            totalAmount: total.toFixed(2),
            optional: optional ?? false,
            effectiveDate: effectiveDate || null,
          })
          .where(eq(vouchers.id, voucherId))
          .returning();

        // Delete existing voucher entries
        await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));

        const voucherEntriesToCreate = [];

        // Create new entries based on voucher type
        for (const entry of entries) {
          const amount = entry.amount;
          const narration = notes || null;

          // Determine account field for entry account
          const entryAccountField: any = {};
          if (entry.accountType === "ledger") {
            entryAccountField.ledgerAccountId = entry.accountId;
          } else if (entry.accountType === "bank") {
            entryAccountField.bankAccountId = entry.accountId;
          } else if (entry.accountType === "supplier") {
            entryAccountField.supplierId = entry.accountId;
          } else if (entry.accountType === "factorySupplier") {
            entryAccountField.factorySupplierId = entry.accountId;
          } else if (entry.accountType === "employee") {
            entryAccountField.employeeId = entry.accountId;
          } else if (entry.accountType === "fixedAsset") {
            entryAccountField.fixedAssetId = entry.accountId;
          } else if (entry.accountType === "customer") {
            entryAccountField.customerId = entry.accountId;
          }

          // Determine account field for payment account
          const paymentAccountField: any = {};
          if (paymentAccountType === "ledger") {
            paymentAccountField.ledgerAccountId = paymentAccountId;
          } else if (paymentAccountType === "bank") {
            paymentAccountField.bankAccountId = paymentAccountId;
          } else if (paymentAccountType === "supplier") {
            paymentAccountField.supplierId = paymentAccountId;
          } else if (paymentAccountType === "factorySupplier") {
            paymentAccountField.factorySupplierId = paymentAccountId;
          } else if (paymentAccountType === "employee") {
            paymentAccountField.employeeId = paymentAccountId;
          } else if (paymentAccountType === "fixedAsset") {
            paymentAccountField.fixedAssetId = paymentAccountId;
          } else if (paymentAccountType === "customer") {
            paymentAccountField.customerId = paymentAccountId;
          }

          const isLiabilityPaymentAccount =
            paymentAccountType === "supplier" ||
            paymentAccountType === "factorySupplier" ||
            paymentAccountType === "employee";

          if (voucherType === "Payment") {
            if (isLiabilityPaymentAccount) {
              voucherEntriesToCreate.push({
                voucherId: updatedVoucher.id,
                ...paymentAccountField,
                debitAmount: amount,
                creditAmount: "0",
                narration,
              });
              voucherEntriesToCreate.push({
                voucherId: updatedVoucher.id,
                ...entryAccountField,
                debitAmount: "0",
                creditAmount: amount,
                narration,
              });
            } else {
              voucherEntriesToCreate.push({
                voucherId: updatedVoucher.id,
                ...entryAccountField,
                debitAmount: amount,
                creditAmount: "0",
                narration,
              });
              voucherEntriesToCreate.push({
                voucherId: updatedVoucher.id,
                ...paymentAccountField,
                debitAmount: "0",
                creditAmount: amount,
                narration,
              });
            }
          } else {
            if (isLiabilityPaymentAccount) {
              voucherEntriesToCreate.push({
                voucherId: updatedVoucher.id,
                ...entryAccountField,
                debitAmount: amount,
                creditAmount: "0",
                narration,
              });
              voucherEntriesToCreate.push({
                voucherId: updatedVoucher.id,
                ...paymentAccountField,
                debitAmount: "0",
                creditAmount: amount,
                narration,
              });
            } else {
              voucherEntriesToCreate.push({
                voucherId: updatedVoucher.id,
                ...paymentAccountField,
                debitAmount: amount,
                creditAmount: "0",
                narration,
              });
              voucherEntriesToCreate.push({
                voucherId: updatedVoucher.id,
                ...entryAccountField,
                debitAmount: "0",
                creditAmount: amount,
                narration,
              });
            }
          }
        }

        // Batch insert all new voucher entries
        const createdEntries = await tx.insert(voucherEntries).values(voucherEntriesToCreate).returning();

        return {
          voucher: updatedVoucher,
          entries: createdEntries,
          oldEntries,
          existingVoucher,
          wasOptional: existingVoucher.optional,
        };
      });

      // Sync employee balances: reverse old entries if voucher was non-optional
      if (!result.wasOptional) {
        await syncEmployeeBalancesFromEntries(
          result.oldEntries.map((e) => ({
            ledgerAccountId: e.ledgerAccountId,
            employeeId: e.employeeId,
            debitAmount: e.debitAmount,
            creditAmount: e.creditAmount,
          })),
          req.session.currentCompanyId!,
          true // reverse
        );
      }

      // Apply new entries if voucher is non-optional
      if (!result.voucher.optional) {
        await syncEmployeeBalancesFromEntries(
          result.entries.map((e) => ({
            ledgerAccountId: e.ledgerAccountId,
            employeeId: e.employeeId,
            debitAmount: e.debitAmount,
            creditAmount: e.creditAmount,
          })),
          req.session.currentCompanyId!
        );
      }

      // WhatsApp rule check — prompt the frontend instead of auto-sending
      let waResultPatch: { prompt: boolean; accountId?: number; voucherDate?: string; month?: string } = {
        prompt: false,
      };
      try {
        waResultPatch = await checkAccountWhatsAppRule({
          companyId: req.session.currentCompanyId!,
          accountId: paymentAccountId,
          accountType: paymentAccountType,
          voucherType: voucherType as "Payment" | "Receipt",
          voucherDate: voucherDate,
        });
      } catch (waErr: any) {
        console.error("WhatsApp rule check error (non-fatal):", waErr);
      }

      try {
        const _oldSnap = await snapshotVoucherEntries(result.oldEntries);
        const _newSnap = await snapshotVoucherEntries(result.entries);
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "update",
          tableName: "vouchers",
          recordId: result.voucher.id,
          recordIdentifier: result.voucher.voucherNumber,
          changes: buildVoucherChangesForUpdate(
            {
              voucherType: result.existingVoucher.voucherType,
              voucherDate: result.existingVoucher.voucherDate,
              totalAmount: result.existingVoucher.totalAmount,
              description: result.existingVoucher.description,
              optional: result.existingVoucher.optional,
            },
            {
              voucherType: result.voucher.voucherType,
              voucherDate: result.voucher.voucherDate,
              totalAmount: result.voucher.totalAmount,
              description: result.voucher.description,
              optional: result.voucher.optional,
            },
            _oldSnap,
            _newSnap
          ),
        });
      } catch {
        /* non-fatal */
      }
      res.json({ voucher: result.voucher, entries: result.entries, whatsapp: waResultPatch });
    } catch (error: any) {
      console.error("Error updating payment/receipt voucher:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Create Journal voucher with all entries in one batch
}
