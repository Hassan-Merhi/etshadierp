import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { pool } from "../../db";
import { requireAuth } from "../../auth";
import { logger } from "../../lib/logger";
import { parseListPagination, setListPaginationHeaders } from "../../lib/listPagination";

function readAfterId(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function registerFactoryDailyScanRoutes(app: Express) {
  app.get("/api/factory/daily-bale-scans/produced", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const date = String(req.query.date || "");
      if (!date) return res.status(400).json({ message: "date query param required (YYYY-MM-DD)" });
      const pagination = parseListPagination(req.query, { defaultPageSize: 500, maxPageSize: 1000, force: true });
      const params: unknown[] = [companyId, date];
      const clauses = ["fb.company_id = $1", "fb.stock_entry_date = $2"];
      if (req.query.status) {
        params.push(String(req.query.status));
        clauses.push(`fb.status = $${params.length}`);
      }
      const afterId = readAfterId(req.query.afterId);
      if (afterId !== null) {
        params.push(afterId);
        clauses.push(`fb.id > $${params.length}`);
      }
      const whereSql = clauses.join(" AND ");
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM factory_bales fb WHERE ${whereSql}`,
        params
      );
      const limitParam = params.length + 1;
      const offsetParam = params.length + 2;
      const result = await pool.query(
        `SELECT fb.id, fb.reference_number, fb.article_code, fb.product_name,
                fb.weight_kg::text, fb.status,
                fb.stock_entry_date::text AS date_bale_produced, fb.worker_name,
                (fb.deleted_at IS NOT NULL) AS is_deleted,
                EXISTS(
                  SELECT 1 FROM customer_order_bales cob
                  JOIN customer_orders co ON co.id = cob.order_id
                  WHERE cob.bale_reference = fb.reference_number
                    AND co.company_id = $1
                    AND co.status = 'LOADING'
                ) AS is_in_loading_order
         FROM factory_bales fb
         WHERE ${whereSql}
         ORDER BY fb.id ASC
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        [...params, pagination.pageSize, pagination.offset]
      );
      setListPaginationHeaders(res, countResult.rows[0]?.count ?? 0, pagination);
      res.set("Cache-Control", "private, max-age=10");
      return res.json(result.rows);
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/factory/daily-bale-scans/dates", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const pagination = parseListPagination(req.query, { defaultPageSize: 90, maxPageSize: 365, force: true });
      const params: unknown[] = [companyId];
      const clauses = ["company_id = $1"];
      if (req.query.dateFrom) {
        params.push(String(req.query.dateFrom));
        clauses.push(`scan_date >= $${params.length}`);
      }
      if (req.query.dateTo) {
        params.push(String(req.query.dateTo));
        clauses.push(`scan_date <= $${params.length}`);
      }
      const whereSql = clauses.join(" AND ");
      const countResult = await pool.query(
        `SELECT COUNT(DISTINCT scan_date)::int AS count FROM factory_daily_bale_scans WHERE ${whereSql}`,
        params
      );
      const limitParam = params.length + 1;
      const offsetParam = params.length + 2;
      const result = await pool.query(
        `SELECT scan_date::text AS scan_date, COUNT(*) AS bale_count, COALESCE(SUM(weight_kg),0) AS total_kg
         FROM factory_daily_bale_scans
         WHERE ${whereSql}
         GROUP BY scan_date
         ORDER BY scan_date DESC
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        [...params, pagination.pageSize, pagination.offset]
      );
      setListPaginationHeaders(res, countResult.rows[0]?.count ?? 0, pagination);
      res.set("Cache-Control", "private, max-age=60");
      return res.json(result.rows);
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/factory/daily-bale-scans", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const date = String(req.query.date || "");
      if (!date) return res.status(400).json({ message: "date query param required (YYYY-MM-DD)" });
      const pagination = parseListPagination(req.query, { defaultPageSize: 500, maxPageSize: 1000, force: true });
      const params: unknown[] = [companyId, date];
      const clauses = ["company_id = $1", "scan_date = $2"];
      const afterId = readAfterId(req.query.afterId);
      if (afterId !== null) {
        params.push(afterId);
        clauses.push(`id > $${params.length}`);
      }
      const whereSql = clauses.join(" AND ");
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM factory_daily_bale_scans WHERE ${whereSql}`,
        params
      );
      const limitParam = params.length + 1;
      const offsetParam = params.length + 2;
      const result = await pool.query(
        `SELECT id, company_id, scan_date::text AS scan_date, reference_number, article_code,
                product_name, weight_kg, scanned_at, scanned_by_user_id
         FROM factory_daily_bale_scans
         WHERE ${whereSql}
         ORDER BY id ASC
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        [...params, pagination.pageSize, pagination.offset]
      );
      setListPaginationHeaders(res, countResult.rows[0]?.count ?? 0, pagination);
      res.set("Cache-Control", "private, max-age=10");
      return res.json(result.rows);
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/factory/daily-bale-scans", requireAuth, async (req: any, res: any) => {
    const startedAt = Date.now();
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const userId = req.session.userId;
      logger.info("Factory bale scan started", {
        module: "factory",
        action: "dailyBaleScan",
        userId,
        factoryCompanyId: companyId,
      });
      const { scanDate, referenceNumber, articleCode, productName, weightKg } = req.body;
      if (!scanDate || !referenceNumber) {
        return res.status(400).json({ message: "scanDate and referenceNumber are required" });
      }
      const reference = String(referenceNumber).trim().toUpperCase();
      const baleCheck = await pool.query(
        `SELECT id FROM factory_bales
         WHERE company_id = $1 AND stock_entry_date = $2 AND reference_number = $3 AND deleted_at IS NULL`,
        [companyId, scanDate, reference]
      );
      if (!baleCheck.rowCount) {
        return res.status(422).json({ message: `Bale ${reference} was not produced on ${scanDate}` });
      }
      const existing = await pool.query(
        `SELECT id FROM factory_daily_bale_scans WHERE company_id = $1 AND scan_date = $2 AND reference_number = $3`,
        [companyId, scanDate, reference]
      );
      if (existing.rowCount)
        return res.status(409).json({ message: "This bale has already been scanned for this day" });
      const result = await pool.query(
        `INSERT INTO factory_daily_bale_scans
           (company_id, scan_date, reference_number, article_code, product_name, weight_kg, scanned_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, company_id, scan_date::text AS scan_date, reference_number, article_code,
                   product_name, weight_kg, scanned_at, scanned_by_user_id`,
        [companyId, scanDate, reference, articleCode || null, productName || null, weightKg || null, userId]
      );
      logger.info("Factory bale scan succeeded", {
        module: "factory",
        action: "dailyBaleScan",
        userId,
        factoryCompanyId: companyId,
        durationMs: Date.now() - startedAt,
      });
      return res.status(201).json(result.rows[0]);
    } catch (error: unknown) {
      logger.error("Factory bale scan failed", {
        module: "factory",
        action: "dailyBaleScan",
        durationMs: Date.now() - startedAt,
        error,
      });
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.delete("/api/factory/daily-bale-scans/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
      await pool.query(`DELETE FROM factory_daily_bale_scans WHERE id = $1 AND company_id = $2`, [id, companyId]);
      return res.json({ success: true });
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
