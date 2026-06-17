import type { Express } from "express";
import { round2 } from "../netPositionHelper";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory } from "./_helpers";
import { getOrCreateLedgerAccount } from "./factory/_helpers";
import {
  inventory, stockItems, stockGroups,
  stockTransferVouchers, stockTransferItems,
  stockAdjustmentVouchers, stockAdjustmentItems,
  containers, containerOffloads, containerOffloadItems, containerCharges,
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
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../netPositionHelper";


export function registerDebugRoutes(app: Express) {
  app.get("/api/debug/inventory/:stockItemId", requireAuth, requireRole("Admin", "Developer", "Owner"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { stockItemId } = req.params;

      // Get the stock item
      const stockItem = await db
        .select()
        .from(stockItems)
        .where(
          and(
            eq(stockItems.id, parseInt(stockItemId)),
            eq(stockItems.companyId, companyId)
          )
        )
        .execute();

      if (stockItem.length === 0) {
        return res.status(404).json({ message: "Stock item not found" });
      }

      // Get all inventory records for this item (including deleted/inactive locations for debugging)
      const inventoryRecords = await db
        .select({
          id: inventory.id,
          locationId: inventory.locationId,
          locationName: locations.name,
          locationExists: locations.id,
          locationActive: locations.active,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
          lastUpdated: inventory.lastUpdated,
        })
        .from(inventory)
        .leftJoin(locations, eq(inventory.locationId, locations.id))
        .where(
          and(
            eq(inventory.stockItemId, parseInt(stockItemId)),
            eq(inventory.companyId, companyId)
          )
        )
        .execute();

      // Calculate totals - separately for all records and active-only records
      // Calculate value dynamically as qty * averageRate
      let totalQty = 0;
      let totalValue = 0;
      let activeQty = 0;
      let activeValue = 0;
      for (const rec of inventoryRecords) {
        const qty = parseFloat(rec.quantity);
        const rate = parseFloat(rec.averageRate);
        const val = qty * rate;
        totalQty += qty;
        totalValue += val;
        // Only count if location exists AND is active
        if (rec.locationExists !== null && rec.locationActive === true) {
          activeQty += qty;
          activeValue += val;
        }
      }

      res.json({
        stockItem: {
          id: stockItem[0].id,
          code: stockItem[0].code,
          name: stockItem[0].name,
          stockGroupId: stockItem[0].stockGroupId,
          openingQty: stockItem[0].openingQty,
          openingRate: stockItem[0].openingRate,
          openingValue: stockItem[0].openingValue,
        },
        inventoryRecords: inventoryRecords.map((r) => {
          const isDeleted = r.locationExists === null;
          const isInactive = r.locationActive === false;
          let status = "Active";
          let displayName = r.locationName || `Location ${r.locationId}`;
          
          if (isDeleted) {
            status = "DELETED";
            displayName = `[DELETED] Location ${r.locationId}`;
          } else if (isInactive) {
            status = "INACTIVE";
            displayName = `[INACTIVE] ${r.locationName}`;
          }
          
          const qty = parseFloat(r.quantity);
          const rate = parseFloat(r.averageRate);
          return {
            id: r.id,
            locationId: r.locationId,
            locationName: displayName,
            locationDeleted: isDeleted || isInactive,
            locationStatus: status,
            quantity: qty,
            averageRate: rate,
            totalValue: qty * rate,
            lastUpdated: r.lastUpdated,
          };
        }),
        totals: {
          recordCount: inventoryRecords.length,
          totalQuantity: totalQty,
          activeRecordCount: inventoryRecords.filter(r => r.locationExists !== null && r.locationActive === true).length,
          activeQuantity: activeQty,
          activeValue: activeValue,
          totalValue: totalValue,
          calculatedRate: totalQty > 0 ? totalValue / totalQty : 0,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Import Cycle Diagnostics - Debug endpoint to find why import cycle balance isn't zero
  app.get("/api/debug/import-cycle", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Define issue types
      interface DiagnosticIssue {
        id: string;
        type: string;
        severity: "critical" | "warning" | "info";
        title?: string;
        description: string;
        impact: number;
        details: any;
        fixGuidance?: string;
        howToFix?: string;
        category?: string;
      }

      const issues: DiagnosticIssue[] = [];
      let issueCounter = 0;
      const generateIssueId = () => `issue-${++issueCounter}`;

      // ============ 1. Detect Negative Inventory ============
      const negativeInventory = await db
        .select({
          id: inventory.id,
          stockItemId: inventory.stockItemId,
          stockItemCode: stockItems.code,
          stockItemName: stockItems.name,
          locationId: inventory.locationId,
          locationName: locations.name,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .innerJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .leftJoin(locations, eq(inventory.locationId, locations.id))
        .where(
          and(
            eq(inventory.companyId, companyId),
            sql`CAST(${inventory.quantity} AS DECIMAL) < 0`
          )
        );

      for (const item of negativeInventory) {
        const qty = parseFloat(item.quantity || "0");
        const rate = parseFloat(item.averageRate || "0");
        const impact = Math.abs(qty * rate); // Use absolute value for display
        issues.push({
          id: generateIssueId(),
          type: "negative_inventory",
          severity: "critical",
          description: `Negative inventory: ${item.stockItemCode} at ${item.locationName || `Location ${item.locationId}`}`,
          impact,
          details: {
            stockItemId: item.stockItemId,
            stockItemCode: item.stockItemCode,
            stockItemName: item.stockItemName,
            locationId: item.locationId,
            locationName: item.locationName,
            quantity: qty,
            averageRate: rate,
          },
          fixGuidance: "Create a Production voucher to add missing inventory, or review sales/consumption vouchers for errors.",
        });
      }

      // ============ 2. Detect Orphaned Inventory (at deleted locations) ============
      const orphanedInventory = await db
        .select({
          id: inventory.id,
          stockItemId: inventory.stockItemId,
          stockItemCode: stockItems.code,
          stockItemName: stockItems.name,
          locationId: inventory.locationId,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .innerJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .leftJoin(locations, eq(inventory.locationId, locations.id))
        .where(
          and(
            eq(inventory.companyId, companyId),
            or(
              isNull(locations.id),
              isNotNull(locations.deletedAt)
            )
          )
        );

      for (const item of orphanedInventory) {
        const qty = parseFloat(item.quantity || "0");
        const rate = parseFloat(item.averageRate || "0");
        const rawImpact = qty * rate;
        const impact = Math.abs(rawImpact); // Use absolute value for display
        if (impact > 0.01) {
          issues.push({
            id: generateIssueId(),
            type: "orphaned_inventory",
            severity: "warning",
            description: `Orphaned inventory: ${item.stockItemCode} at deleted/missing location ${item.locationId}`,
            impact,
            details: {
              inventoryId: item.id,
              stockItemId: item.stockItemId,
              stockItemCode: item.stockItemCode,
              stockItemName: item.stockItemName,
              locationId: item.locationId,
              quantity: qty,
              averageRate: rate,
            },
            fixGuidance: "Restore the location or transfer inventory to an active location before deleting.",
          });
        }
      }

      // ============ 3. Detect Unbalanced Vouchers (debits ≠ credits) ============
      const voucherBalances = await db
        .select({
          voucherId: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          totalDebit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS DECIMAL)), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.creditAmount} AS DECIMAL)), 0)`,
        })
        .from(vouchers)
        .leftJoin(voucherEntries, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        )
        .groupBy(vouchers.id, vouchers.voucherNumber, vouchers.voucherType, vouchers.voucherDate);

      for (const v of voucherBalances) {
        const debit = parseFloat(v.totalDebit || "0");
        const credit = parseFloat(v.totalCredit || "0");
        const diff = Math.abs(debit - credit);
        if (diff > 0.01) {
          issues.push({
            id: generateIssueId(),
            type: "unbalanced_voucher",
            severity: "critical",
            description: `Unbalanced voucher: ${v.voucherNumber} (${v.voucherType}) - Debits: $${debit.toFixed(2)}, Credits: $${credit.toFixed(2)}`,
            impact: diff, // Use absolute difference for display
            details: {
              voucherId: v.voucherId,
              voucherNumber: v.voucherNumber,
              voucherType: v.voucherType,
              voucherDate: v.voucherDate,
              totalDebit: debit,
              totalCredit: credit,
              difference: diff,
            },
            fixGuidance: "Edit the voucher to ensure debits equal credits, or delete and recreate it.",
          });
        }
      }

      // ============ 4. Detect Stale OTW Containers (older than 90 days) ============
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const staleContainers = await db
        .select({
          id: containers.id,
          containerNumber: containers.containerNumber,
          supplierName: suppliers.legalName,
          grandTotal: containers.grandTotal,
          createdAt: containers.createdAt,
        })
        .from(containers)
        .leftJoin(suppliers, eq(containers.supplierId, suppliers.id))
        .where(
          and(
            eq(containers.companyId, companyId),
            eq(containers.status, "OTW"),
            sql`${containers.createdAt} < ${ninetyDaysAgo.toISOString()}`
          )
        );

      for (const c of staleContainers) {
        const value = parseFloat(c.grandTotal || "0");
        const daysSinceCreated = Math.floor((Date.now() - new Date(c.createdAt || 0).getTime()) / (1000 * 60 * 60 * 24));
        issues.push({
          id: generateIssueId(),
          type: "stale_otw_container",
          severity: "warning",
          description: `Stale OTW container: ${c.containerNumber} (${daysSinceCreated} days old) from ${c.supplierName || 'Unknown Supplier'}`,
          impact: value,
          details: {
            containerId: c.id,
            containerNumber: c.containerNumber,
            supplierName: c.supplierName,
            grandTotal: value,
            daysSinceCreated,
            createdAt: c.createdAt,
          },
          fixGuidance: "Offload this container if goods have arrived, or cancel if the shipment was lost/cancelled.",
        });
      }

      // ============ 5. Detect Duplicate Inventory Records ============
      const duplicateInventory = await db
        .select({
          stockItemId: inventory.stockItemId,
          locationId: inventory.locationId,
          count: sql<number>`COUNT(*)`,
        })
        .from(inventory)
        .where(eq(inventory.companyId, companyId))
        .groupBy(inventory.stockItemId, inventory.locationId)
        .having(sql`COUNT(*) > 1`);

      for (const dup of duplicateInventory) {
        issues.push({
          id: generateIssueId(),
          type: "duplicate_inventory",
          severity: "critical",
          description: `Duplicate inventory records: ${dup.count} records for same stock item at same location`,
          impact: 0, // Impact calculated separately
          details: {
            stockItemId: dup.stockItemId,
            locationId: dup.locationId,
            duplicateCount: dup.count,
          },
          fixGuidance: "Merge duplicate records by summing quantities and recalculating average rate.",
        });
      }

      // ============ 6. Get Balance Totals (same as import-cycle-balance) ============
      // Reuse the calculation logic from import-cycle-balance
      const getAccountTypeBalance = async (accountType: string, isLiability: boolean = false) => {
        const accounts = await db
          .select()
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, companyId),
              eq(ledgerAccounts.accountType, accountType),
              isNull(ledgerAccounts.deletedAt)
            )
          );

        let totalBalance = 0;
        for (const account of accounts) {
          const entries = await db
            .select({
              creditAmount: voucherEntries.creditAmount,
              debitAmount: voucherEntries.debitAmount,
            })
            .from(voucherEntries)
            .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
            .where(
              and(
                eq(voucherEntries.ledgerAccountId, account.id),
                eq(vouchers.companyId, companyId),
                isNull(vouchers.deletedAt),
                eq(vouchers.optional, false)
              )
            );

          const openingBalanceRaw = parseFloat(account.openingBalance || "0");
          const openingSide = account.openingBalanceSide || "Dr";
          let signedOpening: number;
          if (isLiability) {
            signedOpening = openingSide === "Cr" ? openingBalanceRaw : -openingBalanceRaw;
          } else {
            signedOpening = openingSide === "Dr" ? openingBalanceRaw : -openingBalanceRaw;
          }
          
          const balance = entries.reduce((sum, entry) => {
            const credit = parseFloat(entry.creditAmount || "0");
            const debit = parseFloat(entry.debitAmount || "0");
            if (isLiability) {
              return sum + credit - debit;
            } else {
              return sum + debit - credit;
            }
          }, signedOpening);
          
          totalBalance += balance;
        }
        return totalBalance;
      };

      const getTransactionOnlyBalance = async (accountType: string, isLiability: boolean = true) => {
        const result = await db
          .select({
            totalCredit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.creditAmount} AS DECIMAL)), 0)`,
            totalDebit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS DECIMAL)), 0)`,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .innerJoin(ledgerAccounts, eq(voucherEntries.ledgerAccountId, ledgerAccounts.id))
          .where(
            and(
              eq(ledgerAccounts.companyId, companyId),
              eq(ledgerAccounts.accountType, accountType),
              isNull(ledgerAccounts.deletedAt),
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              eq(vouchers.optional, false)
            )
          );
        const totalCredit = parseFloat(result[0]?.totalCredit || "0");
        const totalDebit = parseFloat(result[0]?.totalDebit || "0");
        return isLiability ? totalCredit - totalDebit : totalDebit - totalCredit;
      };

      // Calculate all components
      const supplierEntries = await db
        .select({
          creditAmount: voucherEntries.creditAmount,
          debitAmount: voucherEntries.debitAmount,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            isNotNull(voucherEntries.supplierId),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );
      
      // Include supplier opening balances only for the primary (parent) company.
      // Sub-companies start from zero — they must not inherit the parent's historical debt.
      const allCompaniesBS = await storage.getAllCompanies();
      const primaryCompanyIdBS = allCompaniesBS.length > 0
        ? Math.min(...allCompaniesBS.map((c: any) => c.id))
        : null;
      const isParentContextBS = companyId === primaryCompanyIdBS;

      let supplierOpeningTotalBS = 0;
      if (isParentContextBS) {
        const allSuppliersBS = await storage.getAllSuppliers();
        const bsSupplierIdsWithActivity = new Set(
          (await db.select({ supplierId: voucherEntries.supplierId })
            .from(voucherEntries)
            .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
            .where(and(isNotNull(voucherEntries.supplierId), eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false))))
            .map(e => e.supplierId).filter(Boolean)
        );
        const bsCompanyContainers = await db.select({ supplierId: containers.supplierId }).from(containers).where(eq(containers.companyId, companyId));
        for (const c of bsCompanyContainers) {
          if (c.supplierId) bsSupplierIdsWithActivity.add(c.supplierId);
        }
        supplierOpeningTotalBS = allSuppliersBS
          .filter(s => bsSupplierIdsWithActivity.has(s.id))
          .reduce((sum, s) => sum + parseFloat(s.openingBalance || "0"), 0);
      }

      const supplierBalance = supplierEntries.reduce((sum, entry) => {
        return sum + parseFloat(entry.creditAmount || "0") - parseFloat(entry.debitAmount || "0");
      }, supplierOpeningTotalBS);

      const otwContainers = await db.select().from(containers).where(and(eq(containers.companyId, companyId), eq(containers.status, "OTW")));
      const stockOtwValue = otwContainers.reduce((sum, c) => sum + parseFloat(c.grandTotal || "0"), 0);

      const cashBalance = await getAccountTypeBalance("Cash", false);
      
      // Bank balance from ledger accounts (type "Bank") - includes linked bank accounts
      const ledgerBankBalance2 = await getAccountTypeBalance("Bank", false);
      
      // Bank balance from standalone bankAccounts (no linkedLedgerId)
      const standaloneBankEntries2 = await db
        .select({
          bankAccountId: voucherEntries.bankAccountId,
          creditAmount: voucherEntries.creditAmount,
          debitAmount: voucherEntries.debitAmount,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .innerJoin(bankAccounts, eq(voucherEntries.bankAccountId, bankAccounts.id))
        .where(
          and(
            isNotNull(voucherEntries.bankAccountId),
            isNull(voucherEntries.ledgerAccountId), // Only entries without ledger posting
            isNull(bankAccounts.linkedLedgerId), // Only standalone bank accounts
            eq(bankAccounts.companyId, companyId),
            isNull(bankAccounts.deletedAt),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );
      
      const standaloneBankAccounts2 = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.companyId, companyId),
            isNull(bankAccounts.deletedAt),
            isNull(bankAccounts.linkedLedgerId) // Only standalone
          )
        );
      
      const standaloneBankOpening2 = standaloneBankAccounts2.reduce((sum, account) => {
        const openingBalanceRaw = parseFloat(account.openingBalance || "0");
        const openingSide = account.openingBalanceSide || "Dr";
        return sum + (openingSide === "Dr" ? openingBalanceRaw : -openingBalanceRaw);
      }, 0);
      
      const standaloneBankVoucher2 = standaloneBankEntries2.reduce((sum, entry) => {
        const credit = parseFloat(entry.creditAmount || "0");
        const debit = parseFloat(entry.debitAmount || "0");
        return sum + debit - credit;
      }, 0);
      
      const bankBalance = ledgerBankBalance2 + standaloneBankOpening2 + standaloneBankVoucher2;
      const assetBalance = await getAccountTypeBalance("Asset", false);
      const dutyAgentBalance = await getAccountTypeBalance("Duty Agent", true);
      const transporterAgentBalance = await getAccountTypeBalance("Transporter Agent", true);
      const loansBalance = await getAccountTypeBalance("Loans", true);
      const liabilityBalance = await getAccountTypeBalance("Liability", true);
      const profitBalance = await getAccountTypeBalance("Profit", true);
      const incomeBalance = await getAccountTypeBalance("Income", true);
      const indirectExpenseBalance = await getAccountTypeBalance("Indirect Expense", false);
      const governmentTaxesBalance = await getAccountTypeBalance("Government Taxes", false);
      const payrollExpenseBalance = await getAccountTypeBalance("Payroll Expense", false);
      const salaryAdvancesBalance = await getAccountTypeBalance("Salary Advances", false);
      const generalExpenseBalance = await getAccountTypeBalance("Expense", false);
      const equityTransactionBalance = await getTransactionOnlyBalance("Equity", true);
      const apTransactionBalance = await getTransactionOnlyBalance("Accounts Payable", true);

      // Stock on floor (excluding orphaned)
      const inventoryItems = await db
        .select({ quantity: inventory.quantity, averageRate: inventory.averageRate })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(and(eq(inventory.companyId, companyId), isNull(locations.deletedAt)));
      
      const stockOnFloorValue = inventoryItems.reduce((sum, item) => {
        return sum + parseFloat(item.quantity || "0") * parseFloat(item.averageRate || "0");
      }, 0);

      // COGS
      const cogsData = await db
        .select({ totalCost: salesItems.totalCost })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));
      const cogsBalance = cogsData.reduce((sum, item) => sum + parseFloat(item.totalCost || "0"), 0);

      // Employee liabilities
      const employeesData = await db.select({ currentBalance: employees.currentBalance }).from(employees).where(and(eq(employees.companyId, companyId), isNull(employees.deletedAt)));
      const payrollLiabilitiesBalance = employeesData.reduce((sum, emp) => {
        const bal = parseFloat(emp.currentBalance || "0");
        return sum + (bal > 0 ? bal : 0);
      }, 0);

      // Opening Balance Equity calculation (matches import-cycle-balance endpoint)
      const allAccountsForOpening = await db
        .select()
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.companyId, companyId),
            isNull(ledgerAccounts.deletedAt)
          )
        );

      let totalDrOpenings = 0;
      let totalCrOpenings = 0;
      for (const account of allAccountsForOpening) {
        const openingBalanceRaw = parseFloat(account.openingBalance || "0");
        const openingSide = account.openingBalanceSide || "Dr";
        if (openingSide === "Dr") {
          totalDrOpenings += openingBalanceRaw;
        } else {
          totalCrOpenings += openingBalanceRaw;
        }
      }
      let openingBalanceEquity = totalCrOpenings - totalDrOpenings;

      // Opening Stock Value - stock items with opening values
      const stockItemsWithOpening = await db
        .select({ openingValue: stockItems.openingValue })
        .from(stockItems)
        .where(
          and(
            eq(stockItems.companyId, companyId),
            isNull(stockItems.deletedAt)
          )
        );
      
      const openingStockValue = stockItemsWithOpening.reduce((sum, item) => {
        return sum + parseFloat(item.openingValue || "0");
      }, 0);
      
      // Subtract opening stock value from equity (it's an asset that needs balancing)
      openingBalanceEquity -= openingStockValue;

      // T005: Calculate net balance using the CANONICAL formula from import-cycle-balance endpoint.
      // Intermediate round2() calls have been removed — they created different rounding results
      // compared to the main endpoint, causing the two endpoints to disagree on the same data.
      // Only the final result is rounded (2 decimal places), matching the main endpoint behavior.
      const netImportCycleBalance = Math.round((
        (stockOtwValue + cashBalance + bankBalance + stockOnFloorValue + assetBalance + salaryAdvancesBalance +
         indirectExpenseBalance + payrollExpenseBalance + governmentTaxesBalance + cogsBalance) -
        (supplierBalance + dutyAgentBalance + transporterAgentBalance + loansBalance + liabilityBalance +
         profitBalance + equityTransactionBalance + apTransactionBalance + incomeBalance + payrollLiabilitiesBalance -
         openingBalanceEquity)
      ) * 100) / 100;

      // === RECONCILIATION SECTION ===
      // Re-compute buckets from account-level data to identify the source of any discrepancy
      
      interface AccountContribution {
        accountId: number;
        accountName: string;
        accountCode: string;
        parentType: string;
        bucket: string;
        balance: number;
      }
      
      const accountContributions: AccountContribution[] = [];
      
      // Map all ledger accounts to their contributions
      const allAccountsForRecon = await db
        .select({
          id: ledgerAccounts.id,
          name: ledgerAccounts.name,
          code: ledgerAccounts.code,
          parentType: sql<string>`${ledgerAccounts.accountType}`.as("parentType"),
          currentBalance: sql<string>`COALESCE(${ledgerAccounts.openingBalance}, '0')`.as("currentBalance"),
          currentBalanceSide: sql<string>`COALESCE(${ledgerAccounts.openingBalanceSide}, 'Dr')`.as("currentBalanceSide"),
        })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.companyId, companyId),
            isNull(ledgerAccounts.deletedAt)
          )
        );
      
      // Bucket sums from account-level data
      const reconBuckets: Record<string, number> = {
        supplierBalance: 0,
        dutyAgentBalance: 0,
        transporterAgentBalance: 0,
        loansBalance: 0,
        liabilityBalance: 0,
        profitBalance: 0,
        incomeBalance: 0,
        assetBalance: 0,
        indirectExpenseBalance: 0,
        governmentTaxesBalance: 0,
        salaryAdvancesBalance: 0,
        payrollExpenseBalance: 0,
        cashBalance: 0,
        bankBalance: 0,
        uncategorized: 0,
      };
      
      for (const account of allAccountsForRecon) {
        const balanceRaw = parseFloat(account.currentBalance || "0");
        if (Math.abs(balanceRaw) < 0.01) continue;
        
        const parentType = account.parentType || "UNKNOWN";
        const name = account.name?.toUpperCase() || "";
        let bucket = "uncategorized";
        let signedBalance = balanceRaw;
        
        // Apply sign based on account type and balance side
        const side = account.currentBalanceSide || "Dr";
        
        // Categorize by parent type and name patterns
        if (parentType === "SUPPLIER") {
          bucket = "supplierBalance";
          signedBalance = side === "Cr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "DUTY_AGENT") {
          bucket = "dutyAgentBalance";
          signedBalance = side === "Cr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "TRANSPORTER_AGENT") {
          bucket = "transporterAgentBalance";
          signedBalance = side === "Cr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "LOAN") {
          bucket = "loansBalance";
          signedBalance = side === "Cr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "LIABILITY") {
          bucket = "liabilityBalance";
          signedBalance = side === "Cr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "PROFIT") {
          bucket = "profitBalance";
          signedBalance = side === "Cr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "INCOME" || parentType === "SALES") {
          bucket = "incomeBalance";
          signedBalance = side === "Cr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "ASSET") {
          bucket = "assetBalance";
          signedBalance = side === "Dr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "INDIRECT_EXPENSE" || parentType === "OPERATING_EXPENSE") {
          bucket = "indirectExpenseBalance";
          signedBalance = side === "Dr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "GOVERNMENT_TAXES") {
          bucket = "governmentTaxesBalance";
          signedBalance = side === "Dr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "SALARY_ADVANCE") {
          bucket = "salaryAdvancesBalance";
          signedBalance = side === "Dr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "CASH") {
          bucket = "cashBalance";
          signedBalance = side === "Dr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "BANK") {
          bucket = "bankBalance";
          signedBalance = side === "Dr" ? balanceRaw : -balanceRaw;
        } else if (name.includes("SALARY") || name.includes("PAYROLL") || name.includes("WAGE")) {
          if (parentType?.includes("EXPENSE")) {
            bucket = "payrollExpenseBalance";
            signedBalance = side === "Dr" ? balanceRaw : -balanceRaw;
          }
        }
        
        reconBuckets[bucket] = round2((reconBuckets[bucket] || 0) + signedBalance);
        
        accountContributions.push({
          accountId: account.id,
          accountName: account.name || "Unknown",
          accountCode: account.code || "",
          parentType,
          bucket,
          balance: round2(signedBalance),
        });
      }
      
      // Calculate variances between computed totals and bucket sums
      interface BucketVariance {
        bucket: string;
        computed: number;
        fromAccounts: number;
        variance: number;
        accountsInBucket: number;
      }
      
      const variances: BucketVariance[] = [
        { bucket: "supplierBalance", computed: round2(supplierBalance), fromAccounts: reconBuckets.supplierBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "dutyAgentBalance", computed: round2(dutyAgentBalance), fromAccounts: reconBuckets.dutyAgentBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "transporterAgentBalance", computed: round2(transporterAgentBalance), fromAccounts: reconBuckets.transporterAgentBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "loansBalance", computed: round2(loansBalance), fromAccounts: reconBuckets.loansBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "liabilityBalance", computed: round2(liabilityBalance), fromAccounts: reconBuckets.liabilityBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "profitBalance", computed: round2(profitBalance), fromAccounts: reconBuckets.profitBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "incomeBalance", computed: round2(incomeBalance), fromAccounts: reconBuckets.incomeBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "assetBalance", computed: round2(assetBalance), fromAccounts: reconBuckets.assetBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "indirectExpenseBalance", computed: round2(indirectExpenseBalance), fromAccounts: reconBuckets.indirectExpenseBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "governmentTaxesBalance", computed: round2(governmentTaxesBalance), fromAccounts: reconBuckets.governmentTaxesBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "salaryAdvancesBalance", computed: round2(salaryAdvancesBalance), fromAccounts: reconBuckets.salaryAdvancesBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "payrollExpenseBalance", computed: round2(payrollExpenseBalance), fromAccounts: reconBuckets.payrollExpenseBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "cashBalance", computed: round2(cashBalance), fromAccounts: reconBuckets.cashBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "bankBalance", computed: round2(bankBalance), fromAccounts: reconBuckets.bankBalance, variance: 0, accountsInBucket: 0 },
      ];
      
      for (const v of variances) {
        v.variance = round2(v.computed - v.fromAccounts);
        v.accountsInBucket = accountContributions.filter(a => a.bucket === v.bucket).length;
      }
      
      // Filter to only significant variances
      const significantVariances = variances.filter(v => Math.abs(v.variance) > 1);
      
      // Find uncategorized accounts (potential issues)
      const uncategorizedAccounts = accountContributions.filter(a => a.bucket === "uncategorized" && Math.abs(a.balance) > 1);
      
      // Add issue for uncategorized accounts if any
      if (uncategorizedAccounts.length > 0) {
        const totalUncategorized = uncategorizedAccounts.reduce((sum, a) => sum + a.balance, 0);
        issues.push({
          id: "uncategorized-accounts",
          severity: "warning",
          title: "Accounts with Unknown Category",
          description: `Found ${uncategorizedAccounts.length} account(s) with balance of $${Math.abs(totalUncategorized).toFixed(2)} that don't fit any standard category. These may be causing the imbalance.`,
          impact: Math.abs(totalUncategorized),
          howToFix: "Review these accounts and ensure they have the correct parent type set: " + uncategorizedAccounts.map(a => a.accountName).join(", "),
          category: "Account Mapping"
        });
      }
      
      // Add issue for significant variances
      if (significantVariances.length > 0) {
        for (const v of significantVariances) {
          issues.push({
            id: `variance-${v.bucket}`,
            severity: "warning",
            title: `Variance in ${v.bucket}`,
            description: `Computed value ($${v.computed.toFixed(2)}) differs from account-level sum ($${v.fromAccounts.toFixed(2)}) by $${Math.abs(v.variance).toFixed(2)}. This may indicate double-counting or a calculation discrepancy.`,
            impact: Math.abs(v.variance),
            howToFix: "Check if any accounts are being counted in multiple buckets, or if there's a special calculation that's not reflected in the account balances.",
            category: "Reconciliation"
          });
        }
      }
      
      // === COMPONENT AUDIT FOR DEBUGGING ===
      // Show ALL components with source information for debugging the $819.12 discrepancy
      
      interface ComponentAudit {
        key: string;
        label: string;
        value: number;
        source: "ledger" | "inventory" | "containers" | "sales" | "employees" | "calculated";
        ledgerVerified: boolean;
        ledgerSum?: number;
        variance?: number;
      }
      
      const componentAudit: ComponentAudit[] = [
        // Assets
        { key: "stockOtwValue", label: "Stock OTW", value: round2(stockOtwValue), source: "containers", ledgerVerified: false },
        { key: "cashBalance", label: "Cash", value: round2(cashBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.cashBalance, variance: round2(cashBalance - reconBuckets.cashBalance) },
        { key: "bankBalance", label: "Bank", value: round2(bankBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.bankBalance, variance: round2(bankBalance - reconBuckets.bankBalance) },
        { key: "stockOnFloorValue", label: "Stock on Floor", value: round2(stockOnFloorValue), source: "inventory", ledgerVerified: false },
        { key: "assetBalance", label: "Other Assets", value: round2(assetBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.assetBalance, variance: round2(assetBalance - reconBuckets.assetBalance) },
        { key: "salaryAdvancesBalance", label: "Salary Advances", value: round2(salaryAdvancesBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.salaryAdvancesBalance, variance: round2(salaryAdvancesBalance - reconBuckets.salaryAdvancesBalance) },
        // Expenses
        { key: "indirectExpenseBalance", label: "Indirect Expenses", value: round2(indirectExpenseBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.indirectExpenseBalance, variance: round2(indirectExpenseBalance - reconBuckets.indirectExpenseBalance) },
        { key: "payrollExpenseBalance", label: "Payroll Expenses", value: round2(payrollExpenseBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.payrollExpenseBalance, variance: round2(payrollExpenseBalance - reconBuckets.payrollExpenseBalance) },
        { key: "governmentTaxesBalance", label: "Gov Taxes", value: round2(governmentTaxesBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.governmentTaxesBalance, variance: round2(governmentTaxesBalance - reconBuckets.governmentTaxesBalance) },
        { key: "cogsBalance", label: "COGS", value: round2(cogsBalance), source: "sales", ledgerVerified: false },
        // Liabilities
        { key: "supplierBalance", label: "Suppliers", value: round2(supplierBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.supplierBalance, variance: round2(supplierBalance - reconBuckets.supplierBalance) },
        { key: "dutyAgentBalance", label: "Duty Agent", value: round2(dutyAgentBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.dutyAgentBalance, variance: round2(dutyAgentBalance - reconBuckets.dutyAgentBalance) },
        { key: "transporterAgentBalance", label: "Transporter", value: round2(transporterAgentBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.transporterAgentBalance, variance: round2(transporterAgentBalance - reconBuckets.transporterAgentBalance) },
        { key: "loansBalance", label: "Loans", value: round2(loansBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.loansBalance, variance: round2(loansBalance - reconBuckets.loansBalance) },
        { key: "liabilityBalance", label: "Other Liabilities", value: round2(liabilityBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.liabilityBalance, variance: round2(liabilityBalance - reconBuckets.liabilityBalance) },
        { key: "profitBalance", label: "Profit", value: round2(profitBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.profitBalance, variance: round2(profitBalance - reconBuckets.profitBalance) },
        { key: "incomeBalance", label: "Income", value: round2(incomeBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.incomeBalance, variance: round2(incomeBalance - reconBuckets.incomeBalance) },
        { key: "payrollLiabilitiesBalance", label: "Payroll Liabilities", value: round2(payrollLiabilitiesBalance), source: "employees", ledgerVerified: false },
        { key: "openingBalanceEquity", label: "Opening Equity", value: round2(openingBalanceEquity), source: "calculated", ledgerVerified: false },
      ];
      
      // Find any component with non-zero variance
      const componentsWithVariance = componentAudit.filter(c => c.ledgerVerified && c.variance && Math.abs(c.variance) > 0.5);
      
      // Add issues for components with variances
      for (const comp of componentsWithVariance) {
        issues.push({
          id: "variance-" + comp.key,
          severity: "warning",
          title: "Variance in " + comp.label,
          description: "Computed: $" + comp.value.toFixed(2) + ", Ledger sum: $" + (comp.ledgerSum || 0).toFixed(2) + ", Difference: $" + Math.abs(comp.variance || 0).toFixed(2),
          impact: Math.abs(comp.variance || 0),
          howToFix: "Check the account categorization for " + comp.label + " accounts. Some accounts may be miscategorized or double-counted.",
          category: "Reconciliation"
        });
      }
      const reconciliation = {
        buckets: variances,
        uncategorizedAccounts: uncategorizedAccounts.slice(0, 20), // Limit for response size
        totalUncategorized: round2(reconBuckets.uncategorized),
        significantVarianceCount: significantVariances.length,
        componentAudit,
      };
      // === END RECONCILIATION SECTION ===

      // === CONTAINER OFFLOAD AUDIT ===
      // For each offloaded container, compare total debits vs total credits to find discrepancies
      
      interface ContainerAuditEntry {
        containerId: number;
        containerNumber: string;
        status: string;
        supplierName: string;
        itemsTotal: number;
        chargesTotal: number;
        grandTotal: number;
        voucherDebits: number;
        voucherCredits: number;
        difference: number;
        voucherCount: number;
        hasDiscrepancy: boolean;
      }
      
      const containerAudit: ContainerAuditEntry[] = [];
      
      // Get all offloaded containers for this company
      const offloadedContainers = await db
        .select({
          id: containers.id,
          containerNumber: containers.containerNumber,
          status: containers.status,
          supplierId: containers.supplierId,
          itemsTotal: containers.itemsTotal,
          chargesTotal: containers.chargesTotal,
          grandTotal: containers.grandTotal,
        })
        .from(containers)
        .where(
          and(
            eq(containers.companyId, companyId),
            eq(containers.status, "OFFLOADED")
          )
        );
      
      // For each container, find all related voucher entries by matching narration
      for (const container of offloadedContainers) {
        // Get supplier name
        const supplier = await db
          .select({ name: suppliers.legalName })
          .from(suppliers)
          .where(eq(suppliers.id, container.supplierId))
          .limit(1);
        
        const supplierName = supplier[0]?.name || "Unknown";
        
        // Find voucher entries with this container number in narration
        const containerPattern = `%${container.containerNumber}%`;
        
        const relatedEntries = await db
          .select({
            id: voucherEntries.id,
            debitAmount: voucherEntries.debitAmount,
            creditAmount: voucherEntries.creditAmount,
            narration: voucherEntries.narration,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(
            and(
              eq(vouchers.companyId, companyId),
              sql`${voucherEntries.narration} ILIKE ${containerPattern}`,
              sql`COALESCE(${vouchers.optional}, false) = false` // Exclude optional/draft vouchers
            )
          );
        
        // Sum debits and credits
        let totalDebits = 0;
        let totalCredits = 0;
        
        for (const entry of relatedEntries) {
          totalDebits += parseFloat(entry.debitAmount || "0");
          totalCredits += parseFloat(entry.creditAmount || "0");
        }
        
        const difference = round2(totalDebits - totalCredits);
        
        containerAudit.push({
          containerId: container.id,
          containerNumber: container.containerNumber,
          status: container.status,
          supplierName,
          itemsTotal: parseFloat(container.itemsTotal || "0"),
          chargesTotal: parseFloat(container.chargesTotal || "0"),
          grandTotal: parseFloat(container.grandTotal || "0"),
          voucherDebits: round2(totalDebits),
          voucherCredits: round2(totalCredits),
          difference,
          voucherCount: relatedEntries.length,
          hasDiscrepancy: Math.abs(difference) > 1,
        });
      }
      
      // Find containers with discrepancies
      const containersWithDiscrepancy = containerAudit.filter(c => c.hasDiscrepancy);
      
      // Add issues for containers with discrepancies
      for (const c of containersWithDiscrepancy) {
        issues.push({
          id: `container-discrepancy-${c.containerId}`,
          severity: "critical",
          title: `Container ${c.containerNumber} has unbalanced entries`,
          description: `Voucher debits ($${c.voucherDebits.toFixed(2)}) do not equal credits ($${c.voucherCredits.toFixed(2)}). Difference: $${Math.abs(c.difference).toFixed(2)}. This container's offload entries are not balanced.`,
          impact: Math.abs(c.difference),
          howToFix: `Review voucher entries for container ${c.containerNumber}. A correction journal entry of $${Math.abs(c.difference).toFixed(2)} is needed to balance the books.`,
          category: "Container Offload"
        });
      }
      
      // === END CONTAINER OFFLOAD AUDIT ===

      // Sum up issue impacts
      const totalIssueImpact = round2(issues.reduce((sum, issue) => sum + issue.impact, 0));

      res.json({
        totals: {
          assets: totalAssets,
          expenses: totalExpenses,
          liabilities: totalLiabilities,
          netBalance: netImportCycleBalance,
        },
        components: {
          stockOtwValue: round2(stockOtwValue),
          cashBalance: round2(cashBalance),
          bankBalance: round2(bankBalance),
          stockOnFloorValue: round2(stockOnFloorValue),
          assetBalance: round2(assetBalance),
          salaryAdvancesBalance: round2(salaryAdvancesBalance),
          indirectExpenseBalance: round2(indirectExpenseBalance),
          payrollExpenseBalance: round2(payrollExpenseBalance),
          governmentTaxesBalance: round2(governmentTaxesBalance),
          cogsBalance: round2(cogsBalance),
          supplierBalance: round2(supplierBalance),
          dutyAgentBalance: round2(dutyAgentBalance),
          transporterAgentBalance: round2(transporterAgentBalance),
          loansBalance: round2(loansBalance),
          liabilityBalance: round2(liabilityBalance),
          profitBalance: round2(profitBalance),
          equityTransactionBalance: round2(equityTransactionBalance),
          apTransactionBalance: round2(apTransactionBalance),
          incomeBalance: round2(incomeBalance),
          payrollLiabilitiesBalance: round2(payrollLiabilitiesBalance),
          openingBalanceEquity: round2(openingBalanceEquity),
          openingStockValue: round2(openingStockValue),
        },
        issues,
        summary: {
          totalIssues: issues.length,
          criticalIssues: issues.filter(i => i.severity === "critical").length,
          warningIssues: issues.filter(i => i.severity === "warning").length,
          totalIssueImpact,
        },
        reconciliation,
        containerAudit,
      });
    } catch (error: any) {
      console.error("Import cycle diagnostics error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Orphaned Charge Vouchers Diagnostics - Find charge vouchers for OTW containers
  // These are vouchers (DUTY-, TRANS-, OFFICE-, CHG-, XFER-) that should only exist for OFFLOADED containers
  // Business logic: Charge vouchers are created ONLY during container offload. If a container's status is OTW
  // (not offloaded) but has charge vouchers, those are definitively orphaned because:
  // 1. Containers start as OTW with no charges
  // 2. Offload creates charge vouchers AND changes status to OFFLOADED  
  // 3. If status is OTW with charge vouchers, offload was reversed without proper cleanup
  app.get("/api/debug/orphaned-charge-vouchers", requireAuth, requireRole("Admin", "Owner", "Manager"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all OTW containers for this company that do NOT have an active offload record
      // This ensures we're only looking at containers that were reversed (orphaned)
      const otwContainers = await db
        .select({ id: containers.id, containerNumber: containers.containerNumber, numberPlate: containers.numberPlate })
        .from(containers)
        .leftJoin(containerOffloads, eq(containers.id, containerOffloads.containerId))
        .where(
          and(
            eq(containers.companyId, companyId),
            eq(containers.status, "OTW"),
            isNull(containerOffloads.id) // No active offload record = was reversed
          )
        );

      const orphanedVouchers: Array<{
        voucherId: number;
        voucherNumber: string;
        voucherType: string;
        containerNumber: string;
        containerId: number;
        totalDebit: number;
        totalCredit: number;
        reason: string;
      }> = [];

      // For each OTW container without offload record, find any charge vouchers that shouldn't exist
      for (const container of otwContainers) {
        // For Statement of Accounts (byAgent), only include OTW containers with plate numbers
        const hasPlate = container.numberPlate && container.numberPlate.trim() !== "";
        const chargeVouchersForContainer = await db
          .select({
            id: vouchers.id,
            voucherNumber: vouchers.voucherNumber,
            voucherType: vouchers.voucherType,
          })
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              or(
                sql`${vouchers.voucherNumber} LIKE ${'DUTY-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'TRANS-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'OFFICE-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'CHG-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'XFER-' + container.containerNumber + '%'}`
              )
            )
          );

        for (const v of chargeVouchersForContainer) {
          // Get entries to calculate impact
          const entries = await db
            .select({
              debitAmount: voucherEntries.debitAmount,
              creditAmount: voucherEntries.creditAmount,
            })
            .from(voucherEntries)
            .where(eq(voucherEntries.voucherId, v.id));

          const totalDebit = entries.reduce((sum, e) => sum + parseFloat(e.debitAmount || "0"), 0);
          const totalCredit = entries.reduce((sum, e) => sum + parseFloat(e.creditAmount || "0"), 0);

          orphanedVouchers.push({
            voucherId: v.id,
            voucherNumber: v.voucherNumber,
            voucherType: v.voucherType,
            containerNumber: container.containerNumber,
            containerId: container.id,
            totalDebit,
            totalCredit,
            reason: "Container is OTW with no offload record but has charge vouchers (offload was reversed without cleanup)",
          });
        }
      }

      res.json({
        otwContainerCount: otwContainers.length,
        orphanedVoucherCount: orphanedVouchers.length,
        orphanedVouchers,
        totalImpact: orphanedVouchers.reduce((sum, v) => sum + Math.abs(v.totalDebit - v.totalCredit), 0),
        explanation: "These vouchers exist for containers in OTW status that have no offload record. They were created during offload but not cleaned up when the offload was reversed.",
      });
    } catch (error: any) {
      console.error("Orphaned charge vouchers diagnostics error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Delete orphaned charge vouchers for OTW containers
  // Only deletes vouchers for containers that are OTW AND have no offload record (confirmed reversed)
  app.post("/api/admin/fix-orphaned-charge-vouchers", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all OTW containers that do NOT have an active offload record
      const otwContainers = await db
        .select({ id: containers.id, containerNumber: containers.containerNumber, numberPlate: containers.numberPlate })
        .from(containers)
        .leftJoin(containerOffloads, eq(containers.id, containerOffloads.containerId))
        .where(
          and(
            eq(containers.companyId, companyId),
            eq(containers.status, "OTW"),
            isNull(containerOffloads.id) // No active offload record = was reversed
          )
        );

      const deletedVouchers: Array<{ voucherId: number; voucherNumber: string; containerNumber: string }> = [];

      // For each OTW container without offload record, find and delete charge vouchers
      for (const container of otwContainers) {
        // For Statement of Accounts (byAgent), only include OTW containers with plate numbers
        const hasPlate = container.numberPlate && container.numberPlate.trim() !== "";
        const chargeVouchersForContainer = await db
          .select({
            id: vouchers.id,
            voucherNumber: vouchers.voucherNumber,
          })
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              or(
                sql`${vouchers.voucherNumber} LIKE ${'DUTY-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'TRANS-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'OFFICE-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'CHG-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'XFER-' + container.containerNumber + '%'}`
              )
            )
          );

        for (const v of chargeVouchersForContainer) {
          // Delete voucher entries first
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, v.id));
          // Then delete the voucher
          await db.delete(vouchers).where(eq(vouchers.id, v.id));
          
          deletedVouchers.push({
            voucherId: v.id,
            voucherNumber: v.voucherNumber,
            containerNumber: container.containerNumber,
          });
          
          console.log(`Deleted orphaned voucher: ${v.voucherNumber} for container ${container.containerNumber}`);
        }
      }

      res.json({
        message: `Deleted ${deletedVouchers.length} orphaned charge vouchers`,
        deletedCount: deletedVouchers.length,
        deletedVouchers,
        containersChecked: otwContainers.length,
      });
    } catch (error: any) {
      console.error("Fix orphaned charge vouchers error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // List offloads for daybook view (filtered by date range and company)
  app.get("/api/offloads", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { startDate, endDate } = req.query;
      const conditions: any[] = [eq(containers.companyId, companyId)];

      if (startDate) {
        conditions.push(gte(containerOffloads.offloadedAt, new Date((startDate as string) + "T00:00:00")));
      }
      if (endDate) {
        conditions.push(lte(containerOffloads.offloadedAt, new Date((endDate as string) + "T23:59:59")));
      }

      const offloads = await db
        .select({
          id: containerOffloads.id,
          containerId: containerOffloads.containerId,
          containerNumber: containers.containerNumber,
          locationId: containerOffloads.locationId,
          locationName: locations.name,
          duties: containerOffloads.duties,
          officeCharges: containerOffloads.officeCharges,
          transferCharges: containerOffloads.transferCharges,
          transportFees: containerOffloads.transportFees,
          totalCharges: containerOffloads.totalCharges,
          totalBales: containerOffloads.totalBales,
          additionalCostPerBale: containerOffloads.additionalCostPerBale,
          offloadedAt: containerOffloads.offloadedAt,
          itemsTotal: sql<string>`coalesce((select sum(coi.total_value) from container_offload_items coi where coi.offload_id = ${containerOffloads.id}), 0)`,
        })
        .from(containerOffloads)
        .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
        .leftJoin(locations, eq(containerOffloads.locationId, locations.id))
        .where(and(...conditions))
        .orderBy(desc(containerOffloads.offloadedAt))
        .execute();

      res.json(offloads);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get full offload detail with items for daybook view
  app.get("/api/offloads/:id", requireAuth, async (req, res) => {
    try {
      const offloadId = parseInt(req.params.id);
      if (isNaN(offloadId)) return res.status(400).json({ message: "Invalid offload ID" });

      const [offload] = await db
        .select({
          id: containerOffloads.id,
          containerId: containerOffloads.containerId,
          containerNumber: containers.containerNumber,
          locationId: containerOffloads.locationId,
          locationName: locations.name,
          duties: containerOffloads.duties,
          officeCharges: containerOffloads.officeCharges,
          transferCharges: containerOffloads.transferCharges,
          transportFees: containerOffloads.transportFees,
          totalCharges: containerOffloads.totalCharges,
          totalBales: containerOffloads.totalBales,
          additionalCostPerBale: containerOffloads.additionalCostPerBale,
          offloadedAt: containerOffloads.offloadedAt,
          containerChargesTotal: containers.chargesTotal,
          optional: containerOffloads.optional,
          companyId: containers.companyId,
        })
        .from(containerOffloads)
        .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
        .leftJoin(locations, eq(containerOffloads.locationId, locations.id))
        .where(eq(containerOffloads.id, offloadId))
        .execute();

      if (!offload) return res.status(404).json({ message: "Offload not found" });

      const items = await db
        .select({
          id: containerOffloadItems.id,
          stockItemId: containerOffloadItems.stockItemId,
          stockItemName: stockItems.name,
          stockItemCode: stockItems.code,
          quantity: containerOffloadItems.quantity,
          rate: containerOffloadItems.rate,
          totalValue: containerOffloadItems.totalValue,
        })
        .from(containerOffloadItems)
        .leftJoin(stockItems, eq(containerOffloadItems.stockItemId, stockItems.id))
        .where(eq(containerOffloadItems.offloadId, offloadId))
        .execute();

      // Fetch PO-level charges for the container (freight, fumigation, surcharge, documentCharges, discount, otherCharges)
      const pos = await db
        .select({
          id: purchaseOrders.id,
          poNumber: purchaseOrders.poNumber,
          freight: purchaseOrders.freight,
          surcharge: purchaseOrders.surcharge,
          fumigation: purchaseOrders.fumigation,
          documentCharges: purchaseOrders.documentCharges,
          discount: purchaseOrders.discount,
          otherCharges: purchaseOrders.otherCharges,
        })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.containerId, offload.containerId))
        .execute();

      // Aggregate PO charges for display
      const poFreight = pos.reduce((s, p) => s + parseFloat(p.freight || "0"), 0);
      const poSurcharge = pos.reduce((s, p) => s + parseFloat(p.surcharge || "0"), 0);
      const poFumigation = pos.reduce((s, p) => s + parseFloat(p.fumigation || "0"), 0);
      const poDocumentCharges = pos.reduce((s, p) => s + parseFloat(p.documentCharges || "0"), 0);
      const poDiscount = pos.reduce((s, p) => s + parseFloat(p.discount || "0"), 0);
      const poOtherCharges = pos.reduce((s, p) => s + parseFloat(p.otherCharges || "0"), 0);

      // Fetch additional charges (fumigation, misc charges attached to the container)
      const additionalCharges = await db
        .select({
          id: containerCharges.id,
          chargeType: containerCharges.chargeType,
          amount: containerCharges.amount,
        })
        .from(containerCharges)
        .where(eq(containerCharges.containerId, offload.containerId))
        .execute();

      const poCharges = {
        freight: poFreight,
        surcharge: poSurcharge,
        fumigation: poFumigation,
        documentCharges: poDocumentCharges,
        discount: poDiscount,
        otherCharges: poOtherCharges,
        total: parseFloat(offload.containerChargesTotal || "0"),
      };

      // Fetch LIVE voucher totals for this container so external edits are reflected immediately
      // Pattern: DUTY-{containerNumber}-*, OFFICE-{containerNumber}-*, TRANS-{containerNumber}-*, XFER-{containerNumber}-*, CHG-{containerNumber}-*
      const cn = offload.containerNumber;
      const liveVouchers = await db
        .select({ voucherNumber: vouchers.voucherNumber, totalAmount: vouchers.totalAmount })
        .from(vouchers)
        .where(
          or(
            like(vouchers.voucherNumber, `DUTY-${cn}-%`),
            like(vouchers.voucherNumber, `OFFICE-${cn}-%`),
            like(vouchers.voucherNumber, `TRANS-${cn}-%`),
            like(vouchers.voucherNumber, `XFER-${cn}-%`),
            like(vouchers.voucherNumber, `CHG-${cn}-%`),
          )
        )
        .execute();

      const sumByPrefix = (prefix: string) =>
        liveVouchers
          .filter(v => v.voucherNumber.startsWith(`${prefix}-${cn}-`))
          .reduce((s, v) => s + parseFloat(v.totalAmount || "0"), 0);

      const liveDuties          = sumByPrefix("DUTY");
      const liveOfficeCharges   = sumByPrefix("OFFICE");
      const liveTransportFees   = sumByPrefix("TRANS");
      const liveTransferCharges = sumByPrefix("XFER");
      const liveAddlCharges     = sumByPrefix("CHG");

      const liveTotalOffloadCharges = liveDuties + liveOfficeCharges + liveTransportFees + liveTransferCharges + liveAddlCharges;
      const liveTotalAllCharges     = liveTotalOffloadCharges + poCharges.total;
      const totalBalesNum           = parseFloat(offload.totalBales || "0");
      const liveAdditionalCostPerBale = totalBalesNum > 0
        ? Math.round((liveTotalAllCharges / totalBalesNum) * 100) / 100
        : 0;

      const liveCharges = {
        duties:          liveDuties,
        officeCharges:   liveOfficeCharges,
        transportFees:   liveTransportFees,
        transferCharges: liveTransferCharges,
        additionalCharges: liveAddlCharges,
        totalOffloadCharges: liveTotalOffloadCharges,
        totalAllCharges:  liveTotalAllCharges,
        additionalCostPerBale: liveAdditionalCostPerBale,
        hasVouchers: liveVouchers.length > 0,
      };

      res.json({ ...offload, items, poCharges, additionalCharges, liveCharges });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Toggle offload optional status — suspends/unsuspends inventory + vouchers without reversing permanently
  app.post("/api/offloads/:id/toggle-optional", requireAuth, requireRole("Admin", "Developer", "Owner"), async (req, res) => {
    try {
      const offloadId = parseInt(req.params.id);
      if (isNaN(offloadId)) return res.status(400).json({ message: "Invalid offload ID" });

      const [offload] = await db
        .select({
          id: containerOffloads.id,
          containerId: containerOffloads.containerId,
          locationId: containerOffloads.locationId,
          optional: containerOffloads.optional,
          offloadedAt: containerOffloads.offloadedAt,
          companyId: containers.companyId,
          containerNumber: containers.containerNumber,
        })
        .from(containerOffloads)
        .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
        .where(eq(containerOffloads.id, offloadId))
        .execute();

      if (!offload) return res.status(404).json({ message: "Offload not found" });

      const makeOptional = !offload.optional; // toggle
      const cn = offload.containerNumber;

      // Fetch the exact offload items (quantities + values as-offloaded)
      const offloadItems = await db
        .select()
        .from(containerOffloadItems)
        .where(eq(containerOffloadItems.offloadId, offloadId))
        .execute();

      if (offloadItems.length === 0) {
        return res.status(400).json({ message: "No offload items found — cannot toggle optional status" });
      }

      await db.transaction(async (tx) => {
        // 1. Toggle inventory
        for (const item of offloadItems) {
          const qty   = parseFloat(item.quantity);
          const value = parseFloat(item.totalValue);
          const rate  = parseFloat(item.rate);

          if (makeOptional) {
            // Suspending: remove the stock that was added at offload
            await reverseInventoryByExactValue(tx, offload.locationId, item.stockItemId, qty, value, offload.companyId);
          } else {
            // Unsuspending: add the stock back at the original rate
            await adjustInventory(tx, offload.locationId, item.stockItemId, qty, offload.companyId, rate);
          }
        }

        // 2. Toggle all offload-related vouchers (DUTY-, OFFICE-, TRANS-, XFER-, CHG-)
        const offloadVouchers = await tx
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(
            or(
              like(vouchers.voucherNumber, `DUTY-${cn}-%`),
              like(vouchers.voucherNumber, `OFFICE-${cn}-%`),
              like(vouchers.voucherNumber, `TRANS-${cn}-%`),
              like(vouchers.voucherNumber, `XFER-${cn}-%`),
              like(vouchers.voucherNumber, `CHG-${cn}-%`),
            )
          )
          .execute();

        if (offloadVouchers.length > 0) {
          const voucherIds = offloadVouchers.map(v => v.id);
          await tx
            .update(vouchers)
            .set({ optional: makeOptional })
            .where(inArray(vouchers.id, voucherIds));
        }

        // 3. Update the offload record itself
        await tx
          .update(containerOffloads)
          .set({ optional: makeOptional })
          .where(eq(containerOffloads.id, offloadId));

        // 4. Sync container status to match the new offload state
        if (makeOptional) {
          // Suspending: check if ALL offloads for this container are now optional.
          // If so, revert the container back to OTW so it shows on the tracking page.
          const remainingActive = await tx
            .select({ id: containerOffloads.id })
            .from(containerOffloads)
            .where(
              and(
                eq(containerOffloads.containerId, offload.containerId),
                eq(containerOffloads.optional, false),
              )
            );
          if (remainingActive.length === 0) {
            await tx
              .update(containers)
              .set({ status: "OTW", offloadDate: null })
              .where(eq(containers.id, offload.containerId));
          }
        } else {
          // Unsuspending: container must be OFFLOADED again.
          // Restore offloadDate from the offload's offloadedAt timestamp.
          const restoredDate = offload.offloadedAt instanceof Date
            ? offload.offloadedAt.toISOString().split("T")[0]
            : new Date().toISOString().split("T")[0];
          await tx
            .update(containers)
            .set({ status: "OFFLOADED", offloadDate: restoredDate })
            .where(eq(containers.id, offload.containerId));
        }
      });

      res.json({
        optional: makeOptional,
        message: makeOptional
          ? "Offload suspended — stock removed, vouchers set to optional, container moved back to OTW."
          : "Offload restored — stock re-added, vouchers made active, container marked OFFLOADED.",
      });
    } catch (error: any) {
      console.error("Error toggling offload optional:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Container Offload Diagnostics - Analyze PO line items for potential issues
  app.get("/api/containers/:id/offload-diagnostics", requireAuth, requireRole("Admin", "Developer", "Owner"), async (req, res) => {
    try {
      const containerId = parseInt(req.params.id);
      if (isNaN(containerId)) {
        return res.status(400).json({ message: "Invalid container ID" });
      }

      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get container
      const container = await storage.getContainerById(containerId);
      if (!container || container.companyId !== companyId) {
        return res.status(404).json({ message: "Container not found" });
      }

      // Get all POs for this container
      const pos = await storage.getPurchaseOrdersByContainer(containerId);
      
      const lineItemDetails: Array<{
        poId: number;
        poNumber: string;
        lineItemId: number;
        stockItemId: number | null;
        stockItemCode: string | null;
        stockItemName: string | null;
        quantity: string;
        quantityParsed: number;
        rate: string;
        isValid: boolean;
        issues: string[];
      }> = [];

      const duplicateCheck = new Map<string, number[]>(); // stockItemId -> [lineItemIds]
      let totalQuantity = 0;
      let invalidLineItems = 0;
      let blankQuantities = 0;
      
      for (const po of pos) {
        const lineItems = await storage.getLineItemsByPO(po.id);
        
        for (const item of lineItems) {
          const issues: string[] = [];
          const quantityParsed = parseFloat(item.quantity);
          
          // Check for issues
          if (!item.stockItemId || item.stockItemId === 0) {
            issues.push("No stock item assigned");
            invalidLineItems++;
          }
          
          if (isNaN(quantityParsed) || item.quantity === "" || item.quantity === null) {
            issues.push("Blank or invalid quantity");
            blankQuantities++;
          } else if (quantityParsed <= 0) {
            issues.push("Zero or negative quantity");
          } else {
            totalQuantity += quantityParsed;
          }
          
          // Track for duplicate detection
          if (item.stockItemId && item.stockItemId !== 0) {
            const key = `${po.id}-${item.stockItemId}`;
            if (!duplicateCheck.has(key)) {
              duplicateCheck.set(key, []);
            }
            duplicateCheck.get(key)!.push(item.id);
          }
          
          // Get stock item details
          let stockItemCode: string | null = null;
          let stockItemName: string | null = null;
          if (item.stockItemId) {
            const stockItem = await storage.getStockItemById(item.stockItemId);
            if (stockItem) {
              stockItemCode = stockItem.code;
              stockItemName = stockItem.name;
            }
          }
          
          lineItemDetails.push({
            poId: po.id,
            poNumber: po.poNumber || `PO-${po.id}`,
            lineItemId: item.id,
            stockItemId: item.stockItemId,
            stockItemCode,
            stockItemName,
            quantity: item.quantity,
            quantityParsed: isNaN(quantityParsed) ? 0 : quantityParsed,
            rate: item.rate,
            isValid: issues.length === 0,
            issues,
          });
        }
      }
      
      // Check for duplicates
      const duplicates: Array<{stockItemId: number; poId: number; lineItemIds: number[]}> = [];
      for (const [key, lineItemIds] of Array.from(duplicateCheck.entries())) {
        if (lineItemIds.length > 1) {
          const [poId, stockItemId] = key.split("-").map(Number);
          duplicates.push({ stockItemId, poId, lineItemIds });
          
          // Mark duplicates in lineItemDetails
          for (const detail of lineItemDetails) {
            if (lineItemIds.includes(detail.lineItemId)) {
              detail.issues.push(`Duplicate: ${lineItemIds.length} entries for same stock item in same PO`);
              detail.isValid = false;
            }
          }
        }
      }

      // Check existing inventory for pre-sales
      const inventoryWarnings: Array<{stockItemId: number; stockItemCode: string; currentQty: number; incomingQty: number; resultQty: number}> = [];
      
      // Group by stock item
      const stockItemTotals = new Map<number, number>();
      for (const item of lineItemDetails) {
        if (item.stockItemId && item.isValid) {
          stockItemTotals.set(item.stockItemId, (stockItemTotals.get(item.stockItemId) || 0) + item.quantityParsed);
        }
      }

      res.json({
        containerId,
        containerNumber: container.containerNumber,
        containerStatus: container.status,
        poCount: pos.length,
        lineItemCount: lineItemDetails.length,
        totalQuantity,
        invalidLineItems,
        blankQuantities,
        duplicateCount: duplicates.length,
        duplicates,
        lineItems: lineItemDetails,
        inventoryWarnings,
        hasIssues: invalidLineItems > 0 || blankQuantities > 0 || duplicates.length > 0,
        summary: {
          valid: lineItemDetails.filter(i => i.isValid).length,
          invalid: lineItemDetails.filter(i => !i.isValid).length,
        }
      });
    } catch (error: any) {
      console.error("Container offload diagnostics error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get all containers for diagnostics selection
  app.get("/api/admin/containers-for-diagnostics", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const allContainers = await db
        .select({
          id: containers.id,
          containerNumber: containers.containerNumber,
          status: containers.status,
          itemsTotal: containers.itemsTotal,
        })
        .from(containers)
        .where(eq(containers.companyId, companyId))
        .orderBy(desc(containers.id));

      res.json(allContainers);
    } catch (error: any) {
      console.error("Get containers for diagnostics error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Net Profit (P&L) Report - Tally Prime style

  // Backfill missing vouchers for post-offload charges that already have a ledgerAccountId
  // but whose voucher was created in the wrong company (factory instead of ledger account's company).
  // Idempotent: skips any charge that already has a voucher crediting the chosen ledger account.
  app.post("/api/admin/backfill-postoffload-vouchers", requireAuth, requireRole("Admin", "Developer"), async (req, res) => {
    try {
      let scanned = 0, created = 0, skippedExisting = 0, errors = 0;
      const errorDetails: string[] = [];

      // Fetch all post-offload charges that have a ledger account chosen
      const chargesRes = await db.execute(sql`
        SELECT
          c.id,
          c.container_id,
          c.description,
          c.amount,
          c.currency_code,
          c.fx_rate_to_usd,
          c.ledger_account_id,
          c.created_at,
          fc.container_number
        FROM factory_offload_additional_charges c
        JOIN factory_containers fc ON fc.id = c.container_id
        WHERE c.ledger_account_id IS NOT NULL
        ORDER BY c.id
      `);
      const rows: any[] = (chargesRes as any).rows ?? (chargesRes as unknown as any[]);

      for (const row of rows) {
        scanned++;
        try {
          const chargeId: number = row.id;
          const containerId: number = row.container_id;
          const containerNumber: string = row.container_number || `#${containerId}`;
          const ledgerAccountId: number = row.ledger_account_id;
          const description: string = row.description || "Post-offload charge";
          const amount = parseFloat(row.amount || "0");
          const chargeCcy: string = row.currency_code || "USD";
          const chargeFx = parseFloat(row.fx_rate_to_usd || "1");
          const voucherDate: string = row.created_at
            ? new Date(row.created_at).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10);

          if (amount <= 0) { skippedExisting++; continue; }

          // Resolve the ledger account's company
          const [acctRow] = await db
            .select({ companyId: ledgerAccounts.companyId })
            .from(ledgerAccounts)
            .where(eq(ledgerAccounts.id, ledgerAccountId));
          if (!acctRow) {
            errors++;
            errorDetails.push(`chargeId=${chargeId}: ledgerAccount ${ledgerAccountId} not found`);
            continue;
          }
          const voucherCompanyId = acctRow.companyId;

          // Idempotency: check if a voucher already exists that credits this ledger account
          // for a post-offload entry on this container
          const existingCheck = await db.execute(sql`
            SELECT v.id
            FROM vouchers v
            JOIN voucher_entries ve ON ve.voucher_id = v.id
            WHERE v.source_module = 'FACTORY'
              AND v.company_id = ${voucherCompanyId}
              AND v.description ILIKE ${'%(post-offload)%container ' + containerNumber + '%'}
              AND ve.ledger_account_id = ${ledgerAccountId}
              AND ve.credit_amount::numeric > 0
            LIMIT 1
          `);
          const existingRows: any[] = (existingCheck as any).rows ?? (existingCheck as unknown as any[]);
          if (existingRows.length > 0) {
            skippedExisting++;
            continue;
          }

          // Get or create FACTORY_CHARGES_PAYABLE in the ledger account's company
          const cpAcctId = await getOrCreateLedgerAccount(
            voucherCompanyId,
            "FACTORY_CHARGES_PAYABLE",
            "Factory Charges Payable",
          );

          // Insert the voucher
          const voucherNum = `FACTORY-POC-BACKFILL-${containerId}-${chargeId}`;
          const [voucher] = await db.insert(vouchers).values({
            companyId: voucherCompanyId,
            voucherType: "Journal",
            voucherNumber: voucherNum,
            voucherDate,
            description: `${description} (post-offload) — container ${containerNumber}`,
            totalAmount: String(amount),
            currency: chargeCcy,
            exchangeRate: String(chargeFx),
            sourceModule: "FACTORY",
          }).returning();

          // DR FACTORY_CHARGES_PAYABLE
          await db.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: cpAcctId,
            debitAmount: String(amount),
            creditAmount: "0",
            narration: `${description} payable — container ${containerNumber}`,
          });
          // CR chosen ledger account
          await db.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId,
            debitAmount: "0",
            creditAmount: String(amount),
            narration: `${description} — container ${containerNumber}`,
          });

          created++;
          console.log(`[POC backfill] voucherId=${voucher.id} chargeId=${chargeId} container=${containerNumber} voucherCompanyId=${voucherCompanyId} cpAcctId=${cpAcctId}`);
        } catch (err: any) {
          errors++;
          errorDetails.push(`chargeId=${row.id}: ${err.message}`);
          console.error(`[POC backfill] error on chargeId=${row.id}:`, err);
        }
      }

      res.json({ scanned, created, skippedExisting, errors, errorDetails });
    } catch (error: any) {
      console.error("Backfill post-offload vouchers error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
