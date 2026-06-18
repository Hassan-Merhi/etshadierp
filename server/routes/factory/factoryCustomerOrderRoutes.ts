import { trackOneContainerById } from "../../services/containerTrackingService";
import { parseId, parseOptionalId } from "../../lib/parseId";
import { dispatchNotification } from "../../lib/notificationService";
import { getClientDate } from "../../lib/dateUtils";
import { getExportPriceVisibility } from "../../helpers/exportVisibility";
import { sendWhatsAppFileToChatIdPos } from "../../services/whatsappService";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { classifyNetPositionAccounts } from "../../netPositionHelper";
import { adjustInventory } from "../../inventoryHelper";
import {
  writeDaybookEntry, getOrFetchFxRateToUsd, getOrCreateLedgerAccount,
  isLegacySHA256Hash, verifySupervisorPassword, recalculateOrderTotals,
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
  customerOrderBaleRemovals, customerOrderExpectedLines,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";


function buildExportFilename(parts: (string | null | undefined)[], ext: string): string {
  const safe = parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) => p.replace(/[\\/*?:[\]<>|]/g, "").replace(/\s+/g, "_").trim())
    .filter((p) => p.length > 0);
  const base = safe.join("_") || "export";
  return ext ? `${base}.${ext}` : base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helper: build the Commercial Invoice Excel workbook for an order and
// return it as a Buffer so it can be streamed to a browser download OR sent
// directly as a WhatsApp file attachment.
// ─────────────────────────────────────────────────────────────────────────────
async function buildOrderExcelBuffer(
  orderId: number,
  companyId: number,
  hideSelling: boolean,
): Promise<{ buffer: Buffer; fileName: string }> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const [order] = await db
    .select({
      id: customerOrders.id,
      invoiceNumber: customerOrders.invoiceNumber,
      orderDate: customerOrders.orderDate,
      subtotalBales: customerOrders.subtotalBales,
      freightAmount: customerOrders.freightAmount,
      otherChargesTotal: customerOrders.otherChargesTotal,
      grandTotal: customerOrders.grandTotal,
      containerNumber: customerOrders.containerNumber,
      destination: customerOrders.destination,
      customerName: customers.legalName,
    })
    .from(customerOrders)
    .leftJoin(customers, eq(customerOrders.customerId, customers.id))
    .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));

  if (!order) throw new Error(`Order ${orderId} not found for company ${companyId}`);

  const orderChargesHelper = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));
  const rawLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));

  const articleCodes = [...new Set(rawLines.map((l: any) => l.articleCode).filter(Boolean))];
  const productNameMap = new Map<string, string>();
  const wtPerBaleMap = new Map<string, number>();
  if (articleCodes.length > 0) {
    const products = await db
      .select({ articleCode: factoryBaleProducts.articleCode, name: factoryBaleProducts.name, weightPerBaleKg: factoryBaleProducts.weightPerBaleKg })
      .from(factoryBaleProducts)
      .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, articleCodes)));
    for (const p of products) {
      if (p.articleCode) {
        productNameMap.set(p.articleCode, p.name);
        wtPerBaleMap.set(p.articleCode, parseFloat(p.weightPerBaleKg || "0"));
      }
    }
  }

  const helperLines = rawLines
    .map((l: any) => ({
      articleCode: l.articleCode || "",
      productName: productNameMap.get(l.articleCode) || l.baleName || l.articleCode || "",
      qty: parseInt(l.qty || "0"),
      wtPerBale: wtPerBaleMap.get(l.articleCode) || parseFloat(l.weightPerBale || "0"),
      totalWt: parseFloat(l.totalWeight || "0"),
      pricePerBale: parseFloat(l.pricePerBale || "0"),
      total: parseFloat(l.totalPrice || "0"),
      pricingMode: (l.pricingMode as string) || "per_bale",
      pricePerKg: parseFloat(l.pricePerKg || "0"),
    }))
    .sort((a: any, b: any) => a.articleCode.localeCompare(b.articleCode));
  const anyPerKgH = helperLines.some((l: any) => l.pricingMode === 'per_kg');

  const baseCurrency = (company as any)?.baseCurrency || "USD";
  const currencySymbolMap: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", CFA: "CFA", XOF: "CFA", XAF: "CFA" };
  const currSym = currencySymbolMap[baseCurrency.toUpperCase()] ?? baseCurrency;
  const fmtMoney = (n: number) => `${currSym}${n % 1 === 0 ? n.toLocaleString() : n.toFixed(2)}`;
  const fmtNum = (n: number) => n % 1 === 0 ? n.toLocaleString() : n.toFixed(2);

  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Commercial Invoice");
  const COL = 8;

  sheet.columns = [
    { key: "c1", width: 6 },
    { key: "c2", width: 16 },
    { key: "c3", width: 30 },
    { key: "c4", width: 8 },
    { key: "c5", width: 11 },
    { key: "c6", width: 13 },
    { key: "c7", width: 13 },
    { key: "c8", width: 14 },
  ];

  const DARK_BLUE = "FF1F3864";
  const LIGHT_GRAY = "FFF5F5F5";
  const WHITE = "FFFFFFFF";

  const merge = (r: number, c1: number, c2: number) => sheet.mergeCells(r, c1, r, c2);
  const setFill = (cell: any, argb: string) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } }; };
  const setBorderH = (row: any) => {
    row.eachCell((cell: any) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFDDDDDD" } },
        bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
        left: { style: "thin", color: { argb: "FFDDDDDD" } },
        right: { style: "thin", color: { argb: "FFDDDDDD" } },
      };
    });
  };

  // Logo
  const logoRow = sheet.addRow([]);
  logoRow.height = 110;
  try {
    const logoPath = path.join(process.cwd(), "server", "hmd-logo.png");
    if (fs.existsSync(logoPath)) {
      const logoBuf = fs.readFileSync(logoPath);
      const logoId = workbook.addImage({ buffer: logoBuf as Buffer, extension: "jpeg" });
      sheet.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 180, height: 110 } });
    }
  } catch {}

  const r1 = sheet.addRow(["HMD INTERNATIONAL GROUP"]);
  r1.height = 26;
  r1.getCell(1).font = { bold: true, size: 16, color: { argb: DARK_BLUE } };
  r1.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  merge(r1.number, 1, COL);

  const r2 = sheet.addRow(["Commercial Invoice"]);
  r2.height = 22;
  r2.getCell(1).font = { bold: true, size: 14, color: { argb: DARK_BLUE } };
  r2.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  merge(r2.number, 1, COL);
  sheet.addRow([]);

  const invoiceNum = order.invoiceNumber || `INV-${String(orderId).padStart(6, "0")}`;
  const orderDateFmt = order.orderDate
    ? new Date(order.orderDate).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" })
    : "-";

  for (const [label, value] of [
    ["Invoice No.", invoiceNum],
    ["Customer", order.customerName || "-"],
    ["Date", orderDateFmt],
    ["Container", (order as any).containerNumber || "-"],
  ]) {
    const dr = sheet.addRow(["", "", "", "", "", label, "", value]);
    dr.height = 20;
    dr.getCell(6).font = { bold: true, size: 11 };
    dr.getCell(6).alignment = { horizontal: "right" };
    dr.getCell(8).font = { size: 11 };
    dr.getCell(8).alignment = { horizontal: "left" };
    merge(dr.number, 6, 7);
  }
  sheet.addRow([]);

  const unitPriceLabelH = anyPerKgH ? "Price/KG" : "Price/Bale";
  const hdrRow = sheet.addRow(["#", "Article Code", "Product", "Qty", "Wt/Bale", "Total Wt", ...(hideSelling ? [] : [unitPriceLabelH, "Total"])]);
  hdrRow.height = 24;
  hdrRow.eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
    setFill(cell, DARK_BLUE);
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { top: { style: "thin", color: { argb: WHITE } }, bottom: { style: "thin", color: { argb: WHITE } }, left: { style: "thin", color: { argb: WHITE } }, right: { style: "thin", color: { argb: WHITE } } };
  });

  let totalQtyH = 0, totalWtH = 0, totalH = 0;
  helperLines.forEach((g: any, idx: number) => {
    totalQtyH += g.qty;
    totalWtH += g.totalWt;
    totalH += g.total;
    const unitPriceH = g.pricingMode === 'per_kg'
      ? (g.totalWt > 0 ? g.total / g.totalWt : (g.pricePerKg || 0))
      : g.pricePerBale;
    const rowCells: any[] = [idx + 1, g.articleCode, g.productName, g.qty, fmtNum(g.wtPerBale), fmtNum(g.totalWt)];
    if (!hideSelling) { rowCells.push(fmtMoney(unitPriceH)); rowCells.push(fmtMoney(g.total)); }
    const dr = sheet.addRow(rowCells);
    dr.height = 20;
    dr.eachCell((cell: any) => { cell.font = { size: 11 }; });
    if (idx % 2 === 1) dr.eachCell((cell: any) => setFill(cell, LIGHT_GRAY));
    dr.getCell(1).alignment = { horizontal: "center" };
    dr.getCell(4).alignment = { horizontal: "right" };
    dr.getCell(5).alignment = { horizontal: "right" };
    dr.getCell(6).alignment = { horizontal: "right" };
    if (!hideSelling) {
      dr.getCell(7).alignment = { horizontal: "right" };
      dr.getCell(8).alignment = { horizontal: "right" };
    }
    setBorderH(dr);
  });

  const totRowCells: any[] = ["", "", "Totals", totalQtyH, "", fmtNum(totalWtH)];
  if (!hideSelling) { totRowCells.push(""); totRowCells.push(fmtMoney(totalH)); }
  const totRow = sheet.addRow(totRowCells);
  totRow.height = 22;
  totRow.eachCell((cell: any) => {
    cell.font = { bold: true, size: 11, color: { argb: WHITE } };
    setFill(cell, DARK_BLUE);
    cell.alignment = { horizontal: "right" };
  });
  totRow.getCell(3).alignment = { horizontal: "center" };
  sheet.addRow([]);

  if (!hideSelling) {
    const subtotal = parseFloat(order.subtotalBales || "0");
    const freight = parseFloat(order.freightAmount || "0");
    const otherChargesTotal = parseFloat(order.otherChargesTotal || "0");
    const grandTotal = parseFloat(order.grandTotal || "0");

    const otherChargeLines = orderChargesHelper.filter((ch: any) => ch.chargeType !== "FREIGHT");
    const chargeRows: [string, number][] = otherChargeLines.length > 0
      ? otherChargeLines.map((ch: any) => [ch.name, parseFloat(ch.amount || "0")] as [string, number])
      : otherChargesTotal > 0 ? [["Other Charges", otherChargesTotal]] : [];

    const summaryData: [string, number][] = [
      ["Subtotal (Bales)", subtotal],
      ...(freight > 0 ? [["Freight", freight] as [string, number]] : []),
      ...chargeRows,
      ["Grand Total", grandTotal],
    ];

    const sumHdr = sheet.addRow(["", "", "", "", "", "", "Name", "Amount"]);
    sumHdr.height = 22;
    sumHdr.getCell(7).font = { bold: true, color: { argb: WHITE }, size: 11 };
    sumHdr.getCell(8).font = { bold: true, color: { argb: WHITE }, size: 11 };
    setFill(sumHdr.getCell(7), DARK_BLUE);
    setFill(sumHdr.getCell(8), DARK_BLUE);
    sumHdr.getCell(7).alignment = { horizontal: "center" };
    sumHdr.getCell(8).alignment = { horizontal: "center" };

    summaryData.forEach(([label, amount], idx) => {
      const sr = sheet.addRow(["", "", "", "", "", "", label, fmtMoney(amount)]);
      sr.height = 20;
      const isGrandTotal = idx === summaryData.length - 1;
      const bg = isGrandTotal ? DARK_BLUE : (idx % 2 === 0 ? WHITE : LIGHT_GRAY);
      const fg = isGrandTotal ? WHITE : "FF000000";
      setFill(sr.getCell(7), bg);
      setFill(sr.getCell(8), bg);
      sr.getCell(7).font = { bold: isGrandTotal, size: 11, color: { argb: fg } };
      sr.getCell(8).font = { bold: isGrandTotal, size: 11, color: { argb: fg } };
      sr.getCell(7).alignment = { horizontal: "left" };
      sr.getCell(8).alignment = { horizontal: "right" };
      sr.getCell(7).border = { top: { style: "thin", color: { argb: "FFDDDDDD" } }, bottom: { style: "thin", color: { argb: "FFDDDDDD" } }, left: { style: "thin", color: { argb: "FFDDDDDD" } }, right: { style: "thin", color: { argb: "FFDDDDDD" } } };
      sr.getCell(8).border = { top: { style: "thin", color: { argb: "FFDDDDDD" } }, bottom: { style: "thin", color: { argb: "FFDDDDDD" } }, left: { style: "thin", color: { argb: "FFDDDDDD" } }, right: { style: "thin", color: { argb: "FFDDDDDD" } } };
    });
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileName = buildExportFilename([order.containerNumber, order.customerName, order.destination], "xlsx");
  return { buffer, fileName };
}

export function registerFactoryCustomerOrderRoutes(app: Express) {
  app.get("/api/factory/customer-orders", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const conditions: any[] = [eq(customerOrders.companyId, companyId), isNull(customerOrders.deletedAt)];
      if (req.query.customerId) conditions.push(eq(customerOrders.customerId, parseOptionalId(req.query.customerId)));
      if (req.query.status) conditions.push(eq(customerOrders.status, req.query.status));
      if (req.query.proformaId) conditions.push(eq(customerOrders.proformaIdUsed, parseOptionalId(req.query.proformaId)));
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
            LIMIT 1`,
      );
      const rawOrderRows: any[] = (rawOrderRes as any).rows ?? (rawOrderRes as unknown as any[]);
      if (!rawOrderRows.length) return res.status(404).json({ message: "Order not found" });
      const r = rawOrderRows[0];
      const order = {
        id:                 r.id,
        companyId:          r.company_id,
        customerId:         r.customer_id,
        invoiceNumber:      r.invoice_number       ?? null,
        orderDate:          r.order_date,
        proformaIdUsed:     r.proforma_id_used     ?? null,
        status:             r.status               ?? "DRAFT",
        subtotalBales:      r.subtotal_bales       ?? "0",
        freightAmount:      r.freight_amount       ?? "0",
        otherChargesTotal:  r.other_charges_total  ?? "0",
        grandTotal:         r.grand_total          ?? "0",
        totalQtyBales:      r.total_qty_bales      ?? 0,
        containerNumber:    r.container_number     ?? null,
        shippingCompany:    r.shipping_company     ?? null,
        containerNotes:     r.container_notes      ?? null,
        destination:        r.destination          ?? null,
        verifiedByUserId:   r.verified_by_user_id  ?? null,
        verifiedAt:         r.verified_at          ?? null,
        loadingStartedAt:   r.loading_started_at   ?? null,
        loadingFinalizedAt: r.loading_finalized_at ?? null,
        locationId:         r.location_id          ?? null,
        createdAt:          r.created_at,
        updatedAt:          r.updated_at           ?? r.created_at,
        customerName:       r.customer_name        ?? null,
        customerCode:       r.customer_code        ?? null,
        dispatchBatchId:    r.dispatch_batch_id    ?? null,
      };

      // customer_order_lines has no known schema drift — Drizzle is fine here
      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, id));

      // customer_order_bales and customer_order_charges both have newer columns
      // added via migrations that may be absent in production — use raw SQL.
      const rawBalesRes = await db.execute(
        sql`SELECT * FROM customer_order_bales WHERE order_id = ${id} ORDER BY id`,
      );
      const bales = ((rawBalesRes as any).rows ?? (rawBalesRes as unknown as any[])).map((b: any) => ({
        id:            b.id,
        orderId:       b.order_id,
        baleId:        b.bale_id,
        baleReference: b.bale_reference ?? "",
        locationId:    b.location_id    ?? null,
        weight:        b.weight         ?? "0",
        articleCode:   b.article_code   ?? null,
        baleName:      b.bale_name      ?? null,
        priceUsed:     b.price_used     ?? "0",
      }));

      const rawChargesRes = await db.execute(
        sql`SELECT * FROM customer_order_charges WHERE order_id = ${id} ORDER BY id`,
      );
      const charges = ((rawChargesRes as any).rows ?? (rawChargesRes as unknown as any[])).map((c: any) => ({
        id:              c.id,
        orderId:         c.order_id,
        name:            c.name         ?? "",
        amount:          c.amount       ?? "0",
        chargeType:      c.charge_type  ?? "OTHER",
        ledgerAccountId: c.ledger_account_id ?? null,
        voucherId:       c.voucher_id   ?? null,
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
      await db.update(customerOrders).set({ isHidden }).where(and(eq(customerOrders.id, id), eq(customerOrders.companyId, companyId)));
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
        .select({ id: customerOrders.id, status: customerOrders.status, invoiceNumber: customerOrders.invoiceNumber, customerName: customers.legalName })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, id), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, id));
      const articleCodes = lines.map((l: any) => l.articleCode).filter(Boolean);

      const products = articleCodes.length > 0
        ? await db.select({
            articleCode: factoryBaleProducts.articleCode,
            productionPrice: factoryBaleProducts.productionPrice,
            name: factoryBaleProducts.name,
          }).from(factoryBaleProducts)
            .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, articleCodes)))
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
      const totalProfitPctOnCost = totalCostKnown && totalCost !== 0 ? ((totalSelling - totalCost) / totalCost) * 100 : null;
      const totalMarginPct = totalCostKnown && totalSelling !== 0 ? ((totalSelling - totalCost) / totalSelling) * 100 : null;

      res.json({
        orderId: id,
        invoiceNumber: order.invoiceNumber,
        customerName: order.customerName,
        lines: profitLines,
        totalSelling,
        totalCost: (hideCostData || !totalCostKnown) ? null : totalCost,
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

  app.post("/api/factory/customer-orders/:id/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { scanCode, locationId } = req.body;
      if (!scanCode || !locationId) return res.status(400).json({ message: "scanCode and locationId are required" });
      const scannerName: string | null = (req.session as any)?.username || (req.session as any)?.name || (req.session as any)?.email || null;

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION"].includes(order.status)) return res.status(400).json({ message: "Can only add bales to DRAFT, LOADING, or PENDING_VERIFICATION orders" });

      // V5 guard: proformaIdUsed IS NOT NULL
      // V5 bales are SOLD once the order reaches PENDING_VERIFICATION — no further scanning allowed.
      // Legacy V2/V3 behavior (PENDING_VERIFICATION scan allowed) is unchanged.
      if (order.proformaIdUsed && order.status === "PENDING_VERIFICATION") {
        return res.status(400).json({ message: "Cannot add bales to a V5 order that is already in PENDING_VERIFICATION" });
      }

      // Check if this scan code matches a bale already reserved (status = RESERVED_FOR_ORDER).
      // Only match by unique bale identifiers (referenceNumber, baleCode) — NOT by articleCode or
      // productName, which are shared across many bales and would falsely block scanning the next
      // available bale of the same product type.
      const scanLower = scanCode.toLowerCase();
      const [reservedBale] = await db.select().from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.status, "RESERVED_FOR_ORDER"),
          or(
            sql`LOWER(${factoryBales.referenceNumber}) = ${scanLower}`,
            sql`LOWER(${factoryBales.baleCode}) = ${scanLower}`
          )
        ));

      if (reservedBale) {
        const [inThisOrder] = await db.select().from(customerOrderBales)
          .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.baleId, reservedBale.id)));
        if (inThisOrder) {
          return res.status(400).json({ message: `${reservedBale.referenceNumber || scanCode} is already loaded in this order` });
        }
        return res.status(400).json({ message: `Bale ${reservedBale.referenceNumber || scanCode} is reserved for another loading order` });
      }

      // Also look up product IDs whose current name or articleCode matches the scan code
      const matchingProductsByName = await db
        .select({ id: factoryBaleProducts.id })
        .from(factoryBaleProducts)
        .where(and(
          eq(factoryBaleProducts.companyId, companyId),
          or(
            sql`LOWER(${factoryBaleProducts.name}) = ${scanLower}`,
            ilike(factoryBaleProducts.name, `%${scanCode.trim()}%`),
            sql`LOWER(${factoryBaleProducts.articleCode}) = ${scanLower}`,
            ilike(factoryBaleProducts.articleCode, `%${scanCode.trim()}%`)
          )
        ));
      const matchingProductIds = matchingProductsByName.map((p: any) => p.id);

      const nameConditions = matchingProductIds.length > 0
        ? or(
            sql`LOWER(${factoryBales.referenceNumber}) = ${scanLower}`,
            sql`LOWER(${factoryBales.baleCode}) = ${scanLower}`,
            sql`LOWER(${factoryBales.articleCode}) = ${scanLower}`,
            sql`LOWER(${factoryBales.productName}) = ${scanLower}`,
            inArray(factoryBales.productId, matchingProductIds)
          )
        : or(
            sql`LOWER(${factoryBales.referenceNumber}) = ${scanLower}`,
            sql`LOWER(${factoryBales.baleCode}) = ${scanLower}`,
            sql`LOWER(${factoryBales.articleCode}) = ${scanLower}`,
            sql`LOWER(${factoryBales.productName}) = ${scanLower}`
          );

      // Pick the bale + verify it's not already in this order + (V5) check no
      // other active order has it + insert the join row + flip status — all
      // inside one transaction with SELECT FOR UPDATE so two concurrent scans
      // of the same article cannot both claim the same physical bale.
      // Errors with `httpStatus` and `body` are thrown to bubble out of the
      // tx, then translated back to res.status(...).json(...) below.
      type PickResult =
        | { ok: true; baleId: number }
        | { ok: false; httpStatus: number; body: any };

      const result: PickResult = await db.transaction(async (tx: any) => {
        const [bale] = await tx.select().from(factoryBales)
          .where(and(
            eq(factoryBales.companyId, companyId),
            eq(factoryBales.status, "IN_STOCK"),
            eq(factoryBales.erpLocationId, parseInt(locationId)),
            nameConditions
          ))
          .orderBy(factoryBales.id)
          .limit(1)
          .for("update");

        if (!bale) {
          return { ok: false, httpStatus: 404, body: { message: "Bale not found, not at this location, or not available for sale" } };
        }

        const [alreadyAdded] = await tx.select().from(customerOrderBales)
          .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.baleId, bale.id)));
        if (alreadyAdded) {
          return { ok: false, httpStatus: 400, body: { message: "Bale already added to this order" } };
        }

        // Universal cross-order duplicate check: block if this bale is already in any other
        // active (non-CANCELLED) order. This covers both V5 orders (bales stay IN_STOCK so the
        // RESERVED_FOR_ORDER status check above cannot catch them) and non-V5 mixed scenarios
        // where a V5 order's IN_STOCK bale could otherwise slip through onto a non-V5 order.
        const crossOrderDupCheck = await tx.execute(
          sql`SELECT cob.order_id, co.status, co.invoice_number FROM customer_order_bales cob
              JOIN customer_orders co ON co.id = cob.order_id
              WHERE cob.bale_id = ${bale.id}
                AND co.status != 'CANCELLED'
                AND cob.order_id != ${orderId}
              LIMIT 1`,
        );
        const crossOrderDupRow = (crossOrderDupCheck as any).rows?.[0];
        if (crossOrderDupRow) {
          const orderRef = crossOrderDupRow.invoice_number
            ? `invoice ${crossOrderDupRow.invoice_number}`
            : `loading #${crossOrderDupRow.order_id}`;
          return { ok: false, httpStatus: 400, body: { message: `Bale ${bale.referenceNumber || scanCode} is already in ${orderRef} (${crossOrderDupRow.status}). Remove it from that order first.` } };
        }

        let priceUsed = "0";
        let proformaLine: any = null;
        if (order.proformaIdUsed) {
          const [pl] = await tx.select().from(customerProformaLines)
            .where(and(
              eq(customerProformaLines.proformaId, order.proformaIdUsed),
              eq(customerProformaLines.articleCode, bale.articleCode || "")
            ));
          proformaLine = pl || null;
          if (proformaLine) {
            const pricingMode = (proformaLine as any).pricingMode ?? 'per_bale';
            const perKgVal = (proformaLine as any).pricePerKg;
            if (pricingMode === 'per_kg' && perKgVal) {
              const weightKg = parseFloat(String(bale.weightKg || "0"));
              const pkgRate = parseFloat(String(perKgVal));
              priceUsed = (!isNaN(weightKg) && !isNaN(pkgRate)) ? (weightKg * pkgRate).toFixed(2) : "0";
            } else {
              priceUsed = proformaLine.pricePerBale;
            }
            // Overload check: count existing bales of this article in the order
            if (!req.body.allowBypassOverload) {
              const [countResult] = await tx
                .select({ count: sql<number>`COUNT(*)::int` })
                .from(customerOrderBales)
                .where(and(
                  eq(customerOrderBales.orderId, orderId),
                  eq(customerOrderBales.articleCode, bale.articleCode || "")
                ));
              const currentCount = countResult?.count || 0;
              if (currentCount >= proformaLine.quantity) {
                return { ok: false, httpStatus: 400, body: {
                  overloaded: true,
                  message: `Quantity exceeded (${currentCount}/${proformaLine.quantity}). Scan again to bypass.`,
                } };
              }
            }
          } else if (!req.body.allowBypassProforma) {
            return { ok: false, httpStatus: 400, body: {
              notInProforma: true,
              message: "Item loaded not requested. Please scan again to bypass.",
            } };
          }
        }

        let productForBale: any = null;
        if (bale.productId) {
          const [p] = await tx.select().from(factoryBaleProducts)
            .where(eq(factoryBaleProducts.id, bale.productId));
          productForBale = p || null;
          if (productForBale && priceUsed === "0" && productForBale.sellingPrice) {
            priceUsed = productForBale.sellingPrice;
          }
        }

        // Always prefer the canonical product name from factoryBaleProducts
        const resolvedBaleName = productForBale?.name || bale.productName || bale.articleCode || bale.baleCode;

        await tx.insert(customerOrderBales).values({
          orderId,
          baleId: bale.id,
          baleReference: bale.referenceNumber,
          locationId: parseInt(locationId),
          weight: bale.weightKg,
          articleCode: bale.articleCode,
          baleName: resolvedBaleName,
          priceUsed,
          scannedBy: scannerName,
        });

        // V5 guard: proformaIdUsed IS NOT NULL
        // V5 bales remain IN_STOCK during loading — only legacy V2/V3 orders set RESERVED_FOR_ORDER.
        if (!order.proformaIdUsed) {
          await tx.update(factoryBales).set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() }).where(eq(factoryBales.id, bale.id));
        }

        await recalculateOrderTotals(tx, orderId);
        return { ok: true, baleId: bale.id };
      });

      if (!result.ok) return res.status(result.httpStatus).json(result.body);

      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error adding bale to order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/bales/bulk-import", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { locationId, items, refNumbers: refNumbersRaw } = req.body;
      const hasRefNumbers = Array.isArray(refNumbersRaw) && refNumbersRaw.length > 0;
      const hasItems = Array.isArray(items) && items.length > 0;
      if (!locationId || (!hasItems && !hasRefNumbers)) {
        return res.status(400).json({ message: "locationId and either items or refNumbers are required" });
      }
      const scannerName: string | null = (req.session as any)?.username || (req.session as any)?.name || (req.session as any)?.email || null;

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION"].includes(order.status)) {
        return res.status(400).json({ message: "Can only add bales to DRAFT, LOADING, or PENDING_VERIFICATION orders" });
      }

      // V5 guard: proformaIdUsed IS NOT NULL
      // V5 bales are SOLD once the order reaches PENDING_VERIFICATION — no further bulk scanning allowed.
      // Legacy V2/V3 behavior (PENDING_VERIFICATION scan allowed) is unchanged.
      if (order.proformaIdUsed && order.status === "PENDING_VERIFICATION") {
        return res.status(400).json({ message: "Cannot add bales to a V5 order that is already in PENDING_VERIFICATION" });
      }

      const parsedLocationId = parseInt(locationId);

      // Get all products for this company for matching
      const allProducts = await db.select().from(factoryBaleProducts)
        .where(eq(factoryBaleProducts.companyId, companyId));

      // Get bales already in this order
      const existingOrderBales = await db.select({ baleId: customerOrderBales.baleId })
        .from(customerOrderBales)
        .where(eq(customerOrderBales.orderId, orderId));
      const alreadyAddedBaleIds = new Set(existingOrderBales.map((b: any) => b.baleId));

      let totalAdded = 0;
      const notFound: Array<{ articleCode: string; requestedQty: number; foundQty: number }> = [];
      const notFoundRefs: string[] = [];

      // ── REF-NUMBER / REF-CODE MODE ──────────────────────────────────────────
      if (hasRefNumbers) {
        const refNumbers = refNumbersRaw as string[];
        for (const rawRef of refNumbers) {
          const refNum = String(rawRef).trim();
          if (!refNum) continue;

          // Per-refNum tx: lock the bale with SELECT FOR UPDATE, then insert
          // the join row + flip status atomically. Two concurrent bulk-imports
          // referencing the same physical bale will block at the lock; only
          // one will see status='IN_STOCK', the other will skip.
          const refResult = await db.transaction(async (tx: any) => {
            // Try referenceNumber first, then fall back to baleCode
            let [bale] = await tx.select().from(factoryBales)
              .where(and(
                eq(factoryBales.companyId, companyId),
                eq(factoryBales.referenceNumber, refNum),
                eq(factoryBales.status, "IN_STOCK")
              ))
              .for("update");

            if (!bale) {
              [bale] = await tx.select().from(factoryBales)
                .where(and(
                  eq(factoryBales.companyId, companyId),
                  eq(factoryBales.baleCode, refNum),
                  eq(factoryBales.status, "IN_STOCK")
                ))
                .for("update");
            }

            if (!bale) return { kind: "notFound" as const };
            if (alreadyAddedBaleIds.has(bale.id)) return { kind: "skipDuplicate" as const };

            // Universal cross-order duplicate check: block if this bale is already in any other
            // active (non-CANCELLED) order regardless of V5/non-V5 type.
            const bulkCrossOrderCheck = await tx.execute(
              sql`SELECT cob.order_id FROM customer_order_bales cob
                  JOIN customer_orders co ON co.id = cob.order_id
                  WHERE cob.bale_id = ${bale.id}
                    AND co.status != 'CANCELLED'
                    AND cob.order_id != ${orderId}
                  LIMIT 1`,
            );
            const bulkCrossOrderRow = (bulkCrossOrderCheck as any).rows?.[0];
            if (bulkCrossOrderRow) return { kind: "notFound" as const };

            let priceUsed = "0";
            if (order.proformaIdUsed) {
              const [pl] = await tx.select().from(customerProformaLines)
                .where(and(
                  eq(customerProformaLines.proformaId, order.proformaIdUsed),
                  eq(customerProformaLines.articleCode, bale.articleCode || "")
                ));
              if (pl) {
                const pMode = (pl as any).pricingMode ?? 'per_bale';
                const pkgRate = parseFloat(String((pl as any).pricePerKg ?? '0'));
                if (pMode === 'per_kg' && pkgRate > 0) {
                  const baleWt = parseFloat(String(bale.weightKg || '0'));
                  priceUsed = (!isNaN(baleWt) ? baleWt * pkgRate : 0).toFixed(2);
                } else {
                  priceUsed = pl.pricePerBale;
                }
              }
            }
            if (priceUsed === "0" && bale.productId) {
              const product = allProducts.find((p: any) => p.id === bale.productId);
              if (product?.sellingPrice) priceUsed = product.sellingPrice;
            }

            const baleProductForName1 = bale.productId ? allProducts.find((p: any) => p.id === bale.productId) : null;

            await tx.insert(customerOrderBales).values({
              orderId,
              baleId: bale.id,
              baleReference: bale.referenceNumber,
              locationId: bale.erpLocationId ?? parsedLocationId,
              weight: bale.weightKg,
              articleCode: bale.articleCode,
              baleName: baleProductForName1?.name || bale.productName || bale.articleCode || bale.baleCode,
              priceUsed,
              scannedBy: scannerName,
            });

            // V5 guard: proformaIdUsed IS NOT NULL
            // V5 bales remain IN_STOCK during loading — only legacy V2/V3 orders set RESERVED_FOR_ORDER.
            if (!order.proformaIdUsed) {
              await tx.update(factoryBales)
                .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
                .where(eq(factoryBales.id, bale.id));
            }

            return { kind: "added" as const, baleId: bale.id };
          });

          if (refResult.kind === "notFound") { notFoundRefs.push(refNum); continue; }
          if (refResult.kind === "skipDuplicate") continue;
          alreadyAddedBaleIds.add(refResult.baleId);
          totalAdded++;
        }

        await recalculateOrderTotals(db, orderId);
        const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
        return res.json({ added: totalAdded, notFound: [], notFoundRefs, order: updatedOrder, bales: updatedBales });
      }

      // ── V5 cross-order block set (ARTICLE mode) ─────────────────────────────
      // V5 guard: proformaIdUsed IS NOT NULL
      // V5 bales remain IN_STOCK while loaded in other orders. Build a set of bale IDs already
      // claimed by other active (non-CANCELLED) V5 orders so they can be excluded during
      // auto-selection. One query covers all articles. Legacy orders skip this block entirely.
      const v5BlockedBaleIds = new Set<number>();
      if (order.proformaIdUsed) {
        const blockedRows = await db.execute(
          sql`SELECT cob.bale_id FROM customer_order_bales cob
              JOIN customer_orders co ON co.id = cob.order_id
              WHERE co.status != 'CANCELLED'
                AND cob.order_id != ${orderId}`,
        );
        for (const row of (blockedRows as any).rows ?? []) {
          v5BlockedBaleIds.add(row.bale_id);
        }
      }

      // ── ARTICLE-CODE MODE (existing) ────────────────────────────────────────
      for (const item of items) {
        const articleCode = String(item.articleCode || "").trim();
        const qty = parseInt(item.qty) || 0;
        if (!articleCode || qty <= 0) continue;

        const codeLower = articleCode.toLowerCase();

        // Find matching product IDs (by articleCode or name)
        const matchingProductIds = allProducts
          .filter(p =>
            (p.articleCode && p.articleCode.toLowerCase() === codeLower) ||
            (p.name && p.name.toLowerCase() === codeLower)
          )
          .map(p => p.id);

        // Build bale query conditions
        const matchConditions = matchingProductIds.length > 0
          ? or(
              sql`LOWER(${factoryBales.articleCode}) = ${codeLower}`,
              inArray(factoryBales.productId, matchingProductIds)
            )
          : sql`LOWER(${factoryBales.articleCode}) = ${codeLower}`;

        // Per-article tx: lock candidate bales with SELECT FOR UPDATE, filter
        // the locked set in-memory to drop already-claimed/cross-order ones,
        // then insert + status-update inside the same tx. Concurrent imports
        // for the same article will block at the lock and re-evaluate, so
        // they cannot grab the same physical bales.
        const articleResult = await db.transaction(async (tx: any) => {
          // Find available bales, oldest first
          const availableBales = await tx.select().from(factoryBales)
            .where(and(
              eq(factoryBales.companyId, companyId),
              eq(factoryBales.status, "IN_STOCK"),
              eq(factoryBales.erpLocationId, parsedLocationId),
              matchConditions
            ))
            .orderBy(factoryBales.createdAt)
            .limit(qty * 5)
            .for("update");

          // Filter out bales already in this order, or (V5 only) bales we
          // already know are claimed by another active order from the snapshot
          // taken before this tx. Note: the snapshot can be stale, so for V5
          // we re-verify each candidate inside the tx below before inserting.
          const candidateBales = availableBales.filter((b: any) =>
            !alreadyAddedBaleIds.has(b.id) && !v5BlockedBaleIds.has(b.id)
          );

          const addedIds: number[] = [];
          for (const bale of candidateBales) {
            if (addedIds.length >= qty) break;

            // V5 guard: proformaIdUsed IS NOT NULL
            // The outer v5BlockedBaleIds snapshot can race with concurrent V5
            // imports — re-verify inside the tx that no other active order
            // has linked this bale since we took the snapshot. Without this
            // recheck, two concurrent ARTICLE imports could both claim the
            // same V5 bale (V5 keeps bale IN_STOCK so the FOR UPDATE lock
            // alone does not block the second tx from picking it up).
            if (order.proformaIdUsed) {
              const v5DupCheck = await tx.execute(
                sql`SELECT cob.order_id FROM customer_order_bales cob
                    JOIN customer_orders co ON co.id = cob.order_id
                    WHERE cob.bale_id = ${bale.id}
                      AND co.status != 'CANCELLED'
                      AND cob.order_id != ${orderId}
                    LIMIT 1`,
              );
              if ((v5DupCheck as any).rows?.[0]) continue;
            }

            // Determine price
            let priceUsed = "0";
            if (order.proformaIdUsed) {
              const [pl] = await tx.select().from(customerProformaLines)
                .where(and(
                  eq(customerProformaLines.proformaId, order.proformaIdUsed),
                  eq(customerProformaLines.articleCode, bale.articleCode || "")
                ));
              if (pl) {
                const pMode = (pl as any).pricingMode ?? 'per_bale';
                const pkgRate = parseFloat(String((pl as any).pricePerKg ?? '0'));
                if (pMode === 'per_kg' && pkgRate > 0) {
                  const baleWt = parseFloat(String(bale.weightKg || '0'));
                  priceUsed = (!isNaN(baleWt) ? baleWt * pkgRate : 0).toFixed(2);
                } else {
                  priceUsed = pl.pricePerBale;
                }
              }
            }
            if (priceUsed === "0" && bale.productId) {
              const product = allProducts.find((p: any) => p.id === bale.productId);
              if (product?.sellingPrice) priceUsed = product.sellingPrice;
            }

            const baleProductForName2 = bale.productId ? allProducts.find((p: any) => p.id === bale.productId) : null;

            await tx.insert(customerOrderBales).values({
              orderId,
              baleId: bale.id,
              baleReference: bale.referenceNumber,
              locationId: parsedLocationId,
              weight: bale.weightKg,
              articleCode: bale.articleCode,
              baleName: baleProductForName2?.name || bale.productName || bale.articleCode || bale.baleCode,
              priceUsed,
              scannedBy: scannerName,
            });

            // V5 guard: proformaIdUsed IS NOT NULL
            // V5 bales remain IN_STOCK during loading — only legacy V2/V3 orders set RESERVED_FOR_ORDER.
            if (!order.proformaIdUsed) {
              await tx.update(factoryBales)
                .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
                .where(eq(factoryBales.id, bale.id));
            }

            addedIds.push(bale.id);
          }

          return addedIds;
        });

        if (articleResult.length < qty) {
          notFound.push({ articleCode, requestedQty: qty, foundQty: articleResult.length });
        }
        for (const id of articleResult) {
          alreadyAddedBaleIds.add(id);
          totalAdded++;
        }
      }

      await recalculateOrderTotals(db, orderId);

      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));

      res.json({ added: totalAdded, notFound, order: updatedOrder, bales: updatedBales });
    } catch (error: any) {
      console.error("Error bulk importing bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-orders/:id/bales/:baleId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const baleId = parseId(req.params.baleId);
      if (baleId === null) return res.status(400).json({ message: "Invalid id" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION", "VERIFIED", "FINALIZED"].includes(order.status)) return res.status(400).json({ message: "Can only remove bales from orders that are not yet cancelled" });

      const [orderBale] = await db.select().from(customerOrderBales)
        .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.id, baleId)));

      // Fetch full bale details before deleting the join row, so we can log it
      let baleDetails: typeof factoryBales.$inferSelect | undefined;
      if (orderBale) {
        const [found] = await db.select().from(factoryBales).where(eq(factoryBales.id, orderBale.baleId));
        baleDetails = found;
      }

      await db.delete(customerOrderBales)
        .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.id, baleId)));

      if (orderBale && baleDetails) {
        await db.update(factoryBales).set({ status: "IN_STOCK", updatedAt: new Date() }).where(eq(factoryBales.id, orderBale.baleId));

        // Log the removal so it's visible on the loading page
        const userId = req.user?.id ? String(req.user.id) : null;
        const username = req.user?.username || req.user?.email || null;
        await db.insert(customerOrderBaleRemovals).values({
          orderId,
          baleId: orderBale.baleId,
          referenceNumber: baleDetails.referenceNumber,
          articleCode: baleDetails.articleCode || null,
          productName: baleDetails.productName || null,
          weightKg: baleDetails.weightKg,
          removedByUserId: userId,
          removedByUsername: username,
        });
      } else if (orderBale) {
        await db.update(factoryBales).set({ status: "IN_STOCK", updatedAt: new Date() }).where(eq(factoryBales.id, orderBale.baleId));
      }

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error removing bale from order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/bales/:id/return-to-stock — remove a bale from its order and return it to stock
  // Works for any order status. For FINALIZED orders: updates customer_balances + daybook. Admin-gated.
  app.post("/api/factory/bales/:id/return-to-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const baleId = parseId(req.params.id);
      if (baleId === null) return res.status(400).json({ message: "Invalid bale id" });

      const userId = req.user?.id ? String(req.user.id) : null;
      const username = req.user?.username || req.user?.email || null;

      // 1. Find the bale
      const [bale] = await db.select().from(factoryBales)
        .where(and(eq(factoryBales.id, baleId), eq(factoryBales.companyId, companyId)));
      if (!bale) return res.status(404).json({ message: "Bale not found" });
      if (!["RESERVED_FOR_ORDER", "RESERVED", "SOLD"].includes(bale.status)) {
        return res.status(400).json({ message: `Bale is ${bale.status} — it is not allocated to an order` });
      }

      // 2. Find the customer_order_bales row
      const [orderBale] = await db.select().from(customerOrderBales)
        .where(eq(customerOrderBales.baleId, baleId));
      if (!orderBale) {
        // Bale has no order row — just flip it back to IN_STOCK
        await db.update(factoryBales).set({ status: "IN_STOCK", updatedAt: new Date() }).where(eq(factoryBales.id, baleId));
        return res.json({ message: "Bale returned to stock (no order link found)", orderId: null, orderStatus: null });
      }

      const orderId = orderBale.orderId;

      // 3. Fetch order
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Associated order not found" });

      // 4. Guard: cannot remove the LAST bale (order must be cancelled instead)
      const remainingBales = await db.select({ id: customerOrderBales.id })
        .from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (remainingBales.length <= 1) {
        return res.status(400).json({
          message: "This is the last bale in the order. Cancel the entire order instead of removing individual bales.",
          isLastBale: true,
        });
      }

      await db.transaction(async (tx: any) => {
        // 5. Remove from customer_order_bales
        await tx.delete(customerOrderBales).where(eq(customerOrderBales.id, orderBale.id));

        // 6. Return bale to IN_STOCK
        await tx.update(factoryBales)
          .set({ status: "IN_STOCK", updatedAt: new Date() })
          .where(eq(factoryBales.id, baleId));

        // 7. Audit log
        await tx.insert(customerOrderBaleRemovals).values({
          orderId,
          baleId,
          referenceNumber: bale.referenceNumber,
          articleCode: bale.articleCode || null,
          productName: bale.productName || null,
          weightKg: bale.weightKg,
          removedByUserId: userId,
          removedByUsername: username,
        });

        // 8. Recalculate order totals (regenerates order lines + grand total)
        await recalculateOrderTotals(tx, orderId);

        // 9. For FINALIZED orders: sync customer_balances + daybook INVOICE entry
        if (order.status === "FINALIZED") {
          const [recalcOrder] = await tx.select({ grandTotal: customerOrders.grandTotal })
            .from(customerOrders).where(eq(customerOrders.id, orderId));
          const newGrandTotal = parseFloat(recalcOrder?.grandTotal || "0");

          const [ledgerEntry] = await tx.select({ id: customerBalances.id })
            .from(customerBalances)
            .where(and(
              eq(customerBalances.companyId, companyId),
              eq(customerBalances.referenceType, "INVOICE"),
              eq(customerBalances.referenceId, orderId)
            ));
          if (ledgerEntry) {
            await tx.update(customerBalances)
              .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
              .where(eq(customerBalances.id, ledgerEntry.id));
          }

          const [daybookEntry] = await tx.select({ id: factoryDaybookEntries.id })
            .from(factoryDaybookEntries)
            .where(and(
              eq(factoryDaybookEntries.companyId, companyId),
              eq(factoryDaybookEntries.txType, "INVOICE"),
              eq(factoryDaybookEntries.referenceId, orderId)
            ));
          if (daybookEntry) {
            await tx.update(factoryDaybookEntries)
              .set({ amountCurrency: newGrandTotal, amountUsd: newGrandTotal })
              .where(eq(factoryDaybookEntries.id, daybookEntry.id));
          }
        }

        // 10. For VERIFIED orders: sync ORDER_VERIFIED daybook entry
        if (order.status === "VERIFIED") {
          const [recalcOrder] = await tx.select({ grandTotal: customerOrders.grandTotal })
            .from(customerOrders).where(eq(customerOrders.id, orderId));
          const newGrandTotal = parseFloat(recalcOrder?.grandTotal || "0");

          const [verifiedEntry] = await tx.select({ id: factoryDaybookEntries.id })
            .from(factoryDaybookEntries)
            .where(and(
              eq(factoryDaybookEntries.companyId, companyId),
              eq(factoryDaybookEntries.txType, "ORDER_VERIFIED"),
              eq(factoryDaybookEntries.referenceId, orderId)
            ));
          if (verifiedEntry) {
            await tx.update(factoryDaybookEntries)
              .set({ amountCurrency: newGrandTotal, amountUsd: newGrandTotal })
              .where(eq(factoryDaybookEntries.id, verifiedEntry.id));
          }
        }
      });

      // Return updated order info for the frontend to display
      const [finalOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      res.json({
        message: "Bale returned to stock",
        orderId,
        orderStatus: finalOrder?.status,
        invoiceNumber: finalOrder?.invoiceNumber,
        newGrandTotal: finalOrder?.grandTotal,
      });
    } catch (error: any) {
      console.error("Error returning bale to stock:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/bales/:id/order-info — get the order a bale is allocated to (for the confirmation dialog)
  app.get("/api/factory/bales/:id/order-info", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const baleId = parseId(req.params.id);
      if (baleId === null) return res.status(400).json({ message: "Invalid bale id" });

      const [orderBale] = await db.select().from(customerOrderBales)
        .where(eq(customerOrderBales.baleId, baleId));
      if (!orderBale) return res.json(null);

      const [order] = await db.select({
        id: customerOrders.id,
        status: customerOrders.status,
        invoiceNumber: customerOrders.invoiceNumber,
        grandTotal: customerOrders.grandTotal,
        customerName: customers.name,
        orderDate: customerOrders.orderDate,
        containerNumber: customerOrders.containerNumber,
        totalQtyBales: customerOrders.totalQtyBales,
      }).from(customerOrders)
        .leftJoin(customers, eq(customers.id, customerOrders.customerId))
        .where(and(eq(customerOrders.id, orderBale.orderId), eq(customerOrders.companyId, companyId)));

      if (!order) return res.json(null);

      // Count remaining bales so the frontend can warn if this is the last one
      const baleCount = await db.select({ count: sql<number>`count(*)` })
        .from(customerOrderBales).where(eq(customerOrderBales.orderId, order.id));
      const remainingCount = Number(baleCount[0]?.count ?? 0);

      res.json({ ...order, totalBalesInOrder: remainingCount });
    } catch (error: any) {
      console.error("Error fetching bale order info:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/bales/swap — swap a loaded bale (SOLD/RESERVED) with an IN_STOCK bale by reference number
  // The current bale is returned to stock; the replacement bale takes its place in the order.
  app.post("/api/factory/bales/swap", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { currentBaleRef, replacementBaleRef } = req.body;
      if (!currentBaleRef || !replacementBaleRef) {
        return res.status(400).json({ message: "Both currentBaleRef and replacementBaleRef are required" });
      }
      if (currentBaleRef.trim().toUpperCase() === replacementBaleRef.trim().toUpperCase()) {
        return res.status(400).json({ message: "Replacement bale must be different from the current bale" });
      }

      const userId = req.user?.id ? String(req.user.id) : null;
      const username = req.user?.username || req.user?.email || null;

      // 1. Find current bale
      const [currentBale] = await db.select().from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          ilike(factoryBales.referenceNumber, currentBaleRef.trim())
        ));
      if (!currentBale) return res.status(404).json({ message: `Bale "${currentBaleRef}" not found` });
      if (!["RESERVED_FOR_ORDER", "RESERVED", "SOLD"].includes(currentBale.status)) {
        return res.status(400).json({ message: `Bale "${currentBaleRef}" is ${currentBale.status} — it must be loaded in an order to be swapped` });
      }

      // 2. Find replacement bale
      const [replacementBale] = await db.select().from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          ilike(factoryBales.referenceNumber, replacementBaleRef.trim())
        ));
      if (!replacementBale) return res.status(404).json({ message: `Replacement bale "${replacementBaleRef}" not found` });
      if (replacementBale.status !== "IN_STOCK") {
        return res.status(400).json({ message: `Replacement bale "${replacementBaleRef}" is ${replacementBale.status} — it must be IN_STOCK to be used as a replacement` });
      }

      // 3. Find the customerOrderBales row for the current bale
      const [orderBale] = await db.select().from(customerOrderBales)
        .where(eq(customerOrderBales.baleId, currentBale.id));
      if (!orderBale) {
        // No order link — just flip current back to stock
        await db.update(factoryBales).set({ status: "IN_STOCK", updatedAt: new Date() }).where(eq(factoryBales.id, currentBale.id));
        return res.status(400).json({ message: "No order link found for the current bale" });
      }

      // 4. Find the order
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderBale.orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Associated order not found" });

      await db.transaction(async (tx: any) => {
        // 5. Update customerOrderBales to point to the replacement bale (keep priceUsed unchanged)
        await tx.update(customerOrderBales)
          .set({
            baleId: replacementBale.id,
            baleReference: replacementBale.referenceNumber,
            weight: replacementBale.weightKg,
            articleCode: replacementBale.articleCode || null,
            baleName: replacementBale.productName || null,
          })
          .where(eq(customerOrderBales.id, orderBale.id));

        // 6. Return current bale to IN_STOCK
        await tx.update(factoryBales)
          .set({ status: "IN_STOCK", updatedAt: new Date() })
          .where(eq(factoryBales.id, currentBale.id));

        // 7. Set replacement bale to the same status as the current bale
        await tx.update(factoryBales)
          .set({ status: currentBale.status, updatedAt: new Date() })
          .where(eq(factoryBales.id, replacementBale.id));

        // 8. Audit log
        await tx.insert(customerOrderBaleRemovals).values({
          orderId: order.id,
          baleId: currentBale.id,
          referenceNumber: currentBale.referenceNumber,
          articleCode: currentBale.articleCode || null,
          productName: currentBale.productName || null,
          weightKg: currentBale.weightKg,
          removedByUserId: userId,
          removedByUsername: username
            ? `${username} (swapped → ${replacementBale.referenceNumber})`
            : `swap → ${replacementBale.referenceNumber}`,
        });

        // 9. Recalculate order totals
        await recalculateOrderTotals(tx, order.id);

        // 10. For FINALIZED orders: sync customer_balances + daybook INVOICE entry
        if (order.status === "FINALIZED") {
          const [recalcOrder] = await tx.select({ grandTotal: customerOrders.grandTotal })
            .from(customerOrders).where(eq(customerOrders.id, order.id));
          const newGrandTotal = parseFloat(recalcOrder?.grandTotal || "0");

          const [ledgerEntry] = await tx.select({ id: customerBalances.id })
            .from(customerBalances)
            .where(and(
              eq(customerBalances.companyId, companyId),
              eq(customerBalances.referenceType, "INVOICE"),
              eq(customerBalances.referenceId, order.id)
            ));
          if (ledgerEntry) {
            await tx.update(customerBalances)
              .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
              .where(eq(customerBalances.id, ledgerEntry.id));
          }

          const [daybookEntry] = await tx.select({ id: factoryDaybookEntries.id })
            .from(factoryDaybookEntries)
            .where(and(
              eq(factoryDaybookEntries.companyId, companyId),
              eq(factoryDaybookEntries.txType, "INVOICE"),
              eq(factoryDaybookEntries.referenceId, order.id)
            ));
          if (daybookEntry) {
            await tx.update(factoryDaybookEntries)
              .set({ amountCurrency: newGrandTotal, amountUsd: newGrandTotal })
              .where(eq(factoryDaybookEntries.id, daybookEntry.id));
          }
        }

        // 11. For VERIFIED orders: sync ORDER_VERIFIED daybook entry
        if (order.status === "VERIFIED") {
          const [recalcOrder] = await tx.select({ grandTotal: customerOrders.grandTotal })
            .from(customerOrders).where(eq(customerOrders.id, order.id));
          const newGrandTotal = parseFloat(recalcOrder?.grandTotal || "0");

          const [verifiedEntry] = await tx.select({ id: factoryDaybookEntries.id })
            .from(factoryDaybookEntries)
            .where(and(
              eq(factoryDaybookEntries.companyId, companyId),
              eq(factoryDaybookEntries.txType, "ORDER_VERIFIED"),
              eq(factoryDaybookEntries.referenceId, order.id)
            ));
          if (verifiedEntry) {
            await tx.update(factoryDaybookEntries)
              .set({ amountCurrency: newGrandTotal, amountUsd: newGrandTotal })
              .where(eq(factoryDaybookEntries.id, verifiedEntry.id));
          }
        }
      });

      const [finalOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, order.id));
      res.json({
        message: "Bale swapped successfully",
        orderId: order.id,
        orderStatus: finalOrder?.status,
        invoiceNumber: finalOrder?.invoiceNumber,
        newGrandTotal: finalOrder?.grandTotal,
        replacedRef: currentBale.referenceNumber,
        replacementRef: replacementBale.referenceNumber,
      });
    } catch (error: any) {
      console.error("Error swapping bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/customer-orders/:id/bales/exchange — swap one bale for another on a FINALIZED order
  app.post("/api/factory/customer-orders/:id/bales/exchange", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { orderBaleId, newBaleReference } = req.body;
      if (!orderBaleId || !newBaleReference?.trim()) {
        return res.status(400).json({ message: "orderBaleId and newBaleReference are required" });
      }

      await db.transaction(async (tx: any) => {
        const [order] = await tx.select().from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
        if (!order) throw new Error("Order not found");
        if (!["FINALIZED", "VERIFIED"].includes(order.status)) {
          throw new Error("Bale exchange is only allowed on FINALIZED or VERIFIED orders");
        }

        // Find the customerOrderBales row to replace
        const [oldOrderBale] = await tx.select().from(customerOrderBales)
          .where(and(eq(customerOrderBales.id, orderBaleId), eq(customerOrderBales.orderId, orderId)));
        if (!oldOrderBale) throw new Error("Bale not found in this order");

        // Find the new bale in stock — FOR UPDATE prevents a concurrent
        // exchange or sale from grabbing the same physical bale.
        const newRef = newBaleReference.trim();
        const [newBale] = await tx.select().from(factoryBales)
          .where(and(
            eq(factoryBales.companyId, companyId),
            eq(factoryBales.status, "IN_STOCK"),
            or(
              eq(factoryBales.referenceNumber, newRef),
              eq(factoryBales.baleCode, newRef)
            )
          ))
          .for("update");
        if (!newBale) throw new Error(`Bale "${newRef}" not found in stock or not available`);

        // Resolve product name for new bale
        let newBaleName = newBale.productName || newBale.articleCode || newBale.baleCode || "";
        if (newBale.productId) {
          const [prod] = await tx.select({ name: factoryBaleProducts.name })
            .from(factoryBaleProducts).where(eq(factoryBaleProducts.id, newBale.productId));
          if (prod?.name) newBaleName = prod.name;
        }

        // Return old bale to stock
        await tx.update(factoryBales)
          .set({ status: "IN_STOCK", updatedAt: new Date() })
          .where(eq(factoryBales.id, oldOrderBale.baleId));

        // Remove old order bale row
        await tx.delete(customerOrderBales)
          .where(eq(customerOrderBales.id, orderBaleId));

        // Insert new order bale row (preserve price from the row being replaced)
        await tx.insert(customerOrderBales).values({
          orderId,
          baleId: newBale.id,
          baleReference: newBale.referenceNumber || newRef,
          locationId: oldOrderBale.locationId,
          weight: newBale.weightKg,
          articleCode: newBale.articleCode || oldOrderBale.articleCode,
          baleName: newBaleName || oldOrderBale.baleName,
          priceUsed: oldOrderBale.priceUsed,
        });

        // Mark new bale as sold (same status as other finalized bales)
        await tx.update(factoryBales)
          .set({ status: "SOLD", updatedAt: new Date() })
          .where(eq(factoryBales.id, newBale.id));

        await recalculateOrderTotals(tx, orderId);
      });

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));
      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges });
    } catch (error: any) {
      console.error("Exchange bale error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET removal log for a specific order/loading
  app.get("/api/factory/customer-orders/:id/bale-removals", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const orderId = parseId(req.params.id);
      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      const removals = await db.select().from(customerOrderBaleRemovals)
        .where(eq(customerOrderBaleRemovals.orderId, orderId))
        .orderBy(desc(customerOrderBaleRemovals.removedAt));
      res.json(removals);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/charges", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { name, amount, chargeType, ledgerAccountId } = req.body;
      if (!name || !amount) return res.status(400).json({ message: "name and amount are required" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const [newCharge] = await db.insert(customerOrderCharges).values({
        orderId,
        name,
        amount: String(amount),
        chargeType: chargeType || "OTHER",
        ledgerAccountId: ledgerAccountId ? parseInt(ledgerAccountId) : null,
      }).returning();

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      const resolvedLedgerAccountId = newCharge?.ledgerAccountId;
      const chargeAmt = parseFloat(String(amount) || "0");

      // Sync customerBalances ledger entry if the order is already finalized
      let chargeWarning: string | undefined;
      if (updatedOrder.status === "FINALIZED") {
        const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
        const [existingLedgerEntry] = await db.select({ id: customerBalances.id })
          .from(customerBalances)
          .where(and(
            eq(customerBalances.companyId, companyId),
            eq(customerBalances.referenceType, "INVOICE"),
            eq(customerBalances.referenceId, orderId)
          ));
        if (existingLedgerEntry) {
          await db.update(customerBalances)
            .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
            .where(eq(customerBalances.id, existingLedgerEntry.id));
        }

        // Create charge voucher (FINALIZED path)
        // Gate: charge must have a ledger account linked + charge amount > 0
        // invoiceNumber is optional — fall back to ORD-{id} so old orders aren't silently skipped
        if (newCharge && resolvedLedgerAccountId && chargeAmt > 0) {
          const [customer] = await db.select({ ledgerAccountId: customers.ledgerAccountId, legalName: customers.legalName })
            .from(customers).where(eq(customers.id, order.customerId));
          // Auto-create and link a ledger account for the customer if one doesn't exist
          let customerLedgerAccountId = customer?.ledgerAccountId;
          if (!customerLedgerAccountId) {
            const customerName = customer?.legalName || `Customer ${order.customerId}`;
            customerLedgerAccountId = await getOrCreateLedgerAccount(
              companyId, `CUST-${order.customerId}`, customerName, "Asset"
            );
            await db.update(customers)
              .set({ ledgerAccountId: customerLedgerAccountId })
              .where(eq(customers.id, order.customerId));
          }
          const voucherRef = updatedOrder.invoiceNumber || `ORD-${orderId}`;
          const chargeVoucherNumber = `CHARGE-${voucherRef}-${newCharge.id}-${Date.now()}`;
          const chargeDesc = order.containerNumber
            ? `${name} for offloaded container - ${order.containerNumber}`
            : `${name} - ${voucherRef}`;
          // Atomic: voucher + entries + FK stamp must all commit together
          await db.transaction(async (tx: any) => {
            const [chargeVoucher] = await tx.insert(vouchers).values({
              companyId,
              voucherType: "Journal",
              voucherNumber: chargeVoucherNumber,
              voucherDate: updatedOrder.orderDate || getClientDate(req),
              description: chargeDesc,
              totalAmount: String(chargeAmt),
              sourceModule: "FACTORY",
            }).returning();
            await tx.insert(voucherEntries).values({
              voucherId: chargeVoucher.id,
              ledgerAccountId: customerLedgerAccountId,
              customerId: order.customerId,
              debitAmount: String(chargeAmt),
              creditAmount: "0",
              narration: chargeDesc,
            });
            await tx.insert(voucherEntries).values({
              voucherId: chargeVoucher.id,
              ledgerAccountId: resolvedLedgerAccountId,
              debitAmount: "0",
              creditAmount: String(chargeAmt),
              narration: chargeDesc,
            });
            await tx.update(customerOrderCharges)
              .set({ voucherId: chargeVoucher.id })
              .where(eq(customerOrderCharges.id, newCharge.id));
          });
        } else if (newCharge && !resolvedLedgerAccountId && chargeAmt > 0) {
          chargeWarning = "Charge saved but no ledger entry was created — no ledger account was linked to this charge.";
        }
      }

      // Sync daybook INVOICE row with new grand total (FINALIZED path)
      if (updatedOrder.status === "FINALIZED") {
        const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
        const [daybookEntry] = await db.select({ id: factoryDaybookEntries.id })
          .from(factoryDaybookEntries)
          .where(and(
            eq(factoryDaybookEntries.companyId, companyId),
            eq(factoryDaybookEntries.txType, "INVOICE"),
            eq(factoryDaybookEntries.referenceId, orderId)
          ));
        if (daybookEntry) {
          await db.update(factoryDaybookEntries)
            .set({ amountCurrency: newGrandTotal, amountUsd: newGrandTotal })
            .where(eq(factoryDaybookEntries.id, daybookEntry.id));
        }
      }

      // Sync daybook ORDER_VERIFIED row with new grand total (VERIFIED path)
      if (updatedOrder.status === "VERIFIED") {
        const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
        const [verifiedDaybookEntry] = await db.select({ id: factoryDaybookEntries.id })
          .from(factoryDaybookEntries)
          .where(and(
            eq(factoryDaybookEntries.companyId, companyId),
            eq(factoryDaybookEntries.txType, "ORDER_VERIFIED"),
            eq(factoryDaybookEntries.referenceId, orderId)
          ));
        if (verifiedDaybookEntry) {
          await db.update(factoryDaybookEntries)
            .set({ amountCurrency: newGrandTotal, amountUsd: newGrandTotal })
            .where(eq(factoryDaybookEntries.id, verifiedDaybookEntry.id));
        }
      }

      // Create PRE-voucher when order is PENDING or VERIFIED (before finalization)
      // Uses naming CHARGE-PRE-{orderId}-{chargeId} — finalization will rename it to the
      // invoice-based name, so it is never double-counted.
      if (
        ["PENDING_VERIFICATION", "VERIFIED"].includes(updatedOrder.status) &&
        newCharge && resolvedLedgerAccountId && chargeAmt > 0
      ) {
        const [customer] = await db.select({ ledgerAccountId: customers.ledgerAccountId })
          .from(customers).where(eq(customers.id, order.customerId));
        if (customer?.ledgerAccountId) {
          const preVoucherNumber = `CHARGE-PRE-${orderId}-${newCharge.id}`;
          const chargeDesc = order.containerNumber
            ? `${name} for container - ${order.containerNumber}`
            : `${name} - Order #${orderId}`;
          // Phase 6: atomic — voucher + entries + FK stamp must all commit together
          // to avoid orphaned (unlinked) vouchers on mid-flight failure.
          await db.transaction(async (tx: any) => {
            const [chargeVoucher] = await tx.insert(vouchers).values({
              companyId,
              voucherType: "Journal",
              voucherNumber: preVoucherNumber,
              voucherDate: order.orderDate || getClientDate(req),
              description: chargeDesc,
              totalAmount: String(chargeAmt),
              sourceModule: "FACTORY",
            }).returning();
            await tx.insert(voucherEntries).values({
              voucherId: chargeVoucher.id,
              ledgerAccountId: customer.ledgerAccountId,
              customerId: order.customerId,
              debitAmount: String(chargeAmt),
              creditAmount: "0",
              narration: chargeDesc,
            });
            await tx.insert(voucherEntries).values({
              voucherId: chargeVoucher.id,
              ledgerAccountId: resolvedLedgerAccountId,
              debitAmount: "0",
              creditAmount: String(chargeAmt),
              narration: chargeDesc,
            });
            await tx.update(customerOrderCharges)
              .set({ voucherId: chargeVoucher.id })
              .where(eq(customerOrderCharges.id, newCharge.id));
          });
        }
      }

      res.json({ ...updatedOrder, charges: updatedCharges, warning: chargeWarning });
    } catch (error: any) {
      console.error("Error adding charge to order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Retroactively create missing ledger vouchers for charges that were saved without one
  app.post("/api/factory/customer-orders/:id/charges/relink-vouchers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);
      if (orderId === null) return res.status(400).json({ message: "Invalid id" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "FINALIZED") return res.status(400).json({ message: "Order is not finalized" });

      const [customer] = await db.select({ ledgerAccountId: customers.ledgerAccountId, legalName: customers.legalName })
        .from(customers).where(eq(customers.id, order.customerId));

      // Auto-create and link a ledger account for the customer if one doesn't exist yet
      let customerLedgerAccountId = customer?.ledgerAccountId;
      if (!customerLedgerAccountId) {
        const customerName = customer?.legalName || `Customer ${order.customerId}`;
        customerLedgerAccountId = await getOrCreateLedgerAccount(
          companyId,
          `CUST-${order.customerId}`,
          customerName,
          "Asset"
        );
        await db.update(customers)
          .set({ ledgerAccountId: customerLedgerAccountId })
          .where(eq(customers.id, order.customerId));
      }

      // Find all charges missing a voucher that have a ledger account linked
      const unlinkedCharges = await db.select().from(customerOrderCharges)
        .where(and(
          eq(customerOrderCharges.orderId, orderId),
          isNull(customerOrderCharges.voucherId),
        ));

      const chargesWithLedger = unlinkedCharges.filter(c => c.ledgerAccountId && parseFloat(c.amount || "0") > 0);
      if (chargesWithLedger.length === 0) {
        return res.json({ linked: 0, message: "All charges already have ledger entries — nothing to relink." });
      }

      const voucherRef = order.invoiceNumber || `ORD-${orderId}`;
      let linked = 0;

      for (const charge of chargesWithLedger) {
        const chargeAmt = parseFloat(charge.amount || "0");
        const chargeVoucherNumber = `CHARGE-${voucherRef}-${charge.id}-${Date.now()}`;
        const chargeDesc = order.containerNumber
          ? `${charge.name} for offloaded container - ${order.containerNumber}`
          : `${charge.name} - ${voucherRef}`;

        await db.transaction(async (tx: any) => {
          const [chargeVoucher] = await tx.insert(vouchers).values({
            companyId,
            voucherType: "Journal",
            voucherNumber: chargeVoucherNumber,
            voucherDate: order.orderDate || getClientDate(req),
            description: chargeDesc,
            totalAmount: String(chargeAmt),
            sourceModule: "FACTORY",
          }).returning();
          await tx.insert(voucherEntries).values({
            voucherId: chargeVoucher.id,
            ledgerAccountId: customerLedgerAccountId,
            customerId: order.customerId,
            debitAmount: String(chargeAmt),
            creditAmount: "0",
            narration: chargeDesc,
          });
          await tx.insert(voucherEntries).values({
            voucherId: chargeVoucher.id,
            ledgerAccountId: charge.ledgerAccountId,
            debitAmount: "0",
            creditAmount: String(chargeAmt),
            narration: chargeDesc,
          });
          await tx.update(customerOrderCharges)
            .set({ voucherId: chargeVoucher.id })
            .where(eq(customerOrderCharges.id, charge.id));
        });
        linked++;
      }

      res.json({ linked, message: `${linked} charge${linked !== 1 ? "s" : ""} successfully linked to the ledger.` });
    } catch (error: any) {
      console.error("Error relinking charge vouchers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/customer-orders/:id/charges/:chargeId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const chargeId = parseId(req.params.chargeId);
      if (chargeId === null) return res.status(400).json({ message: "Invalid id" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const { ledgerAccountId, amount, name } = req.body;
      const updateData: Record<string, unknown> = {};
      if (ledgerAccountId !== undefined) updateData.ledgerAccountId = ledgerAccountId ? parseInt(ledgerAccountId) : null;
      if (amount !== undefined) updateData.amount = parseFloat(amount).toFixed(2);
      if (name !== undefined) updateData.name = name;

      if (Object.keys(updateData).length === 0) return res.status(400).json({ message: "Nothing to update" });

      // Read the charge BEFORE update so we have the voucherId
      const [chargeBeforeUpdate] = await db.select()
        .from(customerOrderCharges)
        .where(and(eq(customerOrderCharges.orderId, orderId), eq(customerOrderCharges.id, chargeId)));
      if (!chargeBeforeUpdate) return res.status(404).json({ message: "Charge not found" });

      await db.transaction(async (tx: any) => {
        await tx.update(customerOrderCharges)
          .set(updateData)
          .where(and(eq(customerOrderCharges.orderId, orderId), eq(customerOrderCharges.id, chargeId)));

        await recalculateOrderTotals(tx, orderId);

        // If amount is changing on a FINALIZED invoice with a linked voucher, sync the voucher entries
        if (amount !== undefined && order.status === "FINALIZED" && chargeBeforeUpdate.voucherId) {
          const newAmt = parseFloat(amount);
          const linkedVoucherId = chargeBeforeUpdate.voucherId;

          // Update voucher header total
          await tx.update(vouchers)
            .set({ totalAmount: String(newAmt) })
            .where(eq(vouchers.id, linkedVoucherId));

          // Update the debit-side entry (customer account)
          await tx.update(voucherEntries)
            .set({ debitAmount: String(newAmt) })
            .where(and(
              eq(voucherEntries.voucherId, linkedVoucherId),
              sql`cast(${voucherEntries.debitAmount} as numeric) > 0`
            ));

          // Update the credit-side entry (charge ledger account)
          await tx.update(voucherEntries)
            .set({ creditAmount: String(newAmt) })
            .where(and(
              eq(voucherEntries.voucherId, linkedVoucherId),
              sql`cast(${voucherEntries.creditAmount} as numeric) > 0`
            ));
        }

        // PENDING_VERIFICATION / VERIFIED — update existing PRE-voucher amount on edit
        if (amount !== undefined && ["PENDING_VERIFICATION", "VERIFIED"].includes(order.status) && chargeBeforeUpdate.voucherId) {
          const newAmt = parseFloat(amount);
          const linkedVoucherId = chargeBeforeUpdate.voucherId;
          await tx.update(vouchers)
            .set({ totalAmount: String(newAmt) })
            .where(eq(vouchers.id, linkedVoucherId));
          await tx.update(voucherEntries)
            .set({ debitAmount: String(newAmt) })
            .where(and(
              eq(voucherEntries.voucherId, linkedVoucherId),
              sql`cast(${voucherEntries.debitAmount} as numeric) > 0`
            ));
          await tx.update(voucherEntries)
            .set({ creditAmount: String(newAmt) })
            .where(and(
              eq(voucherEntries.voucherId, linkedVoucherId),
              sql`cast(${voucherEntries.creditAmount} as numeric) > 0`
            ));
        }

        // If a ledger account is being assigned to a charge that has NO voucher yet,
        // create the accounting voucher retroactively now (handles old/legacy charges).
        const newLedgerAccountId = ledgerAccountId ? parseInt(ledgerAccountId) : null;
        if (
          newLedgerAccountId &&
          !chargeBeforeUpdate.voucherId &&
          ["PENDING_VERIFICATION", "VERIFIED", "FINALIZED"].includes(order.status)
        ) {
          const [updatedCharge] = await tx.select()
            .from(customerOrderCharges)
            .where(eq(customerOrderCharges.id, chargeId));
          const chargeAmt = parseFloat(updatedCharge?.amount || String(amount) || "0");
          if (chargeAmt > 0) {
            const [customer] = await tx.select({ ledgerAccountId: customers.ledgerAccountId })
              .from(customers).where(eq(customers.id, order.customerId));
            if (customer?.ledgerAccountId) {
              const isFinalized = order.status === "FINALIZED";
              const voucherNum = isFinalized && order.invoiceNumber
                ? `CHARGE-${order.invoiceNumber}-${chargeId}-${Date.now()}`
                : `CHARGE-PRE-${orderId}-${chargeId}`;
              const chargeDesc = order.containerNumber
                ? `${updatedCharge?.name || "Charge"} for container - ${order.containerNumber}`
                : `${updatedCharge?.name || "Charge"} - Order #${orderId}`;
              const [chargeVoucher] = await tx.insert(vouchers).values({
                companyId,
                voucherType: "Journal",
                voucherNumber: voucherNum,
                voucherDate: order.orderDate || getClientDate(req),
                description: chargeDesc,
                totalAmount: String(chargeAmt),
                sourceModule: "FACTORY",
              }).returning();
              await tx.insert(voucherEntries).values({
                voucherId: chargeVoucher.id,
                ledgerAccountId: customer.ledgerAccountId,
                customerId: order.customerId,
                debitAmount: String(chargeAmt),
                creditAmount: "0",
                narration: chargeDesc,
              });
              await tx.insert(voucherEntries).values({
                voucherId: chargeVoucher.id,
                ledgerAccountId: newLedgerAccountId,
                debitAmount: "0",
                creditAmount: String(chargeAmt),
                narration: chargeDesc,
              });
              await tx.update(customerOrderCharges)
                .set({ voucherId: chargeVoucher.id })
                .where(eq(customerOrderCharges.id, chargeId));
            }
          }
        }

        // If order is FINALIZED, sync customerBalances and daybook with new grand total
        if (order.status === "FINALIZED" && amount !== undefined) {
          const [recalcOrder] = await tx.select({ grandTotal: customerOrders.grandTotal })
            .from(customerOrders).where(eq(customerOrders.id, orderId));
          const newGrandTotal = parseFloat(recalcOrder?.grandTotal || "0");

          const [existingLedgerEntry] = await tx.select({ id: customerBalances.id })
            .from(customerBalances)
            .where(and(
              eq(customerBalances.companyId, companyId),
              eq(customerBalances.referenceType, "INVOICE"),
              eq(customerBalances.referenceId, orderId)
            ));
          if (existingLedgerEntry) {
            await tx.update(customerBalances)
              .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
              .where(eq(customerBalances.id, existingLedgerEntry.id));
          }

          const [daybookEntry] = await tx.select({ id: factoryDaybookEntries.id })
            .from(factoryDaybookEntries)
            .where(and(
              eq(factoryDaybookEntries.companyId, companyId),
              eq(factoryDaybookEntries.txType, "INVOICE"),
              eq(factoryDaybookEntries.referenceId, orderId)
            ));
          if (daybookEntry) {
            await tx.update(factoryDaybookEntries)
              .set({ amountCurrency: newGrandTotal, amountUsd: newGrandTotal })
              .where(eq(factoryDaybookEntries.id, daybookEntry.id));
          }
        }

        // Sync daybook ORDER_VERIFIED entry when charge amount edited on a VERIFIED order
        if (order.status === "VERIFIED" && amount !== undefined) {
          const [recalcOrder] = await tx.select({ grandTotal: customerOrders.grandTotal })
            .from(customerOrders).where(eq(customerOrders.id, orderId));
          const newGrandTotal = parseFloat(recalcOrder?.grandTotal || "0");
          const [verifiedDaybookEntry] = await tx.select({ id: factoryDaybookEntries.id })
            .from(factoryDaybookEntries)
            .where(and(
              eq(factoryDaybookEntries.companyId, companyId),
              eq(factoryDaybookEntries.txType, "ORDER_VERIFIED"),
              eq(factoryDaybookEntries.referenceId, orderId)
            ));
          if (verifiedDaybookEntry) {
            await tx.update(factoryDaybookEntries)
              .set({ amountCurrency: newGrandTotal, amountUsd: newGrandTotal })
              .where(eq(factoryDaybookEntries.id, verifiedDaybookEntry.id));
          }
        }
      });

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, charges: updatedCharges });
    } catch (error: any) {
      console.error("[PATCH charge]", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-orders/:id/charges/:chargeId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const chargeId = parseId(req.params.chargeId);
      if (chargeId === null) return res.status(400).json({ message: "Invalid id" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      // Phase 6: read FK linkage BEFORE deleting the charge so we can drop the linked voucher precisely
      const [chargeRow] = await db.select({ voucherId: customerOrderCharges.voucherId })
        .from(customerOrderCharges)
        .where(and(eq(customerOrderCharges.orderId, orderId), eq(customerOrderCharges.id, chargeId)));
      const linkedVoucherId = chargeRow?.voucherId ?? null;

      await db.delete(customerOrderCharges)
        .where(and(eq(customerOrderCharges.orderId, orderId), eq(customerOrderCharges.id, chargeId)));

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      // Phase 6: prefer FK-based delete; fall back to voucherNumber pattern for legacy unbacked rows
      let chargeVoucherIdsToDelete: number[] = [];
      if (linkedVoucherId) {
        chargeVoucherIdsToDelete.push(linkedVoucherId);
      } else {
        // Legacy fallback: PRE-voucher pattern + invoice-number pattern
        const legacyPatterns: string[] = [`CHARGE-PRE-${orderId}-${chargeId}`];
        if (order.invoiceNumber) legacyPatterns.push(`CHARGE-${order.invoiceNumber}-${chargeId}-%`);
        const legacyMatches = await db.select({ id: vouchers.id, voucherNumber: vouchers.voucherNumber })
          .from(vouchers)
          .where(and(
            eq(vouchers.companyId, companyId),
            sql`(${vouchers.voucherNumber} = ${legacyPatterns[0]}${
              legacyPatterns.length > 1 ? sql` OR ${vouchers.voucherNumber} LIKE ${legacyPatterns[1]}` : sql``
            })`,
          ));
        chargeVoucherIdsToDelete = legacyMatches.map((v: any) => v.id);
      }

      if (chargeVoucherIdsToDelete.length > 0) {
        await db.delete(voucherEntries).where(inArray(voucherEntries.voucherId, chargeVoucherIdsToDelete));
        await db.update(vouchers).set({ deletedAt: new Date() }).where(inArray(vouchers.id, chargeVoucherIdsToDelete));
      }

      // Sync customerBalances ledger entry if the order is already finalized
      if (updatedOrder.status === "FINALIZED") {
        const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
        const [existingLedgerEntry] = await db.select({ id: customerBalances.id })
          .from(customerBalances)
          .where(and(
            eq(customerBalances.companyId, companyId),
            eq(customerBalances.referenceType, "INVOICE"),
            eq(customerBalances.referenceId, orderId)
          ));
        if (existingLedgerEntry) {
          await db.update(customerBalances)
            .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
            .where(eq(customerBalances.id, existingLedgerEntry.id));
        }
      }

      // Sync daybook ORDER_VERIFIED entry when a charge is deleted from a VERIFIED order
      if (updatedOrder.status === "VERIFIED") {
        const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
        const [verifiedDaybookEntry] = await db.select({ id: factoryDaybookEntries.id })
          .from(factoryDaybookEntries)
          .where(and(
            eq(factoryDaybookEntries.companyId, companyId),
            eq(factoryDaybookEntries.txType, "ORDER_VERIFIED"),
            eq(factoryDaybookEntries.referenceId, orderId)
          ));
        if (verifiedDaybookEntry) {
          await db.update(factoryDaybookEntries)
            .set({ amountCurrency: newGrandTotal, amountUsd: newGrandTotal })
            .where(eq(factoryDaybookEntries.id, verifiedDaybookEntry.id));
        }
      }

      res.json({ ...updatedOrder, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error removing charge from order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Link a proforma to an existing unlinked LOADING order (V5 backfill support).
  // V5 guard: sets proforma_id_used and backfills customer_order_expected_lines.
  // Rules: order must be LOADING and currently unlinked (proforma_id_used IS NULL).
  //        proforma must be active and belong to the same company.
  //        customer must match if both order and proforma have a customer_id.
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
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      // Must be a LOADING order
      if (order.status !== "LOADING")
        return res.status(400).json({ message: "Can only link a proforma to a LOADING order" });

      // Always wipe existing expected lines so we start fresh
      await db.execute(sql`DELETE FROM customer_order_expected_lines WHERE order_id = ${orderId}`);

      if (isUnlink) {
        // Unlink: clear proformaIdUsed and expected lines (already deleted above)
        await db.update(customerOrders)
          .set({ proformaIdUsed: null })
          .where(eq(customerOrders.id, orderId));
        return res.json({ success: true, linked: { orderId, proformaId: null, linesBackfilled: 0 } });
      }

      // Confirm proforma exists for this company
      const [proforma] = await db.select().from(customerProformas)
        .where(and(eq(customerProformas.id, proformaIdInt!), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      // Proforma must be active
      if (!proforma.isActive)
        return res.status(400).json({ message: "Proforma is not active" });

      // Customer match check — reject if both sides have a customerId and they differ
      if (order.customerId && proforma.customerId && order.customerId !== proforma.customerId)
        return res.status(400).json({
          message: `Customer mismatch: order belongs to customer #${order.customerId} but proforma belongs to customer #${proforma.customerId}. Cannot link.`,
        });

      // Fetch proforma lines for expected-lines backfill
      const proformaLines = await db.select().from(customerProformaLines)
        .where(eq(customerProformaLines.proformaId, proformaIdInt!));

      // Link the order → proforma (re-link allowed: replaces any previous proforma)
      await db.update(customerOrders)
        .set({ proformaIdUsed: proformaIdInt })
        .where(eq(customerOrders.id, orderId));

      // Insert expected lines from the new proforma
      if (proformaLines.length > 0) {
        await db.execute(
          sql`INSERT INTO customer_order_expected_lines
                (company_id, order_id, proforma_id, proforma_line_id, article_code, product_name, expected_qty)
              SELECT ${companyId}, ${orderId}, cpl.proforma_id, cpl.id,
                     cpl.article_code, cpl.product_name, cpl.quantity
              FROM customer_proforma_lines cpl
              WHERE cpl.proforma_id = ${proformaIdInt}
              ON CONFLICT (order_id, article_code) DO NOTHING`,
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

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Loading not found" });

      const [updated] = await db.update(customerOrders)
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
        const [order] = await tx.select().from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId), isNull(customerOrders.deletedAt)));
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
          await tx.update(factoryBales).set({ status: "IN_STOCK", updatedAt: new Date() }).where(eq(factoryBales.id, b.baleId));
        }

        await tx.update(customerOrders)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(customerOrders.id, orderId));
      });

      res.json({ success: true, message: "Invoice moved to Deleted Items" });
    } catch (error: any) {
      console.error("Error deleting customer order:", error);
      res.status(500).json({ message: error.message });
    }
  });

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

  app.post("/api/factory/customer-orders/:id/reprice", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION", "VERIFIED", "FINALIZED"].includes(order.status)) {
        return res.status(400).json({ message: "Cannot reprice a cancelled order" });
      }

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.status(400).json({ message: "Order has no bales to reprice" });

      // "Apply Current Prices" = use the CURRENT catalogue selling price as primary source.
      // Proforma price is only a fallback if no catalogue price is found for that article.

      // 1. Collect all unique article codes and bale IDs from this order
      const articleCodes = [...new Set(orderBales.map(b => b.articleCode).filter(Boolean) as string[])];
      const baleIds      = [...new Set(orderBales.map(b => b.baleId).filter(Boolean))];

      // 2a. Bulk-fetch current selling prices by article code (primary path)
      const cataloguePriceMap = new Map<string, string>(); // lowerArticleCode → sellingPrice
      if (articleCodes.length > 0) {
        const catalogueRows = await db
          .select({ articleCode: factoryBaleProducts.articleCode, sellingPrice: factoryBaleProducts.sellingPrice })
          .from(factoryBaleProducts)
          .where(and(
            eq(factoryBaleProducts.companyId, companyId),
            inArray(factoryBaleProducts.articleCode, articleCodes),
          ));
        for (const r of catalogueRows) {
          if (r.articleCode && r.sellingPrice != null) {
            cataloguePriceMap.set(r.articleCode.toLowerCase().trim(), r.sellingPrice);
          }
        }
      }

      // 2b. Fallback: also pull prices via factoryBales.productId chain
      //     This covers cases where the article code in the bale doesn't match the catalogue entry.
      const baleIdPriceMap = new Map<number, string>(); // baleId → sellingPrice
      if (baleIds.length > 0) {
        const chainRows = await db
          .select({ baleId: factoryBales.id, sellingPrice: factoryBaleProducts.sellingPrice })
          .from(factoryBales)
          .innerJoin(factoryBaleProducts, eq(factoryBaleProducts.id, factoryBales.productId))
          .where(inArray(factoryBales.id, baleIds));
        for (const r of chainRows) {
          if (r.baleId && r.sellingPrice != null) {
            baleIdPriceMap.set(r.baleId, r.sellingPrice);
          }
        }
      }

      // 3. Proforma prices as fallback for articles not in catalogue
      const proformaMap = new Map<string, string>();
      if (order.proformaIdUsed) {
        const proformaLines = await db.select().from(customerProformaLines)
          .where(eq(customerProformaLines.proformaId, order.proformaIdUsed));
        for (const pl of proformaLines) {
          if (pl.articleCode) proformaMap.set(pl.articleCode.toLowerCase(), pl.pricePerBale);
        }
      }

      let updated = 0;
      for (const bale of orderBales) {
        const codeKey = bale.articleCode?.toLowerCase().trim();
        // Priority 1: catalogue price by article code
        // Priority 2: catalogue price via bale→product chain (baleId lookup)
        // Priority 3: proforma price
        const rawPrice = (codeKey && cataloguePriceMap.has(codeKey))
          ? cataloguePriceMap.get(codeKey)!
          : (bale.baleId && baleIdPriceMap.has(bale.baleId))
            ? baleIdPriceMap.get(bale.baleId)!
            : (codeKey && proformaMap.has(codeKey))
              ? proformaMap.get(codeKey)!
              : null;

        if (rawPrice === null) continue;

        // Normalise to 2-decimal string to avoid "40" vs "40.00" false-positives
        const newPriceNum  = parseFloat(rawPrice);
        const curPriceNum  = parseFloat(bale.priceUsed || "0");

        // Skip if catalogue price is 0 (not yet set) or if already identical
        if (newPriceNum <= 0) continue;
        if (Math.abs(newPriceNum - curPriceNum) < 0.001) continue;

        await db.update(customerOrderBales)
          .set({ priceUsed: newPriceNum.toFixed(2) })
          .where(eq(customerOrderBales.id, bale.id));
        updated++;
      }

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));

      // Sync the customerBalances ledger entry so the customer's balance reflects the new grand total.
      // The entry is inserted at finalization time; repricing must keep it in sync.
      const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
      const [existingLedgerEntry] = await db
        .select({ id: customerBalances.id })
        .from(customerBalances)
        .where(and(
          eq(customerBalances.companyId, companyId),
          eq(customerBalances.referenceType, "INVOICE"),
          eq(customerBalances.referenceId, orderId)
        ));
      if (existingLedgerEntry) {
        await db
          .update(customerBalances)
          .set({
            debitAmount: String(newGrandTotal),
            balance: String(newGrandTotal),
          })
          .where(eq(customerBalances.id, existingLedgerEntry.id));
      }

      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges, repriced: updated });
    } catch (error: any) {
      console.error("Error repricing order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Apply PRODUCTION prices to all bales in this order
  app.post("/api/factory/customer-orders/:id/reprice-production", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status === "CANCELLED") return res.status(400).json({ message: "Cannot reprice a cancelled order" });

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.status(400).json({ message: "Order has no bales to reprice" });

      // Collect unique article codes and bale IDs
      const articleCodes = [...new Set(orderBales.map(b => b.articleCode).filter(Boolean) as string[])];
      const baleIds      = [...new Set(orderBales.map(b => b.baleId).filter(Boolean))];

      // Lookup production prices by article code
      const catalogueProdMap = new Map<string, string>();
      if (articleCodes.length > 0) {
        const catRows = await db
          .select({ articleCode: factoryBaleProducts.articleCode, productionPrice: factoryBaleProducts.productionPrice })
          .from(factoryBaleProducts)
          .where(and(
            eq(factoryBaleProducts.companyId, companyId),
            inArray(factoryBaleProducts.articleCode, articleCodes),
          ));
        for (const r of catRows) {
          if (r.articleCode && r.productionPrice != null) {
            catalogueProdMap.set(r.articleCode.toLowerCase().trim(), r.productionPrice);
          }
        }
      }

      // Fallback: via baleId → product chain
      const baleIdProdMap = new Map<number, string>();
      if (baleIds.length > 0) {
        const chainRows = await db
          .select({ baleId: factoryBales.id, productionPrice: factoryBaleProducts.productionPrice })
          .from(factoryBales)
          .innerJoin(factoryBaleProducts, eq(factoryBaleProducts.id, factoryBales.productId))
          .where(inArray(factoryBales.id, baleIds));
        for (const r of chainRows) {
          if (r.baleId && r.productionPrice != null) {
            baleIdProdMap.set(r.baleId, r.productionPrice);
          }
        }
      }

      let updated = 0;
      for (const bale of orderBales) {
        const codeKey = bale.articleCode?.toLowerCase().trim();
        const rawPrice = (codeKey && catalogueProdMap.has(codeKey))
          ? catalogueProdMap.get(codeKey)!
          : (bale.baleId && baleIdProdMap.has(bale.baleId))
            ? baleIdProdMap.get(bale.baleId)!
            : null;

        if (rawPrice === null) continue;
        const newPriceNum = parseFloat(rawPrice);
        if (newPriceNum <= 0) continue;
        const curPriceNum = parseFloat(bale.priceUsed || "0");
        if (Math.abs(newPriceNum - curPriceNum) < 0.001) continue;

        await db.update(customerOrderBales)
          .set({ priceUsed: newPriceNum.toFixed(2) })
          .where(eq(customerOrderBales.id, bale.id));
        updated++;
      }

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));

      // Keep ledger in sync if already finalized
      const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
      const [existingLedgerEntry] = await db
        .select({ id: customerBalances.id })
        .from(customerBalances)
        .where(and(
          eq(customerBalances.companyId, companyId),
          eq(customerBalances.referenceType, "INVOICE"),
          eq(customerBalances.referenceId, orderId)
        ));
      if (existingLedgerEntry) {
        await db.update(customerBalances)
          .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
          .where(eq(customerBalances.id, existingLedgerEntry.id));
      }

      const updatedBales   = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const updatedLines   = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges, repriced: updated });
    } catch (error: any) {
      console.error("Error repricing order with production prices:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Apply a specific proforma's prices to all bales in an order (by articleCode match)
  app.post("/api/factory/customer-orders/:id/apply-proforma-prices", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { proformaId } = req.body;
      if (!proformaId) return res.status(400).json({ message: "proformaId is required" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status === "CANCELLED") return res.status(400).json({ message: "Cannot reprice a cancelled order" });

      // Validate proforma belongs to this company
      const [proforma] = await db.select().from(customerProformas)
        .where(and(eq(customerProformas.id, proformaId), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      const proformaLines = await db.select().from(customerProformaLines)
        .where(eq(customerProformaLines.proformaId, proformaId));

      if (proformaLines.length === 0) return res.status(400).json({ message: "Selected proforma has no price lines" });

      // Build articleCode → price map from proforma
      const priceMap = new Map<string, string>();
      for (const pl of proformaLines) {
        if (pl.articleCode && pl.pricePerBale != null) {
          priceMap.set(pl.articleCode.toLowerCase().trim(), pl.pricePerBale);
        }
      }

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.status(400).json({ message: "Order has no bales" });

      let updated = 0;
      for (const bale of orderBales) {
        const key = bale.articleCode?.toLowerCase().trim();
        if (!key) continue;
        const newPrice = priceMap.get(key);
        if (!newPrice) continue;
        const newPriceNum = parseFloat(newPrice);
        if (newPriceNum <= 0) continue;
        const curPriceNum = parseFloat(bale.priceUsed || "0");
        if (Math.abs(newPriceNum - curPriceNum) < 0.001) continue;

        await db.update(customerOrderBales)
          .set({ priceUsed: newPriceNum.toFixed(2) })
          .where(eq(customerOrderBales.id, bale.id));
        updated++;
      }

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));

      // Keep customer balance ledger entry in sync if already finalized entry exists
      const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
      const [existingLedgerEntry] = await db
        .select({ id: customerBalances.id })
        .from(customerBalances)
        .where(and(
          eq(customerBalances.companyId, companyId),
          eq(customerBalances.referenceType, "INVOICE"),
          eq(customerBalances.referenceId, orderId)
        ));
      if (existingLedgerEntry) {
        await db.update(customerBalances)
          .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
          .where(eq(customerBalances.id, existingLedgerEntry.id));
      }

      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges, repriced: updated });
    } catch (error: any) {
      console.error("Error applying proforma prices:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/customer-orders/:id/bales/reprice-article", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { articleCode, pricePerBale } = req.body;

      if (!articleCode || pricePerBale === undefined || pricePerBale === null) {
        return res.status(400).json({ message: "articleCode and pricePerBale are required" });
      }

      const price = parseFloat(pricePerBale);
      if (isNaN(price) || price < 0) {
        return res.status(400).json({ message: "Invalid price value" });
      }

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      await db.update(customerOrderBales)
        .set({ priceUsed: String(price) })
        .where(and(
          eq(customerOrderBales.orderId, orderId),
          eq(customerOrderBales.articleCode, articleCode)
        ));

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));

      const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
      const [existingLedgerEntry] = await db
        .select({ id: customerBalances.id })
        .from(customerBalances)
        .where(and(
          eq(customerBalances.companyId, companyId),
          eq(customerBalances.referenceType, "INVOICE"),
          eq(customerBalances.referenceId, orderId)
        ));
      if (existingLedgerEntry) {
        await db
          .update(customerBalances)
          .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
          .where(eq(customerBalances.id, existingLedgerEntry.id));
      }

      res.json(updatedOrder);
    } catch (error: any) {
      console.error("Error repricing article:", error);
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
  app.get("/api/factory/customer-orders/:id/export/excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(orderId)) return res.status(400).json({ message: "Invalid order ID" });

      const { hideSelling: hideSellingXls1 } = await getExportPriceVisibility(req);

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId));
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));

      const baleLinks = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const baleIds = baleLinks.map((b: any) => b.baleId).filter(Boolean);
      const baleRows: any[] = baleIds.length > 0
        ? await db.select().from(factoryBales).where(inArray(factoryBales.id, baleIds))
        : [];
      const orderCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      const productIds = [...new Set(baleRows.map((b: any) => b.productId).filter((id: any) => id != null))];
      const productRecords: any[] = productIds.length > 0
        ? await db.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds as number[]))
        : [];
      const productMap = new Map<number, any>(productRecords.map((p: any) => [p.id, p]));
      const balePriceMap = new Map<number, number>(baleLinks.map((l: any) => [l.baleId, parseFloat(l.priceUsed || "0")]));

      // Also read order lines for pricing mode metadata
      const orderLinesForXls = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const orderLinePricingMap = new Map<string, { pricingMode: string; pricePerKg: number }>();
      for (const ol of orderLinesForXls) {
        orderLinePricingMap.set((ol.articleCode || "").toLowerCase(), {
          pricingMode: (ol as any).pricingMode || 'per_bale',
          pricePerKg: parseFloat((ol as any).pricePerKg || "0"),
        });
      }

      // Group bales by product article code
      interface ProductGroup {
        articleCode: string;
        productName: string;
        qty: number;
        wtPerBale: number;
        totalWt: number;
        pricePerBale: number;
        total: number;
        pricingMode: string;
        pricePerKg: number;
      }
      const grouped = new Map<string, ProductGroup>();
      for (const bale of baleRows) {
        const product = productMap.get(bale.productId);
        const articleCode = product?.articleCode || bale.articleCode || "UNKNOWN";
        const productName = product?.name || bale.productName || articleCode;
        const wtPerBale = parseFloat(product?.weightPerBaleKg || bale.weightKg || "0");
        const price = balePriceMap.get(bale.id) || 0;
        const pricingInfo = orderLinePricingMap.get(articleCode.toLowerCase()) || { pricingMode: 'per_bale', pricePerKg: 0 };
        if (!grouped.has(articleCode)) {
          grouped.set(articleCode, { articleCode, productName, qty: 0, wtPerBale, totalWt: 0, pricePerBale: price, total: 0, pricingMode: pricingInfo.pricingMode, pricePerKg: pricingInfo.pricePerKg });
        }
        const g = grouped.get(articleCode)!;
        g.qty += 1;
        g.totalWt += parseFloat(bale.weightKg || wtPerBale.toString());
        g.total += price;
      }

      const lines = Array.from(grouped.values()).sort((a, b) => a.articleCode.localeCompare(b.articleCode));
      const anyPerKgXls1 = lines.some(l => l.pricingMode === 'per_kg');

      // Currency
      const baseCurrency = (company as any)?.baseCurrency || "USD";
      const currencySymbolMap: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", CFA: "CFA", XOF: "CFA", XAF: "CFA" };
      const currSym = currencySymbolMap[baseCurrency.toUpperCase()] ?? baseCurrency;
      const fmtMoney = (n: number) => `${currSym}${n % 1 === 0 ? n.toLocaleString() : n.toFixed(2)}`;
      const fmtNum = (n: number) => n % 1 === 0 ? n.toLocaleString() : n.toFixed(2);

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Commercial Invoice");
      const COL = 8;

      sheet.columns = [
        { key: "c1", width: 6 },
        { key: "c2", width: 16 },
        { key: "c3", width: 30 },
        { key: "c4", width: 8 },
        { key: "c5", width: 11 },
        { key: "c6", width: 13 },
        { key: "c7", width: 13 },
        { key: "c8", width: 14 },
      ];

      const DARK_BLUE = "FF1F3864";
      const LIGHT_GRAY = "FFF5F5F5";
      const WHITE = "FFFFFFFF";
      const GOLD = "FFD4AF37";

      const merge = (r: number, c1: number, c2: number) => sheet.mergeCells(r, c1, r, c2);
      const setFill = (cell: any, argb: string) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } }; };
      const setBorder = (row: any) => {
        row.eachCell((cell: any) => {
          cell.border = {
            top: { style: "thin", color: { argb: "FFDDDDDD" } },
            bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
            left: { style: "thin", color: { argb: "FFDDDDDD" } },
            right: { style: "thin", color: { argb: "FFDDDDDD" } },
          };
        });
      };

      // ── Logo row ──
      const logoRow = sheet.addRow([]);
      logoRow.height = 110;
      try {
        const logoPath = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(logoPath)) {
          const logoBuf = fs.readFileSync(logoPath);
          const logoId = workbook.addImage({ buffer: logoBuf as Buffer, extension: "jpeg" });
          sheet.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 180, height: 110 } });
        }
      } catch {}

      // ── Company name ──
      const r1 = sheet.addRow(["HMD INTERNATIONAL GROUP"]);
      r1.height = 26;
      r1.getCell(1).font = { bold: true, size: 16, color: { argb: DARK_BLUE } };
      r1.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      merge(r1.number, 1, COL);

      // ── "Commercial Invoice" title ──
      const r2 = sheet.addRow(["Commercial Invoice"]);
      r2.height = 22;
      r2.getCell(1).font = { bold: true, size: 14, color: { argb: DARK_BLUE } };
      r2.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      merge(r2.number, 1, COL);
      sheet.addRow([]);

      // ── Invoice details (right-aligned block) ──
      const invoiceNum = order.invoiceNumber || `INV-${String(orderId).padStart(6, "0")}`;
      const orderDateFmt = order.orderDate
        ? new Date(order.orderDate).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" })
        : "-";

      const details = [
        ["Invoice No.", invoiceNum],
        ["Customer", customer?.legalName || "-"],
        ["Date", orderDateFmt],
        ["Container", order.containerNumber || "-"],
      ];
      for (const [label, value] of details) {
        const dr = sheet.addRow(["", "", "", "", "", label, "", value]);
        dr.height = 20;
        dr.getCell(6).font = { bold: true, size: 11 };
        dr.getCell(6).alignment = { horizontal: "right" };
        dr.getCell(8).font = { size: 11 };
        dr.getCell(8).alignment = { horizontal: "left" };
        merge(dr.number, 6, 7);
      }
      sheet.addRow([]);

      // ── Table header ──
      const unitPriceLabelXls1 = anyPerKgXls1 ? "Price/KG" : "Price/Bale";
      const hdrRow = sheet.addRow(["#", "Article Code", "Product", "Qty", "Wt/Bale", "Total Wt", ...(hideSellingXls1 ? [] : [unitPriceLabelXls1, "Total"])]);
      hdrRow.height = 24;
      hdrRow.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
        setFill(cell, DARK_BLUE);
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { top: { style: "thin", color: { argb: WHITE } }, bottom: { style: "thin", color: { argb: WHITE } }, left: { style: "thin", color: { argb: WHITE } }, right: { style: "thin", color: { argb: WHITE } } };
      });

      // ── Data rows ──
      let totalQty = 0, totalWtAll = 0, totalAll = 0;
      lines.forEach((g, idx) => {
        totalQty += g.qty;
        totalWtAll += g.totalWt;
        totalAll += g.total;
        const unitPriceXls1 = g.pricingMode === 'per_kg'
          ? (g.totalWt > 0 ? g.total / g.totalWt : g.pricePerKg)
          : g.pricePerBale;
        const rowCells: any[] = [idx + 1, g.articleCode, g.productName, g.qty, fmtNum(g.wtPerBale), fmtNum(g.totalWt)];
        if (!hideSellingXls1) { rowCells.push(fmtMoney(unitPriceXls1)); rowCells.push(fmtMoney(g.total)); }
        const dr = sheet.addRow(rowCells);
        dr.height = 20;
        dr.eachCell((cell: any) => { cell.font = { size: 11 }; });
        if (idx % 2 === 1) {
          dr.eachCell((cell: any) => setFill(cell, LIGHT_GRAY));
        }
        dr.getCell(1).alignment = { horizontal: "center" };
        dr.getCell(4).alignment = { horizontal: "right" };
        dr.getCell(5).alignment = { horizontal: "right" };
        dr.getCell(6).alignment = { horizontal: "right" };
        if (!hideSellingXls1) {
          dr.getCell(7).alignment = { horizontal: "right" };
          dr.getCell(8).alignment = { horizontal: "right" };
        }
        setBorder(dr);
      });

      // ── Totals row ──
      const totRowCells: any[] = ["", "", "Totals", totalQty, "", fmtNum(totalWtAll)];
      if (!hideSellingXls1) { totRowCells.push(""); totRowCells.push(fmtMoney(totalAll)); }
      const totRow = sheet.addRow(totRowCells);
      totRow.height = 22;
      totRow.eachCell((cell: any) => {
        cell.font = { bold: true, size: 11, color: { argb: WHITE } };
        setFill(cell, DARK_BLUE);
        cell.alignment = { horizontal: "right" };
      });
      totRow.getCell(3).alignment = { horizontal: "center" };
      totRow.getCell(4).alignment = { horizontal: "right" };
      totRow.getCell(6).alignment = { horizontal: "right" };
      if (!hideSellingXls1) totRow.getCell(8).alignment = { horizontal: "right" };

      sheet.addRow([]);

      // ── Financial summary block (omit when selling prices are hidden) ──
      if (!hideSellingXls1) {
        const subtotal = parseFloat(order.subtotalBales || "0");
        const freight = parseFloat(order.freightAmount || "0");
        const otherChargesTotal = parseFloat(order.otherChargesTotal || "0");
        const grandTotal = parseFloat(order.grandTotal || "0");

        const otherChargeLines = orderCharges.filter((ch: any) => ch.chargeType !== "FREIGHT");
        const chargeRows: [string, number][] = otherChargeLines.length > 0
          ? otherChargeLines.map((ch: any) => [ch.name, parseFloat(ch.amount || "0")] as [string, number])
          : otherChargesTotal > 0
            ? [["Other Charges", otherChargesTotal]]
            : [];

        const summaryData: [string, number][] = [
          ["Subtotal (Bales)", subtotal],
          ...(freight > 0 ? [["Freight", freight] as [string, number]] : []),
          ...chargeRows,
          ["Grand Total", grandTotal],
        ];

        const sumHdr = sheet.addRow(["", "", "", "", "", "", "Name", "Amount"]);
        sumHdr.height = 22;
        sumHdr.getCell(7).font = { bold: true, color: { argb: WHITE }, size: 11 };
        sumHdr.getCell(8).font = { bold: true, color: { argb: WHITE }, size: 11 };
        setFill(sumHdr.getCell(7), DARK_BLUE);
        setFill(sumHdr.getCell(8), DARK_BLUE);
        sumHdr.getCell(7).alignment = { horizontal: "center" };
        sumHdr.getCell(8).alignment = { horizontal: "center" };

        summaryData.forEach(([label, amount], idx) => {
          const sr = sheet.addRow(["", "", "", "", "", "", label as string, fmtMoney(amount as number)]);
          sr.height = 20;
          const isGrandTotal = idx === summaryData.length - 1;
          const bg = isGrandTotal ? DARK_BLUE : (idx % 2 === 0 ? WHITE : LIGHT_GRAY);
          const fg = isGrandTotal ? WHITE : "FF000000";
          setFill(sr.getCell(7), bg);
          setFill(sr.getCell(8), bg);
          sr.getCell(7).font = { bold: isGrandTotal, size: 11, color: { argb: fg } };
          sr.getCell(8).font = { bold: isGrandTotal, size: 11, color: { argb: fg } };
          sr.getCell(7).alignment = { horizontal: "left" };
          sr.getCell(8).alignment = { horizontal: "right" };
          sr.getCell(7).border = { top: { style: "thin", color: { argb: "FFDDDDDD" } }, bottom: { style: "thin", color: { argb: "FFDDDDDD" } }, left: { style: "thin", color: { argb: "FFDDDDDD" } }, right: { style: "thin", color: { argb: "FFDDDDDD" } } };
          sr.getCell(8).border = { top: { style: "thin", color: { argb: "FFDDDDDD" } }, bottom: { style: "thin", color: { argb: "FFDDDDDD" } }, left: { style: "thin", color: { argb: "FFDDDDDD" } }, right: { style: "thin", color: { argb: "FFDDDDDD" } } };
        });
      }

      const fileName = buildExportFilename([order.containerNumber, customer?.legalName, order.destination], "xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting order to Excel:", error);
      res.status(500).json({ message: error.message });
    }
  });

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
  app.patch("/api/factory/customer-orders/:id/date", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { orderDate } = req.body;
      if (!orderDate) return res.status(400).json({ message: "orderDate is required" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "DRAFT") return res.status(400).json({ message: "Only DRAFT orders can have their date changed" });

      const [updated] = await db.update(customerOrders)
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

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const updateData: any = { updatedAt: new Date() };
      if (containerNumber !== undefined) updateData.containerNumber = containerNumber;
      if (shippingCompany !== undefined) updateData.shippingCompany = shippingCompany;
      if (containerNotes !== undefined) updateData.containerNotes = containerNotes;
      if (destination !== undefined) updateData.destination = destination || null;

      const [updated] = await db.update(customerOrders).set(updateData)
        .where(eq(customerOrders.id, orderId)).returning();

      if (shippingCompany && order.customerId) {
        await db.update(customers).set({
          defaultShippingCompany: shippingCompany,
        }).where(eq(customers.id, order.customerId)).catch(() => {});
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
        or(
          eq(factoryBales.referenceNumber, code),
          eq(factoryBales.baleCode, code),
          eq(factoryBales.articleCode, code)
        ),
      ];

      if (locationId) {
        conditions.push(eq(factoryBales.erpLocationId, locationId));
      }

      const results = await db.select().from(factoryBales).where(and(...conditions));

      if (results.length === 0) return res.status(404).json({ message: "No available bale found with that code at this location" });

      res.json(results);
    } catch (error: any) {
      console.error("Error looking up bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // INVOICE EXPORT (Excel/CSV)
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-orders/:id/export-excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { hideSelling: hideSellingXls2 } = await getExportPriceVisibility(req);
      const noChargesXls = req.query.noCharges === "1";
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [order] = await db
        .select({
          id: customerOrders.id,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          status: customerOrders.status,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          containerNumber: customerOrders.containerNumber,
          destination: customerOrders.destination,
          customerName: customers.legalName,
          customerCode: customers.code,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));

      if (!order) return res.status(404).json({ message: "Order not found" });

      const orderCharges2 = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));
      const rawLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));

      // Canonical product names from factoryBaleProducts
      const articleCodes = [...new Set(rawLines.map((l: any) => l.articleCode).filter(Boolean))];
      const productNameMap = new Map<string, string>();
      const wtPerBaleMap = new Map<string, number>();
      if (articleCodes.length > 0) {
        const products = await db
          .select({ articleCode: factoryBaleProducts.articleCode, name: factoryBaleProducts.name, weightPerBaleKg: factoryBaleProducts.weightPerBaleKg })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, articleCodes)));
        for (const p of products) {
          if (p.articleCode) {
            productNameMap.set(p.articleCode, p.name);
            wtPerBaleMap.set(p.articleCode, parseFloat(p.weightPerBaleKg || "0"));
          }
        }
      }

      const lines = rawLines
        .map((l: any) => ({
          articleCode: l.articleCode || "",
          productName: productNameMap.get(l.articleCode) || l.baleName || l.articleCode || "",
          qty: parseInt(l.qty || "0"),
          wtPerBale: wtPerBaleMap.get(l.articleCode) || parseFloat(l.weightPerBale || "0"),
          totalWt: parseFloat(l.totalWeight || "0"),
          pricePerBale: parseFloat(l.pricePerBale || "0"),
          total: parseFloat(l.totalPrice || "0"),
          pricingMode: (l.pricingMode as string) || "per_bale",
          pricePerKg: parseFloat(l.pricePerKg || "0"),
        }))
        .sort((a: any, b: any) => a.articleCode.localeCompare(b.articleCode));
      const anyPerKgXls2 = lines.some((l: any) => l.pricingMode === 'per_kg');

      // Currency
      const baseCurrency = (company as any)?.baseCurrency || "USD";
      const currencySymbolMap: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", CFA: "CFA", XOF: "CFA", XAF: "CFA" };
      const currSym = currencySymbolMap[baseCurrency.toUpperCase()] ?? baseCurrency;
      const fmtMoney = (n: number) => `${currSym}${n % 1 === 0 ? n.toLocaleString() : n.toFixed(2)}`;
      const fmtNum = (n: number) => n % 1 === 0 ? n.toLocaleString() : n.toFixed(2);

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Commercial Invoice");
      const COL = 8;

      sheet.columns = [
        { key: "c1", width: 6 },
        { key: "c2", width: 16 },
        { key: "c3", width: 30 },
        { key: "c4", width: 8 },
        { key: "c5", width: 11 },
        { key: "c6", width: 13 },
        { key: "c7", width: 13 },
        { key: "c8", width: 14 },
      ];

      const DARK_BLUE = "FF1F3864";
      const LIGHT_GRAY = "FFF5F5F5";
      const WHITE = "FFFFFFFF";

      const merge = (r: number, c1: number, c2: number) => sheet.mergeCells(r, c1, r, c2);
      const setFill = (cell: any, argb: string) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } }; };
      const setBorder = (row: any) => {
        row.eachCell((cell: any) => {
          cell.border = {
            top: { style: "thin", color: { argb: "FFDDDDDD" } },
            bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
            left: { style: "thin", color: { argb: "FFDDDDDD" } },
            right: { style: "thin", color: { argb: "FFDDDDDD" } },
          };
        });
      };

      // ── Logo row ──
      const logoRow = sheet.addRow([]);
      logoRow.height = 110;
      try {
        const logoPath = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(logoPath)) {
          const logoBuf = fs.readFileSync(logoPath);
          const logoId = workbook.addImage({ buffer: logoBuf as Buffer, extension: "jpeg" });
          sheet.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 180, height: 110 } });
        }
      } catch {}

      // ── Company name ──
      const r1 = sheet.addRow(["HMD INTERNATIONAL GROUP"]);
      r1.height = 26;
      r1.getCell(1).font = { bold: true, size: 16, color: { argb: DARK_BLUE } };
      r1.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      merge(r1.number, 1, COL);

      // ── "Commercial Invoice" title ──
      const r2 = sheet.addRow(["Commercial Invoice"]);
      r2.height = 22;
      r2.getCell(1).font = { bold: true, size: 14, color: { argb: DARK_BLUE } };
      r2.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      merge(r2.number, 1, COL);
      sheet.addRow([]);

      // ── Invoice details ──
      const invoiceNum = order.invoiceNumber || `INV-${String(orderId).padStart(6, "0")}`;
      const orderDateFmt = order.orderDate
        ? new Date(order.orderDate).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" })
        : "-";

      const details = [
        ["Invoice No.", invoiceNum],
        ["Customer", `${order.customerName || "-"}`],
        ["Date", orderDateFmt],
        ["Container", (order as any).containerNumber || "-"],
      ];
      for (const [label, value] of details) {
        const dr = sheet.addRow(["", "", "", "", "", label, "", value]);
        dr.height = 20;
        dr.getCell(6).font = { bold: true, size: 11 };
        dr.getCell(6).alignment = { horizontal: "right" };
        dr.getCell(8).font = { size: 11 };
        dr.getCell(8).alignment = { horizontal: "left" };
        merge(dr.number, 6, 7);
      }
      sheet.addRow([]);

      // ── Table header ──
      const unitPriceLabelXls2 = anyPerKgXls2 ? "Price/KG" : "Price/Bale";
      const hdrRow = sheet.addRow(["#", "Article Code", "Product", "Qty", "Wt/Bale", "Total Wt", ...(hideSellingXls2 ? [] : [unitPriceLabelXls2, "Total"])]);
      hdrRow.height = 24;
      hdrRow.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
        setFill(cell, DARK_BLUE);
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { top: { style: "thin", color: { argb: WHITE } }, bottom: { style: "thin", color: { argb: WHITE } }, left: { style: "thin", color: { argb: WHITE } }, right: { style: "thin", color: { argb: WHITE } } };
      });

      // ── Data rows ──
      let totalQty = 0, totalWtAll = 0, totalAll = 0;
      lines.forEach((g: any, idx: number) => {
        totalQty += g.qty;
        totalWtAll += g.totalWt;
        totalAll += g.total;
        const unitPriceXls2 = g.pricingMode === 'per_kg'
          ? (g.totalWt > 0 ? g.total / g.totalWt : g.pricePerKg)
          : g.pricePerBale;
        const rowCells2: any[] = [idx + 1, g.articleCode, g.productName, g.qty, fmtNum(g.wtPerBale), fmtNum(g.totalWt)];
        if (!hideSellingXls2) { rowCells2.push(fmtMoney(unitPriceXls2)); rowCells2.push(fmtMoney(g.total)); }
        const dr = sheet.addRow(rowCells2);
        dr.height = 20;
        dr.eachCell((cell: any) => { cell.font = { size: 11 }; });
        if (idx % 2 === 1) {
          dr.eachCell((cell: any) => setFill(cell, LIGHT_GRAY));
        }
        dr.getCell(1).alignment = { horizontal: "center" };
        dr.getCell(4).alignment = { horizontal: "right" };
        dr.getCell(5).alignment = { horizontal: "right" };
        dr.getCell(6).alignment = { horizontal: "right" };
        if (!hideSellingXls2) {
          dr.getCell(7).alignment = { horizontal: "right" };
          dr.getCell(8).alignment = { horizontal: "right" };
        }
        setBorder(dr);
      });

      // ── Totals row ──
      const totRowCells2: any[] = ["", "", "Totals", totalQty, "", fmtNum(totalWtAll)];
      if (!hideSellingXls2) { totRowCells2.push(""); totRowCells2.push(fmtMoney(totalAll)); }
      const totRow = sheet.addRow(totRowCells2);
      totRow.height = 22;
      totRow.eachCell((cell: any) => {
        cell.font = { bold: true, size: 11, color: { argb: WHITE } };
        setFill(cell, DARK_BLUE);
        cell.alignment = { horizontal: "right" };
      });
      totRow.getCell(3).alignment = { horizontal: "center" };

      sheet.addRow([]);

      // ── Financial summary block (omit when selling prices are hidden or noCharges) ──
      if (!hideSellingXls2 && !noChargesXls) {
        const subtotal = parseFloat(order.subtotalBales || "0");
        const freight = parseFloat(order.freightAmount || "0");
        const otherChargesTotal2 = parseFloat(order.otherChargesTotal || "0");
        const grandTotal = parseFloat(order.grandTotal || "0");

        const otherChargeLines2 = orderCharges2.filter((ch: any) => ch.chargeType !== "FREIGHT");
        const chargeRows2: [string, number][] = otherChargeLines2.length > 0
          ? otherChargeLines2.map((ch: any) => [ch.name, parseFloat(ch.amount || "0")] as [string, number])
          : otherChargesTotal2 > 0
            ? [["Other Charges", otherChargesTotal2]]
            : [];

      const summaryData: [string, number][] = [
        ["Subtotal (Bales)", subtotal],
        ...(freight > 0 ? [["Freight", freight] as [string, number]] : []),
        ...chargeRows2,
        ["Grand Total", grandTotal],
      ];

        const sumHdr = sheet.addRow(["", "", "", "", "", "", "Name", "Amount"]);
        sumHdr.height = 22;
        sumHdr.getCell(7).font = { bold: true, color: { argb: WHITE }, size: 11 };
        sumHdr.getCell(8).font = { bold: true, color: { argb: WHITE }, size: 11 };
        setFill(sumHdr.getCell(7), DARK_BLUE);
        setFill(sumHdr.getCell(8), DARK_BLUE);
        sumHdr.getCell(7).alignment = { horizontal: "center" };
        sumHdr.getCell(8).alignment = { horizontal: "center" };

        summaryData.forEach(([label, amount], idx) => {
          const sr = sheet.addRow(["", "", "", "", "", "", label, fmtMoney(amount)]);
          sr.height = 20;
          const isGrandTotal = idx === summaryData.length - 1;
          const bg = isGrandTotal ? DARK_BLUE : (idx % 2 === 0 ? WHITE : LIGHT_GRAY);
          const fg = isGrandTotal ? WHITE : "FF000000";
          setFill(sr.getCell(7), bg);
          setFill(sr.getCell(8), bg);
          sr.getCell(7).font = { bold: isGrandTotal, size: 11, color: { argb: fg } };
          sr.getCell(8).font = { bold: isGrandTotal, size: 11, color: { argb: fg } };
          sr.getCell(7).alignment = { horizontal: "left" };
          sr.getCell(8).alignment = { horizontal: "right" };
          sr.getCell(7).border = { top: { style: "thin", color: { argb: "FFDDDDDD" } }, bottom: { style: "thin", color: { argb: "FFDDDDDD" } }, left: { style: "thin", color: { argb: "FFDDDDDD" } }, right: { style: "thin", color: { argb: "FFDDDDDD" } } };
          sr.getCell(8).border = { top: { style: "thin", color: { argb: "FFDDDDDD" } }, bottom: { style: "thin", color: { argb: "FFDDDDDD" } }, left: { style: "thin", color: { argb: "FFDDDDDD" } }, right: { style: "thin", color: { argb: "FFDDDDDD" } } };
        });
      } // end if (!hideSellingXls2)

      const fileName = buildExportFilename([order.containerNumber, order.customerName, order.destination], "xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting order to Excel:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // PENDING LOADING — BALE-LEVEL EXCEL EXPORT
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-orders/:id/pending-export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(orderId)) return res.status(400).json({ message: "Invalid order ID" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId));
      const customerName = customer?.legalName || `order_${orderId}`;

      const baleLinks = await db.select().from(customerOrderBales)
        .where(eq(customerOrderBales.orderId, orderId))
        .orderBy(customerOrderBales.id);

      const baleIds = baleLinks.map((b: any) => b.baleId).filter(Boolean);
      const baleRows: any[] = baleIds.length > 0
        ? await db.select().from(factoryBales).where(inArray(factoryBales.id, baleIds))
        : [];
      const baleMap = new Map<number, any>(baleRows.map((b: any) => [b.id, b]));

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Loading");

      const NUM_COLS_LOADING = 6;
      sheet.columns = [
        { key: "seq", width: 6 },
        { key: "refCode", width: 20 },
        { key: "articleCode", width: 16 },
        { key: "name", width: 32 },
        { key: "weight", width: 14 },
        { key: "totalWeight", width: 18 },
      ];

      // Logo header rows
      try {
        const ldLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(ldLogoPath)) {
          const ldId = workbook.addImage({ buffer: fs.readFileSync(ldLogoPath) as Buffer, extension: "jpeg" });
          const ldRow = sheet.addRow([]); ldRow.height = 90;
          sheet.addImage(ldId, { tl: { col: 2.4, row: 0 }, ext: { width: 300, height: 90 } });
        }
      } catch {}
      const ldTitle = sheet.addRow([`Loading List — ${customerName}`]);
      ldTitle.getCell(1).font = { bold: true, size: 13 };
      ldTitle.getCell(1).alignment = { horizontal: "center" };
      sheet.mergeCells(ldTitle.number, 1, ldTitle.number, NUM_COLS_LOADING);
      sheet.addRow([]);

      const ldHdr = sheet.addRow(["#", "Ref Code", "Article Code", "Name", "Weight (kg)", "Total Weight (kg)"]);
      ldHdr.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
      });

      let runningTotal = 0;
      for (let i = 0; i < baleLinks.length; i++) {
        const link = baleLinks[i];
        const bale = baleMap.get(link.baleId);
        const weight = parseFloat(link.weight || bale?.weightKg || "0");
        runningTotal += weight;
        const row = sheet.addRow({
          seq: i + 1,
          refCode: link.baleReference || bale?.referenceNumber || bale?.baleCode || "",
          articleCode: link.articleCode || bale?.articleCode || "",
          name: link.baleName || bale?.productName || "",
          weight: Math.round(weight * 100) / 100,
          totalWeight: Math.round(runningTotal * 100) / 100,
        });
        row.getCell("weight").numFmt = "#,##0.00";
        row.getCell("totalWeight").numFmt = "#,##0.00";
      }

      const totalRow = sheet.addRow({
        seq: "",
        refCode: "",
        articleCode: "",
        name: "TOTAL",
        weight: Math.round(runningTotal * 100) / 100,
        totalWeight: Math.round(runningTotal * 100) / 100,
      });
      totalRow.font = { bold: true };
      totalRow.getCell("weight").numFmt = "#,##0.00";
      totalRow.getCell("totalWeight").numFmt = "#,##0.00";

      const safeName = customerName.replace(/[^a-zA-Z0-9_\-]/g, "_");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="loading_${orderId}_${safeName}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting pending loading:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // INVOICE EXPORT (PDF as HTML)
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-orders/:id/export-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { hideSelling: hideSellingPdf } = await getExportPriceVisibility(req);
      const noChargesPdf = req.query.noCharges === "1";

      const [order] = await db
        .select({
          id: customerOrders.id,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          status: customerOrders.status,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          containerNumber: customerOrders.containerNumber,
          destination: customerOrders.destination,
          customerName: customers.legalName,
          customerCode: customers.code,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));

      if (!order) return res.status(404).json({ message: "Order not found" });

      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const charges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      const invArticleCodes = [...new Set(lines.map((l: any) => l.articleCode).filter(Boolean))];
      const invNameMap = new Map<string, string>();
      if (invArticleCodes.length > 0) {
        const invProds = await db
          .select({ articleCode: factoryBaleProducts.articleCode, name: factoryBaleProducts.name })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, invArticleCodes)));
        for (const p of invProds) { if (p.articleCode) invNameMap.set(p.articleCode, p.name); }
      }
      const sortedLines = lines.sort((a: any, b: any) => {
        const na = invNameMap.get(a.articleCode) || a.baleName || "";
        const nb = invNameMap.get(b.articleCode) || b.baleName || "";
        return na.localeCompare(nb);
      });

      const invoiceLabel = order.invoiceNumber || `INV-${String(orderId).padStart(6, "0")}`;

      // ── PDFKit setup ──────────────────────────────────────────────────────────
      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${buildExportFilename([order.containerNumber, order.customerName, order.destination], "pdf")}"`);
      doc.pipe(res);

      const PAGE_W = doc.page.width;   // 595
      const L = 40, R = PAGE_W - 40;  // left / right margin x
      const USABLE = R - L;            // 515

      const fmtN = (val: any) => {
        const n = parseFloat(val);
        if (isNaN(n)) return val ?? "";
        return n % 1 === 0 ? n.toLocaleString("en-US") : n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      };
      const fmtM = (val: any) => `$${fmtN(val)}`;

      // ── Logo (centred, fixed height so title lands below it) ─────────────────
      const logoPath = path.join(process.cwd(), "server", "hmd-logo.png");
      const LOGO_W = 200;
      const LOGO_H = 87;   // ≈ 200 × (96/220) — matches actual HMD logo aspect ratio
      const LOGO_TOP = 30;
      if (fs.existsSync(logoPath)) {
        try { doc.image(logoPath, (PAGE_W - LOGO_W) / 2, LOGO_TOP, { width: LOGO_W, height: LOGO_H, fit: [LOGO_W, LOGO_H] }); } catch {}
      }
      const afterLogo = LOGO_TOP + LOGO_H + 10;

      // ── Title ─────────────────────────────────────────────────────────────────
      doc.fontSize(14).font("Helvetica-Bold").fillColor("#000000")
        .text("INVOICE", L, afterLogo, { width: USABLE, align: "center" });

      // ── Divider ───────────────────────────────────────────────────────────────
      const divY = doc.y + 6;
      doc.moveTo(L, divY).lineTo(R, divY).lineWidth(0.5).strokeColor("#cccccc").stroke();
      doc.lineWidth(1).strokeColor("#000000");

      // ── Meta block ───────────────────────────────────────────────────────────
      const metaY = divY + 12;
      const dateStr = order.orderDate
        ? new Date(order.orderDate + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        : "-";
      const metaItems: [string, string][] = [
        ["Invoice No.", invoiceLabel],
        ["Customer", order.customerName || "-"],
        ["Date", dateStr],
        ...(order.containerNumber ? [["Container", order.containerNumber] as [string, string]] : []),
      ];
      let mY = metaY;
      doc.font("Helvetica").fontSize(9).fillColor("#000000");
      for (const [label, value] of metaItems) {
        doc.font("Helvetica-Bold").text(`${label}  `, L, mY, { continued: true })
          .font("Helvetica").text(value);
        mY = doc.y + 2;
      }

      doc.moveDown(0.8);

      // ── Column layout ─────────────────────────────────────────────────────────
      let colX: number[], colW: number[], colHdr: string[], colAlign: Array<"left" | "right" | "center">;
      if (hideSellingPdf) {
        colX     = [40,  62,  132, 382, 428, 476];
        colW     = [22,  70,  250,  46,  48,  79];
        colHdr   = ["#", "Code", "Product", "Qty", "Wt/Bale", "Total Wt"];
        colAlign = ["center","center","left","center","center","center"];
      } else {
        colX     = [40,  62,  132, 310, 356, 402, 450, 503];
        colW     = [22,  70,  178,  46,  46,  48,  53,  52];
        colHdr   = ["#", "Code", "Product", "Qty", "Wt/Bale", "Total Wt", "Price/Bale", "Total"];
        colAlign = ["center","center","left","center","center","center","center","center"];
      }

      // ── Table header row ──────────────────────────────────────────────────────
      const tblTop = doc.y + 4;
      const HDR_H = 16;
      doc.rect(L, tblTop, USABLE, HDR_H).fill("#1F3864");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
      colHdr.forEach((h, i) => {
        doc.text(h, colX[i] + 2, tblTop + 4, { width: colW[i] - 4, align: colAlign[i] });
      });
      doc.fillColor("#000000").font("Helvetica").fontSize(8);

      // ── Table rows ────────────────────────────────────────────────────────────
      const ROW_H = 14;
      let y = tblTop + HDR_H;
      let totalQty = 0, totalWt = 0, totalAmt = 0;

      for (let idx = 0; idx < sortedLines.length; idx++) {
        const line = sortedLines[idx] as any;
        const qty = parseFloat(line.qty || "0");
        const wtBale = parseFloat(line.weightPerBale || "0");
        const totWt = parseFloat(line.totalWeight || "0") || qty * wtBale;
        const price = parseFloat(line.pricePerBale || "0");
        const totPrice = parseFloat(line.totalPrice || "0") || qty * price;
        totalQty += qty;
        totalWt += totWt;
        totalAmt += totPrice;

        if (y + ROW_H > doc.page.height - 60) {
          doc.addPage();
          y = 40;
        }
        if (idx % 2 === 1) {
          doc.rect(L, y, USABLE, ROW_H).fill("#F4F7FB");
          doc.fillColor("#000000");
        }
        const productName = invNameMap.get(line.articleCode) || line.baleName || "";
        const vals = hideSellingPdf
          ? [String(idx + 1), line.articleCode || "", productName, fmtN(qty), fmtN(wtBale), fmtN(totWt)]
          : [String(idx + 1), line.articleCode || "", productName, fmtN(qty), fmtN(wtBale), fmtN(totWt), fmtM(price), fmtM(totPrice)];
        vals.forEach((v, i) => {
          doc.text(v, colX[i] + 2, y + 3, { width: colW[i] - 4, align: colAlign[i], lineBreak: false });
        });
        y += ROW_H;
      }

      // ── Totals row ────────────────────────────────────────────────────────────
      y += 2;
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor("#888888").stroke();
      doc.lineWidth(1).strokeColor("#000000");
      y += 4;
      doc.rect(L, y, USABLE, 16).fill("#EEF2F9");
      doc.fillColor("#000000").font("Helvetica-Bold").fontSize(8);
      const totVals = hideSellingPdf
        ? ["", "", "TOTALS", fmtN(totalQty), "", fmtN(totalWt)]
        : ["", "", "TOTALS", fmtN(totalQty), "", fmtN(totalWt), "", fmtM(totalAmt)];
      totVals.forEach((v, i) => {
        if (v) doc.text(v, colX[i] + 2, y + 4, { width: colW[i] - 4, align: colAlign[i], lineBreak: false });
      });
      y += 20;

      // ── Charges & grand-total summary (omit when hiding prices or noCharges) ──
      if (!hideSellingPdf && !noChargesPdf) {
        const freightCharges = charges.filter((ch: any) => ch.chargeType === "FREIGHT");
        const otherCharges = charges.filter((ch: any) => ch.chargeType !== "FREIGHT");
        const hasCharges = freightCharges.length > 0 || otherCharges.length > 0;

        if (hasCharges) {
          y += 8;
          doc.font("Helvetica-Bold").fontSize(9).fillColor("#000000").text("Freight & Charges", L, y);
          y = doc.y + 4;
          doc.font("Helvetica").fontSize(8);
          for (const ch of [...freightCharges, ...otherCharges]) {
            doc.text(ch.name || ch.chargeType, L + 10, y, { continued: true })
              .text(fmtM(ch.amount), { align: "right", width: USABLE - 10 });
            y = doc.y + 2;
          }
          y += 4;
        }

        // Summary box
        const summaryRows: [string, string, boolean][] = [
          ["Subtotal (Bales)", fmtM(order.subtotalBales), false],
        ];
        const freight = parseFloat(order.freightAmount || "0");
        if (freight > 0) summaryRows.push(["Freight", fmtM(freight), false]);
        const otherTotal = parseFloat(order.otherChargesTotal || "0");
        if (otherCharges.length > 0) {
          for (const ch of otherCharges) summaryRows.push([ch.name || "Other", fmtM(ch.amount), false]);
        } else if (otherTotal > 0) {
          summaryRows.push(["Other Charges", fmtM(otherTotal), false]);
        }
        summaryRows.push(["Grand Total", fmtM(order.grandTotal), true]);

        const BOX_W = 220;
        const boxX = R - BOX_W;
        doc.font("Helvetica").fontSize(9);
        for (const [label, value, isGrand] of summaryRows) {
          if (y + 18 > doc.page.height - 40) { doc.addPage(); y = 40; }
          if (isGrand) {
            doc.rect(boxX, y, BOX_W, 18).fill("#1F3864");
            doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10);
            doc.text(label, boxX + 8, y + 4, { continued: true })
              .text(value, { align: "right", width: BOX_W - 16 });
            doc.fillColor("#000000").font("Helvetica").fontSize(9);
          } else {
            doc.moveTo(boxX, y + 16).lineTo(R, y + 16).lineWidth(0.3).strokeColor("#cccccc").stroke();
            doc.lineWidth(1).strokeColor("#000000");
            doc.text(label, boxX + 8, y + 4, { continued: true })
              .text(value, { align: "right", width: BOX_W - 16 });
          }
          y += 18;
        }
      }

      doc.end();
    } catch (error: any) {
      console.error("Error exporting order to PDF:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── LOADING STATUS EXCEL EXPORT ───────

  app.get("/api/factory/customer-orders/:id/loading-status-export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const [order] = await db
        .select({
          id: customerOrders.id,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          proformaIdUsed: customerOrders.proformaIdUsed,
          containerNumber: customerOrders.containerNumber,
          destination: customerOrders.destination,
          totalQtyBales: customerOrders.totalQtyBales,
          customerName: customers.legalName,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));

      if (!order) return res.status(404).json({ message: "Order not found" });

      // Fetch proforma lines (requested quantities per article)
      const proformaMap = new Map<string, { qty: number; productName: string }>();
      if (order.proformaIdUsed) {
        const proformaLines = await db
          .select()
          .from(customerProformaLines)
          .where(eq(customerProformaLines.proformaId, order.proformaIdUsed));
        for (const pl of proformaLines) {
          proformaMap.set(pl.articleCode, { qty: pl.quantity, productName: pl.productName });
        }
      }

      // Fetch all bales linked to this order, joining to factoryBales + factoryBaleProducts
      // to get the canonical articleCode (in case the denormalised field on orderBales is null)
      const baleLinks = await db
        .select({
          id: customerOrderBales.id,
          baleId: customerOrderBales.baleId,
          orderBaleArticleCode: customerOrderBales.articleCode,
          baleName: customerOrderBales.baleName,
          baleArticleCode: factoryBales.articleCode,
          baleProductId: factoryBales.productId,
          baleProductName: factoryBales.productName,
          baleReferenceNumber: factoryBales.referenceNumber,
          baleCode: factoryBales.baleCode,
          productArticleCode: factoryBaleProducts.articleCode,
          productName: factoryBaleProducts.name,
        })
        .from(customerOrderBales)
        .leftJoin(factoryBales, eq(customerOrderBales.baleId, factoryBales.id))
        .leftJoin(factoryBaleProducts, eq(factoryBales.productId, factoryBaleProducts.id))
        .where(eq(customerOrderBales.orderId, orderId));

      // Resolve canonical article code: productArticleCode > baleArticleCode > orderBaleArticleCode
      // Use canonical product name from factoryBaleProducts when available
      const loadedMap = new Map<string, { count: number; name: string }>();
      for (const link of baleLinks) {
        const code = link.productArticleCode || link.baleArticleCode || link.orderBaleArticleCode || "";
        if (!code) continue; // skip completely unidentified bales
        const name = link.productName || link.baleProductName || link.baleName || code;
        const entry = loadedMap.get(code) || { count: 0, name };
        entry.count += 1;
        loadedMap.set(code, entry);
      }

      // Build canonical product name map (already resolved above via join, but also from proforma)
      const allCodes = [...new Set([...proformaMap.keys(), ...loadedMap.keys()])];
      const productNameMap = new Map<string, string>();
      // Seed from the join results
      for (const link of baleLinks) {
        const code = link.productArticleCode || link.baleArticleCode || link.orderBaleArticleCode || "";
        if (code && link.productName) productNameMap.set(code, link.productName);
      }
      // Fill any remaining from DB (e.g. proforma codes that have no loaded bales)
      const missingCodes = allCodes.filter((c) => !productNameMap.has(c));
      if (missingCodes.length > 0) {
        const prods = await db
          .select({ articleCode: factoryBaleProducts.articleCode, name: factoryBaleProducts.name })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, missingCodes)));
        for (const p of prods) { if (p.articleCode) productNameMap.set(p.articleCode, p.name); }
      }

      // Build rows: proforma items first, then extra (NOT REQUESTED) items
      type LoadRow = { articleCode: string; productName: string; requested: number; loaded: number; diff: number; status: string };
      const rows: LoadRow[] = [];

      // Process proforma items
      for (const [code, pf] of proformaMap) {
        const loaded = loadedMap.get(code)?.count ?? 0;
        const diff = loaded - pf.qty;
        let status = "LOADED";
        if (loaded === 0) status = "NOT LOADED";
        else if (diff > 0) status = "OVERLOADED";
        else if (diff < 0) status = "LESS LOADED";
        rows.push({
          articleCode: code,
          productName: productNameMap.get(code) || pf.productName || code,
          requested: pf.qty,
          loaded,
          diff,
          status,
        });
      }

      // NOT REQUESTED items (loaded but not in proforma)
      for (const [code, ld] of loadedMap) {
        if (!proformaMap.has(code)) {
          rows.push({
            articleCode: code,
            productName: productNameMap.get(code) || ld.name || code,
            requested: 0,
            loaded: ld.count,
            diff: ld.count,
            status: order.proformaIdUsed ? "NOT REQUESTED" : "LOADED",
          });
        }
      }

      // Sort: article code
      rows.sort((a, b) => a.articleCode.localeCompare(b.articleCode));

      // ── ExcelJS ──
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Loading Status");
      const COL = 7; // now 7 columns (#, ArticleCode, Product, Requested, Loaded, Diff, Status)

      sheet.columns = [
        { key: "c1", width: 6  },  // #
        { key: "c2", width: 16 },  // Article Code
        { key: "c3", width: 32 },  // Product
        { key: "c4", width: 13 },  // Requested
        { key: "c5", width: 13 },  // Loaded
        { key: "c6", width: 11 },  // Diff
        { key: "c7", width: 20 },  // Status
      ];

      const DARK_BLUE   = "FF1F3864";
      const WHITE       = "FFFFFFFF";
      const LIGHT_GRAY  = "FFF5F5F5";
      const GREEN_BG    = "FFE8F5E9";
      const RED_BG      = "FFFDECEA";
      const ORANGE_BG   = "FFFFF3E0";
      const YELLOW_BG   = "FFFFFDE7";

      const statusStyle: Record<string, { bg: string; fg: string }> = {
        "LOADED":        { bg: GREEN_BG,  fg: "FF2E7D32" },
        "OVERLOADED":    { bg: RED_BG,    fg: "FFC62828" },
        "LESS LOADED":   { bg: ORANGE_BG, fg: "FFE65100" },
        "NOT REQUESTED": { bg: YELLOW_BG, fg: "FFF57F17" },
        "NOT LOADED":    { bg: "FFEEEEEE", fg: "FF555555" },
      };

      const setFill = (cell: any, argb: string) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
      };
      const merge = (r: number, c1: number, c2: number) => sheet.mergeCells(r, c1, r, c2);

      // Logo
      const logoRow = sheet.addRow([]);
      logoRow.height = 110;
      try {
        const lp = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(lp)) {
          const lid = workbook.addImage({ buffer: fs.readFileSync(lp) as Buffer, extension: "jpeg" });
          sheet.addImage(lid, { tl: { col: 0, row: 0 }, ext: { width: 180, height: 110 } });
        }
      } catch {}

      const r1 = sheet.addRow(["HMD INTERNATIONAL GROUP"]);
      r1.height = 26;
      r1.getCell(1).font = { bold: true, size: 16, color: { argb: DARK_BLUE } };
      r1.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      merge(r1.number, 1, COL);

      const r2 = sheet.addRow(["Loading Status Report"]);
      r2.height = 22;
      r2.getCell(1).font = { bold: true, size: 14, color: { argb: DARK_BLUE } };
      r2.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      merge(r2.number, 1, COL);

      sheet.addRow([]);

      const invoiceNum = order.invoiceNumber || `INV-${String(orderId).padStart(6, "0")}`;
      const dateStr = order.orderDate ? new Date(order.orderDate).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" }) : "-";

      const details = [
        ["Invoice No.", invoiceNum],
        ["Customer",    order.customerName || "-"],
        ["Date",        dateStr],
        ["Container",   order.containerNumber || "-"],
      ];
      for (const [label, value] of details) {
        const dr = sheet.addRow(["", "", "", "", label, "", value]);
        dr.height = 20;
        dr.getCell(5).font = { bold: true, size: 11 };
        dr.getCell(5).alignment = { horizontal: "right" };
        dr.getCell(7).font = { size: 11 };
        merge(dr.number, 5, 6);
      }

      sheet.addRow([]);

      // Table header
      const hdr = sheet.addRow(["#", "Article Code", "Product", "Requested", "Loaded", "Diff", "Status"]);
      hdr.height = 24;
      hdr.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
        setFill(cell, DARK_BLUE);
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { top: { style: "thin", color: { argb: WHITE } }, bottom: { style: "thin", color: { argb: WHITE } }, left: { style: "thin", color: { argb: WHITE } }, right: { style: "thin", color: { argb: WHITE } } };
      });

      // Data rows
      rows.forEach((row, idx) => {
        const style = statusStyle[row.status] || { bg: LIGHT_GRAY, fg: "FF000000" };
        const diffLabel = row.diff === 0 ? "0" : (row.diff > 0 ? `+${row.diff}` : `${row.diff}`);
        const dr = sheet.addRow([idx + 1, row.articleCode, row.productName, row.requested, row.loaded, diffLabel, row.status]);
        dr.height = 20;
        dr.eachCell((cell: any) => { cell.font = { size: 11 }; });
        if (idx % 2 === 1) dr.eachCell((cell: any) => setFill(cell, LIGHT_GRAY));
        // Status cell: always coloured
        const statusCell = dr.getCell(7);
        setFill(statusCell, style.bg);
        statusCell.font = { bold: true, size: 11, color: { argb: style.fg } };
        statusCell.alignment = { horizontal: "center" };
        // Diff cell: colour by positive/negative/zero
        const diffCell = dr.getCell(6);
        diffCell.alignment = { horizontal: "center" };
        if (row.diff > 0) diffCell.font = { bold: true, size: 11, color: { argb: "FFC62828" } };
        else if (row.diff < 0) diffCell.font = { bold: true, size: 11, color: { argb: "FFE65100" } };
        else diffCell.font = { bold: true, size: 11, color: { argb: "FF2E7D32" } };
        dr.getCell(1).alignment = { horizontal: "center" };
        dr.getCell(4).alignment = { horizontal: "right" };
        dr.getCell(5).alignment = { horizontal: "right" };
        dr.eachCell((cell: any) => {
          cell.border = {
            top: { style: "thin", color: { argb: "FFDDDDDD" } },
            bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
            left: { style: "thin", color: { argb: "FFDDDDDD" } },
            right: { style: "thin", color: { argb: "FFDDDDDD" } },
          };
        });
      });

      // Totals row
      const totalLoaded = rows.reduce((s, r) => s + r.loaded, 0);
      const totalRequested = rows.reduce((s, r) => s + r.requested, 0);
      const totalDiff = totalLoaded - totalRequested;
      const totRow = sheet.addRow(["", "", "Totals", totalRequested, totalLoaded, totalDiff === 0 ? "0" : (totalDiff > 0 ? `+${totalDiff}` : `${totalDiff}`), ""]);
      totRow.height = 22;
      totRow.eachCell((cell: any) => {
        cell.font = { bold: true, size: 11, color: { argb: WHITE } };
        setFill(cell, DARK_BLUE);
        cell.alignment = { horizontal: "right" };
      });
      totRow.getCell(3).alignment = { horizontal: "center" };
      totRow.getCell(6).alignment = { horizontal: "center" };

      // Legend
      sheet.addRow([]);
      const legendHdr = sheet.addRow(["Legend"]);
      legendHdr.getCell(1).font = { bold: true, size: 11 };
      const legend: [string, typeof statusStyle[string]][] = [
        ["LOADED — exact quantity matched", statusStyle["LOADED"]],
        ["OVERLOADED — more than requested", statusStyle["OVERLOADED"]],
        ["LESS LOADED — fewer than requested", statusStyle["LESS LOADED"]],
        ["NOT REQUESTED — not in proforma", statusStyle["NOT REQUESTED"]],
        ["NOT LOADED — requested but none loaded", statusStyle["NOT LOADED"]],
      ];
      for (const [label, st] of legend) {
        const lr = sheet.addRow(["", label]);
        setFill(lr.getCell(2), st.bg);
        lr.getCell(2).font = { size: 10, color: { argb: st.fg }, bold: true };
        lr.getCell(2).alignment = { horizontal: "left" };
        merge(lr.number, 2, COL);
      }

      // ── Second sheet: individual Bale References ──
      const refSheet = workbook.addWorksheet("Bale References");
      refSheet.columns = [
        { key: "num",  width: 6  },  // #
        { key: "ref",  width: 22 },  // Reference Number
        { key: "code", width: 16 },  // Article Code
        { key: "prod", width: 32 },  // Product Name
      ];

      const refHdr = refSheet.addRow(["#", "Reference Number", "Article Code", "Product"]);
      refHdr.height = 24;
      refHdr.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
        setFill(cell, DARK_BLUE);
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { top: { style: "thin", color: { argb: WHITE } }, bottom: { style: "thin", color: { argb: WHITE } }, left: { style: "thin", color: { argb: WHITE } }, right: { style: "thin", color: { argb: WHITE } } };
      });

      // Build per-bale rows sorted by article code then reference number
      const baleRefRows = baleLinks
        .map((link) => {
          const code = link.productArticleCode || link.baleArticleCode || link.orderBaleArticleCode || "";
          const refNum = link.baleReferenceNumber || link.baleCode || `BALE-${link.baleId}`;
          const prodName = productNameMap.get(code) || link.productName || link.baleProductName || link.baleName || code;
          return { code, refNum, prodName };
        })
        .filter((r) => r.refNum)
        .sort((a, b) => a.code.localeCompare(b.code) || a.refNum.localeCompare(b.refNum));

      baleRefRows.forEach((r, idx) => {
        const dr = refSheet.addRow([idx + 1, r.refNum, r.code, r.prodName]);
        dr.height = 20;
        dr.eachCell((cell: any) => { cell.font = { size: 11 }; });
        if (idx % 2 === 1) dr.eachCell((cell: any) => setFill(cell, LIGHT_GRAY));
        dr.getCell(1).alignment = { horizontal: "center" };
        dr.eachCell((cell: any) => {
          cell.border = {
            top: { style: "thin", color: { argb: "FFDDDDDD" } },
            bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
            left: { style: "thin", color: { argb: "FFDDDDDD" } },
            right: { style: "thin", color: { argb: "FFDDDDDD" } },
          };
        });
      });

      const fileDateStr = getClientDate(req);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${buildExportFilename([order.containerNumber, order.customerName, order.destination], "xlsx")}"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting loading status:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── INVOICE CONTAINER TRACKING ─────────────────────────────────────
  // GET /api/factory/invoice-container-tracking
  // Returns all VERIFIED / FINALIZED factory invoices that have a container
  // number, enriched with ETA + tracking status from the ERP containers table
  // (the Maersk / CMA auto-tracking system).
  app.get("/api/factory/invoice-container-tracking", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows = await db
        .select({
          id: customerOrders.id,
          invoiceNumber: customerOrders.invoiceNumber,
          containerNumber: customerOrders.containerNumber,
          status: customerOrders.status,
          grandTotal: customerOrders.grandTotal,
          orderDate: customerOrders.orderDate,
          customerName: customers.legalName,
          // ERP container tracking fields
          eta: containers.eta,
          trackingLastStatus: containers.trackingLastStatus,
          trackingLink: containers.trackingLink,
          containerStatus: containers.status,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .leftJoin(containers, eq(customerOrders.containerNumber, containers.containerNumber))
        .where(
          and(
            eq(customerOrders.companyId, companyId),
            isNull(customerOrders.deletedAt),
            sql`${customerOrders.status} IN ('VERIFIED', 'FINALIZED')`,
            sql`${customerOrders.containerNumber} IS NOT NULL AND TRIM(${customerOrders.containerNumber}) <> ''`,
          )
        )
        .orderBy(desc(customerOrders.orderDate), desc(customerOrders.id));

      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/shipping-containers/track-now
  // Finds all active factory customer orders with container numbers, matches
  // them to ERP containers table, and triggers live tracking for each one.
  app.post("/api/factory/shipping-containers/track-now", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Get all active factory customer orders with a container number
      const orders = await db
        .select({ containerNumber: customerOrders.containerNumber })
        .from(customerOrders)
        .where(
          and(
            eq(customerOrders.companyId, companyId),
            isNull(customerOrders.deletedAt),
            sql`${customerOrders.containerNumber} IS NOT NULL AND TRIM(${customerOrders.containerNumber}) <> ''`,
          )
        );

      const containerNumbers = [...new Set(
        orders.map((o) => (o.containerNumber || "").trim().toUpperCase()).filter(Boolean)
      )];

      if (containerNumbers.length === 0) {
        return res.json({ tracked: 0, message: "No container numbers found on active orders." });
      }

      // Find matching ERP containers
      const matched = await db
        .select({ id: containers.id, containerNumber: containers.containerNumber })
        .from(containers)
        .where(
          and(
            inArray(sql`UPPER(TRIM(${containers.containerNumber}))`, containerNumbers),
            isNull(containers.deletedAt),
          )
        );

      if (matched.length === 0) {
        return res.json({
          tracked: 0,
          message: "No matching containers found in tracking system. Ensure container numbers are registered as ERP containers.",
        });
      }

      // Fire tracking for each matched container in parallel (fire-and-forget)
      let queued = 0;
      for (const c of matched) {
        trackOneContainerById(c.id).catch(() => {});
        queued++;
      }

      res.json({
        tracked: queued,
        message: `Tracking started for ${queued} container${queued !== 1 ? "s" : ""}. ETAs will update shortly.`,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // REPAIR PER-KG LOADING PRICES
  // Finds LOADING/PENDING_VERIFICATION orders whose bales have priceUsed=0
  // but the proforma uses per_kg pricing, and recomputes each bale's price
  // using its real weight × pricePerKg.  Idempotent: already-correct bales
  // (priceUsed > 0) are left untouched.
  // ─────────────────────────────────────────────────────────────────────
  app.post("/api/factory/repair-perkg-prices", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Find all LOADING / PENDING_VERIFICATION orders that have a proforma
      const ordersToScan = await db
        .select({ id: customerOrders.id, proformaIdUsed: customerOrders.proformaIdUsed })
        .from(customerOrders)
        .where(
          and(
            eq(customerOrders.companyId, companyId),
            sql`${customerOrders.status} IN ('LOADING', 'PENDING_VERIFICATION')`,
            sql`${customerOrders.proformaIdUsed} IS NOT NULL`,
          )
        );

      let ordersScanned = 0;
      let balesRepaired = 0;
      const changedOrderIds: number[] = [];
      const errors: string[] = [];

      for (const order of ordersToScan) {
        ordersScanned++;
        try {
          // Fetch all proforma lines for this order's proforma that use per_kg
          const proformaPerKgLines = await db
            .select({
              articleCode: customerProformaLines.articleCode,
              pricingMode: customerProformaLines.pricingMode,
              pricePerKg: customerProformaLines.pricePerKg,
            })
            .from(customerProformaLines)
            .where(
              and(
                eq(customerProformaLines.proformaId, order.proformaIdUsed!),
                sql`${customerProformaLines.pricingMode} = 'per_kg'`,
                sql`${customerProformaLines.pricePerKg} IS NOT NULL AND ${customerProformaLines.pricePerKg}::numeric > 0`,
              )
            );

          if (proformaPerKgLines.length === 0) continue;

          const perKgMap = new Map<string, number>();
          for (const pl of proformaPerKgLines) {
            if (pl.articleCode && pl.pricePerKg) {
              perKgMap.set(pl.articleCode.toLowerCase(), parseFloat(String(pl.pricePerKg)));
            }
          }

          // Find all bales in this order that match a per_kg article and have priceUsed = 0
          const bales = await db
            .select({
              id: customerOrderBales.id,
              articleCode: customerOrderBales.articleCode,
              weight: customerOrderBales.weight,
              priceUsed: customerOrderBales.priceUsed,
            })
            .from(customerOrderBales)
            .where(eq(customerOrderBales.orderId, order.id));

          let orderChanged = false;
          for (const bale of bales) {
            const key = (bale.articleCode || "").toLowerCase();
            const pkgRate = perKgMap.get(key);
            if (!pkgRate) continue;
            const currentPrice = parseFloat(String(bale.priceUsed || "0"));
            if (currentPrice !== 0) continue; // already repaired — skip (idempotent)
            const weightKg = parseFloat(String(bale.weight || "0"));
            const newPrice = (weightKg * pkgRate).toFixed(2);
            await db.update(customerOrderBales)
              .set({ priceUsed: newPrice })
              .where(eq(customerOrderBales.id, bale.id));
            balesRepaired++;
            orderChanged = true;
          }

          if (orderChanged) {
            await recalculateOrderTotals(db, order.id);
            changedOrderIds.push(order.id);
          }
        } catch (err: any) {
          errors.push(`Order ${order.id}: ${err.message}`);
        }
      }

      res.json({ ordersScanned, balesRepaired, changedOrderIds, errors });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── CONTAINER DOCUMENT TYPES ───────

}
