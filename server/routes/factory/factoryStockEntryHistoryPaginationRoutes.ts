import type { Express, NextFunction, Request, Response } from "express";
import { requireAuth } from "../../auth";
import { pool } from "../../db";
import { getClientDate } from "../../lib/dateUtils";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 250;

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function wantsPagination(req: Request): boolean {
  return (
    req.query.pagination === "1" ||
    req.query.page !== undefined ||
    req.query.limit !== undefined ||
    req.query.pageSize !== undefined ||
    req.query.offset !== undefined
  );
}

function parsePagination(req: Request): { page: number; limit: number; offset: number } {
  const limit = Math.min(
    MAX_PAGE_SIZE,
    parsePositiveInt(req.query.limit ?? req.query.pageSize, DEFAULT_PAGE_SIZE)
  );
  if (req.query.offset !== undefined) {
    const offset = Math.max(0, Number.parseInt(String(req.query.offset), 10) || 0);
    return { page: Math.floor(offset / limit) + 1, limit, offset };
  }
  const page = parsePositiveInt(req.query.page, 1);
  return { page, limit, offset: (page - 1) * limit };
}

function parseOptionalId(value: unknown): number | undefined {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function registerFactoryStockEntryHistoryPaginationRoutes(app: Express): void {
  app.get(
    "/api/factory/bales/stock-entry-history",
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!wantsPagination(req)) return next();

      try {
        const session = req.session as any;
        const companyId = session.factoryCompanyId || session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const userRole = String(session.currentRole || session.factoryRole || "");
        const isPrivileged = ["Admin", "Owner", "Manager", "Developer"].includes(userRole);
        const today = getClientDate(req);
        const startDate = typeof req.query.startDate === "string" && req.query.startDate ? req.query.startDate : today;
        const endDate = typeof req.query.endDate === "string" && req.query.endDate ? req.query.endDate : today;
        const workerId = parseOptionalId(req.query.workerId);
        const productId = parseOptionalId(req.query.productId);
        const locationId = parseOptionalId(req.query.locationId);
        const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
        const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
        const includeUnassigned = req.query.includeUnassigned !== "false";
        const lite = req.query.lite === "1";
        const { page, limit, offset } = parsePagination(req);

        const values: unknown[] = [];
        const bind = (value: unknown): string => {
          values.push(value);
          return `$${values.length}`;
        };

        const companyParam = bind(companyId);
        const conditions = [
          `fb.company_id = ${companyParam}`,
          `fb.stock_entry_date IS NOT NULL`,
          `fb.stock_entry_date >= ${bind(startDate)}::date`,
          `fb.stock_entry_date <= ${bind(endDate)}::date`,
        ];

        if (!(isPrivileged && search)) conditions.push(`fb.status NOT IN ('DELETED', 'REMOVED')`);
        if (workerId) conditions.push(`fb.finalized_by = ${bind(workerId)}`);
        if (productId) conditions.push(`fb.product_id = ${bind(productId)}`);
        if (locationId) conditions.push(`fb.erp_location_id = ${bind(locationId)}`);
        if (status) conditions.push(`fb.status = ${bind(status)}`);
        if (search) conditions.push(`LOWER(fb.reference_number) LIKE ${bind(`%${search}%`)}`);
        if (!includeUnassigned) conditions.push(`fb.finalized_by IS NOT NULL`);

        const limitParam = bind(limit);
        const offsetParam = bind(offset);
        const balesProjection = lite
          ? `'[]'::jsonb AS bales`
          : `JSONB_AGG(JSONB_BUILD_OBJECT(
              'id', fb.id,
              'referenceNumber', fb.reference_number,
              'weightKg', fb.weight_kg,
              'status', fb.status,
              'finalizedAt', fb.finalized_at,
              'stockEntryDate', fb.stock_entry_date::text,
              'locationName', COALESCE(l.name, 'Unknown'),
              'workerName', fw.full_name,
              'productName', fbp.name,
              'articleCode', fbp.article_code
            ) ORDER BY fb.finalized_at ASC) AS bales`;

        const query = `
          WITH grouped AS (
            SELECT
              fb.stock_entry_date::text AS "stockEntryDate",
              fb.erp_location_id AS "erpLocationId",
              COALESCE(l.name, 'Unknown') AS "locationName",
              fb.finalized_by AS "workerId",
              fw.full_name AS "workerName",
              fb.product_id AS "productId",
              fbp.name AS "productName",
              fbp.article_code AS "articleCode",
              COUNT(*)::int AS "baleCount",
              ROUND(SUM(CAST(fb.weight_kg AS numeric)), 3)::text AS "totalWeight",
              ROUND(AVG(CAST(fb.weight_kg AS numeric)), 3)::text AS "avgWeight",
              MIN(fb.finalized_at) AS "firstFinalizedAt",
              MAX(fb.finalized_at) AS "lastFinalizedAt",
              ${balesProjection}
            FROM factory_bales fb
            LEFT JOIN factory_workers fw ON fb.finalized_by = fw.id AND fw.company_id = ${companyParam}
            LEFT JOIN factory_bale_products fbp ON fb.product_id = fbp.id AND fbp.company_id = ${companyParam}
            LEFT JOIN locations l ON fb.erp_location_id = l.id AND l.company_id = ${companyParam}
            WHERE ${conditions.join(" AND ")}
            GROUP BY
              fb.stock_entry_date,
              fb.erp_location_id,
              l.name,
              fb.finalized_by,
              fw.full_name,
              fb.product_id,
              fbp.name,
              fbp.article_code
          ),
          page_rows AS (
            SELECT *
            FROM grouped
            ORDER BY
              "stockEntryDate" DESC,
              "locationName" ASC NULLS LAST,
              "workerName" ASC NULLS LAST,
              "productName" ASC NULLS LAST
            LIMIT ${limitParam} OFFSET ${offsetParam}
          )
          SELECT
            (SELECT COUNT(*)::int FROM grouped) AS total,
            COALESCE(
              (
                SELECT JSONB_AGG(
                  TO_JSONB(page_rows)
                  ORDER BY
                    "stockEntryDate" DESC,
                    "locationName" ASC NULLS LAST,
                    "workerName" ASC NULLS LAST,
                    "productName" ASC NULLS LAST
                )
                FROM page_rows
              ),
              '[]'::jsonb
            ) AS items
        `;

        const result = await pool.query(query, values);
        const total = Number(result.rows[0]?.total || 0);
        const items = Array.isArray(result.rows[0]?.items) ? result.rows[0].items : [];
        const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

        res.setHeader("X-Total-Count", String(total));
        res.setHeader("X-Page", String(page));
        res.setHeader("X-Page-Size", String(limit));
        res.setHeader("X-Total-Pages", String(totalPages));
        res.setHeader("Access-Control-Expose-Headers", "X-Total-Count, X-Page, X-Page-Size, X-Total-Pages");

        return res.json({
          items,
          total,
          page,
          limit,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1 && totalPages > 0,
        });
      } catch (error: any) {
        return res.status(500).json({ message: error.message });
      }
    }
  );
}
