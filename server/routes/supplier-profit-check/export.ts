/**
 * supplierProfitCheckRoutes: SupplierProfitExport endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { pool } from "../../db";
import ExcelJS from "exceljs";

export function registerSupplierProfitExportRoutes(app: Express, requireAuth: any) {
  app.get(
    "/api/supplier-profit-check/proforma/:proformaId/export-supplier",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const proformaId = parseInt(req.params.proformaId);
        if (isNaN(proformaId)) return res.status(400).json({ message: "Invalid proformaId" });

        const proformaResult = await pool.query(
          `
        SELECT sp.*, s.legal_name as supplier_name
        FROM supplier_proformas sp
        JOIN suppliers s ON s.id = sp.supplier_id
        WHERE sp.id = $1 AND sp.company_id = $2
      `,
          [proformaId, companyId]
        );
        if (!proformaResult.rows.length) return res.status(404).json({ message: "Proforma not found" });
        const proforma = proformaResult.rows[0];

        const linesResult = await pool.query(
          `
        SELECT barcode, item_name, qty, weight_per_bale, price_per_bale,
          (qty * price_per_bale::numeric) as total_price
        FROM supplier_proforma_lines
        WHERE proforma_id = $1
        ORDER BY barcode
      `,
          [proformaId]
        );
        const lines = linesResult.rows;

        const wb = new ExcelJS.Workbook();
        wb.creator = "ERP System";
        const ws = wb.addWorksheet("Proforma");

        const NAVY = "1A2C5B";
        const GOLD = "C9A84C";
        const LIGHT_GOLD = "F7EFD8";
        const WHITE = "FFFFFF";

        ws.columns = [
          { key: "item_code", width: 18 },
          { key: "item_name", width: 35 },
          { key: "qty", width: 12 },
          { key: "unit_price", width: 15 },
          { key: "total_price", width: 18 },
        ];

        // Header banner (rows 1-3)
        ws.mergeCells("A1:E1");
        const title = ws.getCell("A1");
        title.value = "SUPPLIER PROFORMA";
        title.font = { bold: true, size: 16, color: { argb: WHITE } };
        title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        title.alignment = { horizontal: "center", vertical: "middle" };
        ws.getRow(1).height = 30;

        ws.mergeCells("A2:C2");
        ws.getCell("A2").value = `Supplier: ${proforma.supplier_name}`;
        ws.getCell("A2").font = { bold: true, size: 11, color: { argb: NAVY } };
        ws.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GOLD } };

        ws.mergeCells("D2:E2");
        ws.getCell("D2").value = `Ref: ${proforma.reference}`;
        ws.getCell("D2").font = { bold: true, size: 11, color: { argb: NAVY } };
        ws.getCell("D2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GOLD } };
        ws.getCell("D2").alignment = { horizontal: "right" };

        ws.mergeCells("A3:C3");
        ws.getCell("A3").value = `Date: ${new Date().toLocaleDateString()}`;
        ws.getCell("A3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GOLD } };

        if (proforma.notes) {
          ws.mergeCells("D3:E3");
          ws.getCell("D3").value = proforma.notes;
          ws.getCell("D3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GOLD } };
        }
        ws.getRow(2).height = 22;
        ws.getRow(3).height = 20;

        // Column headers
        const headerRow = ws.addRow(["Item Code", "Item Name", "Qty", "Unit Price (USD)", "Total (USD)"]);
        headerRow.eachCell((c) => {
          c.font = { bold: true, color: { argb: WHITE } };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GOLD } };
          c.alignment = { horizontal: "center" };
          c.border = {
            bottom: { style: "thin", color: { argb: NAVY } },
          };
        });
        headerRow.height = 20;

        let totalQty = 0;
        let grandTotal = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const qty = Number(line.qty);
          const unitPrice = Number(line.price_per_bale);
          const total = qty * unitPrice;
          totalQty += qty;
          grandTotal += total;

          const row = ws.addRow([line.barcode, line.item_name, qty, unitPrice, total]);
          if (i % 2 === 0) {
            row.eachCell((c) => {
              c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F4F6FA" } };
            });
          }
          row.getCell(3).numFmt = "#,##0";
          row.getCell(4).numFmt = "#,##0.00";
          row.getCell(5).numFmt = "#,##0.00";
          row.getCell(3).alignment = { horizontal: "right" };
          row.getCell(4).alignment = { horizontal: "right" };
          row.getCell(5).alignment = { horizontal: "right" };
        }

        // Grand total row
        const totRow = ws.addRow(["", "GRAND TOTAL", totalQty, "", grandTotal]);
        totRow.eachCell((c) => {
          c.font = { bold: true, color: { argb: WHITE } };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
          c.border = {
            top: { style: "double", color: { argb: GOLD } },
          };
        });
        totRow.getCell(3).numFmt = "#,##0";
        totRow.getCell(5).numFmt = "#,##0.00";
        totRow.getCell(3).alignment = { horizontal: "right" };
        totRow.getCell(5).alignment = { horizontal: "right" };

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="proforma-${proforma.reference}.xlsx"`);
        const buffer = Buffer.from(await wb.xlsx.writeBuffer());
        res.send(buffer);
      } catch (err: unknown) {
        logger.error("[export-supplier]", { error: getErrorMessage(err) });
        res.status(500).json({ message: getErrorMessage(err) });
      }
    }
  );

  app.post("/api/supplier-profit-check/export-internal", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { rows, supplierName, fromDate, toDate, proformaRef } = req.body;
      if (!Array.isArray(rows)) return res.status(400).json({ message: "rows required" });

      const wb = new ExcelJS.Workbook();
      wb.creator = "ERP System";
      const ws = wb.addWorksheet("Analysis");

      const NAVY = "1A2C5B";
      const GOLD = "C9A84C";
      const GREEN = "1A7A3E";
      const RED = "C0392B";
      const YELLOW = "856404";
      const LIGHT_RED = "FDECEA";
      const LIGHT_GREEN = "E9F7EF";
      const LIGHT_YELLOW = "FFF9E6";
      const WHITE = "FFFFFF";

      ws.columns = [
        { key: "code", width: 14 },
        { key: "name", width: 32 },
        { key: "stock", width: 12 },
        { key: "avg_sell", width: 14 },
        { key: "hassans_price", width: 16 },
        { key: "avg_cost", width: 14 },
        { key: "cost_source", width: 14 },
        { key: "hassans_profit", width: 16 },
        { key: "hassans_profit_pct", width: 13 },
        { key: "cost_profit", width: 16 },
        { key: "cost_profit_pct", width: 13 },
        { key: "status", width: 12 },
        { key: "qty", width: 10 },
        { key: "total_avg_cost", width: 18 },
        { key: "est_total_sales", width: 18 },
        { key: "est_hassans_profit", width: 20 },
        { key: "est_cost_profit", width: 18 },
      ];

      // Title
      ws.mergeCells("A1:R1");
      const t = ws.getCell("A1");
      t.value = `INTERNAL PROFIT ANALYSIS — ${supplierName || ""}`;
      t.font = { bold: true, size: 14, color: { argb: WHITE } };
      t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      t.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(1).height = 28;

      ws.mergeCells("A2:R2");
      const sub = ws.getCell("A2");
      sub.value = `Date Range: ${fromDate} → ${toDate}   |   Proforma Ref: ${proformaRef || "N/A"}`;
      sub.font = { bold: false, size: 10, color: { argb: NAVY } };
      sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F7EFD8" } };
      sub.alignment = { horizontal: "center" };
      ws.getRow(2).height = 18;

      const headers = [
        "Item Code",
        "Item Name",
        "Current Stock",
        "Avg Sell Price",
        "Hassan's Price",
        "Avg Cost",
        "Cost Source",
        "Hassan's Profit",
        "Hassan's Profit %",
        "Cost Profit",
        "Cost Profit %",
        "Status",
        "Qty to Order",
        "Total Avg Cost",
        "Est. Total Sales",
        "Est. Hassan's Profit",
        "Est. Cost Profit",
      ];
      const hRow = ws.addRow(headers);
      hRow.eachCell((c) => {
        c.font = { bold: true, color: { argb: WHITE }, size: 10 };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GOLD } };
        c.alignment = { horizontal: "center", wrapText: true };
        c.border = { bottom: { style: "thin", color: { argb: NAVY } } };
      });
      hRow.height = 24;

      const numFmt2 = "#,##0.00";
      const numFmt0 = "#,##0";
      const numFmtPct = '0.00"%"';

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const sell = r.avgSellingPrice != null ? Number(r.avgSellingPrice) : null;
        const hassansPrice = Number(r.configPrice) || 0;
        const avgCost = Number(r.offloadingCost) || 0;

        // Hassan's Profit = Hassan's Price − Avg Cost
        const hassansProfit = hassansPrice - avgCost;
        const hassansProfitPct = hassansPrice > 0 ? (hassansProfit / hassansPrice) * 100 : null;

        // Cost Profit = Avg Sell − Avg Cost
        const costProfit = sell != null ? sell - avgCost : null;
        const costProfitPct = sell != null && sell > 0 && costProfit != null ? (costProfit / sell) * 100 : null;

        const qty = Number(r.qty) || 0;
        const totalAvgCost = qty * avgCost;
        const estTotalSales = sell != null ? qty * sell : 0;
        const estHassansProfit = qty * hassansProfit;
        const estCostProfit = costProfit != null ? qty * costProfit : 0;

        const statusByHassans =
          hassansProfit > 0 ? "gaining" : hassansProfit < 0 ? "losing" : sell == null ? "no_sales_data" : "break_even";

        const dataRow = ws.addRow([
          r.code,
          r.name,
          Number(r.currentStock) || 0,
          sell ?? "",
          hassansPrice,
          avgCost,
          r.nCostSource || "missing",
          hassansProfit,
          hassansProfitPct ?? "",
          costProfit ?? "",
          costProfitPct ?? "",
          statusByHassans,
          qty,
          totalAvgCost,
          estTotalSales,
          estHassansProfit,
          estCostProfit,
        ]);

        // Row background by hassan's profit status
        let rowColor: string | null = null;
        if (statusByHassans === "losing") rowColor = LIGHT_RED;
        else if (statusByHassans === "gaining") rowColor = LIGHT_GREEN;
        else if (statusByHassans === "no_sales_data") rowColor = LIGHT_YELLOW;
        if (rowColor) {
          dataRow.eachCell((c) => {
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowColor! } };
          });
        }

        // Status cell font color (col 12)
        const statusCell = dataRow.getCell(12);
        if (statusByHassans === "gaining") statusCell.font = { bold: true, color: { argb: GREEN } };
        else if (statusByHassans === "losing") statusCell.font = { bold: true, color: { argb: RED } };
        else if (statusByHassans === "no_sales_data") statusCell.font = { bold: true, color: { argb: YELLOW } };

        // Number formats: 3=stock, 4=sell, 5=hassansPrice, 6=avgCost, 8=hassansProfit, 10=costProfit, 14=totalAvgCost, 15=estSales, 16=estHassans, 17=estCost
        [4, 5, 6, 8, 10, 14, 15, 16, 17].forEach((col) => {
          dataRow.getCell(col).numFmt = numFmt2;
        });
        dataRow.getCell(3).numFmt = numFmt2;
        dataRow.getCell(9).numFmt = numFmtPct; // Hassan's Profit %
        dataRow.getCell(11).numFmt = numFmtPct; // Cost Profit %
        dataRow.getCell(13).numFmt = numFmt0; // Qty
      }

      // Summary totals
      const hasQty = rows.filter((r) => Number(r.qty) > 0);
      const totalQtyOrdered = hasQty.reduce((s: number, r) => s + (Number(r.qty) || 0), 0);
      const totalAvgCostSum = hasQty.reduce(
        (s: number, r) => s + (Number(r.qty) || 0) * (Number(r.offloadingCost) || 0),
        0
      );
      const totalEstSales = hasQty.reduce((s: number, r) => {
        return r.avgSellingPrice != null ? s + (Number(r.qty) || 0) * Number(r.avgSellingPrice) : s;
      }, 0);
      const totalEstHassansProfit = hasQty.reduce((s: number, r) => {
        const hp = (Number(r.configPrice) || 0) - (Number(r.offloadingCost) || 0);
        return s + (Number(r.qty) || 0) * hp;
      }, 0);
      const totalEstCostProfit = hasQty.reduce((s: number, r) => {
        const sell = r.avgSellingPrice != null ? Number(r.avgSellingPrice) : null;
        const p = sell != null ? sell - (Number(r.offloadingCost) || 0) : null;
        return p != null ? s + (Number(r.qty) || 0) * p : s;
      }, 0);

      ws.addRow([]);
      const sumRow = ws.addRow([
        "TOTALS",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        `${hasQty.length} items`,
        totalQtyOrdered,
        totalAvgCostSum,
        totalEstSales,
        totalEstHassansProfit,
        totalEstCostProfit,
      ]);
      sumRow.eachCell((c) => {
        c.font = { bold: true, color: { argb: WHITE } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        c.border = { top: { style: "double", color: { argb: GOLD } } };
      });
      sumRow.getCell(13).numFmt = numFmt0; // qty
      sumRow.getCell(14).numFmt = numFmt2; // total avg cost
      sumRow.getCell(15).numFmt = numFmt2; // est sales
      sumRow.getCell(16).numFmt = numFmt2; // est hassan's profit
      sumRow.getCell(17).numFmt = numFmt2; // est cost profit

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="profit-analysis-${proformaRef || "export"}.xlsx"`);
      const buffer = Buffer.from(await wb.xlsx.writeBuffer());
      res.send(buffer);
    } catch (err: unknown) {
      logger.error("[export-internal]", { error: getErrorMessage(err) });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });

  // ── PO Price Overrides ──────────────────────────────────────────────────────
}
