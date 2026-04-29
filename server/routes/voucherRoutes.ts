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
import { triggerAccountWhatsAppStatement } from "./factoryWhatsappRoutes";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../netPositionHelper";
import { generatePDF } from "../pdfHelper";
import path from "path";
import fs from "fs";

import { registerVoucherEntryRoutes } from "./voucherEntryRoutes";
import { recalculateOrderTotals } from "./factory/_helpers";
import {
  customerOrderCharges, customerOrders, customerOrderBales, customerOrderLines,
} from "@shared/schema";

export function registerVoucherRoutes(app: Express) {
  app.get("/api/vouchers", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const { startDate, endDate } = req.query;
      
      // Check if user is POS role
      const isPOS = req.session.currentRole?.startsWith("POS");

      let vouchers;
      if (startDate && endDate) {
        vouchers = await storage.getVouchersByDateRange(
          req.session.currentCompanyId,
          startDate as string,
          endDate as string,
        );
      } else {
        vouchers = await storage.getAllVouchers(req.session.currentCompanyId);
      }

      // Strip totalAmount from Stock Transfer vouchers for POS users
      const sanitizedVouchers = isPOS
        ? vouchers.map((v: any) => {
            // Check for all variants of Stock Transfer voucher type
            const isStockTransfer = v.voucherType === "Stock Transfer" || 
                                    v.voucherType === "StockTransfer" ||
                                    v.voucherType?.toLowerCase().includes("stock transfer");
            if (isStockTransfer) {
              const { totalAmount, ...rest } = v;
              return { ...rest, totalAmount: "0" };
            }
            return v;
          })
        : vouchers;

      res.json(sanitizedVouchers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get unified ledger for a supplier across all companies
  app.get(
    "/api/suppliers/:supplierId/unified-ledger",
    requireAuth,
    async (req, res) => {
      try {
        const supplierId = parseInt(req.params.supplierId);

        if (isNaN(supplierId)) {
          return res.status(400).json({ message: "Invalid supplier ID" });
        }

        const { companyId, startDate, endDate } = req.query;
        const filterCompanyId = companyId
          ? parseInt(companyId as string)
          : undefined;

        // Get voucher entries (filtered by company if specified)
        const voucherEntries = await storage.getVoucherEntriesBySupplier(
          supplierId,
          filterCompanyId,
          startDate as string | undefined,
          endDate as string | undefined,
        );

        // Get all companies to map IDs to names
        const companies = await storage.getAllCompanies();
        const companyMap = new Map(companies.map((c) => [c.id, c]));

        // Combine all transactions with company information
        const transactions: any[] = [];

        // Add voucher entries (which already include PO-generated vouchers)
        // No need to add POs separately as they're already represented by voucher entries
        for (const entry of voucherEntries) {
          const company = companyMap.get(entry.companyId);
          transactions.push({
            type: "voucher",
            date: entry.voucherDate,
            companyId: entry.companyId,
            companyName: company?.name || "Unknown",
            docNumber: entry.voucherNumber,
            voucherId: entry.voucherId,
            description: entry.narration || entry.voucherDescription || "",
            voucherType: entry.voucherType,
            debit: parseFloat(entry.debitAmount || "0"),
            credit: parseFloat(entry.creditAmount || "0"),
          });
        }

        // Sort by date ascending (oldest first) for correct running balance
        transactions.sort((a, b) => {
          const dateA = a.date ? new Date(a.date).getTime() : 0;
          const dateB = b.date ? new Date(b.date).getTime() : 0;
          return dateA - dateB;
        });

        // Get supplier opening balance
        const supplier = await storage.getSupplierById(supplierId);
        const globalOpeningBalance = parseFloat(supplier?.openingBalance || "0");

        // Opening balance is a historical property belonging to the PARENT (primary)
        // company.  Sub-companies that transact with the same supplier start from zero.
        // The primary company is the one with the lowest database ID.
        // Use filterCompanyId if set, otherwise fall back to the session company so that
        // viewing "All Companies" from a sub-company session also hides the opening balance.
        const sessionCompanyId = (req.session as any).currentCompanyId;
        const effectiveCompanyId = filterCompanyId ?? sessionCompanyId ?? null;
        const primaryCompanyId =
          companies.length > 0 ? Math.min(...companies.map((c: any) => c.id)) : null;
        const isParentContext = !effectiveCompanyId || effectiveCompanyId === primaryCompanyId;
        const openingBalance = isParentContext ? globalOpeningBalance : 0;

        // Add opening balance as first row if it exists
        const result: any[] = [];
        if (openingBalance !== 0) {
          result.push({
            type: "opening",
            date: null,
            companyId: null,
            companyName: "Opening Balance",
            docNumber: "-",
            voucherId: null,
            description: "Opening Balance",
            voucherType: "Opening",
            debit: 0,
            credit: 0,
            balance: openingBalance,
          });
        }

        // Calculate running balance starting from opening balance
        let balance = openingBalance;
        for (const t of transactions) {
          balance += t.credit - t.debit;
          result.push({ ...t, balance });
        }

        // Extract container numbers from narrations and resolve their IDs so the
        // frontend can build direct links.  Shipping container numbers follow the
        // ISO 6346 format: 4 uppercase letters + 7 digits (e.g. HASU5142160).
        const containerNumRegex = /[A-Z]{4}\d{7}/g;
        const containerNumberSet = new Set<string>();
        for (const t of result) {
          if (t.type !== "opening" && t.description) {
            const matches = t.description.match(containerNumRegex);
            if (matches) matches.forEach((m: string) => containerNumberSet.add(m));
          }
        }

        const containerIdMap = new Map<string, number>();
        if (containerNumberSet.size > 0) {
          const containerRows = await db
            .select({ id: containers.id, containerNumber: containers.containerNumber })
            .from(containers)
            .where(inArray(containers.containerNumber, Array.from(containerNumberSet)));
          for (const c of containerRows) {
            containerIdMap.set(c.containerNumber, c.id);
          }
        }

        for (const t of result) {
          if (t.type !== "opening" && t.description) {
            const matches = t.description.match(containerNumRegex);
            if (matches && matches.length > 0) {
              t.containerNumber = matches[0];
              t.containerId = containerIdMap.get(matches[0]) ?? null;
            }
          }
        }

        res.json(result); // Already in chronological order
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Get purchase orders for a specific supplier filtered by company
  app.get(
    "/api/suppliers/:supplierId/purchase-orders",
    requireAuth,
    async (req, res) => {
      try {
        const supplierId = parseInt(req.params.supplierId);

        if (isNaN(supplierId)) {
          return res.status(400).json({ message: "Invalid supplier ID" });
        }

        const { companyId } = req.query;
        const filterCompanyId = companyId
          ? parseInt(companyId as string)
          : undefined;

        if (!filterCompanyId) {
          // If no company filter, get POs from all companies
          const companies = await storage.getAllCompanies();
          const allPOs: any[] = [];

          for (const company of companies) {
            const pos = await storage.getPurchaseOrdersBySupplier(
              supplierId,
              company.id,
            );
            allPOs.push(
              ...pos.map((po) => ({ ...po, companyName: company.name })),
            );
          }

          return res.json(allPOs);
        }

        const purchaseOrders = await storage.getPurchaseOrdersBySupplier(
          supplierId,
          filterCompanyId,
        );
        const company = await storage.getCompanyById(filterCompanyId);
        const posWithCompanyName = purchaseOrders.map((po) => ({
          ...po,
          companyName: company?.name,
        }));

        res.json(posWithCompanyName);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Create a new voucher
  app.post("/api/vouchers", requireAuth, async (req, res) => {
    try {
      const isPOS = (req as any).user?.role?.startsWith("POS");
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
  app.post(
    "/api/vouchers/with-entries",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const { voucher, entries } = req.body;

        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Validate voucher data
        if (
          !voucher ||
          !entries ||
          !Array.isArray(entries) ||
          entries.length === 0
        ) {
          return res
            .status(400)
            .json({ message: "Voucher and entries are required" });
        }

        // Validate that debits equal credits (only for non-optional vouchers)
        const totalDebits = entries.reduce(
          (sum: number, entry: any) =>
            sum + parseFloat(entry.debitAmount || "0"),
          0,
        );
        const totalCredits = entries.reduce(
          (sum: number, entry: any) =>
            sum + parseFloat(entry.creditAmount || "0"),
          0,
        );

        // For active (non-optional) vouchers, enforce debit=credit balance
        if (!voucher.optional && Math.abs(totalDebits - totalCredits) >= 0.01) {
          return res
            .status(400)
            .json({
              message:
                "Total debits must equal total credits for active vouchers",
            });
        }

        // Create voucher with error handling
        let createdVoucher;
        let createdEntries = [];

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
            const [createdEntry] = await db
              .insert(voucherEntries)
              .values({
                voucherId: createdVoucher.id,
                ledgerAccountId: entry.ledgerAccountId || null,
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
            createdEntries.map(e => ({
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
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "create",
          tableName: "vouchers",
          recordId: createdVoucher.id,
          recordIdentifier: createdVoucher.voucherNumber,
          changes: null,
        });

        res.json(result);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Create Payment or Receipt voucher with all entries in one batch
  app.post(
    "/api/vouchers/payment-receipt",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
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
        } = req.body;

        // Validate required fields
        if (!voucherType || !voucherDate || !paymentAccountId || !entries || !Array.isArray(entries) || entries.length === 0) {
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
        const result = await db.transaction(async (tx) => {
          // Create voucher
          const [createdVoucher] = await tx
            .insert(vouchers)
            .values({
              companyId: req.session.currentCompanyId!,
              voucherNumber,
              voucherType,
              voucherDate,
              description: notes || null,
              totalAmount: total.toFixed(2),
              optional: optional ?? false,
              currency: currency || "USD",
              exchangeRate: exchangeRate || null,
            })
            .returning();

          const voucherEntriesToCreate = [];

          // Create entries based on voucher type
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

            const isLiabilityPaymentAccount = paymentAccountType === "supplier" || paymentAccountType === "factorySupplier" || paymentAccountType === "employee";

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
          const createdEntries = await tx
            .insert(voucherEntries)
            .values(voucherEntriesToCreate)
            .returning();

          return { voucher: createdVoucher, entries: createdEntries };
        });

        // Sync employee balances from voucher entries (only for non-optional vouchers)
        if (!result.voucher.optional) {
          await syncEmployeeBalancesFromEntries(
            result.entries.map(e => ({
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
            });
          }
        } catch (dbErr) {
          console.error("Factory daybook write failed (non-fatal):", dbErr);
        }

        // WhatsApp auto-statement trigger (non-fatal)
        let waResult: { sent: boolean; error?: string } = { sent: false };
        try {
          waResult = await triggerAccountWhatsAppStatement({
            companyId:   req.session.currentCompanyId!,
            accountId:   paymentAccountId,
            accountType: paymentAccountType,
            voucherType: voucherType as "Payment" | "Receipt",
            voucherDate: voucherDate,
          });
        } catch (waErr: any) {
          console.error("WhatsApp trigger error (non-fatal):", waErr);
        }

        res.json({ ...result, whatsapp: waResult });
      } catch (error: any) {
        console.error("Error creating payment/receipt voucher:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Update Payment or Receipt voucher with all entries in one batch
  app.patch(
    "/api/vouchers/:id/payment-receipt",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
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
        } = req.body;

        // Validate required fields
        if (!voucherType || !voucherDate || !paymentAccountId || !entries || !Array.isArray(entries) || entries.length === 0) {
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
          const [existingVoucher] = await tx
            .select()
            .from(vouchers)
            .where(eq(vouchers.id, voucherId));

          if (!existingVoucher) {
            throw new Error("Voucher not found");
          }

          if (existingVoucher.companyId !== req.session.currentCompanyId) {
            throw new Error("Access denied: Voucher belongs to a different company");
          }

          // Get existing entries before deleting (for balance sync)
          const oldEntries = await tx
            .select()
            .from(voucherEntries)
            .where(eq(voucherEntries.voucherId, voucherId));

          // Update voucher
          const [updatedVoucher] = await tx
            .update(vouchers)
            .set({
              voucherType,
              voucherDate,
              description: notes || null,
              totalAmount: total.toFixed(2),
              optional: optional ?? false,
            })
            .where(eq(vouchers.id, voucherId))
            .returning();

          // Delete existing voucher entries
          await tx
            .delete(voucherEntries)
            .where(eq(voucherEntries.voucherId, voucherId));

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

            const isLiabilityPaymentAccount = paymentAccountType === "supplier" || paymentAccountType === "factorySupplier" || paymentAccountType === "employee";

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
          const createdEntries = await tx
            .insert(voucherEntries)
            .values(voucherEntriesToCreate)
            .returning();

          return { voucher: updatedVoucher, entries: createdEntries, oldEntries, wasOptional: existingVoucher.optional };
        });

        // Sync employee balances: reverse old entries if voucher was non-optional
        if (!result.wasOptional) {
          await syncEmployeeBalancesFromEntries(
            result.oldEntries.map(e => ({
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
            result.entries.map(e => ({
              ledgerAccountId: e.ledgerAccountId,
              employeeId: e.employeeId,
              debitAmount: e.debitAmount,
              creditAmount: e.creditAmount,
            })),
            req.session.currentCompanyId!
          );
        }

        // WhatsApp auto-statement trigger (non-fatal)
        let waResultPatch: { sent: boolean; error?: string } = { sent: false };
        try {
          waResultPatch = await triggerAccountWhatsAppStatement({
            companyId:   req.session.currentCompanyId!,
            accountId:   paymentAccountId,
            accountType: paymentAccountType,
            voucherType: voucherType as "Payment" | "Receipt",
            voucherDate: voucherDate,
          });
        } catch (waErr: any) {
          console.error("WhatsApp trigger error (non-fatal):", waErr);
        }

        res.json({ voucher: result.voucher, entries: result.entries, whatsapp: waResultPatch });
      } catch (error: any) {
        console.error("Error updating payment/receipt voucher:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Create Journal voucher with all entries in one batch
  app.post(
    "/api/vouchers/journal",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
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
          mainAccountId,    // optional: ledger account ID to use for WhatsApp auto-statement
          mainAccountType,  // optional: account type for the main account (default: "ledger")
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
          // Create voucher
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
            })
            .returning();

          const voucherEntriesToCreate = [];

          // Create entries
          for (const entry of entries) {
            const amount = entry.amount;
            const narration = notes || null;

            // Determine account field
            const accountField: any = {};
            if (entry.accountType === "ledger") {
              accountField.ledgerAccountId = entry.accountId;
            } else if (entry.accountType === "bank") {
              accountField.bankAccountId = entry.accountId;
            } else if (entry.accountType === "supplier") {
              accountField.supplierId = entry.accountId;
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
          const createdEntries = await tx
            .insert(voucherEntries)
            .values(voucherEntriesToCreate)
            .returning();

          return { voucher: createdVoucher, entries: createdEntries };
        });

        // Sync employee balances from voucher entries (only for non-optional vouchers)
        if (!result.voucher.optional) {
          await syncEmployeeBalancesFromEntries(
            result.entries.map(e => ({
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

        // WhatsApp auto-statement trigger (non-fatal)
        // Resolve main account: prefer explicitly passed mainAccountId,
        // fallback to first ledger-type DR entry in entries array.
        let waJournalResult: { sent: boolean; error?: string } = { sent: false };
        try {
          let waAccountId   = mainAccountId   ? Number(mainAccountId)  : null;
          let waAccountType = mainAccountType ? String(mainAccountType) : "ledger";
          if (!waAccountId) {
            const firstLedgerDr = (entries as any[]).find(
              (e) => e.accountType === "ledger" && e.type === "DR" && Number(e.accountId) > 0
            );
            if (firstLedgerDr) { waAccountId = Number(firstLedgerDr.accountId); waAccountType = "ledger"; }
          }
          if (waAccountId) {
            waJournalResult = await triggerAccountWhatsAppStatement({
              companyId:   req.session.currentCompanyId!,
              accountId:   waAccountId,
              accountType: waAccountType,
              voucherType: "Journal",
              voucherDate: voucherDate,
            });
          }
        } catch (waErr: any) {
          console.error("WhatsApp trigger error (non-fatal):", waErr);
        }

        res.json({ ...result, whatsapp: waJournalResult });
      } catch (error: any) {
        console.error("Error creating journal voucher:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Update Journal voucher with all entries in one batch
  app.patch(
    "/api/vouchers/:id/journal",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
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
          mainAccountId:   mainAccountIdPatch,
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
          const [existingVoucher] = await tx
            .select()
            .from(vouchers)
            .where(eq(vouchers.id, voucherId));

          if (!existingVoucher) {
            throw new Error("Voucher not found");
          }

          if (existingVoucher.companyId !== req.session.currentCompanyId) {
            throw new Error("Access denied: Voucher belongs to a different company");
          }

          // Get existing entries before deleting (for balance sync)
          const oldEntries = await tx
            .select()
            .from(voucherEntries)
            .where(eq(voucherEntries.voucherId, voucherId));

          // Update voucher
          const [updatedVoucher] = await tx
            .update(vouchers)
            .set({
              voucherDate,
              description: notes || null,
              totalAmount: Math.max(totalDebits, totalCredits).toFixed(2),
              optional: optional ?? false,
            })
            .where(eq(vouchers.id, voucherId))
            .returning();

          // Delete existing voucher entries
          await tx
            .delete(voucherEntries)
            .where(eq(voucherEntries.voucherId, voucherId));

          const voucherEntriesToCreate = [];

          // Create new entries
          for (const entry of entries) {
            const amount = entry.amount;
            const narration = notes || null;

            // Determine account field
            const accountField: any = {};
            if (entry.accountType === "ledger") {
              accountField.ledgerAccountId = entry.accountId;
            } else if (entry.accountType === "bank") {
              accountField.bankAccountId = entry.accountId;
            } else if (entry.accountType === "supplier") {
              accountField.supplierId = entry.accountId;
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
          const createdEntries = await tx
            .insert(voucherEntries)
            .values(voucherEntriesToCreate)
            .returning();

          return { voucher: updatedVoucher, entries: createdEntries, oldEntries, wasOptional: existingVoucher.optional };
        });

        // Sync employee balances: reverse old entries if voucher was non-optional
        if (!result.wasOptional) {
          await syncEmployeeBalancesFromEntries(
            result.oldEntries.map(e => ({
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
            result.entries.map(e => ({
              ledgerAccountId: e.ledgerAccountId,
              employeeId: e.employeeId,
              debitAmount: e.debitAmount,
              creditAmount: e.creditAmount,
            })),
            req.session.currentCompanyId!
          );
        }

        // WhatsApp auto-statement trigger (non-fatal)
        let waJournalPatch: { sent: boolean; error?: string } = { sent: false };
        try {
          let waAccountId   = mainAccountIdPatch   ? Number(mainAccountIdPatch)   : null;
          let waAccountType = mainAccountTypePatch ? String(mainAccountTypePatch) : "ledger";
          if (!waAccountId) {
            const firstLedgerDr = (entries as any[]).find(
              (e) => e.accountType === "ledger" && e.type === "DR" && Number(e.accountId) > 0
            );
            if (firstLedgerDr) { waAccountId = Number(firstLedgerDr.accountId); waAccountType = "ledger"; }
          }
          if (waAccountId) {
            waJournalPatch = await triggerAccountWhatsAppStatement({
              companyId:   req.session.currentCompanyId!,
              accountId:   waAccountId,
              accountType: waAccountType,
              voucherType: "Journal",
              voucherDate: voucherDate,
            });
          }
        } catch (waErr: any) {
          console.error("WhatsApp trigger error (non-fatal):", waErr);
        }

        res.json({ voucher: result.voucher, entries: result.entries, whatsapp: waJournalPatch });
      } catch (error: any) {
        console.error("Error updating journal voucher:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  app.get("/api/vouchers/optional", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { type, locationId, startDate, endDate, search } = req.query;

      const conditions: any[] = [
        eq(vouchers.companyId, companyId),
        eq(vouchers.optional, true),
        isNull(vouchers.deletedAt),
      ];

      if (type) {
        conditions.push(eq(vouchers.voucherType, type as string));
      }
      if (locationId) {
        conditions.push(eq(vouchers.locationId, parseInt(locationId as string)));
      }
      if (startDate) {
        conditions.push(sql`${vouchers.voucherDate} >= ${startDate as string}`);
      }
      if (endDate) {
        conditions.push(sql`${vouchers.voucherDate} <= ${endDate as string}`);
      }

      const results = await db
        .select()
        .from(vouchers)
        .where(and(...conditions))
        .orderBy(sql`${vouchers.voucherDate} DESC`);

      let filtered = results;
      if (search) {
        const s = (search as string).toLowerCase();
        filtered = filtered.filter(r =>
          r.voucherNumber.toLowerCase().includes(s) ||
          (r.description || "").toLowerCase().includes(s) ||
          (r.locationName || "").toLowerCase().includes(s)
        );
      }

      res.json(filtered);
    } catch (error: any) {
      console.error("Optional vouchers error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get a specific voucher with all entries and related data
  app.get("/api/vouchers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const voucher = await storage.getVoucherById(id);
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

      const entries = await storage.getVoucherEntriesByVoucher(id);

      // If this is a Purchase voucher, also fetch the linked purchase order
      let purchaseOrder = null;
      if (voucher.voucherType === "Purchase") {
        const allPOs = await storage.getAllPurchaseOrders(voucher.companyId);
        const linkedPO = allPOs.find((po) => po.voucherId === id);
        if (linkedPO) {
          const lineItems = await storage.getLineItemsByPO(linkedPO.id);
          purchaseOrder = {
            ...linkedPO,
            items: lineItems,
          };
        }
      }

      // If this is a Sales voucher, also fetch the linked sales items
      let salesItemsList = null;
      if (voucher.voucherType === "Sales") {
        const items = await db
          .select()
          .from(salesItems)
          .where(eq(salesItems.voucherId, id));

        if (items.length > 0) {
          const itemsWithDetails = await Promise.all(
            items.map(async (item) => {
              const stockItem = await storage.getStockItemById(
                item.stockItemId,
              );
              
              // Use stored configured price if available, otherwise fall back to live lookup
              let configuredPrice = item.configuredPrice || "0";
              if ((!configuredPrice || configuredPrice === "0") && voucher.locationId) {
                const [locationPrice] = await db
                  .select()
                  .from(stockItemLocationPrices)
                  .where(
                    and(
                      eq(stockItemLocationPrices.stockItemId, item.stockItemId),
                      eq(stockItemLocationPrices.locationId, voucher.locationId)
                    )
                  )
                  .limit(1);
                if (locationPrice) {
                  configuredPrice = locationPrice.sellingPrice || "0";
                }
              }
              
              const qty = parseFloat(item.quantity || "0");
              const configuredPriceNum = parseFloat(configuredPrice);
              const actualPrice = parseFloat(item.sellingPrice || "0");
              const costPrice = parseFloat(item.costPrice || "0");
              
              // Hassan's Profit = (Actual Selling Price - Configured Price) * Qty
              const hassansProfit = (actualPrice - configuredPriceNum) * qty;
              // Hassan's Total = Configured Price * Qty
              const hassansTotal = configuredPriceNum * qty;
              // Hassan's % = (Hassan's Profit / Hassan's Total) * 100
              const hassansPercentage = hassansTotal > 0 ? (hassansProfit / hassansTotal) * 100 : 0;
              
              return {
                ...item,
                stockItemCode: stockItem?.code || "",
                stockItemName: stockItem?.name || "",
                stockItemUom: stockItem?.uom || "",
                configuredPrice,
                hassansProfit: hassansProfit.toFixed(2),
                hassansTotal: hassansTotal.toFixed(2),
                hassansPercentage: hassansPercentage.toFixed(1),
              };
            }),
          );
          salesItemsList = itemsWithDetails;
        }
      }

      // If this is a Consumption, Mixed, or Production voucher, fetch adjustment details
      let adjustmentData = null;
      if (
        voucher.voucherType === "Consumption" ||
        voucher.voucherType === "Mixed" ||
        voucher.voucherType === "Production"
      ) {
        const adjustment = await db
          .select()
          .from(stockAdjustmentVouchers)
          .where(eq(stockAdjustmentVouchers.voucherId, id))
          .limit(1);

        if (adjustment.length > 0) {
          const items = await db
            .select()
            .from(stockAdjustmentItems)
            .where(eq(stockAdjustmentItems.adjustmentId, adjustment[0].id));

          const itemsWithDetails = await Promise.all(
            items.map(async (item) => {
              const stockItem = await storage.getStockItemById(
                item.stockItemId,
              );
              return {
                ...item,
                stockItemCode: stockItem?.code || "",
                stockItemName: stockItem?.name || "",
                stockItemUom: stockItem?.uom || "",
              };
            }),
          );

          const location = await storage.getLocationById(
            adjustment[0].locationId,
          );

          adjustmentData = {
            ...adjustment[0],
            locationName: location?.name || "",
            items: itemsWithDetails,
          };
        } else {
          // No adjustment record exists - return empty structure so frontend can show form
          let adjustmentType = "production";
          if (voucher.voucherType === "Consumption")
            adjustmentType = "consumption";
          else if (voucher.voucherType === "Mixed") adjustmentType = "mixed";

          adjustmentData = {
            id: 0,
            voucherId: id,
            locationId: voucher.locationId || 1,
            locationName: "",
            adjustmentType: adjustmentType,
            notes: voucher.description || "",
            items: [],
            createdAt: new Date(),
          };
        }
      }

      // If this is a Stock Transfer voucher, fetch transfer details
      let transferData = null;
      if (voucher.voucherType === "Stock Transfer") {
        const transfer = await db
          .select()
          .from(stockTransferVouchers)
          .where(eq(stockTransferVouchers.voucherId, id))
          .limit(1);

        if (transfer.length > 0) {
          const items = await db
            .select()
            .from(stockTransferItems)
            .where(eq(stockTransferItems.transferId, transfer[0].id));

          const itemsWithDetails = await Promise.all(
            items.map(async (item) => {
              const stockItem = await storage.getStockItemById(
                item.stockItemId,
              );
              return {
                ...item,
                stockItemCode: stockItem?.code || "",
                stockItemName: stockItem?.name || "",
                stockItemUom: stockItem?.uom || "",
              };
            }),
          );

          const sourceLocation = await storage.getLocationById(
            transfer[0].sourceLocationId!,
          );
          const destLocation = await storage.getLocationById(
            transfer[0].destinationLocationId!,
          );

          transferData = {
            ...transfer[0],
            sourceLocationName: sourceLocation?.name || "",
            destinationLocationName: destLocation?.name || "",
            items: itemsWithDetails,
          };
        } else {
          // No transfer record exists - return empty structure so frontend can show form
          transferData = {
            id: 0,
            voucherId: id,
            sourceLocationId: voucher.locationId || 1,
            destinationLocationId: voucher.locationId || 1,
            sourceLocationName: "",
            destinationLocationName: "",
            notes: voucher.description || "",
            items: [],
            createdAt: new Date(),
          };
        }
      }

      // For credit sales, resolve customer name from the voucher entries.
      // Credit sale entries store the customer receivable account via ledgerAccountId
      // (not customerId). getVoucherEntriesByVoucher already joins ledgerAccounts and
      // returns accountName, so we just find the debit entry and use its accountName.
      let customerName: string | null = null;
      if (voucher.isCreditSale) {
        const debitEntry = entries.find((e: any) => parseFloat(e.debitAmount || "0") > 0);
        if (debitEntry?.accountName && debitEntry.accountName !== "Unknown Account") {
          customerName = debitEntry.accountName;
        }
      }

      res.json({
        ...voucher,
        entries,
        purchaseOrder,
        salesItems: salesItemsList,
        adjustmentData,
        transferData,
        customerName,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update a voucher with entries (Admin, Owner, or Manager for today's vouchers)
  app.patch(
    "/api/vouchers/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid voucher ID" });
        }

        // Get the existing voucher to check company and permissions
        const existingVoucher = await storage.getVoucherById(id);
        if (!existingVoucher) {
          return res.status(404).json({ message: "Voucher not found" });
        }

        // Verify voucher belongs to current company (respect factory mode company)
        const effectiveCompanyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
        if (existingVoucher.companyId !== effectiveCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Voucher belongs to a different company",
            });
        }

        // Check edit permissions based on role
        const userRole = req.session.currentRole;
        if (!userRole) {
          return res.status(403).json({ message: "User role not found" });
        }

        // Admin and Owner can edit all vouchers
        if (userRole !== "Admin" && userRole !== "Owner") {
          // Manager can only edit today's vouchers
          if (userRole === "Manager") {
            const voucherDate = new Date(existingVoucher.voucherDate);
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
              .json({ message: "Insufficient permissions to edit vouchers" });
          }
        }

        // Get old entries before updating (for balance sync)
        const oldEntries = await storage.getVoucherEntriesByVoucher(id);
        const wasOptional = existingVoucher.optional;

        // Update voucher and entries in a transaction
        await db.transaction(async (tx) => {
          // Update voucher header
          const voucherUpdates: Partial<any> = {};
          if (req.body.voucherDate !== undefined)
            voucherUpdates.voucherDate = req.body.voucherDate;
          if (req.body.description !== undefined)
            voucherUpdates.description = req.body.description;
          if (req.body.optional !== undefined)
            voucherUpdates.optional = req.body.optional;

          // Handle inventory changes when toggling optional status
          if (req.body.optional !== undefined && existingVoucher.optional !== req.body.optional) {
            const wasOptional = existingVoucher.optional;
            const willBeOptional = req.body.optional;

            // Check if there are stock operations linked to this voucher
            const hasStockTransfer = await tx
              .select()
              .from(stockTransferVouchers)
              .where(eq(stockTransferVouchers.voucherId, id))
              .limit(1);
            
            const hasStockAdjustment = await tx
              .select()
              .from(stockAdjustmentVouchers)
              .where(eq(stockAdjustmentVouchers.voucherId, id))
              .limit(1);

            if (hasStockTransfer.length > 0) {
              const transfer = hasStockTransfer[0];
              const items = await tx
                .select()
                .from(stockTransferItems)
                .where(eq(stockTransferItems.transferId, transfer.id));

              for (const item of items) {
                const sourceLocId = item.sourceLocationId ?? transfer.sourceLocationId;
                const quantity = parseFloat(item.quantity);
                const rate = parseFloat(item.rate);

                // Guard on inventoryApplied: only reverse if inventory was actually applied,
                // only apply if inventory was not already applied. This prevents stock
                // corruption for legacy transfers (inventoryApplied=false on non-optional)
                // and for any edge case where the flag is out of sync with the optional flag.
                if (willBeOptional && transfer.inventoryApplied) {
                  // Reverse: inventory was applied, now marking optional → undo it
                  await adjustInventory(tx, sourceLocId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                  await adjustInventory(tx, transfer.destinationLocationId, item.stockItemId, -quantity, existingVoucher.companyId);
                } else if (!willBeOptional && !transfer.inventoryApplied) {
                  // Apply: inventory was not applied, now marking non-optional → apply it
                  await adjustInventory(tx, sourceLocId, item.stockItemId, -quantity, existingVoucher.companyId);
                  await adjustInventory(tx, transfer.destinationLocationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                }
                // else: inventory state already matches target state — no-op (prevents double moves)
              }

              // CRITICAL: sync inventoryApplied so that a subsequent PUT /api/stock-transfers/:id
              // call (e.g. from StockTransferOrder edit) does not double-apply or double-reverse
              // inventory. This mirrors the same update in PATCH /api/vouchers/:id/optional.
              await tx
                .update(stockTransferVouchers)
                .set({ inventoryApplied: !willBeOptional })
                .where(eq(stockTransferVouchers.id, transfer.id));
            }

            if (hasStockAdjustment.length > 0) {
              const adjustment = hasStockAdjustment[0];
              const items = await tx
                .select()
                .from(stockAdjustmentItems)
                .where(eq(stockAdjustmentItems.adjustmentId, adjustment.id));

              for (const item of items) {
                const rawQuantity = parseFloat(item.quantity);
                const quantity = Math.abs(rawQuantity);
                const rate = parseFloat(item.rate);
                
                // For Mixed adjustments, check the item's quantity sign:
                //   - Positive quantity = production (added)
                //   - Negative quantity = consumption (subtracted)
                const adjustmentType = adjustment.adjustmentType;
                const isProduction = adjustmentType === "Production" || 
                  (adjustmentType === "Mixed" && rawQuantity > 0);

                if (willBeOptional) {
                  // Reversing the adjustment
                  if (isProduction) {
                    // Reverse production: subtract what was added
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
                  } else {
                    // Reverse consumption: add back what was subtracted
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                  }
                } else {
                  // Applying the adjustment
                  if (isProduction) {
                    // Apply production: add to inventory
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                  } else {
                    // Apply consumption: subtract from inventory
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
                  }
                }
              }
            }

            // Handle Sales items inventory when toggling optional
            const hasSalesItems = await tx
              .select()
              .from(salesItems)
              .where(eq(salesItems.voucherId, id));

            if (hasSalesItems.length > 0 && existingVoucher.locationId) {
              for (const item of hasSalesItems) {
                const quantity = parseFloat(item.quantity);
                const costPrice = parseFloat(item.costPrice);
                if (willBeOptional) {
                  // Reverse: add back stock that was deducted by the sale
                  await adjustInventory(tx, existingVoucher.locationId, item.stockItemId, quantity, existingVoucher.companyId, costPrice);
                } else {
                  // Apply: deduct stock for the sale
                  await adjustInventory(tx, existingVoucher.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
                }
              }
            }

            // Handle Credit Note items inventory when toggling optional
            const hasCreditNoteItems = await tx
              .select()
              .from(creditNoteItems)
              .where(eq(creditNoteItems.voucherId, id));

            if (hasCreditNoteItems.length > 0) {
              for (const item of hasCreditNoteItems) {
                const quantity = parseFloat(item.quantity);
                const rate = parseFloat(item.rate);
                if (willBeOptional) {
                  // Reverse: remove stock that was added by the credit note (customer return)
                  await adjustInventory(tx, item.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
                } else {
                  // Apply: add stock back for the credit note (customer return)
                  await adjustInventory(tx, item.locationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                }
              }
            }
          }

          await tx
            .update(vouchers)
            .set(voucherUpdates)
            .where(eq(vouchers.id, id));

          // Delete all existing entries
          await tx
            .delete(voucherEntries)
            .where(eq(voucherEntries.voucherId, id));

          // Insert new entries if provided
          if (req.body.entries && Array.isArray(req.body.entries)) {
            for (const entry of req.body.entries) {
              await tx.insert(voucherEntries).values({
                voucherId: id,
                ledgerAccountId: entry.ledgerAccountId || null,
                bankAccountId: entry.bankAccountId || null,
                supplierId: entry.supplierId || null,
                employeeId: entry.employeeId || null,
                fixedAssetId: entry.fixedAssetId || null,
                debitAmount: entry.debitAmount || "0",
                creditAmount: entry.creditAmount || "0",
                narration: entry.narration || "",
              });
            }
          }
        });

        // Fetch updated voucher with entries
        const updated = await storage.getVoucherById(id);
        const newEntries = await storage.getVoucherEntriesByVoucher(id);

        // Sync employee balances: reverse old entries if voucher was non-optional
        if (!wasOptional && req.session.currentCompanyId) {
          await syncEmployeeBalancesFromEntries(
            oldEntries.map(e => ({
              ledgerAccountId: e.ledgerAccountId,
              employeeId: e.employeeId,
              debitAmount: e.debitAmount,
              creditAmount: e.creditAmount,
            })),
            req.session.currentCompanyId,
            true // reverse
          );
        }

        // Apply new entries if voucher is now non-optional
        const isNowOptional = req.body.optional !== undefined ? req.body.optional : wasOptional;
        if (!isNowOptional && req.session.currentCompanyId) {
          await syncEmployeeBalancesFromEntries(
            newEntries.map(e => ({
              ledgerAccountId: e.ledgerAccountId,
              employeeId: e.employeeId,
              debitAmount: e.debitAmount,
              creditAmount: e.creditAmount,
            })),
            req.session.currentCompanyId
          );
        }

        res.json({ ...updated, entries: newEntries });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Custom error class for validation errors
  class ValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ValidationError';
    }
  }

  // Toggle optional status for a voucher
  app.patch(
    "/api/vouchers/:id/optional",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid voucher ID" });
        }

        const { optional } = req.body;
        if (typeof optional !== "boolean") {
          return res
            .status(400)
            .json({ message: "Optional must be a boolean value" });
        }

        // Get the existing voucher to check company and permissions
        const existingVoucher = await storage.getVoucherById(id);
        if (!existingVoucher) {
          return res.status(404).json({ message: "Voucher not found" });
        }

        // Verify voucher belongs to current company
        if (existingVoucher.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Voucher belongs to a different company",
            });
        }

        // Only Admin and Owner can toggle optional status
        const userRole = req.session.currentRole;
        if (userRole !== "Admin" && userRole !== "Owner") {
          return res
            .status(403)
            .json({
              message: "Only Admin and Owner can toggle optional status",
            });
        }

        const wasOptional = existingVoucher.optional;
        const willBeOptional = optional;

        // Wrap entire optional toggle in a transaction
        await db.transaction(async (tx) => {
          // Check if there are stock operations linked to this voucher
          const hasStockTransfer = await tx
            .select()
            .from(stockTransferVouchers)
            .where(eq(stockTransferVouchers.voucherId, id))
            .limit(1);
          
          const hasStockAdjustment = await tx
            .select()
            .from(stockAdjustmentVouchers)
            .where(eq(stockAdjustmentVouchers.voucherId, id))
            .limit(1);

          // Handle inventory changes when toggling optional status
          // If changing from false→true: reverse inventory changes
          // If changing from true→false: apply inventory changes
          if (wasOptional !== willBeOptional) {
          if (hasStockTransfer.length > 0) {
            const transfer = hasStockTransfer[0];
            const items = await tx
              .select()
              .from(stockTransferItems)
              .where(eq(stockTransferItems.transferId, transfer.id));

              for (const item of items) {
                const sourceLocId = item.sourceLocationId ?? transfer.sourceLocationId;
                const quantity = parseFloat(item.quantity);
                const rate = parseFloat(item.rate);

                // Guard on inventoryApplied: only reverse if inventory was actually applied,
                // only apply if inventory was not already applied. Prevents stock corruption
                // from double-toggling or legacy transfers with mismatched flag states.
                if (willBeOptional && transfer.inventoryApplied) {
                  // Reverse: inventory was applied, now marking optional → undo it
                  await adjustInventory(tx, sourceLocId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                  await adjustInventory(tx, transfer.destinationLocationId, item.stockItemId, -quantity, existingVoucher.companyId);
                } else if (!willBeOptional && !transfer.inventoryApplied) {
                  // Apply: inventory was not applied, now marking non-optional → apply it
                  await adjustInventory(tx, sourceLocId, item.stockItemId, -quantity, existingVoucher.companyId);
                  await adjustInventory(tx, transfer.destinationLocationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                }
                // else: already in the correct applied/unapplied state — no-op
              }

              // CRITICAL: sync inventoryApplied on the transfer record so that
              // a subsequent updateStockTransfer call knows the correct state and
              // does not double-apply or double-reverse inventory.
              await tx
                .update(stockTransferVouchers)
                .set({ inventoryApplied: !willBeOptional })
                .where(eq(stockTransferVouchers.id, transfer.id));
          }

          if (hasStockAdjustment.length > 0) {
            const adjustment = hasStockAdjustment[0];
            const items = await tx
              .select()
              .from(stockAdjustmentItems)
              .where(eq(stockAdjustmentItems.adjustmentId, adjustment.id));

              for (const item of items) {
                const rawQuantity = parseFloat(item.quantity);
                const quantity = Math.abs(rawQuantity);
                const rate = parseFloat(item.rate);
                
                // For Mixed adjustments, check the item's quantity sign:
                //   - Positive quantity = production (added)
                //   - Negative quantity = consumption (subtracted)
                const adjustmentType = adjustment.adjustmentType;
                const isProduction = adjustmentType === "Production" || 
                  (adjustmentType === "Mixed" && rawQuantity > 0);

                if (willBeOptional) {
                  // Reversing the adjustment
                  if (isProduction) {
                    // Reverse production: subtract what was added
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
                  } else {
                    // Reverse consumption: add back what was subtracted
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                  }
                } else {
                  // Applying the adjustment
                  if (isProduction) {
                    // Apply production: add to inventory
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
                  } else {
                    // Apply consumption: subtract from inventory
                    await adjustInventory(tx, adjustment.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
                  }
                }
              }
          }

          // Handle Sales items inventory when toggling optional
          const hasSalesItems = await tx
            .select()
            .from(salesItems)
            .where(eq(salesItems.voucherId, id));

          if (hasSalesItems.length > 0 && existingVoucher.locationId) {
            for (const item of hasSalesItems) {
              const quantity = parseFloat(item.quantity);
              const costPrice = parseFloat(item.costPrice);
              if (willBeOptional) {
                // Reverse: add back stock that was deducted by the sale
                await adjustInventory(tx, existingVoucher.locationId, item.stockItemId, quantity, existingVoucher.companyId, costPrice);
              } else {
                // Apply: deduct stock for the sale
                await adjustInventory(tx, existingVoucher.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
              }
            }
          }

          // Handle Credit Note items inventory when toggling optional
          const hasCreditNoteItems = await tx
            .select()
            .from(creditNoteItems)
            .where(eq(creditNoteItems.voucherId, id));

          if (hasCreditNoteItems.length > 0) {
            for (const item of hasCreditNoteItems) {
              const quantity = parseFloat(item.quantity);
              const rate = parseFloat(item.rate);
              if (willBeOptional) {
                // Reverse: remove stock that was added by the credit note (customer return)
                await adjustInventory(tx, item.locationId, item.stockItemId, -quantity, existingVoucher.companyId);
              } else {
                // Apply: add stock back for the credit note (customer return)
                await adjustInventory(tx, item.locationId, item.stockItemId, quantity, existingVoucher.companyId, rate);
              }
            }
          }
          }

          // Update the optional field inside transaction
          await tx
            .update(vouchers)
            .set({ optional })
            .where(eq(vouchers.id, id));
        });
        // Log the optional status change to audit log
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "update",
          tableName: "vouchers",
          recordId: id,
          recordIdentifier: existingVoucher.voucherNumber,
          changes: { optional: { old: wasOptional, new: willBeOptional } },
        });

        // Sync employee balances when optional status changes
        if (wasOptional !== willBeOptional && req.session.currentCompanyId) {
          const entries = await storage.getVoucherEntriesByVoucher(id);
          if (willBeOptional) {
            // Voucher is becoming optional - reverse entries' effects
            await syncEmployeeBalancesFromEntries(
              entries.map(e => ({
                ledgerAccountId: e.ledgerAccountId,
                employeeId: e.employeeId,
                debitAmount: e.debitAmount,
                creditAmount: e.creditAmount,
              })),
              req.session.currentCompanyId,
              true // reverse
            );
          } else {
            // Voucher is becoming active - apply entries' effects
            await syncEmployeeBalancesFromEntries(
              entries.map(e => ({
                ledgerAccountId: e.ledgerAccountId,
                employeeId: e.employeeId,
                debitAmount: e.debitAmount,
                creditAmount: e.creditAmount,
              })),
              req.session.currentCompanyId
            );
          }
        }

        // Fetch updated voucher outside transaction
        const updated = await storage.getVoucherById(id);
        res.json(updated);
      } catch (error: any) {
        if (error.name === 'ValidationError') {
          return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Update a sales voucher with line items
  app.patch("/api/vouchers/:id/sales", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const {
        voucherDate,
        description,
        locationId,
        items,
        paymentAccountType,
        paymentAccountId,
        isCreditSale,
      } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res
          .status(400)
          .json({ message: "At least one item is required" });
      }

      // Get the existing voucher to check company and permissions
      const existingVoucher = await storage.getVoucherById(id);
      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Verify this is a Sales voucher
      if (existingVoucher.voucherType !== "Sales") {
        return res
          .status(400)
          .json({ message: "This endpoint only updates Sales vouchers" });
      }

      // Verify voucher belongs to current company
      if (existingVoucher.companyId !== req.session.currentCompanyId) {
        return res
          .status(403)
          .json({
            message: "Access denied: Voucher belongs to a different company",
          });
      }

      // Check edit permissions based on role
      const userRole = req.session.currentRole;
      if (!userRole) {
        return res.status(403).json({ message: "User role not found" });
      }

      // Admin and Owner can edit all vouchers
      if (userRole !== "Admin" && userRole !== "Owner") {
        // Manager can only edit today's vouchers
        if (userRole === "Manager") {
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const voucherDate = new Date(existingVoucher.voucherDate);
          voucherDate.setHours(0, 0, 0, 0);

          if (voucherDate.getTime() !== today.getTime()) {
            return res
              .status(403)
              .json({ message: "Managers can only edit today's vouchers" });
          }
        } else {
          // POS users can edit if they have daybookEditDays permission > 0
          const daybookEditDays = req.session.daybookEditDays || 0;
          if (daybookEditDays <= 0) {
            return res
              .status(403)
              .json({ message: "Insufficient permissions to edit vouchers" });
          }
          // Check if voucher date is within allowed days
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const voucherDate = new Date(existingVoucher.voucherDate);
          voucherDate.setHours(0, 0, 0, 0);

          const daysDiff = Math.floor((today.getTime() - voucherDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff >= daybookEditDays) {
            return res
              .status(403)
              .json({ message: `You can only edit vouchers from the last ${daybookEditDays} day(s)` });
          }
        }
      }

      // Validate and authorize location if provided
      let validatedLocationId: number | null = null;
      if (locationId !== undefined && locationId !== null) {
        const parsedLocationId = parseInt(locationId);
        if (isNaN(parsedLocationId) || parsedLocationId <= 0) {
          return res.status(400).json({ message: "Invalid location ID" });
        }

        // Verify location belongs to current company
        const [targetLocation] = await db
          .select()
          .from(locations)
          .where(eq(locations.id, parsedLocationId));

        if (!targetLocation) {
          return res.status(404).json({ message: "Location not found" });
        }

        if (targetLocation.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Location belongs to a different company",
            });
        }

        validatedLocationId = parsedLocationId;
      }

      // Fetch stock items to calculate cost prices
      const stockItemIds = items.map((item) => item.stockItemId);
      const stockItemsData = await db
        .select()
        .from(stockItems)
        .where(inArray(stockItems.id, stockItemIds));

      const stockItemsMap = new Map(
        stockItemsData.map((item) => [item.id, item]),
      );

      // Calculate totals and prepare items data
      let totalSalesAmount = 0;
      const salesItemsData = items.map((item: any) => {
        const stockItem = stockItemsMap.get(item.stockItemId);
        if (!stockItem) {
          throw new Error(`Stock item ${item.stockItemId} not found`);
        }

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
        };
      });

      // STEPS 1-4: Reverse old inventory, delete old items, deduct new inventory, insert new items - all atomically
      const oldSalesItems = await db
        .select()
        .from(salesItems)
        .where(eq(salesItems.voucherId, id));

      const targetLocationId =
        validatedLocationId !== null
          ? validatedLocationId
          : existingVoucher.locationId;

      await db.transaction(async (tx) => {
        // STEP 1: Reverse inventory for old sales items
        if (existingVoucher.locationId) {
          for (const oldItem of oldSalesItems) {
            const quantity = parseFloat(oldItem.quantity);
            const costPrice = parseFloat(oldItem.costPrice);
            await adjustInventory(tx, existingVoucher.locationId, oldItem.stockItemId, quantity, existingVoucher.companyId, costPrice);
          }
        }

        // STEP 2: Delete existing sales items
        await tx.delete(salesItems).where(eq(salesItems.voucherId, id));

        // STEP 3: Deduct inventory for new sales items from the new location
        if (targetLocationId) {
          const updatedSalesItemsData: typeof salesItemsData = [];
          
          for (const newItem of salesItemsData) {
            const quantity = parseFloat(newItem.quantity);

            // Get current average rate before deducting to use as cost price
            const invResult = await adjustInventory(tx, targetLocationId, newItem.stockItemId, -quantity, existingVoucher.companyId);
            const actualCostPrice = invResult.averageRate || parseFloat(newItem.costPrice);
            
            const sellingPrice = parseFloat(newItem.sellingPrice);
            const totalSales = quantity * sellingPrice;
            const totalCost = quantity * actualCostPrice;
            const profit = totalSales - totalCost;

            // Look up configured price for this location
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
          }
          
          salesItemsData.length = 0;
          salesItemsData.push(...updatedSalesItemsData);
        } else {
          // No targetLocationId — still try to add configuredPrice if we know it
          for (const newItem of salesItemsData) {
            (newItem as any).configuredPrice = null;
          }
        }

        // STEP 4: Insert new sales items
        await tx.insert(salesItems).values(salesItemsData);
      });

      // STEP 5: Update voucher entries (accounting transactions)
      // NOTE: POS Sales vouchers in this system are ALWAYS 2-entry transactions:
      //   1. Debit: Cash/Bank/Customer Account (payment account)
      //   2. Credit: Sales Revenue Account
      // This is confirmed by the POST /api/pos/sales endpoint (lines ~5420-5446) which creates exactly 2 entries.
      // No taxes, COGS, or other entries exist for POS sales in the current implementation.
      // If payment info is not provided, derive it from existing entries
      let finalPaymentAccountId = paymentAccountId;
      let finalPaymentAccountType = paymentAccountType;
      let finalIsCreditSale = isCreditSale;
      let finalCreditCustomerName = ""; // captured when credit-sale customer account is found

      if (!finalPaymentAccountId || !finalPaymentAccountType) {
        // Fetch existing voucher entries to derive payment account
        const existingEntries = await db
          .select()
          .from(voucherEntries)
          .where(eq(voucherEntries.voucherId, id));

        // Find the debit entry that represents the payment account
        // Priority: bank account > cash ledger > other ledger (customer/receivable)
        const debitEntries = existingEntries.filter(
          (entry) => parseFloat(entry.debitAmount || "0") > 0,
        );

        // Check for bank account first
        let existingDebitEntry = debitEntries.find(
          (entry) => entry.bankAccountId !== null,
        );
        if (existingDebitEntry) {
          finalPaymentAccountId = String(existingDebitEntry.bankAccountId);
          finalPaymentAccountType = "bank";
          finalIsCreditSale = false;
        } else {
          // Check for ledger accounts - need to fetch ledger details to identify type
          for (const entry of debitEntries) {
            if (entry.ledgerAccountId) {
              const [ledgerAccount] = await db
                .select()
                .from(ledgerAccounts)
                .where(eq(ledgerAccounts.id, entry.ledgerAccountId))
                .limit(1);

              if (ledgerAccount) {
                if (ledgerAccount.accountType === "Cash") {
                  // Found cash account
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
                  // Found customer receivable account (credit sale)
                  finalPaymentAccountId = String(entry.ledgerAccountId);
                  finalPaymentAccountType = "credit";
                  finalIsCreditSale = true;
                  finalCreditCustomerName = ledgerAccount.name; // save for narration
                  existingDebitEntry = entry;
                  break;
                }
              }
            }
          }
        }
      }

      // Only proceed if we have payment account information
      if (finalPaymentAccountId && finalPaymentAccountType) {
        // EARLY VALIDATION: Check Sales account type BEFORE any destructive operations
        const allAccountsForValidation = await storage.getAllLedgerAccounts(existingVoucher.companyId);
        let salesAccountCheck = allAccountsForValidation.find((a: any) => a.code === "SALES");
        
        if (salesAccountCheck && salesAccountCheck.accountType !== "Income") {
          return res.status(400).json({
            message: `The SALES account is configured with type "${salesAccountCheck.accountType}" but must be type "Income" for POS sales to work correctly.`,
          });
        }
        
        // Delete old voucher entries
        await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, id));

        const accountId = parseInt(finalPaymentAccountId);
        const accountType = finalPaymentAccountType;

        // If credit sale customer name wasn't captured during detection (came from request body),
        // look it up now so we can build the correct narration
        if (finalIsCreditSale && !finalCreditCustomerName && accountType === "credit") {
          const [customerLedger] = await db
            .select({ name: ledgerAccounts.name })
            .from(ledgerAccounts)
            .where(eq(ledgerAccounts.id, accountId))
            .limit(1);
          if (customerLedger) finalCreditCustomerName = customerLedger.name;
        }

        // Debit: Cash/Bank/Customer Account (Asset increases)
        const debitEntry: any = {
          voucherId: id,
          debitAmount: totalSalesAmount.toFixed(2),
          creditAmount: "0",
          narration: finalIsCreditSale
            ? `POS - ${finalCreditCustomerName} - ${existingVoucher.locationName || ""}`
            : `POS Sale - ${existingVoucher.voucherNumber}`,
        };

        if (
          finalIsCreditSale ||
          accountType === "cash" ||
          accountType === "credit"
        ) {
          // For credit sales and cash accounts, use ledgerAccountId
          debitEntry.ledgerAccountId = accountId;
        } else {
          // For bank accounts, use bankAccountId
          debitEntry.bankAccountId = accountId;
        }

        await db.insert(voucherEntries).values(debitEntry);

        // Credit: Sales Account (Revenue increases)
        // Get or create SALES revenue account for this company
        const allAccounts = await storage.getAllLedgerAccounts(existingVoucher.companyId);
        let salesAccount = allAccounts.find((a: any) => a.code === "SALES");

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
        throw new Error(
          "Unable to determine payment account for voucher update",
        );
      }

      // Update the voucher
      const voucherUpdates: any = {
        totalAmount: totalSalesAmount.toFixed(2),
      };
      if (voucherDate !== undefined) voucherUpdates.voucherDate = voucherDate;
      if (description !== undefined) voucherUpdates.description = description;
      if (validatedLocationId !== null) {
        voucherUpdates.locationId = validatedLocationId;
        // Also save the location name for when the location is later deleted
        const location = await storage.getLocationById(validatedLocationId);
        if (location) {
          voucherUpdates.locationName = location.name;
        }
      }

      const updated = await db
        .update(vouchers)
        .set(voucherUpdates)
        .where(eq(vouchers.id, id))
        .returning();

      res.json(updated[0]);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update a purchase voucher with line items
  app.patch(
    "/api/vouchers/:id/purchase",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid voucher ID" });
        }

        const { voucherDate, description, items } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
          return res
            .status(400)
            .json({ message: "At least one item is required" });
        }

        // Get the existing voucher to check company and permissions
        const existingVoucher = await storage.getVoucherById(id);
        if (!existingVoucher) {
          return res.status(404).json({ message: "Voucher not found" });
        }

        // Verify this is a Purchase voucher
        if (existingVoucher.voucherType !== "Purchase") {
          return res
            .status(400)
            .json({ message: "This endpoint only updates Purchase vouchers" });
        }

        // Verify voucher belongs to current company
        if (existingVoucher.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Voucher belongs to a different company",
            });
        }

        // Check edit permissions based on role
        const userRole = req.session.currentRole;
        if (!userRole) {
          return res.status(403).json({ message: "User role not found" });
        }

        // Admin and Owner can edit all vouchers
        if (userRole !== "Admin" && userRole !== "Owner") {
          // Manager can only edit today's vouchers
          if (userRole === "Manager") {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const voucherDate = new Date(existingVoucher.voucherDate);
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
              .json({ message: "Insufficient permissions to edit vouchers" });
          }
        }

        // Find the associated purchase order
        const [po] = await db
          .select()
          .from(purchaseOrders)
          .where(eq(purchaseOrders.voucherId, id))
          .limit(1);

        if (!po) {
          return res
            .status(404)
            .json({ message: "Associated purchase order not found" });
        }

        // Store old total for container update calculation
        const oldPOTotal = parseFloat(po.itemsTotal || "0");

        // Calculate totals and prepare items data
        let totalAmount = 0;

        const poItemsData = items.map((item: any) => {
          const quantity = parseFloat(item.quantity);
          const rate = parseFloat(item.rate);
          const lineTotal = quantity * rate;

          totalAmount += lineTotal;

          return {
            poId: po.id,
            stockItemId: item.stockItemId || 0, // Default to 0 if not provided
            itemName: item.itemName,
            quantity: item.quantity,
            rate: item.rate,
            lineTotal: lineTotal.toFixed(2),
          };
        });

        // Delete existing PO line items
        await db.delete(poLineItems).where(eq(poLineItems.poId, po.id));

        // Insert new PO line items
        await db.insert(poLineItems).values(poItemsData);

        // Update the purchase order total
        await db
          .update(purchaseOrders)
          .set({ itemsTotal: totalAmount.toFixed(2) })
          .where(eq(purchaseOrders.id, po.id));

        // Update the container totals to reflect the PO change
        const [container] = await db
          .select()
          .from(containers)
          .where(eq(containers.id, po.containerId))
          .limit(1);

        if (container) {
          const containerItemsTotal = parseFloat(container.itemsTotal || "0");
          const containerChargesTotal = parseFloat(
            container.chargesTotal || "0",
          );

          // Calculate the difference and update container
          const difference = totalAmount - oldPOTotal;
          const newContainerItemsTotal = containerItemsTotal + difference;
          const newContainerGrandTotal =
            newContainerItemsTotal + containerChargesTotal;

          await db
            .update(containers)
            .set({
              itemsTotal: newContainerItemsTotal.toFixed(2),
              grandTotal: newContainerGrandTotal.toFixed(2),
            })
            .where(eq(containers.id, po.containerId));
        }

        // Update the voucher
        const voucherUpdates: any = {
          totalAmount: totalAmount.toFixed(2),
        };
        if (voucherDate !== undefined) voucherUpdates.voucherDate = voucherDate;
        if (description !== undefined) voucherUpdates.description = description;

        const updated = await db
          .update(vouchers)
          .set(voucherUpdates)
          .where(eq(vouchers.id, id))
          .returning();

        res.json(updated[0]);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Update an adjustment voucher (Consumption, Production, or Mixed) with line items
  app.patch(
    "/api/vouchers/:id/adjustment",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid voucher ID" });
        }

        const { voucherDate, description, locationId, items } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
          return res
            .status(400)
            .json({ message: "At least one item is required" });
        }

        if (!locationId) {
          return res.status(400).json({ message: "Location ID is required" });
        }

        // Get the existing voucher to check company and permissions
        const existingVoucher = await storage.getVoucherById(id);
        if (!existingVoucher) {
          return res.status(404).json({ message: "Voucher not found" });
        }

        // Verify this is a Consumption, Production, or Mixed voucher
        if (
          existingVoucher.voucherType !== "Consumption" &&
          existingVoucher.voucherType !== "Production" &&
          existingVoucher.voucherType !== "Mixed"
        ) {
          return res
            .status(400)
            .json({
              message:
                "This endpoint only updates Consumption, Production, or Mixed vouchers",
            });
        }

        // Verify voucher belongs to current company
        if (existingVoucher.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Voucher belongs to a different company",
            });
        }

        // Check edit permissions
        const userRole = req.session.currentRole;
        if (!userRole) {
          return res.status(403).json({ message: "User role not found" });
        }

        if (userRole !== "Admin" && userRole !== "Owner") {
          if (userRole === "Manager") {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const voucherDate = new Date(existingVoucher.voucherDate);
            voucherDate.setHours(0, 0, 0, 0);

            if (voucherDate.getTime() !== today.getTime()) {
              return res
                .status(403)
                .json({ message: "Managers can only edit today's vouchers" });
            }
          } else {
            return res
              .status(403)
              .json({ message: "Insufficient permissions to edit vouchers" });
          }
        }

        // Find or create the associated adjustment voucher
        let adjustmentVoucher = await db
          .select()
          .from(stockAdjustmentVouchers)
          .where(eq(stockAdjustmentVouchers.voucherId, id))
          .limit(1)
          .then((rows) => rows[0]);

        // If no adjustment voucher exists, create one
        if (!adjustmentVoucher) {
          let adjustmentType = "production";
          if (existingVoucher.voucherType === "Consumption")
            adjustmentType = "consumption";
          else if (existingVoucher.voucherType === "Mixed")
            adjustmentType = "mixed";

          const [newAdjustment] = await db
            .insert(stockAdjustmentVouchers)
            .values({
              voucherId: id,
              locationId: parseInt(locationId),
              adjustmentType: adjustmentType,
              notes: description || "",
            })
            .returning();
          adjustmentVoucher = newAdjustment;
        }

        // Calculate totals and prepare items data
        // For Mixed: net totalAmount = production (positive qty) - consumption (negative qty)
        // For Production/Consumption only: use absolute value
        let signedTotal = 0;

        const adjustmentItemsData = items.map((item: any) => {
          const quantity = parseFloat(item.quantity);
          const rate = parseFloat(item.rate);
          const absItemTotal = Math.abs(quantity) * rate;  // always positive (consistent with createStockAdjustment)
          signedTotal += quantity * rate;  // signed: negative for consumption items

          return {
            adjustmentId: adjustmentVoucher.id,
            stockItemId: item.stockItemId,
            quantity: item.quantity,
            rate: item.rate,
            totalAmount: absItemTotal.toFixed(2),
          };
        });

        // Voucher totalAmount: net for Mixed, absolute for Production/Consumption
        const totalAmount = existingVoucher.voucherType === "Mixed"
          ? signedTotal
          : Math.abs(signedTotal);

        // Wrap all inventory mutations + related writes in a transaction
        const updated = await db.transaction(async (tx) => {
          // STEP 1: Reverse inventory for old adjustment items before deleting
          const oldAdjustmentItems = await tx
            .select()
            .from(stockAdjustmentItems)
            .where(eq(stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));

          const oldLocationId = adjustmentVoucher.locationId;

          for (const oldItem of oldAdjustmentItems) {
            const quantity = parseFloat(oldItem.quantity);
            const rate = parseFloat(oldItem.rate);

            await adjustInventory(tx, oldLocationId, oldItem.stockItemId, -quantity, existingVoucher.companyId);
          }

          // STEP 2: Delete existing adjustment items
          await tx
            .delete(stockAdjustmentItems)
            .where(eq(stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));

          // STEP 3: Apply inventory for new adjustment items
          const newLocationId = parseInt(locationId);

          for (const newItem of adjustmentItemsData) {
            const quantity = parseFloat(newItem.quantity);
            const rate = parseFloat(newItem.rate);

            await adjustInventory(tx, newLocationId, newItem.stockItemId, quantity, existingVoucher.companyId, rate);
          }

          // STEP 4: Insert new adjustment items
          await tx.insert(stockAdjustmentItems).values(adjustmentItemsData);

          // Update the adjustment voucher
          await tx
            .update(stockAdjustmentVouchers)
            .set({ locationId: parseInt(locationId), notes: description || "" })
            .where(eq(stockAdjustmentVouchers.id, adjustmentVoucher.id));

          // Update the main voucher
          const parsedLocationId = parseInt(locationId);
          const voucherUpdates: any = {
            totalAmount: totalAmount.toFixed(2),
            locationId: parsedLocationId,
          };
          const location = await storage.getLocationById(parsedLocationId);
          if (location) {
            voucherUpdates.locationName = location.name;
          }
          if (voucherDate !== undefined) voucherUpdates.voucherDate = voucherDate;
          if (description !== undefined) voucherUpdates.description = description;

          const [updatedVoucher] = await tx
            .update(vouchers)
            .set(voucherUpdates)
            .where(eq(vouchers.id, id))
            .returning();

          return updatedVoucher;
        });

        res.json(updated);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Update a stock transfer voucher with line items
  app.patch(
    "/api/vouchers/:id/transfer",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid voucher ID" });
        }

        const {
          voucherDate,
          description,
          sourceLocationId,
          destinationLocationId,
          items,
        } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
          return res
            .status(400)
            .json({ message: "At least one item is required" });
        }

        if (!sourceLocationId || !destinationLocationId) {
          return res
            .status(400)
            .json({ message: "Source and destination locations are required" });
        }

        // Get the existing voucher to check company and permissions
        const existingVoucher = await storage.getVoucherById(id);
        if (!existingVoucher) {
          return res.status(404).json({ message: "Voucher not found" });
        }

        // Verify this is a Stock Transfer voucher
        if (existingVoucher.voucherType !== "Stock Transfer") {
          return res
            .status(400)
            .json({
              message: "This endpoint only updates Stock Transfer vouchers",
            });
        }

        // Verify voucher belongs to current company
        if (existingVoucher.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Voucher belongs to a different company",
            });
        }

        // Check edit permissions
        const userRole = req.session.currentRole;
        if (!userRole) {
          return res.status(403).json({ message: "User role not found" });
        }

        if (userRole !== "Admin" && userRole !== "Owner") {
          if (userRole === "Manager") {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const voucherDate = new Date(existingVoucher.voucherDate);
            voucherDate.setHours(0, 0, 0, 0);

            if (voucherDate.getTime() !== today.getTime()) {
              return res
                .status(403)
                .json({ message: "Managers can only edit today's vouchers" });
            }
          } else {
            return res
              .status(403)
              .json({ message: "Insufficient permissions to edit vouchers" });
          }
        }

        console.log(`[Stock Transfer Edit] Starting update for voucher ${id}`);

        // Wrap the entire operation in a transaction for atomicity
        const updated = await db.transaction(async (tx) => {
          // Find or create the associated transfer voucher
          let transferVoucher = await tx
            .select()
            .from(stockTransferVouchers)
            .where(eq(stockTransferVouchers.voucherId, id))
            .limit(1)
            .then((rows) => rows[0]);

          // If no transfer voucher exists, create one
          if (!transferVoucher) {
            const [newTransfer] = await tx
              .insert(stockTransferVouchers)
              .values({
                voucherId: id,
                sourceLocationId: parseInt(sourceLocationId),
                destinationLocationId: parseInt(destinationLocationId),
                notes: description || "",
              })
              .returning();
            transferVoucher = newTransfer;
          }

          // Calculate totals and prepare items data
          let totalAmount = 0;

          const transferItemsData = items.map((item: any) => {
            const quantity = parseFloat(item.quantity);
            const rate = parseFloat(item.rate);
            const itemTotal = quantity * rate;

            totalAmount += itemTotal;

            return {
              transferId: transferVoucher.id,
              stockItemId: item.stockItemId,
              quantity: item.quantity,
              rate: item.rate,
              totalAmount: itemTotal.toFixed(2),
              sourceLocationId: parseInt(sourceLocationId),
            };
          });

          // STEP 1: Reverse inventory for old transfer items before deleting
          const oldTransferItems = await tx
            .select()
            .from(stockTransferItems)
            .where(eq(stockTransferItems.transferId, transferVoucher.id));

          const oldSourceLocationId = transferVoucher.sourceLocationId;
          const oldDestinationLocationId =
            transferVoucher.destinationLocationId;

          for (const oldItem of oldTransferItems) {
            const quantity = parseFloat(oldItem.quantity);
            const rate = parseFloat(oldItem.rate);

            // Add back to source location (reverse the subtraction)
            await adjustInventory(tx, oldSourceLocationId, oldItem.stockItemId, quantity, existingVoucher.companyId!, rate);

            // Subtract from destination location (reverse the addition)
            await adjustInventory(tx, oldDestinationLocationId, oldItem.stockItemId, -quantity, existingVoucher.companyId!);
          }

          // STEP 2: Delete existing transfer items
          await tx
            .delete(stockTransferItems)
            .where(eq(stockTransferItems.transferId, transferVoucher.id));

          // STEP 3: Apply inventory for new transfer items
          const newSourceLocationId = parseInt(sourceLocationId);
          const newDestinationLocationId = parseInt(destinationLocationId);

          for (const newItem of transferItemsData) {
            const quantity = parseFloat(newItem.quantity);
            const rate = parseFloat(newItem.rate);

            // Subtract from new source location
            await adjustInventory(tx, newSourceLocationId, newItem.stockItemId, -quantity, existingVoucher.companyId);

            // Add to new destination location
            await adjustInventory(tx, newDestinationLocationId, newItem.stockItemId, quantity, existingVoucher.companyId, rate);
          }

          // STEP 4: Insert new transfer items
          await tx.insert(stockTransferItems).values(transferItemsData);

          // Update the transfer voucher (locations can be changed, but shouldn't affect old inventory)
          await tx
            .update(stockTransferVouchers)
            .set({
              sourceLocationId: parseInt(sourceLocationId),
              destinationLocationId: parseInt(destinationLocationId),
              notes: description || "",
            })
            .where(eq(stockTransferVouchers.id, transferVoucher.id));

          // Update the main voucher
          const parsedSourceLocationId = parseInt(sourceLocationId);
          const voucherUpdates: any = {
            totalAmount: totalAmount.toFixed(2),
            locationId: parsedSourceLocationId, // Use source location as the primary location for the voucher
          };
          // Also save the location name for when the location is later deleted
          const sourceLocation = await storage.getLocationById(parsedSourceLocationId);
          if (sourceLocation) {
            voucherUpdates.locationName = sourceLocation.name;
          }
          if (voucherDate !== undefined)
            voucherUpdates.voucherDate = voucherDate;
          if (description !== undefined)
            voucherUpdates.description = description;

          const [updatedVoucher] = await tx
            .update(vouchers)
            .set(voucherUpdates)
            .where(eq(vouchers.id, id))
            .returning();

          return updatedVoucher;
        });

        console.log(`[Stock Transfer Edit] Successfully updated voucher ${id}`);
        res.json(updated);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Update a voucher with all entries (completely replace entries)
  app.put("/api/vouchers/:id/with-entries", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const { voucher, entries } = req.body;

      if (
        !voucher ||
        !entries ||
        !Array.isArray(entries) ||
        entries.length === 0
      ) {
        return res
          .status(400)
          .json({ message: "Voucher and entries are required" });
      }

      // Get the existing voucher to check company and permissions
      const existingVoucher = await storage.getVoucherById(id);
      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Verify voucher belongs to current company
      if (existingVoucher.companyId !== req.session.currentCompanyId) {
        return res
          .status(403)
          .json({
            message: "Access denied: Voucher belongs to a different company",
          });
      }

      // Check edit permissions based on role
      const userRole = req.session.currentRole;
      if (!userRole) {
        return res.status(403).json({ message: "User role not found" });
      }

      // Admin and Owner can edit all vouchers
      if (userRole !== "Admin" && userRole !== "Owner") {
        // Manager can only edit today's vouchers
        if (userRole === "Manager") {
          const voucherDate = new Date(existingVoucher.voucherDate);
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
            .json({ message: "Insufficient permissions to edit vouchers" });
        }
      }

      // Validate that debits equal credits (only for non-optional vouchers)
      const totalDebits = entries.reduce(
        (sum: number, entry: any) => sum + parseFloat(entry.debitAmount || "0"),
        0,
      );
      const totalCredits = entries.reduce(
        (sum: number, entry: any) =>
          sum + parseFloat(entry.creditAmount || "0"),
        0,
      );

      // For active (non-optional) vouchers, enforce debit=credit balance
      if (!voucher.optional && Math.abs(totalDebits - totalCredits) >= 0.01) {
        return res
          .status(400)
          .json({
            message:
              "Total debits must equal total credits for active vouchers",
          });
      }

      // Update voucher with error handling
      let updatedVoucher;
      let createdEntries = [];
      let oldEntries: any[] = [];

      // SALES VOUCHER INVENTORY HANDLING
      // If this is a Sales voucher and location is changing, we need to reverse inventory at old location
      // and apply inventory at new location
      const oldLocationId = existingVoucher.locationId;
      const newLocationId = voucher.locationId !== undefined ? voucher.locationId : oldLocationId;
      const locationChanged = oldLocationId !== newLocationId;

      if (existingVoucher.voucherType === "Sales" && locationChanged) {
        await db.transaction(async (tx) => {
          // Get sales items for this voucher
          const oldSalesItemsList = await tx
            .select()
            .from(salesItems)
            .where(eq(salesItems.voucherId, id));

          // STEP 1: Reverse inventory at old location (add back the quantities)
          if (oldLocationId && oldSalesItemsList.length > 0) {
            for (const oldItem of oldSalesItemsList) {
              const quantity = parseFloat(oldItem.quantity);
              const costPrice = parseFloat(oldItem.costPrice);

              const result = await adjustInventory(tx, oldLocationId, oldItem.stockItemId, quantity, existingVoucher.companyId, costPrice);
              console.log(`[Sales Edit] Reversed inventory at old location ${oldLocationId}: ${oldItem.stockItemId} qty +${quantity} (was ${result.previousQuantity}, now ${result.newQuantity})`);
            }
          }

          // STEP 2: Deduct inventory at new location
          if (newLocationId && oldSalesItemsList.length > 0) {
            for (const item of oldSalesItemsList) {
              const quantity = parseFloat(item.quantity);

              const result = await adjustInventory(tx, newLocationId, item.stockItemId, -quantity, existingVoucher.companyId);
              console.log(`[Sales Edit] Deducted inventory at new location ${newLocationId}: ${item.stockItemId} qty -${quantity} (was ${result.previousQuantity}, now ${result.newQuantity})`);
            }
          }
        });
      }

      try {
        // Backup old entries before deleting
        oldEntries = await db
          .select()
          .from(voucherEntries)
          .where(eq(voucherEntries.voucherId, id));

        // Update voucher metadata
        const voucherUpdates: any = {
          voucherType: voucher.voucherType,
          voucherDate: voucher.voucherDate,
          description: voucher.description || null,
          optional: voucher.optional ?? false,

          totalAmount: Math.max(totalDebits, totalCredits).toFixed(2),
        };
        // If locationId is being updated, also save the location name
        if (voucher.locationId !== undefined) {
          voucherUpdates.locationId = voucher.locationId;
          if (voucher.locationId) {
            const location = await storage.getLocationById(voucher.locationId);
            if (location) {
              voucherUpdates.locationName = location.name;
            }
          } else {
            voucherUpdates.locationName = null;
          }
        }
        [updatedVoucher] = await db
          .update(vouchers)
          .set(voucherUpdates)
          .where(eq(vouchers.id, id))
          .returning();

        if (voucher.voucherDate) {
          await db.update(fde)
            .set({ txDate: voucher.voucherDate })
            .where(and(
              eq(fde.referenceTable, "vouchers"),
              eq(fde.referenceId, id)
            ));
        }

        // Delete all existing entries
        await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, id));

        // Create new entries
        for (const entry of entries) {
          const [createdEntry] = await db
            .insert(voucherEntries)
            .values({
              voucherId: id,
              ledgerAccountId: entry.ledgerAccountId || null,
              bankAccountId: entry.bankAccountId || null,
              fixedAssetId: entry.fixedAssetId || null,
              supplierId: entry.supplierId || null,
              employeeId: entry.employeeId || null,
              factorySupplierId: entry.factorySupplierId || null,
              debitAmount: entry.debitAmount || "0",
              creditAmount: entry.creditAmount || "0",
              narration: entry.narration || null,
            })
            .returning();
          createdEntries.push(createdEntry);
        }

        // Resync factory daybook entry amounts for this voucher
        const newTotal = Math.max(totalDebits, totalCredits).toFixed(2);
        await db.update(fdeAmt)
          .set({ amountCurrency: newTotal, amountUsd: newTotal })
          .where(and(
            eq(fdeAmt.referenceTable, "vouchers"),
            eq(fdeAmt.referenceId, id)
          ));
      } catch (error: any) {
        // Cleanup: Restore old entries if update failed after deletion
        if (oldEntries.length > 0 && createdEntries.length === 0) {
          for (const oldEntry of oldEntries) {
            await db
              .insert(voucherEntries)
              .values({
                voucherId: oldEntry.voucherId,
                ledgerAccountId: oldEntry.ledgerAccountId,
                bankAccountId: oldEntry.bankAccountId,
                fixedAssetId: oldEntry.fixedAssetId,
                supplierId: oldEntry.supplierId,
                employeeId: oldEntry.employeeId,
                debitAmount: oldEntry.debitAmount,
                creditAmount: oldEntry.creditAmount,
                narration: oldEntry.narration,
              })
              .catch(() => {});
          }
        }
        throw error;
      }

      // Log the update to audit log
      await logAudit({
        userId: req.session.userId!,
        username: (req.session as any).username || "unknown",
        companyId: req.session.currentCompanyId!,
        action: "update",
        tableName: "vouchers",
        recordId: id,
        recordIdentifier: updatedVoucher.voucherNumber,
        changes: {
          voucherNumber: { old: existingVoucher.voucherNumber, new: updatedVoucher.voucherNumber },
          voucherType: { old: existingVoucher.voucherType, new: updatedVoucher.voucherType },
        },
      });

      // ── CHARGE voucher sync ──────────────────────────────────────────────
      // If this voucher was auto-created during invoice finalization (number
      // format: CHARGE-{invoiceNumber}-{chargeId}-{timestamp}), sync the new
      // amount back to customer_order_charges and recalculate the invoice totals.
      const chargeMatch = existingVoucher.voucherNumber?.match(/^CHARGE-.+-(\d+)-\d+$/);
      if (chargeMatch && existingVoucher.sourceModule === "FACTORY") {
        const chargeId = parseInt(chargeMatch[1]);
        const newAmount = Math.max(totalDebits, totalCredits);
        const [charge] = await db.select({ orderId: customerOrderCharges.orderId })
          .from(customerOrderCharges).where(eq(customerOrderCharges.id, chargeId));
        if (charge) {
          const chargeUpdate: { amount: string; name?: string } = { amount: String(newAmount) };
          if (updatedVoucher.description?.trim()) {
            chargeUpdate.name = updatedVoucher.description.trim();
          }
          await db.update(customerOrderCharges)
            .set(chargeUpdate)
            .where(eq(customerOrderCharges.id, chargeId));
          await recalculateOrderTotals(db, charge.orderId);
          // Also update the customer balance ledger debit for this invoice
          const [updatedOrd] = await db.select({ grandTotal: customerOrders.grandTotal, status: customerOrders.status })
            .from(customerOrders).where(eq(customerOrders.id, charge.orderId));
          if (updatedOrd?.status === "FINALIZED") {
            await db.update(customerBalances)
              .set({ debitAmount: String(updatedOrd.grandTotal), balance: String(updatedOrd.grandTotal) })
              .where(and(
                eq(customerBalances.referenceId, charge.orderId),
                eq(customerBalances.referenceType, "INVOICE"),
              ));
          }
        }
      }

      const result = { voucher: updatedVoucher, entries: createdEntries };

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Fix inventory for Sales vouchers that were edited with location changes
  // This recalculates inventory based on current voucher locations
  app.post("/api/admin/fix-sales-inventory", requireAuth, async (req, res) => {
    try {
      // Admin only
      if (req.session.currentRole !== "Admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all Sales vouchers for this company
      const salesVouchers = await db
        .select()
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.voucherType, "Sales"),
          ),
        );

      const fixes: any[] = [];

      for (const voucher of salesVouchers) {
        if (!voucher.locationId) continue;

        // Get sales items for this voucher
        const items = await db
          .select()
          .from(salesItems)
          .where(eq(salesItems.voucherId, voucher.id));

        for (const item of items) {
          const quantity = parseFloat(item.quantity);
          const costPrice = parseFloat(item.costPrice);

          // Check if inventory at this location has this deduction
          const [inv] = await db
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.locationId, voucher.locationId),
                eq(inventory.stockItemId, item.stockItemId),
              ),
            );

          fixes.push({
            voucherId: voucher.id,
            voucherNumber: voucher.voucherNumber,
            locationId: voucher.locationId,
            stockItemId: item.stockItemId,
            saleQuantity: quantity,
            currentInventory: inv ? parseFloat(inv.quantity) : null,
          });
        }
      }

      // Find inventory records with negative quantities that shouldn't have them
      const negativeInventory = await db
        .select({
          id: inventory.id,
          locationId: inventory.locationId,
          stockItemId: inventory.stockItemId,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
          totalValue: inventory.totalValue,
          locationName: locations.name,
          stockItemName: stockItems.name,
        })
        .from(inventory)
        .leftJoin(locations, eq(inventory.locationId, locations.id))
        .leftJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .where(
          and(
            eq(inventory.companyId, companyId),
            sql`CAST(${inventory.quantity} AS DECIMAL) < 0`,
          ),
        );

      // For each negative inventory, set it to 0 (cleanup orphaned deductions)
      const cleaned: any[] = [];
      for (const inv of negativeInventory) {
        // Check if there's actually a sale at this location that would cause this
        const salesAtLocation = await db
          .select()
          .from(salesItems)
          .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
          .where(
            and(
              eq(vouchers.locationId, inv.locationId),
              eq(salesItems.stockItemId, inv.stockItemId),
              eq(vouchers.companyId, companyId),
            ),
          );

        if (salesAtLocation.length === 0) {
          // No sales at this location for this item - this is orphaned negative inventory
          // Reset to 0
          await db
            .update(inventory)
            .set({
              quantity: "0",
              totalValue: "0",
            })
            .where(eq(inventory.id, inv.id));

          cleaned.push({
            id: inv.id,
            locationName: inv.locationName,
            stockItemName: inv.stockItemName,
            oldQuantity: inv.quantity,
            action: "Reset to 0 (orphaned negative inventory)",
          });
        }
      }

      res.json({
        message: `Fixed ${cleaned.length} orphaned negative inventory records`,
        cleaned,
        salesVoucherCount: salesVouchers.length,
        negativeInventoryFound: negativeInventory.length,
      });
    } catch (error: any) {
      console.error("[Fix Sales Inventory] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get voucher entries for a specific voucher (for editing)
  registerVoucherEntryRoutes(app);
}
