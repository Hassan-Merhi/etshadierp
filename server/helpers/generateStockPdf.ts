/**
 * Stock PDF — two modes:
 *   hideCost = false (default): Particulars | Closing Balance (Qty) | Avg Rate | Total Value
 *   hideCost = true  (POS):    Particulars | Closing Balance (Qty)  only — no cost columns
 */

import { pool } from "../db";

// ── Page geometry (points) ────────────────────────────────────────────────────
const PAGE_W   = 595;
const PAGE_H   = 842;
const MARGIN_X = 40;
const MARGIN_Y = 34;
const USABLE_W = PAGE_W - MARGIN_X * 2;   // 515 pt

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtQty(n: number): string {
  return Math.floor(n).toLocaleString("en-US");
}
function fmtAmt(n: number): string {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }).replace(/ /g, "-");
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface StockRow {
  itemName:   string;
  groupName:  string;
  uom:        string;
  qty:        number;
  avgRate:    number;
  totalValue: number;
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateStockPdf(
  companyId:    number,
  companyName:  string,
  locationId?:  number,
  locationName?: string,
  hideCost = false,
): Promise<Buffer> {

  // ── Fetch inventory ─────────────────────────────────────────────────────────
  const params: (number)[] = [companyId];
  let locationFilter = "";
  if (locationId) {
    params.push(locationId);
    locationFilter = `AND l.id = $${params.length}`;
  }

  const result = await pool.query<{
    item_name: string; group_name: string | null; uom: string;
    quantity: string; average_rate: string; total_value: string;
  }>(
    `SELECT si.name  AS item_name,
            sg.name  AS group_name,
            si.uom,
            i.quantity,
            i.average_rate,
            i.total_value
     FROM inventory i
     JOIN stock_items si ON si.id = i.stock_item_id
     LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
     JOIN locations l ON l.id = i.location_id
     WHERE l.company_id = $1
       AND i.quantity::numeric > 0
       ${locationFilter}
     ORDER BY LOWER(COALESCE(sg.name, 'zzzzz')), LOWER(si.name)`,
    params,
  );

  const rows: StockRow[] = result.rows.map((r) => ({
    itemName:   r.item_name,
    groupName:  r.group_name || "Unassigned",
    uom:        r.uom || "BL",
    qty:        parseFloat(r.quantity     || "0"),
    avgRate:    parseFloat(r.average_rate || "0"),
    totalValue: parseFloat(r.total_value  || "0"),
  }));

  const grouped: { groupName: string; items: StockRow[] }[] = [];
  for (const row of rows) {
    const last = grouped[grouped.length - 1];
    if (last && last.groupName === row.groupName) {
      last.items.push(row);
    } else {
      grouped.push({ groupName: row.groupName, items: [row] });
    }
  }

  const grandTotalQty   = rows.reduce((s, r) => s + r.qty,       0);
  const grandTotalValue = rows.reduce((s, r) => s + r.totalValue, 0);

  const now        = new Date();
  const dateStr    = fmtDate(now);
  const printedStr = `${dateStr} ${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}`;

  // ── Column layout (dynamic based on hideCost) ─────────────────────────────
  const COL_PART_W = hideCost ? 315 : 215;
  const COL_QTY_W  = hideCost ? 200 : 100;
  const COL_RATE_W = hideCost ?   0 : 100;
  const COL_VAL_W  = hideCost ?   0 : 100;

  const X_PART = MARGIN_X;
  const X_QTY  = X_PART + COL_PART_W;
  const X_RATE = X_QTY  + COL_QTY_W;
  const X_VAL  = X_RATE + COL_RATE_W;

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

  // ── Page header ─────────────────────────────────────────────────────────────
  function drawPageHeader(): number {
    let y = MARGIN_Y;

    doc.font("Helvetica-Bold").fontSize(16).fillColor("#000000");
    doc.text(companyName, X_PART, y, { width: USABLE_W, align: "center", underline: true, lineBreak: false });
    y += 22;

    doc.font("Helvetica-Bold").fontSize(12);
    const reportTitle = locationName ? `Stock Report — ${locationName}` : "Godown Summary";
    doc.text(reportTitle, X_PART, y, { width: USABLE_W, align: "center", lineBreak: false });
    y += 17;

    doc.font("Helvetica").fontSize(9).fillColor("#333333");
    doc.text(dateStr, X_PART, y, { width: USABLE_W, align: "center", lineBreak: false });
    y += 13;

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
    const rowH = 18;
    doc.save();
    doc.rect(X_PART, y, USABLE_W, rowH).fill("#f8f8f8");
    doc.restore();
    doc.save();
    doc.moveTo(X_PART, y + rowH).lineTo(X_PART + USABLE_W, y + rowH)
       .strokeColor("#333333").lineWidth(1.5).stroke();
    doc.restore();

    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000000");
    doc.text("Particulars", X_PART + 4, y + 5, { width: COL_PART_W - 8, align: "left", lineBreak: false });

    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("Closing Balance", X_QTY, y + 2, { width: COL_QTY_W, align: "right", lineBreak: false });
    doc.font("Helvetica").fontSize(8);
    doc.text("Quantity", X_QTY, y + 11, { width: COL_QTY_W, align: "right", lineBreak: false });

    if (!hideCost) {
      doc.font("Helvetica-Bold").fontSize(10);
      doc.text("Avg Rate",    X_RATE, y + 5, { width: COL_RATE_W, align: "right", lineBreak: false });
      doc.text("Total Value", X_VAL,  y + 5, { width: COL_VAL_W,  align: "right", lineBreak: false });
    }

    return y + rowH + 1;
  }

  // ── Page overflow check ───────────────────────────────────────────────────
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

  // ── First page ────────────────────────────────────────────────────────────
  let y = drawPageHeader();
  y += 2;
  y = drawTableHeader(y);

  // ── Group + item rows ─────────────────────────────────────────────────────
  for (const { groupName, items } of grouped) {
    const groupQty   = items.reduce((s, r) => s + r.qty,       0);
    const groupValue = items.reduce((s, r) => s + r.totalValue, 0);
    const firstUom   = items[0]?.uom || "BL";

    y = checkPage(y, 14);
    const groupH = 14;
    doc.save();
    doc.rect(X_PART, y, USABLE_W, groupH).fill("#eaeaea");
    doc.moveTo(X_PART, y).lineTo(X_PART + USABLE_W, y).strokeColor("#666666").lineWidth(0.5).stroke();
    doc.moveTo(X_PART, y + groupH).lineTo(X_PART + USABLE_W, y + groupH).strokeColor("#666666").lineWidth(0.5).stroke();
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000000");
    doc.text(groupName, X_PART + 8, y + 3, { width: COL_PART_W - 12, align: "left", lineBreak: false });
    doc.text(`${fmtQty(groupQty)} ${firstUom}`, X_QTY, y + 3, { width: COL_QTY_W, align: "right", lineBreak: false });
    if (!hideCost) {
      doc.text(fmtAmt(groupValue), X_VAL, y + 3, { width: COL_VAL_W, align: "right", lineBreak: false });
    }
    y += groupH;

    for (const item of items) {
      y = checkPage(y, 12);
      const itemH = 12;
      doc.save();
      doc.moveTo(X_PART, y + itemH).lineTo(X_PART + USABLE_W, y + itemH)
         .strokeColor("#999999").lineWidth(0.3).stroke();
      doc.restore();
      doc.font("Helvetica").fontSize(9).fillColor("#000000");
      doc.text(item.itemName, X_PART + 16, y + 2, { width: COL_PART_W - 20, align: "left", lineBreak: false });
      doc.text(`${fmtQty(item.qty)} ${item.uom}`, X_QTY, y + 2, { width: COL_QTY_W, align: "right", lineBreak: false });
      if (!hideCost) {
        doc.text(fmtAmt(item.avgRate),    X_RATE, y + 2, { width: COL_RATE_W, align: "right", lineBreak: false });
        doc.text(fmtAmt(item.totalValue), X_VAL,  y + 2, { width: COL_VAL_W,  align: "right", lineBreak: false });
      }
      y += itemH;
    }
  }

  // ── Grand Total row ───────────────────────────────────────────────────────
  y = checkPage(y, 20);
  y += 2;
  const totalH = 16;
  doc.save();
  doc.rect(X_PART, y, USABLE_W, totalH).fill("#eaeaea");
  doc.moveTo(X_PART, y).lineTo(X_PART + USABLE_W, y).strokeColor("#333333").lineWidth(1).stroke();
  doc.moveTo(X_PART, y + totalH).lineTo(X_PART + USABLE_W, y + totalH).strokeColor("#333333").lineWidth(1).stroke();
  doc.restore();
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#000000");
  doc.text("Grand Total", X_PART + 8, y + 4, { width: COL_PART_W - 12, align: "left", lineBreak: false });
  const grandUom = rows[0]?.uom || "BL";
  doc.text(`${fmtQty(grandTotalQty)} ${grandUom}`, X_QTY, y + 4, { width: COL_QTY_W, align: "right", lineBreak: false });
  if (!hideCost) {
    doc.text(fmtAmt(grandTotalValue), X_VAL, y + 4, { width: COL_VAL_W, align: "right", lineBreak: false });
  }

  doc.end();
  return pdfReady;
}
