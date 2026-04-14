/**
 * Generate a Stock-with-Cost PDF for a single company.
 * Shows current inventory (qty > 0) grouped by stock group:
 * Item Code | Item Name | Group | Location | Qty | Unit Cost | Total Value
 */

import { pool } from "../db";

const PAGE_MARGIN = 30;
const PAGE_WIDTH  = 841; // A4 landscape
const USABLE_W    = PAGE_WIDTH - PAGE_MARGIN * 2;

// Column widths (total = 781)
const COLS = [
  { header: "Code",        key: "code",         w: 80  },
  { header: "Item Name",   key: "name",         w: 195 },
  { header: "Group",       key: "group",        w: 120 },
  { header: "Location",    key: "location",     w: 120 },
  { header: "Qty",         key: "qty",          w: 65  },
  { header: "Unit Cost",   key: "unitCost",     w: 90  },
  { header: "Total Value", key: "totalValue",   w: 111 },
];

// Pre-compute x offsets
const COL_X: number[] = [];
let _cx = PAGE_MARGIN;
for (const c of COLS) { COL_X.push(_cx); _cx += c.w; }

function fmt(n: number, dec = 2) {
  return n.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

interface StockRow {
  code:      string;
  name:      string;
  group:     string;
  location:  string;
  qty:       number;
  unitCost:  number;
  totalValue:number;
}

export async function generateStockPdf(
  companyId:   number,
  companyName: string,
): Promise<Buffer> {
  // ── Fetch data ────────────────────────────────────────────────────────────
  const result = await pool.query<{
    code: string; name: string; group_name: string | null;
    location_name: string; quantity: string;
    average_rate: string; total_value: string;
  }>(
    `SELECT si.code, si.name,
            sg.name AS group_name,
            l.name  AS location_name,
            i.quantity, i.average_rate, i.total_value
     FROM inventory i
     JOIN stock_items si ON si.id = i.stock_item_id
     LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
     JOIN locations l ON l.id = i.location_id
     WHERE l.company_id = $1
       AND i.quantity::numeric > 0
     ORDER BY LOWER(COALESCE(sg.name,'')), LOWER(si.code), LOWER(l.name)`,
    [companyId],
  );

  const rows: StockRow[] = result.rows.map((r) => ({
    code:       r.code,
    name:       r.name,
    group:      r.group_name || "—",
    location:   r.location_name,
    qty:        parseFloat(r.quantity    || "0"),
    unitCost:   parseFloat(r.average_rate || "0"),
    totalValue: parseFloat(r.total_value  || "0"),
  }));

  const grandTotal = rows.reduce((s, r) => s + r.totalValue, 0);
  const today      = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  // ── Build PDF ─────────────────────────────────────────────────────────────
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "A4", layout: "landscape" });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const pdfReady = new Promise<Buffer>((resolve, reject) => {
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ── Title block ───────────────────────────────────────────────────────────
  doc.fontSize(15).font("Helvetica-Bold")
     .text(`${companyName} — Stock Inventory with Cost`, PAGE_MARGIN, PAGE_MARGIN, { width: USABLE_W, align: "center" });
  doc.fontSize(10).font("Helvetica")
     .text(`As of ${today}  |  Items with qty > 0 only`, { align: "center" });
  doc.moveDown(0.6);

  // ── Table header ──────────────────────────────────────────────────────────
  const drawHeader = () => {
    const y = doc.y;
    doc.save();
    doc.rect(PAGE_MARGIN, y, USABLE_W, 16).fill("#1E3A5F");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
    COLS.forEach((c, i) => {
      const align = i >= 4 ? "right" : "left";
      const px    = align === "right" ? COL_X[i] : COL_X[i] + 2;
      doc.text(c.header, px, y + 4, { width: c.w - 4, align });
    });
    doc.restore();
    doc.fillColor("#000000");
    doc.y = y + 18;
  };

  drawHeader();

  // ── Rows ──────────────────────────────────────────────────────────────────
  let rowIndex = 0;
  let lastGroup = "";

  for (const row of rows) {
    // Group separator
    if (row.group !== lastGroup) {
      if (doc.y > doc.page.height - 100) {
        doc.addPage({ layout: "landscape" });
        drawHeader();
      }
      const gy = doc.y;
      doc.save();
      doc.rect(PAGE_MARGIN, gy, USABLE_W, 13).fill("#DDEEFF");
      doc.fillColor("#1E3A5F").font("Helvetica-Bold").fontSize(8)
         .text(row.group, PAGE_MARGIN + 4, gy + 3, { width: USABLE_W - 8 });
      doc.restore();
      doc.fillColor("#000000");
      doc.y = gy + 14;
      lastGroup = row.group;
    }

    if (doc.y > doc.page.height - 60) {
      doc.addPage({ layout: "landscape" });
      drawHeader();
    }

    const y   = doc.y;
    const bg  = rowIndex % 2 === 0 ? "#FFFFFF" : "#F5F8FF";
    doc.save();
    doc.rect(PAGE_MARGIN, y, USABLE_W, 13).fill(bg);
    doc.fillColor("#000000").font("Helvetica").fontSize(7.5);

    const cells = [
      { text: row.code,                  align: "left"  },
      { text: row.name,                  align: "left"  },
      { text: row.group,                 align: "left"  },
      { text: row.location,              align: "left"  },
      { text: fmt(row.qty, 3),           align: "right" },
      { text: fmt(row.unitCost, 2),      align: "right" },
      { text: fmt(row.totalValue, 2),    align: "right" },
    ] as const;

    cells.forEach((cell, i) => {
      const px = cell.align === "right" ? COL_X[i] : COL_X[i] + 2;
      doc.text(cell.text, px, y + 3, { width: COLS[i].w - 4, align: cell.align, lineBreak: false });
    });

    doc.restore();
    doc.y = y + 14;
    rowIndex++;
  }

  // ── Grand Total ───────────────────────────────────────────────────────────
  if (doc.y > doc.page.height - 80) {
    doc.addPage({ layout: "landscape" });
  }
  doc.moveDown(0.3);
  const ty = doc.y;
  doc.save();
  doc.rect(PAGE_MARGIN, ty, USABLE_W, 16).fill("#1E3A5F");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9)
     .text(`Grand Total  (${rows.length} line${rows.length !== 1 ? "s" : ""})`, PAGE_MARGIN + 4, ty + 4, {
       width: USABLE_W - 120, align: "left",
     });
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(9)
     .text(fmt(grandTotal, 2), COL_X[6], ty + 4, { width: COLS[6].w - 4, align: "right" });
  doc.restore();

  doc.end();
  return pdfReady;
}
