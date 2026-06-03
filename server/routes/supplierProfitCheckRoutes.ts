import { Express } from "express";
import { pool } from "../db";
import ExcelJS from "exceljs";

export function registerSupplierProfitCheckRoutes(app: Express, requireAuth: any) {

  app.post("/api/supplier-profit-check/analyze", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { supplierId, fromDate, toDate, sourceType, proformaId } = req.body;
      if (!supplierId) return res.status(400).json({ message: "supplierId required" });
      if (!fromDate || !toDate) return res.status(400).json({ message: "Date range required" });

      // 1. Get stock items (all for company OR from proforma lines)
      let itemsResult;
      if (sourceType === "proforma" && proformaId) {
        itemsResult = await pool.query(`
          SELECT si.id, si.code, si.name, si.stock_group_id,
            sg.name as stock_group_name,
            spl.qty as proforma_qty,
            spl.price_per_bale as proforma_price,
            spl.barcode as proforma_barcode
          FROM supplier_proforma_lines spl
          JOIN supplier_proformas sp ON sp.id = spl.proforma_id
          JOIN stock_items si ON lower(si.code) = lower(spl.barcode)
          LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
          WHERE sp.id = $1
            AND sp.company_id = $2
            AND si.company_id = $2
            AND si.deleted_at IS NULL
          ORDER BY si.code
        `, [proformaId, companyId]);
      } else {
        itemsResult = await pool.query(`
          SELECT si.id, si.code, si.name, si.stock_group_id,
            sg.name as stock_group_name,
            NULL::integer as proforma_qty,
            NULL::numeric as proforma_price,
            si.code as proforma_barcode
          FROM stock_items si
          LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
          WHERE si.company_id = $1
            AND si.deleted_at IS NULL
          ORDER BY si.code
        `, [companyId]);
      }
      const items = itemsResult.rows;
      if (items.length === 0) return res.json([]);

      const stockItemIds = items.map((r: any) => r.id);
      const idsParam = stockItemIds.map((_: any, i: number) => `$${i + 1}`).join(",");

      // 2. Average selling price + total sales qty per item in date range
      const avgSellResult = await pool.query(`
        SELECT si.stock_item_id,
          SUM(si.total_sales::numeric) / NULLIF(SUM(si.quantity::numeric), 0) AS avg_selling_price,
          AVG(si.configured_price::numeric) FILTER (WHERE si.configured_price IS NOT NULL AND si.configured_price::numeric > 0) AS avg_config_price,
          SUM(si.quantity::numeric) AS total_qty
        FROM sales_items si
        JOIN vouchers v ON v.id = si.voucher_id
        WHERE v.company_id = $1
          AND v.voucher_type = 'Sales'
          AND v.voucher_date >= $2
          AND v.voucher_date <= $3
          AND v.deleted_at IS NULL
          AND si.stock_item_id = ANY($4::int[])
        GROUP BY si.stock_item_id
      `, [companyId, fromDate, toDate, stockItemIds]);
      const avgSellMap = new Map<number, { avgSellingPrice: number | null; avgConfigPrice: number; salesQty: number }>();
      for (const row of avgSellResult.rows) {
        avgSellMap.set(Number(row.stock_item_id), {
          avgSellingPrice: row.avg_selling_price != null ? Number(row.avg_selling_price) : null,
          avgConfigPrice: row.avg_config_price != null ? Number(row.avg_config_price) : 0,
          salesQty: row.total_qty != null ? Number(row.total_qty) : 0,
        });
      }

      // 3. N Cost: most recent PO line rate for this supplier
      const nCostResult = await pool.query(`
        SELECT DISTINCT ON (pli.stock_item_id)
          pli.stock_item_id,
          pli.rate::numeric AS rate
        FROM po_line_items pli
        JOIN purchase_orders po ON po.id = pli.po_id
        WHERE po.company_id = $1
          AND po.supplier_id = $2
          AND pli.stock_item_id = ANY($3::int[])
        ORDER BY pli.stock_item_id, po.created_at DESC
      `, [companyId, supplierId, stockItemIds]);
      const nCostMap = new Map<number, number>();
      for (const row of nCostResult.rows) {
        nCostMap.set(Number(row.stock_item_id), Number(row.rate));
      }

      // 4. Current stock + weighted average inventory cost
      const stockResult = await pool.query(`
        SELECT i.stock_item_id,
          SUM(i.quantity::numeric) AS current_stock,
          SUM(i.quantity::numeric * i.average_rate::numeric) / NULLIF(SUM(i.quantity::numeric), 0) AS avg_cost
        FROM inventory i
        WHERE i.company_id = $1
          AND i.stock_item_id = ANY($2::int[])
        GROUP BY i.stock_item_id
      `, [companyId, stockItemIds]);
      const stockMap = new Map<number, { currentStock: number; avgCost: number }>();
      for (const row of stockResult.rows) {
        stockMap.set(Number(row.stock_item_id), {
          currentStock: Number(row.current_stock),
          avgCost: row.avg_cost != null ? Number(row.avg_cost) : 0,
        });
      }

      // Build response
      const rows = items.map((item: any) => {
        const id = Number(item.id);
        const salesData = avgSellMap.get(id);
        const avgSellingPrice = salesData?.avgSellingPrice ?? null;
        const configPrice = salesData?.avgConfigPrice ?? 0;
        const salesQty = salesData?.salesQty ?? 0;

        const nCost = nCostMap.get(id) ?? 0;
        const nCostSource = nCostMap.has(id) ? "po" : "missing";

        const inventoryData = stockMap.get(id);
        const currentStock = inventoryData?.currentStock ?? 0;
        const offloadingCost = inventoryData?.avgCost ?? 0;

        const totalCost = nCost + configPrice + offloadingCost;

        let estimatedProfit: number | null = null;
        let profitPercent: number | null = null;
        let status: string;

        if (avgSellingPrice == null) {
          status = "no_sales_data";
        } else {
          estimatedProfit = avgSellingPrice - totalCost;
          profitPercent = avgSellingPrice > 0 ? (estimatedProfit / avgSellingPrice) * 100 : null;
          if (estimatedProfit > 0) status = "gaining";
          else if (estimatedProfit < 0) status = "losing";
          else status = "break_even";
        }

        return {
          stockItemId: id,
          code: item.code,
          name: item.name,
          stockGroupId: item.stock_group_id,
          stockGroupName: item.stock_group_name,
          currentStock,
          salesQty,
          avgSellingPrice,
          nCost,
          nCostSource,
          configPrice,
          offloadingCost,
          totalCost,
          estimatedProfit,
          profitPercent,
          status,
          proformaQty: item.proforma_qty != null ? Number(item.proforma_qty) : null,
          proformaBarcode: item.proforma_barcode,
        };
      });

      res.json(rows);
    } catch (err: any) {
      console.error("[supplier-profit-check/analyze]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/supplier-profit-check/save-proforma", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { supplierId, reference, notes, items } = req.body;
      if (!supplierId || !Array.isArray(items) || items.length === 0)
        return res.status(400).json({ message: "supplierId and items required" });

      const proformaRef = reference || `PC-${new Date().toISOString().slice(0, 10)}-${Date.now().toString().slice(-4)}`;

      const proformaResult = await pool.query(`
        INSERT INTO supplier_proformas (company_id, supplier_id, reference, notes, created_at, updated_at)
        VALUES ($1, $2, $3, $4, now(), now())
        RETURNING id, reference
      `, [companyId, supplierId, proformaRef, notes || null]);

      const proforma = proformaResult.rows[0];

      if (items.length > 0) {
        const lineValues: any[] = [];
        const linePlaceholders: string[] = [];
        let pIdx = 1;
        for (const item of items) {
          lineValues.push(
            proforma.id,
            item.barcode || item.code || "",
            item.itemName || item.name || "",
            Math.round(Number(item.qty) || 0),
            String(item.weight || "0"),
            String(Number(item.supplierPrice || 0).toFixed(2))
          );
          linePlaceholders.push(`($${pIdx},$${pIdx+1},$${pIdx+2},$${pIdx+3},$${pIdx+4},$${pIdx+5})`);
          pIdx += 6;
        }
        await pool.query(`
          INSERT INTO supplier_proforma_lines (proforma_id, barcode, item_name, qty, weight_per_bale, price_per_bale)
          VALUES ${linePlaceholders.join(",")}
        `, lineValues);
      }

      res.json({ id: proforma.id, reference: proforma.reference });
    } catch (err: any) {
      console.error("[supplier-profit-check/save-proforma]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/supplier-profit-check/proforma/:proformaId/export-supplier", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const proformaId = parseInt(req.params.proformaId);
      if (isNaN(proformaId)) return res.status(400).json({ message: "Invalid proformaId" });

      const proformaResult = await pool.query(`
        SELECT sp.*, s.legal_name as supplier_name
        FROM supplier_proformas sp
        JOIN suppliers s ON s.id = sp.supplier_id
        WHERE sp.id = $1 AND sp.company_id = $2
      `, [proformaId, companyId]);
      if (!proformaResult.rows.length) return res.status(404).json({ message: "Proforma not found" });
      const proforma = proformaResult.rows[0];

      const linesResult = await pool.query(`
        SELECT barcode, item_name, qty, weight_per_bale, price_per_bale,
          (qty * price_per_bale::numeric) as total_price
        FROM supplier_proforma_lines
        WHERE proforma_id = $1
        ORDER BY barcode
      `, [proformaId]);
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
      headerRow.eachCell(c => {
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

        const row = ws.addRow([
          line.barcode,
          line.item_name,
          qty,
          unitPrice,
          total,
        ]);
        if (i % 2 === 0) {
          row.eachCell(c => {
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
      totRow.eachCell(c => {
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
      const buffer = await wb.xlsx.writeBuffer();
      res.send(buffer);
    } catch (err: any) {
      console.error("[export-supplier]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/supplier-profit-check/export-internal", requireAuth, async (req: any, res: any) => {
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
        { key: "dubai_cost", width: 14 },
        { key: "config_cost", width: 14 },
        { key: "offload_cost", width: 14 },
        { key: "offload_src", width: 14 },
        { key: "profit_config", width: 15 },
        { key: "profit_config_pct", width: 12 },
        { key: "profit_offload", width: 15 },
        { key: "profit_offload_pct", width: 12 },
        { key: "status", width: 12 },
        { key: "qty", width: 10 },
        { key: "total_supplier_cost", width: 18 },
        { key: "est_total_sales", width: 18 },
        { key: "est_profit_config", width: 18 },
        { key: "est_profit_offload", width: 18 },
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
        "Item Code", "Item Name", "Current Stock",
        "Avg Sell Price", "N Cost", "Config Price", "Avg Inv Cost",
        "Cost Source",
        "Profit (Config)", "Config %",
        "Profit (Offload)", "Offload %",
        "Status", "Qty to Order", "Total N Cost", "Est. Total Sales",
        "Est. Profit (Config)", "Est. Profit (Offload)",
      ];
      const hRow = ws.addRow(headers);
      hRow.eachCell(c => {
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
        const nCost = Number(r.nCost) || 0;
        const config = Number(r.configPrice) || 0;
        const offload = Number(r.offloadingCost) || 0;

        // Profit (Config) = Sell − N Cost − Config Price
        const profitByConfig = sell != null ? sell - nCost - config : null;
        const profitByConfigPct = (sell != null && sell > 0 && profitByConfig != null) ? (profitByConfig / sell) * 100 : null;

        // Profit (Offload) = Sell − N Cost − Avg Inventory Cost
        const profitByOffload = sell != null ? sell - nCost - offload : null;
        const profitByOffloadPct = (sell != null && sell > 0 && profitByOffload != null) ? (profitByOffload / sell) * 100 : null;

        const qty = Number(r.qty) || 0;
        const totalSupCost = qty * nCost;
        const estTotalSales = sell != null ? qty * sell : 0;
        const estProfitConfig = profitByConfig != null ? qty * profitByConfig : 0;
        const estProfitOffload = profitByOffload != null ? qty * profitByOffload : 0;

        const statusByConfig = profitByConfig == null ? "no_sales_data" : profitByConfig > 0 ? "gaining" : profitByConfig < 0 ? "losing" : "break_even";

        const dataRow = ws.addRow([
          r.code, r.name, Number(r.currentStock) || 0,
          sell ?? "",
          dubai,
          config,
          offload,
          r.nCostSource || "missing",
          profitByConfig ?? "",
          profitByConfigPct ?? "",
          profitByOffload ?? "",
          profitByOffloadPct ?? "",
          statusByConfig,
          qty,
          totalSupCost,
          estTotalSales,
          estProfitConfig,
          estProfitOffload,
        ]);

        // Row background by config status
        let rowColor: string | null = null;
        if (statusByConfig === "losing") rowColor = LIGHT_RED;
        else if (statusByConfig === "gaining") rowColor = LIGHT_GREEN;
        else if (statusByConfig === "no_sales_data") rowColor = LIGHT_YELLOW;
        if (rowColor) {
          dataRow.eachCell(c => {
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowColor! } };
          });
        }

        // Status cell font color (col 13)
        const statusCell = dataRow.getCell(13);
        if (statusByConfig === "gaining") statusCell.font = { bold: true, color: { argb: GREEN } };
        else if (statusByConfig === "losing") statusCell.font = { bold: true, color: { argb: RED } };
        else if (statusByConfig === "no_sales_data") statusCell.font = { bold: true, color: { argb: YELLOW } };

        // Number formats: cols 3=stock, 4=sell, 5=dubai, 6=config, 7=offload, 9=profitCfg, 11=profitOff, 15=supCost, 16=estSales, 17=estCfg, 18=estOff
        [4, 5, 6, 7, 9, 11, 15, 16, 17, 18].forEach(col => {
          dataRow.getCell(col).numFmt = numFmt2;
        });
        dataRow.getCell(3).numFmt = numFmt2;
        dataRow.getCell(10).numFmt = numFmtPct; // Config %
        dataRow.getCell(12).numFmt = numFmtPct; // Offload %
        dataRow.getCell(14).numFmt = numFmt0;   // Qty
      }

      // Summary totals
      const hasQty = rows.filter((r: any) => Number(r.qty) > 0);
      const totalQtyOrdered = hasQty.reduce((s: number, r: any) => s + (Number(r.qty) || 0), 0);
      const totalSupCost = hasQty.reduce((s: number, r: any) => s + (Number(r.qty) || 0) * (Number(r.nCost) || 0), 0);
      const totalEstSales = hasQty.reduce((s: number, r: any) => {
        return r.avgSellingPrice != null ? s + (Number(r.qty) || 0) * Number(r.avgSellingPrice) : s;
      }, 0);
      const totalEstCfgProfit = hasQty.reduce((s: number, r: any) => {
        const sell = r.avgSellingPrice != null ? Number(r.avgSellingPrice) : null;
        const p = sell != null ? sell - (Number(r.nCost) || 0) - (Number(r.configPrice) || 0) : null;
        return p != null ? s + (Number(r.qty) || 0) * p : s;
      }, 0);
      const totalEstOffProfit = hasQty.reduce((s: number, r: any) => {
        const sell = r.avgSellingPrice != null ? Number(r.avgSellingPrice) : null;
        const p = sell != null ? sell - (Number(r.nCost) || 0) - (Number(r.offloadingCost) || 0) : null;
        return p != null ? s + (Number(r.qty) || 0) * p : s;
      }, 0);

      ws.addRow([]);
      const sumRow = ws.addRow([
        "TOTALS", "", "", "", "", "", "", "",
        "", "", "", "",
        `${hasQty.length} items`, totalQtyOrdered,
        totalSupCost, totalEstSales, totalEstCfgProfit, totalEstOffProfit,
      ]);
      sumRow.eachCell(c => {
        c.font = { bold: true, color: { argb: WHITE } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        c.border = { top: { style: "double", color: { argb: GOLD } } };
      });
      sumRow.getCell(14).numFmt = numFmt0;   // qty
      sumRow.getCell(15).numFmt = numFmt2;   // supplier cost
      sumRow.getCell(16).numFmt = numFmt2;   // est sales
      sumRow.getCell(17).numFmt = numFmt2;   // est profit config
      sumRow.getCell(18).numFmt = numFmt2;   // est profit offload

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="profit-analysis-${proformaRef || "export"}.xlsx"`);
      const buffer = await wb.xlsx.writeBuffer();
      res.send(buffer);
    } catch (err: any) {
      console.error("[export-internal]", err.message);
      res.status(500).json({ message: err.message });
    }
  });
}
