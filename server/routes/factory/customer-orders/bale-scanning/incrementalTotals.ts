import { sql, type SQL } from "drizzle-orm";

import { resultRows } from "../../../../lib/queryResult";

/**
 * The only surface this helper needs from its connection. Typing it
 * structurally rather than as the concrete Drizzle database keeps both real
 * callers working — `db` and a transaction `tx` alike — without naming a
 * generic that would drag the whole schema in.
 */
type SqlExecutor = {
  execute: (query: SQL) => Promise<unknown>;
};

/**
 * The aggregate statement's result row. Every column is read through a `String`
 * or `Number` coercion below except `updated_at`, which is returned as-is, so
 * that one column is the only member worth naming a type for.
 */
type OrderTotalsRow = Record<string, unknown> & {
  updated_at?: Date | string | null;
};

export interface ScannedArticleTotalsPatch {
  line: {
    id: number;
    orderId: number;
    articleCode: string;
    baleName: string;
    qty: number;
    weightPerBale: string;
    totalWeight: string;
    pricePerBale: string;
    totalPrice: string;
    pricingMode: string;
    pricePerKg: string | null;
  } | null;
  totals: {
    subtotalBales: string;
    freightAmount: string;
    otherChargesTotal: string;
    grandTotal: string;
    totalQtyBales: number;
    updatedAt: Date | string | null;
  };
}

/**
 * Fast path for a single bale add.
 *
 * The legacy recalculateOrderTotals helper rebuilds every customer_order_lines
 * row one-by-one, which makes query count grow with the number of article groups.
 * A scan only changes one article. This helper therefore:
 *   1) serializes recalculation per order with a row lock,
 *   2) aggregates all bale groups in one SQL statement so per-kg pricing remains
 *      authoritative for every article,
 *   3) replaces only the affected customer_order_lines row,
 *   4) refreshes order totals and charges in the same statement, and
 *   5) returns the affected line + totals so the HTTP response needs no follow-up reads.
 *
 * Query cost is constant (two SQL statements) instead of O(article groups).
 */
export async function recalculateOrderTotalsForScannedArticle(
  dbConn: SqlExecutor,
  orderId: number,
  articleCode: string | null | undefined
): Promise<ScannedArticleTotalsPatch> {
  const normalizedArticleCode = String(articleCode || "UNKNOWN").trim() || "UNKNOWN";

  // Serialize total updates for the same order. The aggregate statement below is
  // intentionally separate so, after waiting for this lock, PostgreSQL takes a
  // fresh READ COMMITTED snapshot that includes any scan which committed first.
  await dbConn.execute(sql`
    SELECT id
    FROM customer_orders
    WHERE id = ${orderId}
    FOR UPDATE
  `);

  const result = await dbConn.execute(sql`
    WITH bale_groups AS (
      SELECT
        COALESCE(NULLIF(cob.article_code, ''), 'UNKNOWN') AS article_code,
        COUNT(*)::int AS qty,
        COALESCE(SUM(cob.weight), 0)::numeric AS total_weight,
        COALESCE(SUM(cob.price_used), 0)::numeric AS summed_price,
        COALESCE(MAX(NULLIF(cob.bale_name, '')), COALESCE(NULLIF(cob.article_code, ''), 'UNKNOWN')) AS bale_name
      FROM customer_order_bales cob
      WHERE cob.order_id = ${orderId}
      GROUP BY COALESCE(NULLIF(cob.article_code, ''), 'UNKNOWN')
    ),
    priced_groups AS (
      SELECT
        bg.article_code,
        bg.qty,
        bg.total_weight,
        bg.bale_name,
        COALESCE(cpl.pricing_mode, 'per_bale') AS pricing_mode,
        cpl.price_per_kg,
        CASE
          WHEN COALESCE(cpl.pricing_mode, 'per_bale') = 'per_kg'
            AND COALESCE(cpl.price_per_kg, 0) > 0
            AND bg.total_weight > 0
          THEN bg.total_weight * cpl.price_per_kg
          ELSE bg.summed_price
        END::numeric AS total_price
      FROM bale_groups bg
      JOIN customer_orders co ON co.id = ${orderId}
      LEFT JOIN LATERAL (
        SELECT cpl.pricing_mode, cpl.price_per_kg
        FROM customer_proforma_lines cpl
        WHERE cpl.proforma_id = co.proforma_id_used
          AND cpl.article_code = bg.article_code
        ORDER BY cpl.id DESC
        LIMIT 1
      ) cpl ON TRUE
    ),
    target_line AS (
      SELECT *
      FROM priced_groups
      WHERE article_code = ${normalizedArticleCode}
      LIMIT 1
    ),
    deleted_target AS (
      DELETE FROM customer_order_lines
      WHERE order_id = ${orderId}
        AND article_code = ${normalizedArticleCode}
      RETURNING id
    ),
    inserted_target AS (
      INSERT INTO customer_order_lines (
        order_id,
        article_code,
        bale_name,
        qty,
        weight_per_bale,
        total_weight,
        price_per_bale,
        total_price,
        pricing_mode,
        price_per_kg
      )
      SELECT
        ${orderId},
        tl.article_code,
        tl.bale_name,
        tl.qty,
        CASE WHEN tl.qty > 0 THEN tl.total_weight / tl.qty ELSE 0 END,
        tl.total_weight,
        CASE WHEN tl.qty > 0 THEN tl.total_price / tl.qty ELSE 0 END,
        tl.total_price,
        tl.pricing_mode,
        tl.price_per_kg
      FROM target_line tl
      WHERE tl.qty > 0
      RETURNING
        id,
        order_id,
        article_code,
        bale_name,
        qty,
        weight_per_bale,
        total_weight,
        price_per_bale,
        total_price,
        pricing_mode,
        price_per_kg
    ),
    order_totals AS (
      SELECT
        COALESCE(SUM(pg.total_price), 0)::numeric AS subtotal_bales,
        COALESCE(SUM(pg.qty), 0)::int AS total_qty_bales
      FROM priced_groups pg
    ),
    charges AS (
      SELECT
        COALESCE(SUM(coc.amount) FILTER (WHERE coc.charge_type = 'FREIGHT'), 0)::numeric AS freight_amount,
        COALESCE(SUM(coc.amount) FILTER (WHERE coc.charge_type = 'OTHER'), 0)::numeric AS other_charges_total
      FROM customer_order_charges coc
      WHERE coc.order_id = ${orderId}
    ),
    updated_order AS (
      UPDATE customer_orders co
      SET
        subtotal_bales = ot.subtotal_bales,
        freight_amount = ch.freight_amount,
        other_charges_total = ch.other_charges_total,
        grand_total = ot.subtotal_bales + ch.freight_amount + ch.other_charges_total,
        total_qty_bales = ot.total_qty_bales,
        updated_at = NOW()
      FROM order_totals ot, charges ch
      WHERE co.id = ${orderId}
      RETURNING
        co.subtotal_bales,
        co.freight_amount,
        co.other_charges_total,
        co.grand_total,
        co.total_qty_bales,
        co.updated_at
    )
    SELECT
      uo.subtotal_bales,
      uo.freight_amount,
      uo.other_charges_total,
      uo.grand_total,
      uo.total_qty_bales,
      uo.updated_at,
      it.id AS line_id,
      it.order_id AS line_order_id,
      it.article_code AS line_article_code,
      it.bale_name AS line_bale_name,
      it.qty AS line_qty,
      it.weight_per_bale AS line_weight_per_bale,
      it.total_weight AS line_total_weight,
      it.price_per_bale AS line_price_per_bale,
      it.total_price AS line_total_price,
      it.pricing_mode AS line_pricing_mode,
      it.price_per_kg AS line_price_per_kg
    FROM updated_order uo
    LEFT JOIN inserted_target it ON TRUE
  `);

  const row: OrderTotalsRow = resultRows<OrderTotalsRow>(result)[0] || {};

  return {
    line:
      row.line_id == null
        ? null
        : {
            id: Number(row.line_id),
            orderId: Number(row.line_order_id),
            articleCode: String(row.line_article_code || normalizedArticleCode),
            baleName: String(row.line_bale_name || row.line_article_code || normalizedArticleCode),
            qty: Number(row.line_qty || 0),
            weightPerBale: String(row.line_weight_per_bale ?? "0"),
            totalWeight: String(row.line_total_weight ?? "0"),
            pricePerBale: String(row.line_price_per_bale ?? "0"),
            totalPrice: String(row.line_total_price ?? "0"),
            pricingMode: String(row.line_pricing_mode || "per_bale"),
            pricePerKg: row.line_price_per_kg == null ? null : String(row.line_price_per_kg),
          },
    totals: {
      subtotalBales: String(row.subtotal_bales ?? "0"),
      freightAmount: String(row.freight_amount ?? "0"),
      otherChargesTotal: String(row.other_charges_total ?? "0"),
      grandTotal: String(row.grand_total ?? "0"),
      totalQtyBales: Number(row.total_qty_bales || 0),
      updatedAt: row.updated_at ?? null,
    },
  };
}
