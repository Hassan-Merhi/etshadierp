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

export function registerOrderCrudRoutes(app: Express) {
  app.get("/api/factory/customer-orders", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const conditions: any[] = [eq(customerOrders.companyId, companyId), isNull(customerOrders.deletedAt)];
      if (req.query.customerId) conditions.push(eq(customerOrders.customerId, parseOptionalId(req.query.customerId)));
      if (req.query.status) conditions.push(eq(customerOrders.status, req.query.status));
      if (req.query.proformaId)
        conditions.push(eq(customerOrders.proformaIdUsed, parseOptionalId(req.query.proformaId)));
      if (req.query.showHidden !== "1") conditions.push(eq(customerOrders.isHidden, false));

      const orders = await db
        .select({
          id: customerOrders.id,
          companyId: customerOrders.companyId,
          customerId: customerOrders.customerId,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          proformaIdUsed: customerOrders.proformaIdUsed,
          proformaName: customerProformas.name,
          status: customerOrders.status,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          isHidden: customerOrders.isHidden,
          grandTotal: sql<string>`(
            COALESCE((
              SELECT SUM(
                CASE
                  WHEN col.pricing_mode = 'per_kg'
                    AND COALESCE(col.price_per_kg::numeric, 0) > 0
                    AND COALESCE(col.total_weight::numeric, 0) > 0
                  THEN col.price_per_kg::numeric * col.total_weight::numeric
                  ELSE COALESCE(col.total_price::numeric, 0)
                END
              )
              FROM customer_order_lines col
              WHERE col.order_id = ${customerOrders.id}
            ), 0)
            + COALESCE(${customerOrders.freightAmount}::numeric, 0)
            + COALESCE(${customerOrders.otherChargesTotal}::numeric, 0)
          )`,
          totalQtyBales: customerOrders.totalQtyBales,
          totalWeightKg: sql<string>`COALESCE((SELECT SUM(cob.weight) FROM customer_order_bales cob WHERE cob.order_id = ${customerOrders.id}), 0)`,
          proformaExpectedBales: sql<string>`COALESCE((SELECT SUM(quantity) FROM customer_proforma_lines WHERE proforma_id = ${customerOrders.proformaIdUsed}), 0)`,
          loadedNotInProformaBales: sql<string>`CASE WHEN ${customerOrders.proformaIdUsed} IS NULL THEN 0 ELSE COALESCE((SELECT COUNT(*)::int FROM customer_order_bales cob2 WHERE cob2.order_id = ${customerOrders.id} AND (cob2.article_code IS NULL OR cob2.article_code NOT IN (SELECT article_code FROM customer_proforma_lines WHERE proforma_id = ${customerOrders.proformaIdUsed}))), 0) END`,
          containerNumber: customerOrders.containerNumber,
          shippingCompany: customerOrders.shippingCompany,
          containerNotes: customerOrders.containerNotes,
          destination: customerOrders.destination,
          locationId: customerOrders.locationId,
          loadingStartedAt: customerOrders.loadingStartedAt,
          loadingFinalizedAt: customerOrders.loadingFinalizedAt,
          verifiedAt: customerOrders.verifiedAt,
          createdAt: customerOrders.createdAt,
          updatedAt: customerOrders.updatedAt,
          customerName: customers.legalName,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .leftJoin(customerProformas, eq(customerOrders.proformaIdUsed, customerProformas.id))
        .where(and(...conditions))
        .orderBy(desc(customerOrders.createdAt));

      res.json(orders);
    } catch (error: any) {
      console.error("Error fetching customer orders:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-orders/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });

      // SELECT * so that schema drift (missing newer columns) never causes a
      // parse-time "column does not exist" 500.  JS-side defaults applied below.
      const rawOrderRes = await db.execute(
        sql`SELECT co.*, c.legal_name AS customer_name, c.code AS customer_code
            FROM customer_orders co
            LEFT JOIN customers c ON c.id = co.customer_id
            WHERE co.id = ${id} AND co.company_id = ${companyId}
            LIMIT 1`
      );
      const rawOrderRows: any[] = (rawOrderRes as any).rows ?? (rawOrderRes as unknown as any[]);
      if (!rawOrderRows.length) return res.status(404).json({ message: "Order not found" });
      const r = rawOrderRows[0];
      const order = {
        id: r.id,
        companyId: r.company_id,
        customerId: r.customer_id,
        invoiceNumber: r.invoice_number ?? null,
        orderDate: r.order_date,
        proformaIdUsed: r.proforma_id_used ?? null,
        status: r.status ?? "DRAFT",
        subtotalBales: r.subtotal_bales ?? "0",
        freightAmount: r.freight_amount ?? "0",
        otherChargesTotal: r.other_charges_total ?? "0",
        grandTotal: r.grand_total ?? "0",
        totalQtyBales: r.total_qty_bales ?? 0,
        containerNumber: r.container_number ?? null,
        shippingCompany: r.shipping_company ?? null,
        containerNotes: r.container_notes ?? null,
        destination: r.destination ?? null,
        verifiedByUserId: r.verified_by_user_id ?? null,
        verifiedAt: r.verified_at ?? null,
        loadingStartedAt: r.loading_started_at ?? null,
        loadingFinalizedAt: r.loading_finalized_at ?? null,
        locationId: r.location_id ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at ?? r.created_at,
        customerName: r.customer_name ?? null,
        customerCode: r.customer_code ?? null,
        dispatchBatchId: r.dispatch_batch_id ?? null,
      };

      // customer_order_lines has no known schema drift — Drizzle is fine here
      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, id));

      // customer_order_bales and customer_order_charges both have newer columns
      // added via migrations that may be absent in production — use raw SQL.
      const rawBalesRes = await db.execute(sql`SELECT * FROM customer_order_bales WHERE order_id = ${id} ORDER BY id`);
      const bales = ((rawBalesRes as any).rows ?? (rawBalesRes as unknown as any[])).map((b: any) => ({
        id: b.id,
        orderId: b.order_id,
        baleId: b.bale_id,
        baleReference: b.bale_reference ?? "",
        locationId: b.location_id ?? null,
        weight: b.weight ?? "0",
        articleCode: b.article_code ?? null,
        baleName: b.bale_name ?? null,
        priceUsed: b.price_used ?? "0",
      }));

      const rawChargesRes = await db.execute(
        sql`SELECT * FROM customer_order_charges WHERE order_id = ${id} ORDER BY id`
      );
      const charges = ((rawChargesRes as any).rows ?? (rawChargesRes as unknown as any[])).map((c: any) => ({
        id: c.id,
        orderId: c.order_id,
        name: c.name ?? "",
        amount: c.amount ?? "0",
        chargeType: c.charge_type ?? "OTHER",
        ledgerAccountId: c.ledger_account_id ?? null,
        voucherId: c.voucher_id ?? null,
      }));

      res.json({ ...order, lines, bales, charges });
    } catch (error: any) {
      console.error("Error fetching customer order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/customer-orders/:id/hidden", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { isHidden } = req.body;
      if (typeof isHidden !== "boolean") return res.status(400).json({ message: "isHidden must be boolean" });
      await db
        .update(customerOrders)
        .set({ isHidden })
        .where(and(eq(customerOrders.id, id), eq(customerOrders.companyId, companyId)));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-orders/:id/profitability", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      // Respect per-user cost visibility settings — same gate as stock/proforma/order exports
      const vis = await getExportPriceVisibility(req);
      const hideCostData = vis.hideCost;

      const [order] = await db
        .select({
          id: customerOrders.id,
          status: customerOrders.status,
          invoiceNumber: customerOrders.invoiceNumber,
          customerName: customers.legalName,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, id), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, id));
      const articleCodes = lines.map((l: any) => l.articleCode).filter(Boolean);

      const products =
        articleCodes.length > 0
          ? await db
              .select({
                articleCode: factoryBaleProducts.articleCode,
                productionPrice: factoryBaleProducts.productionPrice,
                name: factoryBaleProducts.name,
              })
              .from(factoryBaleProducts)
              .where(
                and(
                  eq(factoryBaleProducts.companyId, companyId),
                  inArray(factoryBaleProducts.articleCode, articleCodes)
                )
              )
          : [];

      const productMap: Record<string, { productionPrice: string | null; name: string }> = {};
      for (const p of products) {
        if (p.articleCode) productMap[p.articleCode] = { productionPrice: p.productionPrice, name: p.name };
      }

      let totalSelling = 0;
      let totalCost = 0;
      let totalCostKnown = true;

      const profitLines = lines.map((line: any) => {
        const qty = Number(line.qty || 0);
        const selling = parseFloat(line.totalPrice || "0");
        const product = line.articleCode ? productMap[line.articleCode] : null;
        const hasCost = product !== null && product.productionPrice !== null;
        const costPerBale = hasCost ? parseFloat(product!.productionPrice!) : 0;
        const cost = hasCost ? costPerBale * qty : 0;
        const profit = hasCost ? selling - cost : null;
        const profitPctOnCost = hasCost && cost !== 0 ? ((selling - cost) / cost) * 100 : null;
        const marginPct = hasCost && selling !== 0 ? ((selling - cost) / selling) * 100 : null;

        totalSelling += selling;
        if (hasCost) {
          totalCost += cost;
        } else {
          totalCostKnown = false;
        }

        return {
          articleCode: line.articleCode,
          baleName: line.baleName,
          qty,
          selling,
          costPerBale: hideCostData ? null : costPerBale,
          cost: hideCostData ? null : cost,
          profit: hideCostData ? null : profit,
          profitPctOnCost: hideCostData ? null : profitPctOnCost,
          marginPct: hideCostData ? null : marginPct,
          missingCost: !hasCost,
          pricePerBale: parseFloat(line.pricePerBale || "0"),
        };
      });

      const totalProfit = totalCostKnown ? totalSelling - totalCost : null;
      const totalProfitPctOnCost =
        totalCostKnown && totalCost !== 0 ? ((totalSelling - totalCost) / totalCost) * 100 : null;
      const totalMarginPct =
        totalCostKnown && totalSelling !== 0 ? ((totalSelling - totalCost) / totalSelling) * 100 : null;

      res.json({
        orderId: id,
        invoiceNumber: order.invoiceNumber,
        customerName: order.customerName,
        lines: profitLines,
        totalSelling,
        totalCost: hideCostData || !totalCostKnown ? null : totalCost,
        totalProfit: hideCostData ? null : totalProfit,
        totalProfitPctOnCost: hideCostData ? null : totalProfitPctOnCost,
        totalMarginPct: hideCostData ? null : totalMarginPct,
        partialCostData: !totalCostKnown,
        costHidden: hideCostData,
      });
    } catch (error: any) {
      console.error("Error fetching order profitability:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertCustomerOrderSchema.parse({ ...req.body, companyId, status: "DRAFT" });
      const [order] = await db.insert(customerOrders).values(parsed).returning();
      res.json(order);
    } catch (error: any) {
      console.error("Error creating customer order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/factory/customer-orders/:id/link-proforma", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(orderId)) return res.status(400).json({ message: "Invalid order ID" });

      const { proformaId } = req.body;
      // proformaId may be null/0 to unlink
      const isUnlink = proformaId == null || proformaId === 0 || proformaId === "0";
      const proformaIdInt = isUnlink ? null : parseInt(proformaId);
      if (!isUnlink && (proformaIdInt === null || isNaN(proformaIdInt!)))
        return res.status(400).json({ message: "Invalid proformaId" });

      // Confirm order exists for this company
      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      // Must be a LOADING order
      if (order.status !== "LOADING")
        return res.status(400).json({ message: "Can only link a proforma to a LOADING order" });

      // Always wipe existing expected lines so we start fresh
      await db.execute(sql`DELETE FROM customer_order_expected_lines WHERE order_id = ${orderId}`);

      if (isUnlink) {
        // Unlink: clear proformaIdUsed and expected lines (already deleted above)
        await db.update(customerOrders).set({ proformaIdUsed: null }).where(eq(customerOrders.id, orderId));
        return res.json({ success: true, linked: { orderId, proformaId: null, linesBackfilled: 0 } });
      }

      // Confirm proforma exists for this company
      const [proforma] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, proformaIdInt!), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      // Proforma must be active
      if (!proforma.isActive) return res.status(400).json({ message: "Proforma is not active" });

      // Customer match check — reject if both sides have a customerId and they differ
      if (order.customerId && proforma.customerId && order.customerId !== proforma.customerId)
        return res.status(400).json({
          message: `Customer mismatch: order belongs to customer #${order.customerId} but proforma belongs to customer #${proforma.customerId}. Cannot link.`,
        });

      // Fetch proforma lines for expected-lines backfill
      const proformaLines = await db
        .select()
        .from(customerProformaLines)
        .where(eq(customerProformaLines.proformaId, proformaIdInt!));

      // Link the order → proforma (re-link allowed: replaces any previous proforma)
      await db.update(customerOrders).set({ proformaIdUsed: proformaIdInt }).where(eq(customerOrders.id, orderId));

      // Insert expected lines from the new proforma
      if (proformaLines.length > 0) {
        await db.execute(
          sql`INSERT INTO customer_order_expected_lines
                (company_id, order_id, proforma_id, proforma_line_id, article_code, product_name, expected_qty)
              SELECT ${companyId}, ${orderId}, cpl.proforma_id, cpl.id,
                     cpl.article_code, cpl.product_name, cpl.quantity
              FROM customer_proforma_lines cpl
              WHERE cpl.proforma_id = ${proformaIdInt}
              ON CONFLICT (order_id, article_code) DO NOTHING`
        );
      }

      res.json({
        success: true,
        linked: { orderId, proformaId: proformaIdInt, linesBackfilled: proformaLines.length },
      });
    } catch (error: any) {
      console.error("Error linking proforma to loading:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/factory/customer-orders/:id/loading-note — update the free-text
  // note on a loading order (works on any non-cancelled status so floor staff
  // can add or edit notes at any point during the loading lifecycle).
  app.patch("/api/factory/customer-orders/:id/loading-note", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { note } = req.body;

      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Loading not found" });

      const [updated] = await db
        .update(customerOrders)
        .set({ containerNotes: note?.trim() || null, updatedAt: new Date() })
        .where(eq(customerOrders.id, orderId))
        .returning();

      res.json({ success: true, order: updated });
    } catch (error: any) {
      console.error("Error updating loading note:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-orders/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });

      await db.transaction(async (tx: any) => {
        const [order] = await tx
          .select()
          .from(customerOrders)
          .where(
            and(
              eq(customerOrders.id, orderId),
              eq(customerOrders.companyId, companyId),
              isNull(customerOrders.deletedAt)
            )
          );
        if (!order) throw new Error("Order not found");

        if (order.status === "FINALIZED") {
          throw new Error("Cannot delete a finalized invoice. Cancel it first if needed.");
        }

        // Soft-delete: release bales back to stock so they can be re-sold,
        // but preserve order/lines/charges/bale links so the order can be
        // restored from Settings → Deleted Items (note: bales currently in
        // stock will need to be re-reserved manually after restore).
        const bales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        for (const b of bales) {
          await tx
            .update(factoryBales)
            .set({ status: "IN_STOCK", updatedAt: new Date() })
            .where(eq(factoryBales.id, b.baleId));
        }

        await tx
          .update(customerOrders)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(customerOrders.id, orderId));
      });

      res.json({ success: true, message: "Invoice moved to Deleted Items" });
    } catch (error: any) {
      console.error("Error deleting customer order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/customer-orders/:id/date", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { orderDate } = req.body;
      if (!orderDate) return res.status(400).json({ message: "orderDate is required" });

      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "DRAFT")
        return res.status(400).json({ message: "Only DRAFT orders can have their date changed" });

      const [updated] = await db
        .update(customerOrders)
        .set({ orderDate, updatedAt: new Date() })
        .where(eq(customerOrders.id, orderId))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating order date:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/assign-container", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { containerNumber, shippingCompany, containerNotes, destination } = req.body;

      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const updateData: any = { updatedAt: new Date() };
      if (containerNumber !== undefined) updateData.containerNumber = containerNumber;
      if (shippingCompany !== undefined) updateData.shippingCompany = shippingCompany;
      if (containerNotes !== undefined) updateData.containerNotes = containerNotes;
      if (destination !== undefined) updateData.destination = destination || null;

      const [updated] = await db
        .update(customerOrders)
        .set(updateData)
        .where(eq(customerOrders.id, orderId))
        .returning();

      if (shippingCompany && order.customerId) {
        await db
          .update(customers)
          .set({
            defaultShippingCompany: shippingCompany,
          })
          .where(eq(customers.id, order.customerId))
          .catch(() => {});
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error assigning container:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // BALE SCAN LOOKUP
  // ───────────────────────────────────────────────

  app.get("/api/factory/bale-lookup", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const code = req.query.code as string;
      const locationId = req.query.locationId ? parseOptionalId(req.query.locationId) : null;
      if (!code) return res.status(400).json({ message: "code is required" });

      const conditions: any[] = [
        eq(factoryBales.companyId, companyId),
        eq(factoryBales.status, "IN_STOCK"),
        or(eq(factoryBales.referenceNumber, code), eq(factoryBales.baleCode, code), eq(factoryBales.articleCode, code)),
      ];

      if (locationId) {
        conditions.push(eq(factoryBales.erpLocationId, locationId));
      }

      const results = await db
        .select()
        .from(factoryBales)
        .where(and(...conditions));

      if (results.length === 0)
        return res.status(404).json({ message: "No available bale found with that code at this location" });

      res.json(results);
    } catch (error: any) {
      console.error("Error looking up bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // INVOICE EXPORT (Excel/CSV)
  // ───────────────────────────────────────────────
}
