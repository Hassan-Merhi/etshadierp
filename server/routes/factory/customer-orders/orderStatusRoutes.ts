import { trackOneContainerById } from "../../../services/containerTrackingService";
import { parseId, parseOptionalId } from "../../../lib/parseId";
import { dispatchNotification } from "../../../lib/notificationService";
import { getClientDate } from "../../../lib/dateUtils";
import { getExportPriceVisibility } from "../../../helpers/exportVisibility";
import { sendWhatsAppFileToChatIdPos } from "../../../services/whatsappService";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
import { adjustInventory } from "../../../inventoryHelper";
import {
  writeDaybookEntry, getOrFetchFxRateToUsd, getOrCreateLedgerAccount,
  isLegacySHA256Hash, verifySupervisorPassword, recalculateOrderTotals,
} from "../_helpers";
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
  customerOrderBaleRemovals, customerOrderExpectedLines,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

import { buildOrderExcelBuffer } from "./orderHelpers";

export function registerOrderStatusRoutes(app: Express) {
  app.post("/api/factory/customer-orders/:id/finalize", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });

      const result = await db.transaction(async (tx: any) => {
        const [order] = await tx.select().from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
        if (!order) throw new Error("Order not found");
        if (!["DRAFT", "VERIFIED"].includes(order.status)) throw new Error("Only DRAFT or VERIFIED orders can be finalized");

        const bales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        if (bales.length === 0) throw new Error("Order has no bales");

        for (const b of bales) {
          // Just verify the bale still exists — status is not checked here.
          const [factoryBale] = await tx.select().from(factoryBales)
            .where(eq(factoryBales.id, b.baleId));
          if (!factoryBale || factoryBale.status === "DELETED") {
            throw new Error(`Bale ${b.baleReference} is no longer available`);
          }
        }

        let seqRows = await tx.execute(sql`SELECT * FROM customer_invoice_sequences WHERE company_id = ${companyId} FOR UPDATE`);
        let seqRow = seqRows.rows?.[0] || seqRows[0];
        if (!seqRow) {
          [seqRow] = await tx.insert(customerInvoiceSequences).values({ companyId, nextNumber: 1 }).returning();
        }
        const invoiceNum = seqRow.nextNumber || seqRow.next_number;
        await tx.update(customerInvoiceSequences).set({ nextNumber: invoiceNum + 1 }).where(eq(customerInvoiceSequences.companyId, companyId));
        const invoiceNumber = `INV-${String(invoiceNum).padStart(6, '0')}`;

        for (const b of bales) {
          await tx.update(factoryBales).set({ status: "SOLD", updatedAt: new Date() }).where(eq(factoryBales.id, b.baleId));
        }

        await recalculateOrderTotals(tx, orderId);

        const [recalcOrder] = await tx.select().from(customerOrders).where(eq(customerOrders.id, orderId));

        await tx.update(customerOrders).set({
          invoiceNumber,
          status: "FINALIZED",
          updatedAt: new Date(),
        }).where(eq(customerOrders.id, orderId));

        const grandTotal = parseFloat(recalcOrder.grandTotal || "0");
        // Use the order's stored date for the customer balance (not server "today"),
        // so re-finalising a reverted draft keeps the user-chosen invoice date.
        const today = recalcOrder.orderDate || getClientDate(req);

        await tx.insert(customerBalances).values({
          companyId,
          customerId: order.customerId,
          transactionDate: today,
          transactionType: "SALE",
          debitAmount: String(grandTotal),
          creditAmount: "0",
          balance: String(grandTotal),
          referenceType: "INVOICE",
          referenceId: order.id,
          description: `Invoice ${invoiceNumber}`,
          currency: "USD",
        });

        // Create journal entries for charges that have a ledgerAccountId.
        // If a PRE-voucher was already created when the charge was added in PENDING/VERIFIED
        // state, rename it to the invoice-based number and update its description.
        // Otherwise create a new voucher. This prevents double-counting.
        const chargesForJournal = await tx.select().from(customerOrderCharges)
          .where(and(eq(customerOrderCharges.orderId, orderId), sql`${customerOrderCharges.ledgerAccountId} IS NOT NULL`));

        if (chargesForJournal.length > 0) {
          const [customer] = await tx.select().from(customers).where(eq(customers.id, order.customerId));
          if (customer?.ledgerAccountId) {
            for (const charge of chargesForJournal) {
              const chargeAmount = parseFloat(charge.amount || "0");
              if (chargeAmount <= 0) continue;

              const invoiceVoucherNumber = `CHARGE-${invoiceNumber}-${charge.id}-${Date.now()}`;
              const chargeDesc = order.containerNumber
                ? `${charge.name} for offloaded container - ${order.containerNumber}`
                : `${charge.name} - ${invoiceNumber}`;

              // Check for a PRE-voucher created when the charge was saved in pending/verified state
              const preVoucherNumber = `CHARGE-PRE-${orderId}-${charge.id}`;
              const [preVoucher] = await tx.select({ id: vouchers.id })
                .from(vouchers)
                .where(and(eq(vouchers.companyId, companyId), eq(vouchers.voucherNumber, preVoucherNumber)));

              if (preVoucher) {
                // Rename the PRE-voucher — same entries already exist, just update the reference
                await tx.update(vouchers)
                  .set({ voucherNumber: invoiceVoucherNumber, voucherDate: today, description: chargeDesc })
                  .where(eq(vouchers.id, preVoucher.id));
                await tx.update(voucherEntries)
                  .set({ narration: chargeDesc })
                  .where(eq(voucherEntries.voucherId, preVoucher.id));
                // Phase 6: ensure the charge.voucherId FK points at the renamed voucher
                // (it should already, from the PRE-create stamp, but stay defensive for legacy data)
                await tx.update(customerOrderCharges)
                  .set({ voucherId: preVoucher.id })
                  .where(eq(customerOrderCharges.id, charge.id));
              } else {
                // No PRE-voucher — charge was added before this feature or on a DRAFT order
                const [chargeVoucher] = await tx.insert(vouchers).values({
                  companyId,
                  voucherType: "Journal",
                  voucherNumber: invoiceVoucherNumber,
                  voucherDate: today,
                  description: chargeDesc,
                  totalAmount: String(chargeAmount),
                  sourceModule: "FACTORY",
                }).returning();
                // Dr Customer Account (charge billed to customer)
                await tx.insert(voucherEntries).values({
                  voucherId: chargeVoucher.id,
                  ledgerAccountId: customer.ledgerAccountId,
                  customerId: order.customerId,
                  debitAmount: String(chargeAmount),
                  creditAmount: "0",
                  narration: chargeDesc,
                });
                // Cr Charge Account (freight/other charges income account)
                await tx.insert(voucherEntries).values({
                  voucherId: chargeVoucher.id,
                  ledgerAccountId: charge.ledgerAccountId!,
                  debitAmount: "0",
                  creditAmount: String(chargeAmount),
                  narration: chargeDesc,
                });
                // Phase 6: stamp FK
                await tx.update(customerOrderCharges)
                  .set({ voucherId: chargeVoucher.id })
                  .where(eq(customerOrderCharges.id, charge.id));
              }
            }
          }
        }

        const [finalOrder] = await tx
          .select({
            id: customerOrders.id,
            companyId: customerOrders.companyId,
            customerId: customerOrders.customerId,
            invoiceNumber: customerOrders.invoiceNumber,
            orderDate: customerOrders.orderDate,
            proformaIdUsed: customerOrders.proformaIdUsed,
            status: customerOrders.status,
            subtotalBales: customerOrders.subtotalBales,
            freightAmount: customerOrders.freightAmount,
            otherChargesTotal: customerOrders.otherChargesTotal,
            grandTotal: customerOrders.grandTotal,
            totalQtyBales: customerOrders.totalQtyBales,
            createdAt: customerOrders.createdAt,
            updatedAt: customerOrders.updatedAt,
            customerName: customers.legalName,
          })
          .from(customerOrders)
          .leftJoin(customers, eq(customerOrders.customerId, customers.id))
          .where(eq(customerOrders.id, orderId));

        const finalLines = await tx.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
        const finalBales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        const finalCharges = await tx.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

        return { ...finalOrder, lines: finalLines, bales: finalBales, charges: finalCharges };
      });

      const today = req.body.txDate || req.body.invoiceDate || getClientDate(req);
      const invoiceRefId = result.orderId || orderId;
      // Remove any previous INVOICE and INVOICE_REVERTED rows so only this approval shows
      await db.delete(factoryDaybookEntries).where(and(
        eq(factoryDaybookEntries.companyId, companyId),
        sql`${factoryDaybookEntries.txType} IN ('INVOICE','INVOICE_REVERTED')`,
        eq(factoryDaybookEntries.referenceId, invoiceRefId)
      ));
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "INVOICE",
        referenceId: invoiceRefId,
        referenceTable: "customer_orders",
        description: `Invoice ${result.invoiceNumber} – ${result.customerName || "Customer"}`,
        amountCurrency: parseFloat(result.grandTotal || "0"),
        amountUsd: parseFloat(result.grandTotal || "0"),
      });

      dispatchNotification({
        eventType: "INVOICE_FINALIZED",
        title: "Invoice Finalized",
        message: `Invoice ${result.invoiceNumber} finalized for ${result.customerName || "customer"}`,
        entityType: "customer_order",
        entityId: result.id,
        triggeredByUserId: (req.session as any)?.userId ?? null,
        companyId: result.companyId ?? companyId,
      }).catch(() => {});

      res.json(result);
    } catch (error: any) {
      console.error("Error finalizing order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-orders/:id/finalize-preview", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.json({ baleCount: 0, bales: [] });

      const baleIds = orderBales.map((b: any) => b.baleId);
      const baleRows = await db.select({
        id: factoryBales.id,
        referenceNumber: factoryBales.referenceNumber,
        productName: factoryBales.productName,
        weightKg: factoryBales.weightKg,
        status: factoryBales.status,
        erpLocationId: factoryBales.erpLocationId,
      }).from(factoryBales).where(inArray(factoryBales.id, baleIds));

      const locIds = [...new Set(baleRows.map((b: any) => b.erpLocationId).filter(Boolean))];
      const locationRecords = locIds.length > 0
        ? await db.select().from(locations).where(inArray(locations.id, locIds as number[]))
        : [];
      const locationMap = new Map(locationRecords.map((l: any) => [l.id, l.name]));

      const availableBales = baleRows.filter((b: any) =>
        ["IN_STOCK", "RESERVED_FOR_ORDER"].includes(b.status)
      );

      res.json({
        baleCount: availableBales.length,
        totalBalesInOrder: orderBales.length,
        bales: availableBales.map((b: any) => ({
          id: b.id,
          baleReference: b.referenceNumber,
          productName: b.productName,
          weightKg: parseFloat(b.weightKg || "0"),
          locationName: locationMap.get(b.erpLocationId) || "Unknown",
          status: b.status,
        })),
      });
    } catch (error: any) {
      console.error("Error fetching finalize preview:", error);
      res.status(500).json({ message: error.message });
    }
  });


  app.post("/api/factory/customer-orders/:id/force-sync-bale-status", requireAuth, async (req: any, res: any) => {
    try {
      const session = req.session as any;
      const companyId = session.factoryCompanyId || session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const role = (session.currentRole || session.role || "").toLowerCase();
      if (role !== "admin" && role !== "owner" && role !== "developer") {
        return res.status(403).json({ message: "Only admin/owner can force-sync bale statuses" });
      }

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["VERIFIED", "FINALIZED"].includes(order.status)) {
        return res.status(400).json({ message: "Order must be VERIFIED or FINALIZED to force-sync bale statuses" });
      }
      if (!order.invoiceNumber) {
        return res.status(400).json({ message: "Order must have an invoice number (previously finalized) to use force-sync" });
      }

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.status(400).json({ message: "Order has no bales" });

      let updated = 0;
      for (const b of orderBales) {
        const [existing] = await db.select({ status: factoryBales.status }).from(factoryBales).where(eq(factoryBales.id, b.baleId));
        if (existing && existing.status !== "SOLD") {
          await db.update(factoryBales).set({ status: "SOLD", updatedAt: new Date() }).where(eq(factoryBales.id, b.baleId));
          updated++;
        }
      }

      res.json({ message: `${updated} bale(s) marked as SOLD`, updated, total: orderBales.length });
    } catch (error: any) {
      console.error("Error force-syncing bale status:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Export a single customer order to Excel with full bale detail

  app.post("/api/factory/customer-orders/:id/unfinalize", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });

      await db.transaction(async (tx: any) => {
        const [order] = await tx.select().from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
        if (!order) throw new Error("Order not found");
        if (order.status !== "FINALIZED") throw new Error("Only FINALIZED orders can be reverted to Draft");

        // Block if any payment has been recorded against this invoice
        const payments = await tx.select({ id: customerBalances.id })
          .from(customerBalances)
          .where(and(
            eq(customerBalances.companyId, companyId),
            eq(customerBalances.referenceId, orderId),
            eq(customerBalances.referenceType, "INVOICE"),
            eq(customerBalances.transactionType, "PAYMENT"),
          ));
        if (payments.length > 0) {
          throw new Error("Cannot revert: this invoice has payments recorded against it. Reverse the payments first.");
        }

        // Delete the SALE balance entry for this invoice
        await tx.delete(customerBalances).where(and(
          eq(customerBalances.companyId, companyId),
          eq(customerBalances.referenceId, orderId),
          eq(customerBalances.referenceType, "INVOICE"),
          eq(customerBalances.transactionType, "SALE"),
        ));

        // Phase 6: delete charge journal vouchers via FK linkage; fall back to invoice-number
        // pattern for legacy unbacked rows. After delete, clear the FK on the charge rows so
        // they can be re-finalized later without dangling references.
        const linkedChargeRows = await tx.select({ id: customerOrderCharges.id, voucherId: customerOrderCharges.voucherId })
          .from(customerOrderCharges)
          .where(and(eq(customerOrderCharges.orderId, orderId), sql`${customerOrderCharges.voucherId} IS NOT NULL`));
        const linkedVoucherIds = linkedChargeRows.map((r: any) => r.voucherId).filter(Boolean);

        if (linkedVoucherIds.length > 0) {
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, linkedVoucherIds));
          await tx.update(vouchers).set({ deletedAt: new Date() }).where(inArray(vouchers.id, linkedVoucherIds));
          await tx.update(customerOrderCharges)
            .set({ voucherId: null })
            .where(and(eq(customerOrderCharges.orderId, orderId), sql`${customerOrderCharges.voucherId} IS NOT NULL`));
        }

        // Legacy fallback for charge vouchers that were never FK-linked
        if (order.invoiceNumber) {
          const legacyChargeVouchers = await tx.select({ id: vouchers.id })
            .from(vouchers)
            .where(and(
              eq(vouchers.companyId, companyId),
              eq(vouchers.sourceModule, "FACTORY"),
              sql`${vouchers.voucherNumber} LIKE ${"CHARGE-" + order.invoiceNumber + "-%"}`,
            ));
          for (const cv of legacyChargeVouchers) {
            await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, cv.id));
            await tx.update(vouchers).set({ deletedAt: new Date() }).where(eq(vouchers.id, cv.id));
          }
        }

        // Revert bales from SOLD → RESERVED_FOR_ORDER (order still exists, just un-finalized)
        const bales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        for (const b of bales) {
          await tx.update(factoryBales)
            .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
            .where(and(eq(factoryBales.id, b.baleId), eq(factoryBales.status, "SOLD")));
        }

        // Reset order to PENDING_VERIFICATION, clear invoice number
        await tx.update(customerOrders).set({
          status: "PENDING_VERIFICATION",
          invoiceNumber: null,
          updatedAt: new Date(),
        }).where(eq(customerOrders.id, orderId));

        // Daybook entry
        const [unfCustomer] = await tx.select({ legalName: customers.legalName })
          .from(customers).where(eq(customers.id, order.customerId));
        const unfToday = req.body.txDate || getClientDate(req);
        // Remove any previous INVOICE and INVOICE_REVERTED rows so only this revert shows
        await tx.delete(factoryDaybookEntries).where(and(
          eq(factoryDaybookEntries.companyId, companyId),
          sql`${factoryDaybookEntries.txType} IN ('INVOICE','INVOICE_REVERTED')`,
          eq(factoryDaybookEntries.referenceId, orderId)
        ));
        await writeDaybookEntry(tx, {
          companyId,
          txDate: unfToday,
          txType: "INVOICE_REVERTED",
          referenceId: orderId,
          description: `Invoice ${order.invoiceNumber} reverted to Draft – ${unfCustomer?.legalName || "Customer"}`,
        });
      });

      res.json({ message: "Invoice reverted to Draft successfully" });
    } catch (error: any) {
      console.error("Error unfinalizing order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/cancel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      // ── V5 guard: proformaIdUsed IS NOT NULL ────────────────────────────────
      // V5 containers have their own cancellation rules separate from legacy orders.
      if (order.proformaIdUsed) {
        // PENDING_VERIFICATION / VERIFIED / FINALIZED — hard block, no reversal yet
        if (["PENDING_VERIFICATION", "VERIFIED", "FINALIZED"].includes(order.status)) {
          return res.status(400).json({
            message: "V5 containers at or beyond PENDING_VERIFICATION cannot be cancelled. Contact admin for a reversal workflow.",
          });
        }

        // LOADING — any authenticated user can cancel; bale links are cleaned up
        if (order.status === "LOADING") {
          const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));

          // Archive bale links before deleting so the exact references survive and
          // can be restored verbatim when the order is un-cancelled.
          if (orderBales.length > 0) {
            await db.execute(
              sql`INSERT INTO customer_order_bales_history
                    (original_id, order_id, bale_id, bale_reference, location_id,
                     weight, article_code, bale_name, price_used, scanned_by)
                  SELECT id, order_id, bale_id, bale_reference, location_id,
                         weight, article_code, bale_name, price_used, scanned_by
                  FROM customer_order_bales
                  WHERE order_id = ${orderId}`,
            );
          }

          for (const ob of orderBales) {
            await db.update(factoryBales)
              .set({ status: "IN_STOCK", updatedAt: new Date() })
              .where(eq(factoryBales.id, ob.baleId));
          }
          await db.delete(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));

          // Reset order totals to zero now that all bale links are gone.
          // Without this call total_qty_bales would stay stale if the order is later restored.
          await recalculateOrderTotals(db, orderId);

          const [updated] = await db.update(customerOrders)
            .set({ status: "CANCELLED", updatedAt: new Date() })
            .where(eq(customerOrders.id, orderId))
            .returning();

          const [cancelCustomer] = await db.select({ legalName: customers.legalName })
            .from(customers).where(eq(customers.id, order.customerId));
          const cancelToday = req.body.txDate || getClientDate(req);
          await db.delete(factoryDaybookEntries).where(and(
            eq(factoryDaybookEntries.companyId, companyId),
            eq(factoryDaybookEntries.txType, "ORDER_CANCELLED"),
            eq(factoryDaybookEntries.referenceId, orderId),
          ));
          const cancelledBy = (req.session as any)?.username || "user";
          await writeDaybookEntry(db, {
            companyId,
            txDate: cancelToday,
            txType: "ORDER_CANCELLED",
            referenceId: orderId,
            description: `V5 container cancelled: ${cancelCustomer?.legalName || "Customer"}, ${orderBales.length} bale link${orderBales.length !== 1 ? "s" : ""} removed. Cancelled by: ${cancelledBy}.`,
          });
          return res.json(updated);
        }

        // V5 DRAFT — no supervisor required; fall through to shared DRAFT path below
      }

      // ── Non-V5 path (fully unchanged) and V5 DRAFT (no supervisor) ──────────
      if (!["DRAFT", "LOADING"].includes(order.status)) {
        return res.status(400).json({ message: "Only DRAFT or LOADING orders can be cancelled" });
      }

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      for (const ob of orderBales) {
        await db.update(factoryBales).set({ status: "IN_STOCK", updatedAt: new Date() }).where(eq(factoryBales.id, ob.baleId));
      }

      const [updated] = await db.update(customerOrders)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(eq(customerOrders.id, orderId))
        .returning();

      const [cancelCustomer] = await db.select({ legalName: customers.legalName })
        .from(customers).where(eq(customers.id, order.customerId));
      const cancelToday = req.body.txDate || getClientDate(req);
      await db.delete(factoryDaybookEntries).where(and(
        eq(factoryDaybookEntries.companyId, companyId),
        eq(factoryDaybookEntries.txType, "ORDER_CANCELLED"),
        eq(factoryDaybookEntries.referenceId, orderId)
      ));
      await writeDaybookEntry(db, {
        companyId,
        txDate: cancelToday,
        txType: "ORDER_CANCELLED",
        referenceId: orderId,
        description: `Order cancelled: ${cancelCustomer?.legalName || "Customer"}, ${orderBales.length} bale${orderBales.length !== 1 ? "s" : ""} released`,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error cancelling order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Restore a recently-cancelled LOADING order back to LOADING status
  app.post("/api/factory/customer-orders/:id/restore-loading", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "CANCELLED") return res.status(400).json({ message: "Only CANCELLED orders can be restored" });
      if (!order.loadingStartedAt) return res.status(400).json({ message: "This order was not a loading order" });

      // Restore bales that belong to this order back to RESERVED_FOR_ORDER.
      // V5 guard: proformaIdUsed IS NOT NULL
      // V5 bales remain IN_STOCK during loading — skip RESERVED_FOR_ORDER restore for V5 orders.
      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (!order.proformaIdUsed) {
        for (const ob of orderBales) {
          await db.update(factoryBales)
            .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
            .where(and(eq(factoryBales.id, ob.baleId), eq(factoryBales.status, "IN_STOCK")));
        }
      }

      const [restored] = await db.update(customerOrders)
        .set({ status: "LOADING", updatedAt: new Date() })
        .where(eq(customerOrders.id, orderId))
        .returning();

      // Remove the ORDER_CANCELLED daybook entry
      await db.delete(factoryDaybookEntries).where(and(
        eq(factoryDaybookEntries.companyId, companyId),
        eq(factoryDaybookEntries.txType, "ORDER_CANCELLED"),
        eq(factoryDaybookEntries.referenceId, orderId)
      ));

      res.json(restored);
    } catch (error: any) {
      console.error("Error restoring loading order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // CONTAINER LOADING WORKFLOW
  // ───────────────────────────────────────────────


  app.post("/api/factory/customer-orders-loading", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { customerId, proformaIdUsed, locationId, orderDate, containerNotes } = req.body;
      if (!customerId) return res.status(400).json({ message: "Customer is required" });
      if (!locationId) return res.status(400).json({ message: "Location is required" });

      const [order] = await db.insert(customerOrders).values({
        companyId,
        customerId: parseInt(customerId),
        proformaIdUsed: proformaIdUsed ? parseInt(proformaIdUsed) : null,
        locationId: parseInt(locationId),
        orderDate: orderDate || getClientDate(req),
        status: "LOADING",
        loadingStartedAt: new Date(),
        containerNotes: containerNotes || null,
      }).returning();

      const [loadingCustomer] = await db.select({ legalName: customers.legalName }).from(customers).where(eq(customers.id, parseInt(customerId)));
      const loadingToday = orderDate || getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: loadingToday,
        txType: "LOADING_CREATED",
        referenceId: order.id,
        description: `Loading started for customer: ${loadingCustomer?.legalName || customerId}`,
      });

      dispatchNotification({
        eventType: "LOADING_STARTED",
        title: "Loading Started",
        message: `New loading started for ${loadingCustomer?.legalName || "customer"}`,
        entityType: "customer_order",
        entityId: order.id,
        triggeredByUserId: (req.session as any)?.userId ?? null,
        companyId,
      }).catch(() => {});

      res.json(order);
    } catch (error: any) {
      console.error("Error creating loading order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/finalize-loading", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "LOADING") return res.status(400).json({ message: "Only LOADING orders can be finalized for loading" });

      const bales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (bales.length === 0) return res.status(400).json({ message: "Order has no bales scanned" });

      const [updated] = await db.update(customerOrders).set({
        status: "PENDING_VERIFICATION",
        loadingFinalizedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(customerOrders.id, orderId)).returning();

      // V5 guard: proformaIdUsed IS NOT NULL
      // Move all linked bales to SOLD when a V5 order reaches PENDING_VERIFICATION.
      // This is idempotent — bales already SOLD are unaffected by the update.
      // Legacy V2/V3 orders keep bales in RESERVED_FOR_ORDER until FINALIZED.
      if (order.proformaIdUsed) {
        for (const b of bales) {
          await db.update(factoryBales)
            .set({ status: "SOLD", updatedAt: new Date() })
            .where(eq(factoryBales.id, b.baleId));
        }
      }

      const [lsCustomer] = await db.select({ legalName: customers.legalName }).from(customers).where(eq(customers.id, order.customerId));
      const lsToday = req.body?.txDate || getClientDate(req);
      const lsTotalValue = bales.reduce((s: number, b: any) => s + parseFloat(b.priceUsed || "0"), 0);
      await writeDaybookEntry(db, {
        companyId,
        txDate: lsToday,
        txType: "LOADING_SUBMITTED",
        referenceId: orderId,
        description: `Loading submitted for verification: ${lsCustomer?.legalName || "Customer"}, ${bales.length} bale${bales.length !== 1 ? "s" : ""} scanned`,
        amountCurrency: lsTotalValue,
        amountUsd: lsTotalValue,
      });

      const lsMsg = `${bales.length} bale${bales.length !== 1 ? "s" : ""} submitted for ${lsCustomer?.legalName || "customer"}`;
      dispatchNotification({
        eventType: "LOADING_FINALIZED",
        title: "Loading Finalized",
        message: lsMsg,
        entityType: "customer_order",
        entityId: orderId,
        triggeredByUserId: (req.session as any)?.userId ?? null,
        companyId,
      }).catch(() => {});
      dispatchNotification({
        eventType: "INVOICE_PENDING",
        title: "Invoice Pending Verification",
        message: lsMsg,
        entityType: "customer_order",
        entityId: orderId,
        triggeredByUserId: (req.session as any)?.userId ?? null,
        companyId,
      }).catch(() => {});

      res.json(updated);
    } catch (error: any) {
      console.error("Error finalizing loading:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-orders/:id/verification-summary", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });

      // ── Use SELECT * for ALL queries in this route so that schema drift between
      // the Drizzle model and the live production table never causes a parse-time
      // "column does not exist" crash.  JS-side defaults are applied after each query.
      // (Drizzle's db.select() generates an explicit column list; if ANY column in
      //  shared/schema.ts hasn't been added to production yet the whole query fails
      //  before returning a single row — even COALESCE doesn't help because PostgreSQL
      //  rejects the SQL at parse time, not execution time.)

      const rawOrderResult = await db.execute(
        sql`SELECT * FROM customer_orders WHERE id = ${orderId} AND company_id = ${companyId} LIMIT 1`,
      );
      const rawOrderRows: any[] = (rawOrderResult as any).rows ?? (rawOrderResult as unknown as any[]);
      if (!rawOrderRows.length) return res.status(404).json({ message: "Order not found" });
      const orderRow = rawOrderRows[0];
      // Normalise the raw row into a typed object with JS-side defaults.
      const order = {
        id:                  orderRow.id,
        companyId:           orderRow.company_id,
        customerId:          orderRow.customer_id,
        invoiceNumber:       orderRow.invoice_number       ?? null,
        orderDate:           orderRow.order_date,
        proformaIdUsed:      orderRow.proforma_id_used     ?? null,
        status:              orderRow.status               ?? 'DRAFT',
        subtotalBales:       orderRow.subtotal_bales       ?? '0',
        freightAmount:       orderRow.freight_amount       ?? '0',
        otherChargesTotal:   orderRow.other_charges_total  ?? '0',
        grandTotal:          orderRow.grand_total          ?? '0',
        totalQtyBales:       orderRow.total_qty_bales      ?? 0,
        containerNumber:     orderRow.container_number     ?? null,
        shippingCompany:     orderRow.shipping_company     ?? null,
        containerNotes:      orderRow.container_notes      ?? null,
        destination:         orderRow.destination          ?? null,
        verifiedByUserId:    orderRow.verified_by_user_id  ?? null,
        verifiedAt:          orderRow.verified_at          ?? null,
        loadingStartedAt:    orderRow.loading_started_at   ?? null,
        loadingFinalizedAt:  orderRow.loading_finalized_at ?? null,
        locationId:          orderRow.location_id          ?? null,
        deletedAt:           orderRow.deleted_at           ?? null,
        createdAt:           orderRow.created_at,
        updatedAt:           orderRow.updated_at           ?? orderRow.created_at,
      };

      const rawBalesResult = await db.execute(
        sql`SELECT * FROM customer_order_bales WHERE order_id = ${orderId}`,
      );
      const rawBaleRows: any[] = (rawBalesResult as any).rows ?? (rawBalesResult as unknown as any[]);
      const orderBales = rawBaleRows.map((r: any) => ({
        id:             r.id,
        order_id:       r.order_id,
        bale_id:        r.bale_id,
        weight:         String(r.weight         ?? '0'),
        article_code:   String(r.article_code   ?? ''),
        bale_name:      String(r.bale_name      ?? ''),
        price_used:     String(r.price_used     ?? '0'),
        bale_reference: String(r.bale_reference ?? ''),
      }));

      // Diagnostic log so production logs can confirm the actual DB state.
      console.log(
        `[verify-summary] orderId=${orderId} companyId=${companyId}` +
        ` status=${order.status} proformaIdUsed=${order.proformaIdUsed ?? 'null'}` +
        ` customer_order_bales.count=${orderBales.length} total_qty_bales=${order.totalQtyBales}`,
      );

      // ── Fallback: when customer_order_bales is empty but the order has a recorded
      // total (total_qty_bales > 0), reconstruct loadedByArticle from customer_order_lines.
      // customer_order_lines is rebuilt by recalculateOrderTotals every time a bale is
      // scanned, so it is the most reliable per-article aggregate when individual bale
      // rows are unavailable (e.g. after a partial bale-row migration or cleanup).
      let dataSource: "bale_rows" | "order_lines" = "bale_rows";
      let syntheticBalesFromLines: typeof orderBales = [];

      if (orderBales.length === 0 && order.totalQtyBales > 0) {
        const rawLinesResult = await db.execute(
          sql`SELECT * FROM customer_order_lines WHERE order_id = ${orderId}`,
        );
        const linesRows: any[] = (rawLinesResult as any).rows ?? (rawLinesResult as unknown as any[]);
        const hasLines = linesRows.some((r: any) => (r.qty ?? 0) > 0);

        if (hasLines) {
          dataSource = "order_lines";
          console.log(
            `[verify-summary] orderId=${orderId} falling back to order_lines (${linesRows.length} lines, totalQtyBales=${order.totalQtyBales})`,
          );
          // Synthesise bale-like records from lines so the rest of the pipeline works unchanged
          for (const row of linesRows) {
            const qty = Number(row.qty ?? 0);
            if (qty <= 0) continue;
            const articleCode = String(row.article_code ?? row.articleCode ?? 'UNKNOWN');
            const totalWeight = Number(row.total_weight ?? row.totalWeight ?? 0);
            const totalPrice = Number(row.total_price ?? row.totalPrice ?? 0);
            const weightPerBale = qty > 0 ? totalWeight / qty : 0;
            const pricePerBale = qty > 0 ? totalPrice / qty : 0;
            for (let i = 0; i < qty; i++) {
              syntheticBalesFromLines.push({
                id: 0,
                order_id: orderId,
                bale_id: 0,
                weight: String(weightPerBale),
                article_code: articleCode,
                bale_name: String(row.bale_name ?? row.baleName ?? articleCode),
                price_used: String(pricePerBale),
                bale_reference: '',
              });
            }
          }
        }
      }

      const effectiveBales = dataSource === "order_lines" ? syntheticBalesFromLines : orderBales;

      // Build preliminary article code set from loaded bales.
      const loadedByArticle: Record<string, { articleCode: string; productName: string; qty: number; totalWeight: number; totalPrice: number; pricingMode: string; pricePerKg: number }> = {};
      for (const b of effectiveBales) {
        const articleCode = b.article_code;
        const baleName    = b.bale_name;
        const priceUsed   = b.price_used;
        const weight      = b.weight;

        const code = articleCode || "UNKNOWN";
        if (!loadedByArticle[code]) {
          loadedByArticle[code] = { articleCode: code, productName: baleName || code, qty: 0, totalWeight: 0, totalPrice: 0, pricingMode: 'per_bale', pricePerKg: 0 };
        }
        loadedByArticle[code].qty += 1;
        loadedByArticle[code].totalWeight += parseFloat(weight) || 0;
        loadedByArticle[code].totalPrice  += parseFloat(priceUsed) || 0;
      }

      let proformaLines: any[] = [];
      const proformaByArticle: Record<string, { articleCode: string; productName: string; expectedQty: number; pricePerBale: string; pricingMode: string; pricePerKg: number }> = {};

      if (order.proformaIdUsed) {
        // SELECT * to avoid explicit-column failures on production tables that may
        // be missing price_fixed or production_price_per_bale columns.
        const rawProformaResult = await db.execute(
          sql`SELECT * FROM customer_proforma_lines WHERE proforma_id = ${order.proformaIdUsed}`,
        );
        proformaLines = (rawProformaResult as any).rows ?? (rawProformaResult as unknown as any[]);

        for (const pl of proformaLines) {
          const articleCode = pl.article_code ?? pl.articleCode ?? "";
          if (!articleCode) continue;
          const pMode = pl.pricing_mode ?? pl.pricingMode ?? "per_bale";
          const pkgRate = parseFloat(String(pl.price_per_kg ?? pl.pricePerKg ?? "0")) || 0;
          proformaByArticle[articleCode] = {
            articleCode,
            productName:  pl.product_name  ?? pl.productName  ?? articleCode,
            expectedQty:  pl.quantity       ?? 0,
            pricePerBale: pl.price_per_bale ?? pl.pricePerBale ?? "0",
            pricingMode:  pMode,
            pricePerKg:   pkgRate,
          };
          // Propagate pricing mode into loadedByArticle so the frontend can display correctly
          if (loadedByArticle[articleCode]) {
            loadedByArticle[articleCode].pricingMode = pMode;
            loadedByArticle[articleCode].pricePerKg  = pkgRate;
          }
        }
      }

      // Look up authoritative product names from factoryBaleProducts.
      // Some stored names are stale or were saved as the article code itself —
      // use the catalogue name when available.
      const allCodes = [...new Set([
        ...Object.keys(loadedByArticle),
        ...Object.keys(proformaByArticle),
      ])].filter(c => c !== "UNKNOWN");

      const productNameMap: Record<string, string> = {};
      if (allCodes.length > 0) {
        const rows = await db
          .select({ articleCode: factoryBaleProducts.articleCode, name: factoryBaleProducts.name })
          .from(factoryBaleProducts)
          .where(and(
            eq(factoryBaleProducts.companyId, companyId),
            inArray(factoryBaleProducts.articleCode, allCodes),
          ));
        for (const r of rows) {
          if (r.articleCode && r.name) productNameMap[r.articleCode] = r.name;
        }
      }

      // Apply authoritative names — prefer catalogue name, fall back to stored name, last resort = code
      const resolveName = (code: string, storedName: string) =>
        productNameMap[code] || (storedName !== code ? storedName : null) || code;

      for (const [code, entry] of Object.entries(loadedByArticle)) {
        entry.productName = resolveName(code, entry.productName);
      }
      for (const [code, entry] of Object.entries(proformaByArticle)) {
        entry.productName = resolveName(code, entry.productName);
      }

      // Fetch IN_STOCK bale counts per article code for the relevant codes,
      // filtered by the order's locationId so the number matches what the
      // Location Inventory page shows for that location.
      const stockQtyMap: Record<string, number> = {};
      if (allCodes.length > 0) {
        const codesList = sql.join(allCodes.map((c: string) => sql`${c}`), sql`,`);
        const locationFilter = order.locationId
          ? sql`AND fb.erp_location_id = ${order.locationId}`
          : sql``;
        const inStockRaw = await db.execute(
          sql`SELECT fb.article_code AS "articleCode", SUM(COALESCE(fb.quantity, 1))::int AS count
              FROM factory_bales fb
              WHERE fb.company_id = ${companyId}
                AND fb.status = 'IN_STOCK'
                AND fb.deleted_at IS NULL
                AND fb.article_code IN (${codesList})
                ${locationFilter}
              GROUP BY fb.article_code`,
        );
        const inStockRows = (inStockRaw as any).rows ?? (inStockRaw as unknown as any[]);
        for (const r of inStockRows) {
          if (r.articleCode) stockQtyMap[r.articleCode] = Number(r.count);
        }

        // Subtract bales already scanned into any active LOADING order
        // (V5 bales stay IN_STOCK during loading, so we must deduct them manually)
        const loadingRaw = await db.execute(
          sql`SELECT fb.article_code AS "articleCode", SUM(COALESCE(fb.quantity, 1))::int AS count
              FROM factory_bales fb
              JOIN customer_order_bales cob ON cob.bale_id = fb.id
              JOIN customer_orders co ON co.id = cob.order_id
              WHERE fb.company_id = ${companyId}
                AND fb.status = 'IN_STOCK'
                AND fb.deleted_at IS NULL
                AND fb.article_code IN (${codesList})
                AND co.status = 'LOADING'
                ${locationFilter}
              GROUP BY fb.article_code`,
        );
        const loadingRows = (loadingRaw as any).rows ?? (loadingRaw as unknown as any[]);
        for (const r of loadingRows) {
          if (r.articleCode && stockQtyMap[r.articleCode] !== undefined) {
            stockQtyMap[r.articleCode] = Math.max(0, stockQtyMap[r.articleCode] - Number(r.count));
          }
        }
      }

      const allArticles = new Set([...Object.keys(loadedByArticle), ...Object.keys(proformaByArticle)]);
      const comparison: any[] = [];

      for (const code of allArticles) {
        const loaded = loadedByArticle[code] || null;
        const proforma = proformaByArticle[code] || null;
        const loadedQty = loaded?.qty || 0;
        const expectedQty = proforma?.expectedQty || 0;

        let status: string;
        if (!proforma && loadedQty > 0) {
          status = "LOADED_NOT_IN_PROFORMA";
        } else if (proforma && loadedQty === 0) {
          status = "MISSING_FROM_LOADED";
        } else if (expectedQty > 0 && loadedQty < expectedQty) {
          status = "UNDER_LOADED";
        } else if (expectedQty > 0 && loadedQty > expectedQty) {
          status = "OVER_LOADED";
        } else {
          status = "MATCH";
        }

        comparison.push({
          articleCode: code,
          productName: loaded?.productName || proforma?.productName || code,
          loadedQty,
          expectedQty,
          diff: loadedQty - expectedQty,
          totalWeight: loaded?.totalWeight || 0,
          totalPrice: loaded?.totalPrice || 0,
          pricePerBale: proforma?.pricePerBale || "0",
          inProforma: !!proforma,
          status,
        });
      }

      const proformaLinesWithStock = Object.values(proformaByArticle).map((pl) => ({
        ...pl,
        stockQty: stockQtyMap[pl.articleCode] ?? 0,
      }));

      const loadedItemsWithStock = Object.values(loadedByArticle).map((li) => ({
        ...li,
        stockQty: stockQtyMap[li.articleCode] ?? 0,
      }));

      res.json({
        order,
        loadedItems: loadedItemsWithStock,
        proformaLines: proformaLinesWithStock,
        comparison,
        totalLoadedBales: effectiveBales.length,
        totalLoadedWeight: Object.values(loadedByArticle).reduce((s, g) => s + g.totalWeight, 0),
        dataSource,
      });
    } catch (error: any) {
      console.error("Error fetching verification summary:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Admin: recover missing customer_order_bales rows from factory_bales ──────
  // This endpoint reconstructs the customer_order_bales link table for orders
  // where bale scans were attempted but the inserts failed (e.g. because the
  // newer columns didn't yet exist in the production DB). It finds factory_bales
  // that are currently SOLD or RESERVED_FOR_ORDER and are NOT already linked to
  // any active customer_order_bales row, then lets an admin link them to this
  // order by providing a list of bale reference numbers.
  // Only Admin / Owner / Developer roles may call this.
  // SQL diagnostic to check state before calling:
  //   SELECT fb.id, fb.reference_number, fb.article_code, fb.status, fb.weight_kg
  //     FROM factory_bales fb
  //    WHERE fb.company_id = <companyId>
  //      AND fb.status IN ('SOLD', 'RESERVED_FOR_ORDER')
  //      AND NOT EXISTS (
  //            SELECT 1 FROM customer_order_bales cob WHERE cob.bale_id = fb.id
  //          )
  //    ORDER BY fb.updated_at DESC;
  app.post("/api/factory/customer-orders/:id/recover-bales", requireAuth, async (req: any, res: any) => {
    try {
      const session = req.session as any;
      const companyId = session.factoryCompanyId || session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const role = (session.currentRole || session.role || "").toLowerCase();
      if (!["admin", "owner", "developer"].includes(role)) {
        return res.status(403).json({ message: "Only Admin / Owner can recover bales" });
      }

      const orderId = parseId(req.params.id);
      if (orderId === null) return res.status(400).json({ message: "Invalid order id" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      // Allow recovery for any active (non-CANCELLED) order that has 0 linked bales
      if (!["LOADING", "PENDING_VERIFICATION", "VERIFIED", "FINALIZED"].includes(order.status)) {
        return res.status(400).json({ message: "Recovery is only available for LOADING, PENDING_VERIFICATION, VERIFIED, or FINALIZED orders" });
      }

      const existingBaleCount = await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM customer_order_bales WHERE order_id = ${orderId}`,
      );
      const existingCount = Number(((existingBaleCount as any).rows ?? [{ count: 0 }])[0]?.count ?? 0);
      if (existingCount > 0) {
        return res.status(400).json({
          message: `Order already has ${existingCount} bale(s) linked. Recovery is only for orders with 0 linked bales.`,
        });
      }

      const { baleReferences }: { baleReferences: string[] } = req.body;
      if (!Array.isArray(baleReferences) || baleReferences.length === 0) {
        return res.status(400).json({ message: "baleReferences array is required and must not be empty" });
      }

      // Look up proforma prices once
      const proformaPriceMap: Record<string, string> = {};
      if (order.proformaIdUsed) {
        const pfLines = await db.select().from(customerProformaLines)
          .where(eq(customerProformaLines.proformaId, order.proformaIdUsed));
        for (const pl of pfLines) {
          proformaPriceMap[pl.articleCode] = pl.pricePerBale;
        }
      }

      let linked = 0;
      const notFound: string[] = [];

      for (const ref of baleReferences) {
        const refClean = ref.trim();
        if (!refClean) continue;

        // Find the bale — accept SOLD, RESERVED_FOR_ORDER, or even IN_STOCK (admin override)
        const [bale] = await db.select().from(factoryBales)
          .where(and(
            eq(factoryBales.companyId, companyId),
            or(
              sql`LOWER(${factoryBales.referenceNumber}) = ${refClean.toLowerCase()}`,
              sql`LOWER(${factoryBales.baleCode}) = ${refClean.toLowerCase()}`,
            ),
          ))
          .orderBy(factoryBales.id)
          .limit(1);

        if (!bale) { notFound.push(refClean); continue; }

        // Skip if already in ANY customer_order_bales row
        const [dup] = await db.select({ id: customerOrderBales.id })
          .from(customerOrderBales)
          .where(eq(customerOrderBales.baleId, bale.id));
        if (dup) { notFound.push(`${refClean} (already linked to order)`); continue; }

        const priceUsed = proformaPriceMap[bale.articleCode || ""] || bale.costPerKg || "0";

        // Get or infer location
        const locationId = bale.erpLocationId ?? null;

        await db.insert(customerOrderBales).values({
          orderId,
          baleId: bale.id,
          baleReference: bale.referenceNumber,
          locationId: locationId ?? 1,
          weight: bale.weightKg,
          articleCode: bale.articleCode,
          baleName: bale.productName || bale.articleCode || bale.baleCode,
          priceUsed,
        });

        // Ensure bale status reflects the order stage
        const targetStatus = ["VERIFIED", "FINALIZED"].includes(order.status) ? "SOLD" : "SOLD";
        if (bale.status !== targetStatus) {
          await db.update(factoryBales)
            .set({ status: targetStatus, updatedAt: new Date() })
            .where(eq(factoryBales.id, bale.id));
        }

        linked++;
      }

      await recalculateOrderTotals(db, orderId);

      console.log(`[recover-bales] orderId=${orderId} linked=${linked} notFound=${notFound.length}`);

      res.json({
        message: `${linked} bale(s) linked successfully`,
        linked,
        notFound,
      });
    } catch (error: any) {
      console.error("Error recovering bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Auto-recover bales from stock by article code ────────────────────────────
  // Finds factory_bales that match the proforma article codes for this order,
  // are IN_STOCK or SOLD, not already linked to any other active order,
  // and auto-links up to the proforma quantity of each article.
  // Requires Admin / Owner. Order must have a proformaIdUsed and 0 existing bales.
  app.post("/api/factory/customer-orders/:id/auto-recover-bales", requireAuth, async (req: any, res: any) => {
    try {
      const session = req.session as any;
      const companyId = session.factoryCompanyId || session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const role = (session.currentRole || session.role || "").toLowerCase();
      if (!["admin", "owner", "developer"].includes(role)) {
        return res.status(403).json({ message: "Only Admin / Owner can auto-recover bales" });
      }

      const orderId = parseId(req.params.id);
      if (orderId === null) return res.status(400).json({ message: "Invalid order id" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      if (!order.proformaIdUsed) {
        return res.status(400).json({ message: "Auto-recover requires a proforma to be linked on this order" });
      }

      const existingResult = await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM customer_order_bales WHERE order_id = ${orderId}`,
      );
      const existingCount = Number(((existingResult as any).rows ?? [{ count: 0 }])[0]?.count ?? 0);
      if (existingCount > 0) {
        return res.status(400).json({
          message: `Order already has ${existingCount} bale(s) linked. Use manual Recover Bales for partial recovery.`,
        });
      }

      const proformaLines = await db.select().from(customerProformaLines)
        .where(eq(customerProformaLines.proformaId, order.proformaIdUsed));
      if (proformaLines.length === 0) {
        return res.status(400).json({ message: "No proforma lines found for this order's proforma" });
      }

      // Build set of bale IDs already claimed by other active orders (for this company)
      const claimedResult = await db.execute(
        sql`SELECT cob.bale_id FROM customer_order_bales cob
            JOIN customer_orders co ON co.id = cob.order_id
            WHERE co.company_id = ${companyId}
              AND co.status != 'CANCELLED'
              AND cob.order_id != ${orderId}`,
      );
      const claimedIds = new Set<number>(
        ((claimedResult as any).rows ?? []).map((r: any) => Number(r.bale_id))
      );

      const scannerName: string | null = session.username || session.name || session.email || null;
      let totalLinked = 0;
      const summary: { articleCode: string; linked: number; needed: number }[] = [];

      for (const pl of proformaLines) {
        const articleCode = pl.articleCode;
        const needed = pl.quantity || 0;
        if (!articleCode || needed <= 0) continue;

        const candidatesResult = await db.execute(
          sql`SELECT id, reference_number, weight_kg, erp_location_id, product_name, article_code, bale_code
              FROM factory_bales
              WHERE company_id = ${companyId}
                AND article_code = ${articleCode}
                AND status IN ('IN_STOCK', 'SOLD', 'RESERVED_FOR_ORDER')
                AND deleted_at IS NULL
              ORDER BY id
              LIMIT ${needed * 3}`,
        );
        const candidates: any[] = (candidatesResult as any).rows ?? (candidatesResult as unknown as any[]);
        const available = candidates.filter((b: any) => !claimedIds.has(Number(b.id))).slice(0, needed);

        for (const bale of available) {
          await db.insert(customerOrderBales).values({
            orderId,
            baleId: Number(bale.id),
            baleReference: bale.reference_number,
            locationId: bale.erp_location_id ?? 1,
            weight: bale.weight_kg,
            articleCode,
            baleName: bale.product_name || articleCode,
            priceUsed: pl.pricePerBale,
            scannedBy: scannerName,
          });
          claimedIds.add(Number(bale.id));
          totalLinked++;
        }

        summary.push({ articleCode, linked: available.length, needed });
      }

      await recalculateOrderTotals(db, orderId);

      console.log(`[auto-recover-bales] orderId=${orderId} totalLinked=${totalLinked}`);
      res.json({ message: `${totalLinked} bale(s) auto-linked from stock`, linked: totalLinked, summary });
    } catch (error: any) {
      console.error("Error auto-recovering bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/verify", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { approved, notes } = req.body;

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "PENDING_VERIFICATION") return res.status(400).json({ message: "Only PENDING_VERIFICATION orders can be verified" });

      if (approved) {
        const [updated] = await db.update(customerOrders).set({
          status: "VERIFIED",
          verifiedAt: new Date(),
          containerNotes: notes || order.containerNotes,
          updatedAt: new Date(),
        }).where(eq(customerOrders.id, orderId)).returning();
        const [verifyCustomer] = await db.select({ legalName: customers.legalName }).from(customers).where(eq(customers.id, order.customerId));
        // Use grandTotal (bales + all charges including surcharges), not just bale sum
        const verifyTotalValue = parseFloat(updated?.grandTotal || order.grandTotal || "0");
        const verifyToday = getClientDate(req);
        await db.delete(factoryDaybookEntries).where(and(
          eq(factoryDaybookEntries.companyId, companyId),
          eq(factoryDaybookEntries.txType, "ORDER_VERIFIED"),
          eq(factoryDaybookEntries.referenceId, orderId)
        ));
        await writeDaybookEntry(db, {
          companyId,
          txDate: verifyToday,
          txType: "ORDER_VERIFIED",
          referenceId: orderId,
          description: `Order verified for customer: ${verifyCustomer?.legalName || "Customer"}${notes ? ` – ${notes}` : ""}`,
          amountCurrency: verifyTotalValue,
          amountUsd: verifyTotalValue,
        });
        res.json(updated);

        // Fire-and-forget: send the Commercial Invoice Excel file to the location's
        // WhatsApp group chat. Runs after the response so it never blocks the API.
        setImmediate(async () => {
          try {
            if (!order.locationId) return;
            const [loc] = await db
              .select({ whatsappGroupChatId: locations.whatsappGroupChatId })
              .from(locations)
              .where(eq(locations.id, order.locationId));
            if (!loc?.whatsappGroupChatId) return;

            const { buffer, fileName } = await buildOrderExcelBuffer(orderId, companyId, false);

            const captionParts: string[] = [
              `*Container Verified* ✓`,
              ``,
              `Order #${orderId}`,
              order.containerNumber ? `Container: ${order.containerNumber}` : null,
              `Customer: ${verifyCustomer?.legalName || "—"}`,
              `Bales loaded: ${verifyBales.length}`,
              order.destination ? `Destination: ${order.destination}` : null,
              `Date: ${verifyToday}`,
              notes ? `Notes: ${notes}` : null,
            ].filter(Boolean) as string[];

            await sendWhatsAppFileToChatIdPos(
              loc.whatsappGroupChatId,
              buffer,
              fileName,
              captionParts.join("\n"),
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            );
            console.log(`[verify-whatsapp] Sent Excel invoice ${fileName} to ${loc.whatsappGroupChatId} for order #${orderId}`);
          } catch (e: any) {
            console.error("[verify-whatsapp] Failed to send Excel to WhatsApp:", e.message);
          }
        });
      } else {
        const [updated] = await db.update(customerOrders).set({
          containerNotes: notes || order.containerNotes,
          updatedAt: new Date(),
        }).where(eq(customerOrders.id, orderId)).returning();
        res.json(updated);
      }
    } catch (error: any) {
      console.error("Error verifying order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/return-to-loading", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["PENDING_VERIFICATION", "VERIFIED"].includes(order.status)) return res.status(400).json({ message: "Only PENDING_VERIFICATION or VERIFIED orders can be returned to loading" });

      const [updated] = await db.update(customerOrders).set({
        status: "LOADING",
        loadingFinalizedAt: null,
        verifiedAt: null,
        updatedAt: new Date(),
      }).where(eq(customerOrders.id, orderId)).returning();

      // If the order was already VERIFIED, reverse the verification daybook entry.
      if (order.status === "VERIFIED") {
        await db.delete(factoryDaybookEntries).where(and(
          eq(factoryDaybookEntries.companyId, companyId),
          eq(factoryDaybookEntries.txType, "ORDER_VERIFIED"),
          eq(factoryDaybookEntries.referenceId, orderId)
        ));
      }

      // V5 orders: revert bales from SOLD → RESERVED_FOR_ORDER so they can be re-scanned or edited.
      // Legacy (non-V5) orders keep bales in RESERVED_FOR_ORDER throughout, so no change needed.
      if (order.proformaIdUsed) {
        const bales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        for (const b of bales) {
          await db.update(factoryBales)
            .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
            .where(and(eq(factoryBales.id, b.baleId), eq(factoryBales.status, "SOLD")));
        }
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error returning order to loading:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ── Update order date (DRAFT only) ────────────────────────────────────────
}
