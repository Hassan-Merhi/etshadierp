/**
 * supplierProfitCheckRoutes: SupplierProfitLookup endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { pool } from "../../db";

export function registerSupplierProfitLookupRoutes(app: Express, requireAuth: any) {
  // ── GET location groups (master locations with configured price groups) ──
  app.get("/api/supplier-profit-check/location-groups", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const result = await pool.query(
        `
        SELECT DISTINCT l.id, l.name
        FROM location_price_groups lpg
        JOIN locations l ON l.id = lpg.master_location_id
        WHERE lpg.company_id = $1
        ORDER BY l.name
      `,
        [companyId]
      );

      res.json(result.rows);
    } catch (err: unknown) {
      logger.error("[supplier-profit-check/location-groups]", { error: getErrorMessage(err) });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });

  // ── GET OTW containers for a supplier ──
  app.get("/api/supplier-profit-check/otw-containers", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const supplierId = req.query.supplierId;
      if (!supplierId) return res.status(400).json({ message: "supplierId required" });

      const result = await pool.query(
        `
        SELECT c.id, c.container_number, c.eta, c.status, c.items_total,
          c.import_date, c.item_name,
          (SELECT COUNT(*) FROM supplier_container_loaded_items scli WHERE scli.container_id = c.id) AS loaded_items_count
        FROM containers c
        WHERE c.company_id = $1
          AND c.supplier_id = $2
          AND c.status = 'OTW'
        ORDER BY c.created_at DESC
      `,
        [companyId, supplierId]
      );

      res.json(result.rows);
    } catch (err: unknown) {
      logger.error("[supplier-profit-check/otw-containers]", { error: getErrorMessage(err) });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });
}
