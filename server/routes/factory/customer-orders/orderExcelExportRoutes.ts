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

import { buildExportFilename, buildOrderExcelBuffer } from "./orderHelpers";

export function registerOrderExcelExportRoutes(app: Express) {
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
}
