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
  writeDaybookEntry,
  getOrFetchFxRateToUsd,
  getOrCreateLedgerAccount,
  isLegacySHA256Hash,
  verifySupervisorPassword,
  recalculateOrderTotals,
} from "../_helpers";
import { logAudit } from "../../helpers/auditHelpers";
import {
  factorySuppliers,
  factoryCategories,
  factoryBaleProducts,
  factoryContainers,
  factoryRawStock,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryDailyUsages,
  factoryPressingBatches,
  factoryBales,
  factoryBaleSequences,
  factoryContainerCommissions,
  baleLabelPrints,
  stockItems,
  stockGroups,
  users,
  insertFactorySupplierSchema,
  insertFactoryCategorySchema,
  insertFactoryBaleProductSchema,
  insertFactoryContainerSchema,
  insertFactoryRawStockSchema,
  insertFactoryMixBatchSchema,
  insertFactoryMixBatchSourceSchema,
  insertFactoryPressingBatchSchema,
  insertFactoryBaleSchema,
  customerProformas,
  customerProformaLines,
  customerOrders,
  customerOrderLines,
  customerOrderBales,
  customerOrderCharges,
  customerInvoiceSequences,
  customerBalances,
  customers,
  insertCustomerSchema,
  ledgerAccounts,
  voucherEntries,
  companies,
  locations,
  userCompanyRoles,
  insertCustomerProformaSchema,
  insertCustomerProformaLineSchema,
  insertCustomerOrderSchema,
  factoryFxRates,
  insertFactoryFxRateSchema,
  factoryDaybookEntries,
  containerDocumentTypes,
  containerDocuments,
  containerFreight,
  containerFreightPayments,
  factoryDaybookEntryEdits,
  containers,
  factoryUserProfiles,
  factoryUserPageAccess,
  insertUserSchema,
  directMessages,
  insertDirectMessageSchema,
  userPresence,
  factoryDutyAuditLog,
  factoryOffloadAdditionalCharges,
  factoryContainerOtherCharges,
  companySettings,
  factorySettings,
  factoryWorkers,
  factoryWorkerCategories,
  insertFactoryWorkerCategorySchema,
  factoryRawMaterialAdjustments,
  factoryPayrolls,
  factoryWorkerDocuments,
  factoryAlerts,
  employees,
  factoryWasteEntries,
  factoryBalePhotos,
  factoryDailyKpiSnapshots,
  factorySupplierScoreSnapshots,
  factoryBaleCostSnapshots,
  factoryContainerProfitSnapshots,
  bankAccounts,
  inventory,
  exchangeRates,
  vouchers,
  suppliers,
  containerSales,
  factorySupplierPayments,
  insertFactorySupplierPaymentSchema,
  factorySupplierFxTransfers,
  insertFactorySupplierFxTransferSchema,
  factoryFxAllocations,
  baleRecodeSessions,
  baleRecodeItems,
  factoryWorkerAdvances,
  factoryAdvanceRepayments,
  factoryBaleWasteDispatches,
  factoryPosSales,
  factoryPosSaleItems,
  proformaStockReservations,
  customerOrderBaleRemovals,
  customerOrderExpectedLines,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

import { buildOrderExcelBuffer } from "./orderHelpers";

export function registerOrderFinalizeLoadingRoutes(app: Express) {
  app.post("/api/factory/customer-orders/:id/finalize", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });

      const result = await db.transaction(async (tx: any) => {
        const [order] = await tx
          .select()
          .from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
        if (!order) throw new Error("Order not found");
        if (!["DRAFT", "VERIFIED"].includes(order.status))
          throw new Error("Only DRAFT or VERIFIED orders can be finalized");

        const bales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        if (bales.length === 0) throw new Error("Order has no bales");

        for (const b of bales) {
          // Just verify the bale still exists — status is not checked here.
          const [factoryBale] = await tx.select().from(factoryBales).where(eq(factoryBales.id, b.baleId));
          if (!factoryBale || factoryBale.status === "DELETED") {
            throw new Error(`Bale ${b.baleReference} is no longer available`);
          }
        }

        const seqRows = await tx.execute(
          sql`SELECT * FROM customer_invoice_sequences WHERE company_id = ${companyId} FOR UPDATE`
        );
        let seqRow = seqRows.rows?.[0] || seqRows[0];
        if (!seqRow) {
          [seqRow] = await tx.insert(customerInvoiceSequences).values({ companyId, nextNumber: 1 }).returning();
        }
        const invoiceNum = seqRow.nextNumber || seqRow.next_number;
        await tx
          .update(customerInvoiceSequences)
          .set({ nextNumber: invoiceNum + 1 })
          .where(eq(customerInvoiceSequences.companyId, companyId));
        const invoiceNumber = `INV-${String(invoiceNum).padStart(6, "0")}`;

        for (const b of bales) {
          await tx
            .update(factoryBales)
            .set({ status: "SOLD", updatedAt: new Date() })
            .where(eq(factoryBales.id, b.baleId));
        }

        await recalculateOrderTotals(tx, orderId);

        const [recalcOrder] = await tx.select().from(customerOrders).where(eq(customerOrders.id, orderId));

        const finalizedAt = new Date();

        await tx
          .update(customerOrders)
          .set({
            invoiceNumber,
            status: "FINALIZED",
            finalizedAt,
            updatedAt: finalizedAt,
          })
          .where(eq(customerOrders.id, orderId));

        const grandTotal = parseFloat(recalcOrder.grandTotal || "0");
        // Use the client's current date (finalization date) as the statement date,
        // not the orderDate (which is the loading/shipment date).
        const today = getClientDate(req);

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
        const chargesForJournal = await tx
          .select()
          .from(customerOrderCharges)
          .where(
            and(eq(customerOrderCharges.orderId, orderId), sql`${customerOrderCharges.ledgerAccountId} IS NOT NULL`)
          );

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
              const [preVoucher] = await tx
                .select({ id: vouchers.id })
                .from(vouchers)
                .where(and(eq(vouchers.companyId, companyId), eq(vouchers.voucherNumber, preVoucherNumber)));

              if (preVoucher) {
                // Rename the PRE-voucher — same entries already exist, just update the reference
                await tx
                  .update(vouchers)
                  .set({ voucherNumber: invoiceVoucherNumber, voucherDate: today, description: chargeDesc })
                  .where(eq(vouchers.id, preVoucher.id));
                await tx
                  .update(voucherEntries)
                  .set({ narration: chargeDesc })
                  .where(eq(voucherEntries.voucherId, preVoucher.id));
                // Phase 6: ensure the charge.voucherId FK points at the renamed voucher
                // (it should already, from the PRE-create stamp, but stay defensive for legacy data)
                await tx
                  .update(customerOrderCharges)
                  .set({ voucherId: preVoucher.id })
                  .where(eq(customerOrderCharges.id, charge.id));
              } else {
                // No PRE-voucher — charge was added before this feature or on a DRAFT order
                const [chargeVoucher] = await tx
                  .insert(vouchers)
                  .values({
                    companyId,
                    voucherType: "Journal",
                    voucherNumber: invoiceVoucherNumber,
                    voucherDate: today,
                    description: chargeDesc,
                    totalAmount: String(chargeAmount),
                    sourceModule: "FACTORY",
                  })
                  .returning();
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
                await tx
                  .update(customerOrderCharges)
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
        const finalCharges = await tx
          .select()
          .from(customerOrderCharges)
          .where(eq(customerOrderCharges.orderId, orderId));

        return { ...finalOrder, lines: finalLines, bales: finalBales, charges: finalCharges };
      });

      const today = req.body.txDate || req.body.invoiceDate || getClientDate(req);
      const invoiceRefId = result.orderId || orderId;
      // Remove any previous INVOICE and INVOICE_REVERTED rows so only this approval shows
      await db
        .delete(factoryDaybookEntries)
        .where(
          and(
            eq(factoryDaybookEntries.companyId, companyId),
            sql`${factoryDaybookEntries.txType} IN ('INVOICE','INVOICE_REVERTED')`,
            eq(factoryDaybookEntries.referenceId, invoiceRefId)
          )
        );
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
      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.json({ baleCount: 0, bales: [] });

      const baleIds = orderBales.map((b: any) => b.baleId);
      const baleRows = await db
        .select({
          id: factoryBales.id,
          referenceNumber: factoryBales.referenceNumber,
          productName: factoryBales.productName,
          weightKg: factoryBales.weightKg,
          status: factoryBales.status,
          erpLocationId: factoryBales.erpLocationId,
        })
        .from(factoryBales)
        .where(inArray(factoryBales.id, baleIds));

      const locIds = [...new Set(baleRows.map((b: any) => b.erpLocationId).filter(Boolean))];
      const locationRecords =
        locIds.length > 0
          ? await db
              .select()
              .from(locations)
              .where(inArray(locations.id, locIds as number[]))
          : [];
      const locationMap = new Map(locationRecords.map((l: any) => [l.id, l.name]));

      const availableBales = baleRows.filter((b: any) => ["IN_STOCK", "RESERVED_FOR_ORDER"].includes(b.status));

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
      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["VERIFIED", "FINALIZED"].includes(order.status)) {
        return res.status(400).json({ message: "Order must be VERIFIED or FINALIZED to force-sync bale statuses" });
      }
      if (!order.invoiceNumber) {
        return res
          .status(400)
          .json({ message: "Order must have an invoice number (previously finalized) to use force-sync" });
      }

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.status(400).json({ message: "Order has no bales" });

      let updated = 0;
      for (const b of orderBales) {
        const [existing] = await db
          .select({ status: factoryBales.status })
          .from(factoryBales)
          .where(eq(factoryBales.id, b.baleId));
        if (existing && existing.status !== "SOLD") {
          await db
            .update(factoryBales)
            .set({ status: "SOLD", updatedAt: new Date() })
            .where(eq(factoryBales.id, b.baleId));
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
        const [order] = await tx
          .select()
          .from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
        if (!order) throw new Error("Order not found");
        if (order.status !== "FINALIZED") throw new Error("Only FINALIZED orders can be reverted to Draft");

        // Block if any payment has been recorded against this invoice
        const payments = await tx
          .select({ id: customerBalances.id })
          .from(customerBalances)
          .where(
            and(
              eq(customerBalances.companyId, companyId),
              eq(customerBalances.referenceId, orderId),
              eq(customerBalances.referenceType, "INVOICE"),
              eq(customerBalances.transactionType, "PAYMENT")
            )
          );
        if (payments.length > 0) {
          throw new Error("Cannot revert: this invoice has payments recorded against it. Reverse the payments first.");
        }

        // Delete the SALE balance entry for this invoice
        await tx
          .delete(customerBalances)
          .where(
            and(
              eq(customerBalances.companyId, companyId),
              eq(customerBalances.referenceId, orderId),
              eq(customerBalances.referenceType, "INVOICE"),
              eq(customerBalances.transactionType, "SALE")
            )
          );

        // Phase 6: delete charge journal vouchers via FK linkage; fall back to invoice-number
        // pattern for legacy unbacked rows. After delete, clear the FK on the charge rows so
        // they can be re-finalized later without dangling references.
        const linkedChargeRows = await tx
          .select({ id: customerOrderCharges.id, voucherId: customerOrderCharges.voucherId })
          .from(customerOrderCharges)
          .where(and(eq(customerOrderCharges.orderId, orderId), sql`${customerOrderCharges.voucherId} IS NOT NULL`));
        const linkedVoucherIds = linkedChargeRows.map((r: any) => r.voucherId).filter(Boolean);

        if (linkedVoucherIds.length > 0) {
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, linkedVoucherIds));
          await tx.update(vouchers).set({ deletedAt: new Date() }).where(inArray(vouchers.id, linkedVoucherIds));
          await tx
            .update(customerOrderCharges)
            .set({ voucherId: null })
            .where(and(eq(customerOrderCharges.orderId, orderId), sql`${customerOrderCharges.voucherId} IS NOT NULL`));
        }

        // Legacy fallback for charge vouchers that were never FK-linked
        if (order.invoiceNumber) {
          const legacyChargeVouchers = await tx
            .select({ id: vouchers.id })
            .from(vouchers)
            .where(
              and(
                eq(vouchers.companyId, companyId),
                eq(vouchers.sourceModule, "FACTORY"),
                sql`${vouchers.voucherNumber} LIKE ${"CHARGE-" + order.invoiceNumber + "-%"}`
              )
            );
          for (const cv of legacyChargeVouchers) {
            await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, cv.id));
            await tx.update(vouchers).set({ deletedAt: new Date() }).where(eq(vouchers.id, cv.id));
          }
        }

        // Revert bales from SOLD → RESERVED_FOR_ORDER (order still exists, just un-finalized)
        const bales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        for (const b of bales) {
          await tx
            .update(factoryBales)
            .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
            .where(and(eq(factoryBales.id, b.baleId), eq(factoryBales.status, "SOLD")));
        }

        // Reset order to VERIFIED (skip Pending step), clear invoice number
        await tx
          .update(customerOrders)
          .set({
            status: "VERIFIED",
            invoiceNumber: null,
            updatedAt: new Date(),
          })
          .where(eq(customerOrders.id, orderId));

        // Daybook entry
        const [unfCustomer] = await tx
          .select({ legalName: customers.legalName })
          .from(customers)
          .where(eq(customers.id, order.customerId));
        const unfToday = req.body.txDate || getClientDate(req);
        // Remove any previous INVOICE and INVOICE_REVERTED rows so only this revert shows
        await tx
          .delete(factoryDaybookEntries)
          .where(
            and(
              eq(factoryDaybookEntries.companyId, companyId),
              sql`${factoryDaybookEntries.txType} IN ('INVOICE','INVOICE_REVERTED')`,
              eq(factoryDaybookEntries.referenceId, orderId)
            )
          );
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
      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      // ── V5 guard: proformaIdUsed IS NOT NULL ────────────────────────────────
      // V5 containers have their own cancellation rules separate from legacy orders.
      if (order.proformaIdUsed) {
        // PENDING_VERIFICATION / VERIFIED / FINALIZED — hard block, no reversal yet
        if (["PENDING_VERIFICATION", "VERIFIED", "FINALIZED"].includes(order.status)) {
          return res.status(400).json({
            message:
              "V5 containers at or beyond PENDING_VERIFICATION cannot be cancelled. Contact admin for a reversal workflow.",
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
                  WHERE order_id = ${orderId}`
            );
          }

          for (const ob of orderBales) {
            await db
              .update(factoryBales)
              .set({ status: "IN_STOCK", updatedAt: new Date() })
              .where(eq(factoryBales.id, ob.baleId));
          }
          await db.delete(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));

          // Reset order totals to zero now that all bale links are gone.
          // Without this call total_qty_bales would stay stale if the order is later restored.
          await recalculateOrderTotals(db, orderId);

          const [updated] = await db
            .update(customerOrders)
            .set({ status: "CANCELLED", updatedAt: new Date() })
            .where(eq(customerOrders.id, orderId))
            .returning();

          const [cancelCustomer] = await db
            .select({ legalName: customers.legalName })
            .from(customers)
            .where(eq(customers.id, order.customerId));
          const cancelToday = req.body.txDate || getClientDate(req);
          await db
            .delete(factoryDaybookEntries)
            .where(
              and(
                eq(factoryDaybookEntries.companyId, companyId),
                eq(factoryDaybookEntries.txType, "ORDER_CANCELLED"),
                eq(factoryDaybookEntries.referenceId, orderId)
              )
            );
          const cancelledBy = (req.session as any)?.username || "user";
          await writeDaybookEntry(db, {
            companyId,
            txDate: cancelToday,
            txType: "ORDER_CANCELLED",
            referenceId: orderId,
            description: `V5 container cancelled: ${cancelCustomer?.legalName || "Customer"}, ${orderBales.length} bale link${orderBales.length !== 1 ? "s" : ""} removed. Cancelled by: ${cancelledBy}.`,
          });
          try {
            await logAudit({
              userId: req.session.userId!,
              username: (req.session as any).username || req.session.userId!,
              companyId,
              action: "update",
              tableName: "factory_customer_orders",
              recordId: orderId,
              recordIdentifier: (order as any).orderNumber || `Order #${orderId}`,
              changes: { status: { old: order.status, new: "CANCELLED" } },
            });
          } catch (auditErr) {
            console.error("[order cancel V5 audit] non-fatal:", auditErr);
          }
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
        await db
          .update(factoryBales)
          .set({ status: "IN_STOCK", updatedAt: new Date() })
          .where(eq(factoryBales.id, ob.baleId));
      }

      const [updated] = await db
        .update(customerOrders)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(eq(customerOrders.id, orderId))
        .returning();

      const [cancelCustomer] = await db
        .select({ legalName: customers.legalName })
        .from(customers)
        .where(eq(customers.id, order.customerId));
      const cancelToday = req.body.txDate || getClientDate(req);
      await db
        .delete(factoryDaybookEntries)
        .where(
          and(
            eq(factoryDaybookEntries.companyId, companyId),
            eq(factoryDaybookEntries.txType, "ORDER_CANCELLED"),
            eq(factoryDaybookEntries.referenceId, orderId)
          )
        );
      await writeDaybookEntry(db, {
        companyId,
        txDate: cancelToday,
        txType: "ORDER_CANCELLED",
        referenceId: orderId,
        description: `Order cancelled: ${cancelCustomer?.legalName || "Customer"}, ${orderBales.length} bale${orderBales.length !== 1 ? "s" : ""} released`,
      });

      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || req.session.userId!,
          companyId,
          action: "update",
          tableName: "factory_customer_orders",
          recordId: orderId,
          recordIdentifier: (order as any).orderNumber || `Order #${orderId}`,
          changes: { status: { old: order.status, new: "CANCELLED" } },
        });
      } catch (auditErr) {
        console.error("[order cancel audit] non-fatal:", auditErr);
      }

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
      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "CANCELLED")
        return res.status(400).json({ message: "Only CANCELLED orders can be restored" });
      if (!order.loadingStartedAt) return res.status(400).json({ message: "This order was not a loading order" });

      // Restore bales that belong to this order back to RESERVED_FOR_ORDER.
      // V5 guard: proformaIdUsed IS NOT NULL
      // V5 bales remain IN_STOCK during loading — skip RESERVED_FOR_ORDER restore for V5 orders.
      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (!order.proformaIdUsed) {
        for (const ob of orderBales) {
          await db
            .update(factoryBales)
            .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
            .where(and(eq(factoryBales.id, ob.baleId), eq(factoryBales.status, "IN_STOCK")));
        }
      }

      const [restored] = await db
        .update(customerOrders)
        .set({ status: "LOADING", updatedAt: new Date() })
        .where(eq(customerOrders.id, orderId))
        .returning();

      // Remove the ORDER_CANCELLED daybook entry
      await db
        .delete(factoryDaybookEntries)
        .where(
          and(
            eq(factoryDaybookEntries.companyId, companyId),
            eq(factoryDaybookEntries.txType, "ORDER_CANCELLED"),
            eq(factoryDaybookEntries.referenceId, orderId)
          )
        );

      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || req.session.userId!,
          companyId,
          action: "update",
          tableName: "factory_customer_orders",
          recordId: orderId,
          recordIdentifier: (order as any).orderNumber || `Order #${orderId}`,
          changes: { status: { old: "CANCELLED", new: "LOADING" } },
        });
      } catch (auditErr) {
        console.error("[order restore-loading audit] non-fatal:", auditErr);
      }

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

      const [order] = await db
        .insert(customerOrders)
        .values({
          companyId,
          customerId: parseInt(customerId),
          proformaIdUsed: proformaIdUsed ? parseInt(proformaIdUsed) : null,
          locationId: parseInt(locationId),
          orderDate: orderDate || getClientDate(req),
          status: "LOADING",
          loadingStartedAt: new Date(),
          containerNotes: containerNotes || null,
        })
        .returning();

      const [loadingCustomer] = await db
        .select({ legalName: customers.legalName })
        .from(customers)
        .where(eq(customers.id, parseInt(customerId)));
      const loadingToday = orderDate || getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: loadingToday,
        txType: "LOADING_CREATED",
        referenceId: order.id,
        referenceTable: "customer_orders",
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
      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "LOADING")
        return res.status(400).json({ message: "Only LOADING orders can be finalized for loading" });

      const bales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (bales.length === 0) return res.status(400).json({ message: "Order has no bales scanned" });

      const [updated] = await db
        .update(customerOrders)
        .set({
          status: "VERIFIED",
          loadingFinalizedAt: new Date(),
          verifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(customerOrders.id, orderId))
        .returning();

      // V5 guard: proformaIdUsed IS NOT NULL
      // Move all linked bales to SOLD when a V5 order reaches VERIFIED.
      // This is idempotent — bales already SOLD are unaffected by the update.
      // Legacy V2/V3 orders keep bales in RESERVED_FOR_ORDER until FINALIZED.
      if (order.proformaIdUsed) {
        for (const b of bales) {
          await db
            .update(factoryBales)
            .set({ status: "SOLD", updatedAt: new Date() })
            .where(eq(factoryBales.id, b.baleId));
        }
      }

      const [lsCustomer] = await db
        .select({ legalName: customers.legalName })
        .from(customers)
        .where(eq(customers.id, order.customerId));
      const lsToday = req.body?.txDate || getClientDate(req);
      const lsTotalValue = bales.reduce((s: number, b: any) => s + parseFloat(b.priceUsed || "0"), 0);
      await writeDaybookEntry(db, {
        companyId,
        txDate: lsToday,
        txType: "LOADING_SUBMITTED",
        referenceId: orderId,
        referenceTable: "customer_orders",
        description: `Loading submitted: ${lsCustomer?.legalName || "Customer"}, ${bales.length} bale${bales.length !== 1 ? "s" : ""} scanned`,
        amountCurrency: lsTotalValue,
        amountUsd: lsTotalValue,
      });
      // Also write ORDER_VERIFIED immediately since we skip the Pending step
      const verifyTotalValue = parseFloat(updated?.grandTotal || "0") || lsTotalValue;
      await db
        .delete(factoryDaybookEntries)
        .where(
          and(
            eq(factoryDaybookEntries.companyId, companyId),
            eq(factoryDaybookEntries.txType, "ORDER_VERIFIED"),
            eq(factoryDaybookEntries.referenceId, orderId)
          )
        );
      await writeDaybookEntry(db, {
        companyId,
        txDate: lsToday,
        txType: "ORDER_VERIFIED",
        referenceId: orderId,
        referenceTable: "customer_orders",
        description: `Order verified for customer: ${lsCustomer?.legalName || "Customer"}`,
        amountCurrency: verifyTotalValue,
        amountUsd: verifyTotalValue,
      });

      const lsMsg = `${bales.length} bale${bales.length !== 1 ? "s" : ""} verified for ${lsCustomer?.legalName || "customer"}`;
      dispatchNotification({
        eventType: "LOADING_FINALIZED",
        title: "Loading Finalized",
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
}
