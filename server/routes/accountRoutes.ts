import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory } from "./_helpers";
import {
  inventory, stockItems, stockGroups, stockGroupArchives,
  stockTransferVouchers, stockTransferItems,
  stockAdjustmentVouchers, stockAdjustmentItems,
  containers, containerOffloads, containerOffloadItems,
  bankAccounts, fixedAssets, ledgerAccounts, insertLedgerAccountSchema,
  insertStockGroupSchema, insertStockItemSchema, insertContainerSchema,
  insertStockTransferVoucherSchema, insertStockAdjustmentVoucherSchema,
  updateStockTransferSchema, updateStockAdjustmentSchema,
  vouchers, voucherEntries, salesItems, suppliers, customers, customerBalances,
  employees, locations, userLocations, userCompanyRoles, companies,
  auditLog, users, FEATURE_KEYS, companySettings,
  purchaseOrders, poLineItems, interCompanyTransfers,
  insertInterCompanyTransferSchema, insertContainerSaleSchema, containerSales,
  insertUserPreferencesSchema, userPreferences,
  insertDraftPosSaleSchema, InsertDraftPosSale,
  insertSalaryAdvanceSchema, insertSalaryAdvanceDeductionSchema,
  salaryAdvances, salaryAdvanceDeductions,
  fiscalPeriodClosures, wasteDispatches, wasteDispatchItems,
  dashboardCashAccounts, dashboardPayableAccounts, dashboardAccountSelections,
  insertDashboardCashAccountSchema, insertDashboardPayableAccountSchema,
  insertDashboardAccountSelectionSchema,
  creditNoteItems, pendingBarcodes, insertPendingBarcodeSchema,
  bales, baleProducts, baleProductCategories, storedFiles,
  customerOrders, factorySuppliers, factoryContainers, factorySupplierPayments,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../netPositionHelper";


export function registerAccountRoutes(app: Express) {
  app.get("/api/accounts/all", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const companyId = req.session.currentCompanyId;

      const currentCompany = await storage.getCompanyById(companyId);
      const isFactoryCompany = currentCompany?.companyType === "factory";

      const ledgers = await storage.getAllLedgerAccounts(companyId);
      const banks = await storage.getAllBankAccounts(companyId);
      const assets = await storage.getAllFixedAssets(companyId);
      const employees = await storage.getAllEmployees(companyId);
      const suppliers = isFactoryCompany ? [] : await storage.getAllSuppliers();
      const customers = await storage.getAllCustomers(companyId);

      // Optional date range filter for account balances
      const balStartDate = req.query.startDate as string | undefined;
      const balEndDate = req.query.endDate as string | undefined;

      // Get all voucher entries for this company's vouchers (excluding optional and deleted)
      const voucherDateConditions = [
        eq(vouchers.companyId, companyId),
        eq(vouchers.optional, false),
        isNull(vouchers.deletedAt),
        ...(balStartDate ? [gte(vouchers.voucherDate, balStartDate)] : []),
        ...(balEndDate ? [lte(vouchers.voucherDate, balEndDate)] : []),
      ];

      const companyVouchers = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(and(...voucherDateConditions))
        .execute();

      const companyVoucherIds = companyVouchers.map((v) => v.id);

      // Get all voucher entries for this company
      const allEntries =
        companyVoucherIds.length > 0
          ? await db
              .select()
              .from(voucherEntries)
              .where(inArray(voucherEntries.voucherId, companyVoucherIds))
              .execute()
          : [];

      // Group entries by account type and calculate balances
      const ledgerBalances = new Map<
        number,
        { debits: number; credits: number }
      >();
      const bankBalances = new Map<
        number,
        { debits: number; credits: number }
      >();
      const assetBalances = new Map<
        number,
        { debits: number; credits: number }
      >();
      const employeeBalances = new Map<
        number,
        { debits: number; credits: number }
      >();
      // Note: Supplier balances are calculated separately below using global entries

      for (const entry of allEntries) {
        const debit = parseFloat(entry.debitAmount || "0");
        const credit = parseFloat(entry.creditAmount || "0");

        if (entry.ledgerAccountId) {
          const existing = ledgerBalances.get(entry.ledgerAccountId) || {
            debits: 0,
            credits: 0,
          };
          ledgerBalances.set(entry.ledgerAccountId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

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
        credits: number,
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

      // For factory companies, build a map of ledgerAccountId -> {customerId, balance, balanceSide}
      // so customer accounts show the real customer balance (sales + adjustments) not just voucher entries
      const customerLedgerMap = new Map<number, { customerId: number; balance: number; balanceSide: string }>();
      if (isFactoryCompany && customers.length > 0) {
        const customerIds = customers.map((c: any) => c.id);
        const salesRows = await db.select({
          customerId: customerOrders.customerId,
          total: sql<string>`COALESCE(SUM(CAST(${customerOrders.grandTotal} AS numeric)), 0)`,
        })
          .from(customerOrders)
          .where(and(inArray(customerOrders.customerId, customerIds), eq(customerOrders.companyId, companyId), eq(customerOrders.status, "FINALIZED")))
          .groupBy(customerOrders.customerId);

        const nonInvRows = await db.select({
          customerId: customerBalances.customerId,
          net: sql<string>`COALESCE(SUM(CAST(${customerBalances.debitAmount} AS numeric) - CAST(${customerBalances.creditAmount} AS numeric)), 0)`,
        })
          .from(customerBalances)
          .where(and(inArray(customerBalances.customerId, customerIds), eq(customerBalances.companyId, companyId), sql`${customerBalances.referenceType} IS DISTINCT FROM 'INVOICE'`))
          .groupBy(customerBalances.customerId);

        const salesMap = new Map(salesRows.map((r: any) => [r.customerId, parseFloat(r.total || "0")]));
        const nonInvMap = new Map(nonInvRows.map((r: any) => [r.customerId, parseFloat(r.net || "0")]));

        for (const cust of customers as any[]) {
          if (!cust.ledgerAccountId) continue;
          const openingBalance = parseFloat(cust.openingBalance || "0");
          const openingSide = cust.openingBalanceSide || "Dr";
          const salesTotal = salesMap.get(cust.id) ?? 0;
          const nonInvNet = nonInvMap.get(cust.id) ?? 0;
          const totalBalance = (openingSide === "Dr" ? openingBalance : -openingBalance) + salesTotal + nonInvNet;
          customerLedgerMap.set(cust.ledgerAccountId, {
            customerId: cust.id,
            balance: Math.abs(totalBalance),
            balanceSide: totalBalance >= 0 ? "Dr" : "Cr",
          });
        }
      }

      const accounts = [
        ...ledgers
          // Hide ledger accounts that are the auto-created mirror of a customer — the customer
          // entry (type="customer") already appears in the list with the correct balance.
          .filter((account) => !customerLedgerMap.has(account.id))
          .map((account) => {
          const movements = ledgerBalances.get(account.id) || {
            debits: 0,
            credits: 0,
          };
          const { balance, balanceSide } = calculateBalance(
            account.openingBalance || "0",
            account.openingBalanceSide,
            movements.debits,
            movements.credits,
          );

          // For factory customer accounts: override balance with real customer balance and include customerId
          const custInfo = customerLedgerMap.get(account.id);

          return {
            id: `ledger-${account.id}`,
            accountId: account.id,
            type: "ledger",
            code: account.code,
            name: account.name,
            accountType: account.accountType,
            subType: account.subType,
            balance: (custInfo ? custInfo.balance : balance).toFixed(2),
            balanceSide: custInfo ? custInfo.balanceSide : balanceSide,
            openingBalance: parseFloat(account.openingBalance || "0"),
            openingBalanceSide: account.openingBalanceSide || "Dr",
            active: account.active,
            parentId: account.parentId,
            ...(custInfo ? { customerId: custInfo.customerId } : {}),
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
            movements.credits,
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
            movements.credits,
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

      // Calculate supplier balances separately using global entries (matching /api/suppliers/stats)
      // Suppliers are global entities, so their balances should include entries from ALL companies
      const supplierAccountsList = await Promise.all(
        suppliers.map(async (supplier) => {
          // Get entries across ALL companies (same as supplier stats endpoint)
          const entries = await storage.getVoucherEntriesBySupplier(supplier.id);
          const openingBalance = parseFloat(supplier.openingBalance || "0");

          // Calculate balance: Opening Balance + Credits - Debits
          // This gives a signed value where positive = we owe them, negative = they owe us/prepaid
          const calculatedBalance = entries.reduce((sum, entry) => {
            const credit = parseFloat(entry.creditAmount || "0");
            const debit = parseFloat(entry.debitAmount || "0");
            // Only count pure credit or pure debit entries
            if (credit > 0 && debit === 0) {
              return sum + credit;
            } else if (debit > 0 && credit === 0) {
              return sum - debit;
            }
            return sum;
          }, openingBalance);

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
      );

      // Build customer accounts list with running balance from customerBalances table
      const customerAccountsList = await Promise.all(
        customers
          .filter((c) => !c.deletedAt)
          .map(async (customer) => {
            const runningBalance = await storage.getCustomerBalance(customer.id, companyId);
            const openingBalance = parseFloat(customer.openingBalance || "0");
            // Use running balance if available, otherwise fall back to opening balance
            const effectiveBalance = runningBalance !== 0 ? runningBalance : openingBalance;
            const balanceSide = effectiveBalance >= 0 ? "Dr" : "Cr"; // Customers are receivable (Dr)

            return {
              id: `customer-${customer.id}`,
              accountId: customer.id,
              type: "customer",
              code: customer.code,
              name: customer.legalName,
              balance: effectiveBalance.toFixed(2),
              balanceSide,
              openingBalance: openingBalance,
              openingBalanceSide: customer.openingBalanceSide || "Dr",
              active: customer.active,
              parentId: null,
            };
          })
      );

      // Combine all accounts
      const allAccounts = [...accounts, ...supplierAccountsList, ...customerAccountsList];

      res.json(allAccounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get payable accounts (creditors - suppliers with positive balance)
  app.get("/api/accounts/payables", requireAuth, async (req, res) => {
    try {
      const suppliers = await storage.getAllSuppliers();

      const payableAccounts = suppliers
        .map((supplier) => {
          const openingBalance = parseFloat(supplier.openingBalance || "0");
          // Positive balance = we owe them
          return {
            id: supplier.id,
            accountId: supplier.id,
            code: supplier.code,
            name: supplier.legalName,
            balance: openingBalance,
          };
        })
        .filter((account) => account.balance > 0)
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

      // Strip currency symbols / commas so "$3,967" → "3967" for amount matching
      const amountQ = q.replace(/[$,\s]/g, "");
      const isNumericSearch = /^\d+(\.\d+)?$/.test(amountQ);

      const results = await db
        .select({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          description: vouchers.description,
          totalAmount: vouchers.totalAmount,
          currency: vouchers.currency,
          locationName: vouchers.locationName,
        })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, req.session.currentCompanyId),
            isNull(vouchers.deletedAt),
            or(
              ilike(vouchers.voucherNumber, `%${q}%`),
              ilike(vouchers.description, `%${q}%`),
              isNumericSearch
                ? sql`CAST(${vouchers.totalAmount} AS TEXT) LIKE ${"%" + amountQ + "%"}`
                : sql`false`,
            )
          )
        )
        .orderBy(desc(vouchers.voucherDate))
        .limit(20);

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/accounts/voucher-sidebar", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const companyId = req.session.currentCompanyId;

      // Determine company type — ERP suppliers must not appear in factory company vouchers
      const currentCompany = await storage.getCompanyById(companyId);
      const isFactoryCompany = currentCompany?.companyType === "factory";

      // Fetch all account types
      const ledgers = await storage.getAllLedgerAccounts(companyId);
      const banks = await storage.getAllBankAccounts(companyId);
      const assets = await storage.getAllFixedAssets(companyId);
      const employees = await storage.getAllEmployees(companyId);
      const suppliers = isFactoryCompany ? [] : await storage.getAllSuppliers();
      const employeesData = await storage.getAllEmployees(companyId);
      const fSuppliers = isFactoryCompany
        ? await db.select().from(factorySuppliers).where(eq(factorySuppliers.companyId, companyId)).orderBy(factorySuppliers.name)
        : [];

      // For factory companies: fetch containers and payments to compute accurate supplier balances
      const fContainers = isFactoryCompany
        ? await db.select().from(factoryContainers).where(eq(factoryContainers.companyId, companyId))
        : [];
      const fPayments = isFactoryCompany
        ? await db.select().from(factorySupplierPayments).where(eq(factorySupplierPayments.companyId, companyId))
        : [];

      // Get all voucher entries for this company's vouchers (excluding optional and deleted)
      const companyVouchers = await db
        .select({ id: vouchers.id, voucherNumber: vouchers.voucherNumber, currency: vouchers.currency, exchangeRate: vouchers.exchangeRate })
        .from(vouchers)
        .where(and(eq(vouchers.companyId, companyId), eq(vouchers.optional, false), isNull(vouchers.deletedAt)))
        .execute();

      const companyVoucherIds = companyVouchers.map((v) => v.id);
      // FACTORY-PAY-* voucher IDs — excluded when computing factory supplier voucher-paid amounts
      // to prevent double-counting with fPayments (factorySupplierPayments).
      const factoryPayVoucherIds = new Set(
        (companyVouchers as any[]).filter((v) => (v.voucherNumber || "").startsWith("FACTORY-PAY-")).map((v) => v.id)
      );
      // Map from voucherId -> {currency, exchangeRate} for USD conversion of factory supplier entries
      const voucherCurrencyMap = new Map<number, { currency: string; exchangeRate: string }>(
        (companyVouchers as any[]).map((v) => [v.id, { currency: v.currency || "USD", exchangeRate: v.exchangeRate || "1" }])
      );

      // Get all voucher entries for this company
      const allEntries =
        companyVoucherIds.length > 0
          ? await db
              .select()
              .from(voucherEntries)
              .where(inArray(voucherEntries.voucherId, companyVoucherIds))
              .execute()
          : [];

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

      // DO NOT add opening balance for suppliers in sidebar calculation
      // The sidebar should only show transactions from the current company
      // Opening balance is a global property - it's already factored into the /api/suppliers/stats endpoint
      // Here we just track movements within this company's vouchers

      // Helper function to calculate signed balance (positive = Dr, negative = Cr)
      const calculateSignedBalance = (
        openingBalance: string,
        openingBalanceSide: string | null,
        debits: number,
        credits: number,
      ) => {
        let balance = parseFloat(openingBalance || "0");

        // If opening balance has a side, convert to signed number
        if (openingBalanceSide === "Cr") {
          balance = -balance;
        }

        // Add net change (debits increase, credits decrease)
        return balance + debits - credits;
      };

      // Fetch company customers — needed for the customer entries below.
      // Customer mirror ledger accounts are intentionally NOT excluded from the ledger list
      // because they serve as a distinct "cash" account separate from the POS balance account.
      const companyCustomers = await storage.getAllCustomers(companyId);

      // Build simplified account array for sidebar
      const accounts = [
        // Bank accounts
        ...banks.map((account) => {
          const movements = bankBalances.get(account.id) || { debits: 0, credits: 0 };
          const balance = calculateSignedBalance(
            account.openingBalance || "0",
            account.openingBalanceSide,
            movements.debits,
            movements.credits,
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
        ...ledgers
          .map((account) => {
          const movements = ledgerBalances.get(account.id) || { debits: 0, credits: 0 };
          const balance = calculateSignedBalance(
            account.openingBalance || "0",
            account.openingBalanceSide,
            movements.debits,
            movements.credits,
          );

          return {
            id: account.id,
            type: "ledger",
            name: account.name,
            code: account.code,
            balance,
          };
        }),
        // ERP Suppliers — only included for non-factory companies (factory companies use factorySuppliers)
        ...suppliers.map((supplier) => {
          const transactionBalance = supplierBalances.get(supplier.id) || 0;
          const openingBalance = parseFloat(supplier.openingBalance || "0");
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
          const brokerContainers = fContainers.filter((c: any) =>
            c.commissionSupplierId === supplier.id && !aggregateIds.includes(c.supplierId) && parseFloat(c.commissionAmount || "0") > 0
          );
          const commissionValueUsd = brokerContainers.reduce((sum: number, c: any) => {
            const commAmt = parseFloat(c.commissionAmount || "0");
            const fx = parseFloat(c.fxRateToUsd || "1");
            const commCurr = c.commissionCurrencyCode || c.currencyCode || "USD";
            return sum + (commCurr === "USD" ? commAmt : commAmt * fx);
          }, 0);

          // Total paid via factorySupplierPayments (in USD) — aggregated across all linked IDs
          const supplierPayments = fPayments.filter((p: any) => aggregateIds.includes(p.supplierId));
          const totalPaidUsd = supplierPayments.reduce((sum: number, p: any) => sum + parseFloat(p.amountUsd || "0"), 0);

          // Total paid via non-FACTORY-PAY-* ERP voucher entries (aggregated across linked IDs)
          const voucherPaidUsd = aggregateIds.reduce((sum, sid) => sum + (factorySupplierBalances.get(sid) || 0), 0);

          // Outstanding balance (positive = we owe them). Negate for sidebar convention (negative = payable/red)
          const outstandingUsd = openingBalance + containerValueUsd + commissionValueUsd - totalPaidUsd - voucherPaidUsd;
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
            movements.credits,
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

      // Build customer entries using the accurate running-balance from customerBalances table
      const customerEntries = await Promise.all(
        companyCustomers
          .filter((c) => !c.deletedAt && c.active !== false)
          .map(async (customer) => {
            const runningBalance = await storage.getCustomerBalance(customer.id, companyId);
            const openingBalance = parseFloat(customer.openingBalance || "0");
            const effectiveBalance = runningBalance !== 0 ? runningBalance : openingBalance;
            return {
              id: customer.id,
              type: "customer" as const,
              name: customer.legalName,
              code: customer.code,
              balance: effectiveBalance,
            };
          })
      );

      res.json([...accounts, ...customerEntries]);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get balance for a specific ledger account
  app.get("/api/accounts/ledger/:id/balance", async (req, res) => {
    try {
      const ledgerAccountId = parseInt(req.params.id);

      if (isNaN(ledgerAccountId)) {
        return res.status(400).json({ message: "Invalid ledger account ID" });
      }

      const account = await storage.getLedgerAccountById(ledgerAccountId);
      if (!account) {
        return res.status(404).json({ message: "Account not found" });
      }

      const transactions = await storage.getVoucherEntriesByLedger(ledgerAccountId);
      
      let debits = 0;
      let credits = 0;
      
      for (const tx of transactions) {
        debits += parseFloat(tx.debitAmount || "0");
        credits += parseFloat(tx.creditAmount || "0");
      }

      const balance = (parseFloat(account.openingBalance || "0") * (account.openingBalanceSide === "Cr" ? -1 : 1)) + debits - credits;

      res.json({ balance });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get per-currency balance breakdown for a ledger account (all-time, no date filter)
  app.get("/api/accounts/ledger/:id/currency-balances", async (req, res) => {
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
            isNull(vouchers.deletedAt),
          ),
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
  app.get("/api/accounts/ledger/:id/transactions", async (req, res) => {
    try {
      const ledgerAccountId = parseInt(req.params.id);

      if (isNaN(ledgerAccountId)) {
        return res.status(400).json({ message: "Invalid ledger account ID" });
      }

      const { startDate, endDate } = req.query;

      const transactions = await storage.getVoucherEntriesByLedger(
        ledgerAccountId,
        startDate as string | undefined,
        endDate as string | undefined,
      );

      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a specific bank account with optional date filtering
  app.get("/api/accounts/bank/:id/transactions", async (req, res) => {
    try {
      const bankAccountId = parseInt(req.params.id);

      if (isNaN(bankAccountId)) {
        return res.status(400).json({ message: "Invalid bank account ID" });
      }

      const { startDate, endDate } = req.query;

      const transactions = await storage.getVoucherEntriesByBankAccount(
        bankAccountId,
        startDate as string | undefined,
        endDate as string | undefined,
      );

      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a specific fixed asset with optional date filtering
  app.get("/api/accounts/fixed-asset/:id/transactions", async (req, res) => {
    try {
      const fixedAssetId = parseInt(req.params.id);

      if (isNaN(fixedAssetId)) {
        return res.status(400).json({ message: "Invalid fixed asset ID" });
      }

      const { startDate, endDate } = req.query;

      const transactions = await storage.getVoucherEntriesByFixedAsset(
        fixedAssetId,
        startDate as string | undefined,
        endDate as string | undefined,
      );

      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a specific supplier with optional date filtering
  app.get(
    "/api/accounts/supplier/:id/transactions",
    requireAuth,
    async (req, res) => {
      try {
        const supplierId = parseInt(req.params.id);

        if (isNaN(supplierId)) {
          return res.status(400).json({ message: "Invalid supplier ID" });
        }

        const { startDate, endDate, companyId } = req.query;

        // Use query param companyId or session companyId, or undefined for all companies
        const filterCompanyId = companyId
          ? parseInt(companyId as string)
          : req.session.currentCompanyId;

        const transactions = await storage.getVoucherEntriesBySupplier(
          supplierId,
          filterCompanyId,
          startDate as string | undefined,
          endDate as string | undefined,
        );

        res.json(transactions);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Get transactions for a specific employee with optional date filtering
  app.get(
    "/api/accounts/employee/:id/transactions",
    requireAuth,
    async (req, res) => {
      try {
        const employeeId = parseInt(req.params.id);

        if (isNaN(employeeId)) {
          return res.status(400).json({ message: "Invalid employee ID" });
        }

        const { startDate, endDate, companyId } = req.query;

        // Use query param companyId or session companyId, or undefined for all companies
        const filterCompanyId = companyId
          ? parseInt(companyId as string)
          : req.session.currentCompanyId;

        const transactions = await storage.getVoucherEntriesByEmployee(
          employeeId,
          filterCompanyId,
          startDate as string | undefined,
          endDate as string | undefined,
        );

        res.json(transactions);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Get transactions for a specific customer (maps customerBalances to voucher-entry format)
  app.get(
    "/api/accounts/customer/:id/transactions",
    requireAuth,
    async (req, res) => {
      try {
        const customerId = parseInt(req.params.id);
        if (isNaN(customerId)) {
          return res.status(400).json({ message: "Invalid customer ID" });
        }
        const companyId = req.session.currentCompanyId;
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }
        const { startDate, endDate } = req.query;
        const statement = await storage.getCustomerStatement(
          customerId,
          companyId,
          startDate as string | undefined,
          endDate as string | undefined,
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
        res.json(mapped);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

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
        .where(and(
          eq(vouchers.companyId, companyId),
          isNotNull(vouchers.deletedAt),
          entryFilter,
        ))
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
        const [acct] = await db.select({ ob: ledgerAccounts.openingBalance, side: ledgerAccounts.openingBalanceSide })
          .from(ledgerAccounts).where(eq(ledgerAccounts.id, accountId));
        rawOB = parseFloat(acct?.ob ?? "0") || 0;
        obSide = acct?.side ?? "Dr";
      } else if (accountType === "bank") {
        const [acct] = await db.select({ ob: bankAccounts.openingBalance, side: bankAccounts.openingBalanceSide })
          .from(bankAccounts).where(eq(bankAccounts.id, accountId));
        rawOB = parseFloat(acct?.ob ?? "0") || 0;
        obSide = acct?.side ?? "Dr";
      } else if (accountType === "supplier") {
        const [acct] = await db.select({ ob: suppliers.openingBalance })
          .from(suppliers).where(eq(suppliers.id, accountId));
        rawOB = parseFloat(acct?.ob ?? "0") || 0;
        obSide = "Cr";
      } else if (accountType === "employee") {
        const [acct] = await db.select({ ob: employees.openingBalance })
          .from(employees).where(eq(employees.id, accountId));
        rawOB = parseFloat(acct?.ob ?? "0") || 0;
        obSide = "Cr";
      } else if (accountType === "customer") {
        const [acct] = await db.select({ ob: customers.openingBalance })
          .from(customers).where(eq(customers.id, accountId));
        rawOB = parseFloat(acct?.ob ?? "0") || 0;
        obSide = "Dr";
      } else if (accountType === "fixed-asset") {
        const [acct] = await db.select({ ob: fixedAssets.openingBalance })
          .from(fixedAssets).where(eq(fixedAssets.id, accountId));
        rawOB = parseFloat(acct?.ob ?? "0") || 0;
        obSide = "Dr";
      }

      // Signed initial opening balance
      // Supplier: positive rawOB is treated as Cr (they're owed money)
      // Others: Cr side means negative in Dr-positive convention
      const isSupplier = accountType === "supplier";
      let balance = isSupplier ? rawOB : (obSide === "Cr" ? -rawOB : rawOB);

      // Sum all voucher entries before endDate (exclusive of period start)
      if (endDate) {
        const conditions: any[] = [
          eq(entryColumn, accountId),
          eq(vouchers.optional, false),
          isNull(vouchers.deletedAt),
          sql`${vouchers.voucherDate} < ${endDate}`,
        ];
        const [totals] = await db.select({
          totalDebit: sql<string>`COALESCE(SUM(${voucherEntries.debitAmount}), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(${voucherEntries.creditAmount}), 0)`,
        }).from(voucherEntries)
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

      // ── Language strings ──
      const translations: Record<string, {
        accountStatement: string; period: string; generated: string;
        colDate: string; colType: string; colParticulars: string; colDebit: string; colCredit: string; colBalance: string;
        openingBalance: string; periodTotal: string; closingBalance: string;
        from: string; upTo: string; allTime: string; dr: string; cr: string;
      }> = {
        en: {
          accountStatement: "Account Statement", period: "Period", generated: "Generated",
          colDate: "DATE", colType: "TYPE", colParticulars: "PARTICULARS", colDebit: "DEBIT", colCredit: "CREDIT", colBalance: "BALANCE",
          openingBalance: "Opening Balance", periodTotal: "Current Period Total", closingBalance: "Closing Balance",
          from: "From", upTo: "Up to", allTime: "All Time", dr: "Dr", cr: "Cr",
        },
        fr: {
          accountStatement: "Relevé de compte", period: "Période", generated: "Généré le",
          colDate: "DATE", colType: "TYPE", colParticulars: "LIBELLÉ", colDebit: "DÉBIT", colCredit: "CRÉDIT", colBalance: "SOLDE",
          openingBalance: "Solde d'ouverture", periodTotal: "Total de la période", closingBalance: "Solde de clôture",
          from: "Du", upTo: "Au", allTime: "Toute la période", dr: "Dt", cr: "Ct",
        },
        ar: {
          accountStatement: "كشف حساب", period: "الفترة", generated: "تاريخ الإنشاء",
          colDate: "التاريخ", colType: "النوع", colParticulars: "البيان", colDebit: "مدين", colCredit: "دائن", colBalance: "الرصيد",
          openingBalance: "الرصيد الافتتاحي", periodTotal: "مجموع الفترة", closingBalance: "الرصيد الختامي",
          from: "من", upTo: "حتى", allTime: "كل الفترات", dr: "مد", cr: "دا",
        },
      };
      const t = translations[lang] ?? translations["en"];
      const isRTL = lang === "ar";

      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account ID" });

      // ── 1. Fetch raw entries using existing storage helpers ──
      let rawEntries: any[] = [];
      let accountName = "";
      let rawOB = 0;
      let obSide = "Dr";
      const isSupplier = accountType === "supplier";

      if (accountType === "ledger") {
        rawEntries = await storage.getVoucherEntriesByLedger(accountId, startDate, endDate);
        const [acct] = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, accountId));
        accountName = acct?.name ?? "Ledger Account";
        rawOB = parseFloat(acct?.openingBalance ?? "0") || 0;
        obSide = acct?.openingBalanceSide ?? "Dr";
      } else if (accountType === "bank") {
        rawEntries = await storage.getVoucherEntriesByBankAccount(accountId, startDate, endDate);
        const [acct] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, accountId));
        accountName = acct?.name ?? "Bank Account";
        rawOB = parseFloat(acct?.openingBalance ?? "0") || 0;
        obSide = acct?.openingBalanceSide ?? "Dr";
      } else if (accountType === "fixed-asset") {
        rawEntries = await storage.getVoucherEntriesByFixedAsset(accountId, startDate, endDate);
        const [acct] = await db.select().from(fixedAssets).where(eq(fixedAssets.id, accountId));
        accountName = acct?.name ?? "Fixed Asset";
        rawOB = parseFloat(acct?.openingBalance ?? "0") || 0;
        obSide = "Dr";
      } else if (accountType === "supplier") {
        rawEntries = await storage.getVoucherEntriesBySupplier(accountId, companyId, startDate, endDate);
        const [acct] = await db.select().from(suppliers).where(eq(suppliers.id, accountId));
        accountName = (acct as any)?.legalName ?? "Supplier";
        rawOB = parseFloat((acct as any)?.openingBalance ?? "0") || 0;
        obSide = "Cr";
      } else if (accountType === "employee") {
        rawEntries = await storage.getVoucherEntriesByEmployee(accountId, companyId, startDate, endDate);
        const [acct] = await db.select({ firstName: employees.firstName, lastName: employees.lastName, openingBalance: employees.openingBalance }).from(employees).where(eq(employees.id, accountId));
        accountName = acct ? `${acct.firstName} ${acct.lastName}` : "Employee";
        rawOB = parseFloat(acct?.openingBalance ?? "0") || 0;
        obSide = "Cr";
      } else if (accountType === "customer") {
        const customerStmt = await storage.getCustomerStatement(accountId, companyId, startDate, endDate);
        rawEntries = customerStmt.map((row: any) => ({
          voucherId: row.referenceId ?? row.id,
          voucherNumber: row.referenceType ? `${row.referenceType}-${row.referenceId}` : `CB-${row.id}`,
          voucherType: row.transactionType,
          voucherDate: row.transactionDate,
          voucherDescription: row.description || "",
          narration: row.description || "",
          debitAmount: row.debitAmount,
          creditAmount: row.creditAmount,
        }));
        const [acct] = await db.select().from(customers).where(eq(customers.id, accountId));
        accountName = acct?.name ?? "Customer";
        rawOB = parseFloat(acct?.openingBalance ?? "0") || 0;
        obSide = "Dr";
      } else {
        return res.status(400).json({ message: "Unknown account type" });
      }

      // ── 2. Compute opening balance (pre-period if startDate given) ──
      let openingBalance = isSupplier ? rawOB : (obSide === "Cr" ? -rawOB : rawOB);

      if (startDate) {
        const typeToColumn: Record<string, any> = {
          ledger: voucherEntries.ledgerAccountId,
          bank: voucherEntries.bankAccountId,
          "fixed-asset": voucherEntries.fixedAssetId,
          supplier: voucherEntries.supplierId,
          employee: voucherEntries.employeeId,
          customer: voucherEntries.customerId,
        };
        const col = typeToColumn[accountType];
        if (col) {
          const [tot] = await db.select({
            d: sql<string>`COALESCE(SUM(${voucherEntries.debitAmount}),0)`,
            c: sql<string>`COALESCE(SUM(${voucherEntries.creditAmount}),0)`,
          }).from(voucherEntries)
            .leftJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
            .where(and(
              eq(col, accountId),
              eq(vouchers.optional, false),
              isNull(vouchers.deletedAt),
              sql`${vouchers.voucherDate} < ${startDate}`,
            ));
          const d = parseFloat(tot?.d ?? "0") || 0;
          const c = parseFloat(tot?.c ?? "0") || 0;
          openingBalance += isSupplier ? (c - d) : (d - c);
        }
      }

      // ── 3. Group entries by voucherId ──
      const voucherMap = new Map<number, {
        voucherId: number; voucherNumber: string; voucherType: string;
        voucherDate: string; description: string; narration: string;
        totalDebit: number; totalCredit: number;
      }>();
      for (const e of rawEntries) {
        const vid = Number(e.voucherId);
        const d = parseFloat(e.debitAmount ?? "0") || 0;
        const c = parseFloat(e.creditAmount ?? "0") || 0;
        const existing = voucherMap.get(vid);
        if (existing) {
          existing.totalDebit += d;
          existing.totalCredit += c;
          if (!existing.narration && e.narration) existing.narration = e.narration;
        } else {
          voucherMap.set(vid, {
            voucherId: vid,
            voucherNumber: e.voucherNumber ?? "",
            voucherType: e.voucherType ?? "",
            voucherDate: e.voucherDate ?? "",
            description: e.voucherDescription ?? "",
            narration: e.voucherDescription || e.narration || "",
            totalDebit: d,
            totalCredit: c,
          });
        }
      }
      const rows = Array.from(voucherMap.values()).sort((a, b) => {
        const dc = new Date(a.voucherDate).getTime() - new Date(b.voucherDate).getTime();
        return dc !== 0 ? dc : a.voucherNumber.localeCompare(b.voucherNumber);
      });

      // ── 4. Compute running balance ──
      let running = openingBalance;
      const rowsWithBalance = rows.map((r) => {
        if (isSupplier) {
          running += r.totalCredit - r.totalDebit;
        } else {
          running += r.totalDebit - r.totalCredit;
        }
        return { ...r, runningBalance: running };
      });

      // ── 5. Company info ──
      const company = await storage.getCompanyById(companyId);
      const settings = await storage.getCompanySettings(companyId);
      const companyName = (company as any)?.name ?? "Company";
      const logoUrl: string | null = (settings as any)?.logoUrl ?? null;
      const baseCurrency = (company as any)?.baseCurrency ?? "USD";
      const currencySymbolMap: Record<string, string> = {
        USD: "$ ", GBP: "£", EUR: "€", CFA: "CFA ", XOF: "CFA ", XAF: "CFA ",
        CAD: "CA$ ", AUD: "A$ ", CHF: "CHF ", JPY: "¥", INR: "₹", AED: "AED ",
      };
      const currSym = currencySymbolMap[baseCurrency.toUpperCase()] ?? (baseCurrency + " ");
      const fmtAmt = (n: number) => {
        const abs = Math.abs(n);
        const formatted = abs % 1 === 0 ? abs.toLocaleString("en") : abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return currSym + formatted;
      };
      const fmtDate = (s: string) => {
        const d = new Date(s.split("T")[0] + "T00:00:00");
        return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      };
      const periodStr = startDate && endDate
        ? `${fmtDate(startDate)} — ${fmtDate(endDate)}`
        : startDate ? `${t.from} ${fmtDate(startDate)}` : endDate ? `${t.upTo} ${fmtDate(endDate)}` : t.allTime;
      const generatedStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

      // ── 6. Generate PDF ──
      const PDFDocument = (await import("pdfkit")).default;
      const fs = await import("fs");
      const pathMod = await import("path");

      // Font setup: always register Amiri if available; use it for RTL mode or Arabic-containing cells
      const fontDir = pathMod.join(process.cwd(), "server", "fonts");
      const arabicFontPath = pathMod.join(fontDir, "Amiri-Regular.ttf");
      const hasArabicFont = fs.existsSync(arabicFontPath);

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      if (hasArabicFont) doc.registerFont("Arabic", arabicFontPath);

      const boldFont = isRTL && hasArabicFont ? "Arabic" : "Helvetica-Bold";
      const normalFont = isRTL && hasArabicFont ? "Arabic" : "Helvetica";

      // Arabic text processing helpers — always load so Arabic names render correctly even in EN/FR exports
      let convertArabic: ((t: string) => string) | null = null;
      let bidiInst: { getEmbeddingLevels: (t: string, d: string) => any; getReorderedString: (t: string, l: any) => string } | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const reshaperMod = require("arabic-reshaper") as { convertArabic: (t: string) => string };
        convertArabic = reshaperMod.convertArabic;
        // bidi-js exports a factory function — call it to get the instance
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const bidiFactory = require("bidi-js") as () => typeof bidiInst;
        bidiInst = (bidiFactory as any)();
      } catch { /* if packages fail, text renders as-is */ }

      // Detect Arabic characters (Unicode ranges covering Arabic script)
      const containsArabic = (text: string): boolean =>
        /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);

      // Reshape+reorder Arabic text for correct visual rendering in LTR PDF canvas
      const shapeArabic = (text: string): string => {
        if (!text || !convertArabic) return text;
        try {
          const reshaped = convertArabic(text);
          if (bidiInst) {
            const levels = bidiInst.getEmbeddingLevels(reshaped, "rtl");
            return bidiInst.getReorderedString(reshaped, levels);
          }
          return reshaped;
        } catch { return text; }
      };

      const shapeText = (text: string): string => {
        if (!text) return text;
        // Full RTL mode: shape everything
        if (isRTL) return shapeArabic(text);
        // LTR mode: only shape cells that actually contain Arabic characters
        if (containsArabic(text)) return shapeArabic(text);
        return text;
      };

      res.setHeader("Content-Type", "application/pdf");
      const safeAccName = accountName.replace(/[^a-zA-Z0-9_-]/g, "_");
      res.setHeader("Content-Disposition", `attachment; filename=statement_${safeAccName}.pdf`);
      doc.pipe(res);

      // Text helper: flip alignment for RTL
      const txtOpts = (w: number, align: "left"|"right"|"center" = "left"): PDFKit.Mixins.TextOptions => {
        if (!isRTL) return { width: w, align };
        return { width: w, align: align === "left" ? "right" : align === "right" ? "left" : "center" };
      };

      // Header
      let headerY = 40;
      let logoWidth = 0;
      if (logoUrl && logoUrl.startsWith("/") && fs.existsSync(`.${logoUrl}`)) {
        try { doc.image(`.${logoUrl}`, 40, headerY, { height: 48, fit: [80, 48] }); logoWidth = 90; } catch {}
      }
      doc.fontSize(18).font(boldFont).fillColor("#000000")
        .text(shapeText(companyName), 40 + logoWidth, headerY, txtOpts(515 - logoWidth));
      doc.fontSize(10).font(normalFont).fillColor("#555555")
        .text(shapeText(`${t.accountStatement}: ${accountName}`), 40 + logoWidth, headerY + 22, txtOpts(515 - logoWidth));

      const headerBottom = Math.max(doc.y, headerY + 52);
      doc.moveTo(40, headerBottom + 4).lineTo(555, headerBottom + 4).lineWidth(0.5).strokeColor("#cccccc").stroke();
      doc.lineWidth(1).strokeColor("#000000");

      // Meta
      const metaY = headerBottom + 10;
      doc.fillColor("#444444").fontSize(8).font(normalFont);
      doc.text(shapeText(`${t.period}: ${periodStr}`), 40, metaY, txtOpts(515));
      doc.text(shapeText(`${t.generated}: ${generatedStr}`), 40, doc.y + 2, txtOpts(515));
      doc.moveDown(0.5);

      // Table columns: Date | Type | Particulars | Debit | Credit | Balance
      const PAGE_H = 841.89;
      const MARGIN_BOTTOM = 60;
      const colX  = [40,  110, 205, 370, 435, 500];
      const colW  = [70,   95, 165,  65,  65,  55];
      const colHdrEN = [t.colDate, t.colType, t.colParticulars, t.colDebit, t.colCredit, t.colBalance];
      // For RTL: reverse column order visually
      const colHdr = isRTL ? [...colHdrEN].reverse() : colHdrEN;
      const colAln: Array<"left"|"right"> = isRTL
        ? ["right","right","right","left","left","left"]
        : ["left","left","left","right","right","right"];
      const MIN_ROW_H = 14;
      const HDR_H = 15;
      const FONT_SIZE = 7.5;

      const drawTableHeader = (y: number) => {
        doc.rect(40, y, 515, HDR_H).fill("#1F3864");
        doc.fillColor("#ffffff").font(boldFont).fontSize(FONT_SIZE);
        colHdr.forEach((h, i) => {
          doc.text(shapeText(h), colX[i] + 2, y + 3.5, { width: colW[i] - 4, align: colAln[i] });
        });
        doc.fillColor("#000000").font(normalFont).fontSize(FONT_SIZE);
      };

      let tableY = doc.y + 4;
      drawTableHeader(tableY);
      let y = tableY + HDR_H;

      // Calculate how tall a row needs to be given its cell values
      const calcRowH = (vals: string[]): number => {
        doc.font(normalFont).fontSize(FONT_SIZE);
        let maxH = MIN_ROW_H;
        vals.forEach((v, i) => {
          if (!v) return;
          const h = doc.heightOfString(v, { width: colW[i] - 4 }) + 6;
          if (h > maxH) maxH = h;
        });
        return maxH;
      };

      const drawRow = (vals: string[], rowH: number, bg?: string) => {
        if (bg) {
          doc.rect(40, y, 515, rowH).fill(bg);
          doc.fillColor("#000000");
        }
        vals.forEach((v, i) => {
          if (v) {
            // Per-cell Arabic detection: use Amiri + right-align if this cell has Arabic chars (in LTR mode)
            const cellHasAr = !isRTL && hasArabicFont && containsArabic(v);
            const cellFont = cellHasAr ? "Arabic" : normalFont;
            const cellAlign = cellHasAr ? "right" : colAln[i];
            doc.font(cellFont).fontSize(FONT_SIZE)
              .text(shapeText(v), colX[i] + 2, y + 3, { width: colW[i] - 4, align: cellAlign });
          }
        });
      };

      // Opening balance row
      const obSideLabel = openingBalance >= 0 ? (isSupplier ? t.cr : t.dr) : (isSupplier ? t.dr : t.cr);
      const obDisplay = `${fmtAmt(openingBalance)} ${obSideLabel}`;
      const obRowVals = isRTL
        ? [obDisplay, "-", "-", "", t.openingBalance, ""]
        : ["", t.openingBalance, "", "-", "-", obDisplay];
      const obRowH = calcRowH(obRowVals);
      drawRow(obRowVals, obRowH, "#F0F4FF");
      y += obRowH;

      // Transaction rows
      rowsWithBalance.forEach((row, idx) => {
        const particulars = row.narration || row.description || "";
        const debitStr = row.totalDebit > 0 ? fmtAmt(row.totalDebit) : "-";
        const creditStr = row.totalCredit > 0 ? fmtAmt(row.totalCredit) : "-";
        const bal = row.runningBalance;
        const balSide = bal >= 0 ? (isSupplier ? t.cr : t.dr) : (isSupplier ? t.dr : t.cr);
        const balStr = `${fmtAmt(bal)} ${balSide}`;
        const txVals = isRTL
          ? [balStr, creditStr, debitStr, particulars, row.voucherType, fmtDate(row.voucherDate)]
          : [fmtDate(row.voucherDate), row.voucherType, particulars, debitStr, creditStr, balStr];
        const rowH = calcRowH(txVals);

        if (y + rowH > PAGE_H - MARGIN_BOTTOM) {
          doc.addPage();
          y = 40;
          drawTableHeader(y);
          y += HDR_H;
        }
        const bg = idx % 2 === 1 ? "#F8F8F8" : undefined;
        drawRow(txVals, rowH, bg);
        y += rowH;
      });

      // Footer summary
      y += 3;
      doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor("#888888").stroke();
      y += 5;
      doc.lineWidth(1).strokeColor("#000000");

      const totD = rowsWithBalance.reduce((s, r) => s + r.totalDebit, 0);
      const totC = rowsWithBalance.reduce((s, r) => s + r.totalCredit, 0);
      const closingBal = rowsWithBalance.length > 0
        ? rowsWithBalance[rowsWithBalance.length - 1].runningBalance
        : openingBalance;
      const closingSide = closingBal >= 0 ? (isSupplier ? t.cr : t.dr) : (isSupplier ? t.dr : t.cr);

      const drawSummaryRow = (label: string, debit: string, credit: string, balance: string, isBold = false) => {
        doc.rect(40, y, 515, 16).fill(isBold ? "#1F3864" : "#EFF3FB");
        doc.fillColor(isBold ? "#ffffff" : "#000000")
          .font(isBold ? boldFont : normalFont).fontSize(8);
        const labelX = isRTL ? colX[1] + 2 : colX[2] + 2;
        const labelW = isRTL ? colW[1] - 4 : colW[2] - 4;
        doc.text(shapeText(label), labelX, y + 4, { width: labelW, align: isRTL ? "right" : "left" });
        if (isRTL) {
          if (balance) doc.text(shapeText(balance), colX[0] + 2, y + 4, { width: colW[0] - 4, align: "right" });
          if (credit) doc.text(shapeText(credit), colX[3] + 2, y + 4, { width: colW[3] - 4, align: "left" });
          if (debit) doc.text(shapeText(debit), colX[4] + 2, y + 4, { width: colW[4] - 4, align: "left" });
        } else {
          if (debit) doc.text(debit, colX[3] + 2, y + 4, { width: colW[3] - 4, align: "right" });
          if (credit) doc.text(credit, colX[4] + 2, y + 4, { width: colW[4] - 4, align: "right" });
          if (balance) doc.text(balance, colX[5] + 2, y + 4, { width: colW[5] - 4, align: "right" });
        }
        doc.fillColor("#000000");
      };

      if (y + 52 > PAGE_H - 20) { doc.addPage(); y = 40; }

      drawSummaryRow(t.periodTotal, fmtAmt(totD), fmtAmt(totC), "", false);
      y += 17;
      drawSummaryRow(t.closingBalance, "", "", `${fmtAmt(closingBal)} ${closingSide}`, true);

      doc.end();
    } catch (err: any) {
      console.error("Statement PDF error:", err);
      if (!res.headersSent) res.status(500).json({ message: err.message });
    }
  });

  // Get all vouchers with date filtering
}
