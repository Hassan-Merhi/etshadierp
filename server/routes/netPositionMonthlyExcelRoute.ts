/**
 * GET /api/reports/net-position-monthly-excel
 *
 * Multi-sheet workbook:
 *   Sheet 1 — "Summary"        : one row per month (overview table)
 *   Sheets 2…N — "<Month Year>": full breakdown of every line item for that
 *                                month with a "Change" column vs the prior month
 *
 * Query params:
 *   startDate  YYYY-MM-DD  (required)
 *   endDate    YYYY-MM-DD  (defaults to today)
 *   companyId  number      (Admin/Dev only)
 */

import type { Express } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { calculateNetPositionAsOf, NetPositionLineItem } from "../helpers/calculateNetPositionAsOf";
import { round2 } from "../netPositionHelper";

// ─── date helpers ────────────────────────────────────────────────────────────

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month + 1, 0));
  return d.toISOString().split("T")[0];
}

function fmtMonthLabel(dateStr: string): string {
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const [yr, mo] = dateStr.split("-");
  return `${names[parseInt(mo) - 1]} ${yr}`;
}

function fmtSheetName(dateStr: string): string {
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const [yr, mo] = dateStr.split("-");
  return `${names[parseInt(mo) - 1]} ${yr}`;
}

function generateMonthEnds(startDate: string, endDate: string): string[] {
  const ends: string[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end   = new Date(endDate   + "T00:00:00Z");
  let year  = start.getUTCFullYear();
  let month = start.getUTCMonth();
  while (true) {
    const candidate = lastDayOfMonth(year, month);
    const candidateDate = new Date(candidate + "T00:00:00Z");
    if (candidateDate <= end) {
      ends.push(candidate);
    } else {
      if (new Date(`${year}-${String(month + 1).padStart(2, "0")}-01T00:00:00Z`) <= end) {
        ends.push(endDate);
      }
      break;
    }
    month++;
    if (month > 11) { month = 0; year++; }
    if (year > 2100) break;
  }
  return ends;
}

// ─── palette ─────────────────────────────────────────────────────────────────

const C = {
  DARK_BLUE:  "FF1E3A5F",
  MID_BLUE:   "FF2D5F8A",
  GREEN:      "FF16A34A",
  RED:        "FFDC2626",
  GREEN_BG:   "FFD1FAE5",
  RED_BG:     "FFFEE2E2",
  YELLOW_BG:  "FFFEF9C3",
  AMBER_BG:   "FFFEF3C7",
  GRAY_BG:    "FFF3F4F6",
  GRAY_HD:    "FFE5E7EB",
  WHITE:      "FFFFFFFF",
  LIGHT_BLUE: "FFE0EAF5",
  MUTED:      "FF6B7280",
};

const currencyFmt = '#,##0.00';
const signedFmt   = '+#,##0.00;-#,##0.00;"-"';

function styleHeader(cell: any, bgArgb = C.DARK_BLUE) {
  cell.font      = { bold: true, color: { argb: C.WHITE }, size: 11 };
  cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.border    = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
}

function styleSubHeader(cell: any) {
  cell.font      = { bold: true, color: { argb: C.WHITE }, size: 10 };
  cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: C.MID_BLUE } };
  cell.alignment = { horizontal: "center", vertical: "middle" };
}

function styleTitle(cell: any, text: string, fontSize = 16) {
  cell.value     = text;
  cell.font      = { bold: true, size: fontSize, color: { argb: C.WHITE } };
  cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: C.DARK_BLUE } };
  cell.alignment = { horizontal: "center", vertical: "middle" };
}

function setThin(cell: any) {
  cell.border = { bottom: { style: "hair", color: { argb: "FFDDDDDD" } } };
}

function setSectionHeader(cell: any, label: string, color: string) {
  cell.value     = label;
  cell.font      = { bold: true, size: 11, color: { argb: C.WHITE } };
  cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  cell.alignment = { vertical: "middle" };
}

// ─── route ───────────────────────────────────────────────────────────────────

export function registerNetPositionMonthlyExcelRoute(app: Express) {
  app.get("/api/reports/net-position-monthly-excel", requireAuth, async (req, res) => {
    try {
      const user = req.session.user as any;
      const isAdminOrDev = user?.role === "Admin" || user?.role === "Developer";
      const requestedCompanyId = req.query.companyId ? parseInt(req.query.companyId as string) : null;
      const companyId = isAdminOrDev && requestedCompanyId
        ? requestedCompanyId
        : req.session.currentCompanyId;

      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allCompanies = await storage.getAllCompanies();
      const company      = allCompanies.find((c: any) => c.id === companyId);
      const companyName  = company?.name || "Company";

      const startDate = (req.query.startDate as string) || "";
      const endDate   = (req.query.endDate   as string) || new Date().toISOString().split("T")[0];
      if (!startDate) return res.status(400).json({ message: "startDate is required" });

      const monthEnds = generateMonthEnds(startDate, endDate);
      if (monthEnds.length === 0) return res.status(400).json({ message: "No months in range" });

      // ── Gather all snapshots sequentially ────────────────────────────
      type Snapshot = Awaited<ReturnType<typeof calculateNetPositionAsOf>> & {
        dateStr: string;
        label:   string;
        change:  number | null;
      };

      const snapshots: Snapshot[] = [];
      let prevNet: number | null = null;

      for (const dateStr of monthEnds) {
        const snap   = await calculateNetPositionAsOf(companyId, dateStr);
        const change = prevNet !== null ? round2(snap.netPosition - prevNet) : null;
        snapshots.push({ ...snap, dateStr, label: fmtMonthLabel(dateStr), change });
        prevNet = snap.netPosition;
      }

      // ── Build a unified set of all line-item labels (for change tracking) ──
      // Key = `${side}::${label}` so forUs and onUs never collide
      function lineKey(item: NetPositionLineItem) {
        return `${item.side}::${item.label}`;
      }
      function valueMap(lines: NetPositionLineItem[]): Map<string, number> {
        const m = new Map<string, number>();
        for (const l of lines) m.set(lineKey(l), l.value);
        return m;
      }

      // ── Build workbook ────────────────────────────────────────────────
      const ExcelJS = await import("exceljs");
      const wb = new ExcelJS.default.Workbook();
      wb.creator = "ERP System";
      wb.created = new Date();

      // ═══════════════════════════════════════════════════════════════════
      //  SHEET 1: Summary
      // ═══════════════════════════════════════════════════════════════════
      const wsSummary = wb.addWorksheet("Summary");

      // Title
      wsSummary.mergeCells("A1:G1");
      styleTitle(wsSummary.getCell("A1"), `Monthly Net Position Summary — ${companyName}`, 16);
      wsSummary.getRow(1).height = 38;

      // Subtitle
      wsSummary.mergeCells("A2:G2");
      const sub2 = wsSummary.getCell("A2");
      sub2.value     = `Period: ${startDate}  →  ${endDate}   |   Each row = month-end balance-sheet snapshot`;
      sub2.font      = { italic: true, size: 10, color: { argb: C.MUTED } };
      sub2.alignment = { horizontal: "center" };
      wsSummary.getRow(2).height = 18;

      wsSummary.addRow([]); // spacer

      // Column headers
      const hdrRow = wsSummary.addRow(["Month","Snapshot Date","What We Have","What We Owe","Net Position","Status","Monthly Change"]);
      hdrRow.height = 26;
      hdrRow.eachCell((cell) => styleHeader(cell));

      // Data rows
      for (const s of snapshots) {
        const isPos = s.netPosition >= 0;
        const dr    = wsSummary.addRow([
          s.label,
          s.dateStr,
          s.forUsTotal,
          s.onUsTotal,
          Math.abs(s.netPosition),
          s.netPositionLabel,
          s.change,
        ]);
        dr.getCell(1).font = { bold: true };
        dr.getCell(2).alignment = { horizontal: "center" };
        dr.getCell(2).font = { color: { argb: C.MUTED }, size: 9 };
        [3,4,5].forEach(i => { dr.getCell(i).numFmt = currencyFmt; });
        dr.getCell(3).font = { color: { argb: C.GREEN } };
        dr.getCell(4).font = { color: { argb: C.RED   } };
        dr.getCell(5).font = { bold: true, color: { argb: isPos ? C.GREEN : C.RED } };
        dr.getCell(6).font = { bold: true, color: { argb: isPos ? C.GREEN : C.RED } };

        const changeCell = dr.getCell(7);
        if (s.change !== null) {
          changeCell.numFmt = signedFmt;
          changeCell.font   = { italic: true, color: { argb: s.change >= 0 ? C.GREEN : C.RED } };
        } else {
          changeCell.value = "—";
          changeCell.font  = { color: { argb: C.MUTED }, italic: true };
        }

        dr.eachCell((cell) => {
          cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: isPos ? C.GREEN_BG : C.RED_BG } };
          setThin(cell);
        });
      }

      // Separator
      wsSummary.addRow([]);

      // Final Net Position
      const lastSnap    = snapshots[snapshots.length - 1];
      const isFinalPos  = lastSnap.netPosition >= 0;
      const finalRow    = wsSummary.addRow(["Final Net Position","",lastSnap.forUsTotal,lastSnap.onUsTotal,Math.abs(lastSnap.netPosition),lastSnap.netPositionLabel,""]);
      finalRow.height   = 24;
      finalRow.getCell(1).font = { bold: true, size: 12 };
      [3,4,5].forEach(i => { finalRow.getCell(i).numFmt = currencyFmt; });
      finalRow.getCell(3).font = { bold: true, color: { argb: C.GREEN } };
      finalRow.getCell(4).font = { bold: true, color: { argb: C.RED   } };
      finalRow.getCell(5).font = { bold: true, size: 12, color: { argb: isFinalPos ? C.GREEN : C.RED } };
      finalRow.getCell(6).font = { bold: true, size: 12, color: { argb: isFinalPos ? C.GREEN : C.RED } };
      finalRow.eachCell((cell) => {
        cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: isFinalPos ? "FFB3F5D3" : "FFFDCFCF" } };
        cell.border = { top: { style: "medium", color: { argb: C.DARK_BLUE } }, bottom: { style: "medium", color: { argb: C.DARK_BLUE } } };
      });

      // Total Change
      const totalChange = round2(snapshots.reduce((s, x) => s + (x.change ?? 0), 0));
      const tcRow       = wsSummary.addRow(["Total Change (period)","","","","","",totalChange]);
      tcRow.height      = 22;
      tcRow.getCell(1).font = { bold: true };
      tcRow.getCell(7).numFmt = signedFmt;
      tcRow.getCell(7).font   = { bold: true, color: { argb: totalChange >= 0 ? C.GREEN : C.RED } };
      tcRow.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.YELLOW_BG } }; });

      // Column widths
      [20, 14, 18, 16, 16, 20, 18].forEach((w, i) => { wsSummary.getColumn(i + 1).width = w; });

      // ═══════════════════════════════════════════════════════════════════
      //  SHEETS 2…N: one per month
      // ═══════════════════════════════════════════════════════════════════
      for (let idx = 0; idx < snapshots.length; idx++) {
        const snap     = snapshots[idx];
        const prevSnap = idx > 0 ? snapshots[idx - 1] : null;
        const prevMap  = prevSnap
          ? valueMap([...prevSnap.forUsLines, ...prevSnap.onUsLines])
          : new Map<string, number>();

        const ws = wb.addWorksheet(fmtSheetName(snap.dateStr));

        // ── Title ─────────────────────────────────────────────────────
        ws.mergeCells("A1:D1");
        styleTitle(ws.getCell("A1"), `${snap.label} — Net Position Details`, 14);
        ws.getRow(1).height = 34;

        // Meta info
        ws.mergeCells("A2:D2");
        const meta = ws.getCell("A2");
        meta.value     = `${companyName}   |   Snapshot date: ${snap.dateStr}   |   Net Position: ${snap.netPosition >= 0 ? "+" : ""}${snap.netPosition.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
        meta.font      = { italic: true, size: 10, color: { argb: C.MUTED } };
        meta.alignment = { horizontal: "center" };
        ws.getRow(2).height = 18;

        // Summary KPI row
        ws.addRow([]);
        const kpiHdr = ws.addRow(["What We Have","What We Owe","Net Position","Status"]);
        kpiHdr.height = 24;
        kpiHdr.eachCell((cell) => styleSubHeader(cell));

        const isPos  = snap.netPosition >= 0;
        const kpiVal = ws.addRow([snap.forUsTotal, snap.onUsTotal, Math.abs(snap.netPosition), snap.netPositionLabel]);
        kpiVal.height = 26;
        [1,2,3].forEach(i => { kpiVal.getCell(i).numFmt = currencyFmt; });
        kpiVal.getCell(1).font = { bold: true, size: 13, color: { argb: C.GREEN } };
        kpiVal.getCell(2).font = { bold: true, size: 13, color: { argb: C.RED   } };
        kpiVal.getCell(3).font = { bold: true, size: 13, color: { argb: isPos ? C.GREEN : C.RED } };
        kpiVal.getCell(4).font = { bold: true, size: 12, color: { argb: isPos ? C.GREEN : C.RED } };
        kpiVal.eachCell((cell) => {
          cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: C.LIGHT_BLUE } };
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border    = { bottom: { style: "medium", color: { argb: C.DARK_BLUE } } };
        });

        if (snap.change !== null) {
          ws.addRow([]);
          const chgRow = ws.addRow([
            `Change vs ${prevSnap?.label ?? "prior month"}:`,
            snap.change,
            "",
            snap.change >= 0 ? "Improved" : "Declined",
          ]);
          chgRow.getCell(1).font = { bold: true, color: { argb: C.MUTED } };
          chgRow.getCell(2).numFmt = signedFmt;
          chgRow.getCell(2).font   = { bold: true, color: { argb: snap.change >= 0 ? C.GREEN : C.RED } };
          chgRow.getCell(4).font   = { italic: true, color: { argb: snap.change >= 0 ? C.GREEN : C.RED } };
          chgRow.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.AMBER_BG } }; });
        }

        ws.addRow([]);

        // ── Column header for detail table ────────────────────────────
        const prevLabel = prevSnap ? prevSnap.label : "Prior";
        const detailHdr = ws.addRow(["Line Item", "Category", snap.label, prevLabel, "Change"]);
        detailHdr.height = 24;
        detailHdr.eachCell((cell) => styleHeader(cell));

        // ── WHAT WE HAVE section ──────────────────────────────────────
        const forUsSectionRow = ws.addRow(["WHAT WE HAVE", "", "", "", ""]);
        forUsSectionRow.height = 22;
        setSectionHeader(forUsSectionRow.getCell(1), "  WHAT WE HAVE", C.GREEN.replace("FF","FF"));
        forUsSectionRow.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16A34A" } };
          cell.font = { bold: true, color: { argb: C.WHITE } };
        });

        let forUsSubtotal = 0;
        for (const line of snap.forUsLines) {
          const key      = lineKey(line);
          const prevVal  = prevMap.get(key) ?? 0;
          const change   = prevSnap ? round2(line.value - prevVal) : null;
          forUsSubtotal += line.value;

          const dr = ws.addRow([line.label, line.category, line.value, prevSnap ? prevVal : null, change]);
          dr.getCell(1).font      = { size: 10 };
          dr.getCell(2).font      = { size: 9, color: { argb: C.MUTED } };
          dr.getCell(2).alignment = { horizontal: "center" };
          dr.getCell(3).numFmt    = currencyFmt;
          dr.getCell(3).font      = { color: { argb: C.GREEN } };
          if (prevSnap) {
            dr.getCell(4).numFmt  = currencyFmt;
            dr.getCell(4).font    = { color: { argb: C.MUTED } };
          } else {
            dr.getCell(4).value   = "—";
            dr.getCell(4).font    = { color: { argb: C.MUTED } };
          }
          if (change !== null) {
            dr.getCell(5).numFmt  = signedFmt;
            dr.getCell(5).font    = { italic: true, color: { argb: change >= 0 ? C.GREEN : C.RED } };
          } else {
            dr.getCell(5).value   = "—";
            dr.getCell(5).font    = { color: { argb: C.MUTED } };
          }
          dr.eachCell((cell) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.GREEN_BG } };
            setThin(cell);
          });
        }

        // ForUs subtotal
        const forUsTotalRow = ws.addRow(["Total — What We Have", "", forUsSubtotal, prevSnap ? prevSnap.forUsTotal : null, prevSnap ? round2(forUsSubtotal - prevSnap.forUsTotal) : null]);
        forUsTotalRow.height = 20;
        forUsTotalRow.getCell(1).font = { bold: true };
        forUsTotalRow.getCell(3).numFmt = currencyFmt;
        forUsTotalRow.getCell(3).font   = { bold: true, color: { argb: C.GREEN } };
        if (prevSnap) {
          forUsTotalRow.getCell(4).numFmt = currencyFmt;
          forUsTotalRow.getCell(4).font   = { bold: true, color: { argb: C.MUTED } };
          forUsTotalRow.getCell(5).numFmt = signedFmt;
          forUsTotalRow.getCell(5).font   = { bold: true, color: { argb: (forUsSubtotal - prevSnap.forUsTotal) >= 0 ? C.GREEN : C.RED } };
        }
        forUsTotalRow.eachCell((cell) => {
          cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB3F5D3" } };
          cell.border = { top: { style: "thin", color: { argb: "FF16A34A" } }, bottom: { style: "thin", color: { argb: "FF16A34A" } } };
        });

        ws.addRow([]);

        // ── WHAT WE OWE section ───────────────────────────────────────
        const onUsSectionRow = ws.addRow(["WHAT WE OWE", "", "", "", ""]);
        onUsSectionRow.height = 22;
        onUsSectionRow.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDC2626" } };
          cell.font = { bold: true, color: { argb: C.WHITE } };
        });

        let onUsSubtotal = 0;
        for (const line of snap.onUsLines) {
          const key      = lineKey(line);
          const prevVal  = prevMap.get(key) ?? 0;
          const change   = prevSnap ? round2(line.value - prevVal) : null;
          onUsSubtotal  += line.value;

          const dr = ws.addRow([line.label, line.category, line.value, prevSnap ? prevVal : null, change]);
          dr.getCell(1).font      = { size: 10 };
          dr.getCell(2).font      = { size: 9, color: { argb: C.MUTED } };
          dr.getCell(2).alignment = { horizontal: "center" };
          dr.getCell(3).numFmt    = currencyFmt;
          dr.getCell(3).font      = { color: { argb: C.RED } };
          if (prevSnap) {
            dr.getCell(4).numFmt  = currencyFmt;
            dr.getCell(4).font    = { color: { argb: C.MUTED } };
          } else {
            dr.getCell(4).value   = "—";
            dr.getCell(4).font    = { color: { argb: C.MUTED } };
          }
          if (change !== null) {
            dr.getCell(5).numFmt  = signedFmt;
            // For liabilities: an increase in "what we owe" is bad (red), decrease is good (green)
            dr.getCell(5).font    = { italic: true, color: { argb: change <= 0 ? C.GREEN : C.RED } };
          } else {
            dr.getCell(5).value   = "—";
            dr.getCell(5).font    = { color: { argb: C.MUTED } };
          }
          dr.eachCell((cell) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.RED_BG } };
            setThin(cell);
          });
        }

        // OnUs subtotal
        const onUsTotalRow = ws.addRow(["Total — What We Owe", "", onUsSubtotal, prevSnap ? prevSnap.onUsTotal : null, prevSnap ? round2(onUsSubtotal - prevSnap.onUsTotal) : null]);
        onUsTotalRow.height = 20;
        onUsTotalRow.getCell(1).font = { bold: true };
        onUsTotalRow.getCell(3).numFmt = currencyFmt;
        onUsTotalRow.getCell(3).font   = { bold: true, color: { argb: C.RED } };
        if (prevSnap) {
          onUsTotalRow.getCell(4).numFmt = currencyFmt;
          onUsTotalRow.getCell(4).font   = { bold: true, color: { argb: C.MUTED } };
          const oweDiff = onUsSubtotal - prevSnap.onUsTotal;
          onUsTotalRow.getCell(5).numFmt = signedFmt;
          onUsTotalRow.getCell(5).font   = { bold: true, color: { argb: oweDiff <= 0 ? C.GREEN : C.RED } };
        }
        onUsTotalRow.eachCell((cell) => {
          cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDCFCF" } };
          cell.border = { top: { style: "thin", color: { argb: C.RED } }, bottom: { style: "thin", color: { argb: C.RED } } };
        });

        ws.addRow([]);

        // ── New / Removed items (what changed this month) ─────────────
        if (prevSnap) {
          const prevAllLines = [...prevSnap.forUsLines, ...prevSnap.onUsLines];
          const currAllLines = [...snap.forUsLines,     ...snap.onUsLines    ];
          const currKeys = new Set(currAllLines.map(lineKey));
          const prevKeys = new Set(prevAllLines.map(lineKey));

          const disappeared = prevAllLines.filter((l) => !currKeys.has(lineKey(l)));
          const appeared    = currAllLines.filter((l) => !prevKeys.has(lineKey(l)));

          if (appeared.length > 0 || disappeared.length > 0) {
            const movHdr = ws.addRow(["Changes This Month (Appeared / Disappeared)", "", "", "", ""]);
            movHdr.height = 22;
            movHdr.eachCell((cell) => {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.DARK_BLUE } };
              cell.font = { bold: true, color: { argb: C.WHITE }, size: 11 };
            });

            for (const l of appeared) {
              const dr = ws.addRow([`+ ${l.label}`, l.category, l.value, "", `NEW — ${l.side === "forUs" ? "What We Have" : "What We Owe"}`]);
              dr.getCell(1).font = { bold: true, color: { argb: C.GREEN } };
              dr.getCell(3).numFmt = currencyFmt;
              dr.getCell(3).font   = { color: { argb: C.GREEN } };
              dr.getCell(5).font   = { italic: true, color: { argb: C.GREEN } };
              dr.eachCell((cell) => {
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.GREEN_BG } };
                setThin(cell);
              });
            }

            for (const l of disappeared) {
              const dr = ws.addRow([`- ${l.label}`, l.category, "", l.value, `REMOVED — ${l.side === "forUs" ? "What We Have" : "What We Owe"}`]);
              dr.getCell(1).font = { bold: true, color: { argb: C.RED } };
              dr.getCell(4).numFmt = currencyFmt;
              dr.getCell(4).font   = { color: { argb: C.MUTED } };
              dr.getCell(5).font   = { italic: true, color: { argb: C.RED } };
              dr.eachCell((cell) => {
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.RED_BG } };
                setThin(cell);
              });
            }
          }
        }

        // ── Column widths ─────────────────────────────────────────────
        ws.getColumn(1).width = 36;  // Line Item
        ws.getColumn(2).width = 18;  // Category
        ws.getColumn(3).width = 18;  // Current month value
        ws.getColumn(4).width = 18;  // Prior month value
        ws.getColumn(5).width = 18;  // Change
      }

      // ─── Stream ───────────────────────────────────────────────────────
      const safeCompany = companyName.replace(/[^a-z0-9]/gi, "_");
      const safeStart   = startDate.replace(/-/g, "");
      const safeEnd     = endDate.replace(/-/g, "");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="NetPosition_Monthly_${safeCompany}_${safeStart}_${safeEnd}.xlsx"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Net position monthly Excel error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
