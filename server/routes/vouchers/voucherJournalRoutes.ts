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
import { logger } from "../../lib/logger";
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

async function syncJournalToOrderCharge(
  companyId: number,
  savedEntries: Array<{
    customerId: number | null;
    ledgerAccountId: number | null;
    debitAmount: string;
    creditAmount: string;
  }>,
  voucherId?: number
) {
  const customerEntry = savedEntries.find((e) => e.customerId !== null);
  if (!customerEntry) return;

  const ledgerCrEntries = savedEntries.filter(
    (e) => e.ledgerAccountId !== null && e.customerId === null && parseFloat(e.creditAmount || "0") > 0
  );
  if (ledgerCrEntries.length === 0) return;

  for (const ledgerEntry of ledgerCrEntries) {
    const newAmount = parseFloat(ledgerEntry.creditAmount || "0");
    if (newAmount <= 0) continue;

    let matchingCharges: { id: number; orderId: number; amount: string; chargeType: string }[] = [];

    // Priority 1: find by direct voucher link (exact match, no ambiguity)
    if (voucherId) {
      matchingCharges = await db
        .select({
          id: customerOrderCharges.id,
          orderId: customerOrderCharges.orderId,
          amount: customerOrderCharges.amount,
          chargeType: customerOrderCharges.chargeType,
        })
        .from(customerOrderCharges)
        .innerJoin(
          customerOrders,
          and(eq(customerOrderCharges.orderId, customerOrders.id), eq(customerOrders.companyId, companyId))
        )
        .where(
          and(
            eq(customerOrderCharges.voucherId, voucherId),
            eq(customerOrderCharges.ledgerAccountId, ledgerEntry.ledgerAccountId!)
          )
        );
    }

    // Priority 2: fall back to ledger account match (only if exactly one unlinked result)
    if (matchingCharges.length === 0) {
      const byLedger = await db
        .select({
          id: customerOrderCharges.id,
          orderId: customerOrderCharges.orderId,
          amount: customerOrderCharges.amount,
          chargeType: customerOrderCharges.chargeType,
        })
        .from(customerOrderCharges)
        .innerJoin(
          customerOrders,
          and(
            eq(customerOrderCharges.orderId, customerOrders.id),
            eq(customerOrders.customerId, customerEntry.customerId!),
            eq(customerOrders.companyId, companyId)
          )
        )
        .where(
          and(
            eq(customerOrderCharges.ledgerAccountId, ledgerEntry.ledgerAccountId!),
            isNull(customerOrderCharges.voucherId)
          )
        );

      if (byLedger.length === 1) {
        matchingCharges = byLedger;
      }
    }

    if (matchingCharges.length === 0) continue;

    const charge = matchingCharges[0];
    const oldAmount = parseFloat(charge.amount || "0");
    const amountChanged = Math.abs(oldAmount - newAmount) >= 0.01;

    // Atomically: update charge amount, recalc order totals, sync customerBalances.
    // Without a transaction a crash between the three writes leaves the order's grand
    // total inconsistent with the underlying charge rows.
    await db.transaction(async (tx) => {
      // Update charge amount and stamp voucherId for direct future lookups
      await tx
        .update(customerOrderCharges)
        .set({
          amount: newAmount.toFixed(2),
          ...(voucherId ? { voucherId } : {}),
        })
        .where(eq(customerOrderCharges.id, charge.id));

      if (!amountChanged) return; // voucherId stamp done, but no recalc needed

      // Recalculate and save order totals
      await recalculateOrderTotals(tx, charge.orderId);

      // Also sync the invoice debit in customerBalances
      const [updatedOrder] = await tx
        .select({ grandTotal: customerOrders.grandTotal })
        .from(customerOrders)
        .where(eq(customerOrders.id, charge.orderId));

      if (updatedOrder) {
        await tx
          .update(customerBalances)
          .set({ debitAmount: updatedOrder.grandTotal, balance: updatedOrder.grandTotal })
          .where(
            and(
              eq(customerBalances.companyId, companyId),
              eq(customerBalances.referenceId, charge.orderId),
              eq(customerBalances.referenceType, "INVOICE")
            )
          );
      }
    });
  }
}

export function registerVoucherJournalRoutes(app: Express) {
  app.post("/api/vouchers/journal", requireAuth, requireNonPOS, async (req, res) => {
    const _t = Date.now();
    const _uid = req.session.userId;
    const _cid = req.session.currentCompanyId;
    try {
      logger.info("journal voucher create started", { module: "vouchers", action: "createJournal", userId: _uid, companyId: _cid });
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const {
        voucherDate,
        entries, // Array of { type: "DR" | "CR", accountType, accountId, accountName, amount }
        notes,
        optional,
        currency,
        exchangeRate,
        effectiveDate,
        mainAccountId, // optional: ledger account ID to use for WhatsApp auto-statement
        mainAccountType, // optional: account type for the main account (default: "ledger")
      } = req.body;

      // Validate required fields
      if (!voucherDate || !entries || !Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // Calculate total debits and credits
      let totalDebits = 0;
      let totalCredits = 0;
      entries.forEach((entry: any) => {
        const amount = parseFloat(entry.amount || "0");
        if (entry.type === "DR") {
          totalDebits += amount;
        } else if (entry.type === "CR") {
          totalCredits += amount;
        }
      });

      // Validate debits equal credits (for non-optional vouchers)
      if (!optional && Math.abs(totalDebits - totalCredits) >= 0.01) {
        return res.status(400).json({ message: "Total debits must equal total credits" });
      }

      // Generate voucher number
      const voucherNumber = `JOURNAL-${Date.now()}`;

      // Use database transaction for atomic operation
      const result = await db.transaction(async (tx) => {
        // Create journal voucher
        const [createdVoucher] = await tx
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId!,
            voucherNumber,
            voucherType: "Journal",
            voucherDate,
            description: notes || null,
            totalAmount: Math.max(totalDebits, totalCredits).toFixed(2),
            optional: optional ?? false,
            currency: currency || "USD",
            exchangeRate: exchangeRate || null,
            effectiveDate: effectiveDate || null,
          })
          .returning();

        const voucherEntriesToCreate = [];

        // Create entries
        for (const entry of entries) {
          const amount = entry.amount;
          const narration = entry.narration || null;

          // Determine account field
          const accountField: any = {};
          if (entry.accountType === "ledger") {
            accountField.ledgerAccountId = entry.accountId;
          } else if (entry.accountType === "bank") {
            accountField.bankAccountId = entry.accountId;
          } else if (entry.accountType === "supplier") {
            accountField.supplierId = entry.accountId;
          } else if (entry.accountType === "factorySupplier") {
            accountField.factorySupplierId = entry.accountId;
          } else if (entry.accountType === "employee") {
            accountField.employeeId = entry.accountId;
          } else if (entry.accountType === "fixedAsset") {
            accountField.fixedAssetId = entry.accountId;
          } else if (entry.accountType === "customer") {
            accountField.customerId = entry.accountId;
          }

          voucherEntriesToCreate.push({
            voucherId: createdVoucher.id,
            ...accountField,
            debitAmount: entry.type === "DR" ? amount : "0",
            creditAmount: entry.type === "CR" ? amount : "0",
            narration,
          });
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

      // Sync order charges automatically (non-fatal)
      await syncJournalToOrderCharge(req.session.currentCompanyId!, result.entries, result.voucher.id).catch(() => {});

      // Write to factory daybook if this company has factory settings
      try {
        const cid = req.session.currentCompanyId!;
        const [fSetting] = await db.select().from(fSettings).where(eq(fSettings.companyId, cid));
        if (fSetting) {
          const currency = result.voucher.currency || "USD";
          const fxRate = parseFloat(result.voucher.exchangeRate || "1") || 1;
          const amtCurrency = parseFloat(result.voucher.totalAmount || "0");
          const amtUsd = currency === "USD" ? amtCurrency : amtCurrency * fxRate;
          await db.insert(fde).values({
            companyId: cid,
            txDate: result.voucher.voucherDate,
            txType: "JOURNAL",
            referenceId: result.voucher.id,
            referenceTable: "vouchers",
            description: result.voucher.description || `Journal voucher #${result.voucher.voucherNumber}`,
            currencyCode: currency,
            amountCurrency: String(amtCurrency),
            fxRateToUsd: String(fxRate),
            amountUsd: String(amtUsd),
            createdBy: null,
          });
        }
      } catch (dbErr) {
        console.error("Factory daybook write failed (non-fatal):", dbErr);
      }

      // WhatsApp rule check — prompt the frontend instead of auto-sending
      // Resolve main account: prefer explicitly passed mainAccountId,
      // fallback to first ledger-type DR entry in entries array.
      let waJournalResult: { prompt: boolean; accountId?: number; voucherDate?: string; month?: string } = {
        prompt: false,
      };
      try {
        let waAccountId = mainAccountId ? Number(mainAccountId) : null;
        let waAccountType = mainAccountType ? String(mainAccountType) : "ledger";
        if (!waAccountId) {
          const firstLedgerDr = (entries as any[]).find(
            (e) => e.accountType === "ledger" && e.type === "DR" && Number(e.accountId) > 0
          );
          if (firstLedgerDr) {
            waAccountId = Number(firstLedgerDr.accountId);
            waAccountType = "ledger";
          }
        }
        if (waAccountId) {
          waJournalResult = await checkAccountWhatsAppRule({
            companyId: req.session.currentCompanyId!,
            accountId: waAccountId,
            accountType: waAccountType,
            voucherType: "Journal",
            voucherDate: voucherDate,
          });
        }
      } catch (waErr: any) {
        console.error("WhatsApp rule check error (non-fatal):", waErr);
      }

      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "create",
          tableName: "vouchers",
          recordId: result.voucher.id,
          recordIdentifier: result.voucher.voucherNumber,
          changes: buildVoucherChangesForCreate(result.voucher, result.entries),
        });
      } catch {
        /* non-fatal */
      }
      logger.info("journal voucher create succeeded", { module: "vouchers", action: "createJournal", userId: _uid, companyId: _cid, voucherId: result.voucher.id, durationMs: Date.now() - _t });
      res.json({ ...result, whatsapp: waJournalResult });
    } catch (error: any) {
      logger.error("journal voucher create failed", { module: "vouchers", action: "createJournal", userId: _uid, companyId: _cid, durationMs: Date.now() - _t, error });
      console.error("Error creating journal voucher:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Update Journal voucher with all entries in one batch
  app.patch("/api/vouchers/:id/journal", requireAuth, requireNonPOS, async (req, res) => {
    const _t = Date.now();
    const _uid = req.session.userId;
    const _cid = req.session.currentCompanyId;
    try {
      logger.info("journal voucher update started", { module: "vouchers", action: "updateJournal", userId: _uid, companyId: _cid });
      const voucherId = parseInt(req.params.id);
      if (isNaN(voucherId)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const {
        voucherDate,
        entries,
        notes,
        optional,
        currency,
        exchangeRate,
        effectiveDate,
        mainAccountId: mainAccountIdPatch,
        mainAccountType: mainAccountTypePatch,
      } = req.body;

      // Validate required fields
      if (!voucherDate || !entries || !Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // Calculate total debits and credits
      let totalDebits = 0;
      let totalCredits = 0;
      entries.forEach((entry: any) => {
        const amount = parseFloat(entry.amount || "0");
        if (entry.type === "DR") {
          totalDebits += amount;
        } else if (entry.type === "CR") {
          totalCredits += amount;
        }
      });

      // Validate debits equal credits (for non-optional vouchers)
      if (!optional && Math.abs(totalDebits - totalCredits) >= 0.01) {
        return res.status(400).json({ message: "Total debits must equal total credits" });
      }

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
            voucherDate,
            description: notes || null,
            totalAmount: Math.max(totalDebits, totalCredits).toFixed(2),
            optional: optional ?? false,
            effectiveDate: effectiveDate || null,
          })
          .where(eq(vouchers.id, voucherId))
          .returning();

        // Delete existing voucher entries
        await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));

        const voucherEntriesToCreate = [];

        // Create new entries
        for (const entry of entries) {
          const amount = entry.amount;
          const narration = entry.narration || null;

          // Determine account field
          const accountField: any = {};
          if (entry.accountType === "ledger") {
            accountField.ledgerAccountId = entry.accountId;
          } else if (entry.accountType === "bank") {
            accountField.bankAccountId = entry.accountId;
          } else if (entry.accountType === "supplier") {
            accountField.supplierId = entry.accountId;
          } else if (entry.accountType === "factorySupplier") {
            accountField.factorySupplierId = entry.accountId;
          } else if (entry.accountType === "employee") {
            accountField.employeeId = entry.accountId;
          } else if (entry.accountType === "fixedAsset") {
            accountField.fixedAssetId = entry.accountId;
          } else if (entry.accountType === "customer") {
            accountField.customerId = entry.accountId;
          }

          voucherEntriesToCreate.push({
            voucherId: updatedVoucher.id,
            ...accountField,
            debitAmount: entry.type === "DR" ? amount : "0",
            creditAmount: entry.type === "CR" ? amount : "0",
            narration,
          });
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

      // Sync order charges: if the journal has a customer entry + a CR ledger entry
      // that matches a charge on one of their orders, update that charge automatically
      await syncJournalToOrderCharge(req.session.currentCompanyId!, result.entries, result.voucher.id).catch(() => {});

      // ── Intercompany counterpart sync ─────────────────────────────────────
      // If this voucher is one side of an intercompany transfer pair, scale the
      // counterpart voucher's totalAmount and entries to match the new amount.
      try {
        const [ict] = await db
          .select()
          .from(interCompanyTransfers)
          .where(
            or(eq(interCompanyTransfers.fromVoucherId, voucherId), eq(interCompanyTransfers.toVoucherId, voucherId))
          )
          .limit(1);
        if (ict) {
          const otherVoucherId = ict.fromVoucherId === voucherId ? ict.toVoucherId : ict.fromVoucherId;
          if (otherVoucherId) {
            const newTotal = parseFloat(result.voucher.totalAmount || "0");
            const [otherVoucher] = await db.select().from(vouchers).where(eq(vouchers.id, otherVoucherId));
            if (otherVoucher) {
              const oldTotal = parseFloat(otherVoucher.totalAmount || "0");
              const ratio = oldTotal > 0 ? newTotal / oldTotal : 1;
              const otherEntries = await db
                .select()
                .from(voucherEntries)
                .where(eq(voucherEntries.voucherId, otherVoucherId));
              for (const e of otherEntries) {
                await db
                  .update(voucherEntries)
                  .set({
                    debitAmount: (parseFloat(e.debitAmount || "0") * ratio).toFixed(2),
                    creditAmount: (parseFloat(e.creditAmount || "0") * ratio).toFixed(2),
                  })
                  .where(eq(voucherEntries.id, e.id));
              }
              await db
                .update(vouchers)
                .set({ totalAmount: newTotal.toFixed(2) })
                .where(eq(vouchers.id, otherVoucherId));
              await db
                .update(fde)
                .set({ amountCurrency: newTotal.toFixed(2), amountUsd: newTotal.toFixed(2) })
                .where(and(eq(fde.referenceTable, "vouchers"), eq(fde.referenceId, otherVoucherId)));
            }
          }
        }
      } catch (ictErr: any) {
        console.error("[ICT sync] Counterpart update failed (non-fatal):", ictErr?.message);
      }

      // WhatsApp rule check — prompt the frontend instead of auto-sending
      let waJournalPatch: { prompt: boolean; accountId?: number; voucherDate?: string; month?: string } = {
        prompt: false,
      };
      try {
        let waAccountId = mainAccountIdPatch ? Number(mainAccountIdPatch) : null;
        let waAccountType = mainAccountTypePatch ? String(mainAccountTypePatch) : "ledger";
        if (!waAccountId) {
          const firstLedgerDr = (entries as any[]).find(
            (e) => e.accountType === "ledger" && e.type === "DR" && Number(e.accountId) > 0
          );
          if (firstLedgerDr) {
            waAccountId = Number(firstLedgerDr.accountId);
            waAccountType = "ledger";
          }
        }
        if (waAccountId) {
          waJournalPatch = await checkAccountWhatsAppRule({
            companyId: req.session.currentCompanyId!,
            accountId: waAccountId,
            accountType: waAccountType,
            voucherType: "Journal",
            voucherDate: voucherDate,
          });
        }
      } catch (waErr: any) {
        console.error("WhatsApp rule check error (non-fatal):", waErr);
      }

      try {
        const _oldSnapJ = await snapshotVoucherEntries(result.oldEntries);
        const _newSnapJ = await snapshotVoucherEntries(result.entries);
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
            _oldSnapJ,
            _newSnapJ
          ),
        });
      } catch {
        /* non-fatal */
      }
      logger.info("journal voucher update succeeded", { module: "vouchers", action: "updateJournal", userId: _uid, companyId: _cid, voucherId: result.voucher.id, durationMs: Date.now() - _t });
      res.json({ voucher: result.voucher, entries: result.entries, whatsapp: waJournalPatch });
    } catch (error: any) {
      logger.error("journal voucher update failed", { module: "vouchers", action: "updateJournal", userId: _uid, companyId: _cid, durationMs: Date.now() - _t, error });
      console.error("Error updating journal voucher:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
