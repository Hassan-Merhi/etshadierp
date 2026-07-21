import type { Express } from "express";
import path from "path";
import fs from "fs";
import { db, pool } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory } from "./_helpers";
import {
  resolveParentCompanyId,
  isParentCompanyContext,
  getSupplierBalanceForContext,
  authorizeCompanyIdParam,
} from "./helpers/supplierBalanceHelpers";
import {
  inventory,
  stockItems,
  stockGroups,
  stockTransferVouchers,
  stockTransferItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  containers,
  containerOffloads,
  containerOffloadItems,
  bankAccounts,
  fixedAssets,
  ledgerAccounts,
  insertLedgerAccountSchema,
  insertStockGroupSchema,
  insertStockItemSchema,
  insertContainerSchema,
  insertStockTransferVoucherSchema,
  insertStockAdjustmentVoucherSchema,
  updateStockTransferSchema,
  updateStockAdjustmentSchema,
  vouchers,
  voucherEntries,
  salesItems,
  suppliers,
  customers,
  customerBalances,
  employees,
  locations,
  userLocations,
  userCompanyRoles,
  companies,
  auditLog,
  users,
  FEATURE_KEYS,
  companySettings,
  purchaseOrders,
  poLineItems,
  interCompanyTransfers,
  insertInterCompanyTransferSchema,
  insertContainerSaleSchema,
  containerSales,
  insertUserPreferencesSchema,
  userPreferences,
  insertDraftPosSaleSchema,
  InsertDraftPosSale,
  insertSalaryAdvanceSchema,
  insertSalaryAdvanceDeductionSchema,
  salaryAdvances,
  salaryAdvanceDeductions,
  fiscalPeriodClosures,
  wasteDispatches,
  wasteDispatchItems,
  dashboardCashAccounts,
  dashboardPayableAccounts,
  dashboardAccountSelections,
  insertDashboardCashAccountSchema,
  insertDashboardPayableAccountSchema,
  insertDashboardAccountSelectionSchema,
  creditNoteItems,
  pendingBarcodes,
  insertPendingBarcodeSchema,
  bales,
  baleProducts,
  baleProductCategories,
  storedFiles,
  customerOrders,
  factorySuppliers,
  factoryContainers,
  factorySupplierPayments,
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
import { getClientDate } from "../lib/dateUtils";
import { buildFactoryCustomerLedgerEntries, getCustomerByLedgerId } from "../lib/factoryCustomerLedger";

export function registerAccountRoutes(app: Express) {
  app.get("/api/accounts/all", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const companyId = req.session.currentCompanyId;

      // Fire all independent lookups in parallel instead of serially.
      // getAllSuppliers is always fetched; for factory companies the result is
      // discarded — the wasted query is small compared to the serial latency saved.
      const [currentCompany, ledgers, banks, assets, employees, allSuppliers, companyCustomers] = await Promise.all([
        storage.getCompanyById(companyId),
        storage.getAllLedgerAccounts(companyId),
        storage.getAllBankAccounts(companyId),
        storage.getAllFixedAssets(companyId),
        storage.getAllEmployees(companyId),
        storage.getAllSuppliers(),
        storage.getAllCustomers(companyId),
      ]);
      const isFactoryCompany = currentCompany?.companyType === "factory";
      const isPropertiesCompany = currentCompany?.companyType === "properties";
      const suppliers = isFactoryCompany || isPropertiesCompany ? [] : allSuppliers;

      // Build a map of ledgerAccountId → customer opening balance.
      // For customer-linked ledger accounts, the customer record is the
      // authoritative source of opening balance — the ledger account's own
      // openingBalance may have drifted (e.g. edited directly in Accounts page).
      const customerObMap = new Map<number, { openingBalance: string; openingBalanceSide: string | null }>();
      for (const cust of companyCustomers) {
        if (cust.ledgerAccountId) {
          customerObMap.set(cust.ledgerAccountId, {
            openingBalance: cust.openingBalance ?? "0",
            openingBalanceSide: cust.openingBalanceSide ?? "Dr",
          });
        }
      }

      // For factory companies, compute a combined balance for customer-linked ledger accounts
      // using the same multi-source formula as /api/factory/customers so both pages agree.
      // Formula: OB + finalized order totals + customerBalances non-INVOICE + voucherNet (excl CHARGE-*)
      const customerLedgerOverrides = new Map<number, { balance: string; balanceSide: string }>();
      if (isFactoryCompany) {
        const linkedCustomers = companyCustomers.filter((c) => c.ledgerAccountId);
        if (linkedCustomers.length > 0) {
          const linkedCustIds = linkedCustomers.map((c) => c.id);
          const linkedLedgerIds = linkedCustomers.map((c) => c.ledgerAccountId!);

          const [salesRows, cbRows, lVoucherRows, cVoucherRows] = await Promise.all([
            db
              .select({
                customerId: customerOrders.customerId,
                total: sql<string>`COALESCE(SUM(CAST(${customerOrders.grandTotal} AS numeric)), 0)`,
              })
              .from(customerOrders)
              .where(
                and(
                  inArray(customerOrders.customerId, linkedCustIds),
                  eq(customerOrders.companyId, companyId),
                  eq(customerOrders.status, "FINALIZED")
                )
              )
              .groupBy(customerOrders.customerId),

            db
              .select({
                customerId: customerBalances.customerId,
                net: sql<string>`COALESCE(SUM(CAST(${customerBalances.debitAmount} AS numeric) - CAST(${customerBalances.creditAmount} AS numeric)), 0)`,
              })
              .from(customerBalances)
              .where(
                and(
                  inArray(customerBalances.customerId, linkedCustIds),
                  eq(customerBalances.companyId, companyId),
                  sql`${customerBalances.referenceType} IS DISTINCT FROM 'INVOICE'`
                )
              )
              .groupBy(customerBalances.customerId),

            db
              .select({
                ledgerAccountId: voucherEntries.ledgerAccountId,
                net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
              })
              .from(voucherEntries)
              .innerJoin(
                vouchers,
                and(
                  eq(voucherEntries.voucherId, vouchers.id),
                  eq(vouchers.companyId, companyId),
                  eq(vouchers.optional, false),
                  isNull(vouchers.deletedAt),
                  sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`
                )
              )
              .where(inArray(voucherEntries.ledgerAccountId as any, linkedLedgerIds))
              .groupBy(voucherEntries.ledgerAccountId),

            db
              .select({
                customerId: voucherEntries.customerId,
                net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
              })
              .from(voucherEntries)
              .innerJoin(
                vouchers,
                and(
                  eq(voucherEntries.voucherId, vouchers.id),
                  eq(vouchers.companyId, companyId),
                  eq(vouchers.optional, false),
                  isNull(vouchers.deletedAt),
                  sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`
                )
              )
              .where(
                and(inArray(voucherEntries.customerId as any, linkedCustIds), isNull(voucherEntries.ledgerAccountId))
              )
              .groupBy(voucherEntries.customerId),
          ]);

          const salesMap = new Map(salesRows.map((r) => [r.customerId!, parseFloat(r.total || "0")]));
          const nonInvMap = new Map(cbRows.map((r) => [r.customerId!, parseFloat(r.net || "0")]));
          const vNetByLedger = new Map(
            lVoucherRows.filter((r) => r.ledgerAccountId).map((r) => [r.ledgerAccountId!, parseFloat(r.net || "0")])
          );
          const vNetByCustomer = new Map(
            cVoucherRows.filter((r) => r.customerId).map((r) => [r.customerId!, parseFloat(r.net || "0")])
          );

          for (const cust of linkedCustomers) {
            const salesTotal = salesMap.get(cust.id) ?? 0;
            const nonInvNet = nonInvMap.get(cust.id) ?? 0;
            const voucherNet = (vNetByLedger.get(cust.ledgerAccountId!) ?? 0) + (vNetByCustomer.get(cust.id) ?? 0);
            const ob = parseFloat(cust.openingBalance || "0");
            const obSide = cust.openingBalanceSide || "Dr";
            const total = (obSide === "Dr" ? ob : -ob) + salesTotal + nonInvNet + voucherNet;
            customerLedgerOverrides.set(cust.ledgerAccountId!, {
              balance: Math.abs(total).toFixed(2),
              balanceSide: total >= 0 ? "Dr" : "Cr",
            });
          }
        }
      }

      // The "Factory Worker Advances" ledger account's own debit/credit balance drifts
      // from reality because advance repayments/deductions aren't always posted back to
      // it (see the same guard in the Factory Net Position route). factory_worker_advances
      // .remaining_balance is the authoritative source (also used by the Payroll & Benefits
      // "Advances" KPI and Net Position), so override this account's displayed balance here
      // too — otherwise the Accounts page shows a stale figure that doesn't match those pages.
      if (isFactoryCompany) {
        const workerAdvLedger = ledgers.find(
          (a) => (a.name || "").toLowerCase().replace(/\s+/g, " ").trim() === "factory worker advances"
        );
        if (workerAdvLedger) {
          const workerAdvRes = await db.execute(sql`
            SELECT COALESCE(SUM(remaining_balance::numeric), 0) AS total
            FROM   factory_worker_advances
            WHERE  company_id = ${companyId}
              AND  remaining_balance > 0
          `);
          const workerAdvRow = ((workerAdvRes as any).rows ?? (workerAdvRes as any))[0] ?? {};
          const workerAdvancesValue = parseFloat(String(workerAdvRow.total ?? "0")) || 0;
          customerLedgerOverrides.set(workerAdvLedger.id, {
            balance: workerAdvancesValue.toFixed(2),
            balanceSide: "Dr",
          });
        }
      }

      // Optional date range filter for account balances.
      // effectiveEndDate defaults to today so future-dated vouchers are excluded.
      const asOfDate = getClientDate(req);
      const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
      const balStartDate =
        typeof req.query.startDate === "string" && ISO_DATE.test(req.query.startDate)
          ? req.query.startDate
          : undefined;
      const rawEndDate =
        typeof req.query.endDate === "string" && ISO_DATE.test(req.query.endDate)
          ? req.query.endDate
          : undefined;
      const effectiveEndDate = rawEndDate && rawEndDate < asOfDate ? rawEndDate : asOfDate;

      // Get all voucher entries for this company's vouchers (excluding optional and deleted)
      // Use COALESCE(effectiveDate, voucherDate) so period filtering respects effective date
      const voucherDateConditions = [
        eq(vouchers.companyId, companyId),
        eq(vouchers.optional, false),
        isNull(vouchers.deletedAt),
        ...(balStartDate ? [sql`COALESCE(${vouchers.effectiveDate}, ${vouchers.voucherDate}) >= ${balStartDate}`] : []),
        sql`COALESCE(${vouchers.effectiveDate}, ${vouchers.voucherDate}) <= ${effectiveEndDate}`,
      ];

      // Ledger account IDs that belong to this company (already fetched above)
      const ledgerIds = ledgers.map((a) => a.id);

      // For ledger accounts: query entries scoped strictly to THIS company's vouchers.
      // Cross-company aggregation causes the account-list balance to differ from the
      // opened statement and Factory Net Position (both company-scoped).
      const companyLedgerConditions: any[] = [
        eq(vouchers.companyId, companyId),
        eq(vouchers.optional, false),
        isNull(vouchers.deletedAt),
        isNotNull(voucherEntries.ledgerAccountId),
        ...(balStartDate ? [sql`COALESCE(${vouchers.effectiveDate}, ${vouchers.voucherDate}) >= ${balStartDate}`] : []),
        sql`COALESCE(${vouchers.effectiveDate}, ${vouchers.voucherDate}) <= ${effectiveEndDate}`,
        ...(ledgerIds.length > 0 ? [inArray(voucherEntries.ledgerAccountId as any, ledgerIds)] : [sql`1=0`]),
      ];

      // Run both fetches in parallel
      const [companyVouchers, companyLedgerEntries] = await Promise.all([
        db
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(and(...voucherDateConditions)),
        ledgerIds.length > 0
          ? db
              .select({
                ledgerAccountId: voucherEntries.ledgerAccountId,
                debitAmount: voucherEntries.debitAmount,
                creditAmount: voucherEntries.creditAmount,
              })
              .from(voucherEntries)
              .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
              .where(and(...companyLedgerConditions))
          : Promise.resolve([]),
      ]);

      const companyVoucherIds = companyVouchers.map((v) => v.id);

      // Get all voucher entries for this company (needed for bank / asset / employee / supplier balances)
      const allEntries =
        companyVoucherIds.length > 0
          ? await db.select().from(voucherEntries).where(inArray(voucherEntries.voucherId, companyVoucherIds)).execute()
          : [];

      // Group entries by account type and calculate balances
      // Ledger balances use the company-scoped query above.
      const ledgerBalances = new Map<number, { debits: number; credits: number }>();
      for (const entry of companyLedgerEntries) {
        if (!entry.ledgerAccountId) continue;
        const debit = parseFloat((entry as any).debitAmount || "0");
        const credit = parseFloat((entry as any).creditAmount || "0");
        const existing = ledgerBalances.get(entry.ledgerAccountId) || { debits: 0, credits: 0 };
        ledgerBalances.set(entry.ledgerAccountId, {
          debits: existing.debits + debit,
          credits: existing.credits + credit,
        });
      }

      const bankBalances = new Map<number, { debits: number; credits: number }>();
      const assetBalances = new Map<number, { debits: number; credits: number }>();
      const employeeBalances = new Map<number, { debits: number; credits: number }>();
      // Note: Supplier balances are calculated separately below using getSupplierBalanceForContext,
      // which correctly scopes entries to the selected company and applies opening-balance rules
      // (opening balance only applies in the parent company's context — zero for all others).

      for (const entry of allEntries) {
        const debit = parseFloat(entry.debitAmount || "0");
        const credit = parseFloat(entry.creditAmount || "0");

        // Ledger balances are already handled by the cross-company query above

        if (entry.bankAccountId) {
          const existing = bankBalances.get(entry.bankAccountId) || {
            debits: 0,
            credits: 0,
          };
          bankBalances.set(entry.bankAccountId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.fixedAssetId) {
          const existing = assetBalances.get(entry.fixedAssetId) || {
            debits: 0,
            credits: 0,
          };
          assetBalances.set(entry.fixedAssetId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.employeeId) {
          const existing = employeeBalances.get(entry.employeeId) || {
            debits: 0,
            credits: 0,
          };
          employeeBalances.set(entry.employeeId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }
        // Note: Supplier balances are calculated separately below using global entries
        // (not company-filtered) to match the supplier stats endpoint
      }

      // Helper function to calculate actual balance
      const calculateBalance = (
        openingBalance: string,
        openingBalanceSide: string | null,
        debits: number,
        credits: number
      ) => {
        let balance = parseFloat(openingBalance || "0");

        // If opening balance has a side, convert to signed number
        if (openingBalanceSide === "Cr") {
          balance = -balance;
        }

        // Add net change (debits increase, credits decrease)
        balance += debits - credits;

        // Determine side based on final balance
        const balanceSide = balance >= 0 ? "Dr" : "Cr";
        const absoluteBalance = Math.abs(balance);

        return { balance: absoluteBalance, balanceSide };
      };

      const accounts = [
        ...ledgers.map((account) => {
          const movements = ledgerBalances.get(account.id) || {
            debits: 0,
            credits: 0,
          };
          // If this ledger account is linked to a customer, use the customer's
          // opening balance as the authoritative source (may differ from the
          // ledger account's own openingBalance if edited directly).
          const custOb = customerObMap.get(account.id);
          const effectiveOB = custOb?.openingBalance ?? account.openingBalance ?? "0";
          const effectiveOBSide = custOb?.openingBalanceSide ?? account.openingBalanceSide;

          // For factory companies, use the pre-computed combined balance override
          // (sales + customerBalances + voucherEntries via both ledgerId and customerId)
          const override = customerLedgerOverrides.get(account.id);
          if (override) {
            return {
              id: `ledger-${account.id}`,
              accountId: account.id,
              type: "ledger",
              code: account.code,
              name: account.name,
              accountType: account.accountType,
              subType: account.subType,
              balance: override.balance,
              balanceSide: override.balanceSide,
              openingBalance: parseFloat(effectiveOB),
              openingBalanceSide: effectiveOBSide || "Dr",
              active: account.active,
              parentId: account.parentId,
            };
          }

          const { balance, balanceSide } = calculateBalance(
            effectiveOB,
            effectiveOBSide,
            movements.debits,
            movements.credits
          );

          return {
            id: `ledger-${account.id}`,
            accountId: account.id,
            type: "ledger",
            code: account.code,
            name: account.name,
            accountType: account.accountType,
            subType: account.subType,
            balance: balance.toFixed(2),
            balanceSide,
            openingBalance: parseFloat(effectiveOB),
            openingBalanceSide: effectiveOBSide || "Dr",
            active: account.active,
            parentId: account.parentId,
          };
        }),
        ...banks.map((account) => {
          const movements = bankBalances.get(account.id) || {
            debits: 0,
            credits: 0,
          };
          const { balance, balanceSide } = calculateBalance(
            account.openingBalance || "0",
            account.openingBalanceSide,
            movements.debits,
            movements.credits
          );

          return {
            id: `bank-${account.id}`,
            accountId: account.id,
            type: "bank",
            code: account.code,
            name: `${account.name} (${account.bankName})`,
            balance: balance.toFixed(2),
            balanceSide,
            openingBalance: parseFloat(account.openingBalance || "0"),
            openingBalanceSide: account.openingBalanceSide || "Dr",
            active: account.active,
            parentId: null,
          };
        }),
        ...assets.map((asset) => {
          const movements = assetBalances.get(asset.id) || {
            debits: 0,
            credits: 0,
          };
          const { balance, balanceSide } = calculateBalance(
            asset.openingBalance || "0",
            "Dr", // Fixed assets are always debit balance
            movements.debits,
            movements.credits
          );

          return {
            id: `asset-${asset.id}`,
            accountId: asset.id,
            type: "fixedAsset",
            code: asset.code,
            name: asset.name,
            balance: balance.toFixed(2),
            balanceSide,
            openingBalance: parseFloat(asset.openingBalance || "0"),
            openingBalanceSide: "Dr", // Fixed assets are always debit balance
            active: asset.active,
            parentId: null,
          };
        }),
        ...employees.map((employee) => {
          const movements = employeeBalances.get(employee.id) || {
            debits: 0,
            credits: 0,
          };
          const openingBalance = parseFloat(employee.openingBalance || "0");
          // Employee accounts are liability (Cr-normal): credits increase balance, debits decrease it.
          // Positive netBalance = Cr (we owe them, the normal state).
          // This matches the payroll page's currentBalance convention.
          const netBalance = openingBalance + movements.credits - movements.debits;
          const balanceSide = netBalance >= 0 ? "Cr" : "Dr";

          return {
            id: `employee-${employee.id}`,
            accountId: employee.id,
            type: "employee",
            code: employee.code,
            name: `${employee.firstName} ${employee.lastName}`,
            balance: Math.abs(netBalance).toFixed(2),
            balanceSide,
            openingBalance: openingBalance,
            openingBalanceSide: "Cr",
            active: employee.active,
            parentId: null,
          };
        }),
      ];

      // Determine whether the current company is the parent company. The opening
      // balance is a one-time historical entry that only belongs to the parent
      // company's books — child/sub companies start from zero and only accrue a
      // balance from their OWN vouchers. The parent is NEVER inferred from
      // "lowest company ID" — only the explicit parentCompanyId setting decides.
      const parentCompanyId = await resolveParentCompanyId();
      const isChildCompany = companyId !== parentCompanyId;

      // Calculate each supplier's balance scoped to THIS company only (opening
      // balance applies solely in the parent company's context). Child companies
      // additionally omit suppliers with no activity in that company at all.
      const supplierAccountsList = (
        await Promise.all(
          suppliers.map(async (supplier) => {
            const {
              balance: calculatedBalance,
              openingBalance,
              hasActivity,
            } = await getSupplierBalanceForContext(supplier, companyId);

            if (isChildCompany && !hasActivity) return null;

            // For suppliers, return the signed balance (same format as /api/suppliers/stats)
            // Positive = we owe them (Cr), Negative = they owe us/prepaid (Dr)
            const balanceSide = calculatedBalance >= 0 ? "Cr" : "Dr";

            return {
              id: `supplier-${supplier.id}`,
              accountId: supplier.id,
              type: "supplier",
              code: supplier.code,
              name: supplier.legalName,
              balance: calculatedBalance.toFixed(2), // Signed value, not absolute
              balanceSide,
              openingBalance: openingBalance,
              openingBalanceSide: "Cr", // Suppliers are always credit balance (payable)
              active: supplier.active,
              parentId: null,
            };
          })
        )
      ).filter((s): s is NonNullable<typeof s> => s !== null);

      // Combine all accounts — customers are excluded from the voucher account selector
      const allAccounts = [...accounts, ...supplierAccountsList];

      res.json({ accounts: allAccounts, asOfDate: effectiveEndDate });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get payable accounts (creditors - suppliers with positive balance)
  app.get("/api/accounts/payables", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const suppliers = await storage.getAllSuppliers();
      const parentCompanyId = await resolveParentCompanyId();
      const isChildCompany = companyId !== parentCompanyId;

      const payableAccounts = (
        await Promise.all(
          suppliers.map(async (supplier) => {
            const { balance, hasActivity } = await getSupplierBalanceForContext(supplier, companyId);
            if (isChildCompany && !hasActivity) return null;
            return {
              id: supplier.id,
              accountId: supplier.id,
              code: supplier.code,
              name: supplier.legalName,
              balance,
            };
          })
        )
      )
        .filter((account): account is NonNullable<typeof account> => account !== null && account.balance > 0)
        .sort((a, b) => b.balance - a.balance);

      res.json(payableAccounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get all accounts for voucher sidebar (optimized format with balances)
  app.get("/api/vouchers/search", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const q = ((req.query.q as string) || "").trim();
      if (!q) return res.json([]);

      // Split into individual keywords so "avance transport" matches both words anywhere
      const keywords = q.split(/\s+/).filter(Boolean);

      // Strip currency symbols / commas so "$3,967" → "3967" for amount matching
      const amountQ = q.replace(/[$,\s]/g, "");
      const isNumericSearch = keywords.length === 1 && /^\d+(\.\d+)?$/.test(amountQ);

      // Each keyword must appear in description OR voucherNumber (AND across keywords)
      const keywordConditions = keywords.map((kw) =>
        or(
          ilike(vouchers.voucherNumber, `%${kw}%`),
          ilike(vouchers.description, `%${kw}%`),
          isNumericSearch ? sql`CAST(${vouchers.totalAmount} AS TEXT) LIKE ${"%" + amountQ + "%"}` : sql`false`
        )
      );

      const results = await db
        .select({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          effectiveDate: vouchers.effectiveDate,
          description: vouchers.description,
          totalAmount: vouchers.totalAmount,
          currency: vouchers.currency,
          locationName: vouchers.locationName,
        })
        .from(vouchers)
        .where(
          and(eq(vouchers.companyId, req.session.currentCompanyId), isNull(vouchers.deletedAt), ...keywordConditions)
        )
        .orderBy(desc(sql`COALESCE(${vouchers.effectiveDate}, ${vouchers.voucherDate})`))
        .limit(100);

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Lightweight ledger-accounts list (id, code, name) — used by dashboard payable-account selector.
  app.get("/api/accounts/all-ledger", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accounts = await storage.getAllLedgerAccounts(companyId);
      res.json(
        accounts.map((acc) => ({
          id: acc.id,
          accountId: acc.id,
          code: acc.code || "",
          name: acc.name,
          balance: 0,
        }))
      );
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // 30-second TTL cache for voucher-sidebar results (keyed by companyId).
  // The sidebar shows aggregate balances; stale data for 30 s is acceptable because
  // TanStack Query on the client invalidates this query after every voucher mutation.
  const _vsBCache = new Map<number, { data: any; expiresAt: number }>();

  app.get("/api/accounts/voucher-sidebar", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const companyId = req.session.currentCompanyId;

      // Check TTL cache
      const _vsCached = _vsBCache.get(companyId);
      if (_vsCached && Date.now() < _vsCached.expiresAt) {
        return res.json(_vsCached.data);
      }

      // Parent is never inferred by "lowest company ID" — only the explicit
      // parentCompanyId setting decides whether this company's suppliers carry
      // their historical opening balance.
      const parentCompanyId = await resolveParentCompanyId();
      const isChildCompany = companyId !== parentCompanyId;

      // Phase 1: determine company type (other fetches are conditional on this)
      const currentCompany = await storage.getCompanyById(companyId);
      const isFactoryCompany = currentCompany?.companyType === "factory";
      const isPropertiesCompany = currentCompany?.companyType === "properties";

      // Phase 2: all independent fetches in parallel (allEntries runs concurrently with others)
      const [
        ledgers,
        banks,
        assets,
        employees,
        suppliers,
        fSuppliers,
        fContainers,
        fPayments,
        companyVouchers,
        allEntries,
      ] = await Promise.all([
        storage.getAllLedgerAccounts(companyId),
        storage.getAllBankAccounts(companyId),
        storage.getAllFixedAssets(companyId),
        storage.getAllEmployees(companyId),
        isFactoryCompany || isPropertiesCompany ? Promise.resolve([] as any[]) : storage.getAllSuppliers(),
        isFactoryCompany
          ? db
              .select()
              .from(factorySuppliers)
              .where(eq(factorySuppliers.companyId, companyId))
              .orderBy(factorySuppliers.name)
          : Promise.resolve([] as any[]),
        isFactoryCompany
          ? db.select().from(factoryContainers).where(eq(factoryContainers.companyId, companyId))
          : Promise.resolve([] as any[]),
        isFactoryCompany
          ? db.select().from(factorySupplierPayments).where(eq(factorySupplierPayments.companyId, companyId))
          : Promise.resolve([] as any[]),
        db
          .select({
            id: vouchers.id,
            voucherNumber: vouchers.voucherNumber,
            currency: vouchers.currency,
            exchangeRate: vouchers.exchangeRate,
          })
          .from(vouchers)
          .where(and(eq(vouchers.companyId, companyId), eq(vouchers.optional, false), isNull(vouchers.deletedAt)))
          .execute(),
        // Fetch all entries using a SQL subquery instead of first fetching IDs then inArray
        db
          .select()
          .from(voucherEntries)
          .where(
            sql`${voucherEntries.voucherId} IN (SELECT id FROM vouchers WHERE company_id = ${companyId} AND optional = false AND deleted_at IS NULL)`
          )
          .execute(),
      ]);

      const companyVoucherIds = companyVouchers.map((v) => v.id);
      // FACTORY-PAY-* voucher IDs — excluded when computing factory supplier voucher-paid amounts
      // to prevent double-counting with fPayments (factorySupplierPayments).
      const factoryPayVoucherIds = new Set(
        (companyVouchers as any[]).filter((v) => (v.voucherNumber || "").startsWith("FACTORY-PAY-")).map((v) => v.id)
      );
      // Map from voucherId -> {currency, exchangeRate} for USD conversion of factory supplier entries
      const voucherCurrencyMap = new Map<number, { currency: string; exchangeRate: string }>(
        (companyVouchers as any[]).map((v) => [
          v.id,
          { currency: v.currency || "USD", exchangeRate: v.exchangeRate || "1" },
        ])
      );

      // allEntries already fetched in parallel above (see Promise.all)

      // Group entries by account type and calculate balances
      const ledgerBalances = new Map<number, { debits: number; credits: number }>();
      const bankBalances = new Map<number, { debits: number; credits: number }>();
      const assetBalances = new Map<number, { debits: number; credits: number }>();
      const supplierBalances = new Map<number, number>();
      const employeeBalances = new Map<number, { debits: number; credits: number }>();
      const factorySupplierBalances = new Map<number, number>();
      const customerBalances = new Map<number, { debits: number; credits: number }>();

      for (const entry of allEntries) {
        const debit = parseFloat(entry.debitAmount || "0");
        const credit = parseFloat(entry.creditAmount || "0");

        if (entry.ledgerAccountId) {
          const existing = ledgerBalances.get(entry.ledgerAccountId) || { debits: 0, credits: 0 };
          ledgerBalances.set(entry.ledgerAccountId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.bankAccountId) {
          const existing = bankBalances.get(entry.bankAccountId) || { debits: 0, credits: 0 };
          bankBalances.set(entry.bankAccountId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.fixedAssetId) {
          const existing = assetBalances.get(entry.fixedAssetId) || { debits: 0, credits: 0 };
          assetBalances.set(entry.fixedAssetId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.supplierId) {
          const existing = supplierBalances.get(entry.supplierId) || 0;
          // Only count pure credit or pure debit entries to prevent double-counting
          if (credit > 0 && debit === 0) {
            supplierBalances.set(entry.supplierId, existing + credit); // Increase payable
          } else if (debit > 0 && credit === 0) {
            supplierBalances.set(entry.supplierId, existing - debit); // Decrease payable
          }
        }

        if ((entry as any).factorySupplierId) {
          const fsId = (entry as any).factorySupplierId as number;
          // Only track non-FACTORY-PAY-* debits as ERP voucher payments.
          // FACTORY-PAY-* vouchers are already counted via fPayments.
          if (!factoryPayVoucherIds.has(entry.voucherId) && debit > 0 && credit === 0) {
            // Convert to USD using the voucher's exchange rate
            const vInfo = voucherCurrencyMap.get(entry.voucherId) || { currency: "USD", exchangeRate: "1" };
            const fx = parseFloat(vInfo.exchangeRate) || 1;
            const debitUsd = vInfo.currency === "USD" ? debit : debit / fx;
            const existing = factorySupplierBalances.get(fsId) || 0;
            factorySupplierBalances.set(fsId, existing + debitUsd);
          }
        }

        if (entry.employeeId) {
          const existing = employeeBalances.get(entry.employeeId) || { debits: 0, credits: 0 };
          employeeBalances.set(entry.employeeId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if ((entry as any).customerId) {
          const cId = (entry as any).customerId as number;
          const existing = customerBalances.get(cId) || { debits: 0, credits: 0 };
          customerBalances.set(cId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }
      }

      // Opening balance only applies in the parent company's context (see
      // isChildCompany above) — child companies start every supplier at $0 and
      // only reflect movements from this company's own vouchers.

      // Helper function to calculate signed balance (positive = Dr, negative = Cr)
      const calculateSignedBalance = (
        openingBalance: string,
        openingBalanceSide: string | null,
        debits: number,
        credits: number
      ) => {
        let balance = parseFloat(openingBalance || "0");

        // If opening balance has a side, convert to signed number
        if (openingBalanceSide === "Cr") {
          balance = -balance;
        }

        // Add net change (debits increase, credits decrease)
        return balance + debits - credits;
      };

      // Build simplified account array for sidebar
      const accounts = [
        // Bank accounts
        ...banks.map((account) => {
          const movements = bankBalances.get(account.id) || { debits: 0, credits: 0 };
          const balance = calculateSignedBalance(
            account.openingBalance || "0",
            account.openingBalanceSide,
            movements.debits,
            movements.credits
          );

          return {
            id: account.id,
            type: "bank",
            name: account.name,
            code: account.code,
            balance,
          };
        }),
        ...employees.map((employee) => {
          const movements = employeeBalances.get(employee.id) || {
            debits: 0,
            credits: 0,
          };
          const openingBalance = parseFloat(employee.openingBalance || "0");
          // Employee accounts are liability (Cr-normal): credits increase balance, debits decrease it.
          // Positive netBalance = Cr (we owe them, the normal state).
          // This matches the payroll page's currentBalance convention.
          const netBalance = openingBalance + movements.credits - movements.debits;
          const balanceSide = netBalance >= 0 ? "Cr" : "Dr";

          return {
            id: `employee-${employee.id}`,
            accountId: employee.id,
            type: "employee",
            code: employee.code,
            name: `${employee.firstName} ${employee.lastName}`,
            balance: Math.abs(netBalance).toFixed(2),
            balanceSide,
            openingBalance: openingBalance,
            openingBalanceSide: "Cr",
            active: employee.active,
            parentId: null,
          };
        }),
        // Ledger accounts — all included (customer mirror ledgers appear alongside the customer entry)
        ...ledgers.map((account) => {
          const movements = ledgerBalances.get(account.id) || { debits: 0, credits: 0 };
          const balance = calculateSignedBalance(
            account.openingBalance || "0",
            account.openingBalanceSide,
            movements.debits,
            movements.credits
          );

          return {
            id: account.id,
            type: "ledger",
            name: account.name,
            code: account.code,
            balance,
          };
        }),
        // ERP Suppliers — only included for ERP companies (factory and properties use different account structures).
        // Child companies additionally omit suppliers with no activity in this company.
        ...suppliers
          .filter((supplier) => !isChildCompany || supplierBalances.has(supplier.id))
          .map((supplier) => {
            const transactionBalance = supplierBalances.get(supplier.id) || 0;
            const openingBalance = isChildCompany ? 0 : parseFloat(supplier.openingBalance || "0");
            // Suppliers are always Cr (we owe them). Negate so credit balance is negative in the signed system.
            const balance = -(openingBalance + transactionBalance);

            return {
              id: supplier.id,
              type: "supplier",
              name: supplier.legalName,
              code: supplier.code,
              balance,
            };
          }),
        // Factory Suppliers — only included for factory companies
        // Balance computed from factory tables (containers + payments) for accuracy,
        // matching the computeStats formula: includes freight, voucher payments, broker aggregation.
        ...fSuppliers.map((supplier) => {
          const openingBalance = parseFloat(supplier.openingBalance || "0");

          // Collect all supplier IDs to aggregate (the supplier itself + any children brokered through it)
          const linkedChildIds = (fSuppliers as any[])
            .filter((s: any) => s.parentId === supplier.id)
            .map((s: any) => s.id);
          const aggregateIds = [supplier.id, ...linkedChildIds];

          // Container value: sum((actualReceivedKg || totalKg) * ratePerKg + freight) * fxRateToUsd
          const supplierContainers = fContainers.filter((c: any) => aggregateIds.includes(c.supplierId));
          const containerValueUsd = supplierContainers.reduce((sum: number, c: any) => {
            const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
            const rate = parseFloat(c.ratePerKg || "0");
            const freight = parseFloat(c.freight || "0");
            const fx = parseFloat(c.fxRateToUsd || "1");
            return sum + (kg * rate + freight) * fx;
          }, 0);

          // Commission owed to this supplier as broker (exclude containers where they're also the main supplier)
          const brokerContainers = fContainers.filter(
            (c: any) =>
              c.commissionSupplierId === supplier.id &&
              !aggregateIds.includes(c.supplierId) &&
              parseFloat(c.commissionAmount || "0") > 0
          );
          const commissionValueUsd = brokerContainers.reduce((sum: number, c: any) => {
            const commAmt = parseFloat(c.commissionAmount || "0");
            const fx = parseFloat(c.fxRateToUsd || "1");
            const commCurr = c.commissionCurrencyCode || c.currencyCode || "USD";
            return sum + (commCurr === "USD" ? commAmt : commAmt * fx);
          }, 0);

          // Total paid via factorySupplierPayments (in USD) — aggregated across all linked IDs
          const supplierPayments = fPayments.filter((p: any) => aggregateIds.includes(p.supplierId));
          const totalPaidUsd = supplierPayments.reduce(
            (sum: number, p: any) => sum + parseFloat(p.amountUsd || "0"),
            0
          );

          // Total paid via non-FACTORY-PAY-* ERP voucher entries (aggregated across linked IDs)
          const voucherPaidUsd = aggregateIds.reduce((sum, sid) => sum + (factorySupplierBalances.get(sid) || 0), 0);

          // Outstanding balance (positive = we owe them). Negate for sidebar convention (negative = payable/red)
          const outstandingUsd =
            openingBalance + containerValueUsd + commissionValueUsd - totalPaidUsd - voucherPaidUsd;
          const balance = -outstandingUsd;

          return {
            id: supplier.id,
            type: "factorySupplier",
            name: supplier.name,
            code: String(supplier.id),
            balance,
          };
        }),
        // Customers appended below after async balance computation
        // Fixed Assets
        ...assets.map((asset) => {
          const movements = assetBalances.get(asset.id) || { debits: 0, credits: 0 };
          const balance = calculateSignedBalance(
            asset.openingBalance || "0",
            "Dr", // Fixed assets are always debit balance
            movements.debits,
            movements.credits
          );

          return {
            id: asset.id,
            type: "fixedAsset",
            name: asset.name,
            code: asset.code,
            balance,
          };
        }),
      ];

      // Customers are excluded from the voucher account selector — only ledger/bank/supplier accounts appear
      _vsBCache.set(companyId, { data: accounts, expiresAt: Date.now() + 30_000 });
      if (_vsBCache.size > 100) {
        const now = Date.now();
        for (const [k, v] of _vsBCache) {
          if (now >= v.expiresAt) _vsBCache.delete(k);
        }
      }
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get balance for a specific ledger account
  app.get("/api/accounts/ledger/:id/balance", requireAuth, async (req, res) => {
    try {
      const ledgerAccountId = parseInt(req.params.id);

      if (isNaN(ledgerAccountId)) {
        return res.status(400).json({ message: "Invalid ledger account ID" });
      }

      const account = await storage.getLedgerAccountById(ledgerAccountId);

      // If not found as a ledger account, it may be a bank account ID (entries stored
      // in voucherEntries.bankAccountId, not ledgerAccountId). Compute balance from
      // the bankAccounts table + getVoucherEntriesByBankAccount so the Daybook entry
      // balance display shows the correct value instead of $0.
      if (!account) {
        const [bankAcct] = await db
          .select({ openingBalance: bankAccounts.openingBalance, openingBalanceSide: bankAccounts.openingBalanceSide })
          .from(bankAccounts)
          .where(eq(bankAccounts.id, ledgerAccountId))
          .limit(1);

        if (!bankAcct) {
          return res.status(404).json({ message: "Account not found" });
        }

        const bankTxs = await storage.getVoucherEntriesByBankAccount(ledgerAccountId);
        let bDebits = 0;
        let bCredits = 0;
        for (const tx of bankTxs) {
          bDebits += parseFloat(tx.debitAmount || "0");
          bCredits += parseFloat(tx.creditAmount || "0");
        }
        const bOB = parseFloat(bankAcct.openingBalance || "0");
        const bSide = bankAcct.openingBalanceSide || "Dr";
        const bankBalance = bOB * (bSide === "Cr" ? -1 : 1) + bDebits - bCredits;
        return res.json({ balance: bankBalance });
      }

      // Check if this ledger account is linked to a customer
      const [linkedCustomer] = await db
        .select({ id: customers.id, ob: customers.openingBalance, side: customers.openingBalanceSide })
        .from(customers)
        .where(eq(customers.ledgerAccountId, ledgerAccountId))
        .limit(1);

      // For factory customer-linked ledger accounts, use the same combined formula
      // as /api/factory/customers so the Accounts page balance matches the Customers page.
      if (linkedCustomer) {
        const currentCompany = await storage.getCompanyById(req.session?.currentCompanyId || 0);
        if (currentCompany?.companyType === "factory") {
          const custId = linkedCustomer.id;
          const [salesRows, cbRows, lVoucherRows, cVoucherRows] = await Promise.all([
            db
              .select({
                total: sql<string>`COALESCE(SUM(CAST(${customerOrders.grandTotal} AS numeric)), 0)`,
              })
              .from(customerOrders)
              .where(
                and(
                  eq(customerOrders.customerId, custId),
                  eq(customerOrders.companyId, req.session?.currentCompanyId || 0),
                  eq(customerOrders.status, "FINALIZED")
                )
              ),

            db
              .select({
                net: sql<string>`COALESCE(SUM(CAST(${customerBalances.debitAmount} AS numeric) - CAST(${customerBalances.creditAmount} AS numeric)), 0)`,
              })
              .from(customerBalances)
              .where(
                and(
                  eq(customerBalances.customerId, custId),
                  eq(customerBalances.companyId, req.session?.currentCompanyId || 0),
                  sql`${customerBalances.referenceType} IS DISTINCT FROM 'INVOICE'`
                )
              ),

            db
              .select({
                net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
              })
              .from(voucherEntries)
              .innerJoin(
                vouchers,
                and(
                  eq(voucherEntries.voucherId, vouchers.id),
                  eq(vouchers.optional, false),
                  isNull(vouchers.deletedAt),
                  sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`
                )
              )
              .where(eq(voucherEntries.ledgerAccountId, ledgerAccountId)),

            db
              .select({
                net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
              })
              .from(voucherEntries)
              .innerJoin(
                vouchers,
                and(
                  eq(voucherEntries.voucherId, vouchers.id),
                  eq(vouchers.optional, false),
                  isNull(vouchers.deletedAt),
                  sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`
                )
              )
              .where(and(eq(voucherEntries.customerId, custId), isNull(voucherEntries.ledgerAccountId))),
          ]);

          const salesTotal = parseFloat(salesRows[0]?.total || "0");
          const nonInvNet = parseFloat(cbRows[0]?.net || "0");
          const vNet = parseFloat(lVoucherRows[0]?.net || "0") + parseFloat(cVoucherRows[0]?.net || "0");
          const ob = parseFloat(linkedCustomer.ob || "0");
          const obSide = linkedCustomer.side || "Dr";
          const balance = (obSide === "Dr" ? ob : -ob) + salesTotal + nonInvNet + vNet;
          return res.json({ balance });
        }
      }

      const companyIdForBalance = (req.session as any).currentCompanyId as number | undefined;
      const transactions = await storage.getVoucherEntriesByLedger(ledgerAccountId, undefined, undefined, companyIdForBalance);
      let debits = 0;
      let credits = 0;
      for (const tx of transactions) {
        debits += parseFloat(tx.debitAmount || "0");
        credits += parseFloat(tx.creditAmount || "0");
      }

      // Some bank accounts have a linkedLedgerId pointing to this ledger account.
      // Their voucher entries are stored under bankAccountId (not ledgerAccountId),
      // so getVoucherEntriesByLedger misses them. Mirror the factoryWorkerPayrollRoutes
      // pattern: find linked banks and fold in their entries + opening balances.
      const linkedBanks = await db
        .select({
          id: bankAccounts.id,
          openingBalance: bankAccounts.openingBalance,
          openingBalanceSide: bankAccounts.openingBalanceSide,
        })
        .from(bankAccounts)
        .where(eq(bankAccounts.linkedLedgerId, ledgerAccountId));

      let linkedBankOB = 0;
      for (const bank of linkedBanks) {
        const bankTxs = await storage.getVoucherEntriesByBankAccount(bank.id);
        for (const tx of bankTxs) {
          debits += parseFloat(tx.debitAmount || "0");
          credits += parseFloat(tx.creditAmount || "0");
        }
        const bOB = parseFloat(bank.openingBalance || "0");
        const bSide = bank.openingBalanceSide || "Dr";
        linkedBankOB += bOB * (bSide === "Cr" ? -1 : 1);
      }

      const rawOB = parseFloat((linkedCustomer?.ob ?? account.openingBalance) || "0");
      const rawSide = linkedCustomer?.side ?? account.openingBalanceSide;
      const balance = rawOB * (rawSide === "Cr" ? -1 : 1) + linkedBankOB + debits - credits;

      res.json({ balance });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get per-currency balance breakdown for a ledger account (all-time, no date filter)
  app.get("/api/accounts/ledger/:id/currency-balances", requireAuth, async (req, res) => {
    try {
      const ledgerAccountId = parseInt(req.params.id);
      if (isNaN(ledgerAccountId)) {
        return res.status(400).json({ message: "Invalid ledger account ID" });
      }

      const rows = await db
        .select({
          currency: vouchers.currency,
          totalDebit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric)), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
        })
        .from(voucherEntries)
        .leftJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            eq(voucherEntries.ledgerAccountId, ledgerAccountId),
            eq(vouchers.optional, false),
            isNull(vouchers.deletedAt)
          )
        )
        .groupBy(vouchers.currency);

      const result = rows.map((r: any) => ({
        currency: r.currency || "USD",
        totalDebit: parseFloat(r.totalDebit || "0"),
        totalCredit: parseFloat(r.totalCredit || "0"),
      }));

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a specific ledger account with optional date filtering
  app.get("/api/accounts/ledger/:id/transactions", requireAuth, async (req, res) => {
    try {
      const ledgerAccountId = parseInt(req.params.id);

      if (isNaN(ledgerAccountId)) {
        return res.status(400).json({ message: "Invalid ledger account ID" });
      }

      const asOfDate = getClientDate(req);
      const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
      const rawStart =
        typeof req.query.startDate === "string" && ISO_DATE.test(req.query.startDate)
          ? req.query.startDate
          : undefined;
      const rawEnd =
        typeof req.query.endDate === "string" && ISO_DATE.test(req.query.endDate)
          ? req.query.endDate
          : undefined;
      // Cap the end date at today so future-dated vouchers are never shown
      const effectiveEndDate = rawEnd && rawEnd < asOfDate ? rawEnd : asOfDate;

      // 1. Load the ledger account to get its authoritative company scope.
      //    Using ledgerAccount.companyId (not req.session.currentCompanyId) so the
      //    correct company is used even when the caller is in factory mode.
      const [ledgerAccount] = await db
        .select()
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, ledgerAccountId), isNull(ledgerAccounts.deletedAt)));

      if (!ledgerAccount) {
        return res.status(404).json({ message: "Ledger account not found" });
      }
      const companyId: number = ledgerAccount.companyId;

      // 2. If this ledger is linked to a factory customer, return the unified
      //    factory-customer ledger view (plain array — frontend handles both shapes).
      try {
        const linkedCust = await getCustomerByLedgerId(ledgerAccountId);
        if (linkedCust) {
          const company = await storage.getCompanyById(linkedCust.companyId);
          if (company?.companyType === "factory") {
            const entries = await buildFactoryCustomerLedgerEntries(
              linkedCust.id,
              ledgerAccountId,
              linkedCust.companyId,
              rawStart,
              effectiveEndDate
            );
            return res.json(entries);
          }
        }
      } catch (e) {
        // If the factory-customer lookup fails for any reason, fall back to
        // the regular ledger entries so the page never breaks.
        console.error("[ledger transactions] factory-customer lookup failed:", e);
      }

      // 3. Main query: period transactions capped at today
      const transactions = await storage.getVoucherEntriesByLedger(
        ledgerAccountId,
        rawStart,
        effectiveEndDate,
        companyId
      );

      // 4. Brought-forward balance: sum of entries strictly before the period start.
      //    For All Time (no rawStart), preNetBalance = 0 — the stored opening balance suffices.
      let preNetBalance = 0;
      if (rawStart) {
        const bfParams: any[] = [ledgerAccountId, rawStart];
        let bfCompanyFilter = "";
        if (companyId) {
          bfParams.push(companyId);
          bfCompanyFilter = "AND v.company_id = $" + bfParams.length;
        }
        const bfResult = await pool.query(
          `SELECT COALESCE(SUM(ve.debit_amount::numeric - ve.credit_amount::numeric), 0) AS net
           FROM voucher_entries ve
           JOIN vouchers v ON ve.voucher_id = v.id
           WHERE ve.ledger_account_id = $1
             AND v.optional = false
             AND v.deleted_at IS NULL
             AND COALESCE(v.effective_date::date, v.voucher_date::date) < $2::date
             ${bfCompanyFilter}`,
          bfParams
        );
        preNetBalance = parseFloat(bfResult.rows[0]?.net ?? "0");
      }

      return res.json({
        transactions,
        preNetBalance,
        asOfDate,
        startDate: rawStart ?? null,
        endDate: effectiveEndDate,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a specific bank account with optional date filtering
  app.get("/api/accounts/bank/:id/transactions", requireAuth, async (req, res) => {
    try {
      const bankAccountId = parseInt(req.params.id);
      if (isNaN(bankAccountId)) {
        return res.status(400).json({ message: "Invalid bank account ID" });
      }

      const asOfDate = getClientDate(req);
      const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
      const rawStart =
        typeof req.query.startDate === "string" && ISO_DATE.test(req.query.startDate)
          ? req.query.startDate : undefined;
      const rawEnd =
        typeof req.query.endDate === "string" && ISO_DATE.test(req.query.endDate)
          ? req.query.endDate : undefined;
      const effectiveEndDate = rawEnd && rawEnd < asOfDate ? rawEnd : asOfDate;

      // Load account to get authoritative company scope
      const [bankAccount] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, bankAccountId));
      if (!bankAccount) return res.status(404).json({ message: "Bank account not found" });
      const companyId = bankAccount.companyId;

      // Authorize: confirm the logged-in user can access this company
      const authorizedCompanyId = await authorizeCompanyIdParam(req as any, companyId);
      if (authorizedCompanyId === null) {
        return res.status(403).json({ message: "No access to this account's company" });
      }

      const transactions = await storage.getVoucherEntriesByBankAccount(
        bankAccountId,
        rawStart,
        effectiveEndDate,
        companyId
      );

      let preNetBalance = 0;
      if (rawStart) {
        const bfResult = await pool.query(
          `SELECT COALESCE(SUM(ve.debit_amount::numeric - ve.credit_amount::numeric), 0) AS net
           FROM voucher_entries ve
           JOIN vouchers v ON ve.voucher_id = v.id
           WHERE ve.bank_account_id = $1
             AND v.optional = false
             AND v.deleted_at IS NULL
             AND v.company_id = $2
             AND COALESCE(v.effective_date::date, v.voucher_date::date) < $3::date`,
          [bankAccountId, companyId, rawStart]
        );
        preNetBalance = parseFloat(bfResult.rows[0]?.net ?? "0");
      }

      return res.json({
        transactions,
        preNetBalance,
        asOfDate,
        startDate: rawStart ?? null,
        endDate: effectiveEndDate,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a specific fixed asset with optional date filtering
  app.get("/api/accounts/fixed-asset/:id/transactions", requireAuth, async (req, res) => {
    try {
      const fixedAssetId = parseInt(req.params.id);
      if (isNaN(fixedAssetId)) {
        return res.status(400).json({ message: "Invalid fixed asset ID" });
      }

      const asOfDate = getClientDate(req);
      const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
      const rawStart =
        typeof req.query.startDate === "string" && ISO_DATE.test(req.query.startDate)
          ? req.query.startDate : undefined;
      const rawEnd =
        typeof req.query.endDate === "string" && ISO_DATE.test(req.query.endDate)
          ? req.query.endDate : undefined;
      const effectiveEndDate = rawEnd && rawEnd < asOfDate ? rawEnd : asOfDate;

      // Load account to get authoritative company scope
      const [fixedAsset] = await db.select().from(fixedAssets).where(eq(fixedAssets.id, fixedAssetId));
      if (!fixedAsset) return res.status(404).json({ message: "Fixed asset not found" });
      const companyId = fixedAsset.companyId;

      // Authorize: confirm the logged-in user can access this company
      const authorizedCompanyId = await authorizeCompanyIdParam(req as any, companyId);
      if (authorizedCompanyId === null) {
        return res.status(403).json({ message: "No access to this account's company" });
      }

      const transactions = await storage.getVoucherEntriesByFixedAsset(
        fixedAssetId,
        rawStart,
        effectiveEndDate,
        companyId
      );

      let preNetBalance = 0;
      if (rawStart) {
        const bfResult = await pool.query(
          `SELECT COALESCE(SUM(ve.debit_amount::numeric - ve.credit_amount::numeric), 0) AS net
           FROM voucher_entries ve
           JOIN vouchers v ON ve.voucher_id = v.id
           WHERE ve.fixed_asset_id = $1
             AND v.optional = false
             AND v.deleted_at IS NULL
             AND v.company_id = $2
             AND COALESCE(v.effective_date::date, v.voucher_date::date) < $3::date`,
          [fixedAssetId, companyId, rawStart]
        );
        preNetBalance = parseFloat(bfResult.rows[0]?.net ?? "0");
      }

      return res.json({
        transactions,
        preNetBalance,
        asOfDate,
        startDate: rawStart ?? null,
        endDate: effectiveEndDate,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a specific supplier with optional date filtering
  app.get("/api/accounts/supplier/:id/transactions", requireAuth, async (req, res) => {
    try {
      const supplierId = parseInt(req.params.id);
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      const asOfDate = getClientDate(req);
      const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
      const rawStart =
        typeof req.query.startDate === "string" && ISO_DATE.test(req.query.startDate)
          ? req.query.startDate : undefined;
      const rawEnd =
        typeof req.query.endDate === "string" && ISO_DATE.test(req.query.endDate)
          ? req.query.endDate : undefined;
      const effectiveEndDate = rawEnd && rawEnd < asOfDate ? rawEnd : asOfDate;

      const requestedCompanyId = req.query.companyId ? parseInt(req.query.companyId as string) : undefined;

      // Suppliers are shared across companies, so a caller-supplied companyId
      // must be authorized against the user's actual company access — never
      // trusted blindly (it would otherwise let one company's session peek at
      // another company's supplier ledger).
      const filterCompanyId = await authorizeCompanyIdParam(req as any, requestedCompanyId);
      if (requestedCompanyId && filterCompanyId === null) {
        return res.status(403).json({ message: "No access to this company" });
      }

      const transactions = await storage.getVoucherEntriesBySupplier(
        supplierId,
        filterCompanyId ?? undefined,
        rawStart,
        effectiveEndDate
      );

      let preNetBalance = 0;
      if (rawStart) {
        // Brought-forward balance must be scoped to the same company as the
        // transactions above — otherwise it silently pulls in every other
        // company's history for this (globally shared) supplier record.
        const conditions = [
          `ve.supplier_id = $1`,
          `v.optional = false`,
          `v.deleted_at IS NULL`,
          `COALESCE(v.effective_date::date, v.voucher_date::date) < $2::date`,
        ];
        const params: any[] = [supplierId, rawStart];
        if (filterCompanyId) {
          conditions.push("v.company_id = $" + (params.length + 1));
          params.push(filterCompanyId);
        }
        const bfResult = await pool.query(
          `SELECT COALESCE(SUM(ve.debit_amount::numeric - ve.credit_amount::numeric), 0) AS net
           FROM voucher_entries ve
           JOIN vouchers v ON ve.voucher_id = v.id
           WHERE ${conditions.join(" AND ")}`,
          params
        );
        preNetBalance = parseFloat(bfResult.rows[0]?.net ?? "0");
      }

      return res.json({
        transactions,
        preNetBalance,
        asOfDate,
        startDate: rawStart ?? null,
        endDate: effectiveEndDate,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a specific employee with optional date filtering
  app.get("/api/accounts/employee/:id/transactions", requireAuth, async (req, res) => {
    try {
      const employeeId = parseInt(req.params.id);
      if (isNaN(employeeId)) {
        return res.status(400).json({ message: "Invalid employee ID" });
      }

      const asOfDate = getClientDate(req);
      const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
      const rawStart =
        typeof req.query.startDate === "string" && ISO_DATE.test(req.query.startDate)
          ? req.query.startDate : undefined;
      const rawEnd =
        typeof req.query.endDate === "string" && ISO_DATE.test(req.query.endDate)
          ? req.query.endDate : undefined;
      const effectiveEndDate = rawEnd && rawEnd < asOfDate ? rawEnd : asOfDate;

      // Load employee to get authoritative company scope
      const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
      if (!employee) return res.status(404).json({ message: "Employee not found" });
      const companyId = employee.companyId;

      // Authorize: confirm the logged-in user can access this company
      const authorizedCompanyId = await authorizeCompanyIdParam(req as any, companyId);
      if (authorizedCompanyId === null) {
        return res.status(403).json({ message: "No access to this account's company" });
      }

      const transactions = await storage.getVoucherEntriesByEmployee(
        employeeId,
        companyId,
        rawStart,
        effectiveEndDate
      );

      let preNetBalance = 0;
      if (rawStart) {
        const bfResult = await pool.query(
          `SELECT COALESCE(SUM(ve.debit_amount::numeric - ve.credit_amount::numeric), 0) AS net
           FROM voucher_entries ve
           JOIN vouchers v ON ve.voucher_id = v.id
           WHERE ve.employee_id = $1
             AND v.optional = false
             AND v.deleted_at IS NULL
             AND v.company_id = $2
             AND COALESCE(v.effective_date::date, v.voucher_date::date) < $3::date`,
          [employeeId, companyId, rawStart]
        );
        preNetBalance = parseFloat(bfResult.rows[0]?.net ?? "0");
      }

      return res.json({
        transactions,
        preNetBalance,
        asOfDate,
        startDate: rawStart ?? null,
        endDate: effectiveEndDate,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a specific customer (maps customerBalances to voucher-entry format)
  app.get("/api/accounts/customer/:id/transactions", requireAuth, async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) {
        return res.status(400).json({ message: "Invalid customer ID" });
      }

      const asOfDate = getClientDate(req);
      const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
      const rawStart =
        typeof req.query.startDate === "string" && ISO_DATE.test(req.query.startDate)
          ? req.query.startDate : undefined;
      const rawEnd =
        typeof req.query.endDate === "string" && ISO_DATE.test(req.query.endDate)
          ? req.query.endDate : undefined;
      const effectiveEndDate = rawEnd && rawEnd < asOfDate ? rawEnd : asOfDate;

      // Load customer to get authoritative company scope
      const [customer] = await db.select().from(customers).where(eq(customers.id, customerId));
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      const companyId = customer.companyId;

      // Authorize: confirm the logged-in user can access this company
      const authorizedCompanyId = await authorizeCompanyIdParam(req as any, companyId);
      if (authorizedCompanyId === null) {
        return res.status(403).json({ message: "No access to this account's company" });
      }

      const statement = await storage.getCustomerStatement(
        customerId,
        companyId,
        rawStart,
        effectiveEndDate
      );
      // Map CustomerBalance rows to the same shape the Accounts page expects for transactions
      const mapped = statement.map((row) => ({
        id: row.id,
        voucherId: row.referenceId ?? row.id,
        voucherNumber: row.referenceType ? `${row.referenceType}-${row.referenceId}` : `CB-${row.id}`,
        voucherType: row.transactionType,
        voucherDate: row.transactionDate,
        voucherDescription: row.description || "",
        narration: row.description || "",
        debitAmount: row.debitAmount,
        creditAmount: row.creditAmount,
      }));

      let preNetBalance = 0;
      if (rawStart) {
        const bfResult = await pool.query(
          `SELECT COALESCE(SUM(cb.debit_amount::numeric - cb.credit_amount::numeric), 0) AS net
           FROM customer_balances cb
           WHERE cb.customer_id = $1
             AND cb.company_id = $2
             AND cb.transaction_date < $3::date`,
          [customerId, companyId, rawStart]
        );
        preNetBalance = parseFloat(bfResult.rows[0]?.net ?? "0");
      }

      return res.json({
        transactions: mapped,
        preNetBalance,
        asOfDate,
        startDate: rawStart ?? null,
        endDate: effectiveEndDate,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get deleted (soft-deleted) vouchers for a specific account — used by the Accounts page
  // to show recoverable vouchers directly in the ledger view.
  app.get("/api/accounts/:type/:id/deleted-vouchers", requireAuth, async (req, res) => {
    try {
      const accountType = req.params.type;
      const accountId = parseInt(req.params.id);
      const companyId = req.session.currentCompanyId;

      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid ID" });
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Build the account-specific filter on voucherEntries
      let entryFilter: any;
      switch (accountType) {
        case "ledger":
          entryFilter = eq(voucherEntries.ledgerAccountId, accountId);
          break;
        case "bank":
          entryFilter = eq(voucherEntries.bankAccountId, accountId);
          break;
        case "fixed-asset":
          entryFilter = eq(voucherEntries.fixedAssetId, accountId);
          break;
        case "supplier":
          entryFilter = eq(voucherEntries.supplierId, accountId);
          break;
        case "employee":
          entryFilter = eq(voucherEntries.employeeId, accountId);
          break;
        case "customer":
          entryFilter = eq(voucherEntries.customerId, accountId);
          break;
        default:
          return res.json([]);
      }

      const results = await db
        .selectDistinct({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          totalAmount: vouchers.totalAmount,
          description: vouchers.description,
          locationName: vouchers.locationName,
          deletedAt: vouchers.deletedAt,
        })
        .from(vouchers)
        .innerJoin(voucherEntries, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(eq(vouchers.companyId, companyId), isNotNull(vouchers.deletedAt), entryFilter))
        .orderBy(desc(vouchers.deletedAt));

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Compute the pre-period (opening) balance for any account type
  // endDate = last day BEFORE the current period start
  app.get("/api/accounts/:type/:id/pre-period-balance", requireAuth, async (req, res) => {
    try {
      const accountType = req.params.type;
      const accountId = parseInt(req.params.id);
      const { endDate } = req.query as { endDate?: string };
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account ID" });

      // Map type to the FK column name in voucher_entries
      const typeToColumn: Record<string, any> = {
        ledger: voucherEntries.ledgerAccountId,
        bank: voucherEntries.bankAccountId,
        "fixed-asset": voucherEntries.fixedAssetId,
        supplier: voucherEntries.supplierId,
        employee: voucherEntries.employeeId,
        customer: voucherEntries.customerId,
      };
      const entryColumn = typeToColumn[accountType];
      if (!entryColumn) return res.status(400).json({ message: "Unknown account type" });

      // Get initial opening balance from the account table
      let rawOB = 0;
      let obSide = "Dr";
      if (accountType === "ledger") {
        const [acct] = await db
          .select({ ob: ledgerAccounts.openingBalance, side: ledgerAccounts.openingBalanceSide })
          .from(ledgerAccounts)
          .where(eq(ledgerAccounts.id, accountId));
        // If this ledger account is linked to a customer, the customer's
        // opening balance is the authoritative source of truth.
        const [linkedCust] = await db
          .select({ id: customers.id, ob: customers.openingBalance, side: customers.openingBalanceSide })
          .from(customers)
          .where(eq(customers.ledgerAccountId, accountId))
          .limit(1);
        rawOB = parseFloat(linkedCust?.ob ?? acct?.ob ?? "0") || 0;
        obSide = linkedCust?.side ?? acct?.side ?? "Dr";

        // For factory customer-linked ledger accounts, use combined formula
        // (sales + customerBalances non-INVOICE + voucherEntries via both paths, all before endDate)
        if (linkedCust) {
          const currentCompany = await storage.getCompanyById(companyId);
          if (currentCompany?.companyType === "factory") {
            const custId = linkedCust.id;
            const dateFilter = endDate ? sql`${vouchers.voucherDate} < ${endDate}` : sql`1=1`;
            const orderDateFilter = endDate ? sql`${customerOrders.orderDate} < ${endDate}` : sql`1=1`;
            const cbDateFilter = endDate ? sql`${customerBalances.transactionDate} < ${endDate}` : sql`1=1`;

            const [salesRows, cbRows, lVRows, cVRows] = await Promise.all([
              db
                .select({
                  total: sql<string>`COALESCE(SUM(CAST(${customerOrders.grandTotal} AS numeric)), 0)`,
                })
                .from(customerOrders)
                .where(
                  and(
                    eq(customerOrders.customerId, custId),
                    eq(customerOrders.companyId, companyId),
                    eq(customerOrders.status, "FINALIZED"),
                    orderDateFilter
                  )
                ),

              db
                .select({
                  net: sql<string>`COALESCE(SUM(CAST(${customerBalances.debitAmount} AS numeric) - CAST(${customerBalances.creditAmount} AS numeric)), 0)`,
                })
                .from(customerBalances)
                .where(
                  and(
                    eq(customerBalances.customerId, custId),
                    eq(customerBalances.companyId, companyId),
                    sql`${customerBalances.referenceType} IS DISTINCT FROM 'INVOICE'`,
                    cbDateFilter
                  )
                ),

              db
                .select({
                  net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
                })
                .from(voucherEntries)
                .leftJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
                .where(
                  and(
                    eq(voucherEntries.ledgerAccountId, accountId),
                    eq(vouchers.optional, false),
                    isNull(vouchers.deletedAt),
                    sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`,
                    dateFilter
                  )
                ),

              db
                .select({
                  net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
                })
                .from(voucherEntries)
                .leftJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
                .where(
                  and(
                    eq(voucherEntries.customerId, custId),
                    isNull(voucherEntries.ledgerAccountId),
                    eq(vouchers.optional, false),
                    isNull(vouchers.deletedAt),
                    sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`,
                    dateFilter
                  )
                ),
            ]);

            const salesTotal = parseFloat(salesRows[0]?.total || "0");
            const nonInvNet = parseFloat(cbRows[0]?.net || "0");
            const vNet = parseFloat(lVRows[0]?.net || "0") + parseFloat(cVRows[0]?.net || "0");
            const ob = parseFloat(linkedCust.ob || "0");
            const side = linkedCust.side || "Dr";
            const prePeriodBalance = (side === "Dr" ? ob : -ob) + salesTotal + nonInvNet + vNet;
            return res.json({ balance: prePeriodBalance });
          }
        }
      } else if (accountType === "bank") {
        const [acct] = await db
          .select({ ob: bankAccounts.openingBalance, side: bankAccounts.openingBalanceSide })
          .from(bankAccounts)
          .where(eq(bankAccounts.id, accountId));
        rawOB = parseFloat(acct?.ob ?? "0") || 0;
        obSide = acct?.side ?? "Dr";
      } else if (accountType === "supplier") {
        // The supplier opening balance only belongs to the parent company's
        // books — never guess this via "lowest company ID".
        const isParentForSupplier = await isParentCompanyContext(companyId);
        if (isParentForSupplier) {
          const [acct] = await db
            .select({ ob: suppliers.openingBalance })
            .from(suppliers)
            .where(eq(suppliers.id, accountId));
          rawOB = parseFloat(acct?.ob ?? "0") || 0;
        } else {
          rawOB = 0;
        }
        obSide = "Cr";
      } else if (accountType === "employee") {
        const [acct] = await db
          .select({ ob: employees.openingBalance })
          .from(employees)
          .where(eq(employees.id, accountId));
        rawOB = parseFloat(acct?.ob ?? "0") || 0;
        obSide = "Cr";
      } else if (accountType === "customer") {
        const [acct] = await db
          .select({ ob: customers.openingBalance })
          .from(customers)
          .where(eq(customers.id, accountId));
        rawOB = parseFloat(acct?.ob ?? "0") || 0;
        obSide = "Dr";
      } else if (accountType === "fixed-asset") {
        const [acct] = await db
          .select({ ob: fixedAssets.openingBalance })
          .from(fixedAssets)
          .where(eq(fixedAssets.id, accountId));
        rawOB = parseFloat(acct?.ob ?? "0") || 0;
        obSide = "Dr";
      }

      // Signed initial opening balance
      // Supplier: positive rawOB is treated as Cr (they're owed money)
      // Others: Cr side means negative in Dr-positive convention
      const isSupplier = accountType === "supplier";
      let balance = isSupplier ? rawOB : obSide === "Cr" ? -rawOB : rawOB;

      // Sum all voucher entries before endDate (exclusive of period start)
      if (endDate) {
        const conditions: any[] = [
          eq(entryColumn, accountId),
          eq(vouchers.optional, false),
          isNull(vouchers.deletedAt),
          sql`${vouchers.voucherDate} < ${endDate}`,
        ];
        // Suppliers are shared across companies — scope strictly to this
        // company's own vouchers or the pre-period balance would silently
        // include every other company's history for the same supplier.
        if (isSupplier) {
          conditions.push(eq(vouchers.companyId, companyId));
        }
        const [totals] = await db
          .select({
            totalDebit: sql<string>`COALESCE(SUM(${voucherEntries.debitAmount}), 0)`,
            totalCredit: sql<string>`COALESCE(SUM(${voucherEntries.creditAmount}), 0)`,
          })
          .from(voucherEntries)
          .leftJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(and(...conditions));

        const sumDebit = parseFloat(totals?.totalDebit ?? "0") || 0;
        const sumCredit = parseFloat(totals?.totalCredit ?? "0") || 0;
        if (isSupplier) {
          balance += sumCredit - sumDebit;
        } else {
          balance += sumDebit - sumCredit;
        }
      }

      res.json({ balance });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Account Statement PDF export ──────────────────────────────────────────
  app.get("/api/accounts/:type/:id/statement-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const accountType = req.params.type;
      const accountId = parseInt(req.params.id);
      const companyId = (req.session as any).currentCompanyId;
      const { startDate, endDate, lang = "en" } = req.query as { startDate?: string; endDate?: string; lang?: string };

      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account ID" });

      const { generateAccountStatementPdf } = await import("../lib/accountStatementPdfGenerator");
      const pdfBuf = await generateAccountStatementPdf({ accountType, accountId, companyId, startDate, endDate, lang });

      // Resolve human-readable account name for the filename
      let resolvedName = `${accountType}_${accountId}`;
      try {
        if (accountType === "ledger") {
          const [r] = await db
            .select({ name: ledgerAccounts.name })
            .from(ledgerAccounts)
            .where(eq(ledgerAccounts.id, accountId));
          resolvedName = r?.name ?? resolvedName;
        } else if (accountType === "bank") {
          const [r] = await db
            .select({ name: bankAccounts.name })
            .from(bankAccounts)
            .where(eq(bankAccounts.id, accountId));
          resolvedName = r?.name ?? resolvedName;
        } else if (accountType === "fixed-asset") {
          const [r] = await db
            .select({ name: fixedAssets.name })
            .from(fixedAssets)
            .where(eq(fixedAssets.id, accountId));
          resolvedName = r?.name ?? resolvedName;
        } else if (accountType === "supplier") {
          const [r] = await db.select({ name: suppliers.legalName }).from(suppliers).where(eq(suppliers.id, accountId));
          resolvedName = r?.name ?? resolvedName;
        } else if (accountType === "customer") {
          const [r] = await db
            .select({ name: customers.legalName })
            .from(customers)
            .where(eq(customers.id, accountId));
          resolvedName = r?.name ?? resolvedName;
        } else if (accountType === "employee") {
          const [r] = await db
            .select({ firstName: employees.firstName, lastName: employees.lastName })
            .from(employees)
            .where(eq(employees.id, accountId));
          if (r) resolvedName = `${r.firstName} ${r.lastName}`.trim();
        }
      } catch {}
      const safeAccName = resolvedName.replace(/[^\w\s.()\-]/g, "_").replace(/\s+/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=statement_${safeAccName}.pdf`);
      res.end(pdfBuf);
      return;

      // Legacy code below is unreachable — kept for reference only
    } catch (err: any) {
      console.error("Statement PDF error:", err);
      if (!res.headersSent) res.status(500).json({ message: err.message });
    }
  });

  // ── Ledger / Account Statement — Excel export ────────────────────────────
  app.get("/api/accounts/statement/export-excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId as number;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const accountType = (req.query.accountType as string) || "ledger";
      const accountId = parseInt(req.query.accountId as string);
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid accountId" });
      const startDate = (req.query.startDate as string) || undefined;
      const endDate = (req.query.endDate as string) || undefined;

      // Resolve account name and opening balance
      let accountName = "Account";
      let openingBalance = 0;
      let openingBalanceSide = "Dr";

      const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId));

      if (accountType === "ledger") {
        const [acct] = await db
          .select({ name: ledgerAccounts.name, openingBalance: ledgerAccounts.openingBalance, openingBalanceSide: ledgerAccounts.openingBalanceSide })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, companyId)));
        if (!acct) return res.status(404).json({ message: "Account not found" });
        accountName = acct.name;
        openingBalance = parseFloat(acct.openingBalance || "0");
        openingBalanceSide = (acct as any).openingBalanceSide || "Dr";
      } else if (accountType === "bank") {
        const [acct] = await db
          .select({ name: bankAccounts.name })
          .from(bankAccounts)
          .where(and(eq(bankAccounts.id, accountId), eq(bankAccounts.companyId, companyId)));
        if (!acct) return res.status(404).json({ message: "Bank account not found" });
        accountName = acct.name;
      } else if (accountType === "supplier") {
        const [acct] = await db.select({ name: suppliers.legalName }).from(suppliers).where(eq(suppliers.id, accountId));
        if (!acct) return res.status(404).json({ message: "Supplier not found" });
        accountName = acct.name ?? "Supplier";
      } else if (accountType === "employee") {
        const [acct] = await db
          .select({ firstName: employees.firstName, lastName: employees.lastName })
          .from(employees)
          .where(and(eq(employees.id, accountId), eq(employees.companyId, companyId)));
        if (!acct) return res.status(404).json({ message: "Employee not found" });
        accountName = `${acct.firstName} ${acct.lastName}`.trim();
      }

      // Fetch transactions
      let txRows: any[] = [];
      if (accountType === "ledger") {
        txRows = await storage.getVoucherEntriesByLedger(accountId, startDate, endDate, companyId);
      } else if (accountType === "bank") {
        txRows = await storage.getVoucherEntriesByBankAccount(accountId, startDate, endDate);
      } else if (accountType === "supplier") {
        txRows = await storage.getVoucherEntriesBySupplier(accountId, companyId, startDate, endDate);
      } else if (accountType === "employee") {
        txRows = await storage.getVoucherEntriesByEmployee(accountId, companyId, startDate, endDate);
      }

      // Compute brought-forward balance (entries before startDate when filtering)
      let allTxForBF: any[] = [];
      if (startDate && accountType === "ledger") {
        allTxForBF = await storage.getVoucherEntriesByLedger(accountId, undefined, undefined, companyId);
      }
      let bfBalance = openingBalanceSide === "Dr" ? openingBalance : -openingBalance;
      if (startDate && allTxForBF.length > 0) {
        for (const r of allTxForBF) {
          const rDate = (r.voucherDate || "").toString().slice(0, 10);
          if (rDate < startDate) bfBalance += parseFloat(r.debitAmount || "0") - parseFloat(r.creditAmount || "0");
        }
      }

      // Build running balance rows
      let runBal = startDate ? bfBalance : (openingBalanceSide === "Dr" ? openingBalance : -openingBalance);
      const enrichedRows = txRows.map((r: any) => {
        const dr = parseFloat(r.debitAmount || "0");
        const cr = parseFloat(r.creditAmount || "0");
        runBal += dr - cr;
        return { ...r, dr, cr, runBal };
      });

      const totalDr = enrichedRows.reduce((s: number, r: any) => s + r.dr, 0);
      const totalCr = enrichedRows.reduce((s: number, r: any) => s + r.cr, 0);
      const closingRaw = runBal;
      const closingBalance2 = Math.abs(closingRaw);
      const closingBalanceSide2 = closingRaw >= 0 ? "Dr" : "Cr";

      const numFmt = "#,##0.00";
      const navyFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1F3864" } };
      const lightBlueFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEFF3FB" } };
      const greyFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF5F5F5" } };
      const allBorders = {
        top: { style: "thin" as const }, bottom: { style: "thin" as const },
        left: { style: "thin" as const }, right: { style: "thin" as const },
      };

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Statement");

      sheet.columns = [
        { key: "date", width: 13 },
        { key: "voucher", width: 18 },
        { key: "particulars", width: 38 },
        { key: "dr", width: 16 },
        { key: "cr", width: 16 },
        { key: "balance", width: 18 },
      ];

      // Logo row
      try {
        const logoPath = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(logoPath)) {
          const logoBuf = fs.readFileSync(logoPath);
          const logoId = workbook.addImage({ buffer: logoBuf as Buffer, extension: "jpeg" });
          const logoRow = sheet.addRow([]);
          logoRow.height = 80;
          sheet.addImage(logoId, { tl: { col: 2.5, row: 0 }, ext: { width: 260, height: 80 } });
          sheet.mergeCells(`A1:F1`);
        }
      } catch {}

      // Header block
      const rComp = sheet.addRow([company?.name || "Company"]);
      rComp.getCell(1).font = { bold: true, size: 14, color: { argb: "FF1F3864" } };
      sheet.mergeCells(`A${rComp.number}:F${rComp.number}`);

      const rTitle = sheet.addRow(["Account Statement"]);
      rTitle.getCell(1).font = { bold: true, size: 11 };
      sheet.mergeCells(`A${rTitle.number}:F${rTitle.number}`);

      const rAcct = sheet.addRow([`Account: ${accountName}   |   Type: ${accountType.charAt(0).toUpperCase() + accountType.slice(1)}`]);
      sheet.mergeCells(`A${rAcct.number}:F${rAcct.number}`);

      if (openingBalance !== 0 && accountType === "ledger") {
        const rOb = sheet.addRow([`Opening Balance: ${openingBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${openingBalanceSide}`]);
        sheet.mergeCells(`A${rOb.number}:F${rOb.number}`);
      }

      if (startDate || endDate) {
        const rPeriod = sheet.addRow([`Period: ${startDate || "Start"} to ${endDate || "End"}`]);
        rPeriod.getCell(1).font = { italic: true, color: { argb: "FF555555" } };
        sheet.mergeCells(`A${rPeriod.number}:F${rPeriod.number}`);
      }

      const rPrinted = sheet.addRow([`Printed: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`]);
      sheet.mergeCells(`A${rPrinted.number}:F${rPrinted.number}`);
      sheet.addRow([]);

      // Column headers
      const hdr = sheet.addRow(["Date", "Voucher No.", "Particulars", "Debit (Dr)", "Credit (Cr)", "Balance"]);
      hdr.eachCell((cell) => {
        cell.fill = navyFill;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.border = allBorders;
        cell.alignment = { horizontal: "center" };
      });

      // Opening balance row (no filter) or B/F row (filtered)
      if (!startDate && openingBalance > 0 && accountType === "ledger") {
        const obBal = openingBalanceSide === "Dr" ? openingBalance : -openingBalance;
        const obRow = sheet.addRow([
          new Date().toLocaleDateString("en-GB"),
          "—",
          "Opening Balance",
          openingBalanceSide === "Dr" ? openingBalance : null,
          openingBalanceSide === "Cr" ? openingBalance : null,
          `${openingBalance.toFixed(2)} ${openingBalanceSide}`,
        ]);
        obRow.eachCell((cell) => { cell.fill = lightBlueFill; cell.border = allBorders; });
        obRow.getCell(4).numFmt = numFmt; obRow.getCell(5).numFmt = numFmt;
        obRow.getCell(4).alignment = { horizontal: "right" }; obRow.getCell(5).alignment = { horizontal: "right" };
        obRow.getCell(6).alignment = { horizontal: "right" };
      } else if (startDate && Math.abs(bfBalance) > 0.005 && accountType === "ledger") {
        const bfAbs = Math.abs(bfBalance);
        const bfSide = bfBalance >= 0 ? "Dr" : "Cr";
        const bfRow = sheet.addRow([
          new Date(startDate + "T00:00:00"),
          "—",
          "Balance Brought Forward",
          bfSide === "Dr" ? bfAbs : null,
          bfSide === "Cr" ? bfAbs : null,
          `${bfAbs.toFixed(2)} ${bfSide}`,
        ]);
        bfRow.eachCell((cell) => { cell.fill = lightBlueFill; cell.font = { bold: true }; cell.border = allBorders; });
        bfRow.getCell(1).numFmt = "dd/mm/yyyy";
        bfRow.getCell(4).numFmt = numFmt; bfRow.getCell(5).numFmt = numFmt;
        bfRow.getCell(4).alignment = { horizontal: "right" }; bfRow.getCell(5).alignment = { horizontal: "right" };
        bfRow.getCell(6).alignment = { horizontal: "right" };
      }

      // Data rows
      enrichedRows.forEach((row: any, idx: number) => {
        const dr = row.dr > 0 ? row.dr : null;
        const cr = row.cr > 0 ? row.cr : null;
        const dateVal = row.voucherDate ? new Date(row.voucherDate + "T00:00:00") : "";
        const particulars = row.narration || row.voucherDescription || row.voucherType || "—";
        const balAbs = Math.abs(row.runBal);
        const balSide = row.runBal >= 0 ? "Dr" : "Cr";
        const dataRow = sheet.addRow([
          dateVal,
          row.voucherNumber || "—",
          particulars,
          dr,
          cr,
          balAbs > 0 ? `${balAbs.toFixed(2)} ${balSide}` : "—",
        ]);
        dataRow.eachCell((cell) => { cell.border = allBorders; });
        if (idx % 2 === 0) dataRow.eachCell((cell) => { cell.fill = greyFill; });
        dataRow.getCell(1).numFmt = "dd/mm/yyyy";
        dataRow.getCell(4).numFmt = numFmt; dataRow.getCell(5).numFmt = numFmt;
        dataRow.getCell(4).alignment = { horizontal: "right" }; dataRow.getCell(5).alignment = { horizontal: "right" };
        dataRow.getCell(6).alignment = { horizontal: "right" };
      });

      // Totals row
      const totRow = sheet.addRow(["", "", "TOTAL", totalDr, totalCr, ""]);
      totRow.eachCell((cell) => { cell.fill = navyFill; cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.border = allBorders; });
      totRow.getCell(4).numFmt = numFmt; totRow.getCell(5).numFmt = numFmt;
      totRow.getCell(4).alignment = { horizontal: "right" }; totRow.getCell(5).alignment = { horizontal: "right" };

      // Closing balance row
      const cbRow = sheet.addRow([
        "", "", "Closing Balance",
        closingBalanceSide2 === "Dr" ? closingBalance2 : null,
        closingBalanceSide2 === "Cr" ? closingBalance2 : null,
        `${closingBalance2.toFixed(2)} ${closingBalanceSide2}`,
      ]);
      cbRow.eachCell((cell) => { cell.fill = lightBlueFill; cell.font = { bold: true }; cell.border = allBorders; });
      cbRow.getCell(4).numFmt = numFmt; cbRow.getCell(5).numFmt = numFmt;
      cbRow.getCell(4).alignment = { horizontal: "right" }; cbRow.getCell(5).alignment = { horizontal: "right" };
      cbRow.getCell(6).alignment = { horizontal: "right" };

      const safeAccName = accountName.replace(/[^\w\s.()\-]/g, "_").replace(/\s+/g, "_");
      const buf = Buffer.from(await workbook.xlsx.writeBuffer());
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${safeAccName}_Statement.xlsx"`);
      res.end(buf);
    } catch (err: any) {
      console.error("Account statement Excel error:", err);
      if (!res.headersSent) res.status(500).json({ message: err.message });
    }
  });

  // Get all vouchers with date filtering
}
