/**
 * Customer loading intelligence.
 *
 * A product is considered "loaded" for a customer when at least one bale for
 * that article belongs to a non-deleted customer order whose status is LOADING,
 * PENDING_VERIFICATION, VERIFIED, or FINALIZED. This matches the ERP's existing
 * loading lifecycle and makes pending/in-progress/verified invoices visible
 * before the separate truck-scanning session starts.
 */
import type { Express, Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { customers } from "@shared/schema";
import { requireAuth } from "../../../auth";
import { db } from "../../../db";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { resultRows } from "../../../lib/queryResult";

interface CustomerLoadingProductRow {
  id: number;
  code: string;
  articleCode: string | null;
  name: string;
  nameAr: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categoryNameAr: string | null;
  weightPerBaleKg: string | null;
  sellingPrice: string | null;
  productionPrice: string | null;
  active: boolean;
  totalBalesLoaded: number | string | null;
  totalKgLoaded: number | string | null;
  loadingCount: number | string | null;
  lastLoadedAt: Date | string | null;
}

function parsePositiveId(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function findScopedCustomer(companyId: number, customerId: number) {
  const [customer] = await db
    .select({ id: customers.id, legalName: customers.legalName })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId), sql`${customers.deletedAt} IS NULL`))
    .limit(1);
  return customer ?? null;
}

export function registerCustomerLoadingRoutes(app: Express) {
  app.get("/api/factory/customer-loading/products", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const customerId = parsePositiveId(req.query.customerId);
      if (!customerId) return res.status(400).json({ message: "Valid customerId is required" });

      const customer = await findScopedCustomer(companyId, customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const queryResult = await db.execute(sql`
        WITH customer_loaded_bales AS (
          SELECT DISTINCT ON (cob.bale_id)
            cob.bale_id,
            cob.order_id,
            COALESCE(cob.article_code, fb.article_code) AS article_code,
            COALESCE(cob.weight, fb.weight_kg) AS weight_kg,
            COALESCE(
              co.finalized_at,
              co.loading_finalized_at,
              co.verified_at,
              co.loading_started_at,
              co.updated_at,
              co.created_at
            ) AS loaded_at
          FROM customer_order_bales cob
          INNER JOIN customer_orders co
            ON co.id = cob.order_id
          LEFT JOIN factory_bales fb
            ON fb.id = cob.bale_id
           AND fb.company_id = co.company_id
          WHERE co.company_id = ${companyId}
            AND co.customer_id = ${customerId}
            AND co.deleted_at IS NULL
            AND co.status IN ('LOADING', 'PENDING_VERIFICATION', 'VERIFIED', 'FINALIZED')
            AND COALESCE(cob.article_code, fb.article_code) IS NOT NULL
            AND BTRIM(COALESCE(cob.article_code, fb.article_code)) <> ''
          ORDER BY
            cob.bale_id,
            COALESCE(
              co.finalized_at,
              co.loading_finalized_at,
              co.verified_at,
              co.loading_started_at,
              co.updated_at,
              co.created_at
            ) DESC,
            cob.id DESC
        ),
        loaded_by_article AS (
          SELECT
            UPPER(BTRIM(article_code)) AS article_key,
            COUNT(*)::integer AS total_bales_loaded,
            COALESCE(SUM(weight_kg::numeric), 0)::numeric AS total_kg_loaded,
            COUNT(DISTINCT order_id)::integer AS loading_count,
            MAX(loaded_at) AS last_loaded_at
          FROM customer_loaded_bales
          GROUP BY UPPER(BTRIM(article_code))
        )
        SELECT
          fbp.id,
          fbp.code,
          fbp.article_code AS "articleCode",
          fbp.name,
          fbp.name_ar AS "nameAr",
          fbp.category_id AS "categoryId",
          fc.name AS "categoryName",
          fc.name_ar AS "categoryNameAr",
          fbp.weight_per_bale_kg AS "weightPerBaleKg",
          fbp.selling_price AS "sellingPrice",
          fbp.production_price AS "productionPrice",
          fbp.active,
          COALESCE(lba.total_bales_loaded, 0)::integer AS "totalBalesLoaded",
          COALESCE(lba.total_kg_loaded, 0)::numeric AS "totalKgLoaded",
          COALESCE(lba.loading_count, 0)::integer AS "loadingCount",
          lba.last_loaded_at AS "lastLoadedAt"
        FROM factory_bale_products fbp
        LEFT JOIN factory_categories fc
          ON fc.id = fbp.category_id
         AND fc.company_id = fbp.company_id
         AND fc.deleted_at IS NULL
        LEFT JOIN loaded_by_article lba
          ON lba.article_key = UPPER(BTRIM(COALESCE(fbp.article_code, fbp.code)))
        WHERE fbp.company_id = ${companyId}
          AND fbp.deleted_at IS NULL
          AND fbp.active = true
        ORDER BY fbp.name ASC, fbp.id ASC
      `);

      const rawRows = resultRows(queryResult) as unknown as CustomerLoadingProductRow[];
      const products = rawRows.map((row) => {
        const totalBalesLoaded = asNumber(row.totalBalesLoaded);
        return {
          ...row,
          totalBalesLoaded,
          totalKgLoaded: asNumber(row.totalKgLoaded),
          loadingCount: asNumber(row.loadingCount),
          loadingStatus: totalBalesLoaded > 0 ? "LOADED" : "NEVER_LOADED",
        };
      });

      const loadedProducts = products.filter((product) => product.totalBalesLoaded > 0).length;
      const neverLoadedProducts = products.length - loadedProducts;
      const totalBalesLoaded = products.reduce((sum, product) => sum + product.totalBalesLoaded, 0);
      const totalKgLoaded = products.reduce((sum, product) => sum + product.totalKgLoaded, 0);

      return res.json({
        customer,
        definition: {
          loaded:
            "At least one bale in a LOADING, PENDING_VERIFICATION, VERIFIED, or FINALIZED invoice for this customer",
          cancelledOrdersExcluded: true,
          deletedOrdersExcluded: true,
          duplicateBalesCollapsed: true,
        },
        summary: {
          totalProducts: products.length,
          loadedProducts,
          neverLoadedProducts,
          productCoveragePct: products.length > 0 ? Number(((loadedProducts / products.length) * 100).toFixed(2)) : 0,
          totalBalesLoaded,
          totalKgLoaded,
        },
        products,
      });
    } catch (error: unknown) {
      logger.error("customer-loading products error", { error });
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/factory/customer-loading/history", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const customerId = parsePositiveId(req.query.customerId);
      const productId = parsePositiveId(req.query.productId);
      if (!customerId || !productId) {
        return res.status(400).json({ message: "Valid customerId and productId are required" });
      }

      const customer = await findScopedCustomer(companyId, customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const productResult = await db.execute(sql`
        SELECT id, code, article_code AS "articleCode", name
        FROM factory_bale_products
        WHERE id = ${productId} AND company_id = ${companyId} AND deleted_at IS NULL
        LIMIT 1
      `);
      const [product] = resultRows(productResult) as Array<{
        id: number;
        code: string;
        articleCode: string | null;
        name: string;
      }>;
      if (!product) return res.status(404).json({ message: "Product not found" });
      const articleCode = product.articleCode || product.code;

      const historyResult = await db.execute(sql`
        WITH deduped AS (
          SELECT DISTINCT ON (cob.bale_id)
            cob.bale_id,
            cob.order_id,
            cob.bale_reference,
            COALESCE(cob.weight, fb.weight_kg) AS weight_kg,
            COALESCE(
              co.finalized_at,
              co.loading_finalized_at,
              co.verified_at,
              co.loading_started_at,
              co.updated_at,
              co.created_at
            ) AS last_activity_at
          FROM customer_order_bales cob
          INNER JOIN customer_orders co
            ON co.id = cob.order_id
          LEFT JOIN factory_bales fb
            ON fb.id = cob.bale_id
           AND fb.company_id = co.company_id
          WHERE co.company_id = ${companyId}
            AND co.customer_id = ${customerId}
            AND co.deleted_at IS NULL
            AND co.status IN ('LOADING', 'PENDING_VERIFICATION', 'VERIFIED', 'FINALIZED')
            AND UPPER(BTRIM(COALESCE(cob.article_code, fb.article_code))) = UPPER(BTRIM(${articleCode}))
          ORDER BY cob.bale_id, COALESCE(co.updated_at, co.created_at) DESC, cob.id DESC
        )
        SELECT
          d.order_id AS "sessionId",
          d.order_id AS "invoiceId",
          co.status,
          co.container_number AS "truckNo",
          co.shipping_company AS "driverName",
          co.loading_started_at AS "startedAt",
          COALESCE(co.loading_finalized_at, co.finalized_at) AS "completedAt",
          COUNT(*)::integer AS "balesLoaded",
          COALESCE(SUM(d.weight_kg::numeric), 0)::numeric AS "kgLoaded",
          MAX(d.last_activity_at) AS "lastScanAt"
        FROM deduped d
        INNER JOIN customer_orders co
          ON co.id = d.order_id
         AND co.company_id = ${companyId}
        GROUP BY
          d.order_id,
          co.status,
          co.container_number,
          co.shipping_company,
          co.loading_started_at,
          co.loading_finalized_at,
          co.finalized_at
        ORDER BY MAX(d.last_activity_at) DESC
        LIMIT 100
      `);

      const history = (resultRows(historyResult) as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        balesLoaded: asNumber(row.balesLoaded),
        kgLoaded: asNumber(row.kgLoaded),
      }));

      return res.json({ customer, product, history });
    } catch (error: unknown) {
      logger.error("customer-loading history error", { error });
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
