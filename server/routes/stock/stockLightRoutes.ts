import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../auth";
import { pool } from "../../db";
import { buildPaginationMeta, parseIdList, parsePagination, parseSearchQuery } from "../../lib/pagination";

const MAX_STOCK_ITEM_PAGE_SIZE = 100;

/**
 * Lightweight stock-item selector endpoint.
 *
 * Ordinary requests are paginated and return only stable selector/search
 * fields. The endpoint intentionally excludes opening balances, rates, values,
 * prices, timestamps, translations and other management-only fields. Full
 * records remain available from GET /api/stock-items/:id after an item is
 * selected or opened.
 *
 * Bulk management and repair screens that genuinely require every lightweight
 * identity record must opt in explicitly with all=true. Selector workflows use
 * bounded server search, location filters and selected-ID hydration instead.
 */
export function registerStockLightRoutes(app: Express) {
  app.get("/api/stock-items/light", requireAuth, async (req: any, res) => {
    const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
    try {
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const search = parseSearchQuery(req.query.search);
      const selectedIds = parseIdList(req.query.ids);
      const includeInactive = req.query.includeInactive === "true";
      const rawLocationId = req.query.locationId;
      const locationId = rawLocationId == null ? null : Number.parseInt(String(rawLocationId), 10);
      if (rawLocationId != null && (!Number.isFinite(locationId) || (locationId as number) <= 0)) {
        return res.status(400).json({ message: "Invalid locationId" });
      }

      if (locationId) {
        const locationCheck = await pool.query(
          `SELECT id FROM locations WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL LIMIT 1`,
          [locationId, companyId]
        );
        if (locationCheck.rowCount === 0) {
          return res.status(403).json({ message: "Location is not available for the selected company" });
        }
      }

      const explicitFullList = req.query.all === "true";
      const paginated = !explicitFullList;
      const { page, pageSize, offset } = parsePagination(req.query, {
        defaultPageSize: 50,
        maxPageSize: MAX_STOCK_ITEM_PAGE_SIZE,
      });

      const filterValues: unknown[] = [companyId];
      const addValue = (value: unknown) => {
        filterValues.push(value);
        return `$${filterValues.length}`;
      };
      const conditions = ["si.company_id = $1", "si.deleted_at IS NULL"];
      if (!includeInactive) conditions.push("si.active = true");

      if (locationId) {
        const locationParam = addValue(locationId);
        conditions.push(
          `EXISTS (
             SELECT 1 FROM inventory inv
             WHERE inv.stock_item_id = si.id
               AND inv.location_id = ${locationParam}
           )`
        );
      }

      let searchCondition = "";
      if (search) {
        const searchParam = addValue(`%${search}%`);
        searchCondition = `(
          si.code ILIKE ${searchParam}
          OR si.name ILIKE ${searchParam}
          OR EXISTS (
            SELECT 1 FROM stock_item_code_aliases a
            WHERE a.company_id = si.company_id
              AND a.stock_item_id = si.id
              AND a.alias_code ILIKE ${searchParam}
          )
        )`;
      }

      if (selectedIds.length > 0) {
        const idsParam = addValue(selectedIds);
        conditions.push(
          searchCondition
            ? `(${searchCondition} OR si.id = ANY(${idsParam}::int[]))`
            : `si.id = ANY(${idsParam}::int[])`
        );
      } else if (searchCondition) {
        conditions.push(searchCondition);
      }

      const whereSql = conditions.join(" AND ");
      const selectSql = `
        SELECT
          si.id,
          si.code,
          si.name,
          si.uom,
          si.active,
          si.stock_group_id AS "stockGroupId",
          si.category_id AS "categoryId",
          si.grade_id AS "gradeId",
          COALESCE((
            SELECT json_agg(a.alias_code ORDER BY a.alias_code)
            FROM stock_item_code_aliases a
            WHERE a.company_id = si.company_id
              AND a.stock_item_id = si.id
          ), '[]'::json) AS aliases
        FROM stock_items si
        WHERE ${whereSql}
        ORDER BY si.name ASC, si.id ASC`;

      if (!paginated) {
        res.setHeader("Deprecation", "true");
        res.setHeader(
          "Warning",
          '299 - "Explicit full stock-items/light response; selectors should use paging/search"'
        );
        const legacyResult = await pool.query(selectSql, filterValues);
        return res.json(legacyResult.rows);
      }

      const countValues = [...filterValues];
      const rowValues = [...filterValues, pageSize, offset];
      const limitParam = `$${filterValues.length + 1}`;
      const offsetParam = `$${filterValues.length + 2}`;
      const [countResult, rowsResult] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total FROM stock_items si WHERE ${whereSql}`, countValues),
        pool.query(`${selectSql} LIMIT ${limitParam} OFFSET ${offsetParam}`, rowValues),
      ]);
      const total = Number(countResult.rows[0]?.total ?? 0);

      res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=30");
      return res.json({
        data: rowsResult.rows,
        ...buildPaginationMeta(total, page, pageSize),
      });
    } catch (error: unknown) {
      logger.error("[stock-items/light] Failed to load lightweight stock items", {
        companyId: companyId || null,
        error: getErrorMessage(error) || String(error),
      });
      return res.status(500).json({ message: "Failed to load stock items" });
    }
  });
}
