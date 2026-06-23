import type { Express } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../../auth";
import { requireActionAccess } from "../../lib/permissionMiddleware";
import {
  upload,
  logAudit,
  getCurrentExchangeRate,
  calculateHistoricalLocationInventory,
  syncEmployeeBalancesFromEntries,
  snapshotVoucherEntries,
  buildVoucherChangesForCreate,
  buildVoucherChangesForUpdate,
  buildItemLevelChanges,
} from "../_helpers";
import { triggerIntercompanyNotifications } from "../intercompanyNotificationRoutes";
import { autoReallocateLoansAccounts } from "../../lib/transporterAllocation";
import {
  inventory,
  stockItems,
  stockGroups,
  stockItemCodeAliases,
  stockItemLocationPrices,
  stockTransferVouchers,
  stockTransferItems,
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
  spreadsheets,
  liveSpreadsheets,
  agentAccounts,
  insertAgentAccountSchema,
  salaryAdvances,
  salaryAdvanceDeductions,
  insertSalaryAdvanceSchema,
  insertSalaryAdvanceDeductionSchema,
  chatMessages,
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
import { checkAccountWhatsAppRule } from "../factoryWhatsappRoutes";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../../netPositionHelper";
import path from "path";
import fs from "fs";

import { registerVoucherEntryRoutes } from "../voucherEntryRoutes";
import { recalculateOrderTotals } from "../factory/_helpers";
import {
  customerOrderCharges,
  customerOrders,
  customerOrderBales,
  customerOrderLines,
  factorySettings as fSettings,
  factoryDaybookEntries as fde,
} from "@shared/schema";

/**
 * After saving a journal voucher, if it has a customer entry + a ledger account entry,
 * look for order charges linked to that ledger account for that customer.
 * If exactly one charge is found, update its amount and recalculate the order totals.
 */

export function registerVoucherQueryRoutes(app: Express) {
  app.get("/api/vouchers", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const { startDate, endDate } = req.query;

      // Check if user is POS role
      const isPOS = req.session.currentRole === "POS";

      let vouchers;
      if (startDate && endDate) {
        vouchers = await storage.getVouchersByDateRange(
          req.session.currentCompanyId,
          startDate as string,
          endDate as string
        );
      } else {
        // No date range supplied — default to the last 90 days so we never do
        // a full-table scan. The UI already shows this window by default.
        // getVouchersByDateRange hits the vouchers_company_date_idx index.
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 90);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        vouchers = await storage.getVouchersByDateRange(req.session.currentCompanyId, fmt(start), fmt(end));
      }

      // Strip totalAmount from Stock Transfer vouchers for POS users
      let sanitizedVouchers = isPOS
        ? vouchers.map((v: any) => {
            // Check for all variants of Stock Transfer voucher type
            const isStockTransfer =
              v.voucherType === "Stock Transfer" ||
              v.voucherType === "StockTransfer" ||
              v.voucherType?.toLowerCase().includes("stock transfer");
            if (isStockTransfer) {
              const { totalAmount, ...rest } = v;
              return { ...rest, totalAmount: "0" };
            }
            return v;
          })
        : vouchers;

      // For POS users, only return vouchers from their assigned locations.
      // Ownership is NOT checked here — POS users can see all sales from their location
      // (not just their own). Ownership is enforced at detail/edit/send-invoice endpoints.
      if (isPOS && req.user?.id) {
        const assignedLocs = await db
          .select({ locationId: userLocations.locationId })
          .from(userLocations)
          .where(
            and(eq(userLocations.userId, req.user.id), eq(userLocations.companyId, req.session.currentCompanyId!))
          );
        const allowedLocIds = assignedLocs.map((l: any) => l.locationId);
        if (allowedLocIds.length > 0) {
          sanitizedVouchers = sanitizedVouchers.filter(
            (v: any) => v.locationId === null || allowedLocIds.includes(v.locationId)
          );
        }
      }

      res.json(sanitizedVouchers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get unified ledger for a supplier across all companies
  app.get("/api/suppliers/:supplierId/unified-ledger", requireAuth, async (req, res) => {
    try {
      const supplierId = parseInt(req.params.supplierId);

      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      const { companyId, startDate, endDate } = req.query;
      const filterCompanyId = companyId ? parseInt(companyId as string) : undefined;

      // Get voucher entries (filtered by company if specified)
      const voucherEntries = await storage.getVoucherEntriesBySupplier(
        supplierId,
        filterCompanyId,
        startDate as string | undefined,
        endDate as string | undefined
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
      const primaryCompanyId = companies.length > 0 ? Math.min(...companies.map((c: any) => c.id)) : null;
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
  });

  // Get purchase orders for a specific supplier filtered by company
  app.get("/api/suppliers/:supplierId/purchase-orders", requireAuth, async (req, res) => {
    try {
      const supplierId = parseInt(req.params.supplierId);

      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      const { companyId } = req.query;
      const filterCompanyId = companyId ? parseInt(companyId as string) : undefined;

      if (!filterCompanyId) {
        // If no company filter, get POs from all companies
        const companies = await storage.getAllCompanies();
        const allPOs: any[] = [];

        for (const company of companies) {
          const pos = await storage.getPurchaseOrdersBySupplier(supplierId, company.id);
          allPOs.push(...pos.map((po) => ({ ...po, companyName: company.name })));
        }

        return res.json(allPOs);
      }

      const purchaseOrders = await storage.getPurchaseOrdersBySupplier(supplierId, filterCompanyId);
      const company = await storage.getCompanyById(filterCompanyId);
      const posWithCompanyName = purchaseOrders.map((po) => ({
        ...po,
        companyName: company?.name,
      }));

      res.json(posWithCompanyName);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create a new voucher

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
        filtered = filtered.filter(
          (r) =>
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
        return res.status(403).json({
          message: "Access denied: Voucher belongs to a different company",
        });
      }

      // POS users can only access their own Sales vouchers
      if (req.user?.role === "POS" && voucher.voucherType === "Sales" && voucher.userId !== req.user.id) {
        return res.status(403).json({ message: "Access denied" });
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
        const items = await db.select().from(salesItems).where(eq(salesItems.voucherId, id));

        if (items.length > 0) {
          const itemsWithDetails = await Promise.all(
            items.map(async (item) => {
              const stockItem = await storage.getStockItemById(item.stockItemId);

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
            })
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
              const stockItem = await storage.getStockItemById(item.stockItemId);
              return {
                ...item,
                stockItemCode: stockItem?.code || "",
                stockItemName: stockItem?.name || "",
                stockItemUom: stockItem?.uom || "",
              };
            })
          );

          const location = await storage.getLocationById(adjustment[0].locationId);

          adjustmentData = {
            ...adjustment[0],
            locationName: location?.name || "",
            items: itemsWithDetails,
          };
        } else {
          // No adjustment record exists - return empty structure so frontend can show form
          let adjustmentType = "production";
          if (voucher.voucherType === "Consumption") adjustmentType = "consumption";
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
              const stockItem = await storage.getStockItemById(item.stockItemId);
              return {
                ...item,
                stockItemCode: stockItem?.code || "",
                stockItemName: stockItem?.name || "",
                stockItemUom: stockItem?.uom || "",
              };
            })
          );

          const sourceLocation = await storage.getLocationById(transfer[0].sourceLocationId!);
          const destLocation = await storage.getLocationById(transfer[0].destinationLocationId!);

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
}
