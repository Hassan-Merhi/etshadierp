/**
 * supplierProfitCheckRoutes: SupplierProfitImport endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response, RequestHandler } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { pool } from "../../db";

export function registerSupplierProfitImportRoutes(app: Express, requireAuth: RequestHandler) {
  // ── Add a new stock item directly from Supplier Profit Check ────────────────
  // ── Import by codes (Excel upload) ─────────────────────────────────────────
  // Accepts a list of item codes (from Excel). Looks up stock_items by code for
  // this company and runs the same profit analysis as /analyze.
  app.post("/api/supplier-profit-check/import-by-codes", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { codes, supplierId, fromDate, toDate, sellPriceSource, locationId } = req.body;
      if (!Array.isArray(codes) || codes.length === 0)
        return res.status(400).json({ message: "codes array is required" });

      const lowerCodes = codes.map((c: string) => c.toLowerCase().trim()).filter(Boolean);
      if (lowerCodes.length === 0) return res.status(400).json({ message: "No valid codes provided" });

      // 1. Look up stock items by code (including alias codes)
      const itemsResult = await pool.query(
        `SELECT DISTINCT ON (si.id) si.id, si.code, si.name, si.stock_group_id,
            sg.name as stock_group_name,
            NULL::integer as proforma_qty,
            NULL::numeric as proforma_price,
            si.code as proforma_barcode
          FROM stock_items si
          LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
          WHERE si.company_id = $1
            AND si.deleted_at IS NULL
            AND (
              lower(si.code) = ANY($2::text[])
              OR EXISTS (
                SELECT 1 FROM stock_item_code_aliases sica
                WHERE sica.stock_item_id = si.id
                  AND lower(sica.alias_code) = ANY($2::text[])
                  AND sica.company_id = $1
              )
            )
          ORDER BY si.id, si.code`,
        [companyId, lowerCodes]
      );

      const items = itemsResult.rows;
      if (items.length === 0) return res.json({ rows: [], notFound: codes });

      // Build found set from direct codes plus any matched alias codes
      const foundDirectCodes = new Set(items.map((r) => r.code.toLowerCase()));
      const aliasMatchResult = await pool.query(
        `SELECT lower(sica.alias_code) as alias_code
         FROM stock_item_code_aliases sica
         JOIN stock_items si ON si.id = sica.stock_item_id
         WHERE sica.company_id = $1
           AND si.company_id = $1
           AND si.deleted_at IS NULL
           AND lower(sica.alias_code) = ANY($2::text[])`,
        [companyId, lowerCodes]
      );
      const foundAliasCodes = new Set(aliasMatchResult.rows.map((r) => r.alias_code));
      const foundCodes = new Set([...foundDirectCodes, ...foundAliasCodes]);
      const notFound = codes.filter((c: string) => !foundCodes.has(c.toLowerCase().trim()));

      const stockItemIds = items.map((r) => Number(r.id));
      const allTime = !fromDate || !toDate;

      // 2. Avg selling price + total sales qty
      const avgSellResult = allTime
        ? await pool.query(
            `SELECT si.stock_item_id,
                SUM(si.total_sales::numeric) / NULLIF(SUM(si.quantity::numeric), 0) AS avg_selling_price,
                AVG(si.configured_price::numeric) FILTER (WHERE si.configured_price IS NOT NULL AND si.configured_price::numeric > 0) AS avg_config_price,
                SUM(si.quantity::numeric) AS total_qty
              FROM sales_items si
              JOIN vouchers v ON v.id = si.voucher_id
              WHERE v.company_id = $1
                AND v.voucher_type = 'Sales'
                AND v.deleted_at IS NULL
                AND si.stock_item_id = ANY($2::int[])
              GROUP BY si.stock_item_id`,
            [companyId, stockItemIds]
          )
        : await pool.query(
            `SELECT si.stock_item_id,
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
              GROUP BY si.stock_item_id`,
            [companyId, fromDate, toDate, stockItemIds]
          );

      const avgSellMap = new Map<number, { avgSellingPrice: number | null; salesQty: number }>();
      for (const row of avgSellResult.rows) {
        avgSellMap.set(Number(row.stock_item_id), {
          avgSellingPrice: row.avg_selling_price != null ? Number(row.avg_selling_price) : null,
          salesQty: row.total_qty != null ? Number(row.total_qty) : 0,
        });
      }

      // 3. N Cost — from selected supplier PO first, then any PO in company
      const nCostResult = supplierId
        ? await pool.query(
            `SELECT DISTINCT ON (pli.stock_item_id)
                pli.stock_item_id, pli.rate::numeric AS rate
              FROM po_line_items pli
              JOIN purchase_orders po ON po.id = pli.po_id
              WHERE po.company_id = $1
                AND po.supplier_id = $2
                AND pli.stock_item_id = ANY($3::int[])
              ORDER BY pli.stock_item_id, po.created_at DESC`,
            [companyId, supplierId, stockItemIds]
          )
        : { rows: [] };
      const nCostMap = new Map<number, number>();
      for (const row of nCostResult.rows) nCostMap.set(Number(row.stock_item_id), Number(row.rate));

      // 4. Avg cost from inventory + PO fallback
      const stockResult = await pool.query(
        `SELECT i.stock_item_id,
            SUM(i.quantity::numeric) AS current_stock,
            SUM(i.quantity::numeric * i.average_rate::numeric) / NULLIF(SUM(i.quantity::numeric), 0) AS avg_cost,
            MAX(i.average_rate::numeric) AS max_avg_rate
          FROM inventory i
          WHERE i.company_id = $1
            AND i.stock_item_id = ANY($2::int[])
          GROUP BY i.stock_item_id`,
        [companyId, stockItemIds]
      );
      const stockMap = new Map<number, { currentStock: number; avgCost: number }>();
      for (const row of stockResult.rows) {
        stockMap.set(Number(row.stock_item_id), {
          currentStock: Number(row.current_stock),
          avgCost:
            row.avg_cost != null ? Number(row.avg_cost) : row.max_avg_rate != null ? Number(row.max_avg_rate) : 0,
        });
      }

      const avgCostFallbackResult = await pool.query(
        `SELECT DISTINCT ON (pli.stock_item_id)
            pli.stock_item_id, pli.rate::numeric AS rate
          FROM po_line_items pli
          JOIN purchase_orders po ON po.id = pli.po_id
          WHERE po.company_id = $1
            AND pli.stock_item_id = ANY($2::int[])
          ORDER BY pli.stock_item_id, po.created_at DESC`,
        [companyId, stockItemIds]
      );
      const avgCostFallbackMap = new Map<number, number>();
      for (const row of avgCostFallbackResult.rows) avgCostFallbackMap.set(Number(row.stock_item_id), Number(row.rate));

      // 5. Hassan's price
      const hassanResult = await pool.query(
        `SELECT si.id AS stock_item_id,
            COALESCE(
              NULLIF(si.selling_price::numeric, 0),
              (SELECT MAX(silp.selling_price::numeric) FROM stock_item_location_prices silp WHERE silp.stock_item_id = si.id)
            ) AS hassans_price
          FROM stock_items si
          WHERE si.company_id = $1 AND si.id = ANY($2::int[])`,
        [companyId, stockItemIds]
      );
      const hassanMap = new Map<number, number>();
      for (const row of hassanResult.rows) hassanMap.set(Number(row.stock_item_id), Number(row.hassans_price) || 0);

      // 6. Location group price
      const groupPriceMap = new Map<number, number>();
      if (sellPriceSource === "location_group" && locationId) {
        const gpResult = await pool.query(
          `SELECT stock_item_id, selling_price::numeric AS selling_price
            FROM stock_item_location_prices
            WHERE location_id = $1 AND stock_item_id = ANY($2::int[])`,
          [locationId, stockItemIds]
        );
        for (const row of gpResult.rows) {
          if (row.selling_price && Number(row.selling_price) > 0)
            groupPriceMap.set(Number(row.stock_item_id), Number(row.selling_price));
        }
      }

      // 7. PO overrides (saved Dubai / avg sell prices)
      const overridesResult = supplierId
        ? await pool.query(
            `SELECT stock_item_id, po_price::numeric AS po_price, avg_price::numeric AS avg_price
              FROM supplier_profit_po_overrides
              WHERE supplier_id = $1 AND stock_item_id = ANY($2::int[])`,
            [supplierId, stockItemIds]
          )
        : { rows: [] };
      const overridePoMap = new Map<number, number>();
      const overrideAvgMap = new Map<number, number>();
      for (const row of overridesResult.rows) {
        if (row.po_price != null) overridePoMap.set(Number(row.stock_item_id), Number(row.po_price));
        if (row.avg_price != null) overrideAvgMap.set(Number(row.stock_item_id), Number(row.avg_price));
      }

      // Build response rows (same shape as /analyze)
      const rows = items.map((item) => {
        const id = Number(item.id);
        const salesData = avgSellMap.get(id);
        const avgSellingPrice = overrideAvgMap.get(id) ?? salesData?.avgSellingPrice ?? null;
        const salesQty = salesData?.salesQty ?? 0;

        const nCost = nCostMap.get(id) ?? 0;
        const configPrice = hassanMap.get(id) ?? 0;
        const inventoryData = stockMap.get(id);
        const currentStock = inventoryData?.currentStock ?? 0;
        const invAvgCost = inventoryData?.avgCost ?? 0;
        const offloadingCost = invAvgCost > 0 ? invAvgCost : (avgCostFallbackMap.get(id) ?? 0);

        const poPrice = overridePoMap.has(id)
          ? overridePoMap.get(id)!
          : nCostMap.has(id)
            ? nCostMap.get(id)!
            : avgCostFallbackMap.has(id)
              ? avgCostFallbackMap.get(id)!
              : null;
        const poPriceSource = overridePoMap.has(id)
          ? "override"
          : nCostMap.has(id)
            ? "selected_supplier_po"
            : avgCostFallbackMap.has(id)
              ? "any_po_fallback"
              : "missing";

        const groupSellingPrice = groupPriceMap.has(id) ? groupPriceMap.get(id)! : null;
        const hassansProfit = configPrice - offloadingCost;
        const costProfit = avgSellingPrice != null ? avgSellingPrice - offloadingCost : null;
        const profitPercent =
          avgSellingPrice != null && avgSellingPrice > 0 && costProfit != null
            ? (costProfit / avgSellingPrice) * 100
            : null;
        const status =
          avgSellingPrice == null
            ? "no_sales_data"
            : hassansProfit > 0
              ? "gaining"
              : hassansProfit < 0
                ? "losing"
                : "break_even";

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
          poPrice,
          poPriceSource,
          inventoryAvgCost: offloadingCost,
          nCost,
          nCostSource: invAvgCost > 0 ? "inventory" : avgCostFallbackMap.has(id) ? "po_fallback" : "missing",
          configPrice,
          offloadingCost,
          totalCost: configPrice + offloadingCost,
          estimatedProfit: costProfit,
          profitPercent,
          status,
          proformaQty: null,
          proformaBarcode: item.code,
        };
      });

      res.json({ rows, notFound });
    } catch (err: unknown) {
      logger.error("[supplier-profit-check/import-by-codes]", { error: getErrorMessage(err) });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });
}
