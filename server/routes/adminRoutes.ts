import { getClientDate } from "../lib/dateUtils";
import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { sqlArray } from "../lib/sqlArray";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory, syncEmployeeBalancesFromEntries } from "./_helpers";
import {
  factoryCategories, factoryBaleProducts, factoryContainers, factoryRawStock,
  factoryRawMaterialAdjustments, factoryMixBatches, factoryBales,
  customerProformas, customerProformaLines, customerOrders, customerOrderLines,
  customerOrderBales, customerOrderCharges, proformaStockReservations,
  inventory, stockItems, stockGroups, stockItemCodeAliases,
  stockItemLocationPrices, stockTransferVouchers, stockTransferItems,
  stockTransferRevisionItems, stockGroupLocationArchiveItems,
  stockAdjustmentVouchers, stockAdjustmentItems,
  containers, containerOffloads, containerOffloadItems, containerSales,
  containerCharges, containerTrackingImportRowSchema, updateContainerTrackingSchema,
  bankAccounts, fixedAssets, insertBankAccountSchema, insertFixedAssetSchema,
  insertStockGroupSchema, insertStockItemSchema, insertStockItemCodeAliasSchema,
  insertContainerSchema, offloadRequestSchema,
  purchaseOrders, poLineItems, insertContainerSaleSchema,
  vouchers, voucherEntries, salesItems, insertVoucherSchema, insertVoucherEntrySchema,
  insertSalesItemSchema,
  suppliers, customers, customerBalances, locations, employees, userLocations,
  auditLog, interCompanyTransfers, insertInterCompanyTransferSchema,
  ledgerAccounts, insertLedgerAccountSchema, 
  companies, users, userCompanyRoles, companySettings,
  FEATURE_KEYS, fiscalPeriodClosures,
  wasteDispatches, wasteDispatchItems, insertWasteDispatchSchema,
  bales, baleProducts, baleProductCategories, baleTransfers,
  insertBaleSchema, insertBaleTransferSchema,
  
  dashboardCashAccounts, dashboardPayableAccounts, dashboardAccountSelections,
  insertDashboardCashAccountSchema, insertDashboardPayableAccountSchema,
  insertDashboardAccountSelectionSchema,
  creditNoteItems, 
  pendingBarcodes, insertPendingBarcodeSchema,
  storedFiles, fileFolders, spreadsheets, liveSpreadsheets,
  agentAccounts, insertAgentAccountSchema,
  freightAccounts,
  snapshotPinnedAccounts,
  salaryAdvances, salaryAdvanceDeductions,
  insertSalaryAdvanceSchema, insertSalaryAdvanceDeductionSchema,
  employeeGroupMembers, employeeBaleRates, employeeBalePctRates,
  erpWorkerDocs, erpPayrollRunItems,
  chatMessages,
  propertyPayments,
  factoryTransporterTransactions,
  
  systemSettings,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../netPositionHelper";
import path from "path";
import fs from "fs";

export function registerAdminRoutes(app: Express) {
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
            or(
              sql`${locations.id} IS NULL`,
              isNotNull(locations.deletedAt)
            )
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
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        )
        .groupBy(vouchers.id)
        .having(sql`ABS(COALESCE(SUM(${voucherEntries.debitAmount}::numeric), 0) - COALESCE(SUM(${voucherEntries.creditAmount}::numeric), 0)) > 0.01`)
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
        .where(
          and(
            eq(vouchers.companyId, companyId),
            inArray(vouchers.id, voucherIds)
          )
        );
      
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
        .select({ id: vouchers.id, voucherNumber: vouchers.voucherNumber, locationId: vouchers.locationId, voucherCompanyId: vouchers.companyId })
        .from(vouchers)
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            sql`${vouchers.locationId} IS NOT NULL`,
            or(
              sql`${locations.id} IS NULL`,
              isNotNull(locations.deletedAt)
            )
          )
        );
      
      console.log("[DELETE-ALL] Found orphaned vouchers:", orphanedVouchers.length);
      if (orphanedVouchers.length > 0) {
        console.log("[DELETE-ALL] First 3 vouchers:", JSON.stringify(orphanedVouchers.slice(0, 3)));
      }
      
      if (orphanedVouchers.length === 0) {
        // Debug: check what vouchers exist for this company at all
        const allVouchers = await db.select({ id: vouchers.id, locationId: vouchers.locationId }).from(vouchers).where(eq(vouchers.companyId, companyId)).limit(5);
        console.log("[DELETE-ALL] Sample vouchers for company:", JSON.stringify(allVouchers));
        return res.json({ success: true, deleted: 0, message: "No orphaned vouchers found", debug: { companyId, sampleVouchers: allVouchers.length } });
      }
      
      const orphanedIds = orphanedVouchers.map(v => v.id);
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
      const locationIds = req.query.locationIds ? (req.query.locationIds as string).split(',').map(id => parseInt(id)) : [];
      const asOfDate = req.query.asOfDate as string || getClientDate(req);
      
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
        .where(
          and(
            eq(inventory.companyId, companyId),
            inArray(inventory.locationId, locationIds)
          )
        );
      
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
        const groupHasInventory = groupItems.some(item => 
          locationIds.some(locId => {
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
              ungroupedLocationData[locId].rate = ungroupedLocationData[locId].value / ungroupedLocationData[locId].quantity;
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
      console.error('Location summary error:', error);
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
        const containerNumber = chargeVoucher.voucherNumber.split('-')[1] + '-' + chargeVoucher.voucherNumber.split('-')[2];
        
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
        .where(and(
          eq(locations.companyId, companyId),
          isNotNull(locations.deletedAt)
        ))
        .orderBy(desc(locations.deletedAt));

      // Get deleted stock items
      const deletedStockItems = await db
        .select()
        .from(stockItems)
        .where(and(
          eq(stockItems.companyId, companyId),
          isNotNull(stockItems.deletedAt)
        ))
        .orderBy(desc(stockItems.deletedAt));

      // Get deleted stock groups
      const deletedStockGroups = await db
        .select()
        .from(stockGroups)
        .where(and(
          eq(stockGroups.companyId, companyId),
          isNotNull(stockGroups.deletedAt)
        ))
        .orderBy(desc(stockGroups.deletedAt));

      // Get deleted ledger accounts
      const deletedLedgerAccounts = await db
        .select()
        .from(ledgerAccounts)
        .where(and(
          eq(ledgerAccounts.companyId, companyId),
          isNotNull(ledgerAccounts.deletedAt)
        ))
        .orderBy(desc(ledgerAccounts.deletedAt));

      // Get deleted employees
      const deletedEmployees = await db
        .select()
        .from(employees)
        .where(and(
          eq(employees.companyId, companyId),
          isNotNull(employees.deletedAt)
        ))
        .orderBy(desc(employees.deletedAt));

      // Get deleted customers
      const deletedCustomers = await db
        .select()
        .from(customers)
        .where(and(
          eq(customers.companyId, companyId),
          isNotNull(customers.deletedAt)
        ))
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
        .where(and(
          eq(bankAccounts.companyId, companyId),
          isNotNull(bankAccounts.deletedAt)
        ))
        .orderBy(desc(bankAccounts.deletedAt));

      // Get deleted vouchers (payments, receipts, journals, stock transfers, POS sales, etc.)
      const deletedVouchers = await db
        .select()
        .from(vouchers)
        .where(and(
          eq(vouchers.companyId, companyId),
          isNotNull(vouchers.deletedAt)
        ))
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
        db.select().from(factoryCategories).where(and(eq(factoryCategories.companyId, companyId), isNotNull(factoryCategories.deletedAt))).orderBy(desc(factoryCategories.deletedAt)),
        db.select().from(factoryBaleProducts).where(and(eq(factoryBaleProducts.companyId, companyId), isNotNull(factoryBaleProducts.deletedAt))).orderBy(desc(factoryBaleProducts.deletedAt)),
        db.select().from(factoryContainers).where(and(eq(factoryContainers.companyId, companyId), isNotNull(factoryContainers.deletedAt))).orderBy(desc(factoryContainers.deletedAt)),
        db.select().from(factoryRawStock).where(and(eq(factoryRawStock.companyId, companyId), isNotNull(factoryRawStock.deletedAt))).orderBy(desc(factoryRawStock.deletedAt)),
        db.select().from(factoryRawMaterialAdjustments).where(and(eq(factoryRawMaterialAdjustments.companyId, companyId), isNotNull(factoryRawMaterialAdjustments.deletedAt))).orderBy(desc(factoryRawMaterialAdjustments.deletedAt)),
        db.select().from(factoryMixBatches).where(and(eq(factoryMixBatches.companyId, companyId), isNotNull(factoryMixBatches.deletedAt))).orderBy(desc(factoryMixBatches.deletedAt)),
        db.select().from(factoryBales).where(and(eq(factoryBales.companyId, companyId), isNotNull(factoryBales.deletedAt))).orderBy(desc(factoryBales.deletedAt)),
        db.select().from(customerProformas).where(and(eq(customerProformas.companyId, companyId), isNotNull(customerProformas.deletedAt))).orderBy(desc(customerProformas.deletedAt)),
        db.select().from(customerOrders).where(and(eq(customerOrders.companyId, companyId), isNotNull(customerOrders.deletedAt))).orderBy(desc(customerOrders.deletedAt)),
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
        locations: deletedLocations.map(l => ({
          id: l.id,
          type: "location",
          name: l.name,
          code: l.code,
          deletedAt: l.deletedAt,
        })),
        stockItems: deletedStockItems.map(s => ({
          id: s.id,
          type: "stockItem",
          name: s.name,
          code: s.code,
          deletedAt: s.deletedAt,
        })),
        stockGroups: deletedStockGroups.map(g => ({
          id: g.id,
          type: "stockGroup",
          name: g.name,
          code: g.code,
          deletedAt: g.deletedAt,
        })),
        ledgerAccounts: deletedLedgerAccounts.map(a => ({
          id: a.id,
          type: "ledgerAccount",
          name: a.name,
          code: a.code,
          accountType: a.accountType,
          deletedAt: a.deletedAt,
        })),
        employees: deletedEmployees.map(e => ({
          id: e.id,
          type: "employee",
          name: `${e.firstName} ${e.lastName}`,
          code: e.code,
          deletedAt: e.deletedAt,
        })),
        customers: deletedCustomers.map(c => ({
          id: c.id,
          type: "customer",
          name: c.legalName,
          code: c.code,
          deletedAt: c.deletedAt,
        })),
        suppliers: deletedSuppliers.map(s => ({
          id: s.id,
          type: "supplier",
          name: s.legalName,
          code: s.code,
          deletedAt: s.deletedAt,
        })),
        bankAccounts: deletedBankAccounts.map(b => ({
          id: b.id,
          type: "bankAccount",
          name: b.name,
          code: b.code,
          deletedAt: b.deletedAt,
        })),
        vouchers: deletedVouchers.map(v => ({
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
        orphanedPosSales: (orphanedPosSales || []).map(v => ({
          id: v.id,
          type: "orphanedPosSale",
          name: v.voucherNumber || "Unknown Voucher",
          code: v.voucherType || "-",
          amount: v.totalAmount != null ? Number(v.totalAmount) : 0,
          date: v.date != null ? v.date : null,
          locationName: v.locationName ? `${v.locationName} (Deleted)` : "(Location Missing)",
          deletedAt: v.locationDeletedAt != null ? v.locationDeletedAt : (v.date != null ? v.date : null),
        })),
        // Wave 1
        factoryCategories: deletedFactoryCategories.map(r => ({ id: r.id, type: "factoryCategory", name: r.name, code: r.id.toString(), deletedAt: r.deletedAt })),
        factoryBaleProducts: deletedFactoryBaleProducts.map(r => ({ id: r.id, type: "factoryBaleProduct", name: r.name, code: r.articleCode || r.code || "-", deletedAt: r.deletedAt })),
        factoryContainers: deletedFactoryContainers.map(r => ({ id: r.id, type: "factoryContainer", name: r.containerNumber || `Container #${r.id}`, code: r.containerNumber || "-", deletedAt: r.deletedAt })),
        factoryRawStock: deletedFactoryRawStock.map(r => ({ id: r.id, type: "factoryRawStock", name: `Raw stock receipt #${r.id}`, code: String(r.id), deletedAt: r.deletedAt })),
        factoryRawMaterialAdjustments: deletedFactoryRawMaterialAdjustments.map(r => ({ id: r.id, type: "factoryRawMaterialAdjustment", name: `${r.type || "Adj"} ${r.kg || 0} kg`, code: String(r.id), deletedAt: r.deletedAt })),
        factoryMixBatches: deletedFactoryMixBatches.map(r => ({ id: r.id, type: "factoryMixBatch", name: r.batchCode || `Mix batch #${r.id}`, code: r.batchCode || "-", deletedAt: r.deletedAt })),
        factoryBales: deletedFactoryBales.map(r => ({ id: r.id, type: "factoryBale", name: r.baleCode || r.referenceNumber || `Bale #${r.id}`, code: r.baleCode || "-", deletedAt: r.deletedAt })),
        customerProformas: deletedCustomerProformas.map(r => ({ id: r.id, type: "customerProforma", name: r.name || `Proforma #${r.id}`, code: r.name || "-", deletedAt: r.deletedAt })),
        customerOrders: deletedCustomerOrders.map(r => ({ id: r.id, type: "customerOrder", name: r.invoiceNumber || `Order #${r.id}`, code: r.invoiceNumber || "DRAFT", amount: r.grandTotal != null ? Number(r.grandTotal) : 0, deletedAt: r.deletedAt })),
        totalCount: deletedLocations.length + deletedStockItems.length + deletedStockGroups.length + deletedVouchers.length +
          deletedLedgerAccounts.length + deletedEmployees.length + deletedCustomers.length +
          deletedSuppliers.length + deletedBankAccounts.length + (orphanedPosSales || []).length +
          deletedFactoryCategories.length + deletedFactoryBaleProducts.length + deletedFactoryContainers.length +
          deletedFactoryRawStock.length + deletedFactoryRawMaterialAdjustments.length + deletedFactoryMixBatches.length +
          deletedFactoryBales.length + deletedCustomerProformas.length + deletedCustomerOrders.length,
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
          await db.update(locations)
            .set({ deletedAt: null, active: true })
            .where(and(eq(locations.id, itemId), eq(locations.companyId, companyId)));
          break;
        case "stockItem":
          await db.update(stockItems)
            .set({ deletedAt: null, active: true })
            .where(and(eq(stockItems.id, itemId), eq(stockItems.companyId, companyId)));
          break;
        case "stockGroup":
          await db.update(stockGroups)
            .set({ deletedAt: null, active: true })
            .where(and(eq(stockGroups.id, itemId), eq(stockGroups.companyId, companyId)));
          break;
        case "ledgerAccount":
          await db.update(ledgerAccounts)
            .set({ deletedAt: null, active: true })
            .where(and(eq(ledgerAccounts.id, itemId), eq(ledgerAccounts.companyId, companyId)));
          break;
        case "employee":
          await db.update(employees)
            .set({ deletedAt: null, active: true })
            .where(and(eq(employees.id, itemId), eq(employees.companyId, companyId)));
          break;
        case "customer":
          await db.update(customers)
            .set({ deletedAt: null, active: true })
            .where(and(eq(customers.id, itemId), eq(customers.companyId, companyId)));
          break;
        case "supplier":
          await db.update(suppliers)
            .set({ deletedAt: null, active: true })
            .where(eq(suppliers.id, itemId));
          break;
        case "bankAccount":
          await db.update(bankAccounts)
            .set({ deletedAt: null, active: true })
            .where(and(eq(bankAccounts.id, itemId), eq(bankAccounts.companyId, companyId)));
          break;
        case "voucher":
          await db.update(vouchers)
            .set({ deletedAt: null })
            .where(and(eq(vouchers.id, itemId), eq(vouchers.companyId, companyId)));
          break;
        // === Wave 1 restores ===
        case "factoryCategory":
          await db.update(factoryCategories)
            .set({ deletedAt: null, isActive: true, updatedAt: new Date() })
            .where(and(eq(factoryCategories.id, itemId), eq(factoryCategories.companyId, companyId)));
          break;
        case "factoryBaleProduct":
          await db.update(factoryBaleProducts)
            .set({ deletedAt: null, active: true, updatedAt: new Date() })
            .where(and(eq(factoryBaleProducts.id, itemId), eq(factoryBaleProducts.companyId, companyId)));
          break;
        case "factoryContainer":
          await db.update(factoryContainers)
            .set({ deletedAt: null, updatedAt: new Date() })
            .where(and(eq(factoryContainers.id, itemId), eq(factoryContainers.companyId, companyId)));
          break;
        case "factoryRawStock":
          await db.update(factoryRawStock)
            .set({ deletedAt: null })
            .where(and(eq(factoryRawStock.id, itemId), eq(factoryRawStock.companyId, companyId)));
          break;
        case "factoryRawMaterialAdjustment":
          await db.update(factoryRawMaterialAdjustments)
            .set({ deletedAt: null })
            .where(and(eq(factoryRawMaterialAdjustments.id, itemId), eq(factoryRawMaterialAdjustments.companyId, companyId)));
          break;
        case "factoryMixBatch":
          await db.update(factoryMixBatches)
            .set({ deletedAt: null, updatedAt: new Date() })
            .where(and(eq(factoryMixBatches.id, itemId), eq(factoryMixBatches.companyId, companyId)));
          break;
        case "factoryBale":
          // Restore bale to IN_STOCK so it's usable again
          await db.update(factoryBales)
            .set({ deletedAt: null, status: "IN_STOCK", updatedAt: new Date() })
            .where(and(eq(factoryBales.id, itemId), eq(factoryBales.companyId, companyId)));
          break;
        case "customerProforma":
          await db.update(customerProformas)
            .set({ deletedAt: null, isActive: true, updatedAt: new Date() })
            .where(and(eq(customerProformas.id, itemId), eq(customerProformas.companyId, companyId)));
          break;
        case "customerOrder":
          await db.update(customerOrders)
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
          await db.delete(locations)
            .where(and(eq(locations.id, itemId), eq(locations.companyId, companyId)));
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
          await db.delete(stockItems)
            .where(and(eq(stockItems.id, itemId), eq(stockItems.companyId, companyId)));
          break;
        case "stockGroup":
          await db.delete(stockGroups)
            .where(and(eq(stockGroups.id, itemId), eq(stockGroups.companyId, companyId)));
          break;
        case "ledgerAccount":
          await db.delete(ledgerAccounts)
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
          await db.update(voucherEntries)
            .set({ employeeId: null })
            .where(eq(voucherEntries.employeeId, itemId));
          await db.delete(employees)
            .where(and(eq(employees.id, itemId), eq(employees.companyId, companyId)));
          break;
        case "customer":
          await db.delete(customers)
            .where(and(eq(customers.id, itemId), eq(customers.companyId, companyId)));
          break;
        case "supplier":
          await db.delete(suppliers)
            .where(eq(suppliers.id, itemId));
          break;
        case "bankAccount":
          await db.delete(bankAccounts)
            .where(and(eq(bankAccounts.id, itemId), eq(bankAccounts.companyId, companyId)));
          break;
        case "voucher": {
          // ── Step 1: Null out nullable FKs in tables with onDelete: "restrict" ──
          await db.update(purchaseOrders)
            .set({ voucherId: null })
            .where(eq(purchaseOrders.voucherId, itemId));
          await db.update(containerSales)
            .set({ voucherId: null })
            .where(eq(containerSales.voucherId, itemId));
          await db.update(interCompanyTransfers)
            .set({ fromVoucherId: null })
            .where(eq(interCompanyTransfers.fromVoucherId, itemId));
          await db.update(interCompanyTransfers)
            .set({ toVoucherId: null })
            .where(eq(interCompanyTransfers.toVoucherId, itemId));
          await db.update(salaryAdvances)
            .set({ voucherId: null })
            .where(eq(salaryAdvances.voucherId, itemId));
          await db.update(customerOrderCharges)
            .set({ voucherId: null })
            .where(eq(customerOrderCharges.voucherId, itemId));
          await db.update(wasteDispatches)
            .set({ voucherId: null })
            .where(eq(wasteDispatches.voucherId, itemId));
          await db.update(propertyPayments)
            .set({ voucherId: null })
            .where(eq(propertyPayments.voucherId, itemId));
          await db.update(factoryTransporterTransactions)
            .set({ voucherId: null })
            .where(eq(factoryTransporterTransactions.voucherId, itemId));

          // ── Step 2: Delete rows with notNull FKs ──────────────────────────
          // stock_transfer_vouchers.voucherId is notNull — delete its items first
          const stvRows = await db.select({ id: stockTransferVouchers.id })
            .from(stockTransferVouchers)
            .where(eq(stockTransferVouchers.voucherId, itemId));
          if (stvRows.length > 0) {
            const stvIds = stvRows.map(r => r.id);
            // transferId is the correct FK column on stock_transfer_items
            await db.delete(stockTransferItems).where(inArray(stockTransferItems.transferId, stvIds));
            await db.delete(stockTransferVouchers).where(inArray(stockTransferVouchers.id, stvIds));
          }
          // fiscal_period_closures.closingVoucherId is notNull — delete the closure row if it exists
          try {
            await db.delete(fiscalPeriodClosures)
              .where(eq(fiscalPeriodClosures.closingVoucherId, itemId));
          } catch {
            // If no matching row or table schema differs in production, continue safely
          }

          // ── Step 3: Delete voucher entries (also cascade, but be explicit) ─
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, itemId));

          // ── Step 4: Delete the voucher itself ────────────────────────────
          await db.delete(vouchers)
            .where(and(eq(vouchers.id, itemId), eq(vouchers.companyId, companyId)));
          break;
        }
        case "orphanedPosSale":
          // Permanently delete an orphaned voucher and its entries
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, itemId));
          await db.delete(vouchers).where(
            and(
              eq(vouchers.id, itemId),
              eq(vouchers.companyId, companyId)
            )
          );
          break;
        // === Wave 1 permanent deletes ===
        // Note: these only remove the row + immediate dependent rows. They do NOT
        // attempt to reverse historical financial vouchers/daybook entries — that
        // would require running the original cascade logic and is left for a future
        // wave. For full financial unwind, perform a manual reversal voucher.
        case "factoryCategory":
          await db.delete(factoryCategories)
            .where(and(eq(factoryCategories.id, itemId), eq(factoryCategories.companyId, companyId)));
          break;
        case "factoryBaleProduct":
          await db.delete(factoryBaleProducts)
            .where(and(eq(factoryBaleProducts.id, itemId), eq(factoryBaleProducts.companyId, companyId)));
          break;
        case "factoryContainer":
          await db.delete(factoryContainers)
            .where(and(eq(factoryContainers.id, itemId), eq(factoryContainers.companyId, companyId)));
          break;
        case "factoryRawStock":
          await db.delete(factoryRawStock)
            .where(and(eq(factoryRawStock.id, itemId), eq(factoryRawStock.companyId, companyId)));
          break;
        case "factoryRawMaterialAdjustment":
          await db.delete(factoryRawMaterialAdjustments)
            .where(and(eq(factoryRawMaterialAdjustments.id, itemId), eq(factoryRawMaterialAdjustments.companyId, companyId)));
          break;
        case "factoryMixBatch":
          await db.delete(factoryMixBatches)
            .where(and(eq(factoryMixBatches.id, itemId), eq(factoryMixBatches.companyId, companyId)));
          break;
        case "factoryBale":
          await db.delete(factoryBales)
            .where(and(eq(factoryBales.id, itemId), eq(factoryBales.companyId, companyId)));
          break;
        case "customerProforma":
          await db.delete(customerProformaLines).where(eq(customerProformaLines.proformaId, itemId));
          await db.delete(proformaStockReservations).where(eq(proformaStockReservations.proformaId, itemId));
          await db.delete(customerProformas)
            .where(and(eq(customerProformas.id, itemId), eq(customerProformas.companyId, companyId)));
          break;
        case "customerOrder":
          await db.delete(customerOrderBales).where(eq(customerOrderBales.orderId, itemId));
          await db.delete(customerOrderLines).where(eq(customerOrderLines.orderId, itemId));
          await db.delete(customerOrderCharges).where(eq(customerOrderCharges.orderId, itemId));
          await db.delete(customerOrders)
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
  app.get("/api/admin/legacy-employee-accounts", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Find all EMP-* ledger accounts (both active and soft-deleted)
      const allAccounts = await db
        .select()
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.companyId, companyId),
            like(ledgerAccounts.code, "EMP-%")
          )
        );

      // For each account, get usage count in voucher entries
      const accountsWithUsage = await Promise.all(
        allAccounts.map(async (account) => {
          const entries = await db
            .select({ count: sql<number>`count(*)` })
            .from(voucherEntries)
            .where(eq(voucherEntries.ledgerAccountId, account.id));
          
          const usageCount = entries[0]?.count || 0;
          
          // Extract employee code from EMP-{code}
          const employeeCode = account.code.replace("EMP-", "");
          
          // Try to find matching employee in the same company
          const employee = await storage.getEmployeeByCode(employeeCode);
          const employeeInSameCompany = employee && employee.companyId === companyId ? employee : null;
          
          return {
            id: account.id,
            code: account.code,
            name: account.name,
            accountType: account.accountType,
            isDeleted: !!account.deletedAt,
            deletedAt: account.deletedAt,
            usageCount,
            employeeCode,
            employeeId: employeeInSameCompany?.id || null,
            employeeName: employeeInSameCompany ? `${employeeInSameCompany.firstName} ${employeeInSameCompany.lastName}` : null,
            canMigrate: !!employeeInSameCompany && usageCount > 0,
            canDelete: usageCount === 0,
          };
        })
      );

      res.json({
        accounts: accountsWithUsage,
        totalCount: accountsWithUsage.length,
        activeCount: accountsWithUsage.filter(a => !a.isDeleted).length,
        withEntriesCount: accountsWithUsage.filter(a => a.usageCount > 0).length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Migrate voucher entries from EMP-* ledger account to use employeeId directly
  app.post("/api/admin/migrate-employee-account/:accountId", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const accountId = parseInt(req.params.accountId);
      if (isNaN(accountId)) {
        return res.status(400).json({ message: "Invalid account ID" });
      }

      // Get the EMP-* account
      const account = await storage.getLedgerAccountById(accountId);
      if (!account) {
        return res.status(404).json({ message: "Account not found" });
      }
      if (!account.code || !account.code.startsWith("EMP-")) {
        return res.status(400).json({ message: "Not an EMP-* legacy account" });
      }
      if (account.companyId !== companyId) {
        return res.status(403).json({ message: "Account belongs to a different company" });
      }

      // Extract employee code and find matching employee in the same company
      const employeeCode = account.code.replace("EMP-", "");
      const employee = await storage.getEmployeeByCode(employeeCode);
      if (!employee) {
        return res.status(400).json({ 
          message: `Cannot migrate: No employee found with code "${employeeCode}"` 
        });
      }
      if (employee.companyId !== companyId) {
        return res.status(400).json({ 
          message: `Cannot migrate: Employee "${employeeCode}" belongs to a different company` 
        });
      }

      // Migrate all voucher entries from ledgerAccountId to employeeId
      const result = await db
        .update(voucherEntries)
        .set({
          ledgerAccountId: null,
          employeeId: employee.id,
        })
        .where(eq(voucherEntries.ledgerAccountId, accountId))
        .returning();

      // Soft-delete the EMP-* account since it's no longer needed
      await db
        .update(ledgerAccounts)
        .set({ deletedAt: new Date(), active: false })
        .where(eq(ledgerAccounts.id, accountId));

      res.json({
        message: `Migrated ${result.length} voucher entries from ${account.code} to employee ${employee.code}`,
        migratedCount: result.length,
        accountDeleted: true,
        employeeId: employee.id,
        employeeCode: employee.code,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk migrate and cleanup all EMP-* accounts for the current company
  app.post("/api/admin/cleanup-legacy-employee-accounts", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Find all active EMP-* ledger accounts
      const empAccounts = await db
        .select()
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.companyId, companyId),
            like(ledgerAccounts.code, "EMP-%"),
            isNull(ledgerAccounts.deletedAt)
          )
        );

      const results: Array<{
        accountCode: string;
        accountId: number;
        employeeCode: string;
        migratedEntries: number;
        status: "migrated" | "deleted" | "skipped";
        message: string;
      }> = [];

      for (const account of empAccounts) {
        const employeeCode = account.code.replace("EMP-", "");
        const employeeRaw = await storage.getEmployeeByCode(employeeCode);
        // Only use employee if in same company
        const employee = employeeRaw && employeeRaw.companyId === companyId ? employeeRaw : null;

        // Get voucher entries count for this account
        const entries = await db
          .select()
          .from(voucherEntries)
          .where(eq(voucherEntries.ledgerAccountId, account.id));

        if (entries.length === 0) {
          // No entries - just soft-delete the account
          await db
            .update(ledgerAccounts)
            .set({ deletedAt: new Date(), active: false })
            .where(eq(ledgerAccounts.id, account.id));

          results.push({
            accountCode: account.code,
            accountId: account.id,
            employeeCode,
            migratedEntries: 0,
            status: "deleted",
            message: "Account had no entries, soft-deleted",
          });
        } else if (employee) {
          // Has entries and matching employee - migrate then delete
          await db
            .update(voucherEntries)
            .set({
              ledgerAccountId: null,
              employeeId: employee.id,
            })
            .where(eq(voucherEntries.ledgerAccountId, account.id));

          await db
            .update(ledgerAccounts)
            .set({ deletedAt: new Date(), active: false })
            .where(eq(ledgerAccounts.id, account.id));

          results.push({
            accountCode: account.code,
            accountId: account.id,
            employeeCode,
            migratedEntries: entries.length,
            status: "migrated",
            message: `Migrated ${entries.length} entries to employee ${employee.code}`,
          });
        } else {
          // Has entries but no matching employee - skip
          results.push({
            accountCode: account.code,
            accountId: account.id,
            employeeCode,
            migratedEntries: 0,
            status: "skipped",
            message: `Skipped: No matching employee found for code "${employeeCode}"`,
          });
        }
      }

      const migrated = results.filter(r => r.status === "migrated").length;
      const deleted = results.filter(r => r.status === "deleted").length;
      const skipped = results.filter(r => r.status === "skipped").length;

      res.json({
        message: `Cleanup complete: ${migrated} migrated, ${deleted} deleted, ${skipped} skipped`,
        results,
        summary: { migrated, deleted, skipped, total: results.length },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Shared helper: compute the raw import cycle balance for a given company.
  // Uses the identical formula as /api/stats/import-cycle-balance (without the stored equity adjustment).
  // Shared by both the single-company and all-companies recalculate endpoints.
  const computeRawBalance = async (companyId: number): Promise<number> => {

    const getBalance = async (accountType: string, isLiability = false): Promise<number> => {
      const accts = await db.select().from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.accountType, accountType), isNull(ledgerAccounts.deletedAt)));
      let total = 0;
      for (const acct of accts) {
        const entries = await db.select({ cr: voucherEntries.creditAmount, dr: voucherEntries.debitAmount })
          .from(voucherEntries).innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(and(eq(voucherEntries.ledgerAccountId, acct.id), eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));
        const raw = parseFloat(acct.openingBalance || "0");
        const side = acct.openingBalanceSide || "Dr";
        const signedOpening = isLiability ? (side === "Cr" ? raw : -raw) : (side === "Dr" ? raw : -raw);
        total += entries.reduce((s, e) => {
          const cr = parseFloat(e.cr || "0"); const dr = parseFloat(e.dr || "0");
          return s + (isLiability ? cr - dr : dr - cr);
        }, signedOpening);
      }
      return total;
    };

    const getTxBalance = async (accountType: string, isLiability = true): Promise<number> => {
      const r = await db.select({
        totalCredit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.creditAmount} AS DECIMAL)), 0)`,
        totalDebit:  sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount}  AS DECIMAL)), 0)`,
      }).from(voucherEntries).innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .innerJoin(ledgerAccounts, eq(voucherEntries.ledgerAccountId, ledgerAccounts.id))
        .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.accountType, accountType),
          isNull(ledgerAccounts.deletedAt), eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));
      const cr = parseFloat(r[0]?.totalCredit || "0"); const dr = parseFloat(r[0]?.totalDebit || "0");
      return isLiability ? cr - dr : dr - cr;
    };

    const supplierEntries = await db.select({ supplierId: voucherEntries.supplierId, cr: voucherEntries.creditAmount, dr: voucherEntries.debitAmount })
      .from(voucherEntries).innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .where(and(isNotNull(voucherEntries.supplierId), eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));
    const allSuppliersRaw = await storage.getAllSuppliers();
    const activeSupplierIds = new Set(supplierEntries.map(e => e.supplierId).filter(Boolean));
    const coContainers = await db.select({ supplierId: containers.supplierId }).from(containers).where(eq(containers.companyId, companyId));
    for (const c of coContainers) { if (c.supplierId) activeSupplierIds.add(c.supplierId); }
    const supplierOpeningTotal = allSuppliersRaw.filter(s => activeSupplierIds.has(s.id)).reduce((s, sup) => s + parseFloat(sup.openingBalance || "0"), 0);
    const supplierBalance = supplierEntries.reduce((s, e) => s + parseFloat(e.cr || "0") - parseFloat(e.dr || "0"), supplierOpeningTotal);

    const otwRows = await db.select({ grandTotal: containers.grandTotal }).from(containers)
      .where(and(eq(containers.companyId, companyId), eq(containers.status, "OTW")));
    const stockOtwValue = otwRows.reduce((s, c) => s + parseFloat(c.grandTotal || "0"), 0);

    const dutyAgentBalance        = await getBalance("Duty Agent", true);
    const transporterAgentBalance = await getBalance("Transporter Agent", true);
    const loansBalance            = await getBalance("Loans", true);
    const cashBalance             = await getBalance("Cash", false);

    const ledgerBankBalance = await getBalance("Bank", false);
    const standaloneBankEntries = await db.select({ cr: voucherEntries.creditAmount, dr: voucherEntries.debitAmount })
      .from(voucherEntries).innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .innerJoin(bankAccounts, eq(voucherEntries.bankAccountId, bankAccounts.id))
      .where(and(isNotNull(voucherEntries.bankAccountId), isNull(voucherEntries.ledgerAccountId),
        isNull(bankAccounts.linkedLedgerId), eq(bankAccounts.companyId, companyId),
        isNull(bankAccounts.deletedAt), eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));
    const standaloneBankAccts = await db.select().from(bankAccounts)
      .where(and(eq(bankAccounts.companyId, companyId), isNull(bankAccounts.deletedAt), isNull(bankAccounts.linkedLedgerId)));
    const standaloneOpening = standaloneBankAccts.reduce((s, a) => {
      const raw = parseFloat(a.openingBalance || "0"); return s + ((a.openingBalanceSide || "Dr") === "Dr" ? raw : -raw);
    }, 0);
    const standaloneVoucher = standaloneBankEntries.reduce((s, e) => s + parseFloat(e.dr || "0") - parseFloat(e.cr || "0"), 0);
    const bankBalance = ledgerBankBalance + standaloneOpening + standaloneVoucher;

    const indirectExpenseBalance = await getBalance("Indirect Expense", false);
    const incomeBalance          = await getBalance("Income", true);

    const invRows = await db.select({ quantity: inventory.quantity, averageRate: inventory.averageRate })
      .from(inventory).innerJoin(locations, eq(inventory.locationId, locations.id))
      .where(and(eq(inventory.companyId, companyId), isNull(locations.deletedAt)));
    const stockOnFloorValue = invRows.reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.averageRate || "0"), 0);

    const cogsRows = await db.select({ totalCost: salesItems.totalCost }).from(salesItems)
      .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
      .where(and(eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));
    const cogsBalance = cogsRows.reduce((s, i) => s + parseFloat(i.totalCost || "0"), 0);

    const payrollAccts = await db.select({ id: ledgerAccounts.id, openingBalance: ledgerAccounts.openingBalance })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.accountType, "Expense"),
        sql`(${ledgerAccounts.name} ILIKE '%salary%' OR ${ledgerAccounts.name} ILIKE '%payroll%' OR ${ledgerAccounts.name} ILIKE '%wage%')`,
        isNull(ledgerAccounts.deletedAt)));
    let payrollExpenseBalance = 0;
    if (payrollAccts.length > 0) {
      const payrollIds = payrollAccts.map(a => a.id);
      const payrollEntries = await db.select({ cr: voucherEntries.creditAmount, dr: voucherEntries.debitAmount })
        .from(voucherEntries).innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(inArray(voucherEntries.ledgerAccountId, payrollIds), eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));
      const openingTot = payrollAccts.reduce((s, a) => s + parseFloat(a.openingBalance || "0"), 0);
      const txTot = payrollEntries.reduce((s, e) => s + parseFloat(e.dr || "0") - parseFloat(e.cr || "0"), 0);
      payrollExpenseBalance = openingTot + txTot;
    }

    const advRows = await db.select({ remainingBalance: salaryAdvances.remainingBalance }).from(salaryAdvances)
      .where(and(eq(salaryAdvances.companyId, companyId), eq(salaryAdvances.fullyPaid, false)));
    const salaryAdvancesBalance = advRows.reduce((s, a) => s + parseFloat(a.remainingBalance || "0"), 0);

    const empRows = await db.select({ currentBalance: employees.currentBalance }).from(employees)
      .where(and(eq(employees.companyId, companyId), isNull(employees.deletedAt)));
    const payrollLiabilitiesBalance = empRows.reduce((s, e) => { const b = parseFloat(e.currentBalance || "0"); return s + (b > 0 ? b : 0); }, 0);

    const assetBalance             = await getBalance("Asset", false);
    const governmentTaxesBalance   = await getBalance("Government Taxes", false);
    const liabilityBalance         = await getBalance("Liability", true);
    const profitBalance            = await getBalance("Profit", true);
    const equityTransactionBalance = await getTxBalance("Equity", true);
    const apTransactionBalance     = await getTxBalance("Accounts Payable", true);

    const allLedgerAccts = await db.select({ openingBalance: ledgerAccounts.openingBalance, openingBalanceSide: ledgerAccounts.openingBalanceSide })
      .from(ledgerAccounts).where(and(eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt)));
    let totalDrOpenings = 0; let totalCrOpenings = 0;
    for (const a of allLedgerAccts) {
      const raw = parseFloat(a.openingBalance || "0");
      if (raw === 0) continue;
      if ((a.openingBalanceSide || "Dr") === "Dr") totalDrOpenings += raw; else totalCrOpenings += raw;
    }
    const empOpenings = await db.select({ openingBalance: employees.openingBalance }).from(employees)
      .where(and(eq(employees.companyId, companyId), isNull(employees.deletedAt)));
    totalCrOpenings += empOpenings.reduce((s, e) => s + parseFloat(e.openingBalance || "0"), 0);
    let openingBalanceEquity = totalCrOpenings - totalDrOpenings;

    const stockItemOpenings = await db.select({ openingValue: stockItems.openingValue }).from(stockItems)
      .where(and(eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)));
    openingBalanceEquity -= stockItemOpenings.reduce((s, i) => s + parseFloat(i.openingValue || "0"), 0);

    return Math.round((
      (stockOtwValue + cashBalance + bankBalance + stockOnFloorValue + assetBalance +
       indirectExpenseBalance + payrollExpenseBalance + governmentTaxesBalance + cogsBalance + salaryAdvancesBalance) -
      (supplierBalance + dutyAgentBalance + transporterAgentBalance + loansBalance + liabilityBalance +
       profitBalance + equityTransactionBalance + apTransactionBalance + incomeBalance + payrollLiabilitiesBalance -
       openingBalanceEquity)
    ) * 100) / 100;
  };

  // Recalculate Opening Balance Equity adjustment
  // Self-sufficient: computes rawBalance server-side so no body params are needed.
  app.post("/api/admin/recalculate-equity-adjustment", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Compute raw balance server-side using the canonical formula.
      // Formula: newAdjustment = -rawBalance  →  rawBalance + newAdjustment = 0
      const rawBalance = await computeRawBalance(companyId);

      // Get current equity adjustment for the "previous" value in the response
      const settingKey = `equity_adjustment_${companyId}`;
      const existingAdjustment = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, settingKey));
      const currentAdjustment = existingAdjustment.length > 0
        ? parseFloat(existingAdjustment[0].value || "0")
        : 0;

      const newAdjustment = -rawBalance;

      // Atomic upsert — avoids race conditions and duplicate key errors
      await db.insert(systemSettings)
        .values({ key: settingKey, value: newAdjustment.toFixed(2) })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: newAdjustment.toFixed(2), updatedAt: new Date() } });

      res.json({
        success: true,
        message: `Equity adjustment updated. The import cycle balance should now be $0.`,
        previousAdjustment: currentAdjustment.toFixed(2),
        newAdjustment: newAdjustment.toFixed(2),
        balanceZeroed: rawBalance.toFixed(2),
      });
    } catch (error: any) {
      console.error("Recalculate equity adjustment error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Recalculate equity adjustment for ALL companies in one operation.
  // Uses the identical formula as /api/stats/import-cycle-balance so each company
  // gets the exact same precision as the single-company endpoint.
  app.post("/api/admin/recalculate-equity-adjustment-all", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const allCompanies = await storage.getAllCompanies();

      // computeRawBalance is defined at module scope above — shared with single-company endpoint.
      // Kept as a placeholder comment for readability only.

      const results: Array<{ companyId: number; companyName: string; rawBalance: number; newAdjustment: number | null; skipped: boolean }> = [];

      for (const company of allCompanies) {
        const rawBalance = await computeRawBalance(company.id);
        const skipped = Math.abs(rawBalance) <= 0.01;
        const newAdjustment = skipped ? null : -rawBalance;

        if (!skipped) {
          const settingKey = `equity_adjustment_${company.id}`;
          await db.insert(systemSettings)
            .values({ key: settingKey, value: newAdjustment!.toFixed(2) })
            .onConflictDoUpdate({ target: systemSettings.key, set: { value: newAdjustment!.toFixed(2), updatedAt: new Date() } });
        }

        results.push({ companyId: company.id, companyName: company.name, rawBalance, newAdjustment, skipped });
      }

      const adjustedCount = results.filter(r => !r.skipped).length;
      const skippedCount  = results.filter(r =>  r.skipped).length;

      res.json({
        success: true,
        message: `Processed ${results.length} ${results.length === 1 ? "company" : "companies"} — ${adjustedCount} adjusted, ${skippedCount} already balanced.`,
        results,
      });
    } catch (error: any) {
      console.error("Recalculate equity adjustment all error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Fix orphaned POS data that might be causing Import Cycle imbalance
  // This finds sales items linked to deleted vouchers and cleans them up
  app.post("/api/admin/fix-orphaned-pos-data", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const results: any[] = [];

      // 1. Find orphaned salesItems for THIS COMPANY (voucher is deleted but companyId matches)
      // We only clean up items where we can verify the company to prevent cross-company data loss
      const orphanedSalesItemsForCompany = await db
        .select({
          id: salesItems.id,
          voucherId: salesItems.voucherId,
          stockItemId: salesItems.stockItemId,
          quantity: salesItems.quantity,
          totalCost: salesItems.totalCost,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNotNull(vouchers.deletedAt)
          )
        );

      // Also find completely orphaned salesItems (no voucher at all) - these are dangerous orphans
      // Get all salesItem voucherIds that don't have corresponding vouchers
      const allSalesItemVoucherIds = await db
        .selectDistinct({ voucherId: salesItems.voucherId })
        .from(salesItems);
      
      const existingVoucherIds = new Set(
        (await db.select({ id: vouchers.id }).from(vouchers))
          .map(v => v.id)
      );
      
      const trulyOrphanedVoucherIds = allSalesItemVoucherIds
        .filter(item => !existingVoucherIds.has(item.voucherId))
        .map(item => item.voucherId);

      let trulyOrphanedSalesItems: typeof orphanedSalesItemsForCompany = [];
      if (trulyOrphanedVoucherIds.length > 0) {
        trulyOrphanedSalesItems = await db
          .select({
            id: salesItems.id,
            voucherId: salesItems.voucherId,
            stockItemId: salesItems.stockItemId,
            quantity: salesItems.quantity,
            totalCost: salesItems.totalCost,
          })
          .from(salesItems)
          .where(inArray(salesItems.voucherId, trulyOrphanedVoucherIds));
      }

      const allOrphanedSalesItems = [...orphanedSalesItemsForCompany, ...trulyOrphanedSalesItems];

      if (allOrphanedSalesItems.length > 0) {
        results.push({
          type: "orphaned_sales_items",
          count: allOrphanedSalesItems.length,
          companyScoped: orphanedSalesItemsForCompany.length,
          trulyOrphaned: trulyOrphanedSalesItems.length,
          totalCost: allOrphanedSalesItems.reduce((sum, item) => sum + parseFloat(item.totalCost || "0"), 0),
          details: allOrphanedSalesItems.slice(0, 10),
        });

        // Delete orphaned sales items
        for (const item of allOrphanedSalesItems) {
          await db.delete(salesItems).where(eq(salesItems.id, item.id));
        }
      }

      // 2. Find orphaned voucherEntries for THIS COMPANY (voucher is deleted but companyId matches)
      const orphanedEntriesForCompany = await db
        .select({
          id: voucherEntries.id,
          voucherId: voucherEntries.voucherId,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNotNull(vouchers.deletedAt)
          )
        );

      // Also find completely orphaned entries (no voucher at all)
      const allEntryVoucherIds = await db
        .selectDistinct({ voucherId: voucherEntries.voucherId })
        .from(voucherEntries);
      
      const trulyOrphanedEntryVoucherIds = allEntryVoucherIds
        .filter(item => item.voucherId && !existingVoucherIds.has(item.voucherId))
        .map(item => item.voucherId);

      let trulyOrphanedEntries: typeof orphanedEntriesForCompany = [];
      if (trulyOrphanedEntryVoucherIds.length > 0) {
        trulyOrphanedEntries = await db
          .select({
            id: voucherEntries.id,
            voucherId: voucherEntries.voucherId,
            debitAmount: voucherEntries.debitAmount,
            creditAmount: voucherEntries.creditAmount,
          })
          .from(voucherEntries)
          .where(inArray(voucherEntries.voucherId, trulyOrphanedEntryVoucherIds as number[]));
      }

      const allOrphanedEntries = [...orphanedEntriesForCompany, ...trulyOrphanedEntries];

      if (allOrphanedEntries.length > 0) {
        const totalDebits = allOrphanedEntries.reduce((sum, e) => sum + parseFloat(e.debitAmount || "0"), 0);
        const totalCredits = allOrphanedEntries.reduce((sum, e) => sum + parseFloat(e.creditAmount || "0"), 0);
        
        results.push({
          type: "orphaned_voucher_entries",
          count: allOrphanedEntries.length,
          companyScoped: orphanedEntriesForCompany.length,
          trulyOrphaned: trulyOrphanedEntries.length,
          totalDebits,
          totalCredits,
        });

        // Delete orphaned entries
        for (const entry of allOrphanedEntries) {
          await db.delete(voucherEntries).where(eq(voucherEntries.id, entry.id));
        }
      }

      // 3. Check for negative inventory and log (don't fix automatically)
      const negativeInventory = await db
        .select({
          id: inventory.id,
          locationId: inventory.locationId,
          stockItemId: inventory.stockItemId,
          quantity: inventory.quantity,
        })
        .from(inventory)
        .where(
          and(
            eq(inventory.companyId, companyId),
            sql`CAST(${inventory.quantity} AS DECIMAL) < 0`
          )
        );

      if (negativeInventory.length > 0) {
        results.push({
          type: "negative_inventory",
          count: negativeInventory.length,
          warning: "These need manual review - might indicate overselling or data issues",
          items: negativeInventory.slice(0, 10),
        });
      }

      res.json({
        message: `Cleanup complete: Fixed ${allOrphanedSalesItems.length} orphaned sales items, ${allOrphanedEntries.length} orphaned entries. Found ${negativeInventory.length} negative inventory items.`,
        results,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get orphaned POS sales (vouchers at deleted locations)
  app.get("/api/admin/orphaned-pos-sales", requireAuth, requireRole("Admin", "Owner"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Find all vouchers with locationId pointing to deleted or non-existent locations
      const orphanedVouchers = await db
        .select({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          locationId: vouchers.locationId,
          notes: vouchers.description,
        })
        .from(vouchers)
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            isNotNull(vouchers.locationId),
            or(
              isNull(locations.id), // Location doesn't exist
              isNotNull(locations.deletedAt) // Location is soft-deleted
            )
          )
        );

      // Get entry totals for each orphaned voucher
      const vouchersWithTotals = await Promise.all(
        orphanedVouchers.map(async (v) => {
          const entries = await db
            .select({
              debitAmount: voucherEntries.debitAmount,
              creditAmount: voucherEntries.creditAmount,
            })
            .from(voucherEntries)
            .where(eq(voucherEntries.voucherId, v.id));

          const totalDebit = entries.reduce((sum, e) => sum + parseFloat(e.debitAmount || "0"), 0);
          const totalCredit = entries.reduce((sum, e) => sum + parseFloat(e.creditAmount || "0"), 0);

          // Check if it has sales items
          const saleItems = await db
            .select({ id: salesItems.id, quantity: salesItems.quantity, totalCost: salesItems.totalCost })
            .from(salesItems)
            .where(eq(salesItems.voucherId, v.id));

          return {
            ...v,
            totalDebit,
            totalCredit,
            salesItemCount: saleItems.length,
            salesItemsTotalCost: saleItems.reduce((sum, s) => sum + parseFloat(s.totalCost || "0"), 0),
          };
        })
      );

      const totalImpact = vouchersWithTotals.reduce((sum, v) => sum + Math.abs(v.totalDebit - v.totalCredit), 0);

      res.json({
        count: vouchersWithTotals.length,
        totalImpact,
        vouchers: vouchersWithTotals,
        explanation: "These vouchers have a locationId that points to a deleted or non-existent location. They are orphaned and can be safely deleted.",
      });
    } catch (error: any) {
      console.error("Orphaned POS sales check error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Delete orphaned POS sales (vouchers at deleted locations)
  app.post("/api/admin/delete-orphaned-pos-sales", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Find all vouchers with locationId pointing to deleted or non-existent locations
      const orphanedVouchers = await db
        .select({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
        })
        .from(vouchers)
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            isNotNull(vouchers.locationId),
            or(
              isNull(locations.id), // Location doesn't exist
              isNotNull(locations.deletedAt) // Location is soft-deleted
            )
          )
        );

      if (orphanedVouchers.length === 0) {
        return res.json({ message: "No orphaned POS sales found", deleted: 0 });
      }

      const voucherIds = orphanedVouchers.map(v => v.id);

      // Use batch deletes with inArray for efficiency
      // Delete sales items first (foreign key constraint)
      const salesResult = await db.delete(salesItems).where(inArray(salesItems.voucherId, voucherIds));
      const deletedSalesItems = (salesResult as any).rowCount || voucherIds.length;

      // Delete voucher entries
      const entriesResult = await db.delete(voucherEntries).where(inArray(voucherEntries.voucherId, voucherIds));
      const deletedEntries = (entriesResult as any).rowCount || voucherIds.length;

      // Delete the vouchers themselves (hard delete since they're orphaned garbage)
      const vouchersResult = await db.delete(vouchers).where(inArray(vouchers.id, voucherIds));
      const deletedVouchers = (vouchersResult as any).rowCount || voucherIds.length;

      res.json({
        message: `Deleted ${deletedVouchers} orphaned POS vouchers, ${deletedEntries} entries, and ${deletedSalesItems} sales items`,
        deleted: deletedVouchers,
        deletedEntries,
        deletedSalesItems,
        voucherNumbers: orphanedVouchers.map(v => v.voucherNumber),
      });
    } catch (error: any) {
      console.error("Delete orphaned POS sales error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Role Feature Permissions API
  // Get all role permissions for the current company
  app.get(
    "/api/settings/role-permissions",
    requireAuth,
    requireRole("Admin", "Owner"),
    async (req, res) => {
      try {
        // Allow Developer/Admin to query any company via ?companyId=N; others use session
        let companyId = req.session.currentCompanyId;
        if (
          (req.user?.role === "Developer" || req.user?.role === "Admin") &&
          req.query.companyId
        ) {
          companyId = parseInt(req.query.companyId as string);
        }
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const permissions = await storage.getRoleFeaturePermissions(companyId);
        res.json(permissions);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // Update role permissions (bulk upsert)
  app.put(
    "/api/settings/role-permissions",
    requireAuth,
    requireRole("Admin", "Owner"),
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { permissions } = req.body;
        if (!Array.isArray(permissions)) {
          return res.status(400).json({ message: "permissions must be an array" });
        }

        // Add companyId to each permission
        const permissionsWithCompany = permissions.map((p: any) => ({
          ...p,
          companyId,
        }));

        const results = await storage.bulkUpsertRoleFeaturePermissions(permissionsWithCompany);

        // Audit: log each permission change
        for (const p of permissions) {
          await logAudit({
            userId: req.user!.id,
            username: req.session.username || "unknown",
            companyId,
            action: "update",
            tableName: "role_feature_permissions",
            recordId: null,
            recordIdentifier: `role:${p.role} feature:${p.featureKey} enabled:${p.enabled}`,
            changes: { enabled: { old: !p.enabled, new: p.enabled } },
          });
        }

        // Session invalidation: force affected users to re-login so new permissions take effect
        try {
          const affectedRoles = [...new Set(permissions.map((p: any) => p.role as string))];
          const affectedUsers = await db
            .select({ userId: userCompanyRoles.userId })
            .from(userCompanyRoles)
            .where(
              and(
                eq(userCompanyRoles.companyId, companyId),
                inArray(userCompanyRoles.role, affectedRoles)
              )
            );
          for (const u of affectedUsers) {
            await db.execute(
              sql`DELETE FROM session WHERE sess::jsonb ->> 'userId' = ${u.userId}`
            );
          }
        } catch (_err) {
          // Non-fatal — session table may not exist in all environments
        }

        res.json({ message: "Permissions updated successfully", permissions: results });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // Get permissions for the current user's role (used by sidebar)
  app.get(
    "/api/my-permissions",
    requireAuth,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        const role = req.session.currentRole;

        if (!companyId || !role) {
          return res.status(400).json({ message: "No company or role selected" });
        }

        // Get all permissions for this company and role
        const allPermissions = await storage.getRoleFeaturePermissions(companyId);
        const rolePermissions = allPermissions.filter(p => p.role === role);

        res.json(rolePermissions);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // ==========================================
  // Test Data Import API (for testing Net Profit)
  // ==========================================
  
  // Create a test data voucher (Journal entry marked as optional with TEST- prefix)
  app.post(
    "/api/test-data/vouchers",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { date, debitAccountId, creditAccountId, amount, description } = req.body;

        // Validate required fields
        if (!date || !debitAccountId || !creditAccountId || !amount) {
          return res.status(400).json({ message: "Missing required fields: date, debitAccountId, creditAccountId, amount" });
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
          return res.status(400).json({ message: "Amount must be a positive number" });
        }

        // Verify debit account exists and belongs to current company
        const debitAccount = await storage.getLedgerAccountById(debitAccountId);
        if (!debitAccount || debitAccount.companyId !== companyId) {
          return res.status(404).json({ message: "Debit account not found or doesn't belong to current company" });
        }

        // Verify credit account exists and belongs to current company
        const creditAccount = await storage.getLedgerAccountById(creditAccountId);
        if (!creditAccount || creditAccount.companyId !== companyId) {
          return res.status(404).json({ message: "Credit account not found or doesn't belong to current company" });
        }

        // Generate a unique voucher number with TEST- prefix
        const voucherNumber = `TEST-${Date.now()}`;

        // Create the voucher as optional (excluded from calculations by default)
        const [voucher] = await db
          .insert(vouchers)
          .values({
            companyId,
            voucherNumber,
            voucherType: "Journal",
            voucherDate: date,
            description: description || `Test data entry`,
            totalAmount: parsedAmount.toFixed(2),
            optional: true, // Start as draft/optional
          })
          .returning();

        // Create debit entry
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: debitAccountId,
          debitAmount: parsedAmount.toFixed(2),
          creditAmount: "0",
          narration: `Test data - ${description || debitAccount.name}`,
        });

        // Create credit entry
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: creditAccountId,
          debitAmount: "0",
          creditAmount: parsedAmount.toFixed(2),
          narration: `Test data - ${description || creditAccount.name}`,
        });

        res.status(201).json({
          voucher,
          message: "Test entry created as optional (draft). Toggle to apply to calculations.",
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // ==========================================
  // Fix Old PO Inter-Company Credits
  // ==========================================
  
  app.post(
    "/api/fix-old-po-credits",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { companyId, parentCompanyId } = req.body;
        
        if (!companyId) {
          return res.status(400).json({ 
            message: "Please select a subsidiary company to process." 
          });
        }
        
        if (!parentCompanyId) {
          return res.status(400).json({ 
            message: "Please select a parent company." 
          });
        }
        
        const allCompanies = await storage.getAllCompanies();
        
        const parentCompany = allCompanies.find(c => c.id === parentCompanyId);
        
        if (!parentCompany) {
          return res.status(400).json({ 
            message: "Selected parent company not found." 
          });
        }
        
        // Find the selected subsidiary company
        const selectedCompany = allCompanies.find(c => c.id === companyId);
        
        if (!selectedCompany) {
          return res.status(400).json({ 
            message: "Selected subsidiary company not found." 
          });
        }
        
        if (selectedCompany.id === parentCompany.id) {
          return res.status(400).json({ 
            message: "Subsidiary and parent company cannot be the same." 
          });
        }
        
        // Process only the selected subsidiary
        const companiesToProcess = [selectedCompany];
        
        let totalFixed = 0;
        let totalAmount = 0;
        const details: Array<{ company: string; poNumber: string; amount: number }> = [];
        
        // Process each company
        for (const company of companiesToProcess) {
          // Get or create "[Parent Company] Credit" account for this subsidiary
          const parentCreditCode = parentCompany.name.toUpperCase().replace(/\s+/g, '_') + "_CREDIT";
          const parentCreditName = parentCompany.name + " Credit";
          
          let creditAccount = await db
            .select()
            .from(ledgerAccounts)
            .where(
              and(
                eq(ledgerAccounts.companyId, company.id),
                eq(ledgerAccounts.code, parentCreditCode),
                isNull(ledgerAccounts.deletedAt)
              )
            )
            .limit(1);
          
          if (!creditAccount.length) {
            const [newAccount] = await db.insert(ledgerAccounts).values({
              companyId: company.id,
              code: parentCreditCode,
              name: parentCreditName,
              accountType: "Liability",
              subType: "Current Liability",
              openingBalance: "0",
              openingBalanceSide: "Cr",
            }).returning();
            creditAccount = [newAccount];
          }
          
          // Get all purchase orders for this company
          const companyPOs = await db
            .select()
            .from(purchaseOrders)
            .where(eq(purchaseOrders.companyId, company.id));
          
          for (const po of companyPOs) {
            // Check if this PO is for an offloaded container
            const [container] = await db
              .select()
              .from(containers)
              .where(eq(containers.id, po.containerId));
            
            if (!container || container.status !== "OFFLOADED") {
              continue; // Skip non-offloaded containers
            }
            
            // Check if credit entry already exists for this PO
            // For OLD fixed POs: fix endpoint uses INTERCO-* in subsidiary and INTERCO-LUB-* in Lubumbashi
            // Check voucher patterns to prevent duplicates
            // NOTE: po.voucherId is for the import voucher (DR Purchases, CR Supplier), NOT inter-company vouchers
            
            // Check for existing INTERCO vouchers in subsidiary
            // Use both PO number AND container number to identify duplicates (same PO number can apply to multiple containers)
            const existingSubsidiaryVoucher = await db
              .select()
              .from(vouchers)
              .where(
                and(
                  eq(vouchers.companyId, company.id),
                  like(vouchers.voucherNumber, `INTERCO-%`),
                  like(vouchers.description, `%${container.containerNumber}%`)
                )
              )
              .limit(1);
            
            if (existingSubsidiaryVoucher.length > 0) {
              continue; // Skip - already has credit entry in subsidiary for this container
            }
            
            // Check for existing INTERCO-PARENT vouchers in parent company for this container
            const existingParentVoucher = await db
              .select()
              .from(vouchers)
              .where(
                and(
                  eq(vouchers.companyId, parentCompany.id),
                  or(
                    like(vouchers.voucherNumber, `INTERCO-PARENT-%`),
                    like(vouchers.voucherNumber, `INTERCO-LUB-%`) // Legacy format
                  ),
                  like(vouchers.description, `%${container.containerNumber}%`)
                )
              )
              .limit(1);
            
            if (existingParentVoucher.length > 0) {
              continue; // Skip - already has credit entry in parent company for this container
            }
            
            // Calculate PO total: items + freight + charges
            const poItemsTotal = parseFloat(po.itemsTotal || "0");
            const poFreight = parseFloat(po.freight || "0");
            const poSurcharge = parseFloat(po.surcharge || "0");
            const poFumigation = parseFloat(po.fumigation || "0");
            const poDocumentCharges = parseFloat(po.documentCharges || "0");
            const poDiscount = parseFloat(po.discount || "0");
            const poOtherCharges = parseFloat(po.otherCharges || "0");
            const poTotal = poItemsTotal + poFreight + poSurcharge + poFumigation + poDocumentCharges - poDiscount + poOtherCharges;
            
            const poSupplier = po.supplierId ? await db.query.suppliers.findFirst({ where: eq(suppliers.id, po.supplierId) }) : null;
            if (poTotal <= 0) {
              continue; // Skip zero or negative amounts
            }
            
            // Get offload date from container offload record
            const [offloadRecord] = await db
              .select()
              .from(containerOffloads)
              .where(eq(containerOffloads.containerId, container.id))
              .limit(1);
            
            const voucherDate = offloadRecord?.offloadedAt 
              ? new Date(offloadRecord.offloadedAt).toISOString().split('T')[0]
              : getClientDate(req);
            
            // ============================================================
            // SUBSIDIARY VOUCHER - Transfer liability from Supplier to Parent Credit
            // ============================================================
            const voucherNumber = `INTERCO-${po.poNumber}-${Date.now()}`;
            const [voucher] = await db.insert(vouchers).values({
              companyId: company.id,
              voucherNumber,
              voucherType: "Journal",
              voucherDate,
              description: `Transfer supplier liability to ${parentCompany.name} Credit - PO ${po.poNumber} - Container ${container.containerNumber}`,
              totalAmount: poTotal.toFixed(2),
            }).returning();
            
            // Debit: Supplier account (reduce payable - they got paid by parent company)
            if (po.supplierId) {
              await db.insert(voucherEntries).values({
                voucherId: voucher.id,
                supplierId: po.supplierId,
                debitAmount: poTotal.toFixed(2),
                creditAmount: "0",
                narration: `Transfer to ${parentCompany.name} Credit - PO ${po.poNumber}`,
              });
            }
            
            // Credit: Parent Credit account (we owe parent company, who paid the supplier)
            await db.insert(voucherEntries).values({
              voucherId: voucher.id,
              ledgerAccountId: creditAccount[0].id,
              debitAmount: "0",
              creditAmount: poTotal.toFixed(2),
              narration: `PO ${po.poNumber} - Container ${container.containerNumber} (${parentCompany.name} paid)`,
            });
            
            // ============================================================
            // PARENT COMPANY VOUCHER - Record receivable from subsidiary + supplier payable
            // ============================================================
            // Get or create "[Subsidiary] Credit" receivable account in parent company
            const subsidiaryCode = company.name.toUpperCase().replace(/\s+/g, '_') + "_CREDIT";
            const subsidiaryName = company.name + " Credit";
            
            let subsidiaryReceivableAccount = await db
              .select()
              .from(ledgerAccounts)
              .where(
                and(
                  eq(ledgerAccounts.companyId, parentCompany.id),
                  eq(ledgerAccounts.code, subsidiaryCode),
                  isNull(ledgerAccounts.deletedAt)
                )
              )
              .limit(1);
            
            if (!subsidiaryReceivableAccount.length) {
              const [newAccount] = await db.insert(ledgerAccounts).values({
                companyId: parentCompany.id,
                code: subsidiaryCode,
                name: subsidiaryName,
                accountType: "Asset",
                subType: "Current Asset",
                openingBalance: "0",
                openingBalanceSide: "Dr",
              }).returning();
              subsidiaryReceivableAccount = [newAccount];
            }
            
            // Create Journal voucher in parent company
            const parentVoucherNumber = `INTERCO-PARENT-${po.poNumber}-${Date.now()}`;
            const [parentVoucher] = await db.insert(vouchers).values({
              companyId: parentCompany.id,
              voucherNumber: parentVoucherNumber,
              voucherType: "Journal",
              voucherDate,
              description: `${container.containerNumber} ${poSupplier?.legalName || 'Unknown Supplier'}`,
              totalAmount: poTotal.toFixed(2),
            }).returning();
            
            // DR [Subsidiary] Credit (they owe us)
            await db.insert(voucherEntries).values({
              voucherId: parentVoucher.id,
              ledgerAccountId: subsidiaryReceivableAccount[0].id,
              debitAmount: poTotal.toFixed(2),
              creditAmount: "0",
              narration: `PO ${po.poNumber} - ${company.name} owes us`,
            });
            
            // CR Supplier (we owe supplier)
            if (po.supplierId) {
              await db.insert(voucherEntries).values({
                voucherId: parentVoucher.id,
                supplierId: po.supplierId,
                debitAmount: "0",
                creditAmount: poTotal.toFixed(2),
                narration: `PO ${po.poNumber} - Supplier payment`,
              });
            }
            
            totalFixed++;
            totalAmount += poTotal;
            details.push({
              company: company.name,
              poNumber: po.poNumber,
              amount: poTotal
            });
          }
        }
        
        res.json({
          message: `Fixed ${totalFixed} POs for ${selectedCompany.name} (parent: ${parentCompany.name})`,
          fixed: totalFixed,
          totalAmount: totalAmount.toFixed(2),
          details,
          processedCompanies: 1
        });
      } catch (error: any) {
        console.error("Fix old PO credits error:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // ==========================================
  // Fix Parent Company POs Missing Supplier Entries
  // ==========================================
  
  app.post(
    "/api/fix-parent-po-supplier-entries",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const parentCompanyId = await storage.getParentCompanyId();
        
        if (!parentCompanyId) {
          return res.status(400).json({ 
            message: "No parent company configured. Please set the parent company in Settings first." 
          });
        }
        
        // Get the parent company
        const parentCompany = await storage.getCompanyById(parentCompanyId);
        if (!parentCompany) {
          return res.status(404).json({ message: "Parent company not found" });
        }
        
        // Find all POs in the parent company
        const allPOs = await db
          .select()
          .from(purchaseOrders)
          .where(eq(purchaseOrders.companyId, parentCompanyId));
        
        let fixed = 0;
        let skipped = 0;
        let totalAmount = 0;
        const details: any[] = [];
        
        for (const po of allPOs) {
          if (!po.voucherId || !po.supplierId) {
            skipped++;
            continue;
          }
          
          // Calculate PO total
          const itemsTotal = parseFloat(po.itemsTotal || "0");
          const freight = parseFloat(po.freight || "0");
          const surcharge = parseFloat(po.surcharge || "0");
          const fumigation = parseFloat(po.fumigation || "0");
          const documentCharges = parseFloat(po.documentCharges || "0");
          const discount = parseFloat(po.discount || "0");
          const otherCharges = parseFloat(po.otherCharges || "0");
          const poTotal = itemsTotal + freight + surcharge + fumigation + documentCharges - discount + otherCharges;
          
            const poSupplier = po.supplierId ? await db.query.suppliers.findFirst({ where: eq(suppliers.id, po.supplierId) }) : null;
          if (poTotal <= 0) {
            skipped++;
            continue;
          }
          
          // Get or create Purchases account
          let purchasesAccount = await storage.getLedgerAccountByName("Purchases", parentCompanyId);
          if (!purchasesAccount) {
            purchasesAccount = await storage.getLedgerAccountByCode("PURCHASES", parentCompanyId);
          }
          if (!purchasesAccount) {
            purchasesAccount = await storage.createLedgerAccount({
              companyId: parentCompanyId,
              name: "Purchases",
              code: "PURCHASES",
              accountType: "Expense",
              subType: "Direct Expense",
            });
          }
          
          // Check if voucher already has purchase entry
          const existingPurchaseEntry = await db
            .select()
            .from(voucherEntries)
            .where(and(
              eq(voucherEntries.voucherId, po.voucherId),
              eq(voucherEntries.ledgerAccountId, purchasesAccount.id)
            ))
            .limit(1);
          
          // Check if this voucher already has a supplier entry
          const existingSupplierEntry = await db
            .select()
            .from(voucherEntries)
            .where(and(
              eq(voucherEntries.voucherId, po.voucherId),
              eq(voucherEntries.supplierId, po.supplierId)
            ))
            .limit(1);
          
          // Skip if both entries already exist
          if (existingPurchaseEntry.length > 0 && existingSupplierEntry.length > 0) {
            skipped++;
            continue;
          }
          
          let fixedThisPO = false;
          
          // Add DR Purchases entry if missing
          if (existingPurchaseEntry.length === 0) {
            await db.insert(voucherEntries).values({
              voucherId: po.voucherId,
              ledgerAccountId: purchasesAccount.id,
              debitAmount: poTotal.toFixed(2),
              creditAmount: "0",
              narration: `PO ${po.poNumber} - Fix missing entry`,
            });
            fixedThisPO = true;
          }
          
          // Add CR Supplier entry if missing
          if (existingSupplierEntry.length === 0) {
            await db.insert(voucherEntries).values({
              voucherId: po.voucherId,
              supplierId: po.supplierId,
              debitAmount: "0",
              creditAmount: poTotal.toFixed(2),
              narration: `PO ${po.poNumber} - Fix missing supplier entry`,
            });
            fixedThisPO = true;
          }
          
          if (fixedThisPO) {
            fixed++;
            totalAmount += poTotal;
            details.push({
              poNumber: po.poNumber,
              amount: poTotal.toFixed(2),
              fixedPurchases: existingPurchaseEntry.length === 0,
              fixedSupplier: existingSupplierEntry.length === 0,
            });
          } else {
            skipped++;
          }
        }
        
        res.json({
          message: `Fixed ${fixed} POs in ${parentCompany.name}. Skipped ${skipped} (already had entries or invalid).`,
          fixed,
          skipped,
          totalAmount: totalAmount.toFixed(2),
          details,
        });
      } catch (error: any) {
        console.error("Fix parent PO supplier entries error:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // ==========================================
  // Reverse Fix Old PO Inter-Company Credits
  // ==========================================
  
  app.post(
    "/api/reverse-po-credits",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { companyId, parentCompanyId } = req.body;
        
        if (!companyId) {
          return res.status(400).json({ 
            message: "Please select a subsidiary company to reverse." 
          });
        }
        
        if (!parentCompanyId) {
          return res.status(400).json({ 
            message: "Please select a parent company." 
          });
        }
        
        const allCompanies = await storage.getAllCompanies();
        const company = allCompanies.find(c => c.id === companyId);
        const parentCompany = allCompanies.find(c => c.id === parentCompanyId);
        
        if (!company) {
          return res.status(400).json({ message: "Subsidiary company not found." });
        }
        
        if (!parentCompany) {
          return res.status(400).json({ 
            message: "Parent company not found." 
          });
        }
        
        if (company.id === parentCompany.id) {
          return res.status(400).json({ 
            message: "Subsidiary and parent company cannot be the same." 
          });
        }
        
        // Process only the selected subsidiary
        const targetCompany = company;
        
        let totalReversed = 0;
        const details: Array<{ company: string; voucherNumber: string; amount: string }> = [];
        
        // Delete INTERCO vouchers in this subsidiary company
        const companyIntercoVouchers = await db
          .select()
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, targetCompany.id),
              like(vouchers.voucherNumber, "INTERCO-%")
            )
          );
        
        for (const v of companyIntercoVouchers) {
          // Delete voucher entries first
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, v.id));
          // Delete voucher
          await db.delete(vouchers).where(eq(vouchers.id, v.id));
          totalReversed++;
          details.push({ company: targetCompany.name, voucherNumber: v.voucherNumber, amount: v.totalAmount || "0" });
        }
        
        // Also delete corresponding INTERCO-PARENT vouchers in parent company for this subsidiary
        const parentIntercoVouchers = await db
          .select()
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, parentCompany.id),
              or(
                like(vouchers.voucherNumber, "INTERCO-PARENT-%"),
                like(vouchers.voucherNumber, "INTERCO-LUB-%") // Also match old format
              ),
              like(vouchers.description, `%${targetCompany.name}%`)
            )
          );
        
        for (const v of parentIntercoVouchers) {
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, v.id));
          await db.delete(vouchers).where(eq(vouchers.id, v.id));
          totalReversed++;
          details.push({ company: `${parentCompany.name} (for ${targetCompany.name})`, voucherNumber: v.voucherNumber, amount: v.totalAmount || "0" });
        }
        
        res.json({
          message: `Reversed ${totalReversed} inter-company vouchers for ${company.name} (parent: ${parentCompany.name})`,
          reversed: totalReversed,
          details,
          processedCompanies: 1
        });
      } catch (error: any) {
        console.error("Reverse PO credits error:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // ==========================================
  // Reset Company Data (Admin only)
  // Deletes Payment/Receipt/Journal vouchers for selected company
  // ==========================================
  
  app.post(
    "/api/admin/reset-company-data",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { companyId } = req.body;
        
        if (!companyId) {
          return res.status(400).json({ message: "Please select a company to reset." });
        }
        
        const company = await storage.getCompanyById(companyId);
        if (!company) {
          return res.status(400).json({ message: "Company not found." });
        }
        
        // Define voucher types to DELETE (Payment, Receipt, Journal - excluding POS, Production, Consumption, Stock Transfer)
        const voucherTypesToDelete = ["Payment", "Receipt", "Journal"];
        
        // Get all vouchers of these types for this company
        const vouchersToDelete = await db
          .select()
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              inArray(vouchers.voucherType, voucherTypesToDelete)
            )
          );
        
        let deletedVoucherCount = 0;
        let deletedEntryCount = 0;
        const details: Array<{ voucherType: string; voucherNumber: string; amount: string }> = [];
        
        // Delete voucher entries first, then vouchers (respecting foreign keys)
        for (const v of vouchersToDelete) {
          // Count entries for this voucher
          const entries = await db
            .select()
            .from(voucherEntries)
            .where(eq(voucherEntries.voucherId, v.id));
          
          deletedEntryCount += entries.length;
          
          // Delete entries
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, v.id));
          
          // Delete voucher
          await db.delete(vouchers).where(eq(vouchers.id, v.id));
          deletedVoucherCount++;
          
          details.push({
            voucherType: v.voucherType,
            voucherNumber: v.voucherNumber,
            amount: v.totalAmount || "0"
          });
        }
        
        // Summary by type
        const typeSummary = voucherTypesToDelete.map(type => ({
          type,
          count: details.filter(d => d.voucherType === type).length
        }));
        
        res.json({
          message: `Reset complete for ${company.name}. Deleted ${deletedVoucherCount} voucher(s) and ${deletedEntryCount} entries.`,
          deletedVouchers: deletedVoucherCount,
          deletedEntries: deletedEntryCount,
          typeSummary,
          preserved: ["Containers", "Container Offloads", "Inventory", "Locations", "Ledger Accounts", "POS Vouchers", "Production/Consumption/Stock Transfer Vouchers", "Purchase Orders"]
        });
      } catch (error: any) {
        console.error("Reset company data error:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // System Settings - Parent Company (Admin only)
  app.get(
    "/api/system/parent-company",
    requireAuth,
    async (req, res) => {
      try {
        const parentCompanyId = await storage.getParentCompanyId();
        res.json({ parentCompanyId });
      } catch (error: any) {
        console.error("Get parent company error:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  app.post(
    "/api/system/parent-company",
    requireAuth,
    async (req, res) => {
      try {
        // Only Admin can change parent company setting
        const userRole = req.session.currentRole;
        if (userRole !== "Admin" && userRole !== "Developer") {
          return res.status(403).json({ message: "Only Admin users can change the parent company setting" });
        }

        const { parentCompanyId } = req.body;
        
        // Validate parentCompanyId is null or a valid number
        if (parentCompanyId !== null && parentCompanyId !== undefined) {
          const numericId = typeof parentCompanyId === 'string' ? parseInt(parentCompanyId, 10) : parentCompanyId;
          if (typeof numericId !== 'number' || isNaN(numericId)) {
            return res.status(400).json({ message: "Invalid parent company ID: must be a number or null" });
          }
          
          // Validate the company exists
          const company = await storage.getCompanyById(numericId);
          if (!company) {
            return res.status(400).json({ message: "Company not found" });
          }
          
          await storage.setParentCompanyId(numericId);
          res.json({ success: true, parentCompanyId: numericId });
        } else {
          // Setting to null (clear the parent company)
          await storage.setParentCompanyId(null);
          res.json({ success: true, parentCompanyId: null });
        }
      } catch (error: any) {
        console.error("Set parent company error:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // Company Data Reset - Delete vouchers (keep OTW container vouchers only) and clear opening balances
  app.post("/api/admin/company-data-reset", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const { companyId, accountIds, clearStockOpeningBalances } = req.body;

      if (!companyId || !Array.isArray(accountIds)) {
        return res.status(400).json({ message: "companyId and accountIds array are required" });
      }

      const results = {
        vouchersDeleted: 0,
        openingBalancesCleared: 0,
        stockOpeningBalancesCleared: 0,
      };

      // Start a transaction
      await db.transaction(async (tx) => {
        // 1. Get OTW container numbers to preserve their Purchase vouchers
        const otwContainers = await tx
          .select({ containerNumber: containers.containerNumber })
          .from(containers)
          .where(
            and(
              eq(containers.companyId, companyId),
              eq(containers.status, "OTW")
            )
          );
        
        const otwContainerNumbers = otwContainers.map(c => c.containerNumber);
        console.log("OTW containers to preserve:", otwContainerNumbers);

        // 2. Get inter-company credit account IDs (accounts with "Credit" in name - e.g., "KINSHASA Credit")
        const interCompanyAccounts = await tx
          .select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, companyId),
              sql`"ledger_accounts"."name" ILIKE '%Credit%'`
            )
          );
        const interCompanyAccountIds = new Set(interCompanyAccounts.map(a => a.id));
        console.log("Inter-company credit accounts to preserve:", interCompanyAccounts.map(a => a.name));

        // 3. Get voucher IDs that have entries involving inter-company credit accounts
        const interCompanyAccountIdArray = [...interCompanyAccountIds];
        const interCompanyVoucherEntries = interCompanyAccountIdArray.length > 0 
          ? await tx
              .select({ voucherId: voucherEntries.voucherId })
              .from(voucherEntries)
              .where(inArray(voucherEntries.ledgerAccountId, interCompanyAccountIdArray))
          : [];
        const interCompanyVoucherIds = new Set(interCompanyVoucherEntries.map(e => e.voucherId));
        console.log("Vouchers involving inter-company accounts to preserve:", interCompanyVoucherIds.size);

        // 4. Get ALL vouchers for this company
        const allVouchers = await tx
          .select({ id: vouchers.id, voucherType: vouchers.voucherType, description: vouchers.description })
          .from(vouchers)
          .where(eq(vouchers.companyId, companyId));

        // 5. Filter out vouchers that should be preserved:
        //    - Purchase vouchers that belong to OTW containers
        //    - Any vouchers involving inter-company credit accounts
        const vouchersToDelete = allVouchers.filter(v => {
          // Preserve vouchers that involve inter-company credit accounts
          if (interCompanyVoucherIds.has(v.id)) {
            console.log("Preserving inter-company voucher:", v.id, v.voucherType, v.description);
            return false; // Don't delete
          }
          
          // If it's a Purchase voucher, check if it belongs to an OTW container
          if (v.voucherType === "Purchase") {
            // Check if any OTW container number is in the description
            const belongsToOtw = otwContainerNumbers.some(cn => 
              v.description && v.description.includes(cn)
            );
            if (belongsToOtw) {
              console.log("Preserving OTW voucher:", v.id, v.description);
              return false; // Don't delete - it's for an OTW container
            }
          }
          return true; // Delete all other vouchers
        });
        const voucherIdsToDelete = vouchersToDelete.map(v => v.id);
        console.log("Vouchers to delete:", voucherIdsToDelete.length);
        console.log("Vouchers preserved (OTW + inter-company):", allVouchers.length - voucherIdsToDelete.length);

        if (voucherIdsToDelete.length > 0) {
          // SOFT DELETE vouchers only - DON'T delete voucher entries
          // This allows undo to work properly
          await tx
            .update(vouchers)
            .set({ deletedAt: new Date() })
            .where(inArray(vouchers.id, voucherIdsToDelete));

          results.vouchersDeleted = voucherIdsToDelete.length;
        }

        // 4. Clear opening balances for selected accounts
        if (accountIds.length > 0) {
          await tx
            .update(ledgerAccounts)
            .set({ openingBalance: "0", openingBalanceSide: null })
            .where(
              and(
                eq(ledgerAccounts.companyId, companyId),
                inArray(ledgerAccounts.id, accountIds)
              )
            );

          results.openingBalancesCleared = accountIds.length;
        }

        // 5. Clear stock item opening balances if requested
        if (clearStockOpeningBalances) {
          // Count first
          const stockItemCount = await tx
            .select({ count: sql<number>`count(*)` })
            .from(stockItems)
            .where(eq(stockItems.companyId, companyId));
          
          results.stockOpeningBalancesCleared = Number(stockItemCount[0]?.count) || 0;

          await tx
            .update(stockItems)
            .set({ openingQty: "0", openingRate: "0", openingValue: "0" })
            .where(eq(stockItems.companyId, companyId));
        }
      });

      console.log(`Company data reset completed for company ${companyId}:`, results);
      res.json({ success: true, results });
    } catch (error: any) {
      console.error("Company data reset error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Undo Last Reset - Restore soft-deleted vouchers for a company
  app.post("/api/admin/undo-company-reset", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const { companyId } = req.body;

      if (!companyId) {
        return res.status(400).json({ message: "companyId is required" });
      }

      // Restore soft-deleted vouchers by clearing deletedAt
      const result = await db
        .update(vouchers)
        .set({ deletedAt: null })
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNotNull(vouchers.deletedAt)
          )
        )
        .returning({ id: vouchers.id });

      const restoredCount = result.length;

      console.log(`Undo reset completed for company ${companyId}: restored ${restoredCount} vouchers`);
      res.json({ 
        success: true, 
        message: `Restored ${restoredCount} vouchers`,
        vouchersRestored: restoredCount 
      });
    } catch (error: any) {
      console.error("Undo company reset error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/rebuild-inventory", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const { dryRun = true } = req.body;

      const staleOptionalTrue = await db
        .select({
          stId: stockTransferVouchers.id,
          voucherId: stockTransferVouchers.voucherId,
        })
        .from(stockTransferVouchers)
        .innerJoin(vouchers, eq(vouchers.id, stockTransferVouchers.voucherId))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.optional, true),
            eq(stockTransferVouchers.inventoryApplied, true),
            isNull(vouchers.deletedAt)
          )
        );

      const staleNonOptionalFalse = await db
        .select({
          stId: stockTransferVouchers.id,
          voucherId: stockTransferVouchers.voucherId,
        })
        .from(stockTransferVouchers)
        .innerJoin(vouchers, eq(vouchers.id, stockTransferVouchers.voucherId))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.optional, false),
            eq(stockTransferVouchers.inventoryApplied, false),
            isNull(vouchers.deletedAt)
          )
        );

      const staleFlagsTotalCount = staleOptionalTrue.length + staleNonOptionalFalse.length;

      if (!dryRun) {
        if (staleOptionalTrue.length > 0) {
          await db
            .update(stockTransferVouchers)
            .set({ inventoryApplied: false })
            .where(
              inArray(
                stockTransferVouchers.id,
                staleOptionalTrue.map((f) => f.stId)
              )
            );
        }
        if (staleNonOptionalFalse.length > 0) {
          await db
            .update(stockTransferVouchers)
            .set({ inventoryApplied: true })
            .where(
              inArray(
                stockTransferVouchers.id,
                staleNonOptionalFalse.map((f) => f.stId)
              )
            );
        }
      }

      const expectedInv = new Map<string, { quantity: number; totalValue: number }>();

      function addToExpected(locationId: number, stockItemId: number, qty: number, value: number) {
        const key = `${locationId}-${stockItemId}`;
        const existing = expectedInv.get(key) || { quantity: 0, totalValue: 0 };
        existing.quantity += qty;
        existing.totalValue += value;
        expectedInv.set(key, existing);
      }

      const allOffloads = await db
        .select({
          offloadId: containerOffloads.id,
          locationId: containerOffloads.locationId,
          containerId: containerOffloads.containerId,
        })
        .from(containerOffloads)
        .innerJoin(containers, eq(containers.id, containerOffloads.containerId))
        .where(eq(containers.companyId, companyId));

      for (const offload of allOffloads) {
        const offloadItems = await db
          .select()
          .from(containerOffloadItems)
          .where(eq(containerOffloadItems.offloadId, offload.offloadId));

        if (offloadItems.length > 0) {
          for (const item of offloadItems) {
            const qty = parseFloat(item.quantity || "0");
            const val = parseFloat(item.totalValue || "0");
            if (qty !== 0) {
              addToExpected(offload.locationId, item.stockItemId, qty, val);
            }
          }
        } else {
          const pos = await db
            .select()
            .from(purchaseOrders)
            .where(eq(purchaseOrders.containerId, offload.containerId));
          for (const po of pos) {
            const lineItems = await db
              .select()
              .from(poLineItems)
              .where(eq(poLineItems.poId, po.id));
            for (const li of lineItems) {
              const qty = parseFloat(li.quantity || "0");
              const val = parseFloat(li.lineTotal || "0");
              if (qty !== 0) {
                addToExpected(offload.locationId, li.stockItemId, qty, val);
              }
            }
          }
        }
      }

      const activeTransfers = await db
        .select({
          stId: stockTransferVouchers.id,
          sourceLocationId: stockTransferVouchers.sourceLocationId,
          destinationLocationId: stockTransferVouchers.destinationLocationId,
        })
        .from(stockTransferVouchers)
        .innerJoin(vouchers, eq(vouchers.id, stockTransferVouchers.voucherId))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );

      for (const transfer of activeTransfers) {
        const items = await db
          .select()
          .from(stockTransferItems)
          .where(eq(stockTransferItems.transferId, transfer.stId));

        for (const item of items) {
          const qty = parseFloat(item.quantity || "0");
          const rate = parseFloat(item.rate || "0");
          const val = qty * rate;
          if (qty !== 0) {
            const srcLoc = item.sourceLocationId || transfer.sourceLocationId;
            if (srcLoc) {
              addToExpected(srcLoc, item.stockItemId, -qty, -val);
            }
            addToExpected(transfer.destinationLocationId, item.stockItemId, qty, val);
          }
        }
      }

      const activeAdjustments = await db
        .select({
          adjId: stockAdjustmentVouchers.id,
          locationId: stockAdjustmentVouchers.locationId,
          adjustmentType: stockAdjustmentVouchers.adjustmentType,
        })
        .from(stockAdjustmentVouchers)
        .innerJoin(vouchers, eq(vouchers.id, stockAdjustmentVouchers.voucherId))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );

      for (const adj of activeAdjustments) {
        const items = await db
          .select()
          .from(stockAdjustmentItems)
          .where(eq(stockAdjustmentItems.adjustmentId, adj.adjId));

        for (const item of items) {
          let qty = parseFloat(item.quantity || "0");
          const rate = parseFloat(item.rate || "0");
          if (adj.adjustmentType === "Consumption") {
            qty = -Math.abs(qty);
          } else if (adj.adjustmentType === "Production") {
            qty = Math.abs(qty);
          }
          const val = qty * rate;
          if (qty !== 0) {
            addToExpected(adj.locationId, item.stockItemId, qty, val);
          }
        }
      }

      const activeSalesVouchers = await db
        .select({
          vId: vouchers.id,
          locationId: vouchers.locationId,
        })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.voucherType, "Sales"),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false),
            isNotNull(vouchers.locationId)
          )
        );

      for (const sale of activeSalesVouchers) {
        if (!sale.locationId) continue;
        const items = await db
          .select()
          .from(salesItems)
          .where(eq(salesItems.voucherId, sale.vId));

        for (const item of items) {
          const qty = parseFloat(item.quantity || "0");
          const costPrice = parseFloat(item.costPrice || "0");
          if (qty !== 0) {
            addToExpected(sale.locationId, item.stockItemId, -qty, -(qty * costPrice));
          }
        }
      }

      const activeCreditDebitVouchers = await db
        .select({
          vId: vouchers.id,
          voucherType: vouchers.voucherType,
        })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            or(
              eq(vouchers.voucherType, "Credit Note"),
              eq(vouchers.voucherType, "Debit Note")
            ),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );

      for (const note of activeCreditDebitVouchers) {
        const items = await db
          .select()
          .from(creditNoteItems)
          .where(eq(creditNoteItems.voucherId, note.vId));

        for (const item of items) {
          const qty = parseFloat(item.quantity || "0");
          const cost = parseFloat(item.inventoryCost || item.rate || "0");
          if (qty !== 0) {
            if (note.voucherType === "Credit Note") {
              addToExpected(item.locationId, item.stockItemId, qty, qty * cost);
            } else {
              addToExpected(item.locationId, item.stockItemId, -qty, -(qty * cost));
            }
          }
        }
      }

      const currentInventory = await db
        .select()
        .from(inventory)
        .where(eq(inventory.companyId, companyId));

      const currentMap = new Map<string, { id: number; quantity: number; totalValue: number }>();
      for (const inv of currentInventory) {
        const key = `${inv.locationId}-${inv.stockItemId}`;
        currentMap.set(key, {
          id: inv.id,
          quantity: parseFloat(inv.quantity || "0"),
          totalValue: parseFloat(inv.totalValue || "0"),
        });
      }

      const allKeys = new Set([...expectedInv.keys(), ...currentMap.keys()]);
      const discrepancies: Array<{
        locationId: number;
        stockItemId: number;
        currentQty: number;
        expectedQty: number;
        difference: number;
        currentValue: number;
        expectedValue: number;
      }> = [];

      for (const key of allKeys) {
        const [locStr, itemStr] = key.split("-");
        const locationId = parseInt(locStr);
        const stockItemId = parseInt(itemStr);
        const expected = expectedInv.get(key) || { quantity: 0, totalValue: 0 };
        const current = currentMap.get(key) || { id: 0, quantity: 0, totalValue: 0 };

        const qtyDiff = Math.abs(expected.quantity - current.quantity);
        const valDiff = Math.abs(expected.totalValue - current.totalValue);
        if (qtyDiff > 0.001 || valDiff > 0.01) {
          discrepancies.push({
            locationId,
            stockItemId,
            currentQty: current.quantity,
            expectedQty: parseFloat(expected.quantity.toFixed(3)),
            difference: parseFloat((expected.quantity - current.quantity).toFixed(3)),
            currentValue: current.totalValue,
            expectedValue: parseFloat(expected.totalValue.toFixed(2)),
          });
        }
      }

      let fixesApplied = 0;
      if (!dryRun && discrepancies.length > 0) {
        await db.transaction(async (tx) => {
          for (const d of discrepancies) {
            const key = `${d.locationId}-${d.stockItemId}`;
            const current = currentMap.get(key);
            const avgRate = d.expectedQty !== 0 ? d.expectedValue / d.expectedQty : 0;

            if (current && current.id) {
              await tx
                .update(inventory)
                .set({
                  quantity: d.expectedQty.toFixed(3),
                  totalValue: d.expectedValue.toFixed(2),
                  averageRate: avgRate.toFixed(2),
                  lastUpdated: new Date(),
                })
                .where(eq(inventory.id, current.id));
            } else {
              await tx.insert(inventory).values({
                companyId,
                locationId: d.locationId,
                stockItemId: d.stockItemId,
                quantity: d.expectedQty.toFixed(3),
                totalValue: d.expectedValue.toFixed(2),
                averageRate: avgRate.toFixed(2),
                lastUpdated: new Date(),
              });
            }
            fixesApplied++;
          }
        });
      }

      const companyLocations = await db.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.companyId, companyId));
      const companyStockItems = await db.select({ id: stockItems.id, name: stockItems.name, code: stockItems.code }).from(stockItems).where(eq(stockItems.companyId, companyId));
      const locationMap = new Map(companyLocations.map((l) => [l.id, l.name]));
      const stockItemMap = new Map(companyStockItems.map((s) => [s.id, { name: s.name, code: s.code }]));

      const enrichedDiscrepancies = discrepancies.map((d) => ({
        ...d,
        locationName: locationMap.get(d.locationId) || `Location #${d.locationId}`,
        stockItemName: stockItemMap.get(d.stockItemId)?.name || `Item #${d.stockItemId}`,
        stockItemCode: stockItemMap.get(d.stockItemId)?.code || "",
      }));

      res.json({
        success: true,
        dryRun,
        staleFlagsFound: staleFlagsTotalCount,
        staleFlagsFixed: dryRun ? 0 : staleFlagsTotalCount,
        staleFlagDetails: {
          optionalWithAppliedTrue: staleOptionalTrue.length,
          nonOptionalWithAppliedFalse: staleNonOptionalFalse.length,
        },
        totalInventoryRecords: currentInventory.length,
        discrepanciesFound: discrepancies.length,
        fixesApplied,
        discrepancies: enrichedDiscrepancies,
        warnings: [
          "Quick adjustments (manual add/subtract) are not backed by vouchers and cannot be replayed. They may appear as discrepancies.",
        ],
      });
    } catch (error: any) {
      console.error("Rebuild inventory error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Credit/Debit Note - handles customer returns with stock restoration
  // Separates refund rate (customer refund) from inventory cost (actual cost)
  app.get("/api/inventory/negative", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { search, locationId, stockGroupId } = req.query;

      const conditions = [
        eq(inventory.companyId, companyId),
        sql`CAST(${inventory.quantity} AS numeric) < 0`,
      ];

      if (locationId) {
        conditions.push(eq(inventory.locationId, parseInt(locationId as string)));
      }

      const results = await db
        .select({
          inventoryId: inventory.id,
          locationId: inventory.locationId,
          locationName: locations.name,
          stockItemId: inventory.stockItemId,
          code: stockItems.code,
          name: stockItems.name,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
          totalValue: inventory.totalValue,
          groupName: stockGroups.name,
          groupId: stockItems.stockGroupId,
        })
        .from(inventory)
        .innerJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
        .where(and(...conditions))
        .orderBy(locations.name, stockItems.code);

      let filtered = results;

      if (stockGroupId) {
        const gid = parseInt(stockGroupId as string);
        filtered = filtered.filter(r => r.groupId === gid);
      }

      if (search) {
        const s = (search as string).toLowerCase();
        filtered = filtered.filter(r =>
          r.code.toLowerCase().includes(s) ||
          r.name.toLowerCase().includes(s) ||
          r.locationName.toLowerCase().includes(s)
        );
      }

      res.json(filtered);
    } catch (error: any) {
      console.error("Negative inventory error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/vouchers/:id/finalize", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const voucherId = parseInt(req.params.id);
      if (isNaN(voucherId)) return res.status(400).json({ message: "Invalid voucher ID" });

      const [voucher] = await db
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, companyId)));

      if (!voucher) return res.status(404).json({ message: "Voucher not found" });
      if (!voucher.optional) return res.status(400).json({ message: "Voucher is already finalized" });

      // For stock transfers: apply inventory changes on finalization
      const updated = await db.transaction(async (tx) => {
        if (voucher.voucherType === "Stock Transfer" || voucher.voucherType === "StockTransfer") {
          const [transferRecord] = await tx
            .select()
            .from(stockTransferVouchers)
            .where(eq(stockTransferVouchers.voucherId, voucherId));

          if (transferRecord) {
            const items = await tx
              .select()
              .from(stockTransferItems)
              .where(eq(stockTransferItems.transferId, transferRecord.id));

            for (const item of items) {
              const srcId = item.sourceLocationId || transferRecord.sourceLocationId;
              const qty = parseFloat(item.quantity);
              const rate = parseFloat(item.rate || "0");
              if (srcId && qty > 0) {
                await adjustInventory(tx, srcId, item.stockItemId, -qty, companyId);
                await adjustInventory(tx, transferRecord.destinationLocationId, item.stockItemId, qty, companyId, rate);
              }
            }

            await tx
              .update(stockTransferVouchers)
              .set({ inventoryApplied: true })
              .where(eq(stockTransferVouchers.id, transferRecord.id));
          }
        }

        const [updated] = await tx
          .update(vouchers)
          .set({ optional: false })
          .where(eq(vouchers.id, voucherId))
          .returning();
        return updated;
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Finalize voucher error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/dev/seed", async (req, res) => {
    if (process.env.NODE_ENV !== "development") {
      return res.status(403).json({ message: "Dev seed only available in development" });
    }
    try {
      const { runDevSeed } = await import("../seedDev");
      const summary = await runDevSeed();
      console.log("\n=== SEED DATA SUMMARY ===");
      console.log(`Products: ${summary.products}`);
      console.log(`Bales: ${summary.bales}`);
      console.log(`Label Prints: ${summary.labelPrints} (${summary.scannedLabels} scanned)`);
      console.log(`\nSample ARTICLE codes: ${summary.sampleArticleCodes.join(", ")}`);
      console.log(`Sample REFERENCE numbers: ${summary.sampleReferenceNumbers.join(", ")}`);
      console.log("========================\n");
      res.json(summary);
    } catch (error: any) {
      console.error("Seed error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ==========================================
  // ERP User Page Access
  // ==========================================

  app.get(
    "/api/erp-user-page-access/:userId",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const pageKeys = await storage.getErpUserPageAccess(companyId, req.params.userId);
        res.json({ pageKeys });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  app.put(
    "/api/erp-user-page-access/:userId",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const { pageKeys } = req.body;
        if (!Array.isArray(pageKeys)) return res.status(400).json({ message: "pageKeys must be an array" });
        await storage.setErpUserPageAccess(companyId, req.params.userId, pageKeys);
        res.json({ message: "Page access updated", pageKeys });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  app.get(
    "/api/erp-user-hidden-costs/:userId",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const fields = await storage.getErpUserHiddenCostFields(req.params.userId);
        res.json({ hiddenCostFields: fields });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  app.put(
    "/api/erp-user-hidden-costs/:userId",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { hiddenCostFields } = req.body;
        if (!Array.isArray(hiddenCostFields)) return res.status(400).json({ message: "hiddenCostFields must be an array" });
        await storage.setErpUserHiddenCostFields(req.params.userId, hiddenCostFields);
        res.json({ message: "Cost visibility updated", hiddenCostFields });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  app.get(
    "/api/my-erp-pages",
    requireAuth,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        const role = req.session.currentRole;
        const userId = req.user?.id;
        if (!companyId || !role || !userId) return res.status(400).json({ message: "No company or role selected" });
        const hiddenErpCostFields = await storage.getErpUserHiddenCostFields(userId);
        if (role === "Admin" || role === "Developer") {
          return res.json({ pageKeys: [...FEATURE_KEYS], fullAccess: true, hiddenErpCostFields: [] });
        }
        const pageKeys = await storage.getErpUserPageAccess(companyId, userId);
        res.json({ pageKeys, fullAccess: false, hiddenErpCostFields });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // ── File Folders ──────────────────────────────────────────────
  app.get("/api/file-folders", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company context" });
      const folders = await db.select().from(fileFolders)
        .where(eq(fileFolders.companyId, companyId))
        .orderBy(asc(fileFolders.name));
      res.json(folders);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/file-folders", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company context" });
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Folder name required" });
      const [folder] = await db.insert(fileFolders).values({ companyId, name: name.trim() }).returning();
      res.json(folder);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.patch("/api/file-folders/:id", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const folderId = parseInt(req.params.id);
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Folder name required" });
      const [updated] = await db.update(fileFolders)
        .set({ name: name.trim() })
        .where(and(eq(fileFolders.id, folderId), eq(fileFolders.companyId, companyId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Folder not found" });
      res.json(updated);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.delete("/api/file-folders/:id", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const folderId = parseInt(req.params.id);
      const filesInFolder = await db.select({ id: storedFiles.id }).from(storedFiles)
        .where(and(eq(storedFiles.companyId, companyId), eq(storedFiles.folderId, folderId)));
      if (filesInFolder.length > 0) {
        return res.status(409).json({ message: `Folder has ${filesInFolder.length} file(s). Move or delete them first.`, fileCount: filesInFolder.length });
      }
      const [deleted] = await db.delete(fileFolders)
        .where(and(eq(fileFolders.id, folderId), eq(fileFolders.companyId, companyId)))
        .returning({ id: fileFolders.id });
      if (!deleted) return res.status(404).json({ message: "Folder not found" });
      res.json({ message: "Folder deleted" });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  // ── File Storage ─────────────────────────────────────────────
  app.get("/api/files", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company context" });
      const files = await db
        .select({
          id: storedFiles.id,
          folderId: storedFiles.folderId,
          fileName: storedFiles.fileName,
          displayName: storedFiles.displayName,
          fileType: storedFiles.fileType,
          fileSize: storedFiles.fileSize,
          description: storedFiles.description,
          uploadedBy: storedFiles.uploadedBy,
          uploadedAt: storedFiles.uploadedAt,
        })
        .from(storedFiles)
        .where(eq(storedFiles.companyId, companyId))
        .orderBy(desc(storedFiles.uploadedAt));
      res.json(files);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/files/upload", requireAuth, upload.single("file"), async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company context" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const { description, folderId } = req.body;
      const fileData = req.file.buffer.toString("base64");
      const folderIdNum = folderId ? parseInt(folderId) : null;
      const [inserted] = await db.insert(storedFiles).values({
        companyId,
        folderId: folderIdNum,
        fileName: req.file.originalname,
        displayName: null,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
        fileData,
        description: description || null,
        uploadedBy: null,
      }).returning({ id: storedFiles.id });
      res.json({ id: inserted.id, message: "File uploaded successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/files/:id", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const fileId = parseInt(req.params.id);
      const { displayName, folderId } = req.body;
      const updates: any = {};
      if (displayName !== undefined) updates.displayName = displayName || null;
      if (folderId !== undefined) updates.folderId = folderId === null ? null : parseInt(folderId);
      if (Object.keys(updates).length === 0) return res.status(400).json({ message: "Nothing to update" });
      const [updated] = await db.update(storedFiles).set(updates)
        .where(and(eq(storedFiles.id, fileId), eq(storedFiles.companyId, companyId)))
        .returning({ id: storedFiles.id });
      if (!updated) return res.status(404).json({ message: "File not found" });
      res.json({ message: "File updated" });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/files/:id/download", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const fileId = parseInt(req.params.id);
      const [file] = await db.select().from(storedFiles).where(
        and(eq(storedFiles.id, fileId), eq(storedFiles.companyId, companyId))
      );
      if (!file) return res.status(404).json({ message: "File not found" });
      const buffer = Buffer.from(file.fileData, "base64");
      const outName = file.displayName || file.fileName;
      res.set("Content-Type", file.fileType);
      res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(outName)}"`);
      res.set("Content-Length", buffer.length.toString());
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/files/:id/preview", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const fileId = parseInt(req.params.id);
      const [file] = await db.select().from(storedFiles).where(
        and(eq(storedFiles.id, fileId), eq(storedFiles.companyId, companyId))
      );
      if (!file) return res.status(404).json({ message: "File not found" });
      const buffer = Buffer.from(file.fileData, "base64");
      res.set("Content-Type", file.fileType);
      res.set("Content-Disposition", `inline; filename="${encodeURIComponent(file.displayName || file.fileName)}"`);
      res.set("Content-Length", buffer.length.toString());
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/files/:id", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const fileId = parseInt(req.params.id);
      const [deleted] = await db.delete(storedFiles).where(
        and(eq(storedFiles.id, fileId), eq(storedFiles.companyId, companyId))
      ).returning({ id: storedFiles.id });
      if (!deleted) return res.status(404).json({ message: "File not found" });
      res.json({ message: "File deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Spreadsheets ───────────────────────────────────────────────────────────
  app.get("/api/spreadsheets", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const list = await storage.listSpreadsheets(companyId);
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/spreadsheets/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const id = parseInt(req.params.id);
      const sheet = await storage.getSpreadsheet(id, companyId);
      if (!sheet) return res.status(404).json({ message: "Spreadsheet not found" });
      res.json(sheet);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/spreadsheets", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const username = req.session?.username ?? req.session?.userId ?? "Unknown";
      const { name, data } = req.body;
      const sheet = await storage.createSpreadsheet(companyId, name || "Untitled Spreadsheet", data ?? [], username);
      res.status(201).json(sheet);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/spreadsheets/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const id = parseInt(req.params.id);
      const { name, data } = req.body;
      const fields: { name?: string; data?: any } = {};
      if (name !== undefined) fields.name = name;
      if (data !== undefined) fields.data = data;
      const sheet = await storage.updateSpreadsheet(id, companyId, fields);
      if (!sheet) return res.status(404).json({ message: "Spreadsheet not found" });
      res.json(sheet);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/spreadsheets/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const id = parseInt(req.params.id);
      await storage.deleteSpreadsheet(id, companyId);
      res.json({ message: "Spreadsheet deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Live Spreadsheet Links ───

  app.get("/api/live-spreadsheets", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const isAdmin = req.session?.currentRole === "Admin" || req.session?.currentRole === "Owner" || req.session?.currentRole === "Developer";
      const sheets = await storage.getLiveSpreadsheets(companyId, !isAdmin);
      res.json(sheets);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/live-spreadsheets", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const role = req.session?.currentRole;
      if (role !== "Admin" && role !== "Owner" && role !== "Developer") {
        return res.status(403).json({ message: "Admin or Owner role required" });
      }
      const companyId = req.session?.currentCompanyId;
      const parsed = insertLiveSpreadsheetSchema.parse({ ...req.body, companyId });
      const sheet = await storage.createLiveSpreadsheet(parsed);
      res.json(sheet);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/live-spreadsheets/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const role = req.session?.currentRole;
      if (role !== "Admin" && role !== "Owner" && role !== "Developer") {
        return res.status(403).json({ message: "Admin or Owner role required" });
      }
      const companyId = req.session?.currentCompanyId;
      const id = parseInt(req.params.id);
      const fields = insertLiveSpreadsheetSchema.partial().parse(req.body);
      const sheet = await storage.updateLiveSpreadsheet(id, companyId, fields);
      if (!sheet) return res.status(404).json({ message: "Not found" });
      res.json(sheet);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/live-spreadsheets/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const role = req.session?.currentRole;
      if (role !== "Admin" && role !== "Owner" && role !== "Developer") {
        return res.status(403).json({ message: "Admin or Owner role required" });
      }
      const companyId = req.session?.currentCompanyId;
      const id = parseInt(req.params.id);
      await storage.deleteLiveSpreadsheet(id, companyId);
      res.json({ message: "Deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/repair-inventory-values/preview", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const detectResult = await db.execute(
        sql`SELECT i.id, i.location_id, i.stock_item_id, i.quantity, i.average_rate, i.total_value,
                   l.name AS location_name,
                   si.name AS stock_item_name
            FROM inventory i
            LEFT JOIN locations l ON l.id = i.location_id
            LEFT JOIN stock_items si ON si.id = i.stock_item_id
            WHERE i.company_id = ${companyId}
            AND (
              (CAST(i.quantity AS DECIMAL) <= 0 AND CAST(i.total_value AS DECIMAL) > 0.01)
              OR CAST(i.average_rate AS DECIMAL) < 0
              OR (CAST(i.quantity AS DECIMAL) > 0 AND CAST(i.total_value AS DECIMAL) < -0.01)
              OR (CAST(i.quantity AS DECIMAL) <= 0 AND ABS(CAST(i.average_rate AS DECIMAL)) > 0.001)
            )`
      );

      const corruptedRows = detectResult.rows || detectResult;

      if (!corruptedRows || corruptedRows.length === 0) {
        return res.json({ rows: [] });
      }

      const previewRows: any[] = [];
      for (const row of corruptedRows as any[]) {
        const qty = parseFloat(row.quantity || "0");
        const oldRate = parseFloat(row.average_rate || "0");
        const oldValue = parseFloat(row.total_value || "0");

        let newValue = oldValue;
        let newRate = oldRate;
        const reasons: string[] = [];

        if (qty <= 0 && oldValue > 0.01) reasons.push("qty <= 0 but value > 0");
        if (oldRate < 0) reasons.push("negative average_rate");
        if (qty > 0 && oldValue < -0.01) reasons.push("qty > 0 but total_value < 0");
        if (qty <= 0 && Math.abs(oldRate) > 0.001) reasons.push("qty <= 0 but rate != 0");

        if (qty <= 0) {
          newValue = 0;
          newRate = 0;
        } else if (qty > 0 && oldValue < 0) {
          newValue = 0;
          newRate = 0;
        } else if (oldRate < 0) {
          newRate = 0;
        }

        previewRows.push({
          id: row.id,
          locationId: row.location_id,
          locationName: row.location_name || "Unknown",
          stockItemId: row.stock_item_id,
          stockItemName: row.stock_item_name || "Unknown",
          quantity: qty,
          oldRate,
          oldValue,
          newRate,
          newValue,
          reason: reasons.join("; "),
        });
      }

      res.json({ rows: previewRows });
    } catch (error: any) {
      console.error("Inventory repair preview error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/repair-inventory-values", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const detectResult = await db.execute(
        sql`SELECT id, location_id, stock_item_id, quantity, average_rate, total_value
            FROM inventory
            WHERE company_id = ${companyId}
            AND (
              (CAST(quantity AS DECIMAL) <= 0 AND CAST(total_value AS DECIMAL) > 0.01)
              OR CAST(average_rate AS DECIMAL) < 0
              OR (CAST(quantity AS DECIMAL) > 0 AND CAST(total_value AS DECIMAL) < -0.01)
              OR (CAST(quantity AS DECIMAL) <= 0 AND ABS(CAST(average_rate AS DECIMAL)) > 0.001)
            )`
      );

      const corruptedRows = detectResult.rows || detectResult;

      if (!corruptedRows || corruptedRows.length === 0) {
        return res.json({ message: "No corrupted inventory rows found", corrected: 0, rows: [] });
      }

      const correctedRows: any[] = [];
      for (const row of corruptedRows as any[]) {
        const qty = parseFloat(row.quantity || "0");
        const oldRate = parseFloat(row.average_rate || "0");
        const oldValue = parseFloat(row.total_value || "0");

        let newValue = oldValue;
        let newRate = oldRate;

        if (qty <= 0) {
          newValue = 0;
          newRate = 0;
        } else if (qty > 0 && oldValue < 0) {
          newValue = 0;
          newRate = 0;
        } else if (oldRate < 0) {
          newRate = 0;
        }

        await db.execute(
          sql`UPDATE inventory
              SET total_value = ${newValue.toFixed(2)},
                  average_rate = ${newRate.toFixed(2)},
                  last_updated = NOW()
              WHERE id = ${row.id}`
        );

        correctedRows.push({
          id: row.id,
          locationId: row.location_id,
          stockItemId: row.stock_item_id,
          quantity: qty,
          oldRate,
          oldValue,
          newRate,
          newValue,
        });

        console.log(`[InventoryRepair] Corrected row id=${row.id} loc=${row.location_id} item=${row.stock_item_id}: qty=${qty} rate=${oldRate}->${newRate} value=${oldValue}->${newValue}`);
      }

      res.json({
        message: `Repaired ${correctedRows.length} corrupted inventory rows`,
        corrected: correctedRows.length,
        rows: correctedRows,
      });
    } catch (error: any) {
      console.error("Inventory repair error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================
  // NET PROFIT EXCEL EXPORT
  // ============================================================
  app.get("/api/agent-accounts", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const rows = await db.select().from(agentAccounts).where(eq(agentAccounts.companyId, companyId));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/agent-accounts", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { accountId, accountType, accountName } = req.body;
      if (!accountId || !accountType || !accountName) return res.status(400).json({ message: "accountId, accountType, and accountName are required" });
      const [row] = await db.insert(agentAccounts)
        .values({ companyId, accountId, accountType, accountName })
        .onConflictDoUpdate({ target: [agentAccounts.companyId, agentAccounts.accountId], set: { accountName, accountType } })
        .returning();
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/agent-accounts/:accountId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accountId = decodeURIComponent(req.params.accountId);
      await db.delete(agentAccounts).where(and(eq(agentAccounts.companyId, companyId), eq(agentAccounts.accountId, accountId)));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── FREIGHT ACCOUNTS (Financial Snapshot) ─────────────────────────────────
  app.get("/api/freight-accounts", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const rows = await db.select().from(freightAccounts).where(eq(freightAccounts.companyId, companyId));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/freight-accounts", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { accountId, accountType, accountName } = req.body;
      if (!accountId || !accountType || !accountName) return res.status(400).json({ message: "accountId, accountType, and accountName are required" });
      const [row] = await db.insert(freightAccounts)
        .values({ companyId, accountId, accountType, accountName })
        .onConflictDoUpdate({ target: [freightAccounts.companyId, freightAccounts.accountId], set: { accountName, accountType } })
        .returning();
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/freight-accounts/:accountId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accountId = decodeURIComponent(req.params.accountId);
      await db.delete(freightAccounts).where(and(eq(freightAccounts.companyId, companyId), eq(freightAccounts.accountId, accountId)));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── SNAPSHOT PINNED ACCOUNTS (supplier / customer / advance + future cards) ─
  const ALLOWED_CARD_KEYS = new Set(["supplier", "customer", "advance"]);

  app.get("/api/snapshot-pinned-accounts/:cardKey", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { cardKey } = req.params;
      if (!ALLOWED_CARD_KEYS.has(cardKey)) return res.status(400).json({ message: "Invalid cardKey" });
      const rows = await db.select().from(snapshotPinnedAccounts)
        .where(and(eq(snapshotPinnedAccounts.companyId, companyId), eq(snapshotPinnedAccounts.cardKey, cardKey)));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/snapshot-pinned-accounts/:cardKey", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { cardKey } = req.params;
      if (!ALLOWED_CARD_KEYS.has(cardKey)) return res.status(400).json({ message: "Invalid cardKey" });
      const { accountId, accountType, accountName } = req.body;
      if (!accountId || !accountType || !accountName) return res.status(400).json({ message: "accountId, accountType, and accountName are required" });
      const [row] = await db.insert(snapshotPinnedAccounts)
        .values({ companyId, cardKey, accountId, accountType, accountName })
        .onConflictDoUpdate({
          target: [snapshotPinnedAccounts.companyId, snapshotPinnedAccounts.cardKey, snapshotPinnedAccounts.accountId],
          set: { accountName, accountType },
        })
        .returning();
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/snapshot-pinned-accounts/:cardKey/:accountId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { cardKey } = req.params;
      if (!ALLOWED_CARD_KEYS.has(cardKey)) return res.status(400).json({ message: "Invalid cardKey" });
      const accountId = decodeURIComponent(req.params.accountId);
      await db.delete(snapshotPinnedAccounts).where(
        and(
          eq(snapshotPinnedAccounts.companyId, companyId),
          eq(snapshotPinnedAccounts.cardKey, cardKey),
          eq(snapshotPinnedAccounts.accountId, accountId),
        )
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCOUNT MIGRATION — move ledger accounts + their statements between companies
  // Supports migrating multiple accounts at once in a single atomic transaction.
  // Voucher exclusivity is evaluated against the whole batch: a voucher that
  // touches only accounts within the migrating batch is moved entirely.
  // ═══════════════════════════════════════════════════════════════════════════

  // List all companies (for source/destination pickers)
  app.get("/api/admin/account-migration/companies", requireAuth, requireRole("Admin", "Developer"), async (req: any, res: any) => {
    try {
      const all = await storage.getAllCompanies();
      res.json(all);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // List ledger accounts in a company
  app.get("/api/admin/account-migration/accounts/:companyId", requireAuth, requireRole("Admin", "Developer"), async (req: any, res: any) => {
    try {
      const companyId = parseInt(req.params.companyId);
      if (isNaN(companyId)) return res.status(400).json({ message: "Invalid companyId" });
      const accounts = await storage.getAllLedgerAccounts(companyId, true);
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Preview a batch migration — accepts accountIds array
  app.post("/api/admin/account-migration/preview", requireAuth, requireRole("Admin", "Developer"), async (req: any, res: any) => {
    try {
      const { accountIds, srcCompanyId, destCompanyId } = req.body;
      if (!Array.isArray(accountIds) || accountIds.length === 0 || !srcCompanyId || !destCompanyId)
        return res.status(400).json({ message: "accountIds (array), srcCompanyId and destCompanyId are required" });
      if (srcCompanyId === destCompanyId)
        return res.status(400).json({ message: "Source and destination must be different companies" });

      const batchSet = new Set<number>(accountIds);

      const accountPreviews = [];
      let grandTotalDebit = 0;
      let grandTotalCredit = 0;
      let grandTotalEntries = 0;

      for (const accountId of accountIds) {
        // Verify account belongs to source company
        const [account] = await db.select().from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, srcCompanyId)));
        if (!account)
          return res.status(404).json({ message: `Account ${accountId} not found in source company` });

        // Get all voucher entries for this account
        const entryRows = await db.select({
          voucherId: voucherEntries.voucherId,
          debit: voucherEntries.debitAmount,
          credit: voucherEntries.creditAmount,
        }).from(voucherEntries).where(eq(voucherEntries.ledgerAccountId, accountId));

        const totalDebit  = entryRows.reduce((s, r) => s + parseFloat(r.debit  || "0"), 0);
        const totalCredit = entryRows.reduce((s, r) => s + parseFloat(r.credit || "0"), 0);
        grandTotalDebit  += totalDebit;
        grandTotalCredit += totalCredit;
        grandTotalEntries += entryRows.length;

        const touchedVoucherIds = [...new Set(entryRows.map(r => r.voucherId))];

        // A voucher is exclusive to the batch if ALL its entry accounts are in the batch
        let exclusiveVoucherCount = 0;
        let sharedVoucherCount = 0;
        for (const vid of touchedVoucherIds) {
          const allEntries = await db.select({ la: voucherEntries.ledgerAccountId })
            .from(voucherEntries).where(eq(voucherEntries.voucherId, vid));
          const outsideAccounts = allEntries.filter(e => e.la !== null && !batchSet.has(e.la));
          if (outsideAccounts.length === 0) exclusiveVoucherCount++;
          else sharedVoucherCount++;
        }

        // Check code conflict in destination
        const [codeConflict] = await db.select().from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.companyId, destCompanyId), eq(ledgerAccounts.code, account.code)));

        accountPreviews.push({
          account,
          entryCount: entryRows.length,
          totalDebit,
          totalCredit,
          touchedVoucherCount: touchedVoucherIds.length,
          exclusiveVoucherCount,
          sharedVoucherCount,
          codeConflict: codeConflict ? { id: codeConflict.id, name: codeConflict.name } : null,
        });
      }

      const srcCompany  = await storage.getCompanyById(srcCompanyId);
      const destCompany = await storage.getCompanyById(destCompanyId);

      res.json({
        accounts: accountPreviews,
        srcCompany,
        destCompany,
        grandTotalEntries,
        grandTotalDebit,
        grandTotalCredit,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Execute a batch migration — moves all accounts atomically in one transaction
  app.post("/api/admin/account-migration/execute", requireAuth, requireRole("Admin", "Developer"), async (req: any, res: any) => {
    try {
      const { accountIds, srcCompanyId, destCompanyId } = req.body;
      if (!Array.isArray(accountIds) || accountIds.length === 0 || !srcCompanyId || !destCompanyId)
        return res.status(400).json({ message: "accountIds (array), srcCompanyId and destCompanyId are required" });
      if (srcCompanyId === destCompanyId)
        return res.status(400).json({ message: "Source and destination must be different companies" });

      const batchSet = new Set<number>(accountIds);

      // Build per-account plan (code conflict resolution + entry counts)
      const accountPlans: Array<{
        account: any;
        originalCode: string;
        finalCode: string;
        entryCount: number;
        touchedVoucherIds: number[];
      }> = [];

      // Track ALL voucher IDs touched by ANY account in the batch
      const allTouchedVoucherIds = new Set<number>();

      for (const accountId of accountIds) {
        const [account] = await db.select().from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, srcCompanyId)));
        if (!account)
          return res.status(404).json({ message: `Account ${accountId} not found in source company` });

        // Auto-resolve code conflict with -MIGRATED suffix
        const [codeConflict] = await db.select().from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.companyId, destCompanyId), eq(ledgerAccounts.code, account.code)));
        const finalCode = codeConflict ? `${account.code}-MIGRATED` : account.code;

        const entryRows = await db.select({ voucherId: voucherEntries.voucherId })
          .from(voucherEntries).where(eq(voucherEntries.ledgerAccountId, accountId));
        const touchedVoucherIds = [...new Set(entryRows.map(r => r.voucherId))];
        touchedVoucherIds.forEach(v => allTouchedVoucherIds.add(v));

        accountPlans.push({ account, originalCode: account.code, finalCode, entryCount: entryRows.length, touchedVoucherIds });
      }

      // Determine which vouchers are exclusive to this batch
      // (all their entries belong to accounts in the batch)
      const exclusiveVoucherIds: number[] = [];
      for (const vid of allTouchedVoucherIds) {
        const allEntries = await db.select({ la: voucherEntries.ledgerAccountId })
          .from(voucherEntries).where(eq(voucherEntries.voucherId, vid));
        const outsideAccounts = allEntries.filter(e => e.la !== null && !batchSet.has(e.la));
        if (outsideAccounts.length === 0) exclusiveVoucherIds.push(vid);
      }

      // ── Execute everything in one atomic transaction ────────────────────────
      await db.transaction(async (tx) => {
        for (const plan of accountPlans) {
          await tx.update(ledgerAccounts)
            .set({ companyId: destCompanyId, code: plan.finalCode, parentId: null })
            .where(eq(ledgerAccounts.id, plan.account.id));
        }
        if (exclusiveVoucherIds.length > 0) {
          await tx.update(vouchers)
            .set({ companyId: destCompanyId })
            .where(inArray(vouchers.id, exclusiveVoucherIds));
        }
      });

      const sharedVoucherCount = allTouchedVoucherIds.size - exclusiveVoucherIds.length;
      const totalEntries = accountPlans.reduce((s, p) => s + p.entryCount, 0);

      console.log(
        `[AccountMigration] Batch of ${accountIds.length} account(s) moved from company ${srcCompanyId} → ${destCompanyId}. ` +
        `${totalEntries} entries, ${exclusiveVoucherIds.length} vouchers moved, ${sharedVoucherCount} shared vouchers left in source.`
      );

      res.json({
        success: true,
        srcCompanyId,
        destCompanyId,
        totalEntries,
        movedVoucherIds: exclusiveVoucherIds,
        movedVoucherCount: exclusiveVoucherIds.length,
        sharedVoucherCount,
        accounts: accountPlans.map(p => ({
          accountId: p.account.id,
          accountName: p.account.name,
          originalCode: p.originalCode,
          finalCode: p.finalCode,
          entryCount: p.entryCount,
          wasRenamed: p.originalCode !== p.finalCode,
        })),
      });
    } catch (error: any) {
      console.error("[AccountMigration] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Undo a batch migration — moves all accounts back atomically
  app.post("/api/admin/account-migration/undo", requireAuth, requireRole("Admin", "Developer"), async (req: any, res: any) => {
    try {
      const { accounts, movedVoucherIds, srcCompanyId, destCompanyId } = req.body;
      // accounts = [{ accountId, originalCode }]
      if (!Array.isArray(accounts) || accounts.length === 0 || !srcCompanyId || !destCompanyId)
        return res.status(400).json({ message: "accounts (array), srcCompanyId and destCompanyId are required" });

      // Sanity-check: all accounts should currently be in destCompany
      for (const a of accounts) {
        const [row] = await db.select({ id: ledgerAccounts.id }).from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, a.accountId), eq(ledgerAccounts.companyId, destCompanyId)));
        if (!row)
          return res.status(404).json({
            message: `Account ${a.accountId} not found in destination company — it may have already been moved or re-migrated.`,
          });
      }

      await db.transaction(async (tx) => {
        for (const a of accounts) {
          await tx.update(ledgerAccounts)
            .set({ companyId: srcCompanyId, code: a.originalCode, parentId: null })
            .where(eq(ledgerAccounts.id, a.accountId));
        }
        if (Array.isArray(movedVoucherIds) && movedVoucherIds.length > 0) {
          await tx.update(vouchers)
            .set({ companyId: srcCompanyId })
            .where(inArray(vouchers.id, movedVoucherIds));
        }
      });

      console.log(
        `[AccountMigration] UNDO: ${accounts.length} account(s) moved back from company ${destCompanyId} → ${srcCompanyId}. ` +
        `${(movedVoucherIds ?? []).length} vouchers restored.`
      );

      res.json({
        success: true,
        restoredAccountCount: accounts.length,
        restoredVoucherCount: (movedVoucherIds ?? []).length,
      });
    } catch (error: any) {
      console.error("[AccountMigration] Undo error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Deployment migration diagnostics ────────────────────────────────────────
  // Returns counts (no sensitive data) useful for verifying a Render deploy.
  app.get("/api/admin/deployment-diagnostics", requireAuth, requireRole("Admin", "Developer"), async (_req, res) => {
    try {
      const VALID_ROLES = `'Developer','Admin','Owner','Manager','POS','Normal User'`;
      const OLD_POS_ROLES = `'POS1','POS2','POS3','POS4','POS5','POS6'`;

      const [
        invalidRoleRows,
        posWithoutStation,
        posWithoutLocation,
        posWithoutCash,
        duplicateRoleRows,
        oldUserRoleRows,
        oldPosRoleRows,
        canDeleteCol,
        posStationCol,
      ] = await Promise.all([
        db.execute(
          `SELECT COUNT(*)::int AS n FROM user_company_roles WHERE role NOT IN (${VALID_ROLES})`
        ),
        db.execute(
          `SELECT COUNT(*)::int AS n FROM user_company_roles WHERE role = 'POS' AND pos_station IS NULL`
        ),
        db.execute(
          `SELECT COUNT(*)::int AS n FROM user_company_roles WHERE role = 'POS' AND assigned_location_id IS NULL`
        ),
        db.execute(
          `SELECT COUNT(*)::int AS n FROM user_company_roles WHERE role = 'POS' AND cash_account_id IS NULL`
        ),
        db.execute(
          `SELECT COUNT(*)::int AS n FROM (
             SELECT user_id, company_id, COUNT(*) FROM user_company_roles
             GROUP BY user_id, company_id HAVING COUNT(*) > 1
           ) sub`
        ),
        db.execute(
          `SELECT COUNT(*)::int AS n FROM user_company_roles WHERE role = 'User'`
        ),
        db.execute(
          `SELECT COUNT(*)::int AS n FROM user_company_roles WHERE role IN (${OLD_POS_ROLES})`
        ),
        db.execute(
          `SELECT COUNT(*)::int AS n FROM information_schema.columns
           WHERE table_name = 'user_company_roles' AND column_name = 'can_delete_records'`
        ),
        db.execute(
          `SELECT COUNT(*)::int AS n FROM information_schema.columns
           WHERE table_name = 'user_company_roles' AND column_name = 'pos_station'`
        ),
      ]);

      const pick = (r: any) => Number((r.rows ?? r)[0]?.n ?? 0);

      res.json({
        timestamp: new Date().toISOString(),
        schema: {
          can_delete_records_column_exists: pick(canDeleteCol) > 0,
          pos_station_column_exists: pick(posStationCol) > 0,
        },
        roles: {
          invalid_role_count: pick(invalidRoleRows),
          old_user_role_count: pick(oldUserRoleRows),
          old_pos_role_count: pick(oldPosRoleRows),
        },
        pos_users: {
          without_pos_station: pick(posWithoutStation),
          without_assigned_location: pick(posWithoutLocation),
          without_cash_account: pick(posWithoutCash),
        },
        user_company_roles: {
          duplicate_user_company_pairs: pick(duplicateRoleRows),
        },
        health: {
          all_clear:
            pick(invalidRoleRows) === 0 &&
            pick(oldUserRoleRows) === 0 &&
            pick(oldPosRoleRows) === 0 &&
            pick(canDeleteCol) > 0 &&
            pick(posStationCol) > 0,
        },
      });
    } catch (error: any) {
      console.error("[DeploymentDiag] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Fix orphaned RESERVED_FOR_ORDER bales ────────────────────────────────
  // Returns any bale stuck in RESERVED_FOR_ORDER that has no active customer
  // order (non-deleted, status LOADING / PENDING_VERIFICATION / VERIFIED)
  // referencing it back to IN_STOCK. Safe to run multiple times.
  app.post("/api/admin/fix-orphaned-bales", requireAuth, requireRole("Admin", "Owner"), async (_req, res) => {
    try {
      const result = await db.execute(sql`
        UPDATE factory_bales
        SET status = 'IN_STOCK', updated_at = NOW()
        WHERE status = 'RESERVED_FOR_ORDER'
          AND deleted_at IS NULL
          AND id NOT IN (
            SELECT cob.bale_id
            FROM customer_order_bales cob
            INNER JOIN customer_orders co ON co.id = cob.order_id
            WHERE co.deleted_at IS NULL
              AND co.status IN ('LOADING', 'PENDING_VERIFICATION', 'VERIFIED')
          )
        RETURNING id
      `);
      const fixed = (result as any).rows?.length ?? 0;
      res.json({ fixed, message: fixed > 0 ? `Restored ${fixed} bale(s) to IN_STOCK` : "No orphaned bales found" });
    } catch (error: any) {
      console.error("[BaleOrphanFix] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

}
