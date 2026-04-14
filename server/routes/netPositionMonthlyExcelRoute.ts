/**
 * GET /api/reports/net-position-monthly-excel
 *
 * Exports a monthly net-position snapshot workbook.
 * Each row = last day of a calendar month in [startDate, endDate].
 * The calculation matches /api/stats/net-profit exactly via the shared
 * calculateNetPositionAsOf() helper.
 *
 * Columns:
 *   Month | What We Have | What We Owe | Net Position | Status | Monthly Change
 *
 * Final rows:
 *   Final Net Position = last month-end net position
 *   Total Change       = sum of monthly changes
 */

import type { Express } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { calculateNetPositionAsOf } from "../helpers/calculateNetPositionAsOf";
import { round2 } from "../netPositionHelper";

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month + 1, 0));
  return d.toISOString().split("T")[0];
}

function fmtMonthLabel(dateStr: string): string {
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const [yr, mo] = dateStr.split("-");
  return `${names[parseInt(mo) - 1]} ${yr}`;
}

function generateMonthEnds(startDate: string, endDate: string): string[] {
  const ends: string[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end   = new Date(endDate   + "T00:00:00Z");

  let year  = start.getUTCFullYear();
  let month = start.getUTCMonth(); // 0-based

  while (true) {
    const candidate = lastDayOfMonth(year, month);
    const candidateDate = new Date(candidate + "T00:00:00Z");

    if (candidateDate <= end) {
      ends.push(candidate);
    } else {
      // If endDate falls inside this month, use endDate as the snapshot
      if (
        new Date(`${year}-${String(month + 1).padStart(2, "0")}-01T00:00:00Z`) <= end
      ) {
        ends.push(endDate);
      }
      break;
    }

    month++;
    if (month > 11) { month = 0; year++; }
    if (year > 2100) break; // safety
  }

  return ends;
}

export function registerNetPositionMonthlyExcelRoute(app: Express) {
  app.get("/api/reports/net-position-monthly-excel", requireAuth, async (req, res) => {
    try {
      const user = req.session.user as any;
      const isAdminOrDev = user?.role === "Admin" || user?.role === "Developer";
      const requestedCompanyId = req.query.companyId
        ? parseInt(req.query.companyId as string)
        : null;
      const companyId =
        isAdminOrDev && requestedCompanyId
          ? requestedCompanyId
          : req.session.currentCompanyId;

      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const allCompanies = await storage.getAllCompanies();
      const company = allCompanies.find((c: any) => c.id === companyId);
      const companyName = company?.name || "Company";

      // Date range — required
      const startDate = (req.query.startDate as string) || "";
      const endDate   = (req.query.endDate   as string) || new Date().toISOString().split("T")[0];

      if (!startDate) {
        return res.status(400).json({ message: "startDate is required" });
      }

      // Generate month-end snapshot dates
      const monthEnds = generateMonthEnds(startDate, endDate);
      if (monthEnds.length === 0) {
        return res.status(400).json({ message: "No months found in the given date range" });
      }

      // Calculate net position for each month-end snapshot
      // Run sequentially to avoid overwhelming DB with parallel historical calculations
      const snapshots: Array<{
        dateStr: string;
        label: string;
        forUs: number;
        onUs: number;
        net: number;
        status: string;
        change: number | null;
      }> = [];

      let prevNet: number | null = null;
      for (const dateStr of monthEnds) {
        const snap = await calculateNetPositionAsOf(companyId, dateStr);
        const change = prevNet !== null ? round2(snap.netPosition - prevNet) : null;
        snapshots.push({
          dateStr,
          label:  fmtMonthLabel(dateStr),
          forUs:  snap.forUsTotal,
          onUs:   snap.onUsTotal,
          net:    snap.netPosition,
          status: snap.netPositionLabel,
          change,
        });
        prevNet = snap.netPosition;
      }

      // Summary values
      const finalNet   = snapshots[snapshots.length - 1].net;
      const totalChange = round2(
        snapshots.reduce((sum, s) => sum + (s.change ?? 0), 0)
      );

      // ─── Build Excel workbook ─────────────────────────────────────────
      const ExcelJS = await import("exceljs");
      const wb = new ExcelJS.default.Workbook();
      wb.creator = "ERP System";
      wb.created = new Date();

      const ws = wb.addWorksheet("Monthly Net Position");

      // ── Styling helpers ──────────────────────────────────────────────
      const DARK_BLUE = "FF1E3A5F";
      const GREEN     = "FF16A34A";
      const RED       = "FFDC2626";
      const GREEN_BG  = "FFD1FAE5";
      const RED_BG    = "FFFEE2E2";
      const YELLOW_BG = "FFFEF9C3";
      const HEADER_FG = "FFFFFFFF";

      const currencyFmt = "#,##0.00";
      const signedFmt   = '+#,##0.00;-#,##0.00;"-"';

      function styleHeader(cell: any) {
        cell.font = { bold: true, color: { argb: HEADER_FG }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_BLUE } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = {
          bottom: { style: "thin", color: { argb: "FFAAAAAA" } },
        };
      }

      function styleData(cell: any, isGood: boolean | null) {
        if (isGood === true) {
          cell.font = { color: { argb: GREEN } };
        } else if (isGood === false) {
          cell.font = { color: { argb: RED } };
        }
      }

      // ── Title row ────────────────────────────────────────────────────
      ws.mergeCells("A1:F1");
      const titleCell = ws.getCell("A1");
      titleCell.value = `Monthly Net Position — ${companyName}`;
      titleCell.font = { bold: true, size: 16, color: { argb: HEADER_FG } };
      titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_BLUE } };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(1).height = 36;

      // ── Subtitle ─────────────────────────────────────────────────────
      ws.mergeCells("A2:F2");
      const subCell = ws.getCell("A2");
      subCell.value = `Period: ${startDate}  →  ${endDate}  |  Each row is a month-end balance-sheet snapshot`;
      subCell.font = { italic: true, size: 10, color: { argb: "FF555555" } };
      subCell.alignment = { horizontal: "center" };
      ws.getRow(2).height = 20;

      ws.addRow([]); // blank

      // ── Column header row ─────────────────────────────────────────────
      const headerRow = ws.addRow([
        "Month",
        "What We Have",
        "What We Owe",
        "Net Position",
        "Status",
        "Monthly Change",
      ]);
      headerRow.height = 28;
      headerRow.eachCell((cell) => styleHeader(cell));

      // ── Data rows ─────────────────────────────────────────────────────
      for (const s of snapshots) {
        const isPositive = s.net >= 0;
        const displayNet = Math.abs(s.net); // always positive; status column carries sign info

        const dataRow = ws.addRow([
          s.label,
          s.forUs,
          s.onUs,
          displayNet,
          s.status,
          s.change,
        ]);

        // Month label
        dataRow.getCell(1).font = { bold: true };

        // What We Have — always positive
        dataRow.getCell(2).numFmt = currencyFmt;
        styleData(dataRow.getCell(2), true);

        // What We Owe — always positive
        dataRow.getCell(3).numFmt = currencyFmt;
        styleData(dataRow.getCell(3), false);

        // Net Position (absolute value)
        dataRow.getCell(4).numFmt = currencyFmt;
        styleData(dataRow.getCell(4), isPositive);

        // Status cell — highlight row
        const statusCell = dataRow.getCell(5);
        statusCell.font = { bold: true, color: { argb: isPositive ? GREEN : RED } };
        dataRow.eachCell((cell) => {
          cell.fill = {
            type: "pattern", pattern: "solid",
            fgColor: { argb: isPositive ? GREEN_BG : RED_BG },
          };
        });

        // Monthly Change — show signed value (null for first month)
        const changeCell = dataRow.getCell(6);
        if (s.change !== null) {
          changeCell.numFmt = signedFmt;
          changeCell.font = {
            color: { argb: s.change >= 0 ? GREEN : RED },
            italic: true,
          };
        } else {
          changeCell.value = "—";
          changeCell.font = { color: { argb: "FFAAAAAA" }, italic: true };
        }

        // Subtle border between rows
        dataRow.eachCell((cell) => {
          cell.border = { bottom: { style: "hair", color: { argb: "FFDDDDDD" } } };
        });
      }

      // ── Blank separator ───────────────────────────────────────────────
      ws.addRow([]);

      // ── Final Net Position row ────────────────────────────────────────
      const isFinalPositive = finalNet >= 0;
      const finalRow = ws.addRow([
        "Final Net Position",
        "",
        "",
        Math.abs(finalNet),
        isFinalPositive ? "We Have More" : "We Owe More",
        "",
      ]);
      finalRow.height = 24;
      finalRow.getCell(1).font = { bold: true, size: 12 };
      finalRow.getCell(4).numFmt = currencyFmt;
      finalRow.getCell(4).font  = { bold: true, size: 12, color: { argb: isFinalPositive ? GREEN : RED } };
      finalRow.getCell(5).font  = { bold: true, size: 12, color: { argb: isFinalPositive ? GREEN : RED } };
      finalRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern", pattern: "solid",
          fgColor: { argb: isFinalPositive ? "FFB3F5D3" : "FFFDCFCF" },
        };
        cell.border = {
          top:    { style: "medium", color: { argb: DARK_BLUE } },
          bottom: { style: "medium", color: { argb: DARK_BLUE } },
        };
      });

      // ── Total Change row ──────────────────────────────────────────────
      const changeRow = ws.addRow([
        "Total Change",
        "",
        "",
        "",
        "",
        totalChange,
      ]);
      changeRow.height = 22;
      changeRow.getCell(1).font = { bold: true };
      changeRow.getCell(6).numFmt = signedFmt;
      changeRow.getCell(6).font   = {
        bold: true,
        color: { argb: totalChange >= 0 ? GREEN : RED },
      };
      changeRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW_BG } };
      });

      // ── Column widths ─────────────────────────────────────────────────
      ws.getColumn(1).width = 18; // Month
      ws.getColumn(2).width = 18; // What We Have
      ws.getColumn(3).width = 16; // What We Owe
      ws.getColumn(4).width = 16; // Net Position
      ws.getColumn(5).width = 18; // Status
      ws.getColumn(6).width = 18; // Monthly Change

      // ─── Stream response ──────────────────────────────────────────────
      const safeCompany = companyName.replace(/[^a-z0-9]/gi, "_");
      const safeStart   = startDate.replace(/-/g, "");
      const safeEnd     = endDate.replace(/-/g, "");
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="NetPosition_Monthly_${safeCompany}_${safeStart}_${safeEnd}.xlsx"`
      );
      await wb.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Net position monthly Excel error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
