import type { Express } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory } from "../_helpers";
import { getClientDate } from "../../lib/dateUtils";
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
  stockItemLocationPrices,
  exchangeRates,
  factoryWorkerAdvances,
  propertyContracts,
  propertyMonthlyLedger,
  propertyPayments,
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
import { classifyNetPositionAccounts, getAccountNetBalance, round2 } from "../../netPositionHelper";

import { _getCached, _setCached } from "../../services/shared/ttlCache";

export function registerStatsReportsRoutes(app: Express) {
  app.get("/api/reports/sales", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate, locationId, stockGroupId } = req.query;

      const conditions = [eq(vouchers.companyId, companyId)];

      if (startDate) {
        conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }
      if (locationId) {
        conditions.push(eq(vouchers.locationId, parseInt(locationId as string)));
      }

      const salesQuery = db
        .select({
          id: salesItems.id,
          voucherNumber: vouchers.voucherNumber,
          voucherDate: vouchers.voucherDate,
          locationName: locations.name,
          stockItemCode: stockItems.code,
          stockItemName: stockItems.name,
          stockGroupId: stockItems.stockGroupId,
          quantity: salesItems.quantity,
          sellingPrice: salesItems.sellingPrice,
          costPrice: salesItems.costPrice,
          totalSales: salesItems.totalSales,
          totalCost: salesItems.totalCost,
          profit: salesItems.profit,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(and(...conditions))
        .orderBy(vouchers.voucherDate);

      let salesData = await salesQuery.execute();

      // Filter by stock group if provided
      if (stockGroupId) {
        salesData = salesData.filter((s) => s.stockGroupId === parseInt(stockGroupId as string));
      }

      const totalQuantity = salesData.reduce((sum, item) => sum + parseFloat(item.quantity), 0);
      const totalSales = salesData.reduce((sum, item) => sum + parseFloat(item.totalSales), 0);
      const totalCost = salesData.reduce((sum, item) => sum + parseFloat(item.totalCost), 0);
      const totalProfit = salesData.reduce((sum, item) => sum + parseFloat(item.profit), 0);

      res.json({
        items: salesData,
        summary: {
          totalQuantity,
          totalSales,
          totalCost,
          totalProfit,
          grossProfitMargin: totalSales > 0 ? (totalProfit / totalSales) * 100 : 0,
        },
        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
          locationId: locationId || null,
          stockGroupId: stockGroupId || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Movement Report
  app.get("/api/reports/stock-movement", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate, locationId, stockGroupId } = req.query;

      // Get all stock items for this company
      const allStockItems = await storage.getAllStockItems(companyId);

      // Filter by stock group if provided
      const stockItemsToReport = stockGroupId
        ? allStockItems.filter((item) => item.stockGroupId === parseInt(stockGroupId as string))
        : allStockItems;

      // Get all inventory records
      const inventoryConditions = [eq(locations.companyId, companyId)];

      if (locationId) {
        inventoryConditions.push(eq(inventory.locationId, parseInt(locationId as string)));
      }

      const inventoryRecords = await db
        .select({
          stockItemId: inventory.stockItemId,
          locationId: inventory.locationId,
          locationName: locations.name,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(and(...inventoryConditions))
        .execute();

      // Pre-group inventory by stockItemId — avoids O(n²) .filter() inside .map()
      const inventoryByItem = new Map<number, typeof inventoryRecords>();
      for (const inv of inventoryRecords) {
        const list = inventoryByItem.get(inv.stockItemId) || [];
        list.push(inv);
        inventoryByItem.set(inv.stockItemId, list);
      }

      // Build movement report - calculate value dynamically as qty * rate
      const movementData = stockItemsToReport
        .map((item) => {
          const itemInventory = inventoryByItem.get(item.id) || [];
          const totalQuantity = itemInventory.reduce((sum, inv) => sum + parseFloat(inv.quantity), 0);
          const totalValue = itemInventory.reduce(
            (sum, inv) => sum + parseFloat(inv.quantity) * parseFloat(inv.averageRate),
            0
          );

          return {
            stockItemId: item.id,
            stockItemCode: item.code,
            stockItemName: item.name,
            locations: itemInventory.map((inv) => {
              const qty = parseFloat(inv.quantity) || 0;
              const rate = parseFloat(inv.averageRate) || 0;
              return {
                locationId: inv.locationId,
                locationName: inv.locationName,
                quantity: qty,
                averageRate: rate,
                totalValue: qty * rate,
              };
            }),
            totalQuantity,
            totalValue,
          };
        })
        .filter((item) => item.totalQuantity > 0);

      const grandTotalQuantity = movementData.reduce((sum, item) => sum + item.totalQuantity, 0);
      const grandTotalValue = movementData.reduce((sum, item) => sum + item.totalValue, 0);

      res.json({
        items: movementData,
        summary: {
          totalItems: movementData.length,
          grandTotalQuantity,
          grandTotalValue,
        },
        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
          locationId: locationId || null,
          stockGroupId: stockGroupId || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Container Report
  app.get("/api/reports/containers", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { status, supplierId, startDate, endDate, allCompanies, specificCompanyId } = req.query;

      // Determine which companies to include
      let companyCondition;
      if (allCompanies === "true") {
        const isDeveloper = (req.user as any)?.role === "Developer";
        let companyIds: number[];
        if (isDeveloper) {
          const all = await storage.getAllCompanies();
          companyIds = all.map((c: any) => c.id);
        } else {
          const userCompanies = await storage.getUserCompaniesWithRoles(req.user!.id);
          companyIds = userCompanies.map((uc) => uc.companyId);
        }
        companyCondition =
          companyIds.length > 0 ? inArray(containers.companyId, companyIds) : eq(containers.companyId, companyId);
      } else if (specificCompanyId) {
        companyCondition = eq(containers.companyId, parseInt(specificCompanyId as string));
      } else {
        companyCondition = eq(containers.companyId, companyId);
      }

      const conditions = [companyCondition];

      // Normalise status: the DB stores "OFFLOADED" (all-caps) while the
      // frontend select sends "Offloaded" (mixed-case). Uppercase comparison
      // handles both, and also tolerates any future casing differences.
      const isOffloaded = (status as string | undefined)?.toLowerCase() === "offloaded";
      if (status) {
        const dbStatus = isOffloaded ? "OFFLOADED" : (status as string);
        conditions.push(eq(containers.status, dbStatus));
      }
      if (supplierId) {
        conditions.push(eq(containers.supplierId, parseInt(supplierId as string)));
      }

      // Date filtering — offloaded containers use offloadDate; OTW use importDate
      if (isOffloaded) {
        if (startDate) conditions.push(sql`${containers.offloadDate} >= ${startDate}`);
        if (endDate) conditions.push(sql`${containers.offloadDate} <= ${endDate}`);
      } else {
        if (startDate) conditions.push(sql`${containers.importDate} >= ${startDate}`);
        if (endDate) conditions.push(sql`${containers.importDate} <= ${endDate}`);
      }

      const containerData = await db
        .select({
          id: containers.id,
          containerNumber: containers.containerNumber,
          supplierName: suppliers.legalName,
          status: containers.status,
          importDate: containers.importDate,
          offloadDate: containers.offloadDate,
          itemsTotal: containers.itemsTotal,
          chargesTotal: containers.chargesTotal,
          grandTotal: containers.grandTotal,
          companyId: containers.companyId,
          companyName: companies.name,
        })
        .from(containers)
        .innerJoin(suppliers, eq(containers.supplierId, suppliers.id))
        .innerJoin(companies, eq(containers.companyId, companies.id))
        .where(and(...conditions))
        .orderBy(
          isOffloaded ? sql`${containers.offloadDate} DESC NULLS LAST` : sql`${containers.importDate} DESC NULLS LAST`
        );

      const totalItemsTotal = containerData.reduce((sum, c) => sum + parseFloat(c.itemsTotal || "0"), 0);
      const totalChargesTotal = containerData.reduce((sum, c) => sum + parseFloat(c.chargesTotal || "0"), 0);
      const totalGrandTotal = containerData.reduce((sum, c) => sum + parseFloat(c.grandTotal || "0"), 0);

      res.json({
        containers: containerData,
        summary: {
          totalContainers: containerData.length,
          totalItemsTotal,
          totalChargesTotal,
          totalGrandTotal,
        },
        filters: {
          status: status || null,
          supplierId: supplierId || null,
          startDate: startDate || null,
          endDate: endDate || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Ratio Analysis Report
  app.get("/api/reports/ratios", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate } = req.query;

      // Get all ledger accounts
      const companyAccounts = await storage.getAllLedgerAccounts(companyId, true); // Include hidden accounts for financial calculations

      const incomeAccountIds = companyAccounts.filter((acc) => acc.accountType === "Income").map((acc) => acc.id);
      const expenseAccountIds = companyAccounts.filter((acc) => acc.accountType === "Expense").map((acc) => acc.id);
      const assetAccountIds = companyAccounts.filter((acc) => acc.accountType === "Asset").map((acc) => acc.id);
      const liabilityAccountIds = companyAccounts.filter((acc) => acc.accountType === "Liability").map((acc) => acc.id);

      const _ratiosCacheKey = `ratios:${companyId}:${startDate ?? ""}:${endDate ?? ""}`;
      const _ratiosCached = _getCached(_ratiosCacheKey);
      if (_ratiosCached) return res.json(_ratiosCached);

      // Single-query JOIN replaces the old two-step voucher-ID fetch + inArray pattern
      const entryConditions: any[] = [eq(vouchers.companyId, companyId)];
      if (startDate) {
        entryConditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }
      if (endDate) {
        entryConditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }

      const companyEntries = await db
        .select({
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
          ledgerAccountId: voucherEntries.ledgerAccountId,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(...entryConditions, isNotNull(voucherEntries.ledgerAccountId)))
        .execute();

      // Calculate totals
      let totalIncome = 0;
      let totalExpenses = 0;
      let totalAssets = 0;
      let totalLiabilities = 0;

      for (const entry of companyEntries) {
        const debit = parseFloat(entry.debitAmount || "0");
        const credit = parseFloat(entry.creditAmount || "0");

        if (entry.ledgerAccountId) {
          if (incomeAccountIds.includes(entry.ledgerAccountId)) {
            totalIncome += credit - debit;
          }
          if (expenseAccountIds.includes(entry.ledgerAccountId)) {
            totalExpenses += debit - credit;
          }
          if (assetAccountIds.includes(entry.ledgerAccountId)) {
            totalAssets += debit - credit;
          }
          if (liabilityAccountIds.includes(entry.ledgerAccountId)) {
            totalLiabilities += credit - debit;
          }
        }
      }

      // Get sales data for gross profit calculation
      const salesConditions = [eq(vouchers.companyId, companyId)];
      if (startDate) {
        salesConditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }
      if (endDate) {
        salesConditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }

      const salesData = await db
        .select({
          totalSales: salesItems.totalSales,
          totalCost: salesItems.totalCost,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(...salesConditions))
        .execute();

      const totalSales = salesData.reduce((sum, s) => sum + parseFloat(s.totalSales), 0);
      const totalCost = salesData.reduce((sum, s) => sum + parseFloat(s.totalCost), 0);
      const grossProfit = totalSales - totalCost;

      // Calculate ratios
      const netProfit = totalIncome - totalExpenses;
      const grossProfitMargin = totalSales > 0 ? (grossProfit / totalSales) * 100 : 0;
      const netProfitMargin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;
      const currentRatio = totalLiabilities > 0 ? totalAssets / totalLiabilities : 0;
      const debtToEquity = totalAssets - totalLiabilities > 0 ? totalLiabilities / (totalAssets - totalLiabilities) : 0;

      const _ratiosResult = {
        ratios: {
          grossProfitMargin,
          netProfitMargin,
          currentRatio,
          debtToEquity,
        },
        underlying: {
          totalIncome,
          totalExpenses,
          totalSales,
          totalCost,
          grossProfit,
          netProfit,
          totalAssets,
          totalLiabilities,
          totalEquity: totalAssets - totalLiabilities,
        },
        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
        },
      };
      _setCached(_ratiosCacheKey, _ratiosResult);
      res.json(_ratiosResult);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Opening Stock Summary Report - shows stock groups with opening/closing balances
  app.get("/api/reports/opening-stock-summary", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { locationId, stockGroupId } = req.query;

      // Get all stock groups for the company
      const allStockGroups = await storage.getAllStockGroups(companyId);

      // Get all stock items for the company
      const allStockItems = await storage.getAllStockItems(companyId);

      // Get inventory data with optional location filter
      // IMPORTANT: Use innerJoin + active=true to exclude inventory from deleted/inactive locations
      let inventoryData;
      if (locationId && locationId !== "all") {
        inventoryData = await db
          .select({
            stockItemId: inventory.stockItemId,
            quantity: inventory.quantity,
            averageRate: inventory.averageRate,
            locationId: inventory.locationId,
            locationName: locations.name,
          })
          .from(inventory)
          .innerJoin(locations, eq(inventory.locationId, locations.id))
          .where(
            and(
              eq(inventory.companyId, companyId),
              eq(inventory.locationId, parseInt(locationId as string)),
              eq(locations.active, true)
            )
          )
          .execute();
      } else {
        inventoryData = await db
          .select({
            stockItemId: inventory.stockItemId,
            quantity: inventory.quantity,
            averageRate: inventory.averageRate,
            locationId: inventory.locationId,
            locationName: locations.name,
          })
          .from(inventory)
          .innerJoin(locations, eq(inventory.locationId, locations.id))
          .where(and(eq(inventory.companyId, companyId), eq(locations.active, true)))
          .execute();
      }

      // Create a map of stock item ID to inventory aggregated across locations
      // Calculate value dynamically as qty * averageRate
      const inventoryByItem = new Map<number, { quantity: number; totalValue: number }>();
      for (const inv of inventoryData) {
        const qty = parseFloat(inv.quantity) || 0;
        const rate = parseFloat(inv.averageRate) || 0;
        const val = qty * rate;

        if (inventoryByItem.has(inv.stockItemId)) {
          const existing = inventoryByItem.get(inv.stockItemId)!;
          existing.quantity += qty;
          existing.totalValue += val;
        } else {
          inventoryByItem.set(inv.stockItemId, {
            quantity: qty,
            totalValue: val,
          });
        }
      }

      // Build stock groups summary
      const stockGroupSummary = allStockGroups
        .map((group) => {
          // Get items in this group
          const groupItems = allStockItems.filter((item) => item.stockGroupId === group.id);

          // Calculate opening balance from stock items
          let openingQty = 0;
          let openingValue = 0;

          // Calculate closing balance from inventory
          let closingQty = 0;
          let closingValue = 0;

          for (const item of groupItems) {
            // Opening balance from stock item master data
            const itemOpeningQty = parseFloat(item.openingQty || "0");
            const itemOpeningValue = parseFloat(item.openingValue || "0");
            openingQty += itemOpeningQty;
            openingValue += itemOpeningValue;

            // Closing balance from current inventory
            const inv = inventoryByItem.get(item.id);
            if (inv) {
              closingQty += inv.quantity;
              closingValue += inv.totalValue;
            }
          }

          return {
            id: group.id,
            code: group.code,
            name: group.name,
            opening: {
              quantity: openingQty,
              rate: openingQty > 0 ? openingValue / openingQty : 0,
              value: openingValue,
            },
            closing: {
              quantity: closingQty,
              rate: closingQty > 0 ? closingValue / closingQty : 0,
              value: closingValue,
            },
            itemCount: groupItems.length,
          };
        })
        .filter((g) => g.opening.quantity > 0 || g.closing.quantity > 0);

      // Calculate grand totals
      const grandTotal = {
        opening: {
          quantity: stockGroupSummary.reduce((sum, g) => sum + g.opening.quantity, 0),
          value: stockGroupSummary.reduce((sum, g) => sum + g.opening.value, 0),
        },
        closing: {
          quantity: stockGroupSummary.reduce((sum, g) => sum + g.closing.quantity, 0),
          value: stockGroupSummary.reduce((sum, g) => sum + g.closing.value, 0),
        },
      };

      res.json({
        stockGroups: stockGroupSummary,
        grandTotal,
        filters: {
          locationId: locationId || null,
        },
        notes: {
          opening: "Opening balances are from stock item master data (not location-specific)",
          closing:
            locationId && locationId !== "all"
              ? "Closing balances are filtered by the selected location"
              : "Closing balances are aggregated across all locations",
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get stock items for a specific stock group (drill-down)
  app.get("/api/reports/opening-stock-summary/:stockGroupId/items", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { stockGroupId } = req.params;
      const { locationId } = req.query;

      // Get stock items in this group
      const groupItems = await db
        .select()
        .from(stockItems)
        .where(and(eq(stockItems.companyId, companyId), eq(stockItems.stockGroupId, parseInt(stockGroupId))))
        .execute();

      // Get inventory data for these items
      // IMPORTANT: Use innerJoin + active=true to exclude inventory from deleted/inactive locations
      const itemIds = groupItems.map((i) => i.id);

      let inventoryData: any[] = [];
      if (itemIds.length > 0) {
        const conditions = [
          eq(inventory.companyId, companyId),
          inArray(inventory.stockItemId, itemIds),
          eq(locations.active, true),
        ];
        if (locationId && locationId !== "all") {
          conditions.push(eq(inventory.locationId, parseInt(locationId as string)));
        }

        inventoryData = await db
          .select({
            stockItemId: inventory.stockItemId,
            quantity: inventory.quantity,
            averageRate: inventory.averageRate,
          })
          .from(inventory)
          .innerJoin(locations, eq(inventory.locationId, locations.id))
          .where(and(...conditions))
          .execute();
      }

      // Create inventory map aggregated by item
      // Calculate value dynamically as qty * averageRate
      const inventoryByItem = new Map<number, { quantity: number; totalValue: number }>();
      for (const inv of inventoryData) {
        const qty = parseFloat(inv.quantity) || 0;
        const rate = parseFloat(inv.averageRate) || 0;
        const val = qty * rate;

        if (inventoryByItem.has(inv.stockItemId)) {
          const existing = inventoryByItem.get(inv.stockItemId)!;
          existing.quantity += qty;
          existing.totalValue += val;
        } else {
          inventoryByItem.set(inv.stockItemId, {
            quantity: qty,
            totalValue: val,
          });
        }
      }

      // Build items with opening and closing balances
      const items = groupItems
        .map((item) => {
          const openingQty = parseFloat(item.openingQty || "0");
          const openingRate = parseFloat(item.openingRate || "0");
          const openingValue = parseFloat(item.openingValue || "0");

          const inv = inventoryByItem.get(item.id);
          const closingQty = inv?.quantity || 0;
          const closingValue = inv?.totalValue || 0;
          const closingRate = closingQty > 0 ? closingValue / closingQty : 0;

          return {
            id: item.id,
            code: item.code,
            name: item.name,
            uom: item.uom,
            opening: {
              quantity: openingQty,
              rate: openingRate,
              value: openingValue,
            },
            closing: {
              quantity: closingQty,
              rate: closingRate,
              value: closingValue,
            },
          };
        })
        .filter((i) => i.opening.quantity > 0 || i.closing.quantity > 0);

      // Calculate totals
      const grandTotal = {
        opening: {
          quantity: items.reduce((sum, i) => sum + i.opening.quantity, 0),
          value: items.reduce((sum, i) => sum + i.opening.value, 0),
        },
        closing: {
          quantity: items.reduce((sum, i) => sum + i.closing.quantity, 0),
          value: items.reduce((sum, i) => sum + i.closing.value, 0),
        },
      };

      // Get stock group info
      const stockGroup = await storage.getStockGroupById(parseInt(stockGroupId), companyId);

      res.json({
        items,
        grandTotal,
        stockGroup: stockGroup
          ? {
              id: stockGroup.id,
              code: stockGroup.code,
              name: stockGroup.name,
            }
          : null,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Debug endpoint: Check raw inventory records for a specific stock item
}
