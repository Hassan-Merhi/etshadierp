/**
 * Invoice PDF — mirrors the POS invoice print template exactly.
 *
 * Columns : Description (34%) | Qty (7%) | Rate (10%) | Amt (11%) | Config (11%) | P/L Bale (13%) | Total P/L (14%)
 * Numbers : fmtPrint logic — strips trailing ".00", prefixes "$\u00A0" for currency
 * Colours : green (#0a7e1f) for profit, red (#c2272d) for loss
 */

import { pool } from "../db";

// ── Date formatting — pg driver returns date columns as JS Date objects ────────
function formatDbDate(d: unknown): string {
  if (!d) return "";
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try { return new Date(s).toISOString().slice(0, 10); } catch { return s; }
}

// ── Page geometry ─────────────────────────────────────────────────────────────
const PAGE_W   = 595;
const PAGE_H   = 842;
const MARGIN_X = 36;
const MARGIN_Y = 36;
const USABLE_W = PAGE_W - MARGIN_X * 2;   // 523 pt

// ── Column widths matching HTML template percentages ─────────────────────────
const COL_DESC_W = Math.round(USABLE_W * 0.34);
const COL_QTY_W  = Math.round(USABLE_W * 0.07);
const COL_RATE_W = Math.round(USABLE_W * 0.10);
const COL_AMT_W  = Math.round(USABLE_W * 0.11);
const COL_CFG_W  = Math.round(USABLE_W * 0.11);
const COL_PLB_W  = Math.round(USABLE_W * 0.13);
const COL_TPL_W  = USABLE_W - COL_DESC_W - COL_QTY_W - COL_RATE_W - COL_AMT_W - COL_CFG_W - COL_PLB_W;

// ── Column x-positions ────────────────────────────────────────────────────────
const X_DESC = MARGIN_X;
const X_QTY  = X_DESC + COL_DESC_W;
const X_RATE = X_QTY  + COL_QTY_W;
const X_AMT  = X_RATE + COL_RATE_W;
const X_CFG  = X_AMT  + COL_AMT_W;
const X_PLB  = X_CFG  + COL_CFG_W;
const X_TPL  = X_PLB  + COL_PLB_W;

// ── Number formatting — matches fmtPrint() in POS.tsx ────────────────────────
function fmtNum(n: number, prefix = ""): string {
  const fixed = Math.abs(n).toFixed(2).replace(/\.00$/, "");
  const parts  = fixed.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const num = parts.join(".");
  return prefix ? prefix + "\u00A0" + num : num;
}
function fmtQty(n: number):  string { return fmtNum(Math.floor(Math.abs(n))); }
function fmtUSD(n: number):  string { return fmtNum(n, "$"); }
function plColor(n: number): string {
  if (n > 0) return "#0a7e1f";
  if (n < 0) return "#c2272d";
  return "#000000";
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface InvoiceItem {
  stockItemName:   string;
  quantity:        number;
  rateUSD:         number;
  configuredPrice: number;
}
interface InvoiceData {
  voucherDate:  string;
  description:  string | null;
  exchangeRate: number | null;
  isCreditSale: boolean;
  companyName:  string;
  userName:     string;
  customerName: string | null;
  items:        InvoiceItem[];
}

// ── DB query ──────────────────────────────────────────────────────────────────
export async function generateInvoicePdf(voucherId: number, companyId: number, callerUserName?: string): Promise<Buffer> {

  // 1. Voucher header
  const vRes = await pool.query<{
    voucher_date: string; description: string | null; exchange_rate: string | null;
    is_credit_sale: boolean; shift_id: number | null;
    company_name: string;
  }>(
    `SELECT v.voucher_date, v.description, v.exchange_rate, v.is_credit_sale, v.shift_id,
            c.name AS company_name
     FROM vouchers v
     JOIN companies c ON c.id = v.company_id
     WHERE v.id = $1 AND v.company_id = $2 LIMIT 1`,
    [voucherId, companyId],
  );
  if (!vRes.rows.length) throw new Error("Voucher not found");
  const v = vRes.rows[0];

  // 2. Sales items
  const itemsRes = await pool.query<{
    stock_item_name: string; quantity: string; selling_price: string; configured_price: string | null;
  }>(
    `SELECT s.name AS stock_item_name, si.quantity, si.selling_price, si.configured_price
     FROM sales_items si
     JOIN stock_items s ON s.id = si.stock_item_id
     WHERE si.voucher_id = $1 ORDER BY si.id`,
    [voucherId],
  );
  const items: InvoiceItem[] = itemsRes.rows.map(r => ({
    stockItemName:   r.stock_item_name,
    quantity:        parseFloat(r.quantity        || "0"),
    rateUSD:         parseFloat(r.selling_price   || "0"),
    configuredPrice: parseFloat(r.configured_price || "0"),
  }));

  // 3. Customer (credit sale)
  let customerName: string | null = null;
  if (v.is_credit_sale) {
    const cRes = await pool.query<{ customer_name: string }>(
      `SELECT la.name AS customer_name
       FROM voucher_entries ve
       JOIN ledger_accounts la ON la.id = ve.ledger_account_id
       WHERE ve.voucher_id = $1 AND ve.debit_amount::numeric > 0 LIMIT 1`,
      [voucherId],
    );
    customerName = cRes.rows[0]?.customer_name || null;
  }

  // 4. User — prefer the caller's logged-in username; fall back to shift lookup
  let userName = callerUserName || "—";
  if (!callerUserName && v.shift_id) {
    const uRes = await pool.query<{ username: string }>(
      `SELECT u.username FROM pos_shifts ps
       JOIN users u ON u.id = ps.user_id
       WHERE ps.id = $1 LIMIT 1`,
      [v.shift_id],
    );
    userName = uRes.rows[0]?.username || "—";
  }

  return buildPdf({
    voucherDate:  formatDbDate(v.voucher_date),
    description:  v.description,
    exchangeRate: v.exchange_rate ? parseFloat(v.exchange_rate) : null,
    isCreditSale: v.is_credit_sale,
    companyName:  v.company_name,
    userName,
    customerName,
    items,
  });
}

// ── PDF renderer ─────────────────────────────────────────────────────────────
async function buildPdf(d: InvoiceData): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ margin: 0, size: "A4", autoFirstPage: true });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const pdfReady = new Promise<Buffer>((resolve, reject) => {
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const isMali = d.companyName.toLowerCase().includes("mali");
  let y = MARGIN_Y;

  // ── Title ─────────────────────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#000000");
  doc.text("POS INVOICE", MARGIN_X, y, { width: USABLE_W, align: "center", lineBreak: false });
  y += 20;

  // ── Date / User row ────────────────────────────────────────────────────────
  // Bordered top + bottom (1.5px solid black), 8pt bold
  const infoH = 16;
  doc.save();
  doc.moveTo(MARGIN_X, y)         .lineTo(MARGIN_X + USABLE_W, y)         .strokeColor("#000000").lineWidth(1.5).stroke();
  doc.moveTo(MARGIN_X, y + infoH).lineTo(MARGIN_X + USABLE_W, y + infoH).strokeColor("#000000").lineWidth(1.5).stroke();
  doc.restore();
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000");
  doc.text(`Date: ${d.voucherDate}`,  MARGIN_X + 2,      y + 4, { lineBreak: false });
  doc.text(`User: ${d.userName}`,     MARGIN_X,           y + 4, { width: USABLE_W - 2, align: "right", lineBreak: false });
  y += infoH + 4;

  // ── Daily exchange rate (Mali only) ────────────────────────────────────────
  if (isMali && d.exchangeRate) {
    const rateH = 16;
    doc.save();
    doc.rect(MARGIN_X, y, USABLE_W, rateH).stroke();
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000");
    const rateStr = `Daily Rate: $1 = ${Math.round(d.exchangeRate).toLocaleString("en-US")} CFA`;
    doc.text(rateStr, MARGIN_X, y + 4, { width: USABLE_W, align: "center", lineBreak: false });
    y += rateH + 4;
  }

  // ── Credit sale customer box ───────────────────────────────────────────────
  if (d.isCreditSale && d.customerName) {
    const boxH = 26;
    doc.save();
    doc.rect(MARGIN_X, y, USABLE_W, boxH).stroke();
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000");
    doc.text("CREDIT SALE",               MARGIN_X + 3, y + 3,  { lineBreak: false });
    doc.font("Helvetica").fontSize(8);
    doc.text(`Customer: ${d.customerName}`, MARGIN_X + 3, y + 14, { lineBreak: false });
    y += boxH + 4;
  }

  // ── Table header (also called after every page break) ─────────────────────
  const THR_H = 16;
  const ROW_H = 15;

  function drawTableHeader(atY: number): number {
    doc.save();
    doc.rect(MARGIN_X, atY, USABLE_W, THR_H).fill("#d8d8d8");
    doc.restore();
    drawRowBorders(doc, atY, THR_H, true);
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000");
    cellText(doc, "Description", X_DESC, COL_DESC_W, atY, THR_H, "left");
    cellText(doc, "Qty",         X_QTY,  COL_QTY_W,  atY, THR_H, "center");
    cellText(doc, "Rate",        X_RATE, COL_RATE_W,  atY, THR_H, "center");
    cellText(doc, "Amt",         X_AMT,  COL_AMT_W,   atY, THR_H, "center");
    cellText(doc, "Config",      X_CFG,  COL_CFG_W,   atY, THR_H, "center");
    cellText(doc, "P/L Bale",    X_PLB,  COL_PLB_W,   atY, THR_H, "center");
    cellText(doc, "Total P/L",   X_TPL,  COL_TPL_W,   atY, THR_H, "center");
    return atY + THR_H;
  }

  y = drawTableHeader(y);

  // ── Item rows ──────────────────────────────────────────────────────────────
  let totalQty = 0;
  let totalAmt = 0;
  let totalPL  = 0;

  for (const item of d.items) {
    const amtUSD = item.quantity * item.rateUSD;
    const plBale = item.rateUSD - item.configuredPrice;
    const itemPL = plBale * item.quantity;

    totalQty += item.quantity;
    totalAmt += amtUSD;
    totalPL  += itemPL;

    // Page break — re-draw column header on new page
    if (y + ROW_H > PAGE_H - MARGIN_Y) {
      doc.addPage({ size: "A4" });
      y = MARGIN_Y;
      y = drawTableHeader(y);
    }

    doc.save();
    doc.rect(MARGIN_X, y, USABLE_W, ROW_H).fill("#ffffff");
    doc.restore();
    drawRowBorders(doc, y, ROW_H, false);

    // All cells vertically centred at the same baseline
    const cy = y + Math.round((ROW_H - 7.5) / 2);
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000");
    doc.text(item.stockItemName,           X_DESC + 4, cy, { width: COL_DESC_W - 8,  align: "left",   lineBreak: false });
    doc.text(fmtQty(item.quantity),        X_QTY  + 1, cy, { width: COL_QTY_W  - 2,  align: "center", lineBreak: false });
    doc.text(fmtUSD(item.rateUSD),         X_RATE + 1, cy, { width: COL_RATE_W - 2,  align: "center", lineBreak: false });
    doc.text(fmtUSD(amtUSD),               X_AMT  + 1, cy, { width: COL_AMT_W  - 2,  align: "center", lineBreak: false });
    doc.text(fmtUSD(item.configuredPrice), X_CFG  + 1, cy, { width: COL_CFG_W  - 2,  align: "center", lineBreak: false });
    doc.fillColor(plColor(plBale));
    doc.text(fmtUSD(plBale),               X_PLB  + 1, cy, { width: COL_PLB_W  - 2,  align: "center", lineBreak: false });
    doc.fillColor(plColor(itemPL));
    doc.text(fmtUSD(itemPL),               X_TPL  + 1, cy, { width: COL_TPL_W  - 2,  align: "center", lineBreak: false });

    y += ROW_H;
  }

  // ── TOTAL footer row ───────────────────────────────────────────────────────
  const totH = 16;
  if (y + totH > PAGE_H - MARGIN_Y) {
    doc.addPage({ size: "A4" });
    y = MARGIN_Y;
  }
  doc.save();
  doc.rect(MARGIN_X, y, USABLE_W, totH).fill("#e0e0e0");
  doc.restore();
  drawRowBorders(doc, y, totH, true);
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000");
  cellText(doc, "TOTAL",           X_DESC, COL_DESC_W, y, totH, "left");
  cellText(doc, fmtQty(totalQty), X_QTY,  COL_QTY_W,  y, totH, "center");
  // Rate cell: blank (matches HTML template)
  // Amt
  cellText(doc, fmtUSD(totalAmt), X_AMT, COL_AMT_W, y, totH, "center");
  // Config + P/L Bale: blank
  // Total P/L
  doc.fillColor(plColor(totalPL));
  cellText(doc, fmtUSD(totalPL), X_TPL, COL_TPL_W, y, totH, "center");
  y += totH + 5;

  // ── TOTAL PAID bar ─────────────────────────────────────────────────────────
  doc.save();
  doc.moveTo(MARGIN_X, y).lineTo(MARGIN_X + USABLE_W, y).strokeColor("#333333").lineWidth(1.5).stroke();
  doc.restore();
  y += 4;
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000000");
  doc.text("TOTAL PAID:",   MARGIN_X,  y, { lineBreak: false });
  doc.text(fmtUSD(totalAmt), MARGIN_X, y, { width: USABLE_W, align: "right", lineBreak: false });
  y += 18;

  // ── Notes ──────────────────────────────────────────────────────────────────
  if (d.description) {
    doc.font("Helvetica-Bold").fontSize(7.5);
    const noteBodyH = doc.heightOfString(d.description, { width: USABLE_W - 16 });
    const noteH     = Math.ceil(noteBodyH) + 10;
    doc.save();
    doc.rect(MARGIN_X, y, USABLE_W, noteH).stroke();
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000");
    doc.text("Note: ",        MARGIN_X + 3, y + 4, { lineBreak: false });
    const noteX = MARGIN_X + 3 + doc.widthOfString("Note: ");
    doc.font("Helvetica").fontSize(7.5).fillColor("#000000");
    doc.text(d.description, noteX, y + 4, { width: USABLE_W - 6 - doc.widthOfString("Note: "), lineBreak: false });
    y += noteH + 5;
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  y += 4;
  doc.save();
  doc.moveTo(MARGIN_X, y).lineTo(MARGIN_X + USABLE_W, y).strokeColor("#000000").lineWidth(1.5).stroke();
  doc.restore();
  y += 4;
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000");
  doc.text("Thank you for your business!", MARGIN_X, y, { width: USABLE_W, align: "center", lineBreak: false });

  doc.end();
  return pdfReady;
}

// ── Draw a table row's borders (vertical column dividers + top/bottom edges) ──
function drawRowBorders(doc: any, y: number, h: number, isHeader: boolean): void {
  const colBorderColor = isHeader ? "#888888" : "#cccccc";
  const dividers = [X_DESC, X_QTY, X_RATE, X_AMT, X_CFG, X_PLB, X_TPL, X_TPL + COL_TPL_W];
  doc.save();
  doc.strokeColor(colBorderColor).lineWidth(0.5);
  // Top edge (always on header, so the table has a clean top boundary)
  if (isHeader) {
    doc.moveTo(MARGIN_X, y).lineTo(MARGIN_X + USABLE_W, y).stroke();
  }
  // Bottom edge
  doc.moveTo(MARGIN_X, y + h).lineTo(MARGIN_X + USABLE_W, y + h).stroke();
  // Vertical dividers (every column boundary including outer left + right)
  for (const x of dividers) {
    doc.moveTo(x, y).lineTo(x, y + h).stroke();
  }
  doc.restore();
}

// ── Vertically centred single-line text inside a cell ─────────────────────────
function cellText(
  doc: any,
  text: string,
  x: number,
  w: number,
  rowY: number,
  rowH: number,
  align: "left" | "center" | "right",
): void {
  const textY = rowY + Math.round((rowH - 8) / 2);
  const pad   = align === "left" ? 4 : 1;
  doc.text(text, x + pad, textY, { width: w - pad * 2, align, lineBreak: false });
}
