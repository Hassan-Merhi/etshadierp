/**
 * supplierCrudRoutes: FactorySupplierPayment endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { parseId, parseOptionalId } from "../../../../lib/parseId";
import { getErrorMessage } from "../../../../lib/httpHandlers";
import { logger } from "../../../../lib/logger";
import { getClientDate } from "../../../../lib/dateUtils";
import { db } from "../../../../db";
import { removeDaybookEntriesForSource } from "../../../../services/factory/daybookSourceIntegrity";
import { requireAuth } from "../../../../auth";
import { writeDaybookEntry, getOrCreateLedgerAccount } from "../../_helpers";
import {
  factorySuppliers,
  voucherEntries,
  vouchers,
  factorySupplierPayments,
  insertFactorySupplierPaymentSchema,
} from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

export function registerFactorySupplierPaymentRoutes(app: Express) {
  app.get("/api/factory/supplier-payments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = req.query.supplierId ? parseOptionalId(req.query.supplierId) : null;

      // Also fetch all sub-accounts of the supplier to include their payments
      const supplierIds: number[] = supplierId ? [supplierId] : [];
      if (supplierId) {
        const children = await db
          .select({ id: factorySuppliers.id })
          .from(factorySuppliers)
          .where(and(eq(factorySuppliers.companyId, companyId), eq((factorySuppliers as any).parentId, supplierId)));
        children.forEach((c: any) => supplierIds.push(c.id));
      }

      const paymentConditions = [eq(factorySupplierPayments.companyId, companyId)];
      if (supplierIds.length > 0) {
        paymentConditions.push(inArray(factorySupplierPayments.supplierId, supplierIds));
      }

      const payments = await db
        .select()
        .from(factorySupplierPayments)
        .where(and(...paymentConditions))
        .orderBy(desc(factorySupplierPayments.date));
      res.json(payments);
    } catch (error: unknown) {
      logger.error("Error fetching supplier payments:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/factory/supplier-payments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactorySupplierPaymentSchema.parse({ ...req.body, companyId });

      // Reject writes with an unresolved non-USD rate rather than silently posting the
      // payment voucher at an assumed rate of 1 — factory_supplier_payments has no
      // fxRateConfirmed flag yet, so any explicitly-supplied rate is trusted as-is.
      const payCurrency = (parsed as any).currencyCode || "USD";
      if (payCurrency !== "USD") {
        const suppliedRate = parseFloat((parsed as any).fxRateToUsd || "0");
        if (!(suppliedRate > 0)) {
          return res.status(400).json({
            message: `Cannot record a ${payCurrency} payment without an explicit exchange rate to USD.`,
          });
        }
      }

      const created = await db.transaction(async (tx: any) => {
        const [payment] = await tx.insert(factorySupplierPayments).values(parsed).returning();

        // Double-entry Payment voucher: DR Supplier Payable / CR Bank or Cash
        const payAmt = parseFloat(payment.amount);
        const payAmtStr = payAmt.toFixed(2);
        const payVoucherNum = `FACTORY-PAY-${payment.id}-${Date.now()}`;

        const [payVoucher] = await tx
          .insert(vouchers)
          .values({
            companyId,
            voucherType: "Payment",
            voucherNumber: payVoucherNum,
            voucherDate: payment.date,
            description: `Supplier payment – see factory payment #${payment.id}`,
            totalAmount: payAmtStr,
            currency: payment.currencyCode || "USD",
            exchangeRate: String(parseFloat((payment.fxRateToUsd as string) || "1")),
            sourceModule: "FACTORY",
            effectiveDate: (req.body.effectiveDate as string) || null,
          })
          .returning();

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

      const [spSupplier] = await db
        .select({ name: factorySuppliers.name })
        .from(factorySuppliers)
        .where(eq(factorySuppliers.id, created.supplierId));
      await writeDaybookEntry(db, {
        companyId,
        txDate: created.date,
        txType: "SUPPLIER_PAYMENT",
        referenceId: created.id,
        referenceTable: "factory_supplier_payments",
        description: `Supplier payment: ${spSupplier?.name || "Unknown"} – ${parseFloat(created.amount).toFixed(2)} ${created.currencyCode}`,
        amountCurrency: parseFloat(created.amount),
        amountUsd: parseFloat(created.amountUsd),
        currencyCode: created.currencyCode,
        effectiveDate: (req.body.effectiveDate as string) || null,
      });
      res.json(created);
    } catch (error: unknown) {
      logger.error("Error creating supplier payment:", { error: error });
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.delete("/api/factory/supplier-payments/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [payment] = await db
        .select()
        .from(factorySupplierPayments)
        .where(and(eq(factorySupplierPayments.id, id), eq(factorySupplierPayments.companyId, companyId)));
      const [spDelSupplier] = payment
        ? await db
            .select({ name: factorySuppliers.name })
            .from(factorySuppliers)
            .where(eq(factorySuppliers.id, payment.supplierId))
        : [null];

      await db.transaction(async (tx: any) => {
        // Hard-delete the auto-generated Payment voucher and its entries for this payment
        const payVoucherPattern = `FACTORY-PAY-${id}-%`;
        const payVouchers = await tx
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(and(eq(vouchers.companyId, companyId), sql`${vouchers.voucherNumber} LIKE ${payVoucherPattern}`));
        if (payVouchers.length > 0) {
          const vIds = payVouchers.map((v: any) => v.id);
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, vIds));
        }
        // Remove the original SUPPLIER_PAYMENT daybook entry (including legacy rows
        // written before referenceTable was populated).
        await removeDaybookEntriesForSource(tx, {
          companyId,
          referenceTable: "factory_supplier_payments",
          referenceId: id,
          txTypes: ["SUPPLIER_PAYMENT"],
        });
        await tx
          .delete(factorySupplierPayments)
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
    } catch (error: unknown) {
      logger.error("Error deleting supplier payment:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // ───────────────────────────────────────────────
  // 1a-ii. Factory Supplier FX Transfers
  // ───────────────────────────────────────────────
}
