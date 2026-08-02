/**
 * supplierProfitCheckRoutes: SupplierProfitAddStockItem endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { pool } from "../../db";

export function registerSupplierProfitAddStockItemRoutes(app: Express, requireAuth: any) {
  app.post("/api/supplier-profit-check/add-stock-item", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { code, name, stockGroupId, supplierId, dubaiPrice, avgSellPrice } = req.body;
      if (!code?.trim() || !name?.trim()) return res.status(400).json({ message: "Code and name are required" });

      // Duplicate check
      const existing = await pool.query(
        `SELECT id FROM stock_items WHERE company_id = $1 AND lower(code) = lower($2) AND deleted_at IS NULL`,
        [companyId, code.trim()]
      );
      if (existing.rows.length > 0)
        return res.status(409).json({ message: `Item with code "${code.trim()}" already exists` });

      // Insert the stock item (default uom = Bale, as used throughout this ERP)
      const result = await pool.query(
        `
        INSERT INTO stock_items (company_id, code, name, stock_group_id, uom, active, created_at)
        VALUES ($1, $2, $3, $4, 'Bale', true, now())
        RETURNING id, code, name, stock_group_id
      `,
        [companyId, code.trim().toUpperCase(), name.trim(), stockGroupId || null]
      );

      const item = result.rows[0];

      // Persist Dubai / avg sell price overrides if provided
      const hasDubai = dubaiPrice && Number(dubaiPrice) > 0;
      const hasAvg = avgSellPrice && Number(avgSellPrice) > 0;
      if ((hasDubai || hasAvg) && supplierId) {
        await pool.query(
          `INSERT INTO supplier_profit_po_overrides (supplier_id, stock_item_id, po_price, avg_price, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (supplier_id, stock_item_id) DO UPDATE SET
             po_price  = COALESCE(EXCLUDED.po_price,  supplier_profit_po_overrides.po_price),
             avg_price = COALESCE(EXCLUDED.avg_price, supplier_profit_po_overrides.avg_price),
             updated_at = now()`,
          [supplierId, item.id, hasDubai ? Number(dubaiPrice) : null, hasAvg ? Number(avgSellPrice) : null]
        );
      }

      res.json({ id: item.id, code: item.code, name: item.name, stockGroupId: item.stock_group_id });
    } catch (err: unknown) {
      logger.error("[supplier-profit-check/add-stock-item]", { error: getErrorMessage(err) });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });
}
