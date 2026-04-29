/**
 * Worker Bales Report PDF Generator (server-side)
 *
 * Generates the same "Worker Bales Report" that StockEntryHistory → Actions →
 * "Worker PDF" produces in the browser, but as a pdfkit Buffer so it can be
 * sent via WhatsApp or downloaded as a proper PDF file.
 *
 * Layout (matches the HTML version):
 *   Page 1+  : Worker Bales Detail  — one section per worker, bales listed with
 *              reference / product / weight.  Continues across pages as needed.
 *   Last page : Worker Summary table — totals per worker, sorted descending.
 */

import PDFDocument from "pdfkit";

export interface BaleDetail {
  referenceNumber?: string | null;
  workerName?:      string | null;
  productName?:     string | null;
  articleCode?:     string | null;
  weightKg?:        string | number | null;
}

export interface GroupRow {
  workerName?:  string | null;
  productName?: string | null;
  articleCode?: string | null;
  baleCount?:   number;
  totalWeight?: string | number | null;
  bales?:       BaleDetail[];
}

// ── palette: same cycle used in the HTML matrix view ─────────────────────────
const PALETTE = [
  "#2563eb","#16a34a","#dc2626","#9333ea","#ea580c","#0891b2",
  "#be185d","#65a30d","#7c3aed","#b45309","#0284c7","#15803d",
];
const NAVY   = "#1e3a8a";
const GREY   = "#f1f5f9";
const SLATE  = "#334155";

function hex2rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function setFill(doc: PDFKit.PDFDocument, hex: string) {
  doc.fillColor(hex2rgb(hex) as [number, number, number]);
}

function setStroke(doc: PDFKit.PDFDocument, hex: string) {
  doc.strokeColor(hex2rgb(hex) as [number, number, number]);
}

/**
 * Generate a Worker Bales Report PDF from the grouped stock-entry-history data.
 * @param groups  Array returned by /api/factory/bales/stock-entry-history
 * @param date    Display date string (e.g. "2026-04-29")
 * @param companyName  For the header
 */
export async function generateWorkerBalesPdf(
  groups: GroupRow[],
  date: string,
  companyName = "",
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 28, size: "A4", autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Build worker → bales map (same as handleExportWorkerPDF) ─────────────
    const allBales: BaleDetail[] = groups.flatMap(g => g.bales ?? []);

    const byWorker = new Map<string, BaleDetail[]>();
    for (const b of allBales) {
      const w = b.workerName || "Unassigned";
      if (!byWorker.has(w)) byWorker.set(w, []);
      byWorker.get(w)!.push(b);
    }
    const sortedWorkers = Array.from(byWorker.keys()).sort((a, b) =>
      a.localeCompare(b, "ar"),
    );

    // ── Summary data (sorted desc by count) ──────────────────────────────────
    const summaryRows = sortedWorkers
      .map(w => {
        const bales = byWorker.get(w)!;
        return {
          worker:  w,
          count:   bales.length,
          totalKg: bales.reduce((s, b) => s + parseFloat(String(b.weightKg || 0)), 0),
        };
      })
      .sort((a, b) => b.count - a.count);

    const grandBales = summaryRows.reduce((s, r) => s + r.count, 0);
    const grandKg    = summaryRows.reduce((s, r) => s + r.totalKg, 0);

    const PAGE_W   = doc.page.width  - doc.page.margins.left - doc.page.margins.right;
    const COL_REF  = PAGE_W * 0.16;
    const COL_PROD = PAGE_W * 0.40;
    const COL_WT   = PAGE_W * 0.12;
    const COL_TOT  = PAGE_W * 0.14;
    const COL_WKR  = PAGE_W - COL_REF - COL_PROD - COL_WT - COL_TOT;
    const ROW_H    = 14;
    const HDR_H    = 18;

    let y = doc.page.margins.top;

    // ── Helper: draw page header ──────────────────────────────────────────────
    function drawPageHeader(pageTitle: string) {
      const lm = doc.page.margins.left;
      // Blue bar
      setFill(doc, NAVY);
      doc.rect(lm, y, PAGE_W, 22).fill();
      doc.font("Helvetica-Bold").fontSize(11);
      setFill(doc, "#ffffff");
      doc.text(pageTitle, lm + 4, y + 5, { width: PAGE_W * 0.6 });

      // Right side stats
      doc.font("Helvetica").fontSize(8);
      const right = `${date}  ·  ${sortedWorkers.length} workers  ·  ${grandBales} bales  ·  ${grandKg.toFixed(0)} kg`;
      doc.text(right, lm + PAGE_W * 0.4, y + 7, { width: PAGE_W * 0.55, align: "right" });
      y += 26;

      if (companyName) {
        setFill(doc, SLATE);
        doc.font("Helvetica").fontSize(7.5).text(companyName, lm, y, { width: PAGE_W });
        y += 12;
      }
    }

    // ── Helper: check page space, add new page if needed ─────────────────────
    function ensureSpace(needed: number) {
      const bottom = doc.page.height - doc.page.margins.bottom;
      if (y + needed > bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawTableHeader();
      }
    }

    // ── Helper: draw the detail table column headers ──────────────────────────
    function drawTableHeader() {
      const lm = doc.page.margins.left;
      setFill(doc, NAVY);
      doc.rect(lm, y, PAGE_W, HDR_H).fill();
      doc.font("Helvetica-Bold").fontSize(7.5);
      setFill(doc, "#ffffff");
      const cols = [
        { label: "Reference",      w: COL_REF,  align: "left"  as const },
        { label: "Worker",         w: COL_WKR,  align: "left"  as const },
        { label: "Product",        w: COL_PROD, align: "left"  as const },
        { label: "Weight (kg)",    w: COL_WT,   align: "right" as const },
        { label: "Total / Person", w: COL_TOT,  align: "right" as const },
      ];
      let x = lm;
      for (const col of cols) {
        doc.text(col.label, x + 2, y + 5, { width: col.w - 4, align: col.align });
        x += col.w;
      }
      y += HDR_H;
    }

    // ── Page 1: Worker Bales Detail ───────────────────────────────────────────
    drawPageHeader("Worker Bales Report");
    drawTableHeader();

    const lm = doc.page.margins.left;

    for (const worker of sortedWorkers) {
      const bales = byWorker.get(worker)!.sort((a, b) =>
        (a.productName || "").localeCompare(b.productName || ""),
      );
      const workerBaleCount = bales.length;
      const workerTotalKg   = bales.reduce((s, b) => s + parseFloat(String(b.weightKg || 0)), 0);

      bales.forEach((b, idx) => {
        ensureSpace(ROW_H + 2);

        const isFirst = idx === 0;
        const isLast  = idx === bales.length - 1;
        const rowBg   = idx % 2 === 0 ? "#ffffff" : GREY;

        // Row background
        setFill(doc, rowBg);
        doc.rect(lm, y, PAGE_W, ROW_H).fill();

        // Row border
        setStroke(doc, "#e2e8f0");
        doc.rect(lm, y, PAGE_W, ROW_H).stroke();

        doc.font("Courier").fontSize(7);
        setFill(doc, SLATE);
        doc.text(b.referenceNumber || "—", lm + 2, y + 3.5, { width: COL_REF - 4 });

        doc.font("Helvetica").fontSize(7.5);
        if (isFirst) {
          doc.font("Helvetica-Bold");
          setFill(doc, NAVY);
          doc.text(worker, lm + COL_REF + 2, y + 3.5, { width: COL_WKR - 4 });
          doc.font("Helvetica");
        }

        const productLabel = b.productName
          ? (b.articleCode ? `${b.productName} (${b.articleCode})` : b.productName)
          : "—";
        setFill(doc, SLATE);
        doc.fontSize(7.5).text(productLabel, lm + COL_REF + COL_WKR + 2, y + 3.5, { width: COL_PROD - 4 });

        const wt = parseFloat(String(b.weightKg || 0)).toFixed(0);
        doc.text(wt, lm + COL_REF + COL_WKR + COL_PROD + 2, y + 3.5, { width: COL_WT - 4, align: "right" });

        if (isLast) {
          doc.font("Helvetica-Bold").fontSize(7.5);
          setFill(doc, "#0369a1");
          doc.text(`${workerBaleCount} bales`, lm + COL_REF + COL_WKR + COL_PROD + COL_WT + 2, y + 2, { width: COL_TOT - 4, align: "right" });
          doc.font("Helvetica").fontSize(6.5);
          setFill(doc, "#64748b");
          doc.text(`${workerTotalKg.toFixed(0)} kg`, lm + COL_REF + COL_WKR + COL_PROD + COL_WT + 2, y + 8, { width: COL_TOT - 4, align: "right" });
          doc.font("Helvetica").fontSize(7.5);
        }

        y += ROW_H;
      });
    }

    // Grand total row
    ensureSpace(ROW_H + 4);
    setFill(doc, NAVY);
    doc.rect(lm, y, PAGE_W, ROW_H).fill();
    doc.font("Helvetica-Bold").fontSize(7.5);
    setFill(doc, "#ffffff");
    doc.text("TOTAL", lm + 2, y + 3.5, { width: COL_REF + COL_WKR + COL_PROD - 4 });
    doc.text(grandKg.toFixed(0), lm + COL_REF + COL_WKR + COL_PROD + 2, y + 3.5, { width: COL_WT - 4, align: "right" });
    doc.text(String(grandBales), lm + COL_REF + COL_WKR + COL_PROD + COL_WT + 2, y + 3.5, { width: COL_TOT - 4, align: "right" });
    y += ROW_H + 10;

    // ── Worker Summary (new section, same page if space; else new page) ───────
    const summaryRowH = 13;
    const summaryHdrH = 16;
    const summaryNeeded = summaryHdrH + (summaryRows.length + 1) * summaryRowH + 40;

    const bottom = doc.page.height - doc.page.margins.bottom;
    if (y + summaryNeeded > bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    // Summary section title bar
    setFill(doc, NAVY);
    doc.rect(lm, y, PAGE_W, 20).fill();
    doc.font("Helvetica-Bold").fontSize(11);
    setFill(doc, "#ffffff");
    doc.text("Worker Summary", lm + 4, y + 5, { width: PAGE_W * 0.6 });
    const rightInfo = `${date}  ·  ${sortedWorkers.length} workers  ·  ${grandBales} bales`;
    doc.font("Helvetica").fontSize(8).text(rightInfo, lm + PAGE_W * 0.4, y + 7, { width: PAGE_W * 0.55, align: "right" });
    y += 24;

    // Summary column widths
    const S_COL_W   = PAGE_W * 0.55;
    const S_COL_B   = PAGE_W * 0.22;
    const S_COL_KG  = PAGE_W - S_COL_W - S_COL_B;

    // Summary table header
    setFill(doc, NAVY);
    doc.rect(lm, y, PAGE_W, summaryHdrH).fill();
    doc.font("Helvetica-Bold").fontSize(8);
    setFill(doc, "#ffffff");
    doc.text("Worker", lm + 4, y + 4, { width: S_COL_W - 4 });
    doc.text("Bales", lm + S_COL_W + 2, y + 4, { width: S_COL_B - 4, align: "right" });
    doc.text("Total Weight (kg)", lm + S_COL_W + S_COL_B + 2, y + 4, { width: S_COL_KG - 4, align: "right" });
    y += summaryHdrH;

    summaryRows.forEach((r, idx) => {
      const rowBg = idx % 2 === 0 ? "#ffffff" : GREY;
      setFill(doc, rowBg);
      doc.rect(lm, y, PAGE_W, summaryRowH).fill();
      setStroke(doc, "#e2e8f0");
      doc.rect(lm, y, PAGE_W, summaryRowH).stroke();

      doc.font("Helvetica-Bold").fontSize(8);
      setFill(doc, SLATE);
      doc.text(r.worker, lm + 4, y + 3, { width: S_COL_W - 4 });
      doc.font("Helvetica").fontSize(8);
      doc.text(String(r.count), lm + S_COL_W + 2, y + 3, { width: S_COL_B - 4, align: "right" });
      doc.text(r.totalKg.toFixed(0), lm + S_COL_W + S_COL_B + 2, y + 3, { width: S_COL_KG - 4, align: "right" });
      y += summaryRowH;
    });

    // Grand total row for summary
    setFill(doc, NAVY);
    doc.rect(lm, y, PAGE_W, summaryRowH).fill();
    doc.font("Helvetica-Bold").fontSize(8);
    setFill(doc, "#ffffff");
    doc.text("TOTAL", lm + 4, y + 3, { width: S_COL_W - 4 });
    doc.text(String(grandBales), lm + S_COL_W + 2, y + 3, { width: S_COL_B - 4, align: "right" });
    doc.text(grandKg.toFixed(0), lm + S_COL_W + S_COL_B + 2, y + 3, { width: S_COL_KG - 4, align: "right" });

    doc.end();
  });
}
