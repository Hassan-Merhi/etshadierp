import { getClientDate } from "../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { classifyNetPositionAccounts } from "../../netPositionHelper";
import { adjustInventory } from "../../inventoryHelper";
import {
  writeDaybookEntry, getOrFetchFxRateToUsd, getOrCreateLedgerAccount,
  isLegacySHA256Hash, verifySupervisorPassword,
} from "./_helpers";
import {
  factorySuppliers, factoryCategories, factoryBaleProducts,
  factoryContainers, factoryRawStock, factoryMixBatches,
  factoryMixBatchSources, factoryDailyUsages, factoryPressingBatches,
  factoryBales, factoryBaleSequences, factoryContainerCommissions,
  baleLabelPrints, stockItems, stockGroups, users,
  insertFactorySupplierSchema, insertFactoryCategorySchema,
  insertFactoryBaleProductSchema, insertFactoryContainerSchema,
  insertFactoryRawStockSchema, insertFactoryMixBatchSchema,
  insertFactoryMixBatchSourceSchema, insertFactoryPressingBatchSchema,
  insertFactoryBaleSchema, customerProformas, customerProformaLines,
  customerOrders, customerOrderLines, customerOrderBales,
  customerOrderCharges, customerInvoiceSequences, customerBalances,
  customers, insertCustomerSchema, ledgerAccounts, voucherEntries,
  companies, locations, userCompanyRoles, insertCustomerProformaSchema,
  insertCustomerProformaLineSchema, insertCustomerOrderSchema,
  factoryFxRates, insertFactoryFxRateSchema, factoryDaybookEntries,
  containerDocumentTypes, containerDocuments, containerFreight,
  containerFreightPayments, factoryDaybookEntryEdits,
  containers, factoryUserProfiles, factoryUserPageAccess,
  insertUserSchema, directMessages, insertDirectMessageSchema,
  userPresence, factoryDutyAuditLog, factoryOffloadAdditionalCharges,
  factoryContainerOtherCharges, companySettings, factorySettings,
  factoryWorkers, factoryWorkerCategories, insertFactoryWorkerCategorySchema,
  factoryRawMaterialAdjustments, factoryPayrolls, factoryWorkerDocuments,
  factoryAlerts, employees, factoryWasteEntries, factoryBalePhotos,
  factoryDailyKpiSnapshots, factorySupplierScoreSnapshots,
  factoryBaleCostSnapshots, factoryContainerProfitSnapshots,
  bankAccounts, inventory, exchangeRates, vouchers, suppliers,
  containerSales, factorySupplierPayments, insertFactorySupplierPaymentSchema,
  factorySupplierFxTransfers, insertFactorySupplierFxTransferSchema,
  factoryFxAllocations, baleRecodeSessions, baleRecodeItems,
  factoryWorkerAdvances, factoryAdvanceRepayments, factoryBaleWasteDispatches,
  factoryPosSales, factoryPosSaleItems, proformaStockReservations,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

import { registerFactoryDaybookRoutes } from "./factoryDaybookRoutes";
import { registerFactoryCustomerProformaRoutes } from "./factoryCustomerProformaRoutes";
import { registerFactoryCustomerOrderRoutes } from "./factoryCustomerOrderRoutes";

export function registerFactoryCustomersRoutes(app: Express) {
  registerFactoryDaybookRoutes(app);
  app.get("/api/factory/customers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allCustomers = await db.select().from(customers)
        .where(and(eq(customers.companyId, companyId), sql`${customers.deletedAt} IS NULL`))
        .orderBy(asc(customers.legalName));

      if (allCustomers.length === 0) {
        return res.json([]);
      }

      const customerIds = allCustomers.map((c) => c.id);

      // Fetch all sales totals in one query
      const salesRows = await db.select({
        customerId: customerOrders.customerId,
        total: sql<string>`COALESCE(SUM(CAST(${customerOrders.grandTotal} AS numeric)), 0)`,
      })
        .from(customerOrders)
        .where(and(
          inArray(customerOrders.customerId, customerIds),
          eq(customerOrders.companyId, companyId),
          eq(customerOrders.status, "FINALIZED"),
        ))
        .groupBy(customerOrders.customerId);

      // Fetch all non-invoice balance adjustments in one query
      const nonInvRows = await db.select({
        customerId: customerBalances.customerId,
        net: sql<string>`COALESCE(SUM(CAST(${customerBalances.debitAmount} AS numeric) - CAST(${customerBalances.creditAmount} AS numeric)), 0)`,
      })
        .from(customerBalances)
        .where(and(
          inArray(customerBalances.customerId, customerIds),
          eq(customerBalances.companyId, companyId),
          sql`${customerBalances.referenceType} IS DISTINCT FROM 'INVOICE'`,
        ))
        .groupBy(customerBalances.customerId);

      // Fetch net voucher entries — two passes to match what the statement page shows:
      // 1. Entries linked via the customer's ledgerAccountId
      // 2. Entries linked directly via customerId (e.g. receipt vouchers)
      // Exclude CHARGE-* vouchers: those amounts are already in salesTotal via grandTotal.
      const ledgerAccountIds = allCustomers
        .filter((c) => c.ledgerAccountId)
        .map((c) => c.ledgerAccountId!);

      // net = debit - credit in Dr-positive convention (customer is an asset / receivable)
      const voucherNetByLedger = new Map<number, number>();
      if (ledgerAccountIds.length > 0) {
        const voucherNetRows = await db.select({
          ledgerAccountId: voucherEntries.ledgerAccountId,
          net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
        })
          .from(voucherEntries)
          .innerJoin(vouchers, and(
            eq(voucherEntries.voucherId, vouchers.id),
            eq(vouchers.companyId, companyId),
            sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`,
          ))
          .where(inArray(voucherEntries.ledgerAccountId as any, ledgerAccountIds))
          .groupBy(voucherEntries.ledgerAccountId);

        for (const row of voucherNetRows) {
          if (row.ledgerAccountId) {
            voucherNetByLedger.set(row.ledgerAccountId, parseFloat(row.net || "0"));
          }
        }
      }

      // Net from entries linked directly via customerId (receipts posted without going through ledger)
      const voucherNetByCustomerId = new Map<number, number>();
      if (customerIds.length > 0) {
        const directRows = await db.select({
          customerId: voucherEntries.customerId,
          net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
        })
          .from(voucherEntries)
          .innerJoin(vouchers, and(
            eq(voucherEntries.voucherId, vouchers.id),
            eq(vouchers.companyId, companyId),
            sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`,
          ))
          .where(and(
            inArray(voucherEntries.customerId as any, customerIds),
            sql`${voucherEntries.ledgerAccountId} IS NULL`,
          ))
          .groupBy(voucherEntries.customerId);

        for (const row of directRows) {
          if (row.customerId) {
            voucherNetByCustomerId.set(row.customerId, parseFloat(row.net || "0"));
          }
        }
      }

      const salesMap = new Map(salesRows.map((r) => [r.customerId, parseFloat(r.total || "0")]));
      const nonInvMap = new Map(nonInvRows.map((r) => [r.customerId, parseFloat(r.net || "0")]));

      const customersWithBalances = allCustomers.map((customer) => {
        const salesTotal = salesMap.get(customer.id) ?? 0;
        const nonInvNet = nonInvMap.get(customer.id) ?? 0;
        const voucherNet = (customer.ledgerAccountId ? (voucherNetByLedger.get(customer.ledgerAccountId) ?? 0) : 0)
          + (voucherNetByCustomerId.get(customer.id) ?? 0);
        const openingBalance = parseFloat(customer.openingBalance || "0");
        const openingSide = customer.openingBalanceSide || "Dr";
        const totalBalance = (openingSide === "Dr" ? openingBalance : -openingBalance) + salesTotal + nonInvNet + voucherNet;
        return { ...customer, balance: Math.abs(totalBalance), balanceSide: totalBalance >= 0 ? "Dr" : "Cr" };
      });

      res.json(customersWithBalances);
    } catch (error: any) {
      console.error("Error fetching factory customers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const dataWithCompany = { ...req.body, companyId };
      const parsed = insertCustomerSchema.parse(dataWithCompany);

      let suffix = 1;
      const allExisting = await db.select().from(customers)
        .where(eq(customers.companyId, companyId));

      const existingCodes = allExisting
        .map((c) => c.code)
        .filter((c) => c.startsWith("CUST"))
        .map((c) => parseInt(c.replace("CUST", "")))
        .filter((n) => !isNaN(n));

      if (existingCodes.length > 0) {
        suffix = Math.max(...existingCodes) + 1;
      }
      let code = `CUST${suffix.toString().padStart(3, "0")}`;

      let codeExists = true;
      while (codeExists) {
        const [dup] = await db.select().from(customers)
          .where(and(eq(customers.code, code), eq(customers.companyId, companyId)));
        if (dup) {
          suffix++;
          code = `CUST${suffix.toString().padStart(3, "0")}`;
        } else {
          codeExists = false;
        }
      }

      const [customer] = await db.insert(customers).values({ ...parsed, code }).returning();

      res.status(201).json(customer);
    } catch (error: any) {
      console.error("Error creating factory customer:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/customers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [existing] = await db.select().from(customers).where(eq(customers.id, customerId));
      if (!existing) return res.status(404).json({ message: "Customer not found" });
      if (existing.companyId !== companyId) return res.status(403).json({ message: "Access denied" });

      if (req.body.code && req.body.code !== existing.code) {
        const [dup] = await db.select().from(customers)
          .where(and(eq(customers.code, req.body.code), eq(customers.companyId, companyId)));
        if (dup) return res.status(400).json({ message: "Customer code already exists" });
      }

      const parsed = insertCustomerSchema.partial().parse(req.body);
      const [updated] = await db.update(customers).set(parsed)
        .where(eq(customers.id, customerId)).returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating factory customer:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [existing] = await db.select().from(customers).where(eq(customers.id, customerId));
      if (!existing) return res.status(404).json({ message: "Customer not found" });
      if (existing.companyId !== companyId) return res.status(403).json({ message: "Access denied" });

      const [deleted] = await db.update(customers)
        .set({ deletedAt: new Date() })
        .where(eq(customers.id, customerId))
        .returning();

      res.json(deleted);
    } catch (error: any) {
      console.error("Error deleting factory customer:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // RESTORE DELETED CUSTOMER
  app.post("/api/factory/customers/:id/restore", requireAuth, async (req: any, res: any) => {
    try {
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [existing] = await db.select().from(customers).where(eq(customers.id, customerId));
      if (!existing) return res.status(404).json({ message: "Customer not found" });
      if (existing.companyId !== companyId) return res.status(403).json({ message: "Access denied" });

      const [restored] = await db.update(customers)
        .set({ deletedAt: null })
        .where(eq(customers.id, customerId))
        .returning();

      res.json(restored);
    } catch (error: any) {
      console.error("Error restoring factory customer:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // LIST DELETED CUSTOMERS
  app.get("/api/factory/customers/deleted", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const deletedCustomers = await db.select().from(customers)
        .where(and(eq(customers.companyId, companyId), sql`${customers.deletedAt} IS NOT NULL`))
        .orderBy(desc(customers.deletedAt));

      res.json(deletedCustomers);
    } catch (error: any) {
      console.error("Error fetching deleted factory customers:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // CUSTOMER STATEMENT
  // ───────────────────────────────────────────────

  app.get("/api/factory/customers/:id/statement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const [customer] = await db.select().from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)));
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      // Get finalized invoices
      const invoices = await db
        .select({
          id: customerOrders.id,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          grandTotal: customerOrders.grandTotal,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          totalWeightKg: sql<string>`COALESCE((SELECT SUM(cob.weight) FROM customer_order_bales cob WHERE cob.order_id = ${customerOrders.id}), 0)`,
          containerNumber: customerOrders.containerNumber,
          destination: customerOrders.destination,
          status: customerOrders.status,
          createdAt: customerOrders.createdAt,
        })
        .from(customerOrders)
        .where(and(
          eq(customerOrders.companyId, companyId),
          eq(customerOrders.customerId, customerId),
          eq(customerOrders.status, "FINALIZED"),
        ))
        .orderBy(desc(customerOrders.createdAt));

      // Build orderId → various field maps for enriching statement rows
      const containerByOrderId = new Map<number, string | null>(
        invoices.map((inv: any) => [inv.id, inv.containerNumber ?? null])
      );
      const destinationByOrderId = new Map<number, string | null>(
        invoices.map((inv: any) => [inv.id, inv.destination ?? null])
      );
      const totalQtyBalesByOrderId = new Map<number, number>(
        invoices.map((inv: any) => [inv.id, inv.totalQtyBales ?? 0])
      );
      const totalWeightKgByOrderId = new Map<number, number>(
        invoices.map((inv: any) => [inv.id, parseFloat(inv.totalWeightKg ?? "0")])
      );

      // Auto-sync: update any INVOICE-type balance rows whose debitAmount differs from
      // the current invoice grandTotal (happens when the invoice was repriced after finalization)
      const invoiceBalanceEntries = await db.select({
        id: customerBalances.id,
        referenceId: customerBalances.referenceId,
        debitAmount: customerBalances.debitAmount,
      }).from(customerBalances)
        .where(and(
          eq(customerBalances.companyId, companyId),
          eq(customerBalances.customerId, customerId),
          eq(customerBalances.referenceType, "INVOICE"),
        ));

      for (const entry of invoiceBalanceEntries) {
        if (!entry.referenceId) continue;
        const [inv] = await db.select({ grandTotal: customerOrders.grandTotal })
          .from(customerOrders)
          .where(eq(customerOrders.id, entry.referenceId));
        if (inv) {
          const storedAmt = parseFloat(entry.debitAmount || "0");
          const actualAmt = parseFloat(inv.grandTotal || "0");
          if (Math.abs(storedAmt - actualAmt) > 0.001) {
            await db.update(customerBalances)
              .set({ debitAmount: String(actualAmt), balance: String(actualAmt) })
              .where(eq(customerBalances.id, entry.id));
          }
        }
      }

      // Get all balance history entries ordered by date
      const balanceRows = await db.select().from(customerBalances)
        .where(and(eq(customerBalances.companyId, companyId), eq(customerBalances.customerId, customerId)))
        .orderBy(customerBalances.transactionDate, customerBalances.id);

      // Also pull voucher entries for this customer (by ledgerAccountId or direct customerId link)
      // to include manual accounting vouchers that don't flow through customerBalances.
      // Exclude CHARGE-* vouchers (those are already included via invoices).
      const voucherRows: any[] = [];
      const ledgerAccountId = (customer as any).ledgerAccountId;
      const voucherConditions = ledgerAccountId
        ? sql`(${voucherEntries.ledgerAccountId} = ${ledgerAccountId} OR ${voucherEntries.customerId} = ${customerId})`
        : sql`${voucherEntries.customerId} = ${customerId}`;

      const rawVoucherRows = await db
        .select({
          id: voucherEntries.id,
          voucherId: voucherEntries.voucherId,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          description: vouchers.description,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
          narration: voucherEntries.narration,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, and(
          eq(voucherEntries.voucherId, vouchers.id),
          eq(vouchers.companyId, companyId),
          sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`,
          sql`${vouchers.voucherNumber} NOT LIKE 'INV-%'`,
        ))
        .where(voucherConditions)
        .orderBy(vouchers.voucherDate, voucherEntries.id);

      // Convert to unified row format matching customerBalances shape
      for (const ve of rawVoucherRows) {
        voucherRows.push({
          id: `ve-${ve.id}`,
          customerId,
          companyId,
          transactionDate: ve.voucherDate,
          transactionType: ve.voucherType || "VOUCHER",
          referenceType: "VOUCHER",
          referenceId: ve.voucherId,
          referenceNumber: ve.voucherNumber,
          description: ve.narration || ve.description || ve.voucherType,
          debitAmount: ve.debitAmount ?? "0",
          creditAmount: ve.creditAmount ?? "0",
          balance: "0",
          _fromVoucher: true,
        });
      }

      // Merge customerBalances + voucher rows, sort by date then id
      const allRows = [...balanceRows.map((r: any) => ({ ...r, _fromVoucher: false })), ...voucherRows]
        .sort((a, b) => {
          const da = (a.transactionDate || "").toString();
          const db2 = (b.transactionDate || "").toString();
          if (da < db2) return -1;
          if (da > db2) return 1;
          // same date: customerBalances rows first (they have numeric ids)
          const ia = a._fromVoucher ? 1 : 0;
          const ib = b._fromVoucher ? 1 : 0;
          return ia - ib;
        });

      // Build running balance
      const openingBalance = parseFloat(customer.openingBalance || "0");
      const openingSide = customer.openingBalanceSide || "Dr";
      let runningBalance = openingSide === "Dr" ? openingBalance : -openingBalance;

      const balanceHistory = allRows.map((row: any) => {
        const debit = parseFloat(row.debitAmount || "0");
        const credit = parseFloat(row.creditAmount || "0");
        runningBalance += debit - credit;
        const containerNumber =
          row.referenceType === "INVOICE" && row.referenceId
            ? (containerByOrderId.get(row.referenceId) ?? null)
            : null;
        const destination =
          row.referenceType === "INVOICE" && row.referenceId
            ? (destinationByOrderId.get(row.referenceId) ?? null)
            : null;
        const totalQtyBales =
          row.referenceType === "INVOICE" && row.referenceId
            ? (totalQtyBalesByOrderId.get(row.referenceId) ?? null)
            : null;
        const totalWeightKg =
          row.referenceType === "INVOICE" && row.referenceId
            ? (totalWeightKgByOrderId.get(row.referenceId) ?? null)
            : null;
        return {
          ...row,
          containerNumber,
          destination,
          totalQtyBales,
          totalWeightKg,
          runningBalance,
          runningBalanceSide: runningBalance >= 0 ? "Dr" : "Cr",
        };
      });

      const currentBalance = Math.abs(runningBalance);
      const currentBalanceSide = runningBalance >= 0 ? "Dr" : "Cr";

      res.json({
        customer,
        invoices,
        balanceHistory,
        currentBalance,
        currentBalanceSide,
        openingBalance,
        openingBalanceSide: openingSide,
      });
    } catch (error: any) {
      console.error("Error fetching customer statement:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Save Statement Note ─────────────────────────────────────────────────
  app.patch("/api/factory/customers/:id/statement-note", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });
      const { statementNote } = req.body;
      if (typeof statementNote !== "string") return res.status(400).json({ message: "statementNote must be a string" });
      const [customer] = await db.select().from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)));
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      await db.update(customers).set({ statementNote: statementNote || null }).where(eq(customers.id, customerId));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Save Row Note on a balance entry ────────────────────────────────────
  app.patch("/api/factory/customers/:customerId/balance/:entryId/note", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const customerId = parseInt(req.params.customerId);
      const entryId = parseInt(req.params.entryId);
      if (isNaN(customerId) || isNaN(entryId)) return res.status(400).json({ message: "Invalid IDs" });
      const { rowNote } = req.body;
      if (typeof rowNote !== "string") return res.status(400).json({ message: "rowNote must be a string" });
      const [entry] = await db.select().from(customerBalances)
        .where(and(eq(customerBalances.id, entryId), eq(customerBalances.customerId, customerId), eq(customerBalances.companyId, companyId)));
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      await db.update(customerBalances).set({ rowNote: rowNote || null }).where(eq(customerBalances.id, entryId));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Customer Statement: PDF Export ──────────────────────────────────────
  app.get("/api/factory/customers/:id/statement/export-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const [customer] = await db.select().from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)));
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));

      const balanceRows = await db.select().from(customerBalances)
        .where(and(eq(customerBalances.companyId, companyId), eq(customerBalances.customerId, customerId)))
        .orderBy(customerBalances.transactionDate, customerBalances.id);

      // Pull voucher entries (same logic as statement endpoint)
      const voucherRowsPdf: any[] = [];
      const ledgerAccountIdPdf = (customer as any).ledgerAccountId;
      const voucherCondPdf = ledgerAccountIdPdf
        ? sql`(${voucherEntries.ledgerAccountId} = ${ledgerAccountIdPdf} OR ${voucherEntries.customerId} = ${customerId})`
        : sql`${voucherEntries.customerId} = ${customerId}`;
      const rawVePdf = await db.select({
        id: voucherEntries.id, voucherId: voucherEntries.voucherId,
        voucherNumber: vouchers.voucherNumber, voucherType: vouchers.voucherType,
        voucherDate: vouchers.voucherDate, description: vouchers.description,
        debitAmount: voucherEntries.debitAmount, creditAmount: voucherEntries.creditAmount,
        narration: voucherEntries.narration,
      }).from(voucherEntries)
        .innerJoin(vouchers, and(eq(voucherEntries.voucherId, vouchers.id), eq(vouchers.companyId, companyId),
          sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`, sql`${vouchers.voucherNumber} NOT LIKE 'INV-%'`))
        .where(voucherCondPdf).orderBy(vouchers.voucherDate, voucherEntries.id);
      for (const ve of rawVePdf) {
        voucherRowsPdf.push({
          transactionDate: ve.voucherDate, transactionType: ve.voucherType || "VOUCHER",
          referenceType: "VOUCHER", referenceNumber: ve.voucherNumber,
          description: ve.narration || ve.description || ve.voucherType,
          debitAmount: ve.debitAmount ?? "0", creditAmount: ve.creditAmount ?? "0", _fromVoucher: true,
        });
      }
      const allRowsPdf = [...balanceRows.map((r: any) => ({ ...r, _fromVoucher: false })), ...voucherRowsPdf]
        .sort((a, b) => {
          const da = (a.transactionDate || "").toString(), db2 = (b.transactionDate || "").toString();
          if (da !== db2) return da < db2 ? -1 : 1;
          return (a._fromVoucher ? 1 : 0) - (b._fromVoucher ? 1 : 0);
        });

      const openingBalance = parseFloat(customer.openingBalance || "0");
      const openingSide = customer.openingBalanceSide || "Dr";
      let runningBalance = openingSide === "Dr" ? openingBalance : -openingBalance;

      // Build container number + destination maps for INVOICE-type rows
      const invoiceRefIds = [...new Set(
        allRowsPdf.filter((r: any) => r.referenceType === "INVOICE" && r.referenceId).map((r: any) => r.referenceId as number)
      )];
      const containerNumMap = new Map<number, string>();
      const destinationMapPdf = new Map<number, string>();
      if (invoiceRefIds.length > 0) {
        const orderContainers = await db
          .select({ id: customerOrders.id, containerNumber: customerOrders.containerNumber, destination: customerOrders.destination })
          .from(customerOrders)
          .where(inArray(customerOrders.id, invoiceRefIds));
        for (const o of orderContainers) {
          if (o.containerNumber) containerNumMap.set(o.id, o.containerNumber);
          if (o.destination) destinationMapPdf.set(o.id, o.destination);
        }
      }

      const rows = allRowsPdf.map((row: any) => {
        const debit = parseFloat(row.debitAmount || "0");
        const credit = parseFloat(row.creditAmount || "0");
        runningBalance += debit - credit;
        // Use container number as description for INVOICE rows
        let desc = row.description || "—";
        let destination = "";
        if (row.referenceType === "INVOICE" && row.referenceId) {
          desc = containerNumMap.get(row.referenceId) || desc;
          destination = destinationMapPdf.get(row.referenceId) || "";
        }
        return { ...row, debit, credit, desc, destination };
      });

      const totalDr = rows.reduce((s: number, r: any) => s + r.debit, 0);
      const totalCr = rows.reduce((s: number, r: any) => s + r.credit, 0);
      const closingBalance = Math.abs(runningBalance);
      const closingBalanceSide = runningBalance >= 0 ? "Dr" : "Cr";

      // Format: $1,234 (no .00 for whole numbers)
      const fmtAmt = (n: number) => {
        if (n <= 0) return "";
        const rounded = Math.round(n * 100) / 100;
        if (Math.abs(rounded - Math.round(rounded)) < 0.005) {
          return `$${Math.round(rounded).toLocaleString("en-US")}`;
        }
        return `$${rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      };
      const fmtBalance = (n: number, side: string) => {
        const rounded = Math.round(n * 100) / 100;
        const numStr = Math.abs(rounded - Math.round(rounded)) < 0.005
          ? `$${Math.round(rounded).toLocaleString("en-US")}`
          : `$${rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        return `${numStr} ${side}`;
      };
      const fmtDate = (d: string) => {
        if (!d) return "";
        const [y, m, day] = d.split("-");
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return `${parseInt(day, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
      };
      const txLabel = (type: string) => {
        const map: Record<string, string> = { SALE: "Sale", PAYMENT: "Payment", RECEIPT: "Receipt", ADJUSTMENT: "Adjustment", JOURNAL: "Journal", OPENING_BALANCE: "Opening Bal." };
        return map[type] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      };

      const PDFDocument = (await import("pdfkit")).default;
      const pathModCust = await import("path");

      // Arabic font + reshaper — always load
      const custFontDir = pathModCust.join(process.cwd(), "server", "fonts");
      const custArabicFontPath = pathModCust.join(custFontDir, "Amiri-Regular.ttf");
      const custHasArabicFont = fs.existsSync(custArabicFontPath);

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      if (custHasArabicFont) doc.registerFont("Arabic", custArabicFontPath);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=statement_${(customer.code || customerId).toString().replace(/\s+/g, "_")}.pdf`);
      doc.pipe(res);

      let custConvAr: ((t: string) => string) | null = null;
      let custBidi: { getEmbeddingLevels: (t: string, d: string) => any; getReorderedString: (t: string, l: any) => string } | null = null;
      try {
        custConvAr = (require("arabic-reshaper") as any).convertArabic;
        custBidi = (require("bidi-js") as any)();
      } catch {}
      const custHasAr = (t: string) => /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(t);
      const custShape = (t: string): string => {
        if (!t || !custConvAr) return t;
        try {
          const r = custConvAr(t);
          if (custBidi) { const lv = custBidi.getEmbeddingLevels(r, "rtl"); return custBidi.getReorderedString(r, lv); }
          return r;
        } catch { return t; }
      };
      const custRender = (text: string, x: number, yPos: number, w: number, align: "left"|"right" = "left") => {
        const ar = custHasArabicFont && custHasAr(text);
        doc.font(ar ? "Arabic" : "Helvetica").fontSize(8)
          .text(ar ? custShape(text) : text, x, yPos, { width: w, align: ar ? "right" : align });
      };

      // ── Logo centred, taller ──
      const pageW = doc.page.width; // 595
      const logoW = 220;
      const logoH = 96;
      const custHmdLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
      if (fs.existsSync(custHmdLogoPath)) {
        try { doc.image(custHmdLogoPath, (pageW - logoW) / 2, 10, { width: logoW, height: logoH, fit: [logoW, logoH] }); } catch {}
      }

      // ── Dark header bar (centred title) ──
      const hdrTop = 114;
      doc.rect(40, hdrTop, 515, 36).fill("#1F3864");
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(14)
        .text("Account Statement", 40, hdrTop + 11, { width: 515, align: "center" });

      // ── Customer info block (single line: "Customer: NAME") ──
      const infoY = 158;
      doc.fillColor("#000000").font("Helvetica").fontSize(9);
      const custLabel = "Customer: ";
      doc.text(custLabel, 40, infoY, { continued: true });
      doc.font("Helvetica-Bold");
      custRender(customer.legalName, 40 + doc.widthOfString(custLabel), infoY, 300);
      doc.font("Helvetica");

      // ── Table ──
      const colX   = [40,  115, 185, 285, 380, 468];
      const colW   = [75,   70, 100,  95,  88,  87];
      const colHdr = ["Date", "Type", "Container", "Destination", "Debit (Dr)", "Credit (Cr)"];
      const colAlign: Array<"left" | "right"> = ["left", "left", "left", "left", "right", "right"];
      const tableTop = infoY + 22;

      doc.rect(40, tableTop, 515, 14).fill("#1F3864");
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8);
      colHdr.forEach((h, i) => {
        doc.text(h, colX[i] + 2, tableTop + 3, { width: colW[i] - 4, align: colAlign[i] });
      });

      doc.fillColor("#000000").font("Helvetica").fontSize(8);
      let y = tableTop + 16;

      rows.forEach((row: any, idx: number) => {
        const rowH = row.rowNote ? 21 : 13;
        if (y > 760) { doc.addPage(); y = 40; }
        if (idx % 2 === 1) { doc.rect(40, y, 515, rowH).fill("#F8F8F8"); doc.fillColor("#000000"); }
        doc.font("Helvetica").fontSize(8);
        doc.text(fmtDate(row.transactionDate), colX[0] + 2, y + 3, { width: colW[0] - 4 });
        doc.text(txLabel(row.transactionType), colX[1] + 2, y + 3, { width: colW[1] - 4 });
        custRender(row.desc || "—", colX[2] + 2, y + 3, colW[2] - 4, "left");
        if (row.destination) custRender(row.destination, colX[3] + 2, y + 3, colW[3] - 4, "left");
        doc.font("Helvetica").fontSize(8);
        if (row.debit > 0) doc.text(fmtAmt(row.debit), colX[4] + 2, y + 3, { width: colW[4] - 4, align: "right" });
        if (row.credit > 0) doc.text(fmtAmt(row.credit), colX[5] + 2, y + 3, { width: colW[5] - 4, align: "right" });
        if (row.rowNote) {
          doc.fillColor("#555555").font("Helvetica-Oblique").fontSize(6.5)
            .text(`↳ ${row.rowNote}`, colX[2] + 4, y + 13, { width: colW[2] + colW[3] + colW[4] + colW[5] - 8 });
          doc.fillColor("#000000");
        }
        y += rowH;
      });

      // Separator
      y += 3;
      doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor("#888888").stroke();
      y += 6;

      // Totals row
      doc.rect(40, y, 515, 15).fill("#1F3864");
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8);
      doc.text("TOTAL", colX[2] + 2, y + 4, { width: colW[2] - 4 });
      doc.text(fmtAmt(totalDr) || "$0", colX[4] + 2, y + 4, { width: colW[4] - 4, align: "right" });
      doc.text(fmtAmt(totalCr) || "$0", colX[5] + 2, y + 4, { width: colW[5] - 4, align: "right" });
      y += 17;

      // Closing balance row
      doc.rect(40, y, 515, 15).fill("#EFF3FB");
      doc.fillColor("#000000").font("Helvetica-Bold").fontSize(8);
      doc.text("Closing Balance", colX[2] + 2, y + 4, { width: colW[2] - 4 });
      const closingStr = fmtBalance(closingBalance, closingBalanceSide);
      if (closingBalanceSide === "Dr") {
        doc.text(closingStr, colX[4] + 2, y + 4, { width: colW[4] - 4, align: "right" });
      } else {
        doc.text(closingStr, colX[5] + 2, y + 4, { width: colW[5] - 4, align: "right" });
      }
      y += 20;

      // Statement note (if set)
      if (customer.statementNote) {
        if (y > 740) { doc.addPage(); y = 40; }
        doc.rect(40, y, 515, 13).fill("#F4F6FB");
        doc.fillColor("#333333").font("Helvetica-Bold").fontSize(8);
        doc.text("Note:", 42, y + 3, { width: 38 });
        doc.font("Helvetica").fontSize(8);
        const noteLines = doc.heightOfString(customer.statementNote, { width: 468 });
        const noteH = Math.max(13, noteLines + 6);
        if (noteH > 13) {
          doc.rect(40, y, 515, noteH).fill("#F4F6FB");
          doc.fillColor("#333333").font("Helvetica-Bold").fontSize(8);
          doc.text("Note:", 42, y + 3, { width: 38 });
          doc.font("Helvetica").fontSize(8);
        }
        doc.fillColor("#333333").text(customer.statementNote, 82, y + 3, { width: 468, lineBreak: true });
      }

      doc.end();
    } catch (error: any) {
      console.error("Error exporting customer statement PDF:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Customer Statement: Excel Export ────────────────────────────────────
  app.get("/api/factory/customers/:id/statement/export-excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const [customer] = await db.select().from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)));
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));

      const balanceRows = await db.select().from(customerBalances)
        .where(and(eq(customerBalances.companyId, companyId), eq(customerBalances.customerId, customerId)))
        .orderBy(customerBalances.transactionDate, customerBalances.id);

      // Pull voucher entries (same logic as statement endpoint)
      const voucherRowsXlsx: any[] = [];
      const ledgerAccountIdXlsx = (customer as any).ledgerAccountId;
      const voucherCondXlsx = ledgerAccountIdXlsx
        ? sql`(${voucherEntries.ledgerAccountId} = ${ledgerAccountIdXlsx} OR ${voucherEntries.customerId} = ${customerId})`
        : sql`${voucherEntries.customerId} = ${customerId}`;
      const rawVeXlsx = await db.select({
        id: voucherEntries.id, voucherId: voucherEntries.voucherId,
        voucherNumber: vouchers.voucherNumber, voucherType: vouchers.voucherType,
        voucherDate: vouchers.voucherDate, description: vouchers.description,
        debitAmount: voucherEntries.debitAmount, creditAmount: voucherEntries.creditAmount,
        narration: voucherEntries.narration,
      }).from(voucherEntries)
        .innerJoin(vouchers, and(eq(voucherEntries.voucherId, vouchers.id), eq(vouchers.companyId, companyId),
          sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`, sql`${vouchers.voucherNumber} NOT LIKE 'INV-%'`))
        .where(voucherCondXlsx).orderBy(vouchers.voucherDate, voucherEntries.id);
      for (const ve of rawVeXlsx) {
        voucherRowsXlsx.push({
          transactionDate: ve.voucherDate, transactionType: ve.voucherType || "VOUCHER",
          referenceType: "VOUCHER", referenceNumber: ve.voucherNumber,
          description: ve.narration || ve.description || ve.voucherType,
          debitAmount: ve.debitAmount ?? "0", creditAmount: ve.creditAmount ?? "0", _fromVoucher: true,
        });
      }
      const allRowsXlsx = [...balanceRows.map((r: any) => ({ ...r, _fromVoucher: false })), ...voucherRowsXlsx]
        .sort((a, b) => {
          const da = (a.transactionDate || "").toString(), db2 = (b.transactionDate || "").toString();
          if (da !== db2) return da < db2 ? -1 : 1;
          return (a._fromVoucher ? 1 : 0) - (b._fromVoucher ? 1 : 0);
        });

      // Build destination map for Excel
      const xlsxInvoiceRefIds = [...new Set(
        allRowsXlsx.filter((r: any) => r.referenceType === "INVOICE" && r.referenceId).map((r: any) => r.referenceId as number)
      )];
      const destinationMapXlsx = new Map<number, string>();
      if (xlsxInvoiceRefIds.length > 0) {
        const xlsxOrderRows = await db
          .select({ id: customerOrders.id, destination: customerOrders.destination })
          .from(customerOrders)
          .where(inArray(customerOrders.id, xlsxInvoiceRefIds));
        for (const o of xlsxOrderRows) {
          if (o.destination) destinationMapXlsx.set(o.id, o.destination);
        }
      }

      const openingBalance = parseFloat(customer.openingBalance || "0");
      const openingSide = customer.openingBalanceSide || "Dr";
      let runningBalance = openingSide === "Dr" ? openingBalance : -openingBalance;

      const rows = allRowsXlsx.map((row: any) => {
        const debit = parseFloat(row.debitAmount || "0");
        const credit = parseFloat(row.creditAmount || "0");
        runningBalance += debit - credit;
        const destination =
          row.referenceType === "INVOICE" && row.referenceId
            ? (destinationMapXlsx.get(row.referenceId) || "")
            : "";
        return { ...row, debit, credit, destination };
      });

      const totalDr = rows.reduce((s: number, r: any) => s + r.debit, 0);
      const totalCr = rows.reduce((s: number, r: any) => s + r.credit, 0);
      const closingBalance = Math.abs(runningBalance);
      const closingBalanceSide = runningBalance >= 0 ? "Dr" : "Cr";

      const txLabel = (type: string) => {
        const map: Record<string, string> = { SALE: "Sale", PAYMENT: "Payment", RECEIPT: "Receipt", ADJUSTMENT: "Adjustment", JOURNAL: "Journal", OPENING_BALANCE: "Opening Bal." };
        return map[type] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      };
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
        { key: "date",        width: 14 },
        { key: "type",        width: 16 },
        { key: "desc",        width: 28 },
        { key: "destination", width: 22 },
        { key: "dr",          width: 16 },
        { key: "cr",          width: 16 },
        { key: "note",        width: 30 },
      ];

      // Rows 1–5+: Customer info block with HMD branding
      try {
        const stmtLogo = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(stmtLogo)) {
          const slBuf = fs.readFileSync(stmtLogo);
          const slId = workbook.addImage({ buffer: slBuf as Buffer, extension: "jpeg" });
          const slRow = sheet.addRow([]); slRow.height = 90;
          sheet.addImage(slId, { tl: { col: 1.9, row: 0 }, ext: { width: 300, height: 90 } });
          sheet.mergeCells(`A1:G1`);
        }
      } catch {}
      const r1 = sheet.addRow(["HMD INTERNATIONAL GROUP"]);
      r1.getCell(1).font = { bold: true, size: 14, color: { argb: "FF1F3864" } };
      sheet.mergeCells(`A${r1.number}:G${r1.number}`);
      const r2 = sheet.addRow(["Account Statement"]);
      r2.getCell(1).font = { bold: true, size: 11 };
      sheet.mergeCells(`A${r2.number}:G${r2.number}`);
      const r3 = sheet.addRow([`Customer: ${customer.legalName}   |   Code: ${customer.code || "—"}   |   Phone: ${customer.phone || "—"}`]);
      sheet.mergeCells(`A${r3.number}:G${r3.number}`);
      const r4 = sheet.addRow([`Opening Balance: ${openingBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${openingSide}`]);
      sheet.mergeCells(`A${r4.number}:G${r4.number}`);
      const r5 = sheet.addRow([`Printed: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`]);
      sheet.mergeCells(`A${r5.number}:G${r5.number}`);
      // spacer
      sheet.addRow([]);

      // Column headers
      const hdrRow = sheet.addRow(["Date", "Type", "Container", "Destination", "Debit (Dr)", "Credit (Cr)", "Note"]);
      hdrRow.eachCell((cell) => {
        cell.fill = navyFill;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.border = allBorders;
        cell.alignment = { horizontal: "center" };
      });

      // Opening balance row if non-zero
      if (openingBalance > 0) {
        const obRow = sheet.addRow([
          new Date().toLocaleDateString("en-GB"),
          "Opening Bal.",
          "Opening Balance",
          "",
          openingSide === "Dr" ? openingBalance : null,
          openingSide === "Cr" ? openingBalance : null,
        ]);
        obRow.eachCell((cell) => {
          cell.fill = lightBlueFill;
          cell.border = allBorders;
        });
        obRow.getCell(5).numFmt = numFmt;
        obRow.getCell(6).numFmt = numFmt;
      }

      // Data rows
      rows.forEach((row: any, idx: number) => {
        const dr = row.debit > 0 ? row.debit : null;
        const cr = row.credit > 0 ? row.credit : null;
        const dateVal = row.transactionDate
          ? new Date(row.transactionDate + "T00:00:00")
          : "";
        const dr2 = sheet.addRow([dateVal, txLabel(row.transactionType), row.description || "—", row.destination || "", dr, cr, row.rowNote || ""]);
        dr2.eachCell((cell) => { cell.border = allBorders; });
        if (idx % 2 === 0) {
          dr2.eachCell((cell) => { cell.fill = greyFill; });
        }
        dr2.getCell(1).numFmt = "dd/mm/yyyy";
        dr2.getCell(5).numFmt = numFmt;
        dr2.getCell(6).numFmt = numFmt;
        dr2.getCell(5).alignment = { horizontal: "right" };
        dr2.getCell(6).alignment = { horizontal: "right" };
        dr2.getCell(7).alignment = { wrapText: true, vertical: "top" };
        if (row.rowNote) dr2.height = Math.max(18, Math.ceil(row.rowNote.length / 30) * 15);
      });

      // Totals row
      const totRow = sheet.addRow(["", "", "TOTAL", "", totalDr, totalCr, ""]);
      totRow.eachCell((cell) => {
        cell.fill = navyFill;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.border = allBorders;
      });
      totRow.getCell(5).numFmt = numFmt;
      totRow.getCell(6).numFmt = numFmt;
      totRow.getCell(5).alignment = { horizontal: "right" };
      totRow.getCell(6).alignment = { horizontal: "right" };

      // Closing balance row
      const closingDr = closingBalanceSide === "Dr" ? closingBalance : null;
      const closingCr = closingBalanceSide === "Cr" ? closingBalance : null;
      const cbRow = sheet.addRow(["", "", "Closing Balance", "", closingDr, closingCr, ""]);
      cbRow.eachCell((cell) => {
        cell.fill = lightBlueFill;
        cell.font = { bold: true };
        cell.border = allBorders;
      });
      cbRow.getCell(5).numFmt = numFmt;
      cbRow.getCell(6).numFmt = numFmt;
      cbRow.getCell(5).alignment = { horizontal: "right" };
      cbRow.getCell(6).alignment = { horizontal: "right" };

      // Statement note (if set)
      if (customer.statementNote) {
        sheet.addRow([]);
        const noteRow = sheet.addRow(["Note:", customer.statementNote, "", "", "", ""]);
        sheet.mergeCells(`B${noteRow.number}:F${noteRow.number}`);
        noteRow.getCell(1).font = { bold: true, size: 10 };
        noteRow.getCell(2).font = { italic: true, size: 10 };
        noteRow.getCell(2).alignment = { wrapText: true, vertical: "top" };
        noteRow.height = Math.max(18, Math.ceil(customer.statementNote.length / 60) * 15);
      }

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=statement_${(customer.legalName || "customer").replace(/\s+/g, "_")}.xlsx`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting customer statement Excel:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─── One-time migration: fix charge descriptions & payment narrations ───────
  app.post("/api/factory/migrate-voucher-descriptions", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      let chargesFixed = 0;
      let narrationFixed = 0;

      // 1. Fix CHARGE-* vouchers: replace "ChargeName - INV-XXXXXX" with
      //    "ChargeName for offloaded container - ContainerNumber"
      const chargeVouchers = await db
        .select({ id: vouchers.id, description: vouchers.description, voucherNumber: vouchers.voucherNumber })
        .from(vouchers)
        .where(and(
          eq(vouchers.companyId, companyId),
          sql`${vouchers.voucherNumber} LIKE 'CHARGE-INV-%'`,
          sql`${vouchers.description} IS NOT NULL`,
        ));

      for (const v of chargeVouchers) {
        // Extract invoice number: voucherNumber = CHARGE-INV-XXXXXX-chargeId-timestamp
        const parts = (v.voucherNumber || "").split("-");
        // Format: CHARGE, INV, 011831, <chargeId>, <timestamp>
        const invoiceNumber = parts.length >= 3 ? `INV-${parts[2]}` : null;
        if (!invoiceNumber) continue;

        // Look up the order by invoice number
        const [order] = await db
          .select({ id: customerOrders.id, containerNumber: customerOrders.containerNumber })
          .from(customerOrders)
          .where(and(
            eq(customerOrders.companyId, companyId),
            eq(customerOrders.invoiceNumber, invoiceNumber),
          ));

        if (!order?.containerNumber) continue;

        // Determine the charge name from description: "ChargeName - INV-XXXXXX"
        const descParts = (v.description || "").split(` - ${invoiceNumber}`);
        const chargeName = descParts[0] || v.description || "";
        const newDesc = `${chargeName} for offloaded container - ${order.containerNumber}`;

        await db.update(vouchers).set({ description: newDesc }).where(eq(vouchers.id, v.id));
        await db.update(voucherEntries).set({ narration: newDesc }).where(eq(voucherEntries.voucherId, v.id));
        chargesFixed++;
      }

      // 2. Fix Payment/Receipt/Journal narrations: set narration = voucher.description
      //    only where the voucher has a description and narration looks auto-generated
      const manualVouchers = await db
        .select({ id: vouchers.id, description: vouchers.description, voucherType: vouchers.voucherType })
        .from(vouchers)
        .where(and(
          eq(vouchers.companyId, companyId),
          sql`${vouchers.description} IS NOT NULL AND ${vouchers.description} != ''`,
          sql`${vouchers.voucherType} IN ('Payment', 'Receipt', 'Journal')`,
          sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`,
          sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-%'`,
          sql`${vouchers.voucherNumber} NOT LIKE 'FPOS-%'`,
          sql`${vouchers.sourceModule} = 'FACTORY' OR ${vouchers.sourceModule} IS NULL`,
        ));

      for (const v of manualVouchers) {
        const entries = await db
          .select({ id: voucherEntries.id, narration: voucherEntries.narration })
          .from(voucherEntries)
          .where(eq(voucherEntries.voucherId, v.id));

        for (const entry of entries) {
          const narr = entry.narration || "";
          // Only update if it looks like an auto-generated narration
          const isAutoGenerated =
            narr.startsWith(`${v.voucherType} - `) ||
            narr.startsWith("Payment - ") ||
            narr.startsWith("Receipt - ") ||
            narr.startsWith("Journal - ") ||
            narr === "";

          if (isAutoGenerated) {
            await db.update(voucherEntries).set({ narration: v.description }).where(eq(voucherEntries.id, entry.id));
            narrationFixed++;
          }
        }
      }

      res.json({ message: "Migration complete", chargesFixed, narrationFixed });
    } catch (error: any) {
      console.error("Migration error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // CUSTOMER PROFORMAS CRUD
  // ───────────────────────────────────────────────

  registerFactoryCustomerProformaRoutes(app);
  registerFactoryCustomerOrderRoutes(app);
}
