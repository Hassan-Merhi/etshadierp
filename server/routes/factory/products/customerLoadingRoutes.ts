/**
 * Customer loading intelligence foundation.
 *
 * A product is considered "loaded" for a customer when at least one bale for
 * that article has been scanned into a non-cancelled invoice loading session.
 * Cancelled sessions are intentionally excluded so abandoned/reversed loading
 * work never becomes customer purchase history.
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

export function registerCustomerLoadingRoutes(app: Express) {
  app.get("/api/factory/customer-loading/products", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const customerId = parsePositiveId(req.query.customerId);
      if (!customerId) return res.status(400).json({ message: "Valid customerId is required" });

      const [customer] = await db
        .select({ id: customers.id, legalName: customers.legalName })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
        .limit(1);

      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const queryResult = await db.execute(sql`
        WITH customer_loaded_bales AS (
          SELECT DISTINCT ON (filb.bale_id)
            filb.bale_id,
            filb.session_id,
            COALESCE(filb.article_code, fb.article_code) AS article_code,
            filb.weight_kg,
            filb.scanned_at
          FROM factory_invoice_loading_bales filb
          INNER JOIN factory_invoice_loading_sessions fils
            ON fils.id = filb.session_id
           AND fils.company_id = filb.company_id
          LEFT JOIN factory_bales fb
            ON fb.id = filb.bale_id
           AND fb.company_id = filb.company_id
          WHERE filb.company_id = ${companyId}
            AND fils.customer_id = ${customerId}
            AND fils.status <> 'CANCELLED'
            AND COALESCE(filb.article_code, fb.article_code) IS NOT NULL
            AND BTRIM(COALESCE(filb.article_code, fb.article_code)) <> ''
          ORDER BY filb.bale_id, filb.scanned_at DESC, filb.id DESC
        ),
        loaded_by_article AS (
          SELECT
            UPPER(BTRIM(article_code)) AS article_key,
            COUNT(*)::integer AS total_bales_loaded,
            COALESCE(SUM(weight_kg::numeric), 0)::numeric AS total_kg_loaded,
            COUNT(DISTINCT session_id)::integer AS loading_count,
            MAX(scanned_at) AS last_loaded_at
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
          ON lba.article_key = UPPER(BTRIM(fbp.article_code))
        WHERE fbp.company_id = ${companyId}
          AND fbp.deleted_at IS NULL
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
          loaded: "At least one bale scanned into a non-cancelled invoice loading session for this customer",
          cancelledSessionsExcluded: true,
          duplicateScansCollapsedByBale: true,
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
}
