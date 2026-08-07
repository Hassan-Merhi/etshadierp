import type { Express, RequestHandler } from "express";
import { pool } from "../../db";
import { requireAuth } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";

function requestCompanyId(req: any): number | null {
  const raw = req.session?.factoryCompanyId || req.session?.currentCompanyId;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function rowsOf<T = any>(result: any): T[] {
  return Array.isArray(result?.rows) ? result.rows : [];
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function ledgerTotals(rows: any[]) {
  return rows.reduce(
    (total, row) => ({
      baleCount: total.baleCount + Number(row.baleCount || 0),
      totalWeightKg: total.totalWeightKg + Number(row.totalWeightKg || 0),
      totalCost: total.totalCost + Number(row.totalCost || 0),
    }),
    { baleCount: 0, totalWeightKg: 0, totalCost: 0 },
  );
}

const LEDGER_CLASSIFICATION_SQL = `
  CASE
    WHEN fb.status = 'SOLD' THEN
      CASE WHEN EXISTS (
        SELECT 1
        FROM customer_order_bales cob
        INNER JOIN customer_orders co ON co.id = cob.order_id
        WHERE cob.bale_id = fb.id
          AND co.company_id = $1
          AND co.status IN ('LOADING', 'PENDING_VERIFICATION', 'VERIFIED')
      ) THEN 'pendingLoading' ELSE 'sold' END
    WHEN fb.status = 'FINALIZED' THEN 'sold'
    WHEN fb.status = 'DISPATCHED' AND fb.waste_dispatch_id IS NOT NULL THEN 'wasteDispatched'
    WHEN fb.status = 'RESERVED_FOR_ORDER' THEN 'pendingLoading'
    WHEN fb.status = 'IN_STOCK' THEN
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM customer_order_bales cob
          INNER JOIN customer_orders co ON co.id = cob.order_id
          WHERE cob.bale_id = fb.id
            AND co.company_id = $1
            AND co.status IN ('LOADING', 'PENDING_VERIFICATION', 'VERIFIED')
        ) THEN 'pendingLoading'
        WHEN EXISTS (
          SELECT 1
          FROM customer_order_bales cob
          INNER JOIN customer_orders co ON co.id = cob.order_id
          WHERE cob.bale_id = fb.id
            AND co.company_id = $1
            AND co.status IN ('FINALIZED', 'DISPATCHED', 'SOLD')
        ) THEN 'sold'
        WHEN COALESCE(fb.article_code, fbp.article_code, '') LIKE 'HMD16%'
          OR LOWER(COALESCE(fc.name, '')) LIKE '%garbage%'
          OR LOWER(COALESCE(fc.name, '')) LIKE '%wiper%'
        THEN 'wasteStock'
        ELSE 'currentStock'
      END
    ELSE NULL
  END
`;

/**
 * Phase 3 bandwidth/query-pressure routes. They are registered before the
 * legacy Factory registrars so only the explicitly handled read contracts are
 * intercepted; every write and every unhandled read keeps its existing route.
 */
export function registerBandwidthPhase3FactoryReads(app: Express): void {
  app.get(
    "/api/factory/customer-proformas",
    requireAuth,
    (async (req: any, res: any, next: any) => {
      if (req.query.profile !== "summary") return next();

      try {
        const companyId = requestCompanyId(req);
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const customerId = Number.parseInt(String(req.query.customerId ?? ""), 10);
        const hasCustomer = Number.isFinite(customerId) && customerId > 0;
        const pageSize = clampInt(req.query.pageSize, 100, 1, 250);
        const page = clampInt(req.query.page, 1, 1, 1000000);
        const offset = (page - 1) * pageSize;
        const params: unknown[] = [companyId];
        let customerSql = "";
        if (hasCustomer) {
          params.push(customerId);
          customerSql = ` AND cp.customer_id = $${params.length}`;
        }
        const limitParam = params.length + 1;
        const offsetParam = params.length + 2;

        const [countResult, listResult] = await Promise.all([
          pool.query(
            `SELECT COUNT(*)::int AS count
             FROM customer_proformas cp
             WHERE cp.company_id = $1
               AND cp.deleted_at IS NULL${customerSql}`,
            params,
          ),
          pool.query(
            `SELECT
               cp.id,
               cp.company_id AS "companyId",
               cp.customer_id AS "customerId",
               cp.name,
               cp.is_active AS "isActive",
               cp.created_at AS "createdAt",
               cp.updated_at AS "updatedAt",
               COUNT(cpl.id)::int AS "lineCount",
               COALESCE(SUM(cpl.quantity), 0)::int AS "totalQty",
               COALESCE(SUM(
                 cpl.quantity::numeric * COALESCE(fbp.weight_per_bale_kg::numeric, 0)
               ), 0)::float AS "totalWeightKg",
               COALESCE(SUM(
                 cpl.quantity::numeric *
                 CASE
                   WHEN cpl.pricing_mode = 'per_kg'
                     AND COALESCE(cpl.price_per_kg::numeric, 0) > 0
                     AND COALESCE(fbp.weight_per_bale_kg::numeric, 0) > 0
                   THEN cpl.price_per_kg::numeric * fbp.weight_per_bale_kg::numeric
                   ELSE COALESCE(cpl.price_per_bale::numeric, 0)
                 END
               ), 0)::float AS "totalAmount"
             FROM customer_proformas cp
             LEFT JOIN customer_proforma_lines cpl ON cpl.proforma_id = cp.id
             LEFT JOIN factory_bale_products fbp
               ON fbp.company_id = cp.company_id
              AND fbp.article_code = cpl.article_code
              AND fbp.deleted_at IS NULL
             WHERE cp.company_id = $1
               AND cp.deleted_at IS NULL${customerSql}
             GROUP BY cp.id, cp.company_id, cp.customer_id, cp.name, cp.is_active, cp.created_at, cp.updated_at
             ORDER BY cp.is_active DESC, cp.name ASC, cp.id ASC
             LIMIT $${limitParam} OFFSET $${offsetParam}`,
            [...params, pageSize, offset],
          ),
        ]);

        const total = Number(countResult.rows[0]?.count || 0);
        res.set("X-Total-Count", String(total));
        res.set("X-Page", String(page));
        res.set("X-Page-Size", String(pageSize));
        res.set("X-ERP-Payload-Profile", "customer-proforma-summary-v2");
        res.set("Cache-Control", "private, max-age=60");
        return res.json(
          rowsOf(listResult).map((row: any) => ({
            ...row,
            lines: [],
          })),
        );
      } catch (error: unknown) {
        logger.error("Error fetching compact customer proformas", { error });
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    }) as RequestHandler,
  );

  app.get(
    "/api/factory/bale-ledger",
    requireAuth,
    (async (req: any, res: any) => {
      try {
        const companyId = requestCompanyId(req);
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const result = await pool.query(
          `WITH classified AS (
             SELECT
               fb.id,
               fb.product_id,
               COALESCE(fbp.name, fb.product_name, fb.article_code, 'Unknown') AS product_name,
               COALESCE(fbp.article_code, fb.article_code, '—') AS article_code,
               COALESCE(fc.name, '—') AS category_name,
               COALESCE(fb.weight_kg::numeric, 0) AS weight_kg,
               COALESCE(fbp.production_price::numeric, 0) AS sell_value,
               ${LEDGER_CLASSIFICATION_SQL} AS section
             FROM factory_bales fb
             LEFT JOIN factory_bale_products fbp
               ON fbp.id = fb.product_id
              AND fbp.company_id = $1
             LEFT JOIN factory_categories fc
               ON fc.id = fbp.category_id
              AND fc.company_id = $1
             WHERE fb.company_id = $1
               AND fb.status IN ('IN_STOCK', 'FINALIZED', 'SOLD', 'DISPATCHED', 'RESERVED_FOR_ORDER')
               AND (
                 fb.status IN ('IN_STOCK', 'RESERVED_FOR_ORDER')
                 OR COALESCE(fb.finalized_at, fb.updated_at, fb.created_at) >= NOW() - INTERVAL '90 days'
               )
           )
           SELECT
             section,
             product_id AS "productId",
             product_name AS "productName",
             article_code AS "articleCode",
             category_name AS "categoryName",
             COUNT(*)::int AS "baleCount",
             COALESCE(SUM(weight_kg), 0)::float AS "totalWeightKg",
             COALESCE(SUM(sell_value), 0)::float AS "totalCost"
           FROM classified
           WHERE section IS NOT NULL
           GROUP BY section, product_id, product_name, article_code, category_name
           ORDER BY section, category_name, product_name, product_id NULLS LAST`,
          [companyId],
        );

        const buckets: Record<string, any[]> = {
          currentStock: [],
          wasteStock: [],
          sold: [],
          wasteDispatched: [],
          pendingLoading: [],
        };
        for (const row of rowsOf(result)) {
          if (buckets[row.section]) {
            const { section: _section, ...bucketRow } = row;
            buckets[row.section].push(bucketRow);
          }
        }

        const totals = {
          currentStock: ledgerTotals(buckets.currentStock),
          wasteStock: ledgerTotals(buckets.wasteStock),
          sold: ledgerTotals(buckets.sold),
          wasteDispatched: ledgerTotals(buckets.wasteDispatched),
          pendingLoading: ledgerTotals(buckets.pendingLoading),
        };
        const grand = ledgerTotals([
          ...buckets.currentStock,
          ...buckets.wasteStock,
          ...buckets.sold,
          ...buckets.wasteDispatched,
          ...buckets.pendingLoading,
        ]);

        res.set("X-ERP-Payload-Profile", "bale-ledger-sql-aggregate");
        res.set("Cache-Control", "private, max-age=120");
        return res.json({ ...buckets, totals: { ...totals, grand } });
      } catch (error: unknown) {
        logger.error("Error fetching SQL-aggregated bale ledger", { error });
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    }) as RequestHandler,
  );

  app.get(
    "/api/factory/bale-ledger/details",
    requireAuth,
    (async (req: any, res: any) => {
      try {
        const companyId = requestCompanyId(req);
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const section = String(req.query.section || "");
        const validSections = new Set(["currentStock", "wasteStock", "sold", "wasteDispatched", "pendingLoading"]);
        if (!validSections.has(section)) return res.status(400).json({ message: "Invalid section" });

        const rawProductId = String(req.query.productId ?? "null");
        const productId = rawProductId === "null" ? null : Number.parseInt(rawProductId, 10);
        if (productId !== null && (!Number.isFinite(productId) || productId <= 0)) {
          return res.status(400).json({ message: "Invalid productId" });
        }

        const params: unknown[] = [companyId, section];
        const productClause = productId === null ? "fb.product_id IS NULL" : `fb.product_id = $3`;
        if (productId !== null) params.push(productId);

        const result = await pool.query(
          `WITH classified AS (
             SELECT
               fb.id,
               fb.reference_number,
               COALESCE(fb.weight_kg::numeric, 0) AS weight_kg,
               COALESCE(fbp.production_price::numeric, 0) AS sell_value,
               ${LEDGER_CLASSIFICATION_SQL} AS section
             FROM factory_bales fb
             LEFT JOIN factory_bale_products fbp
               ON fbp.id = fb.product_id
              AND fbp.company_id = $1
             LEFT JOIN factory_categories fc
               ON fc.id = fbp.category_id
              AND fc.company_id = $1
             WHERE fb.company_id = $1
               AND fb.status IN ('IN_STOCK', 'FINALIZED', 'SOLD', 'DISPATCHED', 'RESERVED_FOR_ORDER')
               AND ${productClause}
               AND (
                 fb.status IN ('IN_STOCK', 'RESERVED_FOR_ORDER')
                 OR COALESCE(fb.finalized_at, fb.updated_at, fb.created_at) >= NOW() - INTERVAL '90 days'
               )
           )
           SELECT
             id,
             COALESCE(reference_number, '') AS ref,
             weight_kg::float AS "weightKg",
             sell_value::float AS "totalCost"
           FROM classified
           WHERE section = $2
           ORDER BY id ASC`,
          params,
        );

        res.set("X-ERP-Payload-Profile", "bale-ledger-detail-sql");
        res.set("Cache-Control", "private, max-age=300");
        return res.json({ baleDetails: rowsOf(result) });
      } catch (error: unknown) {
        logger.error("Error fetching compact bale ledger detail", { error });
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    }) as RequestHandler,
  );

  app.get(
    "/api/factory/raw-stock/available-containers",
    requireAuth,
    (async (req: any, res: any) => {
      try {
        const companyId = requestCompanyId(req);
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const result = await pool.query(
          `SELECT
             fc.id,
             fc.container_number AS "containerNumber",
             fc.supplier_id AS "supplierId",
             fs.name AS "supplierName",
             fc.status,
             fc.total_kg AS "totalKg",
             fc.declared_kg AS "declaredKg",
             fc.actual_received_kg AS "actualReceivedKg",
             fc.rate_per_kg AS "ratePerKg",
             fc.currency_code AS "currencyCode",
             fc.fx_rate_to_usd AS "fxRateToUsd",
             fc.freight,
             fc.freight_currency_code AS "freightCurrencyCode",
             fc.freight_supplier_id AS "freightSupplierId",
             fc.freight_paid_by AS "freightPaidBy",
             fc.freight_own_account_id AS "freightOwnAccountId",
             fc.other_charges AS "otherCharges",
             fc.other_charges_currency_code AS "otherChargesCurrencyCode",
             fc.other_charges_account_id AS "otherChargesAccountId",
             fc.other_charges_supplier_id AS "otherChargesSupplierId",
             fc.commission_amount AS "commissionAmount",
             fc.commission_currency_code AS "commissionCurrencyCode",
             fc.commission_supplier_id AS "commissionSupplierId",
             fc.commission_fx_rate_to_usd AS "commissionFxRateToUsd",
             fc.commission_fx_rate_confirmed AS "commissionFxRateConfirmed",
             latest_raw.cost_per_kg AS "fixedCostPerKg",
             latest_raw.cost_per_kg_usd AS "fixedCostPerKgUsd"
           FROM factory_containers fc
           LEFT JOIN factory_suppliers fs
             ON fs.id = fc.supplier_id
            AND fs.company_id = fc.company_id
           LEFT JOIN LATERAL (
             SELECT frs.cost_per_kg, frs.cost_per_kg_usd
             FROM factory_raw_stock frs
             WHERE frs.company_id = fc.company_id
               AND frs.container_id = fc.id
               AND frs.deleted_at IS NULL
             ORDER BY frs.id DESC
             LIMIT 1
           ) latest_raw ON TRUE
           WHERE fc.company_id = $1
             AND fc.deleted_at IS NULL
             AND fc.status IN ('PENDING', 'ARRIVED', 'RECEIVED', 'PARTIALLY_RECEIVED')
             AND (
               fc.status <> 'PARTIALLY_RECEIVED'
               OR COALESCE(fc.total_kg, fc.declared_kg, 0) <= 0
               OR COALESCE(fc.actual_received_kg, 0) < COALESCE(fc.total_kg, fc.declared_kg, 0)
             )
           ORDER BY fc.id DESC`,
          [companyId],
        );

        res.set("X-ERP-Payload-Profile", "raw-stock-offload-selector");
        res.set("Cache-Control", "private, max-age=30");
        return res.json(rowsOf(result));
      } catch (error: unknown) {
        logger.error("Error fetching compact raw-stock available containers", { error });
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    }) as RequestHandler,
  );
}
