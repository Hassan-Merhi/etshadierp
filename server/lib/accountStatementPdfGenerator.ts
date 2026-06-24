/**
 * Shared account statement PDF generator.
 * Used by both the "Export PDF" route and the WhatsApp auto-send feature.
 * Returns a Buffer so callers can either pipe it to a Response or send it to WhatsApp.
 */

import { db } from "../db";
import { storage } from "../storage";
import {
  ledgerAccounts,
  bankAccounts,
  fixedAssets,
  suppliers,
  customers,
  employees,
  vouchers,
  voucherEntries,
} from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import {
  buildFactoryCustomerLedgerEntries,
  getCustomerByLedgerId,
  getFactoryCustomerLedgerPrePeriodTotals,
} from "./factoryCustomerLedger";

export interface StatementPdfOptions {
  accountType: string;
  accountId: number;
  companyId: number;
  startDate?: string;
  endDate?: string;
  lang?: string;
}

export async function generateAccountStatementPdf(opts: StatementPdfOptions): Promise<Buffer> {
  const { accountType, accountId, companyId, startDate, endDate, lang = "en" } = opts;

  const translations: Record<
    string,
    {
      accountStatement: string;
      period: string;
      generated: string;
      colDate: string;
      colType: string;
      colParticulars: string;
      colDebit: string;
      colCredit: string;
      colBalance: string;
      openingBalance: string;
      periodTotal: string;
      closingBalance: string;
      from: string;
      upTo: string;
      allTime: string;
      dr: string;
      cr: string;
    }
  > = {
    en: {
      accountStatement: "Account Statement",
      period: "Period",
      generated: "Generated",
      colDate: "DATE",
      colType: "TYPE",
      colParticulars: "PARTICULARS",
      colDebit: "DEBIT",
      colCredit: "CREDIT",
      colBalance: "BALANCE",
      openingBalance: "Opening Balance",
      periodTotal: "Current Period Total",
      closingBalance: "Closing Balance",
      from: "From",
      upTo: "Up to",
      allTime: "All Time",
      dr: "Dr",
      cr: "Cr",
    },
    fr: {
      accountStatement: "Relevé de compte",
      period: "Période",
      generated: "Généré le",
      colDate: "DATE",
      colType: "TYPE",
      colParticulars: "LIBELLÉ",
      colDebit: "DÉBIT",
      colCredit: "CRÉDIT",
      colBalance: "SOLDE",
      openingBalance: "Solde d'ouverture",
      periodTotal: "Total de la période",
      closingBalance: "Solde de clôture",
      from: "Du",
      upTo: "Au",
      allTime: "Toute la période",
      dr: "Dt",
      cr: "Ct",
    },
    ar: {
      accountStatement: "كشف حساب",
      period: "الفترة",
      generated: "تاريخ الإنشاء",
      colDate: "التاريخ",
      colType: "النوع",
      colParticulars: "البيان",
      colDebit: "مدين",
      colCredit: "دائن",
      colBalance: "الرصيد",
      openingBalance: "الرصيد الافتتاحي",
      periodTotal: "مجموع الفترة",
      closingBalance: "الرصيد الختامي",
      from: "من",
      upTo: "حتى",
      allTime: "كل الفترات",
      dr: "مد",
      cr: "دا",
    },
  };
  const t = translations[lang] ?? translations["en"];
  const isRTL = lang === "ar";
  const isSupplier = accountType === "supplier";

  // ── 1. Fetch raw entries ──
  let rawEntries: any[] = [];
  let accountName = "";
  let rawOB = 0;
  let obSide = "Dr";

  if (accountType === "ledger") {
    const [acct] = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, accountId));
    accountName = acct?.name ?? "Ledger Account";
    // If this ledger account is linked to a customer, the customer's
    // opening balance is the authoritative source of truth.
    const [linkedCust] = await db
      .select({
        id: customers.id,
        companyId: customers.companyId,
        openingBalance: customers.openingBalance,
        openingBalanceSide: customers.openingBalanceSide,
      })
      .from(customers)
      .where(eq(customers.ledgerAccountId, accountId))
      .limit(1);
    rawOB = parseFloat(linkedCust?.openingBalance ?? acct?.openingBalance ?? "0") || 0;
    obSide = linkedCust?.openingBalanceSide ?? acct?.openingBalanceSide ?? "Dr";

    // For factory companies, use the unified customer-ledger view so the
    // statement reconciles with the Customers page balance.
    let useFactoryView = false;
    if (linkedCust) {
      const company = await storage.getCompanyById(linkedCust.companyId);
      if (company?.companyType === "factory") {
        useFactoryView = true;
      }
    }
    if (useFactoryView && linkedCust) {
      rawEntries = await buildFactoryCustomerLedgerEntries(
        linkedCust.id,
        accountId,
        linkedCust.companyId,
        startDate,
        endDate
      );
    } else {
      rawEntries = await storage.getVoucherEntriesByLedger(accountId, startDate, endDate);
    }
  } else if (accountType === "bank") {
    rawEntries = await storage.getVoucherEntriesByBankAccount(accountId, startDate, endDate);
    const [acct] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, accountId));
    accountName = acct?.name ?? "Bank Account";
    rawOB = parseFloat(acct?.openingBalance ?? "0") || 0;
    obSide = acct?.openingBalanceSide ?? "Dr";
  } else if (accountType === "fixed-asset") {
    rawEntries = await storage.getVoucherEntriesByFixedAsset(accountId, startDate, endDate);
    const [acct] = await db.select().from(fixedAssets).where(eq(fixedAssets.id, accountId));
    accountName = acct?.name ?? "Fixed Asset";
    rawOB = parseFloat(acct?.openingBalance ?? "0") || 0;
    obSide = "Dr";
  } else if (accountType === "supplier") {
    rawEntries = await storage.getVoucherEntriesBySupplier(accountId, companyId, startDate, endDate);
    const [acct] = await db.select().from(suppliers).where(eq(suppliers.id, accountId));
    accountName = (acct as any)?.legalName ?? "Supplier";
    rawOB = parseFloat((acct as any)?.openingBalance ?? "0") || 0;
    obSide = "Cr";
  } else if (accountType === "employee") {
    rawEntries = await storage.getVoucherEntriesByEmployee(accountId, companyId, startDate, endDate);
    const [acct] = await db
      .select({
        firstName: employees.firstName,
        lastName: employees.lastName,
        openingBalance: employees.openingBalance,
      })
      .from(employees)
      .where(eq(employees.id, accountId));
    accountName = acct ? `${acct.firstName} ${acct.lastName}` : "Employee";
    rawOB = parseFloat(acct?.openingBalance ?? "0") || 0;
    obSide = "Cr";
  } else if (accountType === "customer") {
    const customerStmt = await storage.getCustomerStatement(accountId, companyId, startDate, endDate);
    rawEntries = customerStmt.map((row: any) => ({
      voucherId: row.referenceId ?? row.id,
      voucherNumber: row.referenceType ? `${row.referenceType}-${row.referenceId}` : `CB-${row.id}`,
      voucherType: row.transactionType,
      voucherDate: row.transactionDate,
      voucherDescription: row.description || "",
      narration: row.description || "",
      debitAmount: row.debitAmount,
      creditAmount: row.creditAmount,
    }));
    const [acct] = await db.select().from(customers).where(eq(customers.id, accountId));
    accountName = acct?.name ?? "Customer";
    rawOB = parseFloat(acct?.openingBalance ?? "0") || 0;
    obSide = "Dr";
  } else {
    throw new Error(`Unknown account type: ${accountType}`);
  }

  // ── 2. Compute opening balance (pre-period if startDate given) ──
  let openingBalance = isSupplier ? rawOB : obSide === "Cr" ? -rawOB : rawOB;

  if (startDate) {
    // Track whether the factory-customer pre-period override has already been
    // applied; if so, we must NOT also run the generic ledger pre-period calc
    // below (which would double-count the same voucher entries).
    let factoryPrePeriodApplied = false;

    // For factory-customer ledger view, compute pre-period totals from the
    // unified entry set so the opening line matches the Customers page.
    if (accountType === "ledger") {
      const linkedCust = await getCustomerByLedgerId(accountId);
      if (linkedCust) {
        const company = await storage.getCompanyById(linkedCust.companyId);
        if (company?.companyType === "factory") {
          const tot = await getFactoryCustomerLedgerPrePeriodTotals(
            linkedCust.id,
            accountId,
            linkedCust.companyId,
            startDate
          );
          openingBalance += tot.debit - tot.credit;
          factoryPrePeriodApplied = true;
        }
      }
    }

    const typeToColumn: Record<string, any> = {
      bank: voucherEntries.bankAccountId,
      "fixed-asset": voucherEntries.fixedAssetId,
      supplier: voucherEntries.supplierId,
      employee: voucherEntries.employeeId,
      customer: voucherEntries.customerId,
    };
    // For ledger accounts, run the generic voucher-based pre-period calc
    // unless the factory-customer override already handled it. This covers
    // both unlinked ledgers AND non-factory linked ledgers (ERP companies),
    // which previously had a missing opening balance.
    if (accountType === "ledger" && !factoryPrePeriodApplied) {
      typeToColumn.ledger = voucherEntries.ledgerAccountId;
    }
    const col = typeToColumn[accountType];
    if (col) {
      const [tot] = await db
        .select({
          d: sql<string>`COALESCE(SUM(${voucherEntries.debitAmount}),0)`,
          c: sql<string>`COALESCE(SUM(${voucherEntries.creditAmount}),0)`,
        })
        .from(voucherEntries)
        .leftJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            eq(col, accountId),
            eq(vouchers.optional, false),
            isNull(vouchers.deletedAt),
            sql`${vouchers.voucherDate} < ${startDate}`
          )
        );
      const d = parseFloat(tot?.d ?? "0") || 0;
      const c = parseFloat(tot?.c ?? "0") || 0;
      openingBalance += isSupplier ? c - d : d - c;
    }
  }

  // ── 3. Group entries by voucherId ──
  const voucherMap = new Map<
    number,
    {
      voucherId: number;
      voucherNumber: string;
      voucherType: string;
      voucherDate: string;
      description: string;
      narration: string;
      totalDebit: number;
      totalCredit: number;
    }
  >();
  for (const e of rawEntries) {
    const vid = Number(e.voucherId);
    const d = parseFloat(e.debitAmount ?? "0") || 0;
    const c = parseFloat(e.creditAmount ?? "0") || 0;
    const existing = voucherMap.get(vid);
    if (existing) {
      existing.totalDebit += d;
      existing.totalCredit += c;
      if (!existing.narration && e.narration) existing.narration = e.narration;
    } else {
      voucherMap.set(vid, {
        voucherId: vid,
        voucherNumber: e.voucherNumber ?? "",
        voucherType: e.voucherType ?? "",
        voucherDate: e.voucherDate ?? "",
        description: e.voucherDescription ?? "",
        narration: e.voucherDescription || e.narration || "",
        totalDebit: d,
        totalCredit: c,
      });
    }
  }
  const rows = Array.from(voucherMap.values()).sort((a, b) => {
    const dc = new Date(a.voucherDate).getTime() - new Date(b.voucherDate).getTime();
    return dc !== 0 ? dc : a.voucherNumber.localeCompare(b.voucherNumber);
  });

  // ── 4. Running balance ──
  let running = openingBalance;
  const rowsWithBalance = rows.map((r) => {
    if (isSupplier) {
      running += r.totalCredit - r.totalDebit;
    } else {
      running += r.totalDebit - r.totalCredit;
    }
    return { ...r, runningBalance: running };
  });

  // ── 5. Company info ──
  const company = await storage.getCompanyById(companyId);
  const settings = await storage.getCompanySettings(companyId);
  const companyName = (company as any)?.name ?? "Company";
  const logoUrl: string | null = (settings as any)?.logoUrl ?? null;
  const baseCurrency = (company as any)?.baseCurrency ?? "USD";
  const currencySymbolMap: Record<string, string> = {
    USD: "$ ",
    GBP: "£",
    EUR: "€",
    CFA: "CFA ",
    XOF: "CFA ",
    XAF: "CFA ",
    CAD: "CA$ ",
    AUD: "A$ ",
    CHF: "CHF ",
    JPY: "¥",
    INR: "₹",
    AED: "AED ",
  };
  const currSym = currencySymbolMap[baseCurrency.toUpperCase()] ?? baseCurrency + " ";
  const fmtAmt = (n: number) => {
    const abs = Math.abs(n);
    const formatted = abs % 1 === 0 ? abs.toLocaleString("en") : abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return currSym + formatted;
  };
  const fmtDate = (s: string) => {
    const d = new Date(s.split("T")[0] + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  };
  const periodStr =
    startDate && endDate
      ? `${fmtDate(startDate)} — ${fmtDate(endDate)}`
      : startDate
        ? `${t.from} ${fmtDate(startDate)}`
        : endDate
          ? `${t.upTo} ${fmtDate(endDate)}`
          : t.allTime;
  const generatedStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  // ── 6. Build PDF into a Buffer ──
  const PDFDocument = (await import("pdfkit")).default;
  const fs = await import("fs");
  const pathMod = await import("path");

  const fontDir = pathMod.join(process.cwd(), "server", "fonts");
  const arabicFontPath = pathMod.join(fontDir, "Amiri-Regular.ttf");
  const hasArabicFont = fs.existsSync(arabicFontPath);

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  if (hasArabicFont) doc.registerFont("Arabic", arabicFontPath);

  const boldFont = isRTL && hasArabicFont ? "Arabic" : "Helvetica-Bold";
  const normalFont = isRTL && hasArabicFont ? "Arabic" : "Helvetica";

  let convertArabic: ((t: string) => string) | null = null;
  let bidiInst: {
    getEmbeddingLevels: (t: string, d: string) => any;
    getReorderedString: (t: string, l: any) => string;
  } | null = null;
  try {
    const reshaperMod = require("arabic-reshaper") as { convertArabic: (t: string) => string };
    convertArabic = reshaperMod.convertArabic;
    const bidiFactory = require("bidi-js") as () => typeof bidiInst;
    bidiInst = (bidiFactory as any)();
  } catch {}

  const containsArabic = (text: string): boolean => /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);

  const shapeArabic = (text: string): string => {
    if (!text || !convertArabic) return text;
    try {
      const reshaped = convertArabic(text);
      if (bidiInst) {
        const levels = bidiInst.getEmbeddingLevels(reshaped, "rtl");
        return bidiInst.getReorderedString(reshaped, levels);
      }
      return reshaped;
    } catch {
      return text;
    }
  };

  const shapeText = (text: string): string => {
    if (!text) return text;
    if (isRTL) return shapeArabic(text);
    if (containsArabic(text)) return shapeArabic(text);
    return text;
  };

  const txtOpts = (w: number, align: "left" | "right" | "center" = "left"): PDFKit.Mixins.TextOptions => {
    if (!isRTL) return { width: w, align };
    return { width: w, align: align === "left" ? "right" : align === "right" ? "left" : "center" };
  };

  // Collect chunks for Buffer output
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  // Header
  const headerY = 40;
  let logoWidth = 0;
  if (logoUrl && logoUrl.startsWith("/") && fs.existsSync(`.${logoUrl}`)) {
    try {
      doc.image(`.${logoUrl}`, 40, headerY, { height: 48, fit: [80, 48] });
      logoWidth = 90;
    } catch {}
  }
  doc
    .fontSize(18)
    .font(boldFont)
    .fillColor("#000000")
    .text(shapeText(companyName), 40 + logoWidth, headerY, txtOpts(515 - logoWidth));
  doc
    .fontSize(10)
    .font(normalFont)
    .fillColor("#555555")
    .text(shapeText(`${t.accountStatement}: ${accountName}`), 40 + logoWidth, headerY + 22, txtOpts(515 - logoWidth));

  const headerBottom = Math.max(doc.y, headerY + 52);
  doc
    .moveTo(40, headerBottom + 4)
    .lineTo(555, headerBottom + 4)
    .lineWidth(0.5)
    .strokeColor("#cccccc")
    .stroke();
  doc.lineWidth(1).strokeColor("#000000");

  const metaY = headerBottom + 10;
  doc.fillColor("#444444").fontSize(8).font(normalFont);
  doc.text(shapeText(`${t.period}: ${periodStr}`), 40, metaY, txtOpts(515));
  doc.text(shapeText(`${t.generated}: ${generatedStr}`), 40, doc.y + 2, txtOpts(515));
  doc.moveDown(0.5);

  const PAGE_H = 841.89;
  const MARGIN_BOTTOM = 60;
  const colX = [40, 110, 205, 370, 435, 500];
  const colW = [70, 95, 165, 65, 65, 55];
  const colHdrEN = [t.colDate, t.colType, t.colParticulars, t.colDebit, t.colCredit, t.colBalance];
  const colHdr = isRTL ? [...colHdrEN].reverse() : colHdrEN;
  const colAln: Array<"left" | "right"> = isRTL
    ? ["right", "right", "right", "left", "left", "left"]
    : ["left", "left", "left", "right", "right", "right"];
  const MIN_ROW_H = 14;
  const HDR_H = 15;
  const FONT_SIZE = 7.5;

  const drawTableHeader = (y: number) => {
    doc.rect(40, y, 515, HDR_H).fill("#1F3864");
    doc.fillColor("#ffffff").font(boldFont).fontSize(FONT_SIZE);
    colHdr.forEach((h, i) => {
      doc.text(shapeText(h), colX[i] + 2, y + 3.5, { width: colW[i] - 4, align: colAln[i] });
    });
    doc.fillColor("#000000").font(normalFont).fontSize(FONT_SIZE);
  };

  const tableY = doc.y + 4;
  drawTableHeader(tableY);
  let y = tableY + HDR_H;

  const calcRowH = (vals: string[]): number => {
    doc.font(normalFont).fontSize(FONT_SIZE);
    let maxH = MIN_ROW_H;
    vals.forEach((v, i) => {
      if (!v) return;
      const h = doc.heightOfString(v, { width: colW[i] - 4 }) + 6;
      if (h > maxH) maxH = h;
    });
    return maxH;
  };

  const drawRow = (vals: string[], rowH: number, bg?: string) => {
    if (bg) {
      doc.rect(40, y, 515, rowH).fill(bg);
      doc.fillColor("#000000");
    }
    vals.forEach((v, i) => {
      if (v) {
        const cellHasAr = !isRTL && hasArabicFont && containsArabic(v);
        const cellFont = cellHasAr ? "Arabic" : normalFont;
        const cellAlign = cellHasAr ? "right" : colAln[i];
        doc
          .font(cellFont)
          .fontSize(FONT_SIZE)
          .text(shapeText(v), colX[i] + 2, y + 3, { width: colW[i] - 4, align: cellAlign });
      }
    });
  };

  // Opening balance row
  const obSideLabel = openingBalance >= 0 ? (isSupplier ? t.cr : t.dr) : isSupplier ? t.dr : t.cr;
  const obDisplay = `${fmtAmt(openingBalance)} ${obSideLabel}`;
  const obRowVals = isRTL
    ? [obDisplay, "-", "-", "", t.openingBalance, ""]
    : ["", t.openingBalance, "", "-", "-", obDisplay];
  const obRowH = calcRowH(obRowVals);
  drawRow(obRowVals, obRowH, "#F0F4FF");
  y += obRowH;

  // Transaction rows
  rowsWithBalance.forEach((row, idx) => {
    const particulars = row.narration || row.description || "";
    const debitStr = row.totalDebit > 0 ? fmtAmt(row.totalDebit) : "-";
    const creditStr = row.totalCredit > 0 ? fmtAmt(row.totalCredit) : "-";
    const bal = row.runningBalance;
    const balSide = bal >= 0 ? (isSupplier ? t.cr : t.dr) : isSupplier ? t.dr : t.cr;
    const balStr = `${fmtAmt(bal)} ${balSide}`;
    const txVals = isRTL
      ? [balStr, creditStr, debitStr, particulars, row.voucherType, fmtDate(row.voucherDate)]
      : [fmtDate(row.voucherDate), row.voucherType, particulars, debitStr, creditStr, balStr];
    const rowH = calcRowH(txVals);

    if (y + rowH > PAGE_H - MARGIN_BOTTOM) {
      doc.addPage();
      y = 40;
      drawTableHeader(y);
      y += HDR_H;
    }
    const bg = idx % 2 === 1 ? "#F8F8F8" : undefined;
    drawRow(txVals, rowH, bg);
    y += rowH;
  });

  // Footer summary
  y += 3;
  doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor("#888888").stroke();
  y += 5;
  doc.lineWidth(1).strokeColor("#000000");

  const totD = rowsWithBalance.reduce((s, r) => s + r.totalDebit, 0);
  const totC = rowsWithBalance.reduce((s, r) => s + r.totalCredit, 0);
  const closingBal =
    rowsWithBalance.length > 0 ? rowsWithBalance[rowsWithBalance.length - 1].runningBalance : openingBalance;
  const closingSide = closingBal >= 0 ? (isSupplier ? t.cr : t.dr) : isSupplier ? t.dr : t.cr;

  const drawSummaryRow = (label: string, debit: string, credit: string, balance: string, isBold = false) => {
    doc.rect(40, y, 515, 16).fill(isBold ? "#1F3864" : "#EFF3FB");
    doc
      .fillColor(isBold ? "#ffffff" : "#000000")
      .font(isBold ? boldFont : normalFont)
      .fontSize(8);
    const labelX = isRTL ? colX[1] + 2 : colX[2] + 2;
    const labelW = isRTL ? colW[1] - 4 : colW[2] - 4;
    doc.text(shapeText(label), labelX, y + 4, { width: labelW, align: isRTL ? "right" : "left" });
    if (isRTL) {
      if (balance) doc.text(shapeText(balance), colX[0] + 2, y + 4, { width: colW[0] - 4, align: "right" });
      if (credit) doc.text(shapeText(credit), colX[3] + 2, y + 4, { width: colW[3] - 4, align: "left" });
      if (debit) doc.text(shapeText(debit), colX[4] + 2, y + 4, { width: colW[4] - 4, align: "left" });
    } else {
      if (debit) doc.text(debit, colX[3] + 2, y + 4, { width: colW[3] - 4, align: "right" });
      if (credit) doc.text(credit, colX[4] + 2, y + 4, { width: colW[4] - 4, align: "right" });
      if (balance) doc.text(balance, colX[5] + 2, y + 4, { width: colW[5] - 4, align: "right" });
    }
    doc.fillColor("#000000");
  };

  if (y + 52 > PAGE_H - 20) {
    doc.addPage();
    y = 40;
  }

  drawSummaryRow(t.periodTotal, fmtAmt(totD), fmtAmt(totC), "", false);
  y += 17;
  drawSummaryRow(t.closingBalance, "", "", `${fmtAmt(closingBal)} ${closingSide}`, true);

  // End and collect buffer
  return new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
