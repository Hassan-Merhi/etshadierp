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

export function buildExportFilename(parts: (string | null | undefined)[], ext: string): string {
  const safe = parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) =>
      p
        .replace(/[^\x20-\x7E]/g, "")  // strip non-ASCII / non-printable (prevents ERR_INVALID_CHAR in headers)
        .replace(/["]/g, "")            // strip double-quotes (would break the quoted header value)
        .replace(/[\\/*?:[\]<>|]/g, "") // strip filesystem-unsafe chars
        .replace(/\s+/g, "_")
        .trim()
    )
    .filter((p) => p.length > 0);
  const base = safe.join("_") || "export";
  return ext ? `${base}.${ext}` : base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helper: build the Commercial Invoice Excel workbook for an order and
// return it as a Buffer so it can be streamed to a browser download OR sent
// directly as a WhatsApp file attachment.
// ─────────────────────────────────────────────────────────────────────────────
export async function buildOrderExcelBuffer(
  orderId: number,
  companyId: number,
  hideSelling: boolean
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

  const orderChargesHelper = await db
    .select()
    .from(customerOrderCharges)
    .where(eq(customerOrderCharges.orderId, orderId));
  const rawLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));

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
  const anyPerKgH = helperLines.some((l: any) => l.pricingMode === "per_kg");

  const baseCurrency = (company as any)?.baseCurrency || "USD";
  const currencySymbolMap: Record<string, string> = {
    USD: "$",
    GBP: "£",
    EUR: "€",
    CFA: "CFA",
    XOF: "CFA",
    XAF: "CFA",
  };
  const currSym = currencySymbolMap[baseCurrency.toUpperCase()] ?? baseCurrency;
  const fmtMoney = (n: number) => `${currSym}${n % 1 === 0 ? n.toLocaleString() : n.toFixed(2)}`;
  const fmtNum = (n: number) => (n % 1 === 0 ? n.toLocaleString() : n.toFixed(2));

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
  const setFill = (cell: any, argb: string) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  };
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
  const hdrRow = sheet.addRow([
    "#",
    "Article Code",
    "Product",
    "Qty",
    "Wt/Bale",
    "Total Wt",
    ...(hideSelling ? [] : [unitPriceLabelH, "Total"]),
  ]);
  hdrRow.height = 24;
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

  let totalQtyH = 0,
    totalWtH = 0,
    totalH = 0;
  helperLines.forEach((g: any, idx: number) => {
    totalQtyH += g.qty;
    totalWtH += g.totalWt;
    totalH += g.total;
    const unitPriceH =
      g.pricingMode === "per_kg" ? (g.totalWt > 0 ? g.total / g.totalWt : g.pricePerKg || 0) : g.pricePerBale;
    const rowCells: any[] = [idx + 1, g.articleCode, g.productName, g.qty, fmtNum(g.wtPerBale), fmtNum(g.totalWt)];
    if (!hideSelling) {
      rowCells.push(fmtMoney(unitPriceH));
      rowCells.push(fmtMoney(g.total));
    }
    const dr = sheet.addRow(rowCells);
    dr.height = 20;
    dr.eachCell((cell: any) => {
      cell.font = { size: 11 };
    });
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
  if (!hideSelling) {
    totRowCells.push("");
    totRowCells.push(fmtMoney(totalH));
  }
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
    const chargeRows: [string, number][] =
      otherChargeLines.length > 0
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
      const sr = sheet.addRow(["", "", "", "", "", "", label, fmtMoney(amount)]);
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
      sr.getCell(7).border = {
        top: { style: "thin", color: { argb: "FFDDDDDD" } },
        bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
        left: { style: "thin", color: { argb: "FFDDDDDD" } },
        right: { style: "thin", color: { argb: "FFDDDDDD" } },
      };
      sr.getCell(8).border = {
        top: { style: "thin", color: { argb: "FFDDDDDD" } },
        bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
        left: { style: "thin", color: { argb: "FFDDDDDD" } },
        right: { style: "thin", color: { argb: "FFDDDDDD" } },
      };
    });
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileName = buildExportFilename([order.containerNumber, order.customerName, order.destination], "xlsx");
  return { buffer, fileName };
}
