import { getClientDate } from "../../lib/dateUtils";
import { isReadonlyMigratedVoucher, READONLY_MIGRATED_VOUCHER_MESSAGE } from "../../lib/migratedVoucherGuard";
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
import { computeRawBalance } from "./userManagementRoutes";
import {
  factoryCategories,
  factoryBaleProducts,
  factoryContainers,
  factoryRawStock,
  factoryRawMaterialAdjustments,
  factoryMixBatches,
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

export function registerAdminRepairRoutes(app: Express) {
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
      const existingAdjustment = await db.select().from(systemSettings).where(eq(systemSettings.key, settingKey));
      const currentAdjustment = existingAdjustment.length > 0 ? parseFloat(existingAdjustment[0].value || "0") : 0;

      const newAdjustment = -rawBalance;

      // Atomic upsert — avoids race conditions and duplicate key errors
      await db
        .insert(systemSettings)
        .values({ key: settingKey, value: newAdjustment.toFixed(2) })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: newAdjustment.toFixed(2), updatedAt: new Date() },
        });

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

      const results: Array<{
        companyId: number;
        companyName: string;
        rawBalance: number;
        newAdjustment: number | null;
        skipped: boolean;
      }> = [];

      for (const company of allCompanies) {
        const rawBalance = await computeRawBalance(company.id);
        const skipped = Math.abs(rawBalance) <= 0.01;
        const newAdjustment = skipped ? null : -rawBalance;

        if (!skipped) {
          const settingKey = `equity_adjustment_${company.id}`;
          await db
            .insert(systemSettings)
            .values({ key: settingKey, value: newAdjustment!.toFixed(2) })
            .onConflictDoUpdate({
              target: systemSettings.key,
              set: { value: newAdjustment!.toFixed(2), updatedAt: new Date() },
            });
        }

        results.push({ companyId: company.id, companyName: company.name, rawBalance, newAdjustment, skipped });
      }

      const adjustedCount = results.filter((r) => !r.skipped).length;
      const skippedCount = results.filter((r) => r.skipped).length;

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
        .where(and(eq(vouchers.companyId, companyId), isNotNull(vouchers.deletedAt)));

      // Also find completely orphaned salesItems (no voucher at all) - these are dangerous orphans
      // Get all salesItem voucherIds that don't have corresponding vouchers
      const allSalesItemVoucherIds = await db.selectDistinct({ voucherId: salesItems.voucherId }).from(salesItems);

      const existingVoucherIds = new Set((await db.select({ id: vouchers.id }).from(vouchers)).map((v) => v.id));

      const trulyOrphanedVoucherIds = allSalesItemVoucherIds
        .filter((item) => !existingVoucherIds.has(item.voucherId))
        .map((item) => item.voucherId);

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
        .where(and(eq(vouchers.companyId, companyId), isNotNull(vouchers.deletedAt)));

      // Also find completely orphaned entries (no voucher at all)
      const allEntryVoucherIds = await db.selectDistinct({ voucherId: voucherEntries.voucherId }).from(voucherEntries);

      const trulyOrphanedEntryVoucherIds = allEntryVoucherIds
        .filter((item) => item.voucherId && !existingVoucherIds.has(item.voucherId))
        .map((item) => item.voucherId);

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
        .where(and(eq(inventory.companyId, companyId), sql`CAST(${inventory.quantity} AS DECIMAL) < 0`));

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
        explanation:
          "These vouchers have a locationId that points to a deleted or non-existent location. They are orphaned and can be safely deleted.",
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

      const voucherIds = orphanedVouchers.map((v) => v.id);

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
        voucherNumbers: orphanedVouchers.map((v) => v.voucherNumber),
      });
    } catch (error: any) {
      console.error("Delete orphaned POS sales error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Role Feature Permissions API
  // Get all role permissions for the current company

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
          const pos = await db.select().from(purchaseOrders).where(eq(purchaseOrders.containerId, offload.containerId));
          for (const po of pos) {
            const lineItems = await db.select().from(poLineItems).where(eq(poLineItems.poId, po.id));
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
        .where(and(eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));

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
        .where(and(eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));

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
        const items = await db.select().from(salesItems).where(eq(salesItems.voucherId, sale.vId));

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
            or(eq(vouchers.voucherType, "Credit Note"), eq(vouchers.voucherType, "Debit Note")),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );

      for (const note of activeCreditDebitVouchers) {
        const items = await db.select().from(creditNoteItems).where(eq(creditNoteItems.voucherId, note.vId));

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

      const currentInventory = await db.select().from(inventory).where(eq(inventory.companyId, companyId));

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

      const companyLocations = await db
        .select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(eq(locations.companyId, companyId));
      const companyStockItems = await db
        .select({ id: stockItems.id, name: stockItems.name, code: stockItems.code })
        .from(stockItems)
        .where(eq(stockItems.companyId, companyId));
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

      const conditions = [eq(inventory.companyId, companyId), sql`CAST(${inventory.quantity} AS numeric) < 0`];

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
        filtered = filtered.filter((r) => r.groupId === gid);
      }

      if (search) {
        const s = (search as string).toLowerCase();
        filtered = filtered.filter(
          (r) =>
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
      if (isReadonlyMigratedVoucher(voucher)) {
        return res.status(403).json({ message: READONLY_MIGRATED_VOUCHER_MESSAGE });
      }
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

  app.post("/api/dev/seed", requireAuth, requireRole("Admin"), async (req, res) => {
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

        console.log(
          `[InventoryRepair] Corrected row id=${row.id} loc=${row.location_id} item=${row.stock_item_id}: qty=${qty} rate=${oldRate}->${newRate} value=${oldValue}->${newValue}`
        );
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

  // ── Emergency: force-apply missing voucher column migrations ─────────────
  // Runs ALTER TABLE with no lock timeout so it waits as long as needed.
  // Safe to call multiple times — all statements use IF NOT EXISTS.
}
