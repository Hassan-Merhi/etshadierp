import { sql } from "drizzle-orm";
import { db } from "../../db";
import { resultRows } from "../../lib/queryResult";
import {
  buildAuthoritativeStockSnapshot,
  type AuthoritativeStockAggregate,
  type AuthoritativeStockSnapshot,
} from "./authoritativeStockPatch";

interface StockRow extends Record<string, unknown> {
  productId: number | null;
  articleCode: string | null;
  baleCount: number | string | null;
  totalWeight: number | string | null;
}

export async function getAuthoritativeAvailableStockSnapshot(
  companyId: number,
  locationId: number | null
): Promise<AuthoritativeStockSnapshot> {
  const locationFilter = locationId != null ? sql`AND fb.erp_location_id = ${locationId}` : sql``;

  const raw = await db.execute(sql`
    SELECT
      fb.product_id AS "productId",
      COALESCE(
        NULLIF(BTRIM(fbp.article_code), ''),
        NULLIF(BTRIM(fb.article_code), ''),
        NULLIF(BTRIM(fb.bale_code), '')
      ) AS "articleCode",
      COUNT(*)::int AS "baleCount",
      COALESCE(SUM(fb.weight_kg::numeric), 0) AS "totalWeight"
    FROM factory_bales fb
    LEFT JOIN factory_bale_products fbp
      ON fbp.id = fb.product_id
     AND fbp.company_id = fb.company_id
    WHERE fb.company_id = ${companyId}
      AND fb.status = 'IN_STOCK'
      AND fb.deleted_at IS NULL
      ${locationFilter}
      AND NOT EXISTS (
        SELECT 1
        FROM customer_order_bales cob
        INNER JOIN customer_orders co ON co.id = cob.order_id
        WHERE cob.bale_id = fb.id
          AND co.company_id = ${companyId}
          AND co.deleted_at IS NULL
          AND co.status IN (
            'LOADING',
            'PENDING_VERIFICATION',
            'VERIFIED',
            'FINALIZED',
            'DISPATCHED',
            'SOLD'
          )
      )
    GROUP BY
      fb.product_id,
      COALESCE(
        NULLIF(BTRIM(fbp.article_code), ''),
        NULLIF(BTRIM(fb.article_code), ''),
        NULLIF(BTRIM(fb.bale_code), '')
      )
  `);

  const rows = resultRows<StockRow>(raw).map<AuthoritativeStockAggregate>((row) => ({
    productId: row.productId == null ? null : Number(row.productId),
    articleCode: String(row.articleCode ?? ""),
    baleCount: Number(row.baleCount ?? 0),
    totalWeight: Number(row.totalWeight ?? 0),
  }));

  return buildAuthoritativeStockSnapshot(rows);
}
