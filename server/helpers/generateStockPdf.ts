/**
 * Stock PDF — mirrors the POS stock print template exactly:
 *   - Title    : location name (underlined, 16pt bold) — or "Godown Summary" if no location
 *   - Subtitle : "Godown Summary" (12pt bold)
 *   - 2 columns: Particulars | Closing Balance (Qty)
 *   - Negative quantities → red text + red row background (like the HTML template)
 */

import { pool } from "../db";

// ── Page geometry ─────────────────────────────────────────────────────────────
const PAGE_W   = 595;
const PAGE_H   = 842;
const MARGIN_X = 40;
const MARGIN_Y = 34;
const USABLE_W = PAGE_W - MARGIN_X * 2;   // 515 pt

// ── Columns (match HTML: qty column ≈ 140px out of 794px usable ≈ 17.6 %) ───
const COL_QTY_W  = Math.round(USABLE_W * 0.27);   // 139 pt
const COL_PART_W = USABLE_W - COL_QTY_W;           // 376 pt

const X_PART = MARGIN_X;
const X_QTY  = X_PART + COL_PART_W;

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

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateStockPdf(
  companyId:     number,
  companyName:   string,
  locationId?:   number,
  locationName?: string,
): Promise<Buffer> {

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
    .filter(r => r.qty !== 0);   // matches HTML template filter

  // Group by stock group (SQL sort order preserved)
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

  // ── Build PDF ───────────────────────────────────────────────────────────────
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ margin: 0, size: "A4", autoFirstPage: true });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const pdfReady = new Promise<Buffer>((resolve, reject) => {
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  let pageNum = 1;

  // Title = location name when we have one; otherwise just "Godown Summary"
  const mainTitle = locationName ?? "Godown Summary";

  // ── Page header ─────────────────────────────────────────────────────────────
  function drawPageHeader(): number {
    let y = MARGIN_Y;

    // Big title — underlined, 16pt bold centered
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#000000");
    doc.text(mainTitle, X_PART, y, { width: USABLE_W, align: "center", underline: true, lineBreak: false });
    y += 22;

    // Subtitle "Godown Summary" — only if we have a specific location (matches HTML which always shows both)
    if (locationName) {
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#000000");
      doc.text("Godown Summary", X_PART, y, { width: USABLE_W, align: "center", lineBreak: false });
      y += 17;
    }

    // Date — 9pt gray centered
    doc.font("Helvetica").fontSize(9).fillColor("#333333");
    doc.text(dateStr, X_PART, y, { width: USABLE_W, align: "center", lineBreak: false });
    y += 13;

    // Meta bar — thin separator then "Printed …" left, "Page N" right
    doc.save();
    doc.moveTo(X_PART, y).lineTo(X_PART + USABLE_W, y).strokeColor("#cccccc").lineWidth(0.5).stroke();
    doc.restore();
    y += 4;
    doc.font("Helvetica").fontSize(8).fillColor("#666666");
    doc.text(`Printed: ${printedStr}`, X_PART, y, { lineBreak: false });
    doc.text(`Page ${pageNum}`, X_PART, y, { width: USABLE_W, align: "right", lineBreak: false });
    y += 13;

    doc.fillColor("#000000");
    return y;
  }

  // ── Table header ─────────────────────────────────────────────────────────────
  function drawTableHeader(y: number): number {
    const H = 22;

    doc.save();
    doc.rect(X_PART, y, USABLE_W, H).fill("#ffffff");
    // Thick top + bottom borders (matches HTML 2.5px solid #111)
    doc.moveTo(X_PART, y).lineTo(X_PART + USABLE_W, y).strokeColor("#111111").lineWidth(2.5).stroke();
    doc.moveTo(X_PART, y + H).lineTo(X_PART + USABLE_W, y + H).strokeColor("#111111").lineWidth(2.5).stroke();
    doc.restore();

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000000");
    doc.text("Particulars", X_PART + 4, y + 7, { width: COL_PART_W - 8, align: "left", lineBreak: false });

    // "Closing Balance" stacked — bold 9pt then lighter 7.5pt "Quantity"
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000000");
    doc.text("Closing", X_QTY, y + 1, { width: COL_QTY_W - 4, align: "right", lineBreak: false });
    doc.text("Balance", X_QTY, y + 8, { width: COL_QTY_W - 4, align: "right", lineBreak: false });
    doc.font("Helvetica").fontSize(7.5).fillColor("#000000");
    doc.text("Quantity", X_QTY, y + 14, { width: COL_QTY_W - 4, align: "right", lineBreak: false });

    return y + H + 1;
  }

  // ── Page overflow ─────────────────────────────────────────────────────────
  function checkPage(y: number, need: number): number {
    if (y + need > PAGE_H - MARGIN_Y) {
      doc.addPage({ size: "A4" });
      pageNum++;
      let ny = drawPageHeader();
      ny = drawTableHeader(ny);
      return ny;
    }
    return y;
  }

  // ── First page ─────────────────────────────────────────────────────────────
  let y = drawPageHeader();
  y += 2;
  y = drawTableHeader(y);

  // ── Rows ─────────────────────────────────────────────────────────────────
  for (const { groupName, items } of grouped) {
    const groupQty  = items.reduce((s, r) => s + r.qty, 0);
    const firstUom  = items[0]?.uom || "BL";
    const isGroupNeg = groupQty < 0;

    // Group header row — 17pt matches CSS padding + font-size of the print template
    y = checkPage(y, 17);
    const gH = 17;
    doc.save();
    doc.rect(X_PART, y, USABLE_W, gH).fill("#e8e8e8");
    doc.moveTo(X_PART, y).lineTo(X_PART + USABLE_W, y).strokeColor("#aaaaaa").lineWidth(0.75).stroke();
    doc.moveTo(X_PART, y + gH).lineTo(X_PART + USABLE_W, y + gH).strokeColor("#aaaaaa").lineWidth(0.75).stroke();
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(isGroupNeg ? "#c2272d" : "#000000");
    doc.text(groupName, X_PART + 4, y + 4, { width: COL_PART_W - 8, align: "left",  lineBreak: false });
    doc.text(
      `${fmtQty(groupQty)}  ${firstUom}`,
      X_QTY, y + 4, { width: COL_QTY_W - 4, align: "right", lineBreak: false },
    );
    y += gH;

    // Item rows — 20pt matches CSS (9pt font × 1.6 lineHeight + 3.5px top+bottom padding)
    for (const item of items) {
      y = checkPage(y, 20);
      const iH   = 20;
      const isNeg = item.qty < 0;

      doc.save();
      if (isNeg) doc.rect(X_PART, y, USABLE_W, iH).fill("#fff0f0");
      doc.moveTo(X_PART, y + iH).lineTo(X_PART + USABLE_W, y + iH)
         .strokeColor("#cccccc").lineWidth(0.75).stroke();
      doc.restore();

      const itemFont = isNeg ? "Helvetica-Bold" : "Helvetica";
      doc.font(itemFont).fontSize(9).fillColor(isNeg ? "#c2272d" : "#222222");
      doc.text(item.itemName, X_PART + 16, y + 6, { width: COL_PART_W - 20, align: "left",  lineBreak: false });
      doc.text(
        `${fmtQty(item.qty)}  ${item.uom}`,
        X_QTY, y + 6, { width: COL_QTY_W - 4, align: "right", lineBreak: false },
      );
      y += iH;
    }
  }

  // ── Grand Total ───────────────────────────────────────────────────────────
  y = checkPage(y, 22);
  y += 2;
  const tH = 18;
  doc.save();
  doc.rect(X_PART, y, USABLE_W, tH).fill("#e8e8e8");
  doc.moveTo(X_PART, y).lineTo(X_PART + USABLE_W, y).strokeColor("#111111").lineWidth(2.5).stroke();
  doc.moveTo(X_PART, y + tH).lineTo(X_PART + USABLE_W, y + tH).strokeColor("#111111").lineWidth(2.5).stroke();
  doc.restore();
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#000000");
  doc.text("Grand Total", X_PART + 4, y + 5, { width: COL_PART_W - 8, align: "left",  lineBreak: false });
  doc.text(
    `${fmtQty(grandTotalQty)}  ${uomFirst}`,
    X_QTY, y + 5, { width: COL_QTY_W - 4, align: "right", lineBreak: false },
  );

  doc.end();
  return pdfReady;
}
