import { parseId, parseOptionalId } from "../../lib/parseId";
import { getClientDate } from "../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { classifyNetPositionAccounts } from "../../netPositionHelper";
import { adjustInventory } from "../../inventoryHelper";
import { sqlArray } from "../../lib/sqlArray";
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
  factorySupplierCategories, insertFactorySupplierCategorySchema,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

const PAYABLE_CONTAINER_STATUSES = new Set([
  "OFFLOADED",
  "RECEIVED",
  "PARTIALLY_RECEIVED",
]);

const isPayableContainer = (c: any) =>
  PAYABLE_CONTAINER_STATUSES.has(String(c.status || "").toUpperCase());

export function registerFactorySuppliersRoutes(app: Express) {
  app.get("/api/factory/suppliers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId))
        .orderBy(factorySuppliers.name);

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory suppliers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/suppliers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactorySupplierSchema.parse({ ...req.body, companyId });
      const [supplier] = await db.insert(factorySuppliers).values(parsed).returning();
      res.json(supplier);
    } catch (error: any) {
      console.error("Error creating factory supplier:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/factory/suppliers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [updated] = await db
        .update(factorySuppliers)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Supplier not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating factory supplier:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/suppliers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [updated] = await db
        .update(factorySuppliers)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Supplier not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error deleting factory supplier:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Overwrite a factory supplier's opening balance
  app.patch("/api/factory/suppliers/:id/opening-balance", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) return res.status(400).json({ message: "Invalid supplier id" });

      const { openingBalance } = req.body;
      if (openingBalance === undefined || openingBalance === null || openingBalance === "") {
        return res.status(400).json({ message: "openingBalance is required" });
      }
      const val = parseFloat(openingBalance);
      if (isNaN(val)) {
        return res.status(400).json({ message: "openingBalance must be a valid number" });
      }

      const [supplier] = await db
        .select()
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .limit(1);

      if (!supplier) return res.status(404).json({ message: "Supplier not found" });

      const [updated] = await db
        .update(factorySuppliers)
        .set({ openingBalance: String(val) })
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating supplier opening balance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Hard-delete a factory supplier — cascades through all related records
  app.delete("/api/factory/suppliers/:id/permanent", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [supplier] = await db
        .select()
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)));

      if (!supplier) return res.status(404).json({ message: "Supplier not found" });

      // 1. Collect container IDs belonging to this supplier
      const supplierContainers = await db
        .select({ id: factoryContainers.id })
        .from(factoryContainers)
        .where(and(eq(factoryContainers.companyId, companyId), eq(factoryContainers.supplierId, id)));
      const containerIds = supplierContainers.map((c) => c.id);

      // 2. Cascade-delete container-level dependents (only when containers exist)
      if (containerIds.length > 0) {
        await db.delete(factoryFxAllocations).where(inArray(factoryFxAllocations.containerId, containerIds));
        await db.delete(factoryOffloadAdditionalCharges).where(inArray(factoryOffloadAdditionalCharges.containerId, containerIds));
        await db.delete(factoryContainerCommissions).where(inArray(factoryContainerCommissions.containerId, containerIds));
        await db.delete(factoryMixBatchSources).where(inArray(factoryMixBatchSources.containerId, containerIds));
        await db.delete(factoryRawStock).where(inArray(factoryRawStock.containerId, containerIds));
        await db.delete(factoryContainers).where(inArray(factoryContainers.id, containerIds));
      }

      // 3. Delete supplier-level financial records
      await db.delete(factorySupplierFxTransfers).where(
        and(
          eq(factorySupplierFxTransfers.companyId, companyId),
          or(eq(factorySupplierFxTransfers.fromSupplierId, id), eq(factorySupplierFxTransfers.toSupplierId, id))
        )
      );
      await db.delete(factorySupplierPayments).where(
        and(eq(factorySupplierPayments.companyId, companyId), eq(factorySupplierPayments.supplierId, id))
      );
      await db.delete(factorySupplierScoreSnapshots).where(
        and(eq(factorySupplierScoreSnapshots.companyId, companyId), eq(factorySupplierScoreSnapshots.supplierId, id))
      );

      // 4. Finally delete the supplier itself
      await db
        .delete(factorySuppliers)
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)));

      res.json({ message: "Supplier permanently deleted" });
    } catch (error: any) {
      console.error("Error permanently deleting factory supplier:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 1b. Factory Supplier Categories
  // ───────────────────────────────────────────────

  app.get("/api/factory/supplier-categories", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const cats = await db
        .select()
        .from(factorySupplierCategories)
        .where(eq(factorySupplierCategories.companyId, companyId))
        .orderBy(asc(factorySupplierCategories.displayOrder), asc(factorySupplierCategories.name));
      res.json(cats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/factory/supplier-categories", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const parsed = insertFactorySupplierCategorySchema.parse({ ...req.body, companyId });
      const [created] = await db.insert(factorySupplierCategories).values(parsed).returning();
      res.json(created);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/factory/supplier-categories/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { name, displayOrder } = req.body;
      const [updated] = await db
        .update(factorySupplierCategories)
        .set({ ...(name !== undefined && { name }), ...(displayOrder !== undefined && { displayOrder }), updatedAt: new Date() })
        .where(and(eq(factorySupplierCategories.id, id), eq(factorySupplierCategories.companyId, companyId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Category not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/factory/supplier-categories/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      // Unassign any suppliers that belong to this category
      await db
        .update(factorySuppliers)
        .set({ supplierCategoryId: null, updatedAt: new Date() })
        .where(and(eq(factorySuppliers.companyId, companyId), eq(factorySuppliers.supplierCategoryId, id)));
      const [deleted] = await db
        .delete(factorySupplierCategories)
        .where(and(eq(factorySupplierCategories.id, id), eq(factorySupplierCategories.companyId, companyId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Category not found" });
      res.json({ message: "Category deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ───────────────────────────────────────────────
  // 1c. Factory Supplier Payments
  // ───────────────────────────────────────────────

  app.get("/api/factory/supplier-payments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = req.query.supplierId ? parseOptionalId(req.query.supplierId) : null;

      // Also fetch all sub-accounts of the supplier to include their payments
      let supplierIds: number[] = supplierId ? [supplierId] : [];
      if (supplierId) {
        const children = await db
          .select({ id: factorySuppliers.id })
          .from(factorySuppliers)
          .where(and(eq(factorySuppliers.companyId, companyId), eq((factorySuppliers as any).parentId, supplierId)));
        children.forEach((c: any) => supplierIds.push(c.id));
      }

      let query = db
        .select()
        .from(factorySupplierPayments)
        .where(eq(factorySupplierPayments.companyId, companyId))
        .orderBy(desc(factorySupplierPayments.date));

      if (supplierIds.length > 0) {
        query = query.where(and(
          eq(factorySupplierPayments.companyId, companyId),
          inArray(factorySupplierPayments.supplierId, supplierIds)
        ));
      }

      const payments = await query;
      res.json(payments);
    } catch (error: any) {
      console.error("Error fetching supplier payments:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/supplier-payments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactorySupplierPaymentSchema.parse({ ...req.body, companyId });

      const created = await db.transaction(async (tx: any) => {
        const [payment] = await tx.insert(factorySupplierPayments).values(parsed).returning();

        // Double-entry Payment voucher: DR Supplier Payable / CR Bank or Cash
        const payAmt = parseFloat(payment.amount);
        const payAmtStr = payAmt.toFixed(2);
        const payVoucherNum = `FACTORY-PAY-${payment.id}-${Date.now()}`;

        const [payVoucher] = await tx.insert(vouchers).values({
          companyId,
          voucherType: "Payment",
          voucherNumber: payVoucherNum,
          voucherDate: payment.date,
          description: `Supplier payment – see factory payment #${payment.id}`,
          totalAmount: payAmtStr,
          currency: payment.currencyCode || "USD",
          exchangeRate: String(parseFloat(payment.fxRateToUsd as string || "1")),
          sourceModule: "FACTORY",
        }).returning();

        // DR: Factory Supplier (debit reduces the liability we owe them)
        await tx.insert(voucherEntries).values({
          voucherId: payVoucher.id,
          factorySupplierId: payment.supplierId,
          debitAmount: payAmtStr,
          creditAmount: "0",
          narration: `Payment to supplier – factory payment #${payment.id}`,
        });

        // CR: Bank/Cash ledger account (or auto-created "Factory Cash Payments" if not specified)
        const crAccountId = payment.paidFromAccountId
          ? payment.paidFromAccountId
          : await getOrCreateLedgerAccount(companyId, "FACTORY_CASH_PAYMENTS", "Factory Cash Payments", "ASSET");

        await tx.insert(voucherEntries).values({
          voucherId: payVoucher.id,
          ledgerAccountId: crAccountId,
          debitAmount: "0",
          creditAmount: payAmtStr,
          narration: `Bank/cash outflow – factory payment #${payment.id}`,
        });

        return payment;
      });

      const [spSupplier] = await db.select({ name: factorySuppliers.name })
        .from(factorySuppliers).where(eq(factorySuppliers.id, created.supplierId));
      await writeDaybookEntry(db, {
        companyId,
        txDate: created.date,
        txType: "SUPPLIER_PAYMENT",
        referenceId: created.id,
        description: `Supplier payment: ${spSupplier?.name || "Unknown"} – ${parseFloat(created.amount).toFixed(2)} ${created.currencyCode}`,
        amountCurrency: parseFloat(created.amount),
        amountUsd: parseFloat(created.amountUsd),
        currencyCode: created.currencyCode,
      });
      res.json(created);
    } catch (error: any) {
      console.error("Error creating supplier payment:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/supplier-payments/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [payment] = await db.select().from(factorySupplierPayments)
        .where(and(eq(factorySupplierPayments.id, id), eq(factorySupplierPayments.companyId, companyId)));
      const [spDelSupplier] = payment
        ? await db.select({ name: factorySuppliers.name }).from(factorySuppliers).where(eq(factorySuppliers.id, payment.supplierId))
        : [null];

      await db.transaction(async (tx: any) => {
        // Hard-delete the auto-generated Payment voucher and its entries for this payment
        const payVoucherPattern = `FACTORY-PAY-${id}-%`;
        const payVouchers = await tx.select({ id: vouchers.id })
          .from(vouchers)
          .where(and(eq(vouchers.companyId, companyId), sql`${vouchers.voucherNumber} LIKE ${payVoucherPattern}`));
        if (payVouchers.length > 0) {
          const vIds = payVouchers.map((v: any) => v.id);
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, vIds));
        }
        await tx.delete(factorySupplierPayments)
          .where(and(eq(factorySupplierPayments.id, id), eq(factorySupplierPayments.companyId, companyId)));
      });

      if (payment) {
        await writeDaybookEntry(db, {
          companyId,
          txDate: getClientDate(req),
          txType: "SUPPLIER_PAYMENT_DELETE",
          description: `Supplier payment deleted: ${spDelSupplier?.name || "Unknown"} – ${parseFloat(payment.amount).toFixed(2)} ${payment.currencyCode} (dated ${payment.date})`,
        });
      }
      res.json({ message: "Payment deleted" });
    } catch (error: any) {
      console.error("Error deleting supplier payment:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 1a-ii. Factory Supplier FX Transfers
  // ───────────────────────────────────────────────

  app.get("/api/factory/supplier-fx-transfers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const transfers = await db
        .select()
        .from(factorySupplierFxTransfers)
        .where(eq(factorySupplierFxTransfers.companyId, companyId))
        .orderBy(desc(factorySupplierFxTransfers.date));
      res.json(transfers);
    } catch (error: any) {
      console.error("Error fetching FX transfers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/supplier-fx-transfers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactorySupplierFxTransferSchema.parse({ ...req.body, companyId });

      // Validate both suppliers exist and belong to this company
      const [fromSupplier] = await db.select({ id: factorySuppliers.id, name: factorySuppliers.name, parentId: factorySuppliers.parentId })
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, parsed.fromSupplierId), eq(factorySuppliers.companyId, companyId)));
      if (!fromSupplier) return res.status(404).json({ message: "From-supplier not found" });

      const [toSupplier] = await db.select({ id: factorySuppliers.id, name: factorySuppliers.name })
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, parsed.toSupplierId), eq(factorySuppliers.companyId, companyId)));
      if (!toSupplier) return res.status(404).json({ message: "To-supplier not found" });

      // ── Balance validation (Phase 3) ─────────────────────────────────────────
      const currCode = parsed.fromCurrencyCode;
      const fromSupId = parsed.fromSupplierId;
      const sourceType = (parsed as any).sourceType || "supplier";

      // 1a. Containers for this supplier in this currency (for supplier-bucket validation)
      const contRowsInCurrency = await db
        .select({
          finalPayableAmount: factoryContainers.finalPayableAmount,
          actualReceivedKg: factoryContainers.actualReceivedKg,
          totalKg: factoryContainers.totalKg,
          ratePerKg: factoryContainers.ratePerKg,
          freight: factoryContainers.freight,
          id: factoryContainers.id,
        })
        .from(factoryContainers)
        .where(and(
          eq(factoryContainers.companyId, companyId),
          eq(factoryContainers.supplierId, fromSupId),
          eq(factoryContainers.currencyCode, currCode)
        ));

      const containerIds = contRowsInCurrency.map((c: any) => c.id);
      const totalValue = contRowsInCurrency.reduce((s: number, c: any) => {
        const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
        const rate = parseFloat(c.ratePerKg || "0");
        const freight = parseFloat(c.freight || "0");
        return s + (kg * rate + freight);
      }, 0);

      // 1b. For commission validation: ALL containers for this supplier (commission may be in a
      //     different currency than the container, e.g. EUR container with USD commission).
      const allContainerIds: number[] = containerIds.slice(); // start with same-currency containers
      if (sourceType === "commission" || sourceType === "both") {
        const allContRows = await db
          .select({ id: factoryContainers.id })
          .from(factoryContainers)
          .where(and(
            eq(factoryContainers.companyId, companyId),
            eq(factoryContainers.supplierId, fromSupId)
          ));
        for (const c of allContRows) {
          if (!allContainerIds.includes(c.id)) allContainerIds.push(c.id);
        }
      }

      // 2. Commissions from factoryContainerCommissions for relevant containers,
      //    filtered by commission currency code (handles cross-currency commissions).
      let totalCommission = 0;
      if (allContainerIds.length > 0) {
        const commRows = await db
          .select({ commissionTotal: factoryContainerCommissions.commissionTotal, currencyCode: factoryContainerCommissions.currencyCode })
          .from(factoryContainerCommissions)
          .where(and(
            eq(factoryContainerCommissions.companyId, companyId),
            inArray(factoryContainerCommissions.containerId, allContainerIds)
          ));
        // Only count commissions denominated in the transfer currency
        totalCommission = commRows
          .filter((cm: any) => (cm.currencyCode || "USD") === currCode)
          .reduce((s: number, cm: any) => s + parseFloat(cm.commissionTotal || "0"), 0);

        // Also include direct commissions from containers (commissionAmount / commissionCurrencyCode)
        if (sourceType === "commission" || sourceType === "both") {
          const directRows = await db
            .select({ commissionAmount: factoryContainers.commissionAmount, commissionCurrencyCode: factoryContainers.commissionCurrencyCode })
            .from(factoryContainers)
            .where(and(
              eq(factoryContainers.companyId, companyId),
              eq(factoryContainers.supplierId, fromSupId)
            ));
          const directAmt = directRows
            .filter((r: any) => (r.commissionCurrencyCode || "USD") === currCode)
            .reduce((s: number, r: any) => s + parseFloat(r.commissionAmount || "0"), 0);
          // Use whichever is larger (factoryContainerCommissions may supersede commissionAmount)
          if (directAmt > totalCommission) totalCommission = directAmt;
        }
      }

      // 3. Payments in this currency
      const payRows = await db
        .select({ amount: factorySupplierPayments.amount })
        .from(factorySupplierPayments)
        .where(and(
          eq(factorySupplierPayments.companyId, companyId),
          eq(factorySupplierPayments.supplierId, fromSupId),
          eq(factorySupplierPayments.currencyCode, currCode)
        ));
      const totalPaid = payRows.reduce((s: number, p: any) => s + parseFloat(p.amount || "0"), 0);

      // 4. Existing FX transfers out for this supplier + currency
      const fxRows = await db
        .select({ fromAmount: factorySupplierFxTransfers.fromAmount, sourceType: factorySupplierFxTransfers.sourceType })
        .from(factorySupplierFxTransfers)
        .where(and(
          eq(factorySupplierFxTransfers.companyId, companyId),
          eq(factorySupplierFxTransfers.fromSupplierId, fromSupId),
          eq(factorySupplierFxTransfers.fromCurrencyCode, currCode)
        ));

      // FX deducted from supplier bucket (source = supplier or both)
      const fxSupplierOut = fxRows
        .filter((t: any) => !t.sourceType || t.sourceType === "supplier" || t.sourceType === "both")
        .reduce((s: number, t: any) => s + parseFloat(t.fromAmount || "0"), 0);
      // FX deducted from commission bucket (source = commission or both)
      const fxCommOut = fxRows
        .filter((t: any) => t.sourceType === "commission" || t.sourceType === "both")
        .reduce((s: number, t: any) => s + parseFloat(t.fromAmount || "0"), 0);

      const supplierAvail = totalValue - totalCommission - totalPaid - fxSupplierOut;
      const commAvail = totalCommission - fxCommOut;

      let available: number;
      if (sourceType === "commission") {
        available = commAvail;
      } else if (sourceType === "both") {
        available = supplierAvail + commAvail;
      } else {
        available = supplierAvail; // "supplier" (default)
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Overpayments are allowed — the remaining balance will go negative (CR),
      // visible on the statement so the company knows the supplier owes money back.

      const [created] = await db.insert(factorySupplierFxTransfers).values(parsed).returning();

      // ── Phase 1: Oldest-first allocation persistence ──────────────────────────
      // Allocate this FX transfer against containers ordered by creation date
      try {
        const allContainers = await db
          .select({ id: factoryContainers.id, finalPayableAmount: factoryContainers.finalPayableAmount, actualReceivedKg: factoryContainers.actualReceivedKg, totalKg: factoryContainers.totalKg, ratePerKg: factoryContainers.ratePerKg, freight: factoryContainers.freight })
          .from(factoryContainers)
          .where(and(eq(factoryContainers.companyId, companyId), eq(factoryContainers.supplierId, fromSupId), eq(factoryContainers.currencyCode, currCode)))
          .orderBy(factoryContainers.createdAt); // oldest first

        const cIds = allContainers.map((c: any) => c.id);
        const prevAllocs = cIds.length > 0
          ? await db.select({ containerId: factoryFxAllocations.containerId, allocatedAmount: factoryFxAllocations.allocatedAmount })
              .from(factoryFxAllocations)
              .where(and(eq(factoryFxAllocations.companyId, companyId), inArray(factoryFxAllocations.containerId, cIds)))
          : [];

        const allocatedPerContainer: Record<number, number> = {};
        for (const a of prevAllocs) allocatedPerContainer[a.containerId] = (allocatedPerContainer[a.containerId] || 0) + parseFloat(a.allocatedAmount || "0");

        let rem = parseFloat(created.fromAmount);
        const rows: any[] = [];
        for (const c of allContainers) {
          if (rem <= 0.001) break;
          // Use totalKg (agreed weight) for FX allocation ceiling — same as supplier balance.
          const kg = parseFloat(c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          const val = kg * rate + freight;
          const used = allocatedPerContainer[c.id] || 0;
          const avail = Math.max(0, val - used);
          if (avail <= 0.001) continue;
          const toAlloc = Math.min(rem, avail);
          rows.push({ companyId, fxTransferId: created.id, containerId: c.id, sourceType: created.sourceType || "supplier", allocatedAmount: toAlloc.toFixed(4), currencyCode: currCode });
          rem -= toAlloc;
        }
        if (rows.length > 0) await db.insert(factoryFxAllocations).values(rows);
      } catch (allocErr) {
        console.error("FX allocation error (non-fatal):", allocErr);
      }
      // ─────────────────────────────────────────────────────────────────────────

      const transferKind = (created as any).sourceType === "commission" ? "Commission Transfer" : "FX Transfer";
      await writeDaybookEntry(db, {
        companyId,
        txDate: created.date,
        txType: "SUPPLIER_FX_TRANSFER",
        referenceId: created.id,
        description: `${transferKind}: ${fromSupplier.name} ${created.fromCurrencyCode} ${parseFloat(created.fromAmount).toFixed(2)} → ${toSupplier.name} USD ${parseFloat(created.toAmountUsd).toFixed(2)}`,
        amountCurrency: parseFloat(created.fromAmount),
        amountUsd: parseFloat(created.toAmountUsd),
        currencyCode: created.fromCurrencyCode,
      });

      res.json(created);
    } catch (error: any) {
      console.error("Error creating FX transfer:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/supplier-fx-transfers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [transfer] = await db.select().from(factorySupplierFxTransfers)
        .where(and(eq(factorySupplierFxTransfers.id, id), eq(factorySupplierFxTransfers.companyId, companyId)));
      if (!transfer) return res.status(404).json({ message: "Transfer not found" });

      // Cascade-delete allocation rows before removing the transfer
      await db.delete(factoryFxAllocations)
        .where(and(eq(factoryFxAllocations.fxTransferId, id), eq(factoryFxAllocations.companyId, companyId)));

      await db.delete(factorySupplierFxTransfers)
        .where(and(eq(factorySupplierFxTransfers.id, id), eq(factorySupplierFxTransfers.companyId, companyId)));

      await writeDaybookEntry(db, {
        companyId,
        txDate: getClientDate(req),
        txType: "SUPPLIER_FX_TRANSFER_DELETE",
        description: `FX Transfer deleted: ${transfer.fromCurrencyCode} ${parseFloat(transfer.fromAmount).toFixed(2)} → USD ${parseFloat(transfer.toAmountUsd).toFixed(2)} (dated ${transfer.date})`,
      });

      res.json({ message: "FX transfer deleted" });
    } catch (error: any) {
      console.error("Error deleting FX transfer:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Bulk FX Prefetch (offline cache) ─────────────────────────────────────
  // GET /api/factory/suppliers/:brokerId/bulk-fx-prefetch?currency=EUR
  // Returns per-linked-supplier available balance for the given currency so the
  // client can run the greedy allocation algorithm offline.
  app.get("/api/factory/suppliers/:brokerId/bulk-fx-prefetch", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseId(req.params.brokerId);
      if (brokerId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(brokerId)) return res.status(400).json({ message: "Invalid broker ID" });
      const currency = req.query.currency as string;
      if (!currency) return res.status(400).json({ message: "currency query param required" });

      const linkedSuppliers = await db.select().from(factorySuppliers)
        .where(and(eq(factorySuppliers.parentId, brokerId), eq(factorySuppliers.companyId, companyId), eq(factorySuppliers.isActive, true)));
      if (linkedSuppliers.length === 0) return res.json({ suppliers: [] });

      const linkedIds = linkedSuppliers.map((s: any) => s.id);

      const allContainers = (await db.select({
        id: factoryContainers.id, supplierId: factoryContainers.supplierId,
        status: factoryContainers.status,
        totalKg: factoryContainers.totalKg, actualReceivedKg: factoryContainers.actualReceivedKg,
        ratePerKg: factoryContainers.ratePerKg, freight: factoryContainers.freight,
        freightCurrencyCode: factoryContainers.freightCurrencyCode, currencyCode: factoryContainers.currencyCode,
        commissionAmount: factoryContainers.commissionAmount, commissionCurrencyCode: factoryContainers.commissionCurrencyCode,
        createdAt: factoryContainers.createdAt, arrivalDate: factoryContainers.arrivalDate,
      }).from(factoryContainers).where(and(
        eq(factoryContainers.companyId, companyId),
        inArray(factoryContainers.supplierId, linkedIds),
        eq(factoryContainers.currencyCode, currency)
      ))).filter(isPayableContainer);

      const allPayments = await db.select({ supplierId: factorySupplierPayments.supplierId, amount: factorySupplierPayments.amount })
        .from(factorySupplierPayments)
        .where(and(eq(factorySupplierPayments.companyId, companyId), inArray(factorySupplierPayments.supplierId, linkedIds), eq(factorySupplierPayments.currencyCode, currency)));

      const allFxOut = await db.select({ fromSupplierId: factorySupplierFxTransfers.fromSupplierId, fromAmount: factorySupplierFxTransfers.fromAmount })
        .from(factorySupplierFxTransfers)
        .where(and(eq(factorySupplierFxTransfers.companyId, companyId), inArray(factorySupplierFxTransfers.fromSupplierId, linkedIds), eq(factorySupplierFxTransfers.fromCurrencyCode, currency)));

      const paymentsBySupplier: Record<number, number> = {};
      for (const p of allPayments) paymentsBySupplier[p.supplierId] = (paymentsBySupplier[p.supplierId] || 0) + parseFloat(p.amount || "0");

      const fxOutBySupplier: Record<number, number> = {};
      for (const f of allFxOut) fxOutBySupplier[f.fromSupplierId] = (fxOutBySupplier[f.fromSupplierId] || 0) + parseFloat(f.fromAmount || "0");

      const result: Array<{ id: number; name: string; available: number; oldestDate: string | null; newestDate: string | null }> = [];
      for (const sup of linkedSuppliers) {
        const supContainers = allContainers.filter((c: any) => c.supplierId === sup.id);
        const totalValue = supContainers.reduce((s: number, c: any) => {
          const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          const freightCc = c.freightCurrencyCode || c.currencyCode || currency;
          // Commission accumulates under supplier (true broker balance model)
          const commAmt = parseFloat(c.commissionAmount || "0");
          const commCc = c.commissionCurrencyCode || c.currencyCode || currency;
          return s + (kg * rate + (freightCc === currency ? freight : 0) + (commCc === currency ? commAmt : 0));
        }, 0);
        const available = Math.max(0, totalValue - (paymentsBySupplier[sup.id] || 0) - (fxOutBySupplier[sup.id] || 0));
        const dates = supContainers.map((c: any) => c.arrivalDate || c.createdAt).filter(Boolean) as string[];
        const oldestDate = dates.length ? dates.reduce((a, b) => new Date(a) < new Date(b) ? a : b) : null;
        const newestDate = dates.length ? dates.reduce((a, b) => new Date(a) > new Date(b) ? a : b) : null;
        if (available > 0.001) result.push({ id: sup.id, name: sup.name, available, oldestDate, newestDate });
      }

      return res.json({ suppliers: result, cachedAt: Date.now() });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── Bulk FX Settlement for Broker ────────────────────────────────────────
  // POST /api/factory/suppliers/:brokerId/bulk-fx-settlement
  // Distributes a total foreign-currency amount across all linked suppliers of
  // a broker, creating individual FX transfer records for each, capped at each
  // supplier's outstanding balance.
  app.post("/api/factory/suppliers/:brokerId/bulk-fx-settlement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseId(req.params.brokerId);
      if (brokerId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(brokerId)) return res.status(400).json({ message: "Invalid broker ID" });

      const { fromCurrencyCode, totalAmount, fxRateToUsd, date, notes, order = "oldest", dryRun = false } = req.body;
      if (!fromCurrencyCode || !totalAmount || !fxRateToUsd)
        return res.status(400).json({ message: "fromCurrencyCode, totalAmount, and fxRateToUsd are required" });

      const total = parseFloat(totalAmount);
      const fxRate = parseFloat(fxRateToUsd);
      if (total <= 0 || fxRate <= 0)
        return res.status(400).json({ message: "Amount and rate must be greater than zero" });

      // Verify broker exists
      const [broker] = await db.select().from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, brokerId), eq(factorySuppliers.companyId, companyId)));
      if (!broker) return res.status(404).json({ message: "Broker not found" });

      // Get all active linked suppliers
      const linkedSuppliers = await db.select().from(factorySuppliers)
        .where(and(
          eq(factorySuppliers.parentId, brokerId),
          eq(factorySuppliers.companyId, companyId),
          eq(factorySuppliers.isActive, true)
        ));
      if (linkedSuppliers.length === 0)
        return res.status(400).json({ message: "No active linked suppliers found for this broker" });

      const linkedIds = linkedSuppliers.map((s: any) => s.id);

      // Get all payable containers for linked suppliers in the given currency
      const allContainers = (await db.select({
        id: factoryContainers.id,
        supplierId: factoryContainers.supplierId,
        status: factoryContainers.status,
        totalKg: factoryContainers.totalKg,
        actualReceivedKg: factoryContainers.actualReceivedKg,
        ratePerKg: factoryContainers.ratePerKg,
        freight: factoryContainers.freight,
        freightCurrencyCode: factoryContainers.freightCurrencyCode,
        currencyCode: factoryContainers.currencyCode,
        commissionAmount: factoryContainers.commissionAmount,
        commissionCurrencyCode: factoryContainers.commissionCurrencyCode,
        createdAt: factoryContainers.createdAt,
        arrivalDate: factoryContainers.arrivalDate,
      })
        .from(factoryContainers)
        .where(and(
          eq(factoryContainers.companyId, companyId),
          inArray(factoryContainers.supplierId, linkedIds),
          eq(factoryContainers.currencyCode, fromCurrencyCode)
        ))
        .orderBy(order === "newest" ? desc(factoryContainers.createdAt) : factoryContainers.createdAt)
      ).filter(isPayableContainer);

      // Get payments in this currency for linked suppliers
      const allPayments = await db.select({
        supplierId: factorySupplierPayments.supplierId,
        amount: factorySupplierPayments.amount,
      })
        .from(factorySupplierPayments)
        .where(and(
          eq(factorySupplierPayments.companyId, companyId),
          inArray(factorySupplierPayments.supplierId, linkedIds),
          eq(factorySupplierPayments.currencyCode, fromCurrencyCode)
        ));

      // Get existing FX transfers out for linked suppliers in this currency
      const allFxOut = await db.select({
        fromSupplierId: factorySupplierFxTransfers.fromSupplierId,
        fromAmount: factorySupplierFxTransfers.fromAmount,
      })
        .from(factorySupplierFxTransfers)
        .where(and(
          eq(factorySupplierFxTransfers.companyId, companyId),
          inArray(factorySupplierFxTransfers.fromSupplierId, linkedIds),
          eq(factorySupplierFxTransfers.fromCurrencyCode, fromCurrencyCode)
        ));

      // Aggregate payment and FX-out totals per supplier
      const paymentsBySupplier: Record<number, number> = {};
      for (const p of allPayments)
        paymentsBySupplier[p.supplierId] = (paymentsBySupplier[p.supplierId] || 0) + parseFloat(p.amount || "0");

      const fxOutBySupplier: Record<number, number> = {};
      for (const f of allFxOut)
        fxOutBySupplier[f.fromSupplierId] = (fxOutBySupplier[f.fromSupplierId] || 0) + parseFloat(f.fromAmount || "0");

      // Previous container-level allocations (to avoid over-allocating)
      const allContainerIds = allContainers.map((c: any) => c.id);
      const prevAllocs = allContainerIds.length > 0
        ? await db.select({
          containerId: factoryFxAllocations.containerId,
          allocatedAmount: factoryFxAllocations.allocatedAmount,
        })
          .from(factoryFxAllocations)
          .where(and(
            eq(factoryFxAllocations.companyId, companyId),
            inArray(factoryFxAllocations.containerId, allContainerIds)
          ))
        : [];

      const prevAllocByContainer: Record<number, number> = {};
      for (const a of prevAllocs)
        prevAllocByContainer[a.containerId] = (prevAllocByContainer[a.containerId] || 0) + parseFloat(a.allocatedAmount || "0");

      // Build per-supplier data: available balance + their containers
      const supplierData: Array<{ supplierId: number; name: string; available: number; containers: any[] }> = [];
      for (const sup of linkedSuppliers) {
        const supContainers = allContainers.filter((c: any) => c.supplierId === sup.id);
        const totalValue = supContainers.reduce((s: number, c: any) => {
          const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          // Use freightCurrencyCode directly (DB default is "USD", so AUD containers correctly separate USD freight)
          const containerCcy = c.currencyCode || fromCurrencyCode;
          const freightCc = c.freightCurrencyCode || containerCcy;
          // Commission accumulates under supplier (true broker balance model) — include in available for settlement
          const commAmt = parseFloat(c.commissionAmount || "0");
          const commCc = c.commissionCurrencyCode || containerCcy;
          return s + (kg * rate + (freightCc === fromCurrencyCode ? freight : 0) + (commCc === fromCurrencyCode ? commAmt : 0));
        }, 0);
        const paid = paymentsBySupplier[sup.id] || 0;
        const fxOut = fxOutBySupplier[sup.id] || 0;
        const available = Math.max(0, totalValue - paid - fxOut);
        if (available > 0.001 && supContainers.length > 0) {
          supplierData.push({ supplierId: sup.id, name: sup.name, available, containers: supContainers });
        }
      }

      if (supplierData.length === 0)
        return res.status(400).json({ message: `No linked suppliers have an outstanding balance in ${fromCurrencyCode}` });

      // Sort suppliers by their oldest (or newest) container date
      supplierData.sort((a, b) => {
        const dateOf = (sd: typeof a) => sd.containers.reduce((best: string | null, c: any) => {
          const d = c.arrivalDate || c.createdAt;
          if (!best) return d;
          return order === "newest"
            ? (new Date(d) > new Date(best) ? d : best)
            : (new Date(d) < new Date(best) ? d : best);
        }, null);
        const da = dateOf(a), db2 = dateOf(b);
        if (!da) return 1; if (!db2) return -1;
        return order === "newest"
          ? new Date(db2).getTime() - new Date(da).getTime()
          : new Date(da).getTime() - new Date(db2).getTime();
      });

      // Greedy allocation: fill each supplier before moving to the next
      let rem = total;
      const allocations: Array<{ supplierId: number; name: string; allocated: number; toAmountUsd: number; overpayment: number; containers: any[] }> = [];
      for (const sd of supplierData) {
        if (rem <= 0.001) break;
        const toAllocate = Math.min(rem, sd.available);
        if (toAllocate < 0.001) continue;
        allocations.push({ supplierId: sd.supplierId, name: sd.name, allocated: toAllocate, toAmountUsd: toAllocate * fxRate, overpayment: 0, containers: sd.containers });
        rem -= toAllocate;
      }

      if (allocations.length === 0)
        return res.status(400).json({ message: "Could not allocate any amount" });

      // Any remaining after all suppliers are filled goes to the last supplier as an overpayment
      // (creates a CR balance — the supplier owes the company that amount back)
      if (rem > 0.001) {
        const last = allocations[allocations.length - 1];
        last.overpayment = rem;
        last.allocated += rem;
        last.toAmountUsd += rem * fxRate;
        rem = 0;
      }

      // Dry-run: return preview without saving
      if (dryRun) {
        const totalAllocated = allocations.reduce((s, a) => s + a.allocated, 0);
        const totalUsd = allocations.reduce((s, a) => s + a.toAmountUsd, 0);
        return res.json({
          dryRun: true,
          totalRequested: total.toFixed(4),
          totalAllocated: totalAllocated.toFixed(4),
          remaining: (total - totalAllocated).toFixed(4),
          totalUsd: totalUsd.toFixed(4),
          transfers: allocations.map(a => ({
            supplierId: a.supplierId,
            supplierName: a.name,
            allocated: a.allocated.toFixed(4),
            toAmountUsd: a.toAmountUsd.toFixed(4),
            overpayment: a.overpayment.toFixed(4),
          })),
        });
      }

      // Create FX transfers and allocation rows in a transaction
      const settlementDate = date || getClientDate(req);
      const results = await db.transaction(async (tx: any) => {
        const created: any[] = [];
        for (const alloc of allocations) {
          const [fxTransfer] = await tx.insert(factorySupplierFxTransfers).values({
            companyId,
            fromSupplierId: alloc.supplierId,
            toSupplierId: brokerId,
            fromCurrencyCode,
            fromAmount: alloc.allocated.toFixed(4),
            fxRateToUsd: fxRate.toString(),
            toAmountUsd: alloc.toAmountUsd.toFixed(4),
            date: settlementDate,
            notes: notes || null,
            sourceType: "supplier",
          }).returning();

          // Container-level allocations (oldest-first within each supplier)
          const sortedCont = [...alloc.containers].sort((a, b) =>
            order === "newest"
              ? new Date(b.arrivalDate || b.createdAt).getTime() - new Date(a.arrivalDate || a.createdAt).getTime()
              : new Date(a.arrivalDate || a.createdAt).getTime() - new Date(b.arrivalDate || b.createdAt).getTime()
          );
          let allocRem = alloc.allocated;
          const allocRows: any[] = [];
          for (const c of sortedCont) {
            if (allocRem <= 0.001) break;
            const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
            const rate = parseFloat(c.ratePerKg || "0");
            const freight = parseFloat(c.freight || "0");
            const val = kg * rate + freight;
            const used = prevAllocByContainer[c.id] || 0;
            const avail = Math.max(0, val - used);
            if (avail <= 0.001) continue;
            const toAlloc2 = Math.min(allocRem, avail);
            allocRows.push({ companyId, fxTransferId: fxTransfer.id, containerId: c.id, sourceType: "supplier", allocatedAmount: toAlloc2.toFixed(4), currencyCode: fromCurrencyCode });
            allocRem -= toAlloc2;
          }
          if (allocRows.length > 0) await tx.insert(factoryFxAllocations).values(allocRows);

          created.push({ id: fxTransfer.id, supplierId: alloc.supplierId, supplierName: alloc.name, allocated: alloc.allocated.toFixed(4), toAmountUsd: alloc.toAmountUsd.toFixed(4) });
        }
        return created;
      });

      res.json({
        success: true,
        totalRequested: total.toFixed(4),
        totalAllocated: (total - rem).toFixed(4),
        remaining: rem.toFixed(4),
        transfers: results,
      });
    } catch (error: any) {
      console.error("Bulk FX settlement error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 1b. Factory Suppliers - Balances & Statement
  // ───────────────────────────────────────────────

  // Get outstanding balance for a single factory supplier (used by voucher payment balance display)
  // Uses the SAME logic as computeStats in with-balances (including freight, FX transfers,
  // voucher-based payments, and broker aggregation across linked suppliers).
  app.get("/api/factory/suppliers/:id/balance", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = parseId(req.params.id);
      if (supplierId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(supplierId)) return res.status(400).json({ message: "Invalid supplier ID" });

      // Load the supplier + any children (for broker aggregation)
      const allSuppliers = await db.select().from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId));
      const supplier = allSuppliers.find((s: any) => s.id === supplierId);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      const children = allSuppliers.filter((s: any) => (s as any).parentId === supplierId);
      const supplierIds = [supplierId, ...children.map((c: any) => c.id)];

      // Load all containers, payments, and FX transfers for the relevant supplier IDs
      const allContainers = await db.select().from(factoryContainers)
        .where(eq(factoryContainers.companyId, companyId));

      const allPayments = await db.select().from(factorySupplierPayments)
        .where(and(eq(factorySupplierPayments.companyId, companyId), inArray(factorySupplierPayments.supplierId, supplierIds)));

      // Voucher-based payments (ERP vouchers that debit a factory supplier account).
      // Exclude FACTORY-PAY-* vouchers — those are auto-generated from factorySupplierPayments
      // and already counted in allPayments to avoid double-counting.
      const voucherPaidBySupplier: Record<number, number> = {};
      const voucherPaymentRows = await db
        .select({
          factorySupplierId: voucherEntries.factorySupplierId,
          debitAmount: voucherEntries.debitAmount,
          currency: vouchers.currency,
          exchangeRate: vouchers.exchangeRate,
          optional: vouchers.optional,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(
          inArray(voucherEntries.factorySupplierId, supplierIds),
          sql`${voucherEntries.debitAmount}::numeric > 0`,
          sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-PAY-%'`
        ));
      for (const row of voucherPaymentRows as any[]) {
        const sid = row.factorySupplierId;
        if (!sid) continue;
        if (row.optional) continue; // optional vouchers don't affect the balance
        const amt = parseFloat(row.debitAmount || "0");
        const fx = parseFloat(row.exchangeRate || "1") || 1;
        const curr = row.currency || "USD";
        const usdAmt = curr === "USD" ? amt : amt / fx;
        voucherPaidBySupplier[sid] = (voucherPaidBySupplier[sid] || 0) + usdAmt;
      }

      // Fetch FX transfers for this supplier (both as sender and receiver)
      const allFxTransfers = await db
        .select()
        .from(factorySupplierFxTransfers)
        .where(and(
          eq(factorySupplierFxTransfers.companyId, companyId),
          sql`(${factorySupplierFxTransfers.fromSupplierId} = ${supplierId} OR ${factorySupplierFxTransfers.toSupplierId} = ${supplierId})`
        ));

      // computeBalance: TRUE BROKER BALANCE MODEL.
      // Commission from a supplier's own containers is included in the supplier's balance.
      // For brokers, their balance = only direct entries + FX-in (no child rollup).
      const computeBalance = (sid: number, openingBal: number) => {
        const supplierContainers = allContainers.filter((c: any) => c.supplierId === sid);
        const containerValue = supplierContainers.reduce((sum: number, c: any) => {
          // Use totalKg (declared/agreed weight) not actualReceivedKg — weight differences
          // at offload affect inventory only, not what is owed to the supplier.
          const kg = parseFloat(c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          const fx = parseFloat(c.fxRateToUsd || "1");
          const containerCc = c.currencyCode || "USD";
          const freightCc = c.freightCurrencyCode || containerCc;
          // Freight in the same currency as the container → multiply by fx; otherwise treat separately
          const freightInContainerCurr = freightCc === containerCc ? freight : 0;
          const freightDirectUsd = freightCc === "USD" && freightCc !== containerCc ? freight : 0;
          return sum + (kg * rate + freightInContainerCurr) * fx + freightDirectUsd;
        }, 0);
        // Commission from supplier's OWN containers (not broker-earned from other suppliers' containers)
        const ownCommission = supplierContainers.reduce((sum: number, c: any) => {
          const commAmt = parseFloat(c.commissionAmount || "0");
          if (commAmt <= 0) return sum;
          const commCurr = c.commissionCurrencyCode || c.currencyCode || "USD";
          const commFx = parseFloat(c.fxRateToUsd || "1");
          return sum + (commCurr === "USD" ? commAmt : commAmt * commFx);
        }, 0);
        // Other charges from other suppliers' containers where this supplier is the charge recipient
        const otherChargesValue = allContainers.reduce((sum: number, c: any) => {
          if (c.otherChargesSupplierId !== sid) return sum;
          const oc = parseFloat(c.otherCharges || "0");
          if (oc <= 0) return sum;
          const ocCcy = (c as any).otherChargesCurrencyCode || "USD";
          const fx = ocCcy === "USD" ? 1 : parseFloat(c.fxRateToUsd || "1");
          return sum + oc * fx;
        }, 0);
        // FX net: FX-in transfers received minus FX-out transfers sent (in USD)
        // Use toAmountUsd for both directions — it's the actual USD value settled.
        let fxNetUsd = 0;
        for (const t of allFxTransfers as any[]) {
          if (t.toSupplierId === sid) {
            fxNetUsd += parseFloat(t.toAmountUsd || "0");
          }
          if (t.fromSupplierId === sid) {
            fxNetUsd -= parseFloat(t.toAmountUsd || "0");
          }
        }
        const supplierPayments = allPayments.filter((p: any) => p.supplierId === sid);
        const totalPaid = supplierPayments.reduce((sum: number, p: any) => sum + parseFloat(p.amountUsd || "0"), 0);
        const voucherPaid = voucherPaidBySupplier[sid] || 0;
        return openingBal + containerValue + ownCommission + otherChargesValue + fxNetUsd - totalPaid - voucherPaid;
      };

      // True broker balance: only the broker's own balance (NOT children aggregated in)
      const outstandingUsd = computeBalance(supplierId, parseFloat(supplier.openingBalance || "0"));

      res.json({ balance: outstandingUsd, outstandingUsd });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/suppliers/with-balances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const suppliersList = await db
        .select()
        .from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId))
        .orderBy(factorySuppliers.name);

      const containers = await db
        .select()
        .from(factoryContainers)
        .where(eq(factoryContainers.companyId, companyId));

      const allPayments = await db
        .select()
        .from(factorySupplierPayments)
        .where(eq(factorySupplierPayments.companyId, companyId));

      const allFxTransfers = await db
        .select()
        .from(factorySupplierFxTransfers)
        .where(eq(factorySupplierFxTransfers.companyId, companyId));

      // Voucher-based payments: debit entries on voucherEntries where factorySupplierId is set.
      // Exclude FACTORY-PAY-* vouchers — those are auto-generated from factorySupplierPayments
      // and are already counted in allPayments (would double-count otherwise).
      const allSupplierIds = (suppliersList as any[]).map((s: any) => s.id);
      const voucherPaidBySupplier: Record<number, number> = {};
      const voucherPaidBySupplierCurrency: Record<number, Record<string, number>> = {};
      if (allSupplierIds.length > 0) {
        const voucherPaymentRows = await db
          .select({
            factorySupplierId: voucherEntries.factorySupplierId,
            debitAmount: voucherEntries.debitAmount,
            currency: vouchers.currency,
            exchangeRate: vouchers.exchangeRate,
            optional: vouchers.optional,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(and(
            inArray(voucherEntries.factorySupplierId, allSupplierIds),
            sql`${voucherEntries.debitAmount}::numeric > 0`,
            sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-PAY-%'`
          ));
        for (const row of voucherPaymentRows as any[]) {
          const suppId = row.factorySupplierId;
          if (!suppId) continue;
          if (row.optional) continue; // optional vouchers don't affect the balance
          const amt = parseFloat(row.debitAmount || "0");
          const fx = parseFloat(row.exchangeRate || "1") || 1;
          const curr = row.currency || "USD";
          const usdAmt = curr === "USD" ? amt : amt / fx;
          voucherPaidBySupplier[suppId] = (voucherPaidBySupplier[suppId] || 0) + usdAmt;
          if (!voucherPaidBySupplierCurrency[suppId]) voucherPaidBySupplierCurrency[suppId] = {};
          voucherPaidBySupplierCurrency[suppId][curr] = (voucherPaidBySupplierCurrency[suppId][curr] || 0) + amt;
        }
      }

      // Helper to compute stats for a single supplier record
      const computeStats = (s: any) => {
        const supplierContainers = containers.filter((c: any) => c.supplierId === s.id);
        const payableContainers = supplierContainers.filter(isPayableContainer);
        const totalContainers = supplierContainers.length;
        const totalKg = supplierContainers.reduce((sum: number, c: any) => {
          return sum + (parseFloat(c.actualReceivedKg || c.totalKg || "0"));
        }, 0);
        // Sum container value including freight (agreed supplier charge) in USD.
        // Cross-currency freight (e.g. USD freight on AUD containers) is added directly in USD.
        const containerValue = payableContainers.reduce((sum: number, c: any) => {
          // Use totalKg (declared/agreed weight) not actualReceivedKg — weight differences
          // at offload affect inventory only, not what is owed to the supplier.
          const kg = parseFloat(c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          const fx = parseFloat(c.fxRateToUsd || "1");
          const containerCc = c.currencyCode || "USD";
          const freightCc = c.freightCurrencyCode || containerCc;
          const freightInContainerCurr = freightCc === containerCc ? freight : 0;
          const freightDirectUsd = freightCc === "USD" && freightCc !== containerCc ? freight : 0;
          return sum + (kg * rate + freightInContainerCurr) * fx + freightDirectUsd;
        }, 0);
        // Commission accumulates under the supplier, EXCEPT:
        // if this supplier is linked to a broker (has parentId), USD commission flows to the broker.
        const commissionValue = payableContainers.reduce((sum: number, c: any) => {
          const commAmt = parseFloat(c.commissionAmount || "0");
          if (commAmt <= 0) return sum;
          const commCurr = c.commissionCurrencyCode || c.currencyCode || "USD";
          // Linked supplier: USD commission is absorbed by the parent broker — skip here
          if (s.parentId && commCurr === "USD") return sum;
          const commFx = parseFloat(c.fxRateToUsd || "1");
          return sum + (commCurr === "USD" ? commAmt : commAmt * commFx);
        }, 0);
        const pendingContainers = supplierContainers.filter((c: any) => c.status === "PENDING" || c.status === "IN_TRANSIT").length;
        const receivedContainers = supplierContainers.filter((c: any) => c.status === "RECEIVED" || c.status === "PARTIALLY_RECEIVED" || c.status === "OFFLOADED").length;
        const lastContainerDate = supplierContainers.length > 0
          ? supplierContainers.reduce((latest: string | null, c: any) => {
              const d = c.arrivalDate || c.createdAt;
              if (!latest) return d;
              return new Date(d) > new Date(latest) ? d : latest;
            }, null)
          : null;
        const supplierPayments = allPayments.filter((p: any) => p.supplierId === s.id);
        const totalPaid = supplierPayments.reduce((sum: number, p: any) => sum + parseFloat(p.amountUsd || "0"), 0);
        // Include voucher-based payments (payment vouchers) in the balance
        const voucherPaidUsd = voucherPaidBySupplier[s.id] || 0;
        // FX net (USD): FX-in transfers received minus FX-out transfers sent (in USD equivalent)
        // This is critical for brokers that accumulate balance via explicit FX settlements from linked suppliers.
        // Always use toAmountUsd as the USD amount — it reflects the actual settled USD value.
        let fxNetUsd = 0;
        for (const t of allFxTransfers) {
          if (t.toSupplierId === s.id) {
            fxNetUsd += parseFloat((t as any).toAmountUsd || "0");
          }
          if (t.fromSupplierId === s.id) {
            fxNetUsd -= parseFloat((t as any).toAmountUsd || "0");
          }
        }
        // Other charges from containers where this supplier is the charge recipient.
        // Linked suppliers: USD other charges flow to the parent broker — exclude from own balance.
        const otherChargesValue = containers.filter(isPayableContainer).reduce((sum: number, c: any) => {
          if (c.otherChargesSupplierId !== s.id) return sum;
          const oc = parseFloat(c.otherCharges || "0");
          if (oc <= 0) return sum;
          const ocCcy = (c as any).otherChargesCurrencyCode || "USD";
          if (s.parentId && ocCcy === "USD") return sum;
          const fx = ocCcy === "USD" ? 1 : parseFloat(c.fxRateToUsd || "1");
          return sum + oc * fx;
        }, 0);
        const balance = parseFloat(s.openingBalance || "0") + containerValue + commissionValue + otherChargesValue + fxNetUsd - totalPaid - voucherPaidUsd;

        // Per-currency balances (original currency, not converted).
        // Use kg * ratePerKg + freight + commission from own containers.
        // Freight is tracked in its own currency (freightCurrencyCode) which may differ from the container currency.
        // Always use totalKg (declared/agreed weight) — same as computeBalance — weight differences at offload
        // affect inventory only, not what is owed to the supplier.
        const byCurrency: Record<string, number> = {};
        for (const c of payableContainers) {
          const cc = c.currencyCode || "USD";
          const baseVal = parseFloat(c.totalKg || "0") * parseFloat(c.ratePerKg || "0");
          const freightAmt = parseFloat(c.freight || "0");
          const freightCc = c.freightCurrencyCode || cc;
          byCurrency[cc] = (byCurrency[cc] || 0) + baseVal;
          // Freight always shows in its own currency bucket
          if (freightAmt > 0) {
            byCurrency[freightCc] = (byCurrency[freightCc] || 0) + freightAmt;
          }
          // Commission from own containers goes into supplier's currency bucket.
          // Exception: linked suppliers' USD commission flows to the parent broker.
          const commAmt = parseFloat(c.commissionAmount || "0");
          if (commAmt > 0) {
            const commCc = c.commissionCurrencyCode || cc;
            if (!(s.parentId && commCc === "USD")) {
              byCurrency[commCc] = (byCurrency[commCc] || 0) + commAmt;
            }
          }
        }
        // Subtract regular payments by currency
        for (const p of supplierPayments) {
          const cc = p.currencyCode || "USD";
          byCurrency[cc] = (byCurrency[cc] || 0) - parseFloat(p.amount || "0");
        }
        // Subtract voucher-based payments by currency
        const voucherCurrMap = voucherPaidBySupplierCurrency[s.id] || {};
        for (const [cc, amt] of Object.entries(voucherCurrMap)) {
          byCurrency[cc] = (byCurrency[cc] || 0) - amt;
        }
        // FX transfers: sub-supplier loses fromCurrency, parent supplier gains USD
        for (const t of allFxTransfers) {
          if (t.fromSupplierId === s.id) {
            const cc = t.fromCurrencyCode || "USD";
            byCurrency[cc] = (byCurrency[cc] || 0) - parseFloat(t.fromAmount || "0");
          }
          if (t.toSupplierId === s.id) {
            byCurrency["USD"] = (byCurrency["USD"] || 0) + parseFloat(t.toAmountUsd || "0");
          }
        }
        // Other charges from other suppliers' containers attributed to this supplier
        // (e.g. broker-linked charges where other_charges_supplier_id = s.id)
        // Linked suppliers: USD other charges flow to the parent broker — skip in own currency bucket.
        for (const c of containers.filter(isPayableContainer)) {
          if ((c as any).otherChargesSupplierId !== s.id) continue;
          const oc = parseFloat((c as any).otherCharges || "0");
          if (oc <= 0) continue;
          const cc = (c as any).otherChargesCurrencyCode || "USD";
          if (s.parentId && cc === "USD") continue;
          byCurrency[cc] = (byCurrency[cc] || 0) + oc;
        }
        const currencyBalances = Object.entries(byCurrency)
          .map(([currencyCode, bal]) => ({ currencyCode, balance: bal }))
          .filter(({ balance: bal }) => Math.abs(bal) > 0.001)
          .sort((a, b) => (a.currencyCode === "USD" ? 1 : -1)); // non-USD first

        // Due containers: offloaded >30 days ago and supplier still has a positive balance
        const now = new Date();
        const dueContainers = balance > 0.01 ? payableContainers
          .filter((c: any) => {
            if (!c.offloadDate) return false;
            const offloadMs = new Date(c.offloadDate).getTime();
            return (now.getTime() - offloadMs) >= 30 * 24 * 60 * 60 * 1000;
          })
          .map((c: any) => ({
            id: c.id,
            containerNumber: c.containerNumber,
            offloadDate: c.offloadDate,
            currencyCode: c.currencyCode || "USD",
            value: (parseFloat(c.actualReceivedKg || c.totalKg || "0") * parseFloat(c.ratePerKg || "0") + parseFloat(c.freight || "0")).toFixed(2),
            daysPastDue: Math.floor((now.getTime() - new Date(c.offloadDate).getTime()) / (24 * 60 * 60 * 1000)) - 30,
          })) : [];

        // Approx FX rate: weighted average rate across non-USD containers (for UI display)
        const fxContainers = payableContainers.filter((c: any) => (c.currencyCode || "USD") !== "USD" && parseFloat(c.fxRateToUsd || "0") > 0);
        const fxWeightedSum = fxContainers.reduce((s: number, c: any) => {
          const val = parseFloat(c.actualReceivedKg || c.totalKg || "0") * parseFloat(c.ratePerKg || "0") + parseFloat(c.freight || "0");
          return s + val * parseFloat(c.fxRateToUsd || "1");
        }, 0);
        const fxWeightBase = fxContainers.reduce((s: number, c: any) => {
          return s + (parseFloat(c.actualReceivedKg || c.totalKg || "0") * parseFloat(c.ratePerKg || "0") + parseFloat(c.freight || "0"));
        }, 0);
        const approxFxRate = fxWeightBase > 0 ? fxWeightedSum / fxWeightBase : 0;

        // Cross-currency freight that auto-flows into the broker pool for linked suppliers.
        // e.g. USD freight on an AUD container for a supplier whose parent is a broker.
        // This amount is "auto-settled" from the supplier's perspective — the broker absorbs it.
        const autoSettledFreightUsd = (s.parentId !== null && s.parentId !== undefined)
          ? payableContainers.reduce((sum: number, c: any) => {
              const freightCc = c.freightCurrencyCode || c.currencyCode || "USD";
              const containerCc = c.currencyCode || "USD";
              if (freightCc === "USD" && containerCc !== "USD") {
                return sum + parseFloat(c.freight || "0");
              }
              return sum;
            }, 0)
          : 0;

        return { totalContainers, totalKg, containerValue, commissionValue, pendingContainers, receivedContainers, lastContainerDate, totalPaid, balance, currencyBalances, dueContainers, approxFxRate, autoSettledFreightUsd };
      };

      // First pass: compute each supplier's own stats
      const statsById: Record<number, ReturnType<typeof computeStats>> = {};
      for (const s of suppliersList as any[]) {
        statsById[s.id] = computeStats(s);
      }

      // Second pass: for parent suppliers, roll up children's stats
      const suppliersWithBalances = (suppliersList as any[]).map((s: any) => {
        const own = statsById[s.id];
        const children = (suppliersList as any[]).filter((c: any) => c.parentId === s.id);

        if (children.length === 0) {
          // Leaf supplier — use own stats
          return {
            ...s,
            totalContainers: own.totalContainers,
            totalKg: own.totalKg.toFixed(3),
            totalValue: own.balance.toFixed(2),
            totalPaid: own.totalPaid.toFixed(2),
            totalCommissionUsd: own.commissionValue.toFixed(2),
            approxFxRate: own.approxFxRate > 0 ? own.approxFxRate.toFixed(4) : null,
            pendingContainers: own.pendingContainers,
            receivedContainers: own.receivedContainers,
            lastContainerDate: own.lastContainerDate,
            currencyBalances: own.currencyBalances,
            dueContainers: own.dueContainers,
            dueContainersCount: own.dueContainers.length,
            autoSettledFreightUsd: own.autoSettledFreightUsd.toFixed(2),
          };
        }

        // TRUE BROKER BALANCE MODEL — parent supplier (broker) aggregation:
        // The broker's own balance (totalValue / currencyBalances) reflects ONLY direct broker entries
        // and explicit FX-in transfers. Linked supplier balances are NOT merged into broker-owned totals.
        // They are returned separately as linkedSupplierExposure for informational display.
        const childStats = children.map((c: any) => statsById[c.id]);
        // Informational aggregates that span all parties (container counts, kg, dates)
        const aggContainers = own.totalContainers + childStats.reduce((n: number, cs: any) => n + cs.totalContainers, 0);
        const aggKg = own.totalKg + childStats.reduce((n: number, cs: any) => n + cs.totalKg, 0);
        const aggPending = own.pendingContainers + childStats.reduce((n: number, cs: any) => n + cs.pendingContainers, 0);
        const aggReceived = own.receivedContainers + childStats.reduce((n: number, cs: any) => n + cs.receivedContainers, 0);
        const allDates = [own.lastContainerDate, ...childStats.map((cs: any) => cs.lastContainerDate)].filter(Boolean);
        const aggLastDate = allDates.length > 0 ? allDates.reduce((latest: string, d: string) => new Date(d) > new Date(latest) ? d : latest) : null;
        const aggDueContainers = [...own.dueContainers, ...childStats.flatMap((cs: any) => cs.dueContainers)];

        // Linked supplier exposure: per-child per-currency balances (informational, NOT counted in broker totals)
        const linkedSupplierExposure = children.map((c: any, i: number) => ({
          supplierId: c.id,
          supplierName: c.name,
          currencyBalances: childStats[i].currencyBalances,
          autoSettledFreightUsd: childStats[i].autoSettledFreightUsd.toFixed(2),
        }));

        // Aggregate exposure totals for summary display (informational only).
        // Auto-settled cross-currency freight (e.g. USD freight on AUD containers) flows into
        // the broker's own USD pool automatically — exclude it from the linked exposure aggregate
        // so it doesn't appear as an unresolved obligation.
        const exposureCurrencyMap: Record<string, number> = {};
        for (const cs of childStats) {
          const autoFreight = cs.autoSettledFreightUsd || 0;
          for (const cb of cs.currencyBalances) {
            // For USD balances on a linked supplier, subtract auto-settled freight so the broker
            // card doesn't show it as an open exposure (it's already in the broker pool).
            const effectiveBal = cb.currencyCode === "USD" ? cb.balance - autoFreight : cb.balance;
            if (effectiveBal > 0) {
              exposureCurrencyMap[cb.currencyCode] = (exposureCurrencyMap[cb.currencyCode] || 0) + effectiveBal;
            }
          }
        }
        const exposureCurrencyBalances = Object.entries(exposureCurrencyMap)
          .map(([currencyCode, bal]) => ({ currencyCode, balance: bal }))
          .filter(({ balance: bal }) => bal > 0.001)
          .sort((a, b) => (a.currencyCode === "USD" ? 1 : -1));

        return {
          ...s,
          totalContainers: aggContainers,
          totalKg: aggKg.toFixed(3),
          // Broker true balance = own balance ONLY (no child rollup)
          totalValue: own.balance.toFixed(2),
          totalPaid: own.totalPaid.toFixed(2),
          totalCommissionUsd: own.commissionValue.toFixed(2),
          approxFxRate: own.approxFxRate > 0 ? own.approxFxRate.toFixed(4) : null,
          pendingContainers: aggPending,
          receivedContainers: aggReceived,
          lastContainerDate: aggLastDate,
          // Broker's own per-currency balances (direct entries + FX-in only)
          currencyBalances: own.currencyBalances,
          dueContainers: aggDueContainers,
          dueContainersCount: aggDueContainers.length,
          // Linked supplier exposure (informational only — NOT broker-owned)
          linkedSupplierExposure,
          exposureCurrencyBalances,
        };
      });

      res.json(suppliersWithBalances.sort((a: any, b: any) => a.name.localeCompare(b.name)));
    } catch (error: any) {
      console.error("Error fetching factory suppliers with balances:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/suppliers/:id/statement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const supplierId = parseId(req.params.id);

      if (supplierId === null) return res.status(400).json({ message: "Invalid id" });

      const [supplier] = await db
        .select()
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, supplierId), eq(factorySuppliers.companyId, companyId)));

      if (!supplier) return res.status(404).json({ message: "Supplier not found" });

      const containers = await db
        .select()
        .from(factoryContainers)
        .where(and(
          eq(factoryContainers.companyId, companyId),
          eq(factoryContainers.supplierId, supplierId)
        ))
        .orderBy(desc(factoryContainers.createdAt));

      // Containers where this supplier earns commission as a broker (commissionSupplierId = supplierId)
      const brokerContainerRows = await db
        .select({
          id: factoryContainers.id,
          containerNumber: factoryContainers.containerNumber,
          supplierId: factoryContainers.supplierId,
          arrivalDate: factoryContainers.arrivalDate,
          createdAt: factoryContainers.createdAt,
          status: factoryContainers.status,
          commissionAmount: factoryContainers.commissionAmount,
          commissionCurrencyCode: factoryContainers.commissionCurrencyCode,
          origin: factoryContainers.origin,
          supplierName: factorySuppliers.name,
        })
        .from(factoryContainers)
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(and(
          eq(factoryContainers.companyId, companyId),
          eq((factoryContainers as any).commissionSupplierId, supplierId),
          sql`${factoryContainers.supplierId} != ${supplierId}`
        ))
        .orderBy(desc(factoryContainers.createdAt));
      const brokerContainers = (brokerContainerRows as any[]).filter((c: any) => parseFloat(c.commissionAmount || "0") > 0);
      const totalBrokerCommission = brokerContainers.reduce((sum: number, c: any) => sum + parseFloat(c.commissionAmount || "0"), 0);

      const commissions = await db
        .select()
        .from(factoryContainerCommissions)
        .where(eq(factoryContainerCommissions.companyId, companyId));

      // OB commissions — raw stock entries with commission data for this supplier
      const obRawStockWithCommission = containers.length > 0
        ? await db
            .select()
            .from(factoryRawStock)
            .where(and(
              eq(factoryRawStock.companyId, companyId),
              inArray(factoryRawStock.containerId, containers.map((c: any) => c.id))
            ))
        : [];

      // Additional charges (offload) assigned directly to this supplier
      const supplierOffloadCharges = await db
        .select({
          id: factoryOffloadAdditionalCharges.id,
          containerId: factoryOffloadAdditionalCharges.containerId,
          description: factoryOffloadAdditionalCharges.description,
          amount: factoryOffloadAdditionalCharges.amount,
          currencyCode: factoryOffloadAdditionalCharges.currencyCode,
          fxRateToUsd: factoryOffloadAdditionalCharges.fxRateToUsd,
          createdAt: factoryOffloadAdditionalCharges.createdAt,
        })
        .from(factoryOffloadAdditionalCharges)
        .where(and(
          eq(factoryOffloadAdditionalCharges.companyId, companyId),
          eq((factoryOffloadAdditionalCharges as any).supplierId, supplierId)
        ))
        .orderBy(factoryOffloadAdditionalCharges.createdAt);

      // Also fetch container-level other_charges attributed to this supplier via other_charges_supplier_id
      // (these are stored directly on factory_containers, distinct from the factoryOffloadAdditionalCharges table)
      const containerColCharges = await db
        .select({
          id: factoryContainers.id,
          containerId: factoryContainers.id,
          description: sql<string>`'Other Charges'`,
          amount: factoryContainers.otherCharges,
          otherChargesCurrencyCode: (factoryContainers as any).otherChargesCurrencyCode,
          containerCurrencyCode: factoryContainers.currencyCode,
          fxRateToUsd: factoryContainers.fxRateToUsd,
          createdAt: factoryContainers.createdAt,
        })
        .from(factoryContainers)
        .where(and(
          eq(factoryContainers.companyId, companyId),
          eq(factoryContainers.otherChargesSupplierId, supplierId),
          sql`${factoryContainers.otherCharges}::numeric > 0`
        ));
      // Merge into supplierOffloadCharges list for unified processing below
      // Use otherChargesCurrencyCode when set, otherwise default to USD
      const allSupplierCharges = [...supplierOffloadCharges as any[], ...(containerColCharges as any[]).map((c: any) => ({
        ...c,
        amount: c.amount,
        currencyCode: c.otherChargesCurrencyCode || "USD",
      }))];

      const statement = containers.map((c: any) => {
        // Use totalKg (declared/agreed weight) for the payable value shown to the supplier.
        // actualReceivedKg only affects inventory — not the agreed purchase amount.
        const kg = parseFloat(c.totalKg || "0");
        const rate = parseFloat(c.ratePerKg || "0");
        const freight = parseFloat(c.freight || "0");
        const containerCc = c.currencyCode || "USD";
        // Use freightCurrencyCode to determine which pool freight belongs to.
        // The DB default is "USD", so AUD containers with USD freight (even no explicit setting) correctly
        // exclude freight from the AUD value. AUD freight on an AUD container has freightCurrencyCode = "AUD".
        const freightCc = c.freightCurrencyCode || containerCc;
        // Only include freight in value when it shares the container's currency; cross-currency freight is a separate obligation.
        const value = kg * rate + (freightCc === containerCc ? freight : 0);
        const containerCommissions = commissions.filter((cm: any) => cm.containerId === c.id);
        const totalCommission = containerCommissions.reduce((sum: number, cm: any) => sum + parseFloat(cm.commissionTotal || "0"), 0);

        return {
          id: c.id,
          containerNumber: c.containerNumber,
          date: c.arrivalDate || c.createdAt,
          origin: c.origin,
          status: c.status,
          currencyCode: containerCc,
          fxRateToUsd: c.fxRateToUsd || "1",
          declaredKg: c.declaredKg,
          actualReceivedKg: c.actualReceivedKg,
          totalKg: c.totalKg,
          ratePerKg: c.ratePerKg,
          differenceKg: c.differenceKg,
          freight: freight.toFixed(2),
          freightCurrencyCode: freightCc,
          value: value.toFixed(2),
          finalPayableAmount: c.finalPayableAmount,
          commissionAmount: c.commissionAmount || "0",
          commissionCurrencyCode: c.commissionCurrencyCode || "USD",
          commissionSupplierId: (c as any).commissionSupplierId || null,
          commissionNotes: (c as any).commissionNotes || null,
          commissions: containerCommissions,
          totalCommission: totalCommission.toFixed(2),
          notes: c.notes,
        };
      });

      const totalValue = statement.reduce((sum: number, s: any) => sum + parseFloat(s.value), 0);
      const totalKg = statement.reduce((sum: number, s: any) => sum + parseFloat(s.actualReceivedKg || s.totalKg || "0"), 0);
      const totalCommissions = statement.reduce((sum: number, s: any) => sum + parseFloat(s.totalCommission), 0);
      const totalDirectCommissions = statement.reduce((sum: number, s: any) => sum + parseFloat(s.commissionAmount || "0"), 0);

      // Fetch payments for this supplier (needed for per-currency net payable calculation)
      const payments = await db
        .select()
        .from(factorySupplierPayments)
        .where(and(
          eq(factorySupplierPayments.companyId, companyId),
          eq(factorySupplierPayments.supplierId, supplierId)
        ))
        .orderBy(desc(factorySupplierPayments.date));

      // Also fetch voucher-based payments (manually created Payment vouchers — exclude
      // auto-generated FACTORY-PAY-* vouchers which are already reflected in the payments array)
      const voucherPaymentRows = await db
        .select({
          id: voucherEntries.id,
          voucherId: voucherEntries.voucherId,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
          voucherDate: vouchers.voucherDate,
          description: vouchers.description,
          voucherType: vouchers.voucherType,
          voucherNumber: vouchers.voucherNumber,
          currency: vouchers.currency,
          exchangeRate: vouchers.exchangeRate,
          optional: vouchers.optional,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(
          eq(voucherEntries.factorySupplierId, supplierId),
          sql`${voucherEntries.debitAmount}::numeric > 0`,
          sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-PAY-%'`
        ))
        .orderBy(desc(vouchers.voucherDate));

      // Convert voucher payments to USD for total calculation (exclude optional payments)
      const voucherPaymentsTotal = (voucherPaymentRows as any[]).reduce((sum: number, p: any) => {
        if (p.optional) return sum; // optional payments don't affect the balance
        const amt = parseFloat(p.debitAmount || "0");
        const fx = parseFloat(p.exchangeRate || "1") || 1;
        const currency = p.currency || "USD";
        const usdAmt = currency === "USD" ? amt : amt / fx;
        return sum + usdAmt;
      }, 0);

      const totalPayments = payments.reduce((sum: number, p: any) => sum + parseFloat(p.amountUsd || "0"), 0) + voucherPaymentsTotal;

      // Group by currency for multi-currency statement
      const byCurrency: Record<string, { containers: any[]; totalKg: number; totalValue: number; totalCommission: number; totalDirectCommission: number; totalFreight: number; totalOtherCharges: number }> = {};
      for (const s of statement) {
        const cc = s.currencyCode;
        if (!byCurrency[cc]) byCurrency[cc] = { containers: [], totalKg: 0, totalValue: 0, totalCommission: 0, totalDirectCommission: 0, totalFreight: 0, totalOtherCharges: 0 };
        byCurrency[cc].containers.push(s);
        byCurrency[cc].totalKg += parseFloat(s.actualReceivedKg || s.totalKg || "0");
        byCurrency[cc].totalValue += parseFloat(s.value);
        // Commission goes into its own currency bucket (not necessarily the container's currency)
        const commCc = s.commissionCurrencyCode || cc;
        const totalCommAmt = parseFloat(s.totalCommission);
        if (totalCommAmt > 0) {
          if (!byCurrency[commCc]) byCurrency[commCc] = { containers: [], totalKg: 0, totalValue: 0, totalCommission: 0, totalDirectCommission: 0, totalFreight: 0, totalOtherCharges: 0 };
          byCurrency[commCc].totalCommission += totalCommAmt;
        }
        const directCommAmt = parseFloat(s.commissionAmount || "0");
        if (directCommAmt > 0) {
          if (!byCurrency[commCc]) byCurrency[commCc] = { containers: [], totalKg: 0, totalValue: 0, totalCommission: 0, totalDirectCommission: 0, totalFreight: 0, totalOtherCharges: 0 };
          byCurrency[commCc].totalDirectCommission += directCommAmt;
        }
        // Freight always shows in its own currency bucket in the balance totals (currencyGroups);
        // it just doesn't create individual ledger rows until the user does an FX conversion.
        const freightAmt = parseFloat(s.freight || "0");
        const freightCc = s.freightCurrencyCode || cc;
        if (freightAmt > 0) {
          if (!byCurrency[freightCc]) byCurrency[freightCc] = { containers: [], totalKg: 0, totalValue: 0, totalCommission: 0, totalDirectCommission: 0, totalFreight: 0, totalOtherCharges: 0 };
          byCurrency[freightCc].totalFreight += freightAmt;
          if (freightCc !== cc) {
            byCurrency[freightCc].totalValue += freightAmt;
          }
        }
      }
      // Add offload other charges (supplier-linked + container col other_charges) into their currency bucket
      for (const oc of allSupplierCharges as any[]) {
        const ocCc = oc.currencyCode || "USD";
        if (!byCurrency[ocCc]) byCurrency[ocCc] = { containers: [], totalKg: 0, totalValue: 0, totalCommission: 0, totalDirectCommission: 0, totalFreight: 0, totalOtherCharges: 0 };
        byCurrency[ocCc].totalOtherCharges += parseFloat(oc.amount || "0");
        byCurrency[ocCc].totalValue += parseFloat(oc.amount || "0");
      }

      // Opening balance (always stored in USD) — add to USD bucket so it appears in netPayable
      const supplierOpeningBal = parseFloat((supplier as any).openingBalance || "0");
      if (supplierOpeningBal !== 0) {
        if (!byCurrency["USD"]) byCurrency["USD"] = { containers: [], totalKg: 0, totalValue: 0, totalCommission: 0, totalDirectCommission: 0, totalFreight: 0, totalOtherCharges: 0 };
        byCurrency["USD"].totalValue += supplierOpeningBal;
      }

      // Fetch FX transfers involving this supplier (as source or destination)
      const fxTransfers = await db
        .select()
        .from(factorySupplierFxTransfers)
        .where(and(
          eq(factorySupplierFxTransfers.companyId, companyId),
          sql`(${factorySupplierFxTransfers.fromSupplierId} = ${supplierId} OR ${factorySupplierFxTransfers.toSupplierId} = ${supplierId})`
        ))
        .orderBy(desc(factorySupplierFxTransfers.date));

      // Phase 3: Enrich FX transfers with counterparty supplier names for bilateral visibility
      const fxSupplierIds = [...new Set((fxTransfers as any[]).flatMap((t: any) => [t.fromSupplierId, t.toSupplierId]).filter(Boolean))];
      const fxSupplierNames: Record<number, string> = {};
      if (fxSupplierIds.length > 0) {
        const fxSups = await db.select({ id: factorySuppliers.id, name: factorySuppliers.name })
          .from(factorySuppliers).where(inArray(factorySuppliers.id, fxSupplierIds));
        for (const s of fxSups) fxSupplierNames[s.id] = s.name;
      }
      // Enrich incoming FX transfers with the container numbers they cover (cross-reference)
      const incomingFxIds = (fxTransfers as any[]).filter((t: any) => t.toSupplierId === supplierId).map((t: any) => t.id);
      const fxContainerRefsMap: Record<number, Array<{ containerNumber: string; allocatedAmount: string }>> = {};
      if (incomingFxIds.length > 0) {
        const fxAllocs = await db
          .select({
            fxTransferId: factoryFxAllocations.fxTransferId,
            containerId: factoryFxAllocations.containerId,
            allocatedAmount: factoryFxAllocations.allocatedAmount,
            containerNumber: factoryContainers.containerNumber,
          })
          .from(factoryFxAllocations)
          .innerJoin(factoryContainers, eq(factoryFxAllocations.containerId, factoryContainers.id))
          .where(inArray(factoryFxAllocations.fxTransferId, incomingFxIds));
        for (const a of fxAllocs) {
          if (!fxContainerRefsMap[a.fxTransferId]) fxContainerRefsMap[a.fxTransferId] = [];
          fxContainerRefsMap[a.fxTransferId].push({ containerNumber: a.containerNumber, allocatedAmount: String(a.allocatedAmount) });
        }
      }

      const enrichedFxTransfers = (fxTransfers as any[]).map((t: any) => ({
        ...t,
        fromSupplierName: fxSupplierNames[t.fromSupplierId] || "",
        toSupplierName: fxSupplierNames[t.toSupplierId] || "",
        containerRefs: fxContainerRefsMap[t.id] || [],
      }));

      // Build per-currency payment totals (using original currency amounts, not USD)
      const paidByCurrency: Record<string, number> = {};
      // Phase 2: Track commission reductions from FX settlements (source = commission or both)
      const fxCommOut: Record<string, number> = {};
      const fxBothOut: Record<string, number> = {};
      for (const p of (payments as any[])) {
        const cc = p.currencyCode || "USD";
        paidByCurrency[cc] = (paidByCurrency[cc] || 0) + parseFloat(p.amount || "0");
      }
      // Voucher-based payments also reduce the per-currency balance
      for (const p of (voucherPaymentRows as any[])) {
        if (p.optional) continue;
        const cc = p.currency || "USD";
        paidByCurrency[cc] = (paidByCurrency[cc] || 0) + parseFloat(p.debitAmount || "0");
      }
      // FX transfers: out reduces original currency balance; self-FX creates a USD obligation
      for (const t of enrichedFxTransfers) {
        if (t.fromSupplierId === supplierId) {
          const cc = t.fromCurrencyCode || "USD";
          paidByCurrency[cc] = (paidByCurrency[cc] || 0) + parseFloat(t.fromAmount || "0");
          if (t.sourceType === "commission") {
            fxCommOut[cc] = (fxCommOut[cc] || 0) + parseFloat(t.fromAmount || "0");
          } else if (t.sourceType === "both") {
            fxBothOut[cc] = (fxBothOut[cc] || 0) + parseFloat(t.fromAmount || "0");
          }
          // Self-FX (same supplier, e.g. EUR → USD): the converted amount is a new USD
          // obligation — it must appear in byCurrency["USD"] so the top KPI shows the balance.
          if (t.fromSupplierId === t.toSupplierId && (t.fromCurrencyCode || "USD") !== "USD") {
            if (!byCurrency["USD"]) byCurrency["USD"] = { containers: [], totalKg: 0, totalValue: 0, totalCommission: 0, totalDirectCommission: 0, totalFreight: 0, totalOtherCharges: 0 };
            byCurrency["USD"].totalValue += parseFloat(t.toAmountUsd || "0");
          }
        }
        // Cross-supplier FX incoming (commission/both): reduces USD owed to this supplier
        if (t.toSupplierId === supplierId && t.fromSupplierId !== supplierId &&
            (t.sourceType === "commission" || t.sourceType === "both")) {
          paidByCurrency["USD"] = (paidByCurrency["USD"] || 0) + parseFloat(t.toAmountUsd || "0");
        }
      }

      // Is this a linked (child) supplier? Cross-currency freight from linked suppliers flows
      // automatically into the parent broker's statement from container data — no explicit FX
      // transfer is needed. Treat such freight as already settled to avoid double-counting.
      const isLinkedSupplier = !!(supplier as any).parentId;

      const currencyGroups = Object.entries(byCurrency).map(([cc, data]) => {
        const paid = paidByCurrency[cc] || 0;
        // effectiveCommission: before offload only commissionAmount (directCommission) exists;
        // after offload factoryContainerCommissions records exist. Use whichever is greater so
        // the commission always shows in the currency pool even before offloading.
        const effectiveCommission = Math.max(data.totalCommission, data.totalDirectCommission);
        // For commission-only pools (no containers) the commission IS the balance owed to the
        // supplier (they earned it as a broker). Payments out reduce it directly.
        // For normal container pools, commission is deducted from what we owe them.
        // Commission-only: no containers, no freight, no other charges — supplier earns commission as a broker fee
        const isCommissionOnly = data.containers.length === 0 && effectiveCommission > 0 && data.totalFreight <= 0.005 && data.totalOtherCharges <= 0.005;
        // Freight pool (cross-currency): no containers, has freight, may also have commission earned by supplier
        const isCrossFreightPool = data.containers.length === 0 && data.totalFreight > 0.005;
        // For linked suppliers, cross-currency freight is already reflected in the parent broker's
        // statement automatically — offset it from the paid amount so netPayable = 0 (auto-settled).
        const autoSettledFreight = isLinkedSupplier && isCrossFreightPool ? data.totalFreight : 0;
        const effectivePaid = paid + autoSettledFreight;
        // netPayable semantics:
        //  - Commission-only:  commission is EARNED by supplier → effectiveCommission - paid
        //  - Cross-freight:    totalValue (=freight+otherCharges) is owed, commission also EARNED → totalValue + commission - paid
        //  - Normal container: commission is DEDUCTED (goes to broker); totalValue includes goods+freight+otherCharges → totalValue - commission - paid
        const netPayable = isCommissionOnly
          ? effectiveCommission - effectivePaid
          : isCrossFreightPool
          ? data.totalValue + effectiveCommission - effectivePaid
          : data.totalValue - effectiveCommission - effectivePaid;
        // Phase 2: commission remaining = effectiveCommission minus what was settled via FX
        // "both" is treated as commission-first (capped at effectiveCommission), then supplier
        const commFxReduction = Math.min(effectiveCommission, (fxCommOut[cc] || 0) + (fxBothOut[cc] || 0));
        const remainingCommission = Math.max(0, effectiveCommission - commFxReduction);
        return {
          currencyCode: cc,
          containers: data.containers,
          totalKg: data.totalKg.toFixed(3),
          totalValue: data.totalValue.toFixed(2),
          totalCommission: effectiveCommission.toFixed(2),
          remainingCommission: remainingCommission.toFixed(2),
          totalDirectCommission: data.totalDirectCommission.toFixed(2),
          totalPaid: paid.toFixed(2),
          netPayable: netPayable.toFixed(2),
          totalOwed: (data.totalValue + effectiveCommission).toFixed(2),
          totalFreight: data.totalFreight.toFixed(2),
          totalOtherCharges: data.totalOtherCharges.toFixed(2),
          autoSettledFreight: autoSettledFreight.toFixed(2),
        };
      }).filter(g => Math.abs(parseFloat(g.netPayable)) > 0.005 || (g.containers.length > 0 && g.currencyCode !== "USD") || parseFloat(g.totalCommission) > 0.005 || parseFloat(g.totalOtherCharges) > 0.005 || parseFloat(g.autoSettledFreight || "0") > 0.005);

      // Compute the combined USD-equivalent net payable across all currency groups.
      // Correctly accounts for FX transfers (already deducted in paidByCurrency) and
      // converts non-USD remaining balances to USD using the containers' fxRateToUsd.
      const totalNetPayableUsd = currencyGroups.reduce((sum: number, cg: any) => {
        const netPay = parseFloat(cg.netPayable);
        if (netPay <= 0) return sum;
        if (cg.currencyCode === "USD") return sum + netPay;
        // Weighted-average fxRateToUsd across this currency's containers
        const ctrs: any[] = cg.containers;
        const totalRawVal = ctrs.reduce((s: number, c: any) => s + parseFloat(c.value || "0"), 0);
        const weightedRate = totalRawVal > 0
          ? ctrs.reduce((s: number, c: any) => s + parseFloat(c.value || "0") * parseFloat(c.fxRateToUsd || "1"), 0) / totalRawVal
          : 1;
        return sum + netPay * weightedRate;
      }, 0);

      // Build OB commissions list
      const containerMap: Record<number, any> = {};
      for (const c of containers) containerMap[c.id] = c;

      // Offload charges may reference containers belonging to child suppliers (broker receives a charge
      // on a child's container). Fetch any missing containers so we can show the real container number.
      const missingContainerIds = [...new Set(
        allSupplierCharges.map((oc: any) => oc.containerId).filter((id: number) => !containerMap[id])
      )];
      if (missingContainerIds.length > 0) {
        const extraContainers = await db
          .select({ id: factoryContainers.id, containerNumber: factoryContainers.containerNumber, createdAt: factoryContainers.createdAt })
          .from(factoryContainers)
          .where(and(
            eq(factoryContainers.companyId, companyId),
            sql`${factoryContainers.id} = ANY(${sqlArray(missingContainerIds)})`
          ));
        for (const c of extraContainers) containerMap[c.id] = c;
      }

      // Fetch commission supplier names for the statement
      const commSupplierIds = (obRawStockWithCommission as any[])
        .map((r: any) => r.commissionSupplierId)
        .filter(Boolean);
      const commSupplierMap: Record<number, string> = {};
      if (commSupplierIds.length > 0) {
        const commSuppliers = await db
          .select({ id: factorySuppliers.id, name: factorySuppliers.name })
          .from(factorySuppliers)
          .where(sql`${factorySuppliers.id} = ANY(${sqlArray(commSupplierIds)})`);
        for (const s of commSuppliers) commSupplierMap[s.id] = s.name;
      }
      const obCommissions = (obRawStockWithCommission as any[])
        .filter((r: any) => r.commissionAmount && parseFloat(r.commissionAmount) > 0)
        .map((r: any) => ({
          rawStockId: r.id,
          containerId: r.containerId,
          containerNumber: containerMap[r.containerId]?.containerNumber || "",
          date: containerMap[r.containerId]?.createdAt || r.createdAt,
          personName: r.commissionSupplierId ? (commSupplierMap[r.commissionSupplierId] || r.commissionPersonName || "") : (r.commissionPersonName || ""),
          commissionSupplierId: r.commissionSupplierId || null,
          amount: r.commissionAmount,
          currencyCode: r.commissionCurrencyCode || "USD",
          fxRateToUsd: r.commissionFxRateToUsd || "1",
          amountUsd: r.commissionAmountUsd || r.commissionAmount,
        }));
      const totalObCommissions = obCommissions.reduce((sum: number, c: any) => sum + parseFloat(c.amountUsd || "0"), 0);

      // Phase 2: Broker statement — aggregate linked suppliers if this is a broker
      const linkedSuppliers = await db
        .select({ id: factorySuppliers.id, name: factorySuppliers.name })
        .from(factorySuppliers)
        .where(and(
          eq(factorySuppliers.parentId, supplierId),
          eq(factorySuppliers.companyId, companyId)
        ));

      const linkedSupplierGroups: any[] = [];
      for (const linked of linkedSuppliers) {
        const linkedContainers = await db
          .select()
          .from(factoryContainers)
          .where(and(eq(factoryContainers.companyId, companyId), eq(factoryContainers.supplierId, linked.id)))
          .orderBy(factoryContainers.arrivalDate, factoryContainers.createdAt);

        const linkedPayments = await db
          .select()
          .from(factorySupplierPayments)
          .where(and(eq(factorySupplierPayments.companyId, companyId), eq(factorySupplierPayments.supplierId, linked.id)));

        const linkedFxTransfers = await db
          .select()
          .from(factorySupplierFxTransfers)
          .where(and(
            eq(factorySupplierFxTransfers.companyId, companyId),
            sql`(${factorySupplierFxTransfers.fromSupplierId} = ${linked.id} OR ${factorySupplierFxTransfers.toSupplierId} = ${linked.id})`
          ));

        const linkedByCurrency: Record<string, { containers: any[]; totalValue: number; totalCommission: number }> = {};
        for (const c of linkedContainers) {
          const kg = parseFloat((c as any).actualReceivedKg || c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat((c as any).freight || "0");
          const cc = c.currencyCode || "USD";
          // Use freightCurrencyCode directly (DB default is "USD", so AUD containers correctly separate USD freight)
          const freightCc = (c as any).freightCurrencyCode || cc;
          const freightSameCcy = freightCc === cc;
          // Only include freight in this currency's value when it shares the container's currency
          const value = kg * rate + (freightSameCcy ? freight : 0);
          const cComms = commissions.filter((cm: any) => cm.containerId === c.id);
          const totalComm = cComms.reduce((s: number, cm: any) => s + parseFloat(cm.commissionTotal || "0"), 0);
          const commCc = (c as any).commissionCurrencyCode || "USD";
          if (!linkedByCurrency[cc]) linkedByCurrency[cc] = { containers: [], totalValue: 0, totalCommission: 0 };
          linkedByCurrency[cc].containers.push({
            id: c.id,
            containerNumber: c.containerNumber,
            date: (c as any).arrivalDate || c.createdAt,
            freight: freight.toFixed(2),
            freightCurrencyCode: freightCc,
            value: value.toFixed(2),
            currencyCode: cc,
            fxRateToUsd: c.fxRateToUsd || "1",
            status: c.status,
            commissionAmount: c.commissionAmount || "0",
            commissionCurrencyCode: commCc,
            commissionSupplierId: (c as any).commissionSupplierId || null,
            commissionNotes: (c as any).commissionNotes || null,
            notes: c.notes,
          });
          linkedByCurrency[cc].totalValue += value;
          // Cross-currency freight (e.g. USD freight on an AUD container) belongs to the
          // child supplier's own statement — NOT to the broker's linked-supplier view.
          // Once the child transfers it via an FX transfer, it settles on the child's
          // statement and disappears. The broker does not need to track it here.
          // Commission goes into its own currency bucket
          if (totalComm > 0) {
            if (!linkedByCurrency[commCc]) linkedByCurrency[commCc] = { containers: [], totalValue: 0, totalCommission: 0 };
            linkedByCurrency[commCc].totalCommission += totalComm;
          }
        }

        const linkedPaidByCurrency: Record<string, number> = {};
        for (const p of (linkedPayments as any[])) {
          const cc = p.currencyCode || "USD";
          linkedPaidByCurrency[cc] = (linkedPaidByCurrency[cc] || 0) + parseFloat(p.amount || "0");
        }
        for (const t of (linkedFxTransfers as any[])) {
          if (t.fromSupplierId === linked.id) {
            // Linked supplier sent funds out (FX Out) — counts as settled against their balance
            const cc = t.fromCurrencyCode || "USD";
            linkedPaidByCurrency[cc] = (linkedPaidByCurrency[cc] || 0) + parseFloat(t.fromAmount || "0");
          }
          if (t.toSupplierId === linked.id) {
            // Linked supplier received USD back (e.g. round-trip return from broker) —
            // reduces net-settled so the exposure is correctly restored.
            linkedPaidByCurrency["USD"] = (linkedPaidByCurrency["USD"] || 0) - parseFloat(t.toAmountUsd || "0");
          }
        }

        const linkedCurrencyGroups = Object.entries(linkedByCurrency).map(([cc, data]) => {
          const paid = linkedPaidByCurrency[cc] || 0;
          const netPayable = data.totalValue - data.totalCommission - paid;
          return {
            currencyCode: cc,
            containers: data.containers,
            totalValue: data.totalValue.toFixed(2),
            totalCommission: data.totalCommission.toFixed(2),
            totalPaid: paid.toFixed(2),
            netPayable: netPayable.toFixed(2),
            containerCount: data.containers.length,
            lastActivity: linkedContainers.length > 0
              ? ((linkedContainers[linkedContainers.length - 1] as any).arrivalDate || linkedContainers[linkedContainers.length - 1].createdAt)
              : null,
          };
        });

        linkedSupplierGroups.push({
          supplierId: linked.id,
          supplierName: linked.name,
          containerCount: linkedContainers.length,
          currencyGroups: linkedCurrencyGroups,
          lastActivity: linkedContainers.length > 0
            ? ((linkedContainers[linkedContainers.length - 1] as any).arrivalDate || linkedContainers[linkedContainers.length - 1].createdAt)
            : null,
        });
      }

      // ── Phase 1: Fetch per-container FX allocations ──────────────────────────
      const containerIds = containers.map((c: any) => c.id);
      const allocationsByContainer: Record<number, number> = {};
      if (containerIds.length > 0) {
        const allocs = await db
          .select({ containerId: factoryFxAllocations.containerId, allocatedAmount: factoryFxAllocations.allocatedAmount })
          .from(factoryFxAllocations)
          .where(and(eq(factoryFxAllocations.companyId, companyId), inArray(factoryFxAllocations.containerId, containerIds)));
        for (const a of allocs) {
          allocationsByContainer[a.containerId] = (allocationsByContainer[a.containerId] || 0) + parseFloat(a.allocatedAmount || "0");
        }
      }
      // Enrich each statement row with allocatedAmount + remainingAmount
      const enrichedStatement = statement.map((s: any) => {
        const val = parseFloat(s.value || "0");
        const comm = parseFloat(s.totalCommission || "0");
        const netVal = val - comm;
        const allocAmt = allocationsByContainer[s.id] || 0;
        return { ...s, allocatedAmount: allocAmt.toFixed(2), remainingAmount: Math.max(0, netVal - allocAmt).toFixed(2) };
      });
      // ── Phase 5: Build pre-sorted unified ledger ─────────────────────────────
      const fmtAmt = (amt: string, cc: string, neg: boolean) => {
        const prefix = cc !== "USD" ? `${cc} ` : "$";
        const sign = neg ? "-" : "+";
        return `${sign}${prefix}${parseFloat(amt || "0").toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      };
      const ledger: any[] = [
        ...enrichedStatement.map((s: any) => ({
          key: `c-${s.id}`,
          date: s.date,
          type: "purchase",
          ref: s.containerNumber,
          detail: `${s.origin || ""} · ${parseFloat(s.actualReceivedKg || s.totalKg || "0").toFixed(0)} kg`,
          amount: fmtAmt(s.value, s.currencyCode, false),
          amountIsNeg: false,
          notes: s.notes,
          allocatedAmount: s.allocatedAmount,
          remainingAmount: s.remainingAmount,
        })),
        ...(payments as any[]).map((p: any) => ({
          key: `p-${p.id}`,
          date: p.date,
          type: "payment",
          ref: null,
          detail: p.method || "Payment",
          amount: fmtAmt(p.amount, p.currencyCode || "USD", true),
          amountIsNeg: true,
          notes: p.notes,
        })),
        ...(voucherPaymentRows as any[]).map((p: any) => ({
          key: `vp-${p.id}`,
          date: p.voucherDate,
          type: "payment",
          ref: p.voucherNumber || null,
          detail: p.description || `${p.voucherType || "Payment"} voucher`,
          amount: fmtAmt(p.debitAmount, p.currency || "USD", true),
          amountIsNeg: !p.optional,
          notes: null,
          optional: !!p.optional,
        })),
        ...enrichedFxTransfers.map((t: any) => {
          const isOut = t.fromSupplierId === supplierId;
          const isSelf = t.fromSupplierId === t.toSupplierId;
          const cc = isOut ? (t.fromCurrencyCode || "USD") : "USD";
          const amt = isOut ? t.fromAmount : t.toAmountUsd;
          const counterparty = isOut ? (t.toSupplierName || "Broker") : (t.fromSupplierName || "Linked");
          return {
            key: `fx-${t.id}`,
            date: t.date,
            type: "fx",
            ref: isSelf ? `FX Settlement` : (isOut ? `FX → ${counterparty}` : `FX ← ${counterparty}`),
            detail: isOut ? `${t.fromCurrencyCode} ${parseFloat(t.fromAmount || "0").toFixed(2)} → $${parseFloat(t.toAmountUsd || "0").toFixed(2)}${t.sourceType ? ` · ${t.sourceType}` : ""}` : `+$${parseFloat(t.toAmountUsd || "0").toFixed(2)} received`,
            amount: fmtAmt(amt, cc, isOut),
            amountIsNeg: isOut,
            notes: t.notes,
          };
        }),
        ...obCommissions.map((oc: any) => ({
          key: `oc-${oc.rawStockId}`,
          date: oc.date,
          type: "commission",
          ref: oc.containerNumber,
          detail: oc.personName || "",
          amount: fmtAmt(oc.amount, oc.currencyCode, true),
          amountIsNeg: true,
          notes: null,
        })),
        ...allSupplierCharges.map((oc: any) => {
          const cc = oc.currencyCode || "USD";
          return {
            key: `oac-${oc.id}`,
            date: oc.createdAt ? new Date(oc.createdAt).toISOString().split("T")[0] : null,
            type: "other_charge",
            ref: containerMap[oc.containerId]?.containerNumber || `Container ${oc.containerId}`,
            detail: oc.description || "Additional charge",
            amount: fmtAmt(oc.amount, cc, false),
            amountIsNeg: false,
            notes: null,
          };
        }),
      ].sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const db2 = b.date ? new Date(b.date).getTime() : 0;
        return db2 - da;
      });
      // ─────────────────────────────────────────────────────────────────────────

      res.json({
        supplier,
        statement: enrichedStatement,
        currencyGroups,
        obCommissions,
        offloadCharges: allSupplierCharges,
        payments,
        fxTransfers: enrichedFxTransfers,
        linkedSupplierGroups,
        brokerContainers,
        ledger,
        summary: {
          totalContainers: statement.length,
          totalKg: totalKg.toFixed(3),
          totalValue: totalValue.toFixed(2),
          totalCommissions: totalCommissions.toFixed(2),
          totalDirectCommissions: totalDirectCommissions.toFixed(2),
          totalObCommissions: totalObCommissions.toFixed(2),
          totalPayments: totalPayments.toFixed(2),
          totalBrokerCommission: totalBrokerCommission.toFixed(2),
          netPayable: totalNetPayableUsd.toFixed(2),
          totalOwed: (totalValue + totalDirectCommissions).toFixed(2),
        },
      });
    } catch (error: any) {
      console.error("Error fetching supplier statement:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Broker Consolidated Statement  (aggregates broker + all linked suppliers)
  // GET /api/factory/suppliers/:id/broker-statement[/export?format=excel]
  // ─────────────────────────────────────────────────────────────────────────
  async function buildBrokerStatement(brokerId: number, companyId: number) {
    // Fetch broker
    const [broker] = await db.select().from(factorySuppliers)
      .where(and(eq(factorySuppliers.id, brokerId), eq(factorySuppliers.companyId, companyId)));
    if (!broker) return null;

    // Linked suppliers
    const linkedRaw = await db.select().from(factorySuppliers)
      .where(and(eq(factorySuppliers.parentId, brokerId), eq(factorySuppliers.companyId, companyId)));

    const allSuppliers = [broker, ...linkedRaw];
    const allSupplierIds = allSuppliers.map((s: any) => s.id);
    const supplierNameMap: Record<number, string> = {};
    for (const s of allSuppliers) supplierNameMap[(s as any).id] = (s as any).name;

    // Containers
    const allContainers = allSupplierIds.length > 0
      ? await db.select().from(factoryContainers)
          .where(and(eq(factoryContainers.companyId, companyId), inArray(factoryContainers.supplierId, allSupplierIds)))
          .orderBy(factoryContainers.arrivalDate, factoryContainers.createdAt)
      : [];

    // Payments (direct)
    const allPayments = allSupplierIds.length > 0
      ? await db.select().from(factorySupplierPayments)
          .where(and(eq(factorySupplierPayments.companyId, companyId), inArray(factorySupplierPayments.supplierId, allSupplierIds)))
          .orderBy(factorySupplierPayments.date)
      : [];

    // Voucher-based payments (from general accounting, linked via factorySupplierId)
    const allVoucherPayments = allSupplierIds.length > 0
      ? await db.select({
          id: voucherEntries.id,
          debitAmount: voucherEntries.debitAmount,
          supplierId: voucherEntries.factorySupplierId,
          voucherDate: vouchers.voucherDate,
          description: vouchers.description,
          voucherNumber: vouchers.voucherNumber,
          currency: vouchers.currency,
          optional: vouchers.optional,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(
          inArray(voucherEntries.factorySupplierId as any, allSupplierIds),
          sql`${voucherEntries.debitAmount}::numeric > 0`,
          sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-PAY-%'`
        ))
        .orderBy(vouchers.voucherDate)
      : [];

    // FX transfers (involving any of the suppliers)
    const allFx = allSupplierIds.length > 0
      ? await db.select().from(factorySupplierFxTransfers)
          .where(and(
            eq(factorySupplierFxTransfers.companyId, companyId),
            sql`(${factorySupplierFxTransfers.fromSupplierId} = ANY(${sqlArray(allSupplierIds)}) OR ${factorySupplierFxTransfers.toSupplierId} = ANY(${sqlArray(allSupplierIds)}))`
          ))
          .orderBy(factorySupplierFxTransfers.date)
      : [];

    // Offload additional charges assigned to any of the broker's suppliers
    const allOffloadCharges = allSupplierIds.length > 0
      ? await db.select({
          id: factoryOffloadAdditionalCharges.id,
          containerId: factoryOffloadAdditionalCharges.containerId,
          description: factoryOffloadAdditionalCharges.description,
          amount: factoryOffloadAdditionalCharges.amount,
          currencyCode: factoryOffloadAdditionalCharges.currencyCode,
          fxRateToUsd: factoryOffloadAdditionalCharges.fxRateToUsd,
          createdAt: factoryOffloadAdditionalCharges.createdAt,
          supplierId: (factoryOffloadAdditionalCharges as any).supplierId,
        })
        .from(factoryOffloadAdditionalCharges)
        .where(and(
          eq(factoryOffloadAdditionalCharges.companyId, companyId),
          sql`${(factoryOffloadAdditionalCharges as any).supplierId} = ANY(${sqlArray(allSupplierIds)})`
        ))
        .orderBy(factoryOffloadAdditionalCharges.createdAt)
      : [];

    // Container-level other charges (entered per-container, use charge's own currency first)
    const allContainerOtherCharges = allSupplierIds.length > 0
      ? await db.select({
          id: factoryContainerOtherCharges.id,
          containerId: factoryContainerOtherCharges.containerId,
          description: factoryContainerOtherCharges.description,
          amount: factoryContainerOtherCharges.amount,
          createdAt: factoryContainerOtherCharges.createdAt,
          supplierId: factoryContainers.supplierId,
          chargeCurrencyCode: factoryContainerOtherCharges.currencyCode,
          containerCurrencyCode: factoryContainers.currencyCode,
          containerNumber: factoryContainers.containerNumber,
        })
        .from(factoryContainerOtherCharges)
        .innerJoin(factoryContainers, eq(factoryContainerOtherCharges.containerId, factoryContainers.id))
        .where(and(
          eq(factoryContainerOtherCharges.companyId, companyId),
          inArray(factoryContainers.supplierId, allSupplierIds)
        ))
        .orderBy(factoryContainerOtherCharges.createdAt)
      : [];

    type LedgerRow = {
      date: string | null;
      type: "container" | "payment" | "fx_out" | "fx_in" | "commission" | "freight" | "other_charge" | "opening_balance";
      description: string;
      ref: string;
      amount: number;
      commissionAmount: number | null;
      commissionCurrency: string | null;
    };

    const ledgerByCurrency: Record<string, LedgerRow[]> = {};
    const addRow = (cc: string, row: LedgerRow) => {
      if (!ledgerByCurrency[cc]) ledgerByCurrency[cc] = [];
      ledgerByCurrency[cc].push(row);
    };

    // Container rows
    // Always use totalKg (declared/agreed weight) — weight differences at offload affect inventory
    // only, not what is owed to the supplier. This matches computeBalance and computeStats.
    for (const c of (allContainers as any[])) {
      const supplierName = supplierNameMap[c.supplierId] || "Unknown";
      const cc = c.currencyCode || "USD";
      const kg = parseFloat(c.totalKg || "0");
      const rate = parseFloat(c.ratePerKg || "0");
      const freight = parseFloat(c.freight || "0");
      // Use freightCurrencyCode directly (DB default is "USD", so AUD containers correctly separate USD freight)
      const freightCc = c.freightCurrencyCode || cc;
      const freightSameCcy = freightCc === cc;
      // Freight is always a separate row — container row shows goods only
      const mainAmt = kg * rate;
      const commAmt = parseFloat(c.commissionAmount || "0");
      const commCc = c.commissionCurrencyCode || "USD";
      const dateVal = c.arrivalDate ? String(c.arrivalDate) : c.createdAt ? new Date(c.createdAt).toISOString().split("T")[0] : null;

      addRow(cc, {
        date: dateVal,
        type: "container",
        description: `${c.containerNumber} - ${supplierName}`,
        ref: c.containerNumber,
        amount: mainAmt,
        commissionAmount: null,
        commissionCurrency: null,
      });

      // Cross-currency freight: add as an individual ledger row in the freight currency section
      if (freight > 0 && !freightSameCcy) {
        addRow(freightCc, {
          date: dateVal,
          type: "freight",
          description: `Freight - ${c.containerNumber} (${supplierName})`,
          ref: c.containerNumber,
          amount: freight,
          commissionAmount: null,
          commissionCurrency: null,
        });
      }
      // Same-currency freight: add a separate freight row in the container's currency section
      if (freight > 0 && freightSameCcy) {
        addRow(cc, {
          date: dateVal,
          type: "freight",
          description: `Freight - ${c.containerNumber} (${supplierName})`,
          ref: c.containerNumber,
          amount: freight,
          commissionAmount: null,
          commissionCurrency: null,
        });
      }
      // USD commission from linked (child) suppliers goes directly to the broker's USD ledger,
      // but only when this broker is actually the designated commission recipient.
      // Commission from the broker's own containers and any non-USD commission stay excluded.
      const commSupplierId = c.commissionSupplierId ?? null;
      const commForBroker = commSupplierId === brokerId || commSupplierId === null;
      if (commAmt > 0 && commCc === "USD" && c.supplierId !== brokerId && commForBroker) {
        addRow("USD", {
          date: dateVal,
          type: "commission",
          description: `Commission from ${supplierName} — ${c.containerNumber}`,
          ref: c.containerNumber,
          amount: commAmt,
          commissionAmount: commAmt,
          commissionCurrency: commCc,
        });
      }
    }

    // Payment rows
    for (const p of allPayments as any[]) {
      const supplierName = supplierNameMap[p.supplierId] || "Unknown";
      const cc = p.currencyCode || "USD";
      addRow(cc, {
        date: p.date ? String(p.date) : null,
        type: "payment",
        description: `Payment — ${supplierName}`,
        ref: p.notes || "Payment",
        amount: -parseFloat(p.amount || "0"),
        commissionAmount: null,
        commissionCurrency: null,
      });
    }

    // Voucher-based payment rows (general accounting payments linked to factory suppliers)
    // Skip optional vouchers — they are informational only and don't affect the balance.
    for (const p of allVoucherPayments as any[]) {
      if (p.optional) continue;
      const cc = p.currency || "USD";
      const suppId = p.supplierId;
      const supplierName = suppId ? (supplierNameMap[suppId] || "Unknown") : "Unknown";
      addRow(cc, {
        date: p.voucherDate ? String(p.voucherDate) : null,
        type: "payment",
        description: `Payment — ${supplierName}`,
        ref: p.voucherNumber || "Voucher Payment",
        amount: -parseFloat(p.debitAmount || "0"),
        commissionAmount: null,
        commissionCurrency: null,
      });
    }

    // FX transfer rows — deduplicate by id to avoid counting same transfer twice
    // Key logic: Only affect the broker's USD pool for transfers TO/FROM the broker.
    // For internal pool transfers (linked supplier → linked supplier), only show the
    // source-currency leg so each supplier's sub-balance is visible without distorting the pool total.
    // For USD→USD transfers FROM a linked supplier TO the broker, adding both fx_out and fx_in
    // to the USD section used to cancel them to zero — now we only add the correct directional row.
    const seenFxIds = new Set<number>();
    for (const t of allFx as any[]) {
      if (seenFxIds.has(t.id)) continue;
      seenFxIds.add(t.id);
      const fromCc = t.fromCurrencyCode || "USD";
      const fromAmt = parseFloat(t.fromAmount || "0");
      const toUsd = parseFloat(t.toAmountUsd || "0");
      const rate = fromAmt > 0 ? (toUsd / fromAmt).toFixed(4) : "1";
      const dateVal = t.date ? String(t.date) : null;
      const isFromBroker = t.fromSupplierId === brokerId;
      const isToBroker = t.toSupplierId === brokerId;

      // Non-USD source currency leg: always show fx_out in the foreign currency section
      // so the linked supplier's foreign-currency contribution is visible.
      if (fromCc !== "USD") {
        addRow(fromCc, {
          date: dateVal,
          type: "fx_out",
          description: `FX ${fromCc}→USD @ ${rate}`,
          ref: `FX-${t.id}`,
          amount: -fromAmt,
          commissionAmount: null,
          commissionCurrency: null,
        });
      }

      // USD pool: FX In — only when the broker is the recipient.
      // (Linked-supplier-to-linked-supplier USD transfers don't change the broker's pool.)
      if (isToBroker) {
        addRow("USD", {
          date: dateVal,
          type: "fx_in",
          description: `FX In from ${fromCc} @ ${rate}`,
          ref: `FX-${t.id}`,
          amount: toUsd,
          commissionAmount: null,
          commissionCurrency: null,
        });
      }

      // USD pool: FX Out — only when the broker is the sender (broker redistributes USD out).
      if (isFromBroker && fromCc === "USD") {
        addRow("USD", {
          date: dateVal,
          type: "fx_out",
          description: `FX USD out @ ${rate}`,
          ref: `FX-${t.id}`,
          amount: -fromAmt,
          commissionAmount: null,
          commissionCurrency: null,
        });
      }
    }

    // Offload additional charge rows
    for (const oc of allOffloadCharges as any[]) {
      const cc = oc.currencyCode || "USD";
      const amt = parseFloat(oc.amount || "0");
      const supplierName = supplierNameMap[oc.supplierId] || "Unknown";
      const dateVal = oc.createdAt ? new Date(oc.createdAt).toISOString().split("T")[0] : null;
      addRow(cc, {
        date: dateVal,
        type: "other_charge",
        description: `${oc.description || "Additional Charge"} — ${supplierName}`,
        ref: `Container ${oc.containerId}`,
        amount: amt,
        commissionAmount: null,
        commissionCurrency: null,
      });
    }

    // Container-level other charge rows (linked via container → supplier)
    for (const oc of allContainerOtherCharges as any[]) {
      const cc = oc.chargeCurrencyCode || oc.containerCurrencyCode || "USD";
      const amt = parseFloat(oc.amount || "0");
      const dateVal = oc.createdAt ? new Date(oc.createdAt).toISOString().split("T")[0] : null;
      addRow(cc, {
        date: dateVal,
        type: "other_charge",
        description: `${oc.description || "Other Charge"} — ${oc.containerNumber || `Container ${oc.containerId}`}`,
        ref: oc.containerNumber || `Container ${oc.containerId}`,
        amount: amt,
        commissionAmount: null,
        commissionCurrency: null,
      });
    }

    // factory_containers.other_charges column where other_charges_supplier_id is in the broker group
    // (distinct from the factoryContainerOtherCharges table which is a separate multi-row charges table)
    const containerColOtherCharges = allSupplierIds.length > 0
      ? await db
          .select({
            id: factoryContainers.id,
            containerNumber: factoryContainers.containerNumber,
            otherCharges: factoryContainers.otherCharges,
            otherChargesSupplierId: factoryContainers.otherChargesSupplierId,
            otherChargesCurrencyCode: (factoryContainers as any).otherChargesCurrencyCode,
            containerCurrencyCode: factoryContainers.currencyCode,
            arrivalDate: factoryContainers.arrivalDate,
            createdAt: factoryContainers.createdAt,
            supplierId: factoryContainers.supplierId,
          })
          .from(factoryContainers)
          .where(and(
            eq(factoryContainers.companyId, companyId),
            sql`${factoryContainers.otherChargesSupplierId} = ANY(${sqlArray(allSupplierIds)})`,
            sql`${factoryContainers.otherCharges}::numeric > 0`
          ))
      : [];

    for (const c of containerColOtherCharges as any[]) {
      const cc = c.otherChargesCurrencyCode || "USD";
      const amt = parseFloat(c.otherCharges || "0");
      const chargeSupplierName = supplierNameMap[c.otherChargesSupplierId] || "Unknown";
      const containerSupplierName = supplierNameMap[c.supplierId] || "Unknown";
      const dateVal = c.arrivalDate ? String(c.arrivalDate) : c.createdAt ? new Date(c.createdAt).toISOString().split("T")[0] : null;
      addRow(cc, {
        date: dateVal,
        type: "other_charge",
        description: `Other Charges — ${c.containerNumber} (${containerSupplierName} → ${chargeSupplierName})`,
        ref: c.containerNumber,
        amount: amt,
        commissionAmount: null,
        commissionCurrency: null,
      });
    }

    // Inject opening balance rows (always USD) for broker and all linked suppliers
    for (const s of allSuppliers as any[]) {
      const ob = parseFloat(s.openingBalance || "0");
      if (ob !== 0) {
        if (!ledgerByCurrency["USD"]) ledgerByCurrency["USD"] = [];
        ledgerByCurrency["USD"].unshift({
          date: null,
          type: "opening_balance" as const,
          description: `Opening Balance — ${s.name}`,
          ref: "OB",
          amount: ob,
          commissionAmount: null,
          commissionCurrency: null,
        });
      }
    }

    // Sort rows by date within each section
    for (const cc of Object.keys(ledgerByCurrency)) {
      ledgerByCurrency[cc].sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const db2 = b.date ? new Date(b.date).getTime() : 0;
        return da - db2;
      });
    }

    // Build ledgers with running balance
    const currencyLedgers = Object.entries(ledgerByCurrency).map(([cc, rows]) => {
      let runBal = 0;
      const rowsWithBal = rows.map((row) => {
        // Commission is excluded from the broker balance until explicitly transferred.
        // commissionAmount is always null now, but guard defensively.
        runBal += row.amount;
        return { ...row, runningBalance: runBal };
      });
      const containerRows = rows.filter(r => r.type === "container");
      const totalContainers = containerRows.length;
      const totalValue = containerRows.reduce((s, r) => s + r.amount, 0);
      const totalPaid = Math.abs(rows.filter(r => r.type === "payment").reduce((s, r) => s + r.amount, 0));
      const totalFxOut = Math.abs(rows.filter(r => r.type === "fx_out").reduce((s, r) => s + r.amount, 0));
      const totalFxIn = rows.filter(r => r.type === "fx_in").reduce((s, r) => s + r.amount, 0);
      const totalOtherCharges = rows.filter(r => r.type === "other_charge").reduce((s, r) => s + r.amount, 0);
      const totalFreight = rows.filter(r => r.type === "freight").reduce((s, r) => s + r.amount, 0);
      // A "broker pool" section is the USD section that has no containers —
      // it represents USD the broker has received from FX settlements and commission transfers.
      // Its balance is an ASSET (received), not a payable, so CR/DR labels are inverted vs normal sections.
      const isBrokerPool = cc === "USD" && totalContainers === 0 && totalFxIn > 0;
      return {
        currencyCode: cc,
        rows: rowsWithBal,
        totalContainers,
        totalValue: totalValue.toFixed(2),
        totalFreight: totalFreight.toFixed(2),
        totalOtherCharges: totalOtherCharges.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        totalFxOut: totalFxOut.toFixed(2),
        totalFxIn: totalFxIn.toFixed(2),
        netBalance: runBal.toFixed(2),
        isBrokerPool,
      };
    }).sort((a, b) => (a.currencyCode === "USD" ? 1 : b.currencyCode === "USD" ? -1 : a.currencyCode.localeCompare(b.currencyCode)));

    return { supplier: broker, linkedSuppliers: linkedRaw, currencyLedgers };
  }

  app.get("/api/factory/suppliers/:id/broker-statement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseId(req.params.id);
      if (brokerId === null) return res.status(400).json({ message: "Invalid id" });
      const data = await buildBrokerStatement(brokerId, companyId);
      if (!data) return res.status(404).json({ message: "Supplier not found" });
      return res.json(data);
    } catch (err: any) {
      console.error("Broker statement error:", err);
      return res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/factory/suppliers/:id/broker-statement/export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseId(req.params.id);
      if (brokerId === null) return res.status(400).json({ message: "Invalid id" });
      const data = await buildBrokerStatement(brokerId, companyId);
      if (!data) return res.status(404).json({ message: "Supplier not found" });

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "ERP System";
      wb.created = new Date();

      const typeLabel: Record<string, string> = {
        container: "Container", payment: "Payment",
        fx_out: "FX Out", fx_in: "FX In", commission: "Commission", other_charge: "Other Charge",
        freight: "Freight",
      };
      const rowTypeFill: Record<string, string> = {
        container: "FFFAFAFA", payment: "FFE8F5E9", fx_out: "FFFFF8E1", fx_in: "FFE3F2FD", commission: "FFFFF3E0", other_charge: "FFEDE7F6",
        freight: "FFFFF3E0",
      };

      for (const section of data.currencyLedgers) {
        const ws = wb.addWorksheet(section.currencyCode);
        ws.properties.defaultRowHeight = 15;

        // Title row
        const titleRow = ws.addRow([`Broker Statement — ${(data.supplier as any).name} — ${section.currencyCode}`]);
        titleRow.font = { bold: true, size: 13 };
        ws.mergeCells(`A${titleRow.number}:G${titleRow.number}`);
        ws.addRow([]);

        // Column headers
        const hdrRow = ws.addRow(["Date", "Type", "Description", "Amount", "Commission", "Comm. Currency", "Running Balance"]);
        hdrRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
        hdrRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
        hdrRow.alignment = { horizontal: "left" };
        ["D", "E", "G"].forEach(col => {
          const cell = hdrRow.getCell(col);
          cell.alignment = { horizontal: "right" };
        });

        ws.columns = [
          { key: "date", width: 14 },
          { key: "type", width: 14 },
          { key: "description", width: 40 },
          { key: "amount", width: 18 },
          { key: "commission", width: 16 },
          { key: "commCcy", width: 14 },
          { key: "runBal", width: 18 },
        ];

        for (const row of section.rows) {
          const dr = ws.addRow([
            row.date || "",
            typeLabel[row.type] || row.type,
            row.description,
            parseFloat((row.amount as any).toFixed(2)),
            row.commissionAmount != null ? parseFloat((row.commissionAmount as any).toFixed(2)) : "",
            row.commissionCurrency || "",
            parseFloat((row.runningBalance as any).toFixed(2)),
          ]);
          dr.getCell("D").numFmt = "#,##0.00";
          dr.getCell("E").numFmt = "#,##0.00";
          dr.getCell("G").numFmt = "#,##0.00";
          dr.getCell("D").alignment = { horizontal: "right" };
          dr.getCell("E").alignment = { horizontal: "right" };
          dr.getCell("G").alignment = { horizontal: "right" };
          const fillArgb = rowTypeFill[row.type] || "FFFFFFFF";
          dr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
        }

        // Spacer
        ws.addRow([]);

        // Totals
        const totalsLabel = ws.addRow(["SECTION TOTALS"]);
        totalsLabel.font = { bold: true };
        const totalsData = ws.addRow([
          "", "",
          `Containers: ${section.totalContainers}  |  Freight: ${section.totalFreight}  |  Paid: ${section.totalPaid}  |  FX Out: ${section.totalFxOut}`,
          parseFloat(section.totalValue),
          parseFloat(section.totalCommission),
          "",
          parseFloat(section.netBalance),
        ]);
        totalsData.font = { bold: true };
        totalsData.getCell("D").numFmt = "#,##0.00";
        totalsData.getCell("E").numFmt = "#,##0.00";
        totalsData.getCell("G").numFmt = "#,##0.00";
        ["D", "E", "G"].forEach(col => { totalsData.getCell(col).alignment = { horizontal: "right" }; });
        totalsData.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFD8DC" } };
      }

      // Summary sheet
      const sumWs = wb.addWorksheet("Summary");
      sumWs.addRow([`Broker Consolidated Statement — ${(data.supplier as any).name}`]).font = { bold: true, size: 13 };
      sumWs.addRow([`Generated: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`]).font = { italic: true };
      sumWs.addRow([]);
      const sumHdr = sumWs.addRow(["Currency", "Containers", "Gross Value", "Commission", "Freight", "FX Out", "FX In", "Paid", "Net Balance"]);
      sumHdr.font = { bold: true, color: { argb: "FFFFFFFF" } };
      sumHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
      for (const section of data.currencyLedgers) {
        const dr = sumWs.addRow([
          section.currencyCode,
          section.totalContainers,
          parseFloat(section.totalValue),
          parseFloat(section.totalCommission),
          parseFloat(section.totalFreight || "0"),
          parseFloat(section.totalFxOut),
          parseFloat(section.totalFxIn),
          parseFloat(section.totalPaid),
          parseFloat(section.netBalance),
        ]);
        // Colour FX Out red, FX In green for clarity
        ["C", "D", "E", "F", "G", "H", "I"].forEach(col => {
          dr.getCell(col).numFmt = "#,##0.00";
          dr.getCell(col).alignment = { horizontal: "right" };
        });
        const fxOutVal = parseFloat(section.totalFxOut);
        const fxInVal  = parseFloat(section.totalFxIn);
        const freightVal = parseFloat(section.totalFreight || "0");
        if (fxOutVal > 0) {
          dr.getCell("F").font = { color: { argb: "FFCC0000" } };
        }
        if (fxInVal > 0) {
          dr.getCell("G").font = { color: { argb: "FF006600" } };
        }
        if (freightVal > 0) {
          dr.getCell("E").font = { color: { argb: "FFE65100" } };
        }
        // Bold the Net Balance
        dr.getCell("I").font = { bold: true };
      }
      sumWs.columns = [
        { width: 12 }, { width: 14 }, { width: 18 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 18 }
      ];

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="broker-statement-${(data.supplier as any).name?.replace(/\s+/g, "-") || brokerId}-${getClientDate(req)}.xlsx"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (err: any) {
      console.error("Broker statement export error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Broker Visual Statement (container-centric view for the new dedicated page) ──
  app.get("/api/factory/suppliers/:id/broker-visual-statement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseId(req.params.id);
      if (brokerId === null) return res.status(400).json({ message: "Invalid id" });
      const from: string | undefined = req.query.from as string | undefined;
      const to: string | undefined = req.query.to as string | undefined;

      // Broker + linked suppliers
      const [broker] = await db.select().from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, brokerId), eq(factorySuppliers.companyId, companyId)));
      if (!broker) return res.status(404).json({ message: "Supplier not found" });

      const linked = await db.select().from(factorySuppliers)
        .where(and(eq(factorySuppliers.parentId, brokerId), eq(factorySuppliers.companyId, companyId)));
      const allSupplierIds = [broker.id, ...linked.map((s: any) => s.id)];
      const nameMap: Record<number, string> = {};
      for (const s of [broker, ...linked]) nameMap[(s as any).id] = (s as any).name;

      // Containers (filtered by arrival date if provided)
      let containerQuery = db.select().from(factoryContainers)
        .where(and(
          eq(factoryContainers.companyId, companyId),
          inArray(factoryContainers.supplierId, allSupplierIds)
        ))
        .$dynamic();
      if (from) containerQuery = containerQuery.where(sql`${factoryContainers.arrivalDate} >= ${from}`);
      if (to)   containerQuery = containerQuery.where(sql`${factoryContainers.arrivalDate} <= ${to}`);
      const containers = await containerQuery.orderBy(factoryContainers.arrivalDate, factoryContainers.createdAt);

      // Build container rows
      const containerRows = (containers as any[]).map((c: any) => {
        const kg   = parseFloat(c.actualReceivedKg || c.totalKg || "0");
        const rate = parseFloat(c.ratePerKg || "0");
        return {
          id:                c.id,
          supplierName:      nameMap[c.supplierId] || "Unknown",
          containerNumber:   c.containerNumber,
          weight:            kg,
          ratePerKg:         rate,
          goodsAmount:       kg * rate,
          goodsCurrency:     c.currencyCode || "USD",
          freightAmount:     parseFloat(c.freight || "0"),
          freightCurrency:   c.freightCurrencyCode || "USD",
          commissionAmount:  parseFloat(c.commissionAmount || "0"),
          commissionCurrency: c.commissionCurrencyCode || "USD",
          arrivalDate:       c.arrivalDate ? String(c.arrivalDate) : null,
          status:            c.status,
        };
      });

      // Payments (direct)
      let payQuery = db.select().from(factorySupplierPayments)
        .where(and(
          eq(factorySupplierPayments.companyId, companyId),
          inArray(factorySupplierPayments.supplierId, allSupplierIds)
        ))
        .$dynamic();
      if (from) payQuery = payQuery.where(sql`${factorySupplierPayments.date} >= ${from}`);
      if (to)   payQuery = payQuery.where(sql`${factorySupplierPayments.date} <= ${to}`);
      const payments = await payQuery.orderBy(factorySupplierPayments.date);

      // FX transfers involving any of the suppliers
      let fxQuery = db.select().from(factorySupplierFxTransfers)
        .where(and(
          eq(factorySupplierFxTransfers.companyId, companyId),
          sql`(${factorySupplierFxTransfers.fromSupplierId} = ANY(${sqlArray(allSupplierIds)}) OR ${factorySupplierFxTransfers.toSupplierId} = ANY(${sqlArray(allSupplierIds)}))`
        ))
        .$dynamic();
      if (from) fxQuery = fxQuery.where(sql`${factorySupplierFxTransfers.date} >= ${from}`);
      if (to)   fxQuery = fxQuery.where(sql`${factorySupplierFxTransfers.date} <= ${to}`);
      const fxTransfers = await fxQuery.orderBy(factorySupplierFxTransfers.date);

      // Voucher payments (non-optional only)
      let vpayRows: any[] = [];
      if (allSupplierIds.length > 0) {
        let vpayQ = db.select({
          id: voucherEntries.id,
          debitAmount: voucherEntries.debitAmount,
          supplierId: voucherEntries.factorySupplierId,
          voucherDate: vouchers.voucherDate,
          description: vouchers.description,
          voucherNumber: vouchers.voucherNumber,
          currency: vouchers.currency,
          optional: vouchers.optional,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(
          inArray(voucherEntries.factorySupplierId as any, allSupplierIds),
          sql`${voucherEntries.debitAmount}::numeric > 0`,
          sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-PAY-%'`,
          eq(vouchers.optional, false)
        ))
        .$dynamic();
        if (from) vpayQ = vpayQ.where(sql`${vouchers.voucherDate} >= ${from}`);
        if (to)   vpayQ = vpayQ.where(sql`${vouchers.voucherDate} <= ${to}`);
        vpayRows = await vpayQ.orderBy(vouchers.voucherDate);
      }

      // Build payment rows (unified format)
      type PayRow = {
        id: string;
        date: string | null;
        type: "payment" | "fx_in" | "fx_out" | "voucher";
        fromCurrency: string;
        fromAmount: number;
        fxRate: number | null;
        usdAmount: number;
        notes: string | null;
        supplierName?: string;
      };

      const paymentRows: PayRow[] = [];

      for (const p of payments as any[]) {
        const amt   = parseFloat(p.amount || "0");
        const rate  = parseFloat(p.fxRateToUsd || "1") || 1;
        const usd   = parseFloat(p.amountUsd || String(amt));
        paymentRows.push({
          id:           `pay-${p.id}`,
          date:         p.date ? String(p.date) : null,
          type:         "payment",
          fromCurrency: p.currencyCode || "USD",
          fromAmount:   amt,
          fxRate:       p.currencyCode === "USD" ? null : rate,
          usdAmount:    usd,
          notes:        p.notes || null,
          supplierName: nameMap[p.supplierId],
        });
      }

      for (const v of vpayRows as any[]) {
        const amt = parseFloat(v.debitAmount || "0");
        paymentRows.push({
          id:           `vpay-${v.id}`,
          date:         v.voucherDate ? String(v.voucherDate) : null,
          type:         "voucher",
          fromCurrency: v.currency || "USD",
          fromAmount:   amt,
          fxRate:       null,
          usdAmount:    amt,
          notes:        v.voucherNumber || v.description || null,
          supplierName: nameMap[v.supplierId],
        });
      }

      const seenFx = new Set<number>();
      for (const t of fxTransfers as any[]) {
        if (seenFx.has(t.id)) continue;
        seenFx.add(t.id);
        const fromCc  = t.fromCurrencyCode || "USD";
        const fromAmt = parseFloat(t.fromAmount || "0");
        const toUsd   = parseFloat(t.toAmountUsd || "0");
        const rate    = fromAmt > 0 ? toUsd / fromAmt : 1;
        const dateVal = t.date ? String(t.date) : null;

        if (t.toSupplierId === brokerId) {
          // FX In to broker
          paymentRows.push({
            id:           `fx-in-${t.id}`,
            date:         dateVal,
            type:         "fx_in",
            fromCurrency: fromCc,
            fromAmount:   fromAmt,
            fxRate:       fromCc !== "USD" ? parseFloat(rate.toFixed(6)) : null,
            usdAmount:    toUsd,
            notes:        t.notes || null,
            supplierName: nameMap[t.fromSupplierId],
          });
        }

        if (t.fromSupplierId === brokerId && fromCc === "USD") {
          // FX Out from broker (USD redistribution)
          paymentRows.push({
            id:           `fx-out-${t.id}`,
            date:         dateVal,
            type:         "fx_out",
            fromCurrency: "USD",
            fromAmount:   -fromAmt,
            fxRate:       null,
            usdAmount:    -fromAmt,
            notes:        t.notes || null,
            supplierName: nameMap[t.toSupplierId],
          });
        }
      }

      // Sort payment rows by date
      paymentRows.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return -1;
        if (!b.date) return 1;
        return a.date.localeCompare(b.date);
      });

      // Summary: credit (containers owed) and paid, per currency
      const creditByCurrency: Record<string, number> = {};
      const addCredit = (cc: string, amt: number) => { creditByCurrency[cc] = (creditByCurrency[cc] || 0) + amt; };
      for (const c of containerRows) {
        if (c.goodsAmount > 0)      addCredit(c.goodsCurrency, c.goodsAmount);
        if (c.freightAmount > 0)    addCredit(c.freightCurrency, c.freightAmount);
        if (c.commissionAmount > 0) addCredit(c.commissionCurrency, c.commissionAmount);
      }
      const paidByCurrency: Record<string, number> = {};
      const addPaid = (cc: string, amt: number) => { paidByCurrency[cc] = (paidByCurrency[cc] || 0) + amt; };
      for (const p of paymentRows) {
        addPaid(p.fromCurrency, p.fromAmount);
      }

      return res.json({
        broker:         { id: broker.id, name: (broker as any).name },
        linkedSuppliers: linked.map((s: any) => ({ id: s.id, name: s.name })),
        containers:     containerRows,
        payments:       paymentRows,
        creditByCurrency,
        paidByCurrency,
      });
    } catch (err: any) {
      console.error("Broker visual statement error:", err);
      return res.status(500).json({ message: err.message });
    }
  });

  // ───────────────────────────────────────────────
  // 2. Factory Categories CRUD
  // ───────────────────────────────────────────────

}
