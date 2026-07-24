import { logAudit } from "../../helpers/auditHelpers";
import { logger } from "../../../lib/logger";
import { contentDisposition } from "../../../lib/contentDisposition";
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

import { buildExportFilename, buildOrderExcelBuffer } from "./orderHelpers";

export function registerOrderPdfExportRoutes(app: Express) {
  app.get("/api/factory/customer-orders/:id/pending-export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(orderId)) return res.status(400).json({ message: "Invalid order ID" });

      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId));
      const customerName = customer?.legalName || `order_${orderId}`;

      const baleLinks = await db
        .select()
        .from(customerOrderBales)
        .where(eq(customerOrderBales.orderId, orderId))
        .orderBy(customerOrderBales.id);

      const baleIds = baleLinks.map((b: any) => b.baleId).filter(Boolean);
      const baleRows: any[] =
        baleIds.length > 0 ? await db.select().from(factoryBales).where(inArray(factoryBales.id, baleIds)) : [];
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
          const ldRow = sheet.addRow([]);
          ldRow.height = 90;
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

      const safeName = buildExportFilename([String(orderId), customerName], "xlsx");
      const xlsBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", contentDisposition(`loading_${safeName}`));
      res.setHeader("Content-Length", xlsBuffer.byteLength);
      res.end(xlsBuffer);
    } catch (error: any) {
      logger.error("Error exporting pending loading:", { error: error });
      if (!res.headersSent) res.status(500).json({ message: error.message });
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
          .where(
            and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, invArticleCodes))
          );
        for (const p of invProds) {
          if (p.articleCode) invNameMap.set(p.articleCode, p.name);
        }
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
      res.setHeader(
        "Content-Disposition",
        contentDisposition(buildExportFilename([order.containerNumber, order.customerName, order.destination], "pdf"))
      );
      doc.pipe(res);

      const PAGE_W = doc.page.width; // 595
      const L = 40,
        R = PAGE_W - 40; // left / right margin x
      const USABLE = R - L; // 515

      const fmtN = (val: any) => {
        const n = parseFloat(val);
        if (isNaN(n)) return val ?? "";
        return n % 1 === 0 ? n.toLocaleString("en-US") : n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      };
      const fmtM = (val: any) => `$${fmtN(val)}`;

      // ── Logo (centred, fixed height so title lands below it) ─────────────────
      const logoPath = path.join(process.cwd(), "server", "hmd-logo.png");
      const LOGO_W = 200;
      const LOGO_H = 87; // ≈ 200 × (96/220) — matches actual HMD logo aspect ratio
      const LOGO_TOP = 30;
      if (fs.existsSync(logoPath)) {
        try {
          doc.image(logoPath, (PAGE_W - LOGO_W) / 2, LOGO_TOP, {
            width: LOGO_W,
            height: LOGO_H,
            fit: [LOGO_W, LOGO_H],
          });
        } catch {}
      }
      const afterLogo = LOGO_TOP + LOGO_H + 10;

      // ── Title ─────────────────────────────────────────────────────────────────
      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("INVOICE", L, afterLogo, { width: USABLE, align: "center" });

      // ── Divider ───────────────────────────────────────────────────────────────
      const divY = doc.y + 6;
      doc.moveTo(L, divY).lineTo(R, divY).lineWidth(0.5).strokeColor("#cccccc").stroke();
      doc.lineWidth(1).strokeColor("#000000");

      // ── Meta block ───────────────────────────────────────────────────────────
      const metaY = divY + 12;
      const dateStr = order.orderDate
        ? new Date(order.orderDate + "T00:00:00").toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
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
        doc.font("Helvetica-Bold").text(`${label}  `, L, mY, { continued: true }).font("Helvetica").text(value);
        mY = doc.y + 2;
      }

      doc.moveDown(0.8);

      // ── Column layout ─────────────────────────────────────────────────────────
      let colX: number[], colW: number[], colHdr: string[], colAlign: Array<"left" | "right" | "center">;
      if (hideSellingPdf) {
        colX = [40, 62, 132, 382, 428, 476];
        colW = [22, 70, 250, 46, 48, 79];
        colHdr = ["#", "Code", "Product", "Qty", "Wt/Bale", "Total Wt"];
        colAlign = ["center", "center", "left", "center", "center", "center"];
      } else {
        colX = [40, 62, 132, 310, 356, 402, 450, 503];
        colW = [22, 70, 178, 46, 46, 48, 53, 52];
        colHdr = ["#", "Code", "Product", "Qty", "Wt/Bale", "Total Wt", "Price/Bale", "Total"];
        colAlign = ["center", "center", "left", "center", "center", "center", "center", "center"];
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
      let totalQty = 0,
        totalWt = 0,
        totalAmt = 0;

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
          : [
              String(idx + 1),
              line.articleCode || "",
              productName,
              fmtN(qty),
              fmtN(wtBale),
              fmtN(totWt),
              fmtM(price),
              fmtM(totPrice),
            ];
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
            doc
              .text(ch.name || ch.chargeType, L + 10, y, { continued: true })
              .text(fmtM(ch.amount), { align: "right", width: USABLE - 10 });
            y = doc.y + 2;
          }
          y += 4;
        }

        // Summary box
        const summaryRows: [string, string, boolean][] = [["Subtotal (Bales)", fmtM(order.subtotalBales), false]];
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
          if (y + 18 > doc.page.height - 40) {
            doc.addPage();
            y = 40;
          }
          if (isGrand) {
            doc.rect(boxX, y, BOX_W, 18).fill("#1F3864");
            doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10);
            doc.text(label, boxX + 8, y + 4, { continued: true }).text(value, { align: "right", width: BOX_W - 16 });
            doc.fillColor("#000000").font("Helvetica").fontSize(9);
          } else {
            doc
              .moveTo(boxX, y + 16)
              .lineTo(R, y + 16)
              .lineWidth(0.3)
              .strokeColor("#cccccc")
              .stroke();
            doc.lineWidth(1).strokeColor("#000000");
            doc.text(label, boxX + 8, y + 4, { continued: true }).text(value, { align: "right", width: BOX_W - 16 });
          }
          y += 18;
        }
      }

      // Non-fatal: audit write must not break PDF delivery
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || req.session.userId!,
          companyId,
          action: "export",
          tableName: "factory_customer_orders",
          recordId: orderId,
          recordIdentifier: `Customer Order #${(order as any).invoiceNumber || orderId} PDF`,
          changes: { format: { old: null, new: "pdf" }, orderId: { old: null, new: orderId } },
        });
      } catch (auditErr) {
        logger.error("[PdfExport] audit write failed:", { error: auditErr });
      }
      doc.end();
    } catch (error: any) {
      logger.error("Error exporting order to PDF:", { error: error });
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
          .where(
            and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, missingCodes))
          );
        for (const p of prods) {
          if (p.articleCode) productNameMap.set(p.articleCode, p.name);
        }
      }

      // Build rows: proforma items first, then extra (NOT REQUESTED) items
      type LoadRow = {
        articleCode: string;
        productName: string;
        requested: number;
        loaded: number;
        diff: number;
        status: string;
      };
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
        { key: "c1", width: 6 }, // #
        { key: "c2", width: 16 }, // Article Code
        { key: "c3", width: 32 }, // Product
        { key: "c4", width: 13 }, // Requested
        { key: "c5", width: 13 }, // Loaded
        { key: "c6", width: 11 }, // Diff
        { key: "c7", width: 20 }, // Status
      ];

      const DARK_BLUE = "FF1F3864";
      const WHITE = "FFFFFFFF";
      const LIGHT_GRAY = "FFF5F5F5";
      const GREEN_BG = "FFE8F5E9";
      const RED_BG = "FFFDECEA";
      const ORANGE_BG = "FFFFF3E0";
      const YELLOW_BG = "FFFFFDE7";

      const statusStyle: Record<string, { bg: string; fg: string }> = {
        LOADED: { bg: GREEN_BG, fg: "FF2E7D32" },
        OVERLOADED: { bg: RED_BG, fg: "FFC62828" },
        "LESS LOADED": { bg: ORANGE_BG, fg: "FFE65100" },
        "NOT REQUESTED": { bg: YELLOW_BG, fg: "FFF57F17" },
        "NOT LOADED": { bg: "FFEEEEEE", fg: "FF555555" },
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
      const dateStr = order.orderDate
        ? new Date(order.orderDate).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" })
        : "-";

      const details = [
        ["Invoice No.", invoiceNum],
        ["Customer", order.customerName || "-"],
        ["Date", dateStr],
        ["Container", order.containerNumber || "-"],
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
        cell.border = {
          top: { style: "thin", color: { argb: WHITE } },
          bottom: { style: "thin", color: { argb: WHITE } },
          left: { style: "thin", color: { argb: WHITE } },
          right: { style: "thin", color: { argb: WHITE } },
        };
      });

      // Data rows
      rows.forEach((row, idx) => {
        const style = statusStyle[row.status] || { bg: LIGHT_GRAY, fg: "FF000000" };
        const diffLabel = row.diff === 0 ? "0" : row.diff > 0 ? `+${row.diff}` : `${row.diff}`;
        const dr = sheet.addRow([
          idx + 1,
          row.articleCode,
          row.productName,
          row.requested,
          row.loaded,
          diffLabel,
          row.status,
        ]);
        dr.height = 20;
        dr.eachCell((cell: any) => {
          cell.font = { size: 11 };
        });
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
      const totRow = sheet.addRow([
        "",
        "",
        "Totals",
        totalRequested,
        totalLoaded,
        totalDiff === 0 ? "0" : totalDiff > 0 ? `+${totalDiff}` : `${totalDiff}`,
        "",
      ]);
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
      const legend: [string, (typeof statusStyle)[string]][] = [
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
        { key: "num", width: 6 }, // #
        { key: "ref", width: 22 }, // Reference Number
        { key: "code", width: 16 }, // Article Code
        { key: "prod", width: 32 }, // Product Name
      ];

      const refHdr = refSheet.addRow(["#", "Reference Number", "Article Code", "Product"]);
      refHdr.height = 24;
      refHdr.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
        setFill(cell, DARK_BLUE);
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = {
          top: { style: "thin", color: { argb: WHITE } },
          bottom: { style: "thin", color: { argb: WHITE } },
          left: { style: "thin", color: { argb: WHITE } },
          right: { style: "thin", color: { argb: WHITE } },
        };
      });

      // Build per-bale rows sorted by article code then reference number
      const baleRefRows = baleLinks
        .map((link) => {
          const code = link.productArticleCode || link.baleArticleCode || link.orderBaleArticleCode || "";
          const refNum = link.baleReferenceNumber || link.baleCode || `BALE-${link.baleId}`;
          const prodName =
            productNameMap.get(code) || link.productName || link.baleProductName || link.baleName || code;
          return { code, refNum, prodName };
        })
        .filter((r) => r.refNum)
        .sort((a, b) => a.code.localeCompare(b.code) || a.refNum.localeCompare(b.refNum));

      baleRefRows.forEach((r, idx) => {
        const dr = refSheet.addRow([idx + 1, r.refNum, r.code, r.prodName]);
        dr.height = 20;
        dr.eachCell((cell: any) => {
          cell.font = { size: 11 };
        });
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
      const xlsBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader(
        "Content-Disposition",
        contentDisposition(buildExportFilename([order.containerNumber, order.customerName, order.destination], "xlsx"))
      );
      res.setHeader("Content-Length", xlsBuffer.byteLength);
      res.end(xlsBuffer);
    } catch (error: any) {
      logger.error("Error exporting loading status:", { error: error });
      if (!res.headersSent) res.status(500).json({ message: error.message });
    }
  });

  // ─────── INVOICE CONTAINER TRACKING ─────────────────────────────────────
  // GET /api/factory/invoice-container-tracking
  // Returns all VERIFIED / FINALIZED factory invoices that have a container
  // number, enriched with ETA + tracking status from the ERP containers table
  // (the Maersk / CMA auto-tracking system).
}
