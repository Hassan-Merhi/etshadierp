/**
 * Containers OTW PDF — pdfkit-based tabular report.
 * Dark-themed A3 landscape with company section headers.
 */

import PDFDocument from "pdfkit";
import { pool } from "../db";

// ── Colours ───────────────────────────────────────────────────────────────────
const CLR_BG      = "#0f172a";
const CLR_ROW_ALT = "#1e293b";
const CLR_HDR_ROW = "#fbbf24";   // amber company header
const CLR_COL_HDR = "#1e3a5f";   // column header fill
const CLR_COL_LBL = "#93c5fd";   // column header text
const CLR_TEXT    = "#f1f5f9";
const CLR_DIM     = "#94a3b8";
const CLR_DELAYED = "#f87171";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Row {
  containerNumber: string;
  companyName:     string;
  shopName:        string | null;
  supplierName:    string | null;
  numberPlate:     string | null;
  trackingLocation:string | null;
  eta:             string | null;
  status:          string;
  transporter:     string | null;
  agent:           string | null;
  trackingDescription: string | null;
  daysDelayed:     number | null;
}

export interface ContainersPdfResult {
  buffer:   Buffer;
  rowCount: number;
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateContainersPdf(): Promise<ContainersPdfResult> {
  const result = await pool.query<{
    container_number:     string;
    company_name:         string;
    shop_name:            string | null;
    supplier_name:        string | null;
    number_plate:         string | null;
    tracking_location:    string | null;
    eta:                  string | null;
    status:               string;
    transporter:          string | null;
    agent:                string | null;
    tracking_description: string | null;
  }>(
    `SELECT c.container_number,
            co.name          AS company_name,
            c.shop_name,
            s.name           AS supplier_name,
            c.number_plate,
            c.tracking_location,
            c.eta::text      AS eta,
            c.status,
            c.transporter,
            c.agent,
            c.tracking_description
     FROM containers c
     JOIN companies co ON co.id = c.company_id
     LEFT JOIN suppliers s ON s.id = c.supplier_id
     WHERE c.status NOT IN ('Delivered','Closed','Cancelled','Offloaded')
       AND c.deleted_at IS NULL
     ORDER BY co.name, c.shop_name NULLS LAST, c.container_number`,
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows: Row[] = result.rows.map((r) => {
    let daysDelayed: number | null = null;
    if (r.eta && !r.number_plate) {
      const etaDate = new Date(r.eta);
      if (!isNaN(etaDate.getTime())) {
        const diff = Math.floor((today.getTime() - etaDate.getTime()) / 86400000);
        daysDelayed = diff > 0 ? diff : null;
      }
    }
    return {
      containerNumber:     r.container_number,
      companyName:         r.company_name,
      shopName:            r.shop_name,
      supplierName:        r.supplier_name,
      numberPlate:         r.number_plate,
      trackingLocation:    r.tracking_location,
      eta:                 r.eta ? r.eta.substring(0, 10) : null,
      status:              r.status,
      transporter:         r.transporter,
      agent:               r.agent,
      trackingDescription: r.tracking_description,
      daysDelayed,
    };
  });

  // Group by company
  const grouped: { companyName: string; items: Row[] }[] = [];
  for (const row of rows) {
    const last = grouped[grouped.length - 1];
    if (last && last.companyName === row.companyName) {
      last.items.push(row);
    } else {
      grouped.push({ companyName: row.companyName, items: [row] });
    }
  }

  const buffer = await renderPdf(grouped, rows.length);
  return { buffer, rowCount: rows.length };
}

// ── PDF renderer ──────────────────────────────────────────────────────────────
function renderPdf(
  grouped:   { companyName: string; items: Row[] }[],
  totalRows: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 24, size: "A3", layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data",  (c: Buffer) => chunks.push(c));
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const MARGIN    = 24;
    const PAGE_W    = doc.page.width;
    const PAGE_H    = doc.page.height;
    const CONTENT_W = PAGE_W - MARGIN * 2;
    const ROW_H     = 18;
    const HDR_H     = 22;
    const FS_TITLE  = 14;
    const FS_HDR    = 9;
    const FS_ROW    = 7.5;

    // Column definitions — widths in pt; last col fills remainder
    const cols: { key: string; label: string; w: number; align?: "center" | "left" }[] = [
      { key: "idx",         label: "#",           w: 22,  align: "center" },
      { key: "ctr",         label: "Container #", w: 100 },
      { key: "supplier",    label: "Supplier",    w: 100 },
      { key: "shop",        label: "Shop",        w: 85  },
      { key: "truck",       label: "Truck #",     w: 80  },
      { key: "location",    label: "Location",    w: 115 },
      { key: "eta",         label: "ETA",         w: 62,  align: "center" },
      { key: "delayed",     label: "Delayed",     w: 50,  align: "center" },
      { key: "status",      label: "Status",      w: 80  },
      { key: "transporter", label: "Transporter", w: 110 },
      { key: "agent",       label: "Agent",       w: 90  },
      { key: "notes",       label: "Notes",       w: 0   }, // fill
    ];
    const fixedW = cols.slice(0, -1).reduce((s, c) => s + c.w, 0);
    cols[cols.length - 1].w = Math.max(CONTENT_W - fixedW, 60);

    const now    = new Date();
    const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
    const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

    // Fill background on every new page
    function fillBg() {
      doc.rect(0, 0, PAGE_W, PAGE_H).fill(CLR_BG);
    }
    doc.on("pageAdded", fillBg);
    fillBg();

    let y = MARGIN;

    // Title
    doc.font("Helvetica-Bold").fontSize(FS_TITLE).fillColor(CLR_TEXT);
    doc.text(`Containers OTW — ${dateStr} ${timeStr}`, MARGIN, y);
    y += FS_TITLE + 6;
    doc.font("Helvetica").fontSize(8).fillColor(CLR_DIM);
    doc.text(`${totalRows} active container${totalRows !== 1 ? "s" : ""}`, MARGIN, y);
    y += 16;

    function ensureSpace(needed: number) {
      if (y + needed > PAGE_H - MARGIN) {
        doc.addPage();
        y = MARGIN;
      }
    }

    function drawColHeaders() {
      let x = MARGIN;
      doc.rect(x, y, CONTENT_W, HDR_H).fill(CLR_COL_HDR);
      doc.font("Helvetica-Bold").fontSize(FS_HDR).fillColor(CLR_COL_LBL);
      for (const col of cols) {
        const align = col.align ?? "left";
        const tx    = align === "center" ? x + col.w / 2 : x + 3;
        doc.text(col.label, tx, y + (HDR_H - FS_HDR) / 2, {
          width: col.w - 6, align, lineBreak: false,
        });
        x += col.w;
      }
      y += HDR_H;
    }

    drawColHeaders();

    let globalIdx = 0;

    for (const group of grouped) {
      ensureSpace(HDR_H + ROW_H);

      // Company section header
      doc.rect(MARGIN, y, CONTENT_W, HDR_H).fill(CLR_HDR_ROW);
      doc.font("Helvetica-Bold").fontSize(FS_HDR).fillColor("#0f172a");
      doc.text(group.companyName, MARGIN + 6, y + (HDR_H - FS_HDR) / 2, {
        width: CONTENT_W - 12, lineBreak: false,
      });
      y += HDR_H;

      for (let i = 0; i < group.items.length; i++) {
        ensureSpace(ROW_H);
        const row  = group.items[i];
        globalIdx++;
        const bg   = i % 2 === 0 ? CLR_BG : CLR_ROW_ALT;
        doc.rect(MARGIN, y, CONTENT_W, ROW_H).fill(bg);

        const cells: Record<string, string> = {
          idx:         String(globalIdx),
          ctr:         row.containerNumber,
          supplier:    row.supplierName    ?? "—",
          shop:        row.shopName        ?? "—",
          truck:       row.numberPlate     ?? "—",
          location:    row.trackingLocation ?? "—",
          eta:         row.eta             ?? "—",
          delayed:     row.daysDelayed ? `+${row.daysDelayed}d` : "—",
          status:      row.status,
          transporter: row.transporter     ?? "—",
          agent:       row.agent           ?? "—",
          notes:       row.trackingDescription ?? "—",
        };

        let cx = MARGIN;
        for (const col of cols) {
          const val     = cells[col.key] ?? "—";
          const align   = col.align ?? "left";
          const isDelay = col.key === "delayed" && row.daysDelayed && row.daysDelayed > 0;
          const color   = isDelay ? CLR_DELAYED : CLR_TEXT;
          const tx      = align === "center" ? cx + col.w / 2 : cx + 3;
          doc.font("Helvetica").fontSize(FS_ROW).fillColor(color);
          doc.text(val, tx, y + (ROW_H - FS_ROW) / 2 + 0.5, {
            width: col.w - 6, align, lineBreak: false, ellipsis: true,
          });
          cx += col.w;
        }

        y += ROW_H;
      }
    }

    doc.end();
  });
}
