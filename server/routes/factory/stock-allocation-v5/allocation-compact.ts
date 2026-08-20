import type { Express, NextFunction, Request, Response } from "express";
import { requireAuth } from "../../../auth";
import { pool } from "../../../db";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";

type CompactAllocationRow = {
  articleCode: string;
  freeToPromise: number;
};

/**
 * Lightweight compatibility read for consumers that only need article-code
 * availability. It deliberately uses app.use on the existing V5 route so the
 * public route manifest does not gain a second API surface; requests without
 * compact=1 continue to the existing V5 handlers unchanged.
 */
export function registerV5StockAllocationCompactMiddleware(app: Express): void {
  app.use(
    "/api/factory/v5/stock-allocation",
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET" || req.query.compact !== "1") return next();

      try {
        const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        // Preserve the legacy V5 backfill contract for old DRAFT/LOADING orders,
        // but do it once before the compact aggregate rather than running the
        // legacy multi-query allocation assembler.
        await pool
          .query(
            `
              INSERT INTO customer_order_expected_lines
                (company_id, order_id, proforma_id, proforma_line_id, article_code, product_name, expected_qty)
              SELECT co.company_id, co.id, co.proforma_id_used, cpl.id,
                     cpl.article_code, cpl.product_name, cpl.quantity
              FROM customer_orders co
              JOIN customer_proformas cp
                ON cp.id = co.proforma_id_used
               AND cp.company_id = $1
               AND cp.is_active = true
              JOIN customer_proforma_lines cpl ON cpl.proforma_id = co.proforma_id_used
              WHERE co.company_id = $1
                AND co.status IN ('DRAFT', 'LOADING')
                AND co.proforma_id_used IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1
                  FROM customer_order_expected_lines cel
                  WHERE cel.order_id = co.id AND cel.article_code = cpl.article_code
                )
              ON CONFLICT (order_id, article_code) DO NOTHING
            `,
            [companyId]
          )
          .catch(() => undefined);

        const result = await pool.query(
          `
            WITH active_proformas AS (
              SELECT cp.id
              FROM customer_proformas cp
              WHERE cp.company_id = $1 AND cp.is_active = true
            ),
            active_orders AS (
              SELECT co.id, co.proforma_id_used AS proforma_id, co.status
              FROM customer_orders co
              JOIN active_proformas ap ON ap.id = co.proforma_id_used
              WHERE co.company_id = $1
                AND co.proforma_id_used IS NOT NULL
                AND co.status IN ('DRAFT', 'LOADING', 'PENDING_VERIFICATION', 'VERIFIED', 'FINALIZED')
            ),
            stock AS (
              SELECT fb.article_code, COUNT(*)::int AS count
              FROM factory_bales fb
              WHERE fb.company_id = $1 AND fb.status = 'IN_STOCK'
              GROUP BY fb.article_code
            ),
            loaded_per_order AS (
              SELECT cob.order_id, fb.article_code, COUNT(*)::int AS count
              FROM customer_order_bales cob
              JOIN factory_bales fb ON fb.id = cob.bale_id
              JOIN active_orders ao ON ao.id = cob.order_id
              GROUP BY cob.order_id, fb.article_code
            ),
            loading AS (
              SELECT lpo.article_code, SUM(lpo.count)::int AS count
              FROM loaded_per_order lpo
              JOIN active_orders ao ON ao.id = lpo.order_id AND ao.status = 'LOADING'
              GROUP BY lpo.article_code
            ),
            expected AS (
              SELECT cel.article_code,
                     SUM(GREATEST(cel.expected_qty - COALESCE(lpo.count, 0), 0))::int AS count
              FROM customer_order_expected_lines cel
              JOIN active_orders ao ON ao.id = cel.order_id AND ao.status IN ('DRAFT', 'LOADING')
              LEFT JOIN loaded_per_order lpo
                ON lpo.order_id = cel.order_id AND lpo.article_code = cel.article_code
              GROUP BY cel.article_code
            ),
            product_codes AS (
              SELECT COALESCE(fbp.article_code, fbp.code) AS article_code
              FROM factory_bale_products fbp
              WHERE fbp.company_id = $1 AND fbp.active = true
            ),
            all_codes AS (
              SELECT article_code FROM product_codes WHERE article_code IS NOT NULL
              UNION SELECT article_code FROM stock WHERE article_code IS NOT NULL
              UNION SELECT article_code FROM loading WHERE article_code IS NOT NULL
              UNION SELECT article_code FROM expected WHERE article_code IS NOT NULL
            )
            SELECT ac.article_code AS "articleCode",
                   (COALESCE(s.count, 0) - COALESCE(e.count, 0) - COALESCE(l.count, 0))::int AS "freeToPromise"
            FROM all_codes ac
            LEFT JOIN stock s ON s.article_code = ac.article_code
            LEFT JOIN loading l ON l.article_code = ac.article_code
            LEFT JOIN expected e ON e.article_code = ac.article_code
            ORDER BY ac.article_code
          `,
          [companyId]
        );

        const rows: CompactAllocationRow[] = result.rows.map((row) => ({
          articleCode: String(row.articleCode),
          freeToPromise: Number(row.freeToPromise || 0),
        }));

        res.setHeader("Cache-Control", "private, no-store");
        return res.json({ rows });
      } catch (error: unknown) {
        logger.error("[V5] compact stock-allocation error", { error });
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    }
  );
}
