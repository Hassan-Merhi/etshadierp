/**
 * supplierProfitCheckRoutes: SupplierProfitPoOverride endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { pool } from "../../db";

export function registerSupplierProfitPoOverrideRoutes(app: Express, requireAuth: unknown) {
  app.get("/api/supplier-profit-check/po-overrides", requireAuth, async (req: Request, res: Response) => {
    try {
      const supplierId = parseInt(req.query.supplierId as string);
      if (!supplierId) return res.status(400).json({ message: "supplierId required" });
      const result = await pool.query(
        `SELECT stock_item_id AS "stockItemId", po_price AS "poPrice", avg_price AS "avgPrice"
         FROM supplier_profit_po_overrides
         WHERE supplier_id = $1`,
        [supplierId]
      );
      res.json(result.rows);
    } catch (err: unknown) {
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });

  app.put("/api/supplier-profit-check/po-overrides", requireAuth, async (req: Request, res: Response) => {
    try {
      const { supplierId, stockItemId, poPrice, avgPrice } = req.body;
      if (!supplierId || !stockItemId) {
        return res.status(400).json({ message: "supplierId and stockItemId required" });
      }
      await pool.query(
        `INSERT INTO supplier_profit_po_overrides (supplier_id, stock_item_id, po_price, avg_price, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (supplier_id, stock_item_id)
         DO UPDATE SET
           po_price  = COALESCE(EXCLUDED.po_price,  supplier_profit_po_overrides.po_price),
           avg_price = COALESCE(EXCLUDED.avg_price, supplier_profit_po_overrides.avg_price),
           updated_at = now()`,
        [supplierId, stockItemId, poPrice ?? null, avgPrice ?? null]
      );
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });
}
