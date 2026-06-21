import type { Express } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory } from "../_helpers";
import { getClientDate } from "../../lib/dateUtils";
import {
  inventory, stockItems, stockGroups,
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
  stockItemLocationPrices, exchangeRates,
  factoryWorkerAdvances,
  propertyContracts, propertyMonthlyLedger, propertyPayments,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance, round2 } from "../netPositionHelper";

// ---------------------------------------------------------------------------
// Lightweight in-process TTL cache for expensive computed stat endpoints.
// Keyed by endpoint + companyId + date params. 30-second TTL means a company
// with multiple users hitting the dashboard simultaneously gets one DB round-
// trip instead of N.  Mutations don't invalidate the cache — the 30-second
// staleness is acceptable for these summary/aggregate endpoints.
// ---------------------------------------------------------------------------
const _statCache = new Map<string, { data: any; expiresAt: number }>();
function _getCached(key: string): any | null {
  const e = _statCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { _statCache.delete(key); return null; }
  return e.data;
}
function _setCached(key: string, data: any, ttlMs = 30_000): void {
  _statCache.set(key, { data, expiresAt: Date.now() + ttlMs });
  // Prune stale entries to prevent unbounded growth (> 500 entries is unusual)
  if (_statCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of _statCache) { if (v.expiresAt < now) _statCache.delete(k); }
  }
}


export function registerStatsSalesRoutes(app: Express) {
  app.post(
    "/api/sales-report/recalculate-costs",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { startDate, endDate, stockItemId, locationId } = req.body;

        // Build conditions for finding sales items to update
        const conditions = [
          eq(vouchers.companyId, companyId),
          eq(vouchers.optional, false),
          isNull(vouchers.deletedAt),
        ];
        
        if (startDate) {
          conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
        }
        if (endDate) {
          conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
        }
        if (stockItemId) {
          conditions.push(eq(salesItems.stockItemId, stockItemId));
        }
        if (locationId) {
          conditions.push(eq(vouchers.locationId, locationId));
        }

        // Get all sales items that match the criteria
        const itemsToUpdate = await db
          .select({
            salesItemId: salesItems.id,
            stockItemId: salesItems.stockItemId,
            quantity: salesItems.quantity,
            sellingPrice: salesItems.sellingPrice,
            oldCostPrice: salesItems.costPrice,
            locationId: vouchers.locationId,
          })
          .from(salesItems)
          .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
          .where(and(...conditions));

        let updatedCount = 0;
        const updates: { id: number; oldCost: number; newCost: number; itemName: string }[] = [];

        for (const item of itemsToUpdate) {
          // Get current average rate from inventory at that location
          let newCostPrice = 0;
          
          if (item.locationId) {
            const [invRecord] = await db
              .select({
                averageRate: inventory.averageRate,
              })
              .from(inventory)
              .where(
                and(
                  eq(inventory.stockItemId, item.stockItemId),
                  eq(inventory.locationId, item.locationId)
                )
              )
              .limit(1);
            
            if (invRecord) {
              newCostPrice = parseFloat(invRecord.averageRate || "0");
            }
          }

          // If no inventory at location, try to get from any location
          if (newCostPrice === 0) {
            const [anyInvRecord] = await db
              .select({
                averageRate: inventory.averageRate,
              })
              .from(inventory)
              .where(eq(inventory.stockItemId, item.stockItemId))
              .limit(1);
            
            if (anyInvRecord) {
              newCostPrice = parseFloat(anyInvRecord.averageRate || "0");
            }
          }

          const oldCostPrice = parseFloat(item.oldCostPrice || "0");
          
          // Only update if cost price is different
          if (Math.abs(newCostPrice - oldCostPrice) > 0.01) {
            const qty = parseFloat(item.quantity || "0");
            const sellingPrice = parseFloat(item.sellingPrice || "0");
            const totalSales = qty * sellingPrice;
            const totalCost = qty * newCostPrice;
            const profit = totalSales - totalCost;

            await db
              .update(salesItems)
              .set({
                costPrice: newCostPrice.toFixed(2),
                totalCost: totalCost.toFixed(2),
                profit: profit.toFixed(2),
              })
              .where(eq(salesItems.id, item.salesItemId));

            // Get item name for response
            const [stockItem] = await db
              .select({ name: stockItems.name })
              .from(stockItems)
              .where(eq(stockItems.id, item.stockItemId))
              .limit(1);

            updates.push({
              id: item.salesItemId,
              oldCost: oldCostPrice,
              newCost: newCostPrice,
              itemName: stockItem?.name || "Unknown",
            });

            updatedCount++;
          }
        }

        res.json({
          message: `Updated cost prices for ${updatedCount} sales items`,
          totalChecked: itemsToUpdate.length,
          updatedCount,
          updates: updates.slice(0, 50), // Limit response to first 50 updates
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // Reports API Endpoints

  // Profit & Loss Report
  app.get(
    "/api/reports/profit-loss",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { startDate, endDate } = req.query;

        // Get all ledger accounts for this company
        const companyAccounts = await storage.getAllLedgerAccounts(companyId, true); // Include hidden accounts for financial calculations

        const incomeAccounts = companyAccounts.filter(
          (acc) => acc.accountType === "Income",
        );
        const expenseAccounts = companyAccounts.filter(
          (acc) => 
            acc.accountType === "Expense" || 
            acc.accountType === "Indirect Expense" || 
            acc.accountType === "Direct Expense",
        );

        const incomeAccountIds = incomeAccounts.map((acc) => acc.id);
        const expenseAccountIds = expenseAccounts.map((acc) => acc.id);

        const plConditions: any[] = [eq(vouchers.companyId, companyId), eq(vouchers.optional, false), isNull(vouchers.deletedAt)];
        if (startDate) {
          plConditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
        }
        if (endDate) {
          plConditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
        }

        // Single JOIN query — replaces two-step (fetch voucher IDs → inArray entries)
        // Only fetch entries for income/expense accounts to avoid reading the whole table
        const allAccountIds = [...incomeAccountIds, ...expenseAccountIds];
        const companyEntries = allAccountIds.length > 0
          ? await db
              .select({
                ledgerAccountId: voucherEntries.ledgerAccountId,
                debitAmount: voucherEntries.debitAmount,
                creditAmount: voucherEntries.creditAmount,
              })
              .from(voucherEntries)
              .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
              .where(and(
                ...plConditions,
                isNotNull(voucherEntries.ledgerAccountId),
                inArray(voucherEntries.ledgerAccountId, allAccountIds),
              ))
              .execute()
          : [];

        // Calculate balances for each account
        const accountBalances = new Map<number, number>();

        for (const entry of companyEntries) {
          if (entry.ledgerAccountId) {
            const debit = parseFloat(entry.debitAmount || "0");
            const credit = parseFloat(entry.creditAmount || "0");
            const currentBalance =
              accountBalances.get(entry.ledgerAccountId) || 0;
            accountBalances.set(
              entry.ledgerAccountId,
              currentBalance + credit - debit,
            );
          }
        }

        // Build income statement
        const incomeItems = incomeAccounts
          .map((acc) => ({
            id: acc.id,
            code: acc.code,
            name: acc.name,
            accountType: acc.accountType,
            balance: accountBalances.get(acc.id) || 0,
          }))
          .filter((item) => item.balance !== 0);

        const expenseItems = expenseAccounts
          .map((acc) => ({
            id: acc.id,
            code: acc.code,
            name: acc.name,
            accountType: acc.accountType,
            balance: accountBalances.get(acc.id) || 0,
          }))
          .filter((item) => item.balance !== 0);

        const totalIncome = incomeItems.reduce(
          (sum, item) => sum + item.balance,
          0,
        );
        const totalExpenses = expenseItems.reduce(
          (sum, item) => sum + item.balance,
          0,
        );
        const netProfit = totalIncome - totalExpenses;

        res.json({
          incomeItems,
          expenseItems,
          totalIncome,
          totalExpenses,
          netProfit,
          startDate: startDate || null,
          endDate: endDate || null,
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Balance Sheet Report
  app.get(
    "/api/reports/balance-sheet",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { asOfDate } = req.query;

        // Build conditions for voucher date filter
        const conditions = [eq(vouchers.companyId, companyId)];
        if (asOfDate) {
          conditions.push(lte(vouchers.voucherDate, asOfDate));
        }

        // Parallel fetch: all accounts + all entries (JOIN replaces two-step inArray)
        const [ledgers, banks, assets, employees, suppliers, allEntries] = await Promise.all([
          storage.getAllLedgerAccounts(companyId),
          storage.getAllBankAccounts(companyId),
          storage.getAllFixedAssets(companyId),
          storage.getAllEmployees(companyId),
          storage.getAllSuppliers(),
          db.select({
            voucherId: voucherEntries.voucherId,
            ledgerAccountId: voucherEntries.ledgerAccountId,
            bankAccountId: voucherEntries.bankAccountId,
            fixedAssetId: voucherEntries.fixedAssetId,
            supplierId: voucherEntries.supplierId,
            employeeId: voucherEntries.employeeId,
            debitAmount: voucherEntries.debitAmount,
            creditAmount: voucherEntries.creditAmount,
          }).from(voucherEntries)
            .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
            .where(and(...conditions))
            .execute(),
        ]);
        // Calculate balances
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
        const supplierBalances = new Map<
          number,
          { debits: number; credits: number }
        >();

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

          if (entry.supplierId) {
            const existing = supplierBalances.get(entry.supplierId) || {
              debits: 0,
              credits: 0,
            };
            // Only count pure credit or pure debit entries to prevent double-counting
            // This matches the logic in /api/suppliers/stats
            if (credit > 0 && debit === 0) {
              supplierBalances.set(entry.supplierId, {
                debits: existing.debits,
                credits: existing.credits + credit,
              });
            } else if (debit > 0 && credit === 0) {
              supplierBalances.set(entry.supplierId, {
                debits: existing.debits + debit,
                credits: existing.credits,
              });
            }
          }
        }

        // Categorize and calculate net balances
        const assetAccounts = ledgers
          .filter((l) => l.accountType === "Asset")
          .map((acc) => {
            const bal = ledgerBalances.get(acc.id) || { debits: 0, credits: 0 };
            const openingBalance = parseFloat(acc.openingBalance || "0");
            return {
              id: acc.id,
              code: acc.code,
              name: acc.name,
              balance: openingBalance + bal.debits - bal.credits,
            };
          });

        const bankAccounts = banks.map((bank) => {
          const bal = bankBalances.get(bank.id) || { debits: 0, credits: 0 };
          const openingBalance = parseFloat(bank.openingBalance || "0");
          return {
            id: bank.id,
            code: bank.accountNumber,
            name: bank.bankName,
            balance: openingBalance + bal.debits - bal.credits,
          };
        });

        const fixedAssetAccounts = assets.map((asset) => {
          const bal = assetBalances.get(asset.id) || { debits: 0, credits: 0 };
          const purchaseValue = parseFloat(asset.purchaseAmount || "0");
          return {
            id: asset.id,
            code: asset.code,
            name: asset.name,
            balance: purchaseValue + bal.debits - bal.credits,
          };
        });

        const liabilityAccounts = ledgers
          .filter((l) => l.accountType === "Liability")
          .map((acc) => {
            const bal = ledgerBalances.get(acc.id) || { debits: 0, credits: 0 };
            const openingBalance = parseFloat(acc.openingBalance || "0");
            return {
              id: acc.id,
              code: acc.code,
              name: acc.name,
              balance: openingBalance + bal.credits - bal.debits,
            };
          });

        const supplierAccounts = suppliers
          .map((supplier) => {
            const bal = supplierBalances.get(supplier.id) || {
              debits: 0,
              credits: 0,
            };
            return {
              id: supplier.id,
              code: supplier.code,
              name: supplier.legalName,
              balance: bal.credits - bal.debits,
            };
          })
          .filter((s) => s.balance !== 0);

        const equityAccounts = ledgers
          .filter((l) => l.accountType === "Equity")
          .map((acc) => {
            const bal = ledgerBalances.get(acc.id) || { debits: 0, credits: 0 };
            const openingBalance = parseFloat(acc.openingBalance || "0");
            return {
              id: acc.id,
              code: acc.code,
              name: acc.name,
              balance: openingBalance + bal.credits - bal.debits,
            };
          });

        const totalAssets = [
          ...assetAccounts,
          ...bankAccounts,
          ...fixedAssetAccounts,
        ].reduce((sum, item) => sum + item.balance, 0);

        const totalLiabilities = [
          ...liabilityAccounts,
          ...supplierAccounts,
        ].reduce((sum, item) => sum + item.balance, 0);

        const totalEquity = equityAccounts.reduce(
          (sum, item) => sum + item.balance,
          0,
        );

        res.json({
          assets: {
            ledgers: assetAccounts.filter((a) => a.balance !== 0),
            banks: bankAccounts.filter((b) => b.balance !== 0),
            fixedAssets: fixedAssetAccounts.filter((f) => f.balance !== 0),
            total: totalAssets,
          },
          liabilities: {
            ledgers: liabilityAccounts.filter((l) => l.balance !== 0),
            suppliers: supplierAccounts,
            total: totalLiabilities,
          },
          equity: {
            accounts: equityAccounts.filter((e) => e.balance !== 0),
            total: totalEquity,
          },
          asOfDate: asOfDate || null,
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Sales Report
}
