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

      // 2. Average selling price per item in date range
      const avgSellResult = await pool.query(`
        SELECT si.stock_item_id,
          SUM(si.total_sales::numeric) / NULLIF(SUM(si.quantity::numeric), 0) AS avg_selling_price,
          AVG(si.configured_price::numeric) FILTER (WHERE si.configured_price IS NOT NULL AND si.configured_price::numeric > 0) AS avg_config_price
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
      const avgSellMap = new Map<number, { avgSellingPrice: number | null; avgConfigPrice: number }>();
      for (const row of avgSellResult.rows) {
        avgSellMap.set(Number(row.stock_item_id), {
          avgSellingPrice: row.avg_selling_price != null ? Number(row.avg_selling_price) : null,
          avgConfigPrice: row.avg_config_price != null ? Number(row.avg_config_price) : 0,
        });
      }

      // 3. Dubai Cost: prefer most recent proforma line for this supplier, then PO line
      const proformaRateResult = await pool.query(`
        SELECT DISTINCT ON (si.id)
          si.id AS stock_item_id,
          spl.price_per_bale::numeric AS rate,
          'proforma' AS source
        FROM stock_items si
        JOIN supplier_proforma_lines spl ON lower(spl.barcode) = lower(si.code)
        JOIN supplier_proformas sp ON sp.id = spl.proforma_id
        WHERE sp.supplier_id = $1
          AND sp.company_id = $2
          AND si.id = ANY($3::int[])
        ORDER BY si.id, sp.created_at DESC
      `, [supplierId, companyId, stockItemIds]);
      const proformaRateMap = new Map<number, { rate: number; source: string }>();
      for (const row of proformaRateResult.rows) {
        proformaRateMap.set(Number(row.stock_item_id), { rate: Number(row.rate), source: row.source });
      }

      const poRateResult = await pool.query(`
        SELECT DISTINCT ON (pli.stock_item_id)
          pli.stock_item_id,
          pli.rate::numeric AS rate,
          'po' AS source
        FROM po_line_items pli
        JOIN purchase_orders po ON po.id = pli.po_id
        WHERE po.company_id = $1
          AND po.supplier_id = $2
          AND pli.stock_item_id = ANY($3::int[])
        ORDER BY pli.stock_item_id, po.created_at DESC
      `, [companyId, supplierId, stockItemIds]);
      const poRateMap = new Map<number, { rate: number; source: string }>();
      for (const row of poRateResult.rows) {
        poRateMap.set(Number(row.stock_item_id), { rate: Number(row.rate), source: row.source });
      }

      // 4. Offloading Cost: most recent container offload for item from this supplier's containers
      const offloadResult = await pool.query(`
        SELECT DISTINCT ON (coi.stock_item_id)
          coi.stock_item_id,
          co.additional_cost_per_bale::numeric AS offloading_cost,
          'last_container' AS source
        FROM container_offload_items coi
        JOIN container_offloads co ON co.id = coi.offload_id
        JOIN containers c ON c.id = co.container_id
        WHERE c.supplier_id = $1
          AND c.company_id = $2
          AND coi.stock_item_id = ANY($3::int[])
        ORDER BY coi.stock_item_id, co.offloaded_at DESC
      `, [supplierId, companyId, stockItemIds]);
      const offloadMap = new Map<number, { offloadingCost: number; source: string }>();
      for (const row of offloadResult.rows) {
        offloadMap.set(Number(row.stock_item_id), {
          offloadingCost: Number(row.offloading_cost),
          source: row.source,
        });
      }

      // 5. Current stock sum across all company locations
      const stockResult = await pool.query(`
        SELECT i.stock_item_id, SUM(i.quantity::numeric) AS current_stock
        FROM inventory i
        WHERE i.company_id = $1
          AND i.stock_item_id = ANY($2::int[])
        GROUP BY i.stock_item_id
      `, [companyId, stockItemIds]);
      const stockMap = new Map<number, number>();
      for (const row of stockResult.rows) {
        stockMap.set(Number(row.stock_item_id), Number(row.current_stock));
      }

      // Build response
      const rows = items.map((item: any) => {
        const id = Number(item.id);
        const salesData = avgSellMap.get(id);
        const avgSellingPrice = salesData?.avgSellingPrice ?? null;
        const configPrice = salesData?.avgConfigPrice ?? 0;

        const dubaiData = proformaRateMap.get(id) ?? poRateMap.get(id);
        const dubaiCost = dubaiData?.rate ?? 0;
        const dubaiCostSource = dubaiData?.source ?? "missing";

        const offloadData = offloadMap.get(id);
        const offloadingCost = offloadData?.offloadingCost ?? 0;
        const offloadingSource = offloadData?.source ?? "missing";

        const currentStock = stockMap.get(id) ?? 0;
        const totalCost = dubaiCost + configPrice + offloadingCost;

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
          avgSellingPrice,
          dubaiCost,
          dubaiCostSource,
          configPrice,
          offloadingCost,
          offloadingSource,
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
        { key: "group", width: 16 },
        { key: "stock", width: 12 },
        { key: "avg_sell", width: 14 },
        { key: "dubai_cost", width: 14 },
        { key: "config_cost", width: 14 },
        { key: "offload_cost", width: 14 },
        { key: "offload_src", width: 14 },
        { key: "total_cost", width: 14 },
        { key: "profit", width: 14 },
        { key: "profit_pct", width: 12 },
        { key: "status", width: 12 },
        { key: "qty", width: 10 },
        { key: "total_supplier_cost", width: 18 },
        { key: "est_total_sales", width: 18 },
        { key: "est_total_profit", width: 18 },
      ];

      // Title
      ws.mergeCells("A1:Q1");
      const t = ws.getCell("A1");
      t.value = `INTERNAL PROFIT ANALYSIS — ${supplierName || ""}`;
      t.font = { bold: true, size: 14, color: { argb: WHITE } };
      t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      t.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(1).height = 28;

      ws.mergeCells("A2:Q2");
      const sub = ws.getCell("A2");
      sub.value = `Date Range: ${fromDate} → ${toDate}   |   Proforma Ref: ${proformaRef || "N/A"}`;
      sub.font = { bold: false, size: 10, color: { argb: NAVY } };
      sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F7EFD8" } };
      sub.alignment = { horizontal: "center" };
      ws.getRow(2).height = 18;

      const headers = [
        "Item Code", "Item Name", "Stock Group", "Current Stock",
        "Avg Sell Price", "Dubai Cost", "Config Cost", "Offload Cost",
        "Offload Source", "Total Cost", "Est. Profit", "Profit %",
        "Status", "Qty to Order", "Total Supplier Cost", "Est. Total Sales", "Est. Total Profit",
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
        const qty = Number(r.qty) || 0;
        const totalSupCost = qty * Number(r.dubaiCost || 0);
        const estTotalSales = qty * Number(r.avgSellingPrice || 0);
        const estTotalProfit = qty * Number(r.estimatedProfit || 0);

        const dataRow = ws.addRow([
          r.code, r.name, r.stockGroupName || "", Number(r.currentStock) || 0,
          r.avgSellingPrice != null ? Number(r.avgSellingPrice) : "",
          Number(r.dubaiCost) || 0,
          Number(r.configPrice) || 0,
          Number(r.offloadingCost) || 0,
          r.offloadingSource || "missing",
          Number(r.totalCost) || 0,
          r.estimatedProfit != null ? Number(r.estimatedProfit) : "",
          r.profitPercent != null ? Number(r.profitPercent) : "",
          r.status || "",
          qty,
          totalSupCost,
          estTotalSales,
          estTotalProfit,
        ]);

        // Color code by status
        let rowColor: string | null = null;
        if (r.status === "losing") rowColor = LIGHT_RED;
        else if (r.status === "gaining") rowColor = LIGHT_GREEN;
        else if (r.status === "no_sales_data") rowColor = LIGHT_YELLOW;

        if (rowColor) {
          dataRow.eachCell(c => {
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowColor! } };
          });
        }

        // Status cell color
        const statusCell = dataRow.getCell(13);
        if (r.status === "gaining") {
          statusCell.font = { bold: true, color: { argb: GREEN } };
        } else if (r.status === "losing") {
          statusCell.font = { bold: true, color: { argb: RED } };
        } else if (r.status === "no_sales_data") {
          statusCell.font = { bold: true, color: { argb: YELLOW } };
        }

        // Number formats
        [5,6,7,8,10,11,15,16,17].forEach(col => {
          dataRow.getCell(col).numFmt = numFmt2;
        });
        dataRow.getCell(4).numFmt = numFmt2;
        dataRow.getCell(12).numFmt = numFmtPct;
        dataRow.getCell(14).numFmt = numFmt0;
      }

      // Summary totals
      const hasQty = rows.filter((r: any) => Number(r.qty) > 0);
      const totalQtyOrdered = hasQty.reduce((s: number, r: any) => s + (Number(r.qty) || 0), 0);
      const totalSupCost = hasQty.reduce((s: number, r: any) => s + (Number(r.qty) || 0) * (Number(r.dubaiCost) || 0), 0);
      const totalEstSales = hasQty.reduce((s: number, r: any) => {
        return r.avgSellingPrice != null ? s + (Number(r.qty) || 0) * Number(r.avgSellingPrice) : s;
      }, 0);
      const totalEstProfit = hasQty.reduce((s: number, r: any) => {
        return r.estimatedProfit != null ? s + (Number(r.qty) || 0) * Number(r.estimatedProfit) : s;
      }, 0);

      ws.addRow([]);
      const sumRow = ws.addRow([
        "TOTALS", "", "", "", "", "", "", "", "", "",
        "", "", `${hasQty.length} items`, totalQtyOrdered,
        totalSupCost, totalEstSales, totalEstProfit,
      ]);
      sumRow.eachCell(c => {
        c.font = { bold: true, color: { argb: WHITE } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        c.border = { top: { style: "double", color: { argb: GOLD } } };
      });
      sumRow.getCell(14).numFmt = numFmt0;
      sumRow.getCell(15).numFmt = numFmt2;
      sumRow.getCell(16).numFmt = numFmt2;
      sumRow.getCell(17).numFmt = numFmt2;

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
