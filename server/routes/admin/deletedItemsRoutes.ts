import { getClientDate } from "../../lib/dateUtils";
import type { Express } from "express";
import { db, pool } from "../../db";
import { storage } from "../../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../../auth";
import { sqlArray } from "../../lib/sqlArray";
import {
  upload,
  logAudit,
  getCurrentExchangeRate,
  calculateHistoricalLocationInventory,
  syncEmployeeBalancesFromEntries,
} from "../_helpers";
import {
  factoryCategories,
  factoryBaleProducts,
  factoryContainers,
  factoryRawStock,
  factoryRawMaterialAdjustments,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryBales,
  customerProformas,
  customerProformaLines,
  customerOrders,
  customerOrderLines,
  customerOrderBales,
  customerOrderCharges,
  proformaStockReservations,
  inventory,
  stockItems,
  stockGroups,
  stockItemCodeAliases,
  stockItemLocationPrices,
  stockTransferVouchers,
  stockTransferItems,
  stockTransferRevisionItems,
  stockGroupLocationArchiveItems,
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
  fileFolders,
  spreadsheets,
  liveSpreadsheets,
  agentAccounts,
  insertAgentAccountSchema,
  freightAccounts,
  snapshotPinnedAccounts,
  salaryAdvances,
  salaryAdvanceDeductions,
  insertSalaryAdvanceSchema,
  insertSalaryAdvanceDeductionSchema,
  employeeGroupMembers,
  employeeBaleRates,
  employeeBalePctRates,
  erpWorkerDocs,
  erpPayrollRunItems,
  chatMessages,
  propertyPayments,
  factoryTransporterTransactions,
  systemSettings,
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
import { classifyNetPositionAccounts, getAccountNetBalance } from "../../netPositionHelper";
import path from "path";
import fs from "fs";

export function registerDeletedItemsRoutes(app: Express) {
  app.get("/api/orphaned-records", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Find vouchers that have a locationId but the location is deleted or no longer exists
      const orphanedVouchers = await db
        .select({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          locationId: vouchers.locationId,
          locationName: vouchers.locationName,
          totalAmount: vouchers.totalAmount,
          description: vouchers.description,
          createdAt: vouchers.createdAt,
        })
        .from(vouchers)
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            sql`${vouchers.locationId} IS NOT NULL`,
            or(sql`${locations.id} IS NULL`, isNotNull(locations.deletedAt))
          )
        )
        .orderBy(sql`${vouchers.createdAt} DESC`);

      // Find unbalanced vouchers (debits != credits)
      const unbalancedVouchers = await db
        .select({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          locationId: vouchers.locationId,
          locationName: vouchers.locationName,
          totalAmount: vouchers.totalAmount,
          description: vouchers.description,
          createdAt: vouchers.createdAt,
          totalDebits: sql<string>`COALESCE(SUM(${voucherEntries.debitAmount}::numeric), 0)::text`,
          totalCredits: sql<string>`COALESCE(SUM(${voucherEntries.creditAmount}::numeric), 0)::text`,
          imbalance: sql<string>`(COALESCE(SUM(${voucherEntries.debitAmount}::numeric), 0) - COALESCE(SUM(${voucherEntries.creditAmount}::numeric), 0))::text`,
        })
        .from(vouchers)
        .leftJoin(voucherEntries, eq(vouchers.id, voucherEntries.voucherId))
        .where(and(eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)))
        .groupBy(vouchers.id)
        .having(
          sql`ABS(COALESCE(SUM(${voucherEntries.debitAmount}::numeric), 0) - COALESCE(SUM(${voucherEntries.creditAmount}::numeric), 0)) > 0.01`
        )
        .orderBy(sql`${vouchers.createdAt} DESC`);

      res.json({
        orphanedVouchers,
        unbalancedVouchers,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/orphaned-records/reassign", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { voucherIds, newLocationId } = req.body;

      if (!voucherIds || !Array.isArray(voucherIds) || voucherIds.length === 0) {
        return res.status(400).json({ message: "No vouchers selected" });
      }

      if (!newLocationId) {
        return res.status(400).json({ message: "New location is required" });
      }

      // Verify the new location exists and belongs to current company
      const newLocation = await storage.getLocationById(newLocationId);
      if (!newLocation || newLocation.companyId !== companyId) {
        return res.status(400).json({ message: "Invalid location" });
      }

      // Verify all vouchers belong to current company
      const vouchersToUpdate = await db
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.companyId, companyId), inArray(vouchers.id, voucherIds)));

      if (vouchersToUpdate.length !== voucherIds.length) {
        return res.status(400).json({ message: "Some vouchers not found or belong to different company" });
      }

      // Update vouchers with new location
      await db
        .update(vouchers)
        .set({
          locationId: newLocationId,
          locationName: newLocation.name,
        })
        .where(inArray(vouchers.id, voucherIds));

      res.json({ success: true, updated: voucherIds.length, newLocationName: newLocation.name });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete all orphaned vouchers permanently
  app.delete("/api/orphaned-records/delete-all", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      console.log("[DELETE-ALL] Starting delete-all for companyId:", companyId);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Find all orphaned vouchers (those with deleted or non-existent locations)
      // Must match the exact same query as GET /api/orphaned-records (NO deletedAt filter!)
      const orphanedVouchers = await db
        .select({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          locationId: vouchers.locationId,
          voucherCompanyId: vouchers.companyId,
        })
        .from(vouchers)
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            sql`${vouchers.locationId} IS NOT NULL`,
            or(sql`${locations.id} IS NULL`, isNotNull(locations.deletedAt))
          )
        );

      console.log("[DELETE-ALL] Found orphaned vouchers:", orphanedVouchers.length);
      if (orphanedVouchers.length > 0) {
        console.log("[DELETE-ALL] First 3 vouchers:", JSON.stringify(orphanedVouchers.slice(0, 3)));
      }

      if (orphanedVouchers.length === 0) {
        // Debug: check what vouchers exist for this company at all
        const allVouchers = await db
          .select({ id: vouchers.id, locationId: vouchers.locationId })
          .from(vouchers)
          .where(eq(vouchers.companyId, companyId))
          .limit(5);
        console.log("[DELETE-ALL] Sample vouchers for company:", JSON.stringify(allVouchers));
        return res.json({
          success: true,
          deleted: 0,
          message: "No orphaned vouchers found",
          debug: { companyId, sampleVouchers: allVouchers.length },
        });
      }

      const orphanedIds = orphanedVouchers.map((v) => v.id);
      console.log("[DELETE-ALL] Deleting from related tables for", orphanedIds.length, "vouchers");

      // Use parameterized array binding (= ANY($1)) instead of string-interpolated IN list
      // to keep the query injection-safe even if the source of the IDs ever changes.
      await db.transaction(async (tx) => {
        const oArr = sqlArray(orphanedIds);
        await tx.execute(sql`DELETE FROM voucher_entries WHERE voucher_id = ANY(${oArr})`);
        await tx.execute(sql`DELETE FROM stock_transfer_vouchers WHERE voucher_id = ANY(${oArr})`);
        await tx.execute(sql`DELETE FROM stock_adjustment_vouchers WHERE voucher_id = ANY(${oArr})`);
        await tx.execute(sql`DELETE FROM sales_items WHERE voucher_id = ANY(${oArr})`);
        await tx.execute(sql`DELETE FROM salary_advances WHERE voucher_id = ANY(${oArr})`);
        await tx.execute(sql`DELETE FROM vouchers WHERE id = ANY(${oArr})`);
      });

      res.json({ success: true, deleted: orphanedIds.length });
    } catch (error: any) {
      console.error("Error deleting orphaned vouchers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Item Monthly Summary - Get aggregated monthly data for a stock item
  app.get("/api/location-summary", requireAuth, async (req, res) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.session.currentCompanyId;
      const locationIds = req.query.locationIds
        ? (req.query.locationIds as string).split(",").map((id) => parseInt(id))
        : [];
      const asOfDate = (req.query.asOfDate as string) || getClientDate(req);

      if (!companyId) {
        return res.status(400).json({ message: "Company ID is required" });
      }

      if (locationIds.length === 0) {
        return res.json({ stockGroups: [], grandTotals: {} });
      }

      // Get all stock groups for the company
      const allStockGroups = await db
        .select()
        .from(stockGroups)
        .where(and(eq(stockGroups.companyId, companyId), eq(stockGroups.active, true)))
        .orderBy(stockGroups.name);

      // Get all stock items with their groups (excluding deleted)
      const allStockItems = await db
        .select()
        .from(stockItems)
        .where(and(eq(stockItems.companyId, companyId), eq(stockItems.active, true), isNull(stockItems.deletedAt)))
        .orderBy(stockItems.name);

      // Get inventory for the selected locations
      const inventoryData = await db
        .select({
          locationId: inventory.locationId,
          stockItemId: inventory.stockItemId,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .where(and(eq(inventory.companyId, companyId), inArray(inventory.locationId, locationIds)));

      // Create lookup maps for inventory data - calculate value dynamically as qty * rate
      const inventoryMap = new Map<string, { quantity: number; rate: number; value: number }>();
      for (const inv of inventoryData) {
        const key = `${inv.locationId}-${inv.stockItemId}`;
        const qty = parseFloat(inv.quantity || "0");
        const rate = parseFloat(inv.averageRate || "0");
        inventoryMap.set(key, {
          quantity: qty,
          rate: rate,
          value: qty * rate,
        });
      }

      // Build response structure with stock groups containing items
      const result: Array<{
        id: number;
        code: string;
        name: string;
        locationData: Record<number, { quantity: number; rate: number; value: number }>;
        items: Array<{
          id: number;
          code: string;
          name: string;
          uom: string;
          locationData: Record<number, { quantity: number; rate: number; value: number }>;
        }>;
      }> = [];

      // Group stock items by their stockGroupId
      const itemsByGroup = new Map<number, typeof allStockItems>();
      const ungroupedItems: typeof allStockItems = [];

      for (const item of allStockItems) {
        if (item.stockGroupId) {
          if (!itemsByGroup.has(item.stockGroupId)) {
            itemsByGroup.set(item.stockGroupId, []);
          }
          itemsByGroup.get(item.stockGroupId)!.push(item);
        } else {
          ungroupedItems.push(item);
        }
      }

      // Build stock groups with their items and location data
      for (const group of allStockGroups) {
        const groupItems = itemsByGroup.get(group.id) || [];

        // Skip groups with no items that have inventory
        const groupHasInventory = groupItems.some((item) =>
          locationIds.some((locId) => {
            const key = `${locId}-${item.id}`;
            const inv = inventoryMap.get(key);
            return inv && inv.quantity !== 0;
          })
        );

        if (!groupHasInventory) continue;

        const groupLocationData: Record<number, { quantity: number; rate: number; value: number }> = {};

        // Initialize location totals for the group
        for (const locId of locationIds) {
          groupLocationData[locId] = { quantity: 0, rate: 0, value: 0 };
        }

        const itemsData: Array<{
          id: number;
          code: string;
          name: string;
          uom: string;
          locationData: Record<number, { quantity: number; rate: number; value: number }>;
        }> = [];

        for (const item of groupItems) {
          const itemLocationData: Record<number, { quantity: number; rate: number; value: number }> = {};
          let itemHasInventory = false;

          for (const locId of locationIds) {
            const key = `${locId}-${item.id}`;
            const inv = inventoryMap.get(key);

            if (inv && inv.quantity !== 0) {
              itemHasInventory = true;
              itemLocationData[locId] = inv;

              // Add to group totals
              groupLocationData[locId].quantity += inv.quantity;
              groupLocationData[locId].value += inv.value;
            } else {
              itemLocationData[locId] = { quantity: 0, rate: 0, value: 0 };
            }
          }

          if (itemHasInventory) {
            itemsData.push({
              id: item.id,
              code: item.code,
              name: item.name,
              uom: item.uom,
              locationData: itemLocationData,
            });
          }
        }

        // Calculate average rate for group totals
        for (const locId of locationIds) {
          if (groupLocationData[locId].quantity > 0) {
            groupLocationData[locId].rate = groupLocationData[locId].value / groupLocationData[locId].quantity;
          }
        }

        result.push({
          id: group.id,
          code: group.code,
          name: group.name,
          locationData: groupLocationData,
          items: itemsData,
        });
      }

      // Handle ungrouped items
      if (ungroupedItems.length > 0) {
        const ungroupedLocationData: Record<number, { quantity: number; rate: number; value: number }> = {};
        for (const locId of locationIds) {
          ungroupedLocationData[locId] = { quantity: 0, rate: 0, value: 0 };
        }

        const ungroupedItemsData: Array<{
          id: number;
          code: string;
          name: string;
          uom: string;
          locationData: Record<number, { quantity: number; rate: number; value: number }>;
        }> = [];

        for (const item of ungroupedItems) {
          const itemLocationData: Record<number, { quantity: number; rate: number; value: number }> = {};
          let itemHasInventory = false;

          for (const locId of locationIds) {
            const key = `${locId}-${item.id}`;
            const inv = inventoryMap.get(key);

            if (inv && inv.quantity !== 0) {
              itemHasInventory = true;
              itemLocationData[locId] = inv;
              ungroupedLocationData[locId].quantity += inv.quantity;
              ungroupedLocationData[locId].value += inv.value;
            } else {
              itemLocationData[locId] = { quantity: 0, rate: 0, value: 0 };
            }
          }

          if (itemHasInventory) {
            ungroupedItemsData.push({
              id: item.id,
              code: item.code,
              name: item.name,
              uom: item.uom,
              locationData: itemLocationData,
            });
          }
        }

        if (ungroupedItemsData.length > 0) {
          for (const locId of locationIds) {
            if (ungroupedLocationData[locId].quantity > 0) {
              ungroupedLocationData[locId].rate =
                ungroupedLocationData[locId].value / ungroupedLocationData[locId].quantity;
            }
          }

          result.push({
            id: 0,
            code: "UNGROUPED",
            name: "Ungrouped Items",
            locationData: ungroupedLocationData,
            items: ungroupedItemsData,
          });
        }
      }

      // Calculate grand totals per location
      const grandTotals: Record<number, { quantity: number; rate: number; value: number }> = {};
      for (const locId of locationIds) {
        grandTotals[locId] = { quantity: 0, rate: 0, value: 0 };
      }

      for (const group of result) {
        for (const locId of locationIds) {
          grandTotals[locId].quantity += group.locationData[locId]?.quantity || 0;
          grandTotals[locId].value += group.locationData[locId]?.value || 0;
        }
      }

      // Calculate average rate for grand totals
      for (const locId of locationIds) {
        if (grandTotals[locId].quantity > 0) {
          grandTotals[locId].rate = grandTotals[locId].value / grandTotals[locId].quantity;
        }
      }

      res.json({
        stockGroups: result,
        grandTotals,
        asOfDate,
      });
    } catch (error: any) {
      console.error("Location summary error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Cleanup endpoint to remove orphaned charge vouchers - admin only (destructive)
  app.post("/api/cleanup/orphaned-charges", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      // Find all CHARGE vouchers
      const chargeVouchers = await db
        .select()
        .from(vouchers)
        .where(sql`${vouchers.voucherNumber} LIKE 'CHARGE-%'`);

      let deletedCount = 0;

      for (const chargeVoucher of chargeVouchers) {
        // Extract container number from voucher number (format: CHARGE-CONT-XXXX-YYYY-...)
        const containerNumber =
          chargeVoucher.voucherNumber.split("-")[1] + "-" + chargeVoucher.voucherNumber.split("-")[2];

        // Check if any POs exist for this container
        const remainingPOs = await db
          .select()
          .from(purchaseOrders)
          .leftJoin(containers, eq(purchaseOrders.containerId, containers.id))
          .where(eq(containers.containerNumber, containerNumber))
          .limit(1);

        // If no POs for this container, delete the charge voucher
        if (remainingPOs.length === 0) {
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, chargeVoucher.id));
          await db.delete(vouchers).where(eq(vouchers.id, chargeVoucher.id));
          deletedCount++;
        }
      }

      res.json({
        message: `Cleaned up ${deletedCount} orphaned charge vouchers`,
        deletedCount,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================
  // DELETED ITEMS MANAGEMENT (Trash/Recycle Bin)
  // ============================================================

  // Get all deleted items (soft-deleted records)
  app.get("/api/deleted-items", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get deleted locations
      const deletedLocations = await db
        .select()
        .from(locations)
        .where(and(eq(locations.companyId, companyId), isNotNull(locations.deletedAt)))
        .orderBy(desc(locations.deletedAt));

      // Get deleted stock items
      const deletedStockItems = await db
        .select()
        .from(stockItems)
        .where(and(eq(stockItems.companyId, companyId), isNotNull(stockItems.deletedAt)))
        .orderBy(desc(stockItems.deletedAt));

      // Get deleted stock groups
      const deletedStockGroups = await db
        .select()
        .from(stockGroups)
        .where(and(eq(stockGroups.companyId, companyId), isNotNull(stockGroups.deletedAt)))
        .orderBy(desc(stockGroups.deletedAt));

      // Get deleted ledger accounts
      const deletedLedgerAccounts = await db
        .select()
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.companyId, companyId), isNotNull(ledgerAccounts.deletedAt)))
        .orderBy(desc(ledgerAccounts.deletedAt));

      // Get deleted employees
      const deletedEmployees = await db
        .select()
        .from(employees)
        .where(and(eq(employees.companyId, companyId), isNotNull(employees.deletedAt)))
        .orderBy(desc(employees.deletedAt));

      // Get deleted customers
      const deletedCustomers = await db
        .select()
        .from(customers)
        .where(and(eq(customers.companyId, companyId), isNotNull(customers.deletedAt)))
        .orderBy(desc(customers.deletedAt));

      // Note: Vouchers are not included in deleted items because they are hard-deleted
      // with inventory reversal due to complex business logic. They cannot be recovered.

      // Get deleted suppliers (suppliers are global, not company-specific)
      const deletedSuppliers = await db
        .select()
        .from(suppliers)
        .where(isNotNull(suppliers.deletedAt))
        .orderBy(desc(suppliers.deletedAt));

      // Get deleted bank accounts
      const deletedBankAccounts = await db
        .select()
        .from(bankAccounts)
        .where(and(eq(bankAccounts.companyId, companyId), isNotNull(bankAccounts.deletedAt)))
        .orderBy(desc(bankAccounts.deletedAt));

      // Get deleted vouchers (payments, receipts, journals, stock transfers, POS sales, etc.)
      const deletedVouchers = await db
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.companyId, companyId), isNotNull(vouchers.deletedAt)))
        .orderBy(desc(vouchers.deletedAt));

      // === Wave 1: Factory + Customer Order soft-deleted records ===
      const [
        deletedFactoryCategories,
        deletedFactoryBaleProducts,
        deletedFactoryContainers,
        deletedFactoryRawStock,
        deletedFactoryRawMaterialAdjustments,
        deletedFactoryMixBatches,
        deletedFactoryBales,
        deletedCustomerProformas,
        deletedCustomerOrders,
      ] = await Promise.all([
        db
          .select()
          .from(factoryCategories)
          .where(and(eq(factoryCategories.companyId, companyId), isNotNull(factoryCategories.deletedAt)))
          .orderBy(desc(factoryCategories.deletedAt)),
        db
          .select()
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), isNotNull(factoryBaleProducts.deletedAt)))
          .orderBy(desc(factoryBaleProducts.deletedAt)),
        db
          .select()
          .from(factoryContainers)
          .where(and(eq(factoryContainers.companyId, companyId), isNotNull(factoryContainers.deletedAt)))
          .orderBy(desc(factoryContainers.deletedAt)),
        db
          .select()
          .from(factoryRawStock)
          .where(and(eq(factoryRawStock.companyId, companyId), isNotNull(factoryRawStock.deletedAt)))
          .orderBy(desc(factoryRawStock.deletedAt)),
        db
          .select()
          .from(factoryRawMaterialAdjustments)
          .where(
            and(
              eq(factoryRawMaterialAdjustments.companyId, companyId),
              isNotNull(factoryRawMaterialAdjustments.deletedAt)
            )
          )
          .orderBy(desc(factoryRawMaterialAdjustments.deletedAt)),
        db
          .select()
          .from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.companyId, companyId), isNotNull(factoryMixBatches.deletedAt)))
          .orderBy(desc(factoryMixBatches.deletedAt)),
        db
          .select()
          .from(factoryBales)
          .where(and(eq(factoryBales.companyId, companyId), isNotNull(factoryBales.deletedAt)))
          .orderBy(desc(factoryBales.deletedAt)),
        db
          .select()
          .from(customerProformas)
          .where(and(eq(customerProformas.companyId, companyId), isNotNull(customerProformas.deletedAt)))
          .orderBy(desc(customerProformas.deletedAt)),
        db
          .select()
          .from(customerOrders)
          .where(and(eq(customerOrders.companyId, companyId), isNotNull(customerOrders.deletedAt)))
          .orderBy(desc(customerOrders.deletedAt)),
      ]);

      // Get orphaned POS sales - vouchers with locationId pointing to deleted or non-existent locations
      // Wrap in try-catch to prevent breaking the entire endpoint if this query fails
      let orphanedPosSales: any[] = [];
      try {
        orphanedPosSales = await db
          .select({
            id: vouchers.id,
            voucherNumber: vouchers.voucherNumber,
            voucherType: vouchers.voucherType,
            date: vouchers.voucherDate,
            totalAmount: vouchers.totalAmount,
            locationId: vouchers.locationId,
            locationName: locations.name,
            locationDeletedAt: locations.deletedAt,
          })
          .from(vouchers)
          .leftJoin(locations, eq(vouchers.locationId, locations.id))
          .where(
            and(
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              isNotNull(vouchers.locationId),
              or(
                isNull(locations.name), // Location doesn't exist (null from left join)
                isNotNull(locations.deletedAt) // Location is soft-deleted
              )
            )
          )
          .orderBy(desc(vouchers.voucherDate));
      } catch (err) {
        console.error("Error fetching orphaned POS sales:", err);
        orphanedPosSales = [];
      }

      res.json({
        locations: deletedLocations.map((l) => ({
          id: l.id,
          type: "location",
          name: l.name,
          code: l.code,
          deletedAt: l.deletedAt,
        })),
        stockItems: deletedStockItems.map((s) => ({
          id: s.id,
          type: "stockItem",
          name: s.name,
          code: s.code,
          deletedAt: s.deletedAt,
        })),
        stockGroups: deletedStockGroups.map((g) => ({
          id: g.id,
          type: "stockGroup",
          name: g.name,
          code: g.code,
          deletedAt: g.deletedAt,
        })),
        ledgerAccounts: deletedLedgerAccounts.map((a) => ({
          id: a.id,
          type: "ledgerAccount",
          name: a.name,
          code: a.code,
          accountType: a.accountType,
          deletedAt: a.deletedAt,
        })),
        employees: deletedEmployees.map((e) => ({
          id: e.id,
          type: "employee",
          name: `${e.firstName} ${e.lastName}`,
          code: e.code,
          deletedAt: e.deletedAt,
        })),
        customers: deletedCustomers.map((c) => ({
          id: c.id,
          type: "customer",
          name: c.legalName,
          code: c.code,
          deletedAt: c.deletedAt,
        })),
        suppliers: deletedSuppliers.map((s) => ({
          id: s.id,
          type: "supplier",
          name: s.legalName,
          code: s.code,
          deletedAt: s.deletedAt,
        })),
        bankAccounts: deletedBankAccounts.map((b) => ({
          id: b.id,
          type: "bankAccount",
          name: b.name,
          code: b.code,
          deletedAt: b.deletedAt,
        })),
        vouchers: deletedVouchers.map((v) => ({
          id: v.id,
          type: "voucher",
          name: v.voucherNumber || "Unknown Voucher",
          code: v.voucherType || "-",
          voucherType: v.voucherType,
          amount: v.totalAmount != null ? Number(v.totalAmount) : 0,
          date: v.voucherDate,
          locationName: v.locationName || null,
          deletedAt: v.deletedAt,
        })),
        orphanedPosSales: (orphanedPosSales || []).map((v) => ({
          id: v.id,
          type: "orphanedPosSale",
          name: v.voucherNumber || "Unknown Voucher",
          code: v.voucherType || "-",
          amount: v.totalAmount != null ? Number(v.totalAmount) : 0,
          date: v.date != null ? v.date : null,
          locationName: v.locationName ? `${v.locationName} (Deleted)` : "(Location Missing)",
          deletedAt: v.locationDeletedAt != null ? v.locationDeletedAt : v.date != null ? v.date : null,
        })),
        // Wave 1
        factoryCategories: deletedFactoryCategories.map((r) => ({
          id: r.id,
          type: "factoryCategory",
          name: r.name,
          code: r.id.toString(),
          deletedAt: r.deletedAt,
        })),
        factoryBaleProducts: deletedFactoryBaleProducts.map((r) => ({
          id: r.id,
          type: "factoryBaleProduct",
          name: r.name,
          code: r.articleCode || r.code || "-",
          deletedAt: r.deletedAt,
        })),
        factoryContainers: deletedFactoryContainers.map((r) => ({
          id: r.id,
          type: "factoryContainer",
          name: r.containerNumber || `Container #${r.id}`,
          code: r.containerNumber || "-",
          deletedAt: r.deletedAt,
        })),
        factoryRawStock: deletedFactoryRawStock.map((r) => ({
          id: r.id,
          type: "factoryRawStock",
          name: `Raw stock receipt #${r.id}`,
          code: String(r.id),
          deletedAt: r.deletedAt,
        })),
        factoryRawMaterialAdjustments: deletedFactoryRawMaterialAdjustments.map((r) => ({
          id: r.id,
          type: "factoryRawMaterialAdjustment",
          name: `${r.type || "Adj"} ${r.kg || 0} kg`,
          code: String(r.id),
          deletedAt: r.deletedAt,
        })),
        factoryMixBatches: deletedFactoryMixBatches.map((r) => ({
          id: r.id,
          type: "factoryMixBatch",
          name: r.batchCode || `Mix batch #${r.id}`,
          code: r.batchCode || "-",
          deletedAt: r.deletedAt,
        })),
        factoryBales: deletedFactoryBales.map((r) => ({
          id: r.id,
          type: "factoryBale",
          name: r.baleCode || r.referenceNumber || `Bale #${r.id}`,
          code: r.baleCode || "-",
          deletedAt: r.deletedAt,
        })),
        customerProformas: deletedCustomerProformas.map((r) => ({
          id: r.id,
          type: "customerProforma",
          name: r.name || `Proforma #${r.id}`,
          code: r.name || "-",
          deletedAt: r.deletedAt,
        })),
        customerOrders: deletedCustomerOrders.map((r) => ({
          id: r.id,
          type: "customerOrder",
          name: r.invoiceNumber || `Order #${r.id}`,
          code: r.invoiceNumber || "DRAFT",
          amount: r.grandTotal != null ? Number(r.grandTotal) : 0,
          deletedAt: r.deletedAt,
        })),
        totalCount:
          deletedLocations.length +
          deletedStockItems.length +
          deletedStockGroups.length +
          deletedVouchers.length +
          deletedLedgerAccounts.length +
          deletedEmployees.length +
          deletedCustomers.length +
          deletedSuppliers.length +
          deletedBankAccounts.length +
          (orphanedPosSales || []).length +
          deletedFactoryCategories.length +
          deletedFactoryBaleProducts.length +
          deletedFactoryContainers.length +
          deletedFactoryRawStock.length +
          deletedFactoryRawMaterialAdjustments.length +
          deletedFactoryMixBatches.length +
          deletedFactoryBales.length +
          deletedCustomerProformas.length +
          deletedCustomerOrders.length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Restore a deleted item
  app.post("/api/deleted-items/:type/:id/restore", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const { type, id } = req.params;
      const itemId = parseInt(id);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      switch (type) {
        case "location":
          await db
            .update(locations)
            .set({ deletedAt: null, active: true })
            .where(and(eq(locations.id, itemId), eq(locations.companyId, companyId)));
          break;
        case "stockItem":
          await db
            .update(stockItems)
            .set({ deletedAt: null, active: true })
            .where(and(eq(stockItems.id, itemId), eq(stockItems.companyId, companyId)));
          break;
        case "stockGroup":
          await db
            .update(stockGroups)
            .set({ deletedAt: null, active: true })
            .where(and(eq(stockGroups.id, itemId), eq(stockGroups.companyId, companyId)));
          break;
        case "ledgerAccount":
          await db
            .update(ledgerAccounts)
            .set({ deletedAt: null, active: true })
            .where(and(eq(ledgerAccounts.id, itemId), eq(ledgerAccounts.companyId, companyId)));
          break;
        case "employee":
          await db
            .update(employees)
            .set({ deletedAt: null, active: true })
            .where(and(eq(employees.id, itemId), eq(employees.companyId, companyId)));
          break;
        case "customer":
          await db
            .update(customers)
            .set({ deletedAt: null, active: true })
            .where(and(eq(customers.id, itemId), eq(customers.companyId, companyId)));
          break;
        case "supplier":
          await db.update(suppliers).set({ deletedAt: null, active: true }).where(eq(suppliers.id, itemId));
          break;
        case "bankAccount":
          await db
            .update(bankAccounts)
            .set({ deletedAt: null, active: true })
            .where(and(eq(bankAccounts.id, itemId), eq(bankAccounts.companyId, companyId)));
          break;
        case "voucher":
          await db
            .update(vouchers)
            .set({ deletedAt: null })
            .where(and(eq(vouchers.id, itemId), eq(vouchers.companyId, companyId)));
          break;
        // === Wave 1 restores ===
        case "factoryCategory":
          await db
            .update(factoryCategories)
            .set({ deletedAt: null, isActive: true, updatedAt: new Date() })
            .where(and(eq(factoryCategories.id, itemId), eq(factoryCategories.companyId, companyId)));
          break;
        case "factoryBaleProduct":
          await db
            .update(factoryBaleProducts)
            .set({ deletedAt: null, active: true, updatedAt: new Date() })
            .where(and(eq(factoryBaleProducts.id, itemId), eq(factoryBaleProducts.companyId, companyId)));
          break;
        case "factoryContainer":
          await db
            .update(factoryContainers)
            .set({ deletedAt: null, updatedAt: new Date() })
            .where(and(eq(factoryContainers.id, itemId), eq(factoryContainers.companyId, companyId)));
          break;
        case "factoryRawStock":
          await db
            .update(factoryRawStock)
            .set({ deletedAt: null })
            .where(and(eq(factoryRawStock.id, itemId), eq(factoryRawStock.companyId, companyId)));
          break;
        case "factoryRawMaterialAdjustment":
          await db
            .update(factoryRawMaterialAdjustments)
            .set({ deletedAt: null })
            .where(
              and(eq(factoryRawMaterialAdjustments.id, itemId), eq(factoryRawMaterialAdjustments.companyId, companyId))
            );
          break;
        case "factoryMixBatch":
          // Restoring must re-apply the usedKg consumption on its sources — the
          // DELETE route (factoryMixBatchRoutes.ts) reverses that consumption on
          // delete, so skipping it here would leave the source stock artificially
          // over-available (double-counted as both free and locked in this batch).
          await db.transaction(async (tx) => {
            // Guard: only restore rows that are actually soft-deleted, so calling
            // restore twice (or on an already-active batch) can't re-apply
            // consumption a second time.
            const [restored] = await tx
              .update(factoryMixBatches)
              .set({ deletedAt: null, updatedAt: new Date() })
              .where(
                and(
                  eq(factoryMixBatches.id, itemId),
                  eq(factoryMixBatches.companyId, companyId),
                  isNotNull(factoryMixBatches.deletedAt)
                )
              )
              .returning({ id: factoryMixBatches.id });
            if (!restored) return;

            const batchSourceRows = await tx
              .select({
                containerId: factoryMixBatchSources.containerId,
                sourceBatchId: factoryMixBatchSources.sourceBatchId,
                weightKg: factoryMixBatchSources.weightKg,
              })
              .from(factoryMixBatchSources)
              .where(eq(factoryMixBatchSources.mixBatchId, itemId));

            for (const src of batchSourceRows) {
              const weight = parseFloat(src.weightKg) || 0;
              if (weight <= 0) continue;
              if (src.containerId) {
                // Scope to companyId too (via a join-equivalent subselect) so a
                // corrupted/cross-tenant containerId can never mutate another
                // company's raw stock.
                await tx
                  .update(factoryRawStock)
                  .set({ usedKg: sql`${factoryRawStock.usedKg} + ${weight}` })
                  .where(and(eq(factoryRawStock.containerId, src.containerId), eq(factoryRawStock.companyId, companyId)));
              } else if (src.sourceBatchId) {
                await tx
                  .update(factoryMixBatches)
                  .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${weight}`, updatedAt: new Date() })
                  .where(
                    and(eq(factoryMixBatches.id, src.sourceBatchId), eq(factoryMixBatches.companyId, companyId))
                  );
              }
            }
          });
          break;
        case "factoryBale":
          // Restore bale to IN_STOCK so it's usable again
          await db
            .update(factoryBales)
            .set({ deletedAt: null, status: "IN_STOCK", updatedAt: new Date() })
            .where(and(eq(factoryBales.id, itemId), eq(factoryBales.companyId, companyId)));
          break;
        case "customerProforma":
          await db
            .update(customerProformas)
            .set({ deletedAt: null, isActive: true, updatedAt: new Date() })
            .where(and(eq(customerProformas.id, itemId), eq(customerProformas.companyId, companyId)));
          break;
        case "customerOrder":
          await db
            .update(customerOrders)
            .set({ deletedAt: null, updatedAt: new Date() })
            .where(and(eq(customerOrders.id, itemId), eq(customerOrders.companyId, companyId)));
          break;
        default:
          return res.status(400).json({ message: "Invalid item type" });
      }

      res.json({ message: `${type} restored successfully` });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Permanently delete an item
  app.delete("/api/deleted-items/:type/:id/permanent", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const { type, id } = req.params;
      const itemId = parseInt(id);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      switch (type) {
        case "location":
          await db.delete(locations).where(and(eq(locations.id, itemId), eq(locations.companyId, companyId)));
          break;
        case "stockItem":
          // Delete all FK-dependent rows before removing the stock item itself
          await db.delete(salesItems).where(eq(salesItems.stockItemId, itemId));
          await db.delete(stockAdjustmentItems).where(eq(stockAdjustmentItems.stockItemId, itemId));
          await db.delete(stockTransferItems).where(eq(stockTransferItems.stockItemId, itemId));
          await db.delete(stockTransferRevisionItems).where(eq(stockTransferRevisionItems.stockItemId, itemId));
          await db.delete(poLineItems).where(eq(poLineItems.stockItemId, itemId));
          await db.delete(containerOffloadItems).where(eq(containerOffloadItems.stockItemId, itemId));
          await db.delete(creditNoteItems).where(eq(creditNoteItems.stockItemId, itemId));
          await db.delete(inventory).where(eq(inventory.stockItemId, itemId));
          await db.delete(wasteDispatchItems).where(eq(wasteDispatchItems.stockItemId, itemId));
          await db.delete(stockGroupLocationArchiveItems).where(eq(stockGroupLocationArchiveItems.stockItemId, itemId));
          await db.delete(stockItemCodeAliases).where(eq(stockItemCodeAliases.stockItemId, itemId));
          await db.delete(stockItemLocationPrices).where(eq(stockItemLocationPrices.stockItemId, itemId));
          await db.delete(stockItems).where(and(eq(stockItems.id, itemId), eq(stockItems.companyId, companyId)));
          break;
        case "stockGroup":
          await db.delete(stockGroups).where(and(eq(stockGroups.id, itemId), eq(stockGroups.companyId, companyId)));
          break;
        case "ledgerAccount":
          await db
            .delete(ledgerAccounts)
            .where(and(eq(ledgerAccounts.id, itemId), eq(ledgerAccounts.companyId, companyId)));
          break;
        case "employee":
          // Delete all FK-dependent rows before removing the employee
          await db.delete(employeeGroupMembers).where(eq(employeeGroupMembers.employeeId, itemId));
          await db.delete(employeeBaleRates).where(eq(employeeBaleRates.employeeId, itemId));
          await db.delete(employeeBalePctRates).where(eq(employeeBalePctRates.employeeId, itemId));
          await db.delete(salaryAdvances).where(eq(salaryAdvances.employeeId, itemId));
          await db.delete(erpWorkerDocs).where(eq(erpWorkerDocs.employeeId, itemId));
          await db.delete(erpPayrollRunItems).where(eq(erpPayrollRunItems.employeeId, itemId));
          // Null-out the optional employee FK on voucher entries (don't delete the vouchers)
          await db.update(voucherEntries).set({ employeeId: null }).where(eq(voucherEntries.employeeId, itemId));
          await db.delete(employees).where(and(eq(employees.id, itemId), eq(employees.companyId, companyId)));
          break;
        case "customer":
          await db.delete(customers).where(and(eq(customers.id, itemId), eq(customers.companyId, companyId)));
          break;
        case "supplier":
          await db.delete(suppliers).where(eq(suppliers.id, itemId));
          break;
        case "bankAccount":
          await db.delete(bankAccounts).where(and(eq(bankAccounts.id, itemId), eq(bankAccounts.companyId, companyId)));
          break;
        case "voucher": {
          // ── Step 1: Null out nullable FKs in tables with onDelete: "restrict" ──
          await db.update(purchaseOrders).set({ voucherId: null }).where(eq(purchaseOrders.voucherId, itemId));
          await db.update(containerSales).set({ voucherId: null }).where(eq(containerSales.voucherId, itemId));
          await db
            .update(interCompanyTransfers)
            .set({ fromVoucherId: null })
            .where(eq(interCompanyTransfers.fromVoucherId, itemId));
          await db
            .update(interCompanyTransfers)
            .set({ toVoucherId: null })
            .where(eq(interCompanyTransfers.toVoucherId, itemId));
          await db.update(salaryAdvances).set({ voucherId: null }).where(eq(salaryAdvances.voucherId, itemId));
          await db
            .update(customerOrderCharges)
            .set({ voucherId: null })
            .where(eq(customerOrderCharges.voucherId, itemId));
          await db.update(wasteDispatches).set({ voucherId: null }).where(eq(wasteDispatches.voucherId, itemId));
          await db.update(propertyPayments).set({ voucherId: null }).where(eq(propertyPayments.voucherId, itemId));
          await db
            .update(factoryTransporterTransactions)
            .set({ voucherId: null })
            .where(eq(factoryTransporterTransactions.voucherId, itemId));

          // ── Step 2: Delete rows with notNull FKs ──────────────────────────
          // stock_transfer_vouchers.voucherId is notNull — delete its items first
          const stvRows = await db
            .select({ id: stockTransferVouchers.id })
            .from(stockTransferVouchers)
            .where(eq(stockTransferVouchers.voucherId, itemId));
          if (stvRows.length > 0) {
            const stvIds = stvRows.map((r) => r.id);
            // transferId is the correct FK column on stock_transfer_items
            await db.delete(stockTransferItems).where(inArray(stockTransferItems.transferId, stvIds));
            await db.delete(stockTransferVouchers).where(inArray(stockTransferVouchers.id, stvIds));
          }
          // fiscal_period_closures.closingVoucherId is notNull — delete the closure row if it exists
          try {
            await db.delete(fiscalPeriodClosures).where(eq(fiscalPeriodClosures.closingVoucherId, itemId));
          } catch {
            // If no matching row or table schema differs in production, continue safely
          }

          // ── Step 3: Delete voucher entries (also cascade, but be explicit) ─
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, itemId));

          // ── Step 4: Delete the voucher itself ────────────────────────────
          await db.delete(vouchers).where(and(eq(vouchers.id, itemId), eq(vouchers.companyId, companyId)));
          break;
        }
        case "orphanedPosSale":
          // Permanently delete an orphaned voucher and its entries
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, itemId));
          await db.delete(vouchers).where(and(eq(vouchers.id, itemId), eq(vouchers.companyId, companyId)));
          break;
        // === Wave 1 permanent deletes ===
        // Note: these only remove the row + immediate dependent rows. They do NOT
        // attempt to reverse historical financial vouchers/daybook entries — that
        // would require running the original cascade logic and is left for a future
        // wave. For full financial unwind, perform a manual reversal voucher.
        case "factoryCategory":
          await db
            .delete(factoryCategories)
            .where(and(eq(factoryCategories.id, itemId), eq(factoryCategories.companyId, companyId)));
          break;
        case "factoryBaleProduct":
          await db
            .delete(factoryBaleProducts)
            .where(and(eq(factoryBaleProducts.id, itemId), eq(factoryBaleProducts.companyId, companyId)));
          break;
        case "factoryContainer":
          await db
            .delete(factoryContainers)
            .where(and(eq(factoryContainers.id, itemId), eq(factoryContainers.companyId, companyId)));
          break;
        case "factoryRawStock":
          await db
            .delete(factoryRawStock)
            .where(and(eq(factoryRawStock.id, itemId), eq(factoryRawStock.companyId, companyId)));
          break;
        case "factoryRawMaterialAdjustment":
          await db
            .delete(factoryRawMaterialAdjustments)
            .where(
              and(eq(factoryRawMaterialAdjustments.id, itemId), eq(factoryRawMaterialAdjustments.companyId, companyId))
            );
          break;
        case "factoryMixBatch":
          await db
            .delete(factoryMixBatches)
            .where(and(eq(factoryMixBatches.id, itemId), eq(factoryMixBatches.companyId, companyId)));
          break;
        case "factoryBale":
          await db.delete(factoryBales).where(and(eq(factoryBales.id, itemId), eq(factoryBales.companyId, companyId)));
          break;
        case "customerProforma":
          await db.delete(customerProformaLines).where(eq(customerProformaLines.proformaId, itemId));
          await db.delete(proformaStockReservations).where(eq(proformaStockReservations.proformaId, itemId));
          await db
            .delete(customerProformas)
            .where(and(eq(customerProformas.id, itemId), eq(customerProformas.companyId, companyId)));
          break;
        case "customerOrder":
          await db.delete(customerOrderBales).where(eq(customerOrderBales.orderId, itemId));
          await db.delete(customerOrderLines).where(eq(customerOrderLines.orderId, itemId));
          await db.delete(customerOrderCharges).where(eq(customerOrderCharges.orderId, itemId));
          await db
            .delete(customerOrders)
            .where(and(eq(customerOrders.id, itemId), eq(customerOrders.companyId, companyId)));
          break;
        default:
          return res.status(400).json({ message: "Invalid item type" });
      }

      res.json({ message: `${type} permanently deleted` });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============ AI Chatbot API Endpoints ============

  // Check if chatbot is enabled for current user
}
