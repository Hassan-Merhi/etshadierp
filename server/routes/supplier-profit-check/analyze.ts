/**
 * supplierProfitCheckRoutes: SupplierProfitAnalyze endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { pool } from "../../db";

export function registerSupplierProfitAnalyzeRoutes(app: Express, requireAuth: unknown) {
  app.post("/api/supplier-profit-check/analyze", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { supplierId, fromDate, toDate, sourceType, proformaId, containerIds, sellPriceSource, locationId } =
        req.body;
      if (!supplierId) return res.status(400).json({ message: "supplierId required" });
      const allTime = !fromDate || !toDate;

      // 1. Get stock items (all for company OR from proforma lines OR from OTW containers)
      let itemsResult;
      if (sourceType === "proforma" && proformaId) {
        itemsResult = await pool.query(
          `
          SELECT si.id, si.code, si.name, si.stock_group_id,
            sg.name as stock_group_name,
            spl.qty as proforma_qty,
            spl.price_per_bale as proforma_price,
            spl.barcode as proforma_barcode
          FROM supplier_proforma_lines spl
          JOIN supplier_proformas sp ON sp.id = spl.proforma_id
          JOIN stock_items si ON (
            lower(si.code) = lower(spl.barcode)
            OR EXISTS (
              SELECT 1 FROM stock_item_code_aliases sica
              WHERE sica.stock_item_id = si.id
                AND lower(sica.alias_code) = lower(spl.barcode)
                AND sica.company_id = $2
            )
          )
          LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
          WHERE sp.id = $1
            AND sp.company_id = $2
            AND si.company_id = $2
            AND si.deleted_at IS NULL
          ORDER BY si.code
        `,
          [proformaId, companyId]
        );
      } else if (sourceType === "otw_containers" && Array.isArray(containerIds) && containerIds.length > 0) {
        itemsResult = await pool.query(
          `
          SELECT DISTINCT ON (si.id)
            si.id, si.code, si.name, si.stock_group_id,
            sg.name as stock_group_name,
            scli.qty as proforma_qty,
            scli.price_per_bale as proforma_price,
            si.code as proforma_barcode
          FROM supplier_container_loaded_items scli
          JOIN stock_items si ON (
            lower(si.code) = lower(scli.barcode)
            OR EXISTS (
              SELECT 1 FROM stock_item_code_aliases sica
              WHERE sica.stock_item_id = si.id
                AND lower(sica.alias_code) = lower(scli.barcode)
                AND sica.company_id = si.company_id
            )
          )
            AND si.deleted_at IS NULL
          LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
          WHERE scli.container_id = ANY($1::int[])
          ORDER BY si.id, si.code
        `,
          [containerIds]
        );
      } else {
        // Look up the supplier's linked stock group (if any)
        const supplierRow = await pool.query(`SELECT stock_group_id FROM suppliers WHERE id = $1`, [supplierId]);
        const linkedStockGroupId = supplierRow.rows[0]?.stock_group_id ?? null;

        if (linkedStockGroupId) {
          itemsResult = await pool.query(
            `
            SELECT si.id, si.code, si.name, si.stock_group_id,
              sg.name as stock_group_name,
              NULL::integer as proforma_qty,
              NULL::numeric as proforma_price,
              si.code as proforma_barcode
            FROM stock_items si
            LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
            WHERE si.company_id = $1
              AND si.deleted_at IS NULL
              AND si.stock_group_id = $2
            ORDER BY si.code
          `,
            [companyId, linkedStockGroupId]
          );
        } else {
          itemsResult = await pool.query(
            `
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
          `,
            [companyId]
          );
        }
      }
      const items = itemsResult.rows;
      if (items.length === 0) return res.json([]);

      const stockItemIds = items.map((r) => r.id);
      const _idsParam = stockItemIds.map((_, i: number) => `$${i + 1}`).join(",");

      // 2. Average selling price + total sales qty per item in date range
      const avgSellResult = allTime
        ? await pool.query(
            `
            SELECT si.stock_item_id,
              SUM(si.total_sales::numeric) / NULLIF(SUM(si.quantity::numeric), 0) AS avg_selling_price,
              AVG(si.configured_price::numeric) FILTER (WHERE si.configured_price IS NOT NULL AND si.configured_price::numeric > 0) AS avg_config_price,
              SUM(si.quantity::numeric) AS total_qty
            FROM sales_items si
            JOIN vouchers v ON v.id = si.voucher_id
            WHERE v.company_id = $1
              AND v.voucher_type = 'Sales'
              AND v.deleted_at IS NULL
              AND si.stock_item_id = ANY($2::int[])
            GROUP BY si.stock_item_id
          `,
            [companyId, stockItemIds]
          )
        : await pool.query(
            `
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
          `,
            [companyId, fromDate, toDate, stockItemIds]
          );
      const avgSellMap = new Map<
        number,
        { avgSellingPrice: number | null; avgConfigPrice: number; salesQty: number }
      >();
      for (const row of avgSellResult.rows) {
        avgSellMap.set(Number(row.stock_item_id), {
          avgSellingPrice: row.avg_selling_price != null ? Number(row.avg_selling_price) : null,
          avgConfigPrice: row.avg_config_price != null ? Number(row.avg_config_price) : 0,
          salesQty: row.total_qty != null ? Number(row.total_qty) : 0,
        });
      }

      // 3. N Cost (most recent PO line for this supplier — kept for proforma save only, not shown in UI)
      const nCostResult = await pool.query(
        `
        SELECT DISTINCT ON (pli.stock_item_id)
          pli.stock_item_id,
          pli.rate::numeric AS rate
        FROM po_line_items pli
        JOIN purchase_orders po ON po.id = pli.po_id
        WHERE po.company_id = $1
          AND po.supplier_id = $2
          AND pli.stock_item_id = ANY($3::int[])
        ORDER BY pli.stock_item_id, po.created_at DESC
      `,
        [companyId, supplierId, stockItemIds]
      );
      const nCostMap = new Map<number, number>();
      for (const row of nCostResult.rows) {
        nCostMap.set(Number(row.stock_item_id), Number(row.rate));
      }

      // 3b. Hassan's Price — base selling_price on the stock item; fall back to max location-specific price
      const hassansPriceResult = await pool.query(
        `
        SELECT si.id AS stock_item_id,
          COALESCE(
            NULLIF(si.selling_price::numeric, 0),
            (SELECT MAX(silp.selling_price::numeric)
             FROM stock_item_location_prices silp
             WHERE silp.stock_item_id = si.id)
          ) AS hassans_price
        FROM stock_items si
        WHERE si.company_id = $1
          AND si.id = ANY($2::int[])
      `,
        [companyId, stockItemIds]
      );
      const hassansPriceMap = new Map<number, number>();
      for (const row of hassansPriceResult.rows) {
        hassansPriceMap.set(Number(row.stock_item_id), Number(row.hassans_price) || 0);
      }

      // 4. Current stock + weighted average inventory cost (primary avg cost source)
      const stockResult = await pool.query(
        `
        SELECT i.stock_item_id,
          SUM(i.quantity::numeric) AS current_stock,
          SUM(i.quantity::numeric * i.average_rate::numeric) / NULLIF(SUM(i.quantity::numeric), 0) AS avg_cost,
          MAX(i.average_rate::numeric) AS max_avg_rate
        FROM inventory i
        WHERE i.company_id = $1
          AND i.stock_item_id = ANY($2::int[])
        GROUP BY i.stock_item_id
      `,
        [companyId, stockItemIds]
      );
      const stockMap = new Map<number, { currentStock: number; avgCost: number }>();
      for (const row of stockResult.rows) {
        stockMap.set(Number(row.stock_item_id), {
          currentStock: Number(row.current_stock),
          // use weighted avg_cost; if qty is 0 but rows exist, fall back to max avg_rate so we keep last known cost
          avgCost:
            row.avg_cost != null ? Number(row.avg_cost) : row.max_avg_rate != null ? Number(row.max_avg_rate) : 0,
        });
      }

      // 4b. Fallback avg cost: most recent PO line rate from ANY PO in this company (when no inventory record)
      const avgCostFallbackResult = await pool.query(
        `
        SELECT DISTINCT ON (pli.stock_item_id)
          pli.stock_item_id,
          pli.rate::numeric AS rate
        FROM po_line_items pli
        JOIN purchase_orders po ON po.id = pli.po_id
        WHERE po.company_id = $1
          AND pli.stock_item_id = ANY($2::int[])
        ORDER BY pli.stock_item_id, po.created_at DESC
      `,
        [companyId, stockItemIds]
      );
      const avgCostFallbackMap = new Map<number, number>();
      for (const row of avgCostFallbackResult.rows) {
        avgCostFallbackMap.set(Number(row.stock_item_id), Number(row.rate));
      }

      // 4c. Location group price (when sellPriceSource === 'location_group')
      const groupPriceMap = new Map<number, number>();
      if (sellPriceSource === "location_group" && locationId) {
        const groupPriceResult = await pool.query(
          `
          SELECT stock_item_id, selling_price::numeric AS selling_price
          FROM stock_item_location_prices
          WHERE location_id = $1
            AND stock_item_id = ANY($2::int[])
        `,
          [locationId, stockItemIds]
        );
        for (const row of groupPriceResult.rows) {
          if (row.selling_price != null && Number(row.selling_price) > 0) {
            groupPriceMap.set(Number(row.stock_item_id), Number(row.selling_price));
          }
        }
      }

      // Build response
      const rows = items.map((item) => {
        const id = Number(item.id);
        const salesData = avgSellMap.get(id);
        const avgSellingPrice = salesData?.avgSellingPrice ?? null;
        const salesQty = salesData?.salesQty ?? 0;

        // N Cost kept for proforma save (not shown in UI)
        const nCost = nCostMap.get(id) ?? 0;
        const _nCostSource = nCostMap.has(id) ? "po" : "missing";

        // Hassan's Price = selling price set on the stock item
        const configPrice = hassansPriceMap.get(id) ?? 0;

        // Avg Cost = weighted avg inventory rate; fallback to latest PO line rate if no inventory
        const inventoryData = stockMap.get(id);
        const currentStock = inventoryData?.currentStock ?? 0;
        const invAvgCost = inventoryData?.avgCost ?? 0;
        const offloadingCost = invAvgCost > 0 ? invAvgCost : (avgCostFallbackMap.get(id) ?? 0);
        const avgCostSource = invAvgCost > 0 ? "inventory" : avgCostFallbackMap.has(id) ? "po_fallback" : "missing";

        // Hassan's Profit = Hassan's Price − Avg Cost
        const hassansProfit = configPrice - offloadingCost;
        // Cost Profit = Avg Sell − Avg Cost
        const costProfit = avgSellingPrice != null ? avgSellingPrice - offloadingCost : null;

        const totalCost = configPrice + offloadingCost;

        const estimatedProfit: number | null = costProfit;
        let profitPercent: number | null = null;
        let status: string;

        if (avgSellingPrice == null) {
          status = "no_sales_data";
        } else {
          profitPercent = avgSellingPrice > 0 && costProfit != null ? (costProfit / avgSellingPrice) * 100 : null;
          if (hassansProfit > 0) status = "gaining";
          else if (hassansProfit < 0) status = "losing";
          else status = "break_even";
        }

        // Group sell price (only populated when sellPriceSource === 'location_group')
        const groupSellingPrice = groupPriceMap.has(id) ? groupPriceMap.get(id)! : null;

        return {
          stockItemId: id,
          code: item.code,
          name: item.name,
          stockGroupId: item.stock_group_id,
          stockGroupName: item.stock_group_name,
          currentStock,
          salesQty,
          avgSellingPrice,
          groupSellingPrice,
          // Dubai / PO Price — selected supplier first, fall back to any PO for this company
          poPrice: nCostMap.has(id)
            ? nCostMap.get(id)!
            : avgCostFallbackMap.has(id)
              ? avgCostFallbackMap.get(id)!
              : null,
          poPriceSource: nCostMap.has(id)
            ? "selected_supplier_po"
            : avgCostFallbackMap.has(id)
              ? "any_po_fallback"
              : "missing",
          // Inventory avg cost (separate from Dubai price)
          inventoryAvgCost: offloadingCost,
          // Keep for proforma save compat
          nCost,
          nCostSource: avgCostSource,
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
    } catch (err: unknown) {
      logger.error("[supplier-profit-check/analyze]", { error: getErrorMessage(err) });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });
}
