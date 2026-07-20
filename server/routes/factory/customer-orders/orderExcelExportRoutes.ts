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
import ExcelJS from "exceljs";
import os from "os";
import crypto from "crypto";
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

// ─────────────────────────────────────────────────────────────────────────────
// Shared invoice workbook builder
// Both /export/excel and /export-excel routes call this so that hardening,
// logging, and bug fixes are never applied to just one of them.
// ─────────────────────────────────────────────────────────────────────────────

interface InvoiceLineData {
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

interface InvoiceChargeData {
  name: string | null;
  amount: string | null;
  chargeType: string;
}

interface InvoiceWorkbookParams {
  orderId: number;
  companyId: number;
  invoiceNumber: string;
  orderDate: string | null;
  containerNumber: string | null;
  customerName: string | null;
  baseCurrency: string;
  lines: InvoiceLineData[];
  charges: InvoiceChargeData[];
  subtotalBales: string | null;
  freightAmount: string | null;
  otherChargesTotal: string | null;
  grandTotal: string | null;
  hideSelling: boolean;
  noCharges: boolean;
}

function normalizeExcelBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  const candidate = value as any;
  if (
    candidate?.buffer instanceof ArrayBuffer &&
    typeof candidate.byteOffset === "number" &&
    typeof candidate.byteLength === "number"
  ) {
    return Buffer.from(candidate.buffer, candidate.byteOffset, candidate.byteLength);
  }
  throw new Error(`Unsupported ExcelJS buffer result: ${Object.prototype.toString.call(value)}`);
}

async function buildInvoiceWorkbookBuffer(params: InvoiceWorkbookParams): Promise<Buffer> {
  const { orderId, companyId, hideSelling, noCharges } = params;

  // Sanitize helpers — used throughout to prevent NaN/null/undefined reaching ExcelJS cells.
  const safeStr = (v: any): string => (v == null ? "" : String(v));
  const safeNum = (v: any): number => { const n = Number(v); return isFinite(n) ? n : 0; };

  console.log(`[ExcelExport] orderId=${orderId} companyId=${companyId} stage=started`);

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

  const merge = (r: number, c1: number, c2: number) => { try { sheet.mergeCells(r, c1, r, c2); } catch {} };
  const setFill = (cell: any, argb: string) => {
    try { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } }; } catch {}
  };
  const setBorder = (row: any) => {
    try {
      row.eachCell((cell: any) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFDDDDDD" } },
          bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
          left: { style: "thin", color: { argb: "FFDDDDDD" } },
          right: { style: "thin", color: { argb: "FFDDDDDD" } },
        };
      });
    } catch {}
  };

  // Currency formatting
  const currencySymbolMap: Record<string, string> = {
    USD: "$", GBP: "£", EUR: "€", CFA: "CFA", XOF: "CFA", XAF: "CFA",
  };
  const currSym = currencySymbolMap[(params.baseCurrency || "USD").toUpperCase()] ?? params.baseCurrency;
  const fmtMoney = (n: number) => {
    const v = safeNum(n);
    return `${currSym}${v % 1 === 0 ? v.toLocaleString() : v.toFixed(2)}`;
  };
  const fmtNum = (n: number) => {
    const v = safeNum(n);
    return v % 1 === 0 ? v.toLocaleString() : v.toFixed(2);
  };

  // ── Spacer row (logo removed — image serialization caused empty buffers in production) ──
  const logoRow = sheet.addRow([]);
  logoRow.height = 20;

  // ── Company name ──
  const r1 = sheet.addRow(["HMD INTERNATIONAL GROUP"]);
  r1.height = 26;
  try {
    r1.getCell(1).font = { bold: true, size: 16, color: { argb: DARK_BLUE } };
    r1.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    merge(r1.number, 1, COL);
  } catch {}

  // ── "Commercial Invoice" title ──
  const r2 = sheet.addRow(["Commercial Invoice"]);
  r2.height = 22;
  try {
    r2.getCell(1).font = { bold: true, size: 14, color: { argb: DARK_BLUE } };
    r2.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    merge(r2.number, 1, COL);
  } catch {}
  sheet.addRow([]);

  // ── Invoice details block ──
  const invoiceNum = safeStr(params.invoiceNumber) || `INV-${String(orderId).padStart(6, "0")}`;
  const orderDateFmt = params.orderDate
    ? new Date(params.orderDate).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" })
    : "-";

  const details: [string, string][] = [
    ["Invoice No.", invoiceNum],
    ["Customer", safeStr(params.customerName) || "-"],
    ["Date", orderDateFmt],
    ["Container", safeStr(params.containerNumber) || "-"],
  ];
  try {
    for (const [label, value] of details) {
      const dr = sheet.addRow(["", "", "", "", "", label, "", value]);
      dr.height = 20;
      dr.getCell(6).font = { bold: true, size: 11 };
      dr.getCell(6).alignment = { horizontal: "right" };
      dr.getCell(8).font = { size: 11 };
      dr.getCell(8).alignment = { horizontal: "left" };
      merge(dr.number, 6, 7);
    }
  } catch {}
  sheet.addRow([]);

  // ── Table header ──
  const anyPerKg = params.lines.some((l) => l.pricingMode === "per_kg");
  const unitPriceLabel = anyPerKg ? "Price/KG" : "Price/Bale";
  const hdrRow = sheet.addRow([
    "#", "Article Code", "Product", "Qty", "Wt/Bale", "Total Wt",
    ...(hideSelling ? [] : [unitPriceLabel, "Total"]),
  ]);
  hdrRow.height = 24;
  try {
    hdrRow.eachCell((cell: any) => {
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
  } catch {}

  // ── Data rows ──
  console.log(`[ExcelExport] orderId=${orderId} stage=writing-rows count=${params.lines.length}`);
  let totalQty = 0, totalWtAll = 0, totalAll = 0;
  params.lines.forEach((g, idx) => {
    const qty   = safeNum(g.qty);
    const wt    = safeNum(g.totalWt);
    const tot   = safeNum(g.total);
    totalQty    += qty;
    totalWtAll  += wt;
    totalAll    += tot;
    const unitPrice =
      g.pricingMode === "per_kg"
        ? (safeNum(g.totalWt) > 0 ? tot / safeNum(g.totalWt) : safeNum(g.pricePerKg))
        : safeNum(g.pricePerBale);
    const rowCells: any[] = [
      idx + 1,
      safeStr(g.articleCode),
      safeStr(g.productName),
      qty,
      fmtNum(g.wtPerBale),
      fmtNum(g.totalWt),
    ];
    if (!hideSelling) {
      rowCells.push(fmtMoney(unitPrice));
      rowCells.push(fmtMoney(tot));
    }
    const dr = sheet.addRow(rowCells);
    dr.height = 20;
    try {
      dr.eachCell((cell: any) => { cell.font = { size: 11 }; });
      if (idx % 2 === 1) {
        dr.eachCell((cell: any) => setFill(cell, LIGHT_GRAY));
      }
      dr.getCell(1).alignment = { horizontal: "center" };
      dr.getCell(4).alignment = { horizontal: "right" };
      dr.getCell(5).alignment = { horizontal: "right" };
      dr.getCell(6).alignment = { horizontal: "right" };
      if (!hideSelling) {
        dr.getCell(7).alignment = { horizontal: "right" };
        dr.getCell(8).alignment = { horizontal: "right" };
      }
      setBorder(dr);
    } catch {}
  });

  // ── Totals row ──
  const totRowCells: any[] = ["", "", "Totals", totalQty, "", fmtNum(totalWtAll)];
  if (!hideSelling) {
    totRowCells.push("");
    totRowCells.push(fmtMoney(totalAll));
  }
  const totRow = sheet.addRow(totRowCells);
  totRow.height = 22;
  try {
    totRow.eachCell((cell: any) => {
      cell.font = { bold: true, size: 11, color: { argb: WHITE } };
      setFill(cell, DARK_BLUE);
      cell.alignment = { horizontal: "right" };
    });
    totRow.getCell(3).alignment = { horizontal: "center" };
    totRow.getCell(4).alignment = { horizontal: "right" };
    totRow.getCell(6).alignment = { horizontal: "right" };
    if (!hideSelling) totRow.getCell(8).alignment = { horizontal: "right" };
  } catch {}

  sheet.addRow([]);

  // ── Financial summary (optional — failure here must NOT abort the export) ──
  if (!hideSelling && !noCharges) {
    try {
      const subtotal         = safeNum(parseFloat(params.subtotalBales     || "0"));
      const freight          = safeNum(parseFloat(params.freightAmount      || "0"));
      const otherChargesTotal = safeNum(parseFloat(params.otherChargesTotal || "0"));
      const grandTotal       = safeNum(parseFloat(params.grandTotal         || "0"));

      const otherChargeLines = params.charges.filter((ch) => ch.chargeType !== "FREIGHT");
      const chargeRows: [string, number][] =
        otherChargeLines.length > 0
          ? otherChargeLines.map((ch) => [safeStr(ch.name) || "Charge", safeNum(parseFloat(ch.amount || "0"))] as [string, number])
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
        const sr = sheet.addRow(["", "", "", "", "", "", safeStr(label), fmtMoney(amount)]);
        sr.height = 20;
        const isGrandTotal = idx === summaryData.length - 1;
        const bg = isGrandTotal ? DARK_BLUE : idx % 2 === 0 ? WHITE : LIGHT_GRAY;
        const fg = isGrandTotal ? WHITE : "FF000000";
        setFill(sr.getCell(7), bg);
        setFill(sr.getCell(8), bg);
        sr.getCell(7).font = { bold: isGrandTotal, size: 11, color: { argb: fg } };
        sr.getCell(8).font = { bold: isGrandTotal, size: 11, color: { argb: fg } };
        sr.getCell(7).alignment = { horizontal: "left" };
        sr.getCell(8).alignment = { horizontal: "right" };
        const thinBorder = {
          top: { style: "thin", color: { argb: "FFDDDDDD" } },
          bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
          left: { style: "thin", color: { argb: "FFDDDDDD" } },
          right: { style: "thin", color: { argb: "FFDDDDDD" } },
        };
        sr.getCell(7).border = thinBorder;
        sr.getCell(8).border = thinBorder;
      });
    } catch (summaryErr: any) {
      console.warn(`[ExcelExport] orderId=${orderId} stage=summary-skipped reason=${summaryErr.message}`);
    }
  }

  // ── Write buffer (with temp-file fallback if writeBuffer produces empty output) ──
  console.log(`[ExcelExport] orderId=${orderId} stage=writebuffer-started`);
  let xlsBuffer = normalizeExcelBuffer(await workbook.xlsx.writeBuffer());
  console.log(`[ExcelExport] orderId=${orderId} stage=writebuffer-complete bytes=${xlsBuffer.length}`);

  if (xlsBuffer.length === 0) {
    // Primary serialization produced an empty buffer. Retry via a temp file.
    console.warn(`[ExcelExport] orderId=${orderId} stage=writebuffer-empty-retrying-file`);
    const tempPath = path.join(os.tmpdir(), `invoice-${crypto.randomUUID()}.xlsx`);
    try {
      await workbook.xlsx.writeFile(tempPath);
      xlsBuffer = normalizeExcelBuffer(await fs.promises.readFile(tempPath));
      console.log(`[ExcelExport] orderId=${orderId} stage=writefile-complete bytes=${xlsBuffer.length}`);
    } finally {
      fs.promises.unlink(tempPath).catch(() => {});
    }
  }

  if (xlsBuffer.length < 2) {
    throw new Error("Generated workbook buffer is too small");
  }

  // Verify ZIP/XLSX magic bytes via Buffer methods — never index-access .toString()
  const signature = xlsBuffer.subarray(0, 2).toString("ascii");
  if (signature !== "PK") {
    const signatureHex = xlsBuffer.subarray(0, 2).toString("hex");
    throw new Error(`Generated buffer has invalid XLSX signature: ${signatureHex || "missing"}`);
  }

  console.log(`[ExcelExport] orderId=${orderId} stage=buffer-validated bytes=${xlsBuffer.length}`);
  return xlsBuffer;
}

export function registerOrderExcelExportRoutes(app: Express) {
  app.get("/api/factory/customer-orders/:id/export/excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(orderId)) return res.status(400).json({ message: "Invalid order ID" });

      const { hideSelling: hideSellingXls1 } = await getExportPriceVisibility(req);

      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId));
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));

      const baleLinks = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const baleIds = baleLinks.map((b: any) => b.baleId).filter(Boolean);
      const baleRows: any[] =
        baleIds.length > 0 ? await db.select().from(factoryBales).where(inArray(factoryBales.id, baleIds)) : [];
      const orderCharges = await db
        .select()
        .from(customerOrderCharges)
        .where(eq(customerOrderCharges.orderId, orderId));

      const productIds = [...new Set(baleRows.map((b: any) => b.productId).filter((id: any) => id != null))];
      const productRecords: any[] =
        productIds.length > 0
          ? await db
              .select()
              .from(factoryBaleProducts)
              .where(inArray(factoryBaleProducts.id, productIds as number[]))
          : [];
      const productMap = new Map<number, any>(productRecords.map((p: any) => [p.id, p]));
      const balePriceMap = new Map<number, number>(
        baleLinks.map((l: any) => [l.baleId, parseFloat(l.priceUsed || "0")])
      );

      // Also read order lines for pricing mode metadata
      const orderLinesForXls = await db
        .select()
        .from(customerOrderLines)
        .where(eq(customerOrderLines.orderId, orderId));
      const orderLinePricingMap = new Map<string, { pricingMode: string; pricePerKg: number }>();
      for (const ol of orderLinesForXls) {
        orderLinePricingMap.set((ol.articleCode || "").toLowerCase(), {
          pricingMode: (ol as any).pricingMode || "per_bale",
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
        const pricingInfo = orderLinePricingMap.get(articleCode.toLowerCase()) || {
          pricingMode: "per_bale",
          pricePerKg: 0,
        };
        if (!grouped.has(articleCode)) {
          grouped.set(articleCode, {
            articleCode,
            productName,
            qty: 0,
            wtPerBale,
            totalWt: 0,
            pricePerBale: price,
            total: 0,
            pricingMode: pricingInfo.pricingMode,
            pricePerKg: pricingInfo.pricePerKg,
          });
        }
        const g = grouped.get(articleCode)!;
        g.qty += 1;
        g.totalWt += parseFloat(bale.weightKg || wtPerBale.toString());
        g.total += price;
      }

      const lines = Array.from(grouped.values()).sort((a, b) => a.articleCode.localeCompare(b.articleCode));

      const fileName = buildExportFilename([order.containerNumber, customer?.legalName, order.destination], "xlsx");
      const xlsBuffer = await buildInvoiceWorkbookBuffer({
        orderId: orderId!,
        companyId,
        invoiceNumber: order.invoiceNumber || "",
        orderDate: order.orderDate ?? null,
        containerNumber: order.containerNumber ?? null,
        customerName: customer?.legalName ?? null,
        baseCurrency: (company as any)?.baseCurrency || "USD",
        lines: lines.map((g) => ({
          articleCode: g.articleCode,
          productName: g.productName,
          qty: g.qty,
          wtPerBale: g.wtPerBale,
          totalWt: g.totalWt,
          pricePerBale: g.pricePerBale,
          total: g.total,
          pricingMode: g.pricingMode,
          pricePerKg: g.pricePerKg,
        })),
        charges: orderCharges.map((ch: any) => ({
          name: ch.name ?? null,
          amount: ch.amount ?? null,
          chargeType: ch.chargeType || "",
        })),
        subtotalBales: order.subtotalBales ?? null,
        freightAmount: order.freightAmount ?? null,
        otherChargesTotal: order.otherChargesTotal ?? null,
        grandTotal: order.grandTotal ?? null,
        hideSelling: hideSellingXls1,
        noCharges: false,
      });
      res.status(200);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", contentDisposition(fileName));
      res.setHeader("Content-Length", String(xlsBuffer.length));
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(xlsBuffer);
      console.log(`[ExcelExport] orderId=${orderId} stage=response-sent bytes=${xlsBuffer.length}`);
    } catch (error: any) {
      console.error(`[ExcelExport] /export/excel failed:`, error.message, error.stack);
      if (!res.headersSent) res.status(500).json({ message: error.message });
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

      const orderCharges2 = await db
        .select()
        .from(customerOrderCharges)
        .where(eq(customerOrderCharges.orderId, orderId));
      const rawLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));

      // Canonical product names from factoryBaleProducts
      const articleCodes = [...new Set(rawLines.map((l: any) => l.articleCode).filter(Boolean))];
      const productNameMap = new Map<string, string>();
      const wtPerBaleMap = new Map<string, number>();
      if (articleCodes.length > 0) {
        const products = await db
          .select({
            articleCode: factoryBaleProducts.articleCode,
            name: factoryBaleProducts.name,
            weightPerBaleKg: factoryBaleProducts.weightPerBaleKg,
          })
          .from(factoryBaleProducts)
          .where(
            and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, articleCodes))
          );
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

      const fileName = buildExportFilename([order.containerNumber, order.customerName, order.destination], "xlsx");
      const xlsBuffer = await buildInvoiceWorkbookBuffer({
        orderId: orderId!,
        companyId,
        invoiceNumber: order.invoiceNumber || "",
        orderDate: order.orderDate ?? null,
        containerNumber: order.containerNumber ?? null,
        customerName: order.customerName ?? null,
        baseCurrency: (company as any)?.baseCurrency || "USD",
        lines: lines.map((l: any) => ({
          articleCode: l.articleCode,
          productName: l.productName,
          qty: l.qty,
          wtPerBale: l.wtPerBale,
          totalWt: l.totalWt,
          pricePerBale: l.pricePerBale,
          total: l.total,
          pricingMode: l.pricingMode,
          pricePerKg: l.pricePerKg,
        })),
        charges: orderCharges2.map((ch: any) => ({
          name: ch.name ?? null,
          amount: ch.amount ?? null,
          chargeType: ch.chargeType || "",
        })),
        subtotalBales: order.subtotalBales ?? null,
        freightAmount: order.freightAmount ?? null,
        otherChargesTotal: order.otherChargesTotal ?? null,
        grandTotal: order.grandTotal ?? null,
        hideSelling: hideSellingXls2,
        noCharges: noChargesXls,
      });
      res.status(200);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", contentDisposition(fileName));
      res.setHeader("Content-Length", String(xlsBuffer.length));
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(xlsBuffer);
      console.log(`[ExcelExport] orderId=${orderId} stage=response-sent bytes=${xlsBuffer.length}`);
    } catch (error: any) {
      console.error(`[ExcelExport] /export-excel failed:`, error.message, error.stack);
      if (!res.headersSent) {
        res.status(500).json({ message: error.message });
      }
    }
  });

  // ───────────────────────────────────────────────
  // PENDING LOADING — BALE-LEVEL EXCEL EXPORT
  // ───────────────────────────────────────────────
}
