/**
 * Invoice PDF generator — replicates the POS invoice print template.
 *
 * Columns: Description | Qty | Rate | Amt | Config | P/L Bale | Total P/L
 * All monetary values are in USD (sellingPrice from sales_items).
 */

import { pool } from "../db";

// ── Page geometry ─────────────────────────────────────────────────────────────
const PAGE_W   = 595;
const PAGE_H   = 842;
const MARGIN_X = 36;
const MARGIN_Y = 36;
const USABLE_W = PAGE_W - MARGIN_X * 2;  // 523 pt

// ── Column widths (proportional to original HTML template) ───────────────────
const COL_DESC_W = Math.round(USABLE_W * 0.34);  // 178
const COL_QTY_W  = Math.round(USABLE_W * 0.07);  // 37
const COL_RATE_W = Math.round(USABLE_W * 0.10);  // 52
const COL_AMT_W  = Math.round(USABLE_W * 0.11);  // 58
const COL_CFG_W  = Math.round(USABLE_W * 0.11);  // 58
const COL_PLB_W  = Math.round(USABLE_W * 0.13);  // 68
const COL_TPL_W  = USABLE_W - COL_DESC_W - COL_QTY_W - COL_RATE_W - COL_AMT_W - COL_CFG_W - COL_PLB_W;

// ── Column x-positions ────────────────────────────────────────────────────────
const X_DESC = MARGIN_X;
const X_QTY  = X_DESC + COL_DESC_W;
const X_RATE = X_QTY  + COL_QTY_W;
const X_AMT  = X_RATE + COL_RATE_W;
const X_CFG  = X_AMT  + COL_AMT_W;
const X_PLB  = X_CFG  + COL_CFG_W;
const X_TPL  = X_PLB  + COL_PLB_W;

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtQty(n: number): string {
  const floored = Math.floor(n);
  return floored.toLocaleString("en-US");
}
function fmtUSD(n: number): string {
  return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function fmtPL(n: number): string {
  return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function plColor(n: number): string {
  if (n > 0) return "#0a7e1f";
  if (n < 0) return "#c2272d";
  return "#000000";
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface InvoiceItem {
  stockItemName:  string;
  quantity:       number;
  rateUSD:        number;
  configuredPrice: number;
}

interface InvoiceData {
  voucherNumber:  string;
  voucherDate:    string;
  description:    string | null;
  exchangeRate:   number | null;
  isCreditSale:   boolean;
  locationName:   string;
  companyName:    string;
  userName:       string;
  customerName:   string | null;
  items:          InvoiceItem[];
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateInvoicePdf(
  voucherId: number,
  companyId: number,
): Promise<Buffer> {

  // ── 1. Voucher + location + company ─────────────────────────────────────────
  const vRes = await pool.query<{
    voucher_number: string; description: string | null; exchange_rate: string | null;
    voucher_date: string; is_credit_sale: boolean; shift_id: number | null;
    location_name: string; company_name: string;
  }>(
    `SELECT v.voucher_number, v.description, v.exchange_rate, v.voucher_date,
            v.is_credit_sale, v.shift_id,
            l.name AS location_name,
            c.name AS company_name
     FROM vouchers v
     JOIN locations l  ON l.id = v.location_id
     JOIN companies c  ON c.id = v.company_id
     WHERE v.id = $1 AND v.company_id = $2
     LIMIT 1`,
    [voucherId, companyId],
  );
  if (!vRes.rows.length) throw new Error("Voucher not found");
  const v = vRes.rows[0];

  // ── 2. Sales items ───────────────────────────────────────────────────────────
  const itemsRes = await pool.query<{
    stock_item_name: string; quantity: string; selling_price: string; configured_price: string | null;
  }>(
    `SELECT s.name AS stock_item_name, si.quantity, si.selling_price, si.configured_price
     FROM sales_items si
     JOIN stock_items s ON s.id = si.stock_item_id
     WHERE si.voucher_id = $1
     ORDER BY si.id`,
    [voucherId],
  );
  const items: InvoiceItem[] = itemsRes.rows.map(r => ({
    stockItemName:   r.stock_item_name,
    quantity:        parseFloat(r.quantity || "0"),
    rateUSD:         parseFloat(r.selling_price || "0"),
    configuredPrice: parseFloat(r.configured_price || "0"),
  }));

  // ── 3. Customer name (credit sale — debit ledger account) ───────────────────
  let customerName: string | null = null;
  if (v.is_credit_sale) {
    const cRes = await pool.query<{ customer_name: string }>(
      `SELECT la.name AS customer_name
       FROM voucher_entries ve
       JOIN ledger_accounts la ON la.id = ve.ledger_account_id
       WHERE ve.voucher_id = $1 AND ve.debit_amount::numeric > 0
       LIMIT 1`,
      [voucherId],
    );
    customerName = cRes.rows[0]?.customer_name || null;
  }

  // ── 4. User name (from pos shift username) ──────────────────────────────────
  let userName = "—";
  if (v.shift_id) {
    const uRes = await pool.query<{ username: string }>(
      `SELECT username FROM pos_shifts WHERE id = $1 LIMIT 1`,
      [v.shift_id],
    );
    userName = uRes.rows[0]?.username || "—";
  }

  const data: InvoiceData = {
    voucherNumber:  v.voucher_number,
    voucherDate:    v.voucher_date,
    description:    v.description,
    exchangeRate:   v.exchange_rate ? parseFloat(v.exchange_rate) : null,
    isCreditSale:   v.is_credit_sale,
    locationName:   v.location_name,
    companyName:    v.company_name,
    userName,
    customerName,
    items,
  };

  return buildPdf(data);
}

// ── PDF builder ───────────────────────────────────────────────────────────────
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

  // ── Title ──────────────────────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#000000");
  doc.text("POS INVOICE", MARGIN_X, y, { width: USABLE_W, align: "center", lineBreak: false });
  y += 20;

  // ── Date / User row (bordered) ─────────────────────────────────────────────
  const infoH = 16;
  doc.save();
  doc.moveTo(MARGIN_X, y).lineTo(MARGIN_X + USABLE_W, y).strokeColor("#000000").lineWidth(1.5).stroke();
  doc.moveTo(MARGIN_X, y + infoH).lineTo(MARGIN_X + USABLE_W, y + infoH).strokeColor("#000000").lineWidth(1.5).stroke();
  doc.restore();
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000");
  doc.text(`Date: ${d.voucherDate}`, MARGIN_X + 2, y + 4, { lineBreak: false });
  doc.text(`User: ${d.userName}`, MARGIN_X, y + 4, { width: USABLE_W - 2, align: "right", lineBreak: false });
  y += infoH + 4;

  // ── Daily exchange rate (Mali only) ────────────────────────────────────────
  if (isMali && d.exchangeRate) {
    const rateH = 16;
    doc.save();
    doc.rect(MARGIN_X, y, USABLE_W, rateH).stroke();
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000");
    const rateLabel = "Daily Rate:";
    const rateValue = `$1 = ${Math.round(d.exchangeRate).toLocaleString("en-US")} CFA`;
    doc.text(`${rateLabel} ${rateValue}`, MARGIN_X, y + 4, { width: USABLE_W, align: "center", lineBreak: false });
    y += rateH + 4;
  }

  // ── Credit sale customer box ───────────────────────────────────────────────
  if (d.isCreditSale && d.customerName) {
    const boxH = 26;
    doc.save();
    doc.rect(MARGIN_X, y, USABLE_W, boxH).stroke();
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000");
    doc.text("CREDIT SALE", MARGIN_X + 3, y + 3, { lineBreak: false });
    doc.font("Helvetica").fontSize(8);
    doc.text(`Customer: ${d.customerName}`, MARGIN_X + 3, y + 14, { lineBreak: false });
    y += boxH + 4;
  }

  // ── Table header row ───────────────────────────────────────────────────────
  const thH = 18;
  doc.save();
  doc.rect(MARGIN_X, y, USABLE_W, thH).fill("#e0e0e0");
  doc.restore();
  drawTableBorders(doc, y, thH);
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000");
  doc.text("Description", X_DESC + 3, y + 5, { width: COL_DESC_W - 6, align: "left",   lineBreak: false });
  doc.text("Qty",         X_QTY  + 1, y + 5, { width: COL_QTY_W  - 2, align: "center", lineBreak: false });
  doc.text("Rate",        X_RATE + 1, y + 5, { width: COL_RATE_W - 2, align: "center", lineBreak: false });
  doc.text("Amt",         X_AMT  + 1, y + 5, { width: COL_AMT_W  - 2, align: "center", lineBreak: false });
  doc.text("Config",      X_CFG  + 1, y + 5, { width: COL_CFG_W  - 2, align: "center", lineBreak: false });
  doc.text("P/L Bale",    X_PLB  + 1, y + 5, { width: COL_PLB_W  - 2, align: "center", lineBreak: false });
  doc.text("Total P/L",   X_TPL  + 1, y + 5, { width: COL_TPL_W  - 2, align: "center", lineBreak: false });
  y += thH;

  // ── Item rows ──────────────────────────────────────────────────────────────
  let totalQty   = 0;
  let totalAmt   = 0;
  let totalPL    = 0;

  for (const item of d.items) {
    const amtUSD   = item.quantity * item.rateUSD;
    const plBale   = item.rateUSD - item.configuredPrice;
    const itemPL   = plBale * item.quantity;

    totalQty += item.quantity;
    totalAmt += amtUSD;
    totalPL  += itemPL;

    // Measure description height (may wrap)
    const descLines = doc.font("Helvetica").fontSize(7.5)
      .heightOfString(item.stockItemName, { width: COL_DESC_W - 6 });
    const rowH = Math.max(16, descLines + 6);

    // Row background (white alternating — just white for simplicity)
    doc.save();
    doc.rect(MARGIN_X, y, USABLE_W, rowH).fill("#ffffff");
    doc.restore();
    drawTableBorders(doc, y, rowH);

    doc.font("Helvetica").fontSize(7.5).fillColor("#000000");
    doc.text(item.stockItemName, X_DESC + 3, y + 3, { width: COL_DESC_W - 6, align: "left", lineBreak: true });

    // Numeric cells (single line each, vertically centered)
    const cy = y + (rowH - 9) / 2;
    doc.text(fmtQty(item.quantity),          X_QTY  + 1, cy, { width: COL_QTY_W  - 2, align: "center", lineBreak: false });
    doc.text(fmtUSD(item.rateUSD),           X_RATE + 1, cy, { width: COL_RATE_W - 2, align: "center", lineBreak: false });
    doc.text(fmtUSD(amtUSD),                 X_AMT  + 1, cy, { width: COL_AMT_W  - 2, align: "center", lineBreak: false });
    doc.text(fmtUSD(item.configuredPrice),   X_CFG  + 1, cy, { width: COL_CFG_W  - 2, align: "center", lineBreak: false });

    doc.fillColor(plColor(plBale));
    doc.text(fmtPL(plBale), X_PLB + 1, cy, { width: COL_PLB_W - 2, align: "center", lineBreak: false });
    doc.fillColor(plColor(itemPL));
    doc.text(fmtPL(itemPL), X_TPL + 1, cy, { width: COL_TPL_W - 2, align: "center", lineBreak: false });

    y += rowH;

    // Page break if needed (unlikely for invoice but safe)
    if (y + 20 > PAGE_H - MARGIN_Y) {
      doc.addPage({ size: "A4" });
      y = MARGIN_Y;
    }
  }

  // ── Total row ──────────────────────────────────────────────────────────────
  const totH = 16;
  doc.save();
  doc.rect(MARGIN_X, y, USABLE_W, totH).fill("#e0e0e0");
  doc.restore();
  drawTableBorders(doc, y, totH);
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000");
  doc.text("TOTAL",            X_DESC + 3, y + 4, { width: COL_DESC_W - 6, align: "left",   lineBreak: false });
  doc.text(fmtQty(totalQty),   X_QTY  + 1, y + 4, { width: COL_QTY_W  - 2, align: "center", lineBreak: false });
  doc.text("",                 X_RATE + 1, y + 4, { width: COL_RATE_W - 2, align: "center", lineBreak: false });
  doc.text(fmtUSD(totalAmt),   X_AMT  + 1, y + 4, { width: COL_AMT_W  - 2, align: "center", lineBreak: false });
  doc.text("",                 X_CFG  + 1, y + 4, { width: COL_CFG_W  - 2, align: "center", lineBreak: false });
  doc.text("",                 X_PLB  + 1, y + 4, { width: COL_PLB_W  - 2, align: "center", lineBreak: false });
  doc.fillColor(plColor(totalPL));
  doc.text(fmtPL(totalPL), X_TPL + 1, y + 4, { width: COL_TPL_W - 2, align: "center", lineBreak: false });
  y += totH + 5;

  // ── Total Paid ──────────────────────────────────────────────────────────────
  doc.save();
  doc.moveTo(MARGIN_X, y).lineTo(MARGIN_X + USABLE_W, y).strokeColor("#333333").lineWidth(1.5).stroke();
  doc.restore();
  y += 4;
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000000");
  doc.text("TOTAL PAID:", MARGIN_X, y, { lineBreak: false });
  doc.text(fmtUSD(totalAmt), MARGIN_X, y, { width: USABLE_W, align: "right", lineBreak: false });
  y += 18;

  // ── Notes ──────────────────────────────────────────────────────────────────
  if (d.description) {
    doc.save();
    doc.rect(MARGIN_X, y, USABLE_W, 14).stroke();
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000");
    doc.text("Note: ", MARGIN_X + 3, y + 3, { continued: true, lineBreak: false });
    doc.font("Helvetica");
    doc.text(d.description, { lineBreak: false });
    y += 18;
  }

  // ── Footer ──────────────────────────────────────────────────────────────────
  y += 5;
  doc.save();
  doc.moveTo(MARGIN_X, y).lineTo(MARGIN_X + USABLE_W, y).strokeColor("#000000").lineWidth(1.5).stroke();
  doc.restore();
  y += 4;
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000");
  doc.text("Thank you for your business!", MARGIN_X, y, { width: USABLE_W, align: "center", lineBreak: false });

  doc.end();
  return pdfReady;
}

// ── Draw vertical borders for a table row ─────────────────────────────────────
function drawTableBorders(doc: any, y: number, h: number): void {
  const borders = [X_DESC, X_QTY, X_RATE, X_AMT, X_CFG, X_PLB, X_TPL, X_TPL + COL_TPL_W];
  doc.save();
  doc.strokeColor("#999999").lineWidth(0.5);
  // Bottom border of each row
  doc.moveTo(MARGIN_X, y + h).lineTo(MARGIN_X + USABLE_W, y + h).stroke();
  // Vertical column separators
  for (const x of borders) {
    doc.moveTo(x, y).lineTo(x, y + h).stroke();
  }
  doc.restore();
}
