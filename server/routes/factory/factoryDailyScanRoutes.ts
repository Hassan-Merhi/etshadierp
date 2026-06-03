import type { Express } from "express";
import { pool } from "../../db";
import { requireAuth } from "../../auth";

export function registerFactoryDailyScanRoutes(app: Express) {

  // All bales produced on a given date (for verification UI)
  app.get("/api/factory/daily-bale-scans/produced", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const date = req.query.date as string;
      if (!date) return res.status(400).json({ message: "date query param required (YYYY-MM-DD)" });
      const result = await pool.query(
        `SELECT fb.id, fb.reference_number, fb.article_code, fb.product_name,
                fb.weight_kg::text, fb.status,
                fb.stock_entry_date::text AS date_bale_produced, fb.worker_name,
                (fb.deleted_at IS NOT NULL) AS is_deleted,
                EXISTS(
                  SELECT 1 FROM customer_order_bales cob
                  JOIN customer_orders co ON co.id = cob.order_id
                  WHERE cob.bale_reference = fb.reference_number
                    AND co.status = 'LOADING'
                ) AS is_in_loading_order
         FROM factory_bales fb
         WHERE fb.company_id = $1 AND fb.stock_entry_date = $2
         ORDER BY fb.id ASC`,
        [companyId, date],
      );
      return res.json(result.rows);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // Summary of scan dates (for calendar view etc.)
  app.get("/api/factory/daily-bale-scans/dates", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const result = await pool.query(
        `SELECT scan_date::text AS scan_date, COUNT(*) AS bale_count, COALESCE(SUM(weight_kg),0) AS total_kg
         FROM factory_daily_bale_scans
         WHERE company_id = $1
         GROUP BY scan_date
         ORDER BY scan_date DESC`,
        [companyId],
      );
      return res.json(result.rows);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // Get scans for a date
  app.get("/api/factory/daily-bale-scans", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const date = req.query.date as string;
      if (!date) return res.status(400).json({ message: "date query param required (YYYY-MM-DD)" });
      const result = await pool.query(
        `SELECT id, company_id, scan_date::text AS scan_date, reference_number, article_code,
                product_name, weight_kg, scanned_at, scanned_by_user_id
         FROM factory_daily_bale_scans
         WHERE company_id = $1 AND scan_date = $2
         ORDER BY scanned_at ASC`,
        [companyId, date],
      );
      return res.json(result.rows);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // Record a scan — only allowed if bale was produced on that day
  app.post("/api/factory/daily-bale-scans", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const userId = req.session.userId;
      const { scanDate, referenceNumber, articleCode, productName, weightKg } = req.body;
      if (!scanDate || !referenceNumber) {
        return res.status(400).json({ message: "scanDate and referenceNumber are required" });
      }
      const ref = String(referenceNumber).trim().toUpperCase();

      // Validate that this bale was produced on the given date
      const baleCheck = await pool.query(
        `SELECT id FROM factory_bales
         WHERE company_id = $1 AND stock_entry_date = $2 AND reference_number = $3 AND deleted_at IS NULL`,
        [companyId, scanDate, ref],
      );
      if (!baleCheck.rowCount || baleCheck.rowCount === 0) {
        return res.status(422).json({ message: `Bale ${ref} was not produced on ${scanDate}` });
      }

      // Check for duplicate scan
      const existing = await pool.query(
        `SELECT id FROM factory_daily_bale_scans WHERE company_id = $1 AND scan_date = $2 AND reference_number = $3`,
        [companyId, scanDate, ref],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        return res.status(409).json({ message: "This bale has already been scanned for this day" });
      }

      const result = await pool.query(
        `INSERT INTO factory_daily_bale_scans
           (company_id, scan_date, reference_number, article_code, product_name, weight_kg, scanned_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, company_id, scan_date::text AS scan_date, reference_number, article_code,
                   product_name, weight_kg, scanned_at, scanned_by_user_id`,
        [companyId, scanDate, ref, articleCode || null, productName || null, weightKg || null, userId],
      );
      return res.status(201).json(result.rows[0]);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // Remove a scan (un-verify a bale)
  app.delete("/api/factory/daily-bale-scans/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      await pool.query(
        `DELETE FROM factory_daily_bale_scans WHERE id = $1 AND company_id = $2`,
        [id, companyId],
      );
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });
}
