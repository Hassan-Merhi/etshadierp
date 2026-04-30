/**
 * Stock PDF — mirrors the POS stock print template.
 *
 * Uses pdfkit's standard auto-flow mode (margin: 40) with pageAdded event
 * to reliably handle multi-page output without blank-page artifacts.
 *
 * Layout : A4, 2 columns — Particulars | Closing Balance (Qty)
 * Negatives: red text + red background row
 *
 * IMPORTANT: In PDFKit ≥0.17, doc.page.maxY is a FUNCTION, not a number.
 * ensureSpace() always calls it as a function to avoid the bug where the
 * nullish-coalescing fallback never fires (because a function is truthy),
 * making every comparison evaluate to false and silently skipping page breaks.
 */

import { pool } from "../db";

// ── Geometry (margin: 40 gives 515pt usable width, x: 40–555) ────────────────
const X_LEFT    = 40;
const X_RIGHT   = 555;
const CONTENT_W = X_RIGHT - X_LEFT;   // 515 pt
const COL_QTY_W = 95;                 // qty column width (≈18% matching HTML template)

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtQty(n: number): string {
  return Math.floor(Math.abs(n)).toLocaleString("en-US");
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }).replace(/ /g, "-");
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface StockRow {
  itemName:  string;
  groupName: string;
  uom:       string;
  qty:       number;
}

export interface StockPdfResult {
  buffer:    Buffer;
  pageCount: number;
  rowCount:  number;
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateStockPdf(
  companyId:     number,
  companyName:   string,
  locationId?:   number,
  locationName?: string,
): Promise<StockPdfResult> {

  // ── Fetch inventory ─────────────────────────────────────────────────────────
  const params: number[] = [companyId];
  let locationFilter = "";
  if (locationId) {
    params.push(locationId);
    locationFilter = `AND l.id = $${params.length}`;
  }

  const result = await pool.query<{
    item_name: string; group_name: string | null; uom: string; quantity: string;
  }>(
    `SELECT si.name AS item_name,
            sg.name AS group_name,
            si.uom,
            i.quantity
     FROM inventory i
     JOIN stock_items si ON si.id = i.stock_item_id
     LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
     JOIN locations l ON l.id = i.location_id
     WHERE l.company_id = $1
       ${locationFilter}
     ORDER BY LOWER(COALESCE(sg.name, 'zzzzz')), LOWER(si.name)`,
    params,
  );

  const rows: StockRow[] = result.rows
    .map(r => ({
      itemName:  r.item_name,
      groupName: r.group_name || "Unassigned",
      uom:       r.uom || "BL",
      qty:       parseFloat(r.quantity || "0"),
    }))
    .filter(r => r.qty !== 0);

  const grouped: { groupName: string; items: StockRow[] }[] = [];
  for (const row of rows) {
    const last = grouped[grouped.length - 1];
    if (last && last.groupName === row.groupName) last.items.push(row);
    else grouped.push({ groupName: row.groupName, items: [row] });
  }

  const grandTotalQty = rows.reduce((s, r) => s + r.qty, 0);
  const uomFirst      = rows[0]?.uom || "BL";

  const now        = new Date();
  const dateStr    = fmtDate(now);
  const printedStr = `${dateStr} ${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  const mainTitle  = locationName ?? "Godown Summary";

  // ── Build PDF (margin: 40 — reliable auto-flow mode) ─────────────────────
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margin: 40, autoFirstPage: true });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const pdfReady = new Promise<Buffer>((resolve, reject) => {
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  let pageNum = 1;

  // ── Page header + table header (drawn on every page) ─────────────────────
  function drawPageHeader(): void {
    // Title — location name, underlined, 16pt bold centered
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#000000");
    doc.text(mainTitle, X_LEFT, doc.y, { width: CONTENT_W, align: "center", underline: true, lineBreak: false });
    doc.y += 22;

    // Subtitle "Godown Summary" — only shown if a specific location was given
    if (locationName) {
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#000000");
      doc.text("Godown Summary", X_LEFT, doc.y, { width: CONTENT_W, align: "center", lineBreak: false });
      doc.y += 17;
    }

    // Date — 9pt gray centered
    doc.font("Helvetica").fontSize(9).fillColor("#333333");
    doc.text(dateStr, X_LEFT, doc.y, { width: CONTENT_W, align: "center", lineBreak: false });
    doc.y += 13;

    // Meta separator line
    doc.save();
    doc.moveTo(X_LEFT, doc.y).lineTo(X_RIGHT, doc.y).strokeColor("#cccccc").lineWidth(0.5).stroke();
    doc.restore();
    doc.y += 4;

    // "Printed: …" left  /  "Page N" right
    const metaY = doc.y;
    doc.font("Helvetica").fontSize(8).fillColor("#666666");
    doc.text(`Printed: ${printedStr}`, X_LEFT, metaY, { lineBreak: false });
    doc.text(`Page ${pageNum}`,        X_LEFT, metaY, { width: CONTENT_W, align: "right", lineBreak: false });
    doc.y = metaY + 13;

    // Table header row
    const thY = doc.y;
    const thH = 22;
    doc.save();
    doc.rect(X_LEFT, thY, CONTENT_W, thH).fill("#f8f8f8");
    doc.moveTo(X_LEFT, thY)       .lineTo(X_RIGHT, thY)       .strokeColor("#111111").lineWidth(2.5).stroke();
    doc.moveTo(X_LEFT, thY + thH).lineTo(X_RIGHT, thY + thH).strokeColor("#111111").lineWidth(2.5).stroke();
    doc.restore();

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000000");
    doc.text("Particulars",  X_LEFT + 4,            thY + 6,  { lineBreak: false });
    doc.text("Closing",      X_RIGHT - COL_QTY_W,   thY + 2,  { width: COL_QTY_W, align: "right", lineBreak: false });
    doc.text("Balance",      X_RIGHT - COL_QTY_W,   thY + 9,  { width: COL_QTY_W, align: "right", lineBreak: false });
    doc.font("Helvetica").fontSize(7.5).fillColor("#000000");
    doc.text("Quantity",     X_RIGHT - COL_QTY_W,   thY + 14, { width: COL_QTY_W, align: "right", lineBreak: false });

    // Advance cursor past the table header
    doc.y = thY + thH + 2;
    doc.fillColor("#000000");
  }

  // ── Page-bottom helper — PDFKit ≥0.17 exposes maxY as a function ──────────
  // IMPORTANT: Call maxY as a method (page.maxY()) not as a detached function.
  // Detaching it via `const raw = page.maxY` and then calling `raw()` loses the
  // `this` binding, so inside maxY(), `this.height` throws because `this` is
  // undefined in strict mode (PDFKit 0.17.2 confirmed).
  function pageBottom(): number {
    const page = doc.page as any;
    if (typeof page.maxY === "function") return page.maxY() as number;
    if (typeof page.maxY === "number")   return page.maxY;
    // Fallback: height minus the bottom margin
    return page.height - (page.margins?.bottom ?? 40);
  }

  // ── Helper: ensure at least `need` pt is available; add page if not ───────
  function ensureSpace(need: number): void {
    if (doc.y + need > pageBottom()) {
      doc.addPage();   // fires pageAdded → drawPageHeader()
    }
  }

  // Draw first page header
  drawPageHeader();

  // Draw header automatically on every new page pdfkit adds
  doc.on("pageAdded", () => {
    pageNum++;
    drawPageHeader();
  });

  // ── Group + item rows ─────────────────────────────────────────────────────
  for (const { groupName, items } of grouped) {
    const groupQty   = items.reduce((s, r) => s + r.qty, 0);
    const firstUom   = items[0]?.uom || "BL";
    const isGroupNeg = groupQty < 0;

    // Keep group header + at least one item together
    ensureSpace(17 + 20);

    // Group header row
    const gY = doc.y;
    const gH = 17;
    doc.save();
    doc.rect(X_LEFT, gY, CONTENT_W, gH).fill("#e8e8e8");
    doc.moveTo(X_LEFT, gY)      .lineTo(X_RIGHT, gY)      .strokeColor("#aaaaaa").lineWidth(0.75).stroke();
    doc.moveTo(X_LEFT, gY + gH).lineTo(X_RIGHT, gY + gH).strokeColor("#aaaaaa").lineWidth(0.75).stroke();
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(isGroupNeg ? "#c2272d" : "#000000");
    doc.text(groupName, X_LEFT + 4, gY + 4, { lineBreak: false });
    doc.text(`${fmtQty(groupQty)}  ${firstUom}`, X_RIGHT - COL_QTY_W, gY + 4, { width: COL_QTY_W, align: "right", lineBreak: false });
    doc.y = gY + gH;

    // Item rows
    for (const item of items) {
      ensureSpace(20);

      const iY   = doc.y;
      const iH   = 20;
      const isNeg = item.qty < 0;

      doc.save();
      if (isNeg) doc.rect(X_LEFT, iY, CONTENT_W, iH).fill("#fff0f0");
      doc.moveTo(X_LEFT, iY + iH).lineTo(X_RIGHT, iY + iH).strokeColor("#cccccc").lineWidth(0.75).stroke();
      doc.restore();

      doc.font(isNeg ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(isNeg ? "#c2272d" : "#222222");
      doc.text(item.itemName,                    X_LEFT + 16,          iY + 6, { lineBreak: false });
      doc.text(`${fmtQty(item.qty)}  ${item.uom}`, X_RIGHT - COL_QTY_W, iY + 6, { width: COL_QTY_W, align: "right", lineBreak: false });
      doc.y = iY + iH;
    }
  }

  // ── Grand Total row ───────────────────────────────────────────────────────
  ensureSpace(22);
  doc.y += 2;
  const tY = doc.y;
  const tH = 18;
  doc.save();
  doc.rect(X_LEFT, tY, CONTENT_W, tH).fill("#e8e8e8");
  doc.moveTo(X_LEFT, tY)      .lineTo(X_RIGHT, tY)      .strokeColor("#111111").lineWidth(2.5).stroke();
  doc.moveTo(X_LEFT, tY + tH).lineTo(X_RIGHT, tY + tH).strokeColor("#111111").lineWidth(2.5).stroke();
  doc.restore();
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#000000");
  doc.text("Grand Total",                        X_LEFT + 4,           tY + 5, { lineBreak: false });
  doc.text(`${fmtQty(grandTotalQty)}  ${uomFirst}`, X_RIGHT - COL_QTY_W, tY + 5, { width: COL_QTY_W, align: "right", lineBreak: false });

  doc.end();
  const buffer = await pdfReady;

  return { buffer, pageCount: pageNum, rowCount: rows.length };
}
