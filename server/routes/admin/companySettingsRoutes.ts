import { getClientDate } from "../../lib/dateUtils";
import type { Express } from "express";
import { db, pool } from "../../db";
import { storage } from "../../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../../auth";
import { sqlArray } from "../../lib/sqlArray";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory, syncEmployeeBalancesFromEntries } from "../_helpers";
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
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../../netPositionHelper";
import path from "path";
import fs from "fs";


export function registerCompanySettingsRoutes(app: Express) {
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

  app.post("/api/admin/apply-missing-migrations", requireAuth, requireRole("Admin", "Owner", "Developer"), async (_req, res) => {
    const client = await pool.connect();
    const results: { sql: string; status: string; error?: string }[] = [];
    const statements = [
      `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS effective_date date`,
      `ALTER TABLE factory_daybook_entries ADD COLUMN IF NOT EXISTS effective_date date`,
      `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS shift_id integer`,
      `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS location_name text`,
      `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS exchange_rate numeric(20,6)`,
      `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS source_module text DEFAULT 'ERP'`,
      `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS is_credit_sale boolean DEFAULT false`,
      `CREATE TABLE IF NOT EXISTS stock_item_code_aliases (
        id serial PRIMARY KEY,
        company_id integer NOT NULL,
        stock_item_id integer NOT NULL,
        alias_code varchar(50) NOT NULL,
        description text,
        created_at timestamp NOT NULL DEFAULT now()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS stock_item_code_aliases_company_alias_unique ON stock_item_code_aliases (company_id, alias_code)`,
    ];
    try {
      // No lock_timeout — wait as long as needed to acquire the DDL lock
      await client.query(`SET lock_timeout = '0'`);
      await client.query(`SET statement_timeout = '300s'`);
      for (const stmt of statements) {
        const label = stmt.trim().substring(0, 80);
        try {
          await client.query(stmt);
          results.push({ sql: label, status: "ok" });
        } catch (err: any) {
          results.push({ sql: label, status: "error", error: err.message?.split("\n")[0] });
        }
      }
      res.json({ success: true, results });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message, results });
    } finally {
      client.release();
    }
  });

}
