import { sql } from "drizzle-orm";
import { db } from "../db";

export interface FactoryBilingualSnapshotTarget {
  table: string;
  arabicColumn: string;
  englishColumn: string;
  companyExpression: string;
  productIdExpression?: string;
  articleCodeExpression?: string;
  finalizedExpression?: string;
}

export interface FactoryBilingualSnapshotPlanRow {
  table: string;
  arabicColumn: string;
  missing: number;
  resolvable: number;
  orphaned: number;
  finalized: number;
}

export interface FactoryBilingualSnapshotPlan {
  companyId: number;
  totals: {
    missing: number;
    resolvable: number;
    orphaned: number;
    finalized: number;
  };
  targets: FactoryBilingualSnapshotPlanRow[];
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Every Phase 2 Arabic snapshot is repaired through this single map. Company
 * ownership is resolved from the row itself or its parent order/proforma.
 * Product identity is product ID first, then normalized exact article code.
 */
export const FACTORY_BILINGUAL_SNAPSHOT_TARGETS: FactoryBilingualSnapshotTarget[] = [
  {
    table: "factory_bales",
    arabicColumn: "product_name_ar",
    englishColumn: "product_name",
    companyExpression: "t.company_id",
    productIdExpression: "t.product_id",
    articleCodeExpression: "t.article_code",
    finalizedExpression: "t.finalized_at IS NOT NULL OR t.status IN ('FINALIZED','SOLD','DISPATCHED')",
  },
  {
    table: "customer_proforma_lines",
    arabicColumn: "product_name_ar",
    englishColumn: "product_name",
    companyExpression: "(SELECT p.company_id FROM customer_proformas p WHERE p.id = t.proforma_id)",
    articleCodeExpression: "t.article_code",
    finalizedExpression: "false",
  },
  {
    table: "customer_order_lines",
    arabicColumn: "bale_name_ar",
    englishColumn: "bale_name",
    companyExpression: "(SELECT o.company_id FROM customer_orders o WHERE o.id = t.order_id)",
    articleCodeExpression: "t.article_code",
    finalizedExpression: "EXISTS (SELECT 1 FROM customer_orders o WHERE o.id=t.order_id AND o.status IN ('FINALIZED','INVOICED','COMPLETED','CANCELLED'))",
  },
  {
    table: "customer_order_bales",
    arabicColumn: "bale_name_ar",
    englishColumn: "bale_name",
    companyExpression: "(SELECT o.company_id FROM customer_orders o WHERE o.id = t.order_id)",
    productIdExpression: "(SELECT b.product_id FROM factory_bales b WHERE b.id=t.bale_id)",
    articleCodeExpression: "COALESCE(t.article_code,(SELECT b.article_code FROM factory_bales b WHERE b.id=t.bale_id))",
    finalizedExpression: "EXISTS (SELECT 1 FROM customer_orders o WHERE o.id=t.order_id AND o.status IN ('FINALIZED','INVOICED','COMPLETED','CANCELLED'))",
  },
  {
    table: "customer_order_bales_history",
    arabicColumn: "bale_name_ar",
    englishColumn: "bale_name",
    companyExpression: "(SELECT o.company_id FROM customer_orders o WHERE o.id = t.order_id)",
    productIdExpression: "(SELECT b.product_id FROM factory_bales b WHERE b.id=t.bale_id)",
    articleCodeExpression: "COALESCE(t.article_code,(SELECT b.article_code FROM factory_bales b WHERE b.id=t.bale_id))",
    finalizedExpression: "true",
  },
  {
    table: "customer_order_expected_lines",
    arabicColumn: "product_name_ar",
    englishColumn: "product_name",
    companyExpression: "t.company_id",
    articleCodeExpression: "t.article_code",
    finalizedExpression: "EXISTS (SELECT 1 FROM customer_orders o WHERE o.id=t.order_id AND o.status IN ('FINALIZED','INVOICED','COMPLETED','CANCELLED'))",
  },
  {
    table: "factory_pos_sale_items",
    arabicColumn: "product_name_ar",
    englishColumn: "product_name",
    companyExpression: "(SELECT s.company_id FROM factory_pos_sales s WHERE s.id=t.sale_id)",
    productIdExpression: "t.product_id",
    articleCodeExpression: "t.article_code",
    finalizedExpression: "true",
  },
  {
    table: "customer_order_bale_removals",
    arabicColumn: "product_name_ar",
    englishColumn: "product_name",
    companyExpression: "(SELECT o.company_id FROM customer_orders o WHERE o.id=t.order_id)",
    productIdExpression: "(SELECT b.product_id FROM factory_bales b WHERE b.id=t.bale_id)",
    articleCodeExpression: "COALESCE(t.article_code,(SELECT b.article_code FROM factory_bales b WHERE b.id=t.bale_id))",
    finalizedExpression: "true",
  },
  {
    table: "factory_v3_load_bales",
    arabicColumn: "product_name_ar",
    englishColumn: "product_name",
    companyExpression: "(SELECT l.company_id FROM factory_v3_loads l WHERE l.id=t.load_id)",
    productIdExpression: "(SELECT b.product_id FROM factory_bales b WHERE b.id=t.bale_id)",
    articleCodeExpression: "COALESCE(t.article_code,(SELECT b.article_code FROM factory_bales b WHERE b.id=t.bale_id))",
    finalizedExpression: "false",
  },
  {
    table: "factory_invoice_loading_bales",
    arabicColumn: "product_name_ar",
    englishColumn: "product_name",
    companyExpression: "(SELECT l.company_id FROM factory_invoice_loadings l WHERE l.id=t.loading_id)",
    productIdExpression: "(SELECT b.product_id FROM factory_bales b WHERE b.id=t.bale_id)",
    articleCodeExpression: "COALESCE(t.article_code,(SELECT b.article_code FROM factory_bales b WHERE b.id=t.bale_id))",
    finalizedExpression: "false",
  },
  {
    table: "customer_dispatch_bale_scans",
    arabicColumn: "product_name_ar",
    englishColumn: "product_name",
    companyExpression: "(SELECT d.company_id FROM customer_dispatch_batches d WHERE d.id=t.batch_id)",
    productIdExpression: "(SELECT b.product_id FROM factory_bales b WHERE b.id=t.bale_id)",
    articleCodeExpression: "COALESCE(t.article_code,(SELECT b.article_code FROM factory_bales b WHERE b.id=t.bale_id))",
    finalizedExpression: "false",
  },
  {
    table: "bale_recode_items",
    arabicColumn: "product_name_ar",
    englishColumn: "product_name",
    companyExpression: "(SELECT s.company_id FROM bale_recode_sessions s WHERE s.id=t.session_id)",
    productIdExpression: "t.product_id",
    articleCodeExpression: "t.article_code",
    finalizedExpression: "true",
  },
];

function assertIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return value;
}

async function targetExists(target: FactoryBilingualSnapshotTarget, executor: typeof db = db): Promise<boolean> {
  const result = await executor.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name=${target.table}
        AND column_name=${target.arabicColumn}
    ) AS present
  `);
  return Boolean((result.rows[0] as { present?: boolean } | undefined)?.present);
}

function resolverSql(target: FactoryBilingualSnapshotTarget): string {
  const productId = target.productIdExpression ?? "NULL";
  const articleCode = target.articleCodeExpression ?? "NULL";
  return `
    SELECT p.id, p.name_ar, c.name_ar AS category_name_ar
    FROM factory_bale_products p
    LEFT JOIN factory_categories c
      ON c.id=p.category_id AND c.company_id=p.company_id AND c.deleted_at IS NULL
    WHERE p.company_id=(${target.companyExpression})
      AND p.deleted_at IS NULL
      AND (
        ((${productId}) IS NOT NULL AND p.id=(${productId}))
        OR (
          (${productId}) IS NULL
          AND (${articleCode}) IS NOT NULL
          AND UPPER(BTRIM(p.article_code))=UPPER(BTRIM((${articleCode})::text))
        )
      )
    ORDER BY CASE WHEN p.id=(${productId}) THEN 0 ELSE 1 END
    LIMIT 1
  `;
}

export async function buildFactoryBilingualSnapshotPlan(
  companyId: number,
  executor: typeof db = db
): Promise<FactoryBilingualSnapshotPlan> {
  const targets: FactoryBilingualSnapshotPlanRow[] = [];

  for (const target of FACTORY_BILINGUAL_SNAPSHOT_TARGETS) {
    if (!(await targetExists(target, executor))) continue;
    const table = assertIdentifier(target.table);
    const ar = assertIdentifier(target.arabicColumn);
    const finalized = target.finalizedExpression ?? "false";
    const query = `
      SELECT
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(t.${ar}), '') IS NULL)::int AS missing,
        COUNT(*) FILTER (
          WHERE NULLIF(BTRIM(t.${ar}), '') IS NULL AND r.id IS NOT NULL AND NULLIF(BTRIM(r.name_ar), '') IS NOT NULL
        )::int AS resolvable,
        COUNT(*) FILTER (
          WHERE NULLIF(BTRIM(t.${ar}), '') IS NULL AND (r.id IS NULL OR NULLIF(BTRIM(r.name_ar), '') IS NULL)
        )::int AS orphaned,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(t.${ar}), '') IS NULL AND (${finalized}))::int AS finalized
      FROM ${table} t
      LEFT JOIN LATERAL (${resolverSql(target)}) r ON true
      WHERE (${target.companyExpression})=$1
    `;
    const result = await executor.execute(sql.raw(query.replace("$1", String(Number(companyId)))));
    const row = (result.rows[0] ?? {}) as Record<string, number>;
    targets.push({
      table,
      arabicColumn: ar,
      missing: Number(row.missing ?? 0),
      resolvable: Number(row.resolvable ?? 0),
      orphaned: Number(row.orphaned ?? 0),
      finalized: Number(row.finalized ?? 0),
    });
  }

  return {
    companyId,
    totals: targets.reduce(
      (sum, target) => ({
        missing: sum.missing + target.missing,
        resolvable: sum.resolvable + target.resolvable,
        orphaned: sum.orphaned + target.orphaned,
        finalized: sum.finalized + target.finalized,
      }),
      { missing: 0, resolvable: 0, orphaned: 0, finalized: 0 }
    ),
    targets,
  };
}

export async function applyFactoryBilingualSnapshotBackfill(
  companyId: number,
  options: { overwrite?: boolean; includeFinalized?: boolean } = {},
  executor: typeof db = db
): Promise<{ updated: number; byTable: Record<string, number> }> {
  let updated = 0;
  const byTable: Record<string, number> = {};

  for (const target of FACTORY_BILINGUAL_SNAPSHOT_TARGETS) {
    if (!(await targetExists(target, executor))) continue;
    const table = assertIdentifier(target.table);
    const ar = assertIdentifier(target.arabicColumn);
    const finalized = target.finalizedExpression ?? "false";
    const missingOnly = options.overwrite ? "true" : `NULLIF(BTRIM(t.${ar}), '') IS NULL`;
    const finalizedGuard = options.includeFinalized ? "true" : `NOT (${finalized})`;
    const setCategory = table === "factory_bales" ? ", category_ar=r.category_name_ar" : "";
    const query = `
      UPDATE ${table} t
      SET ${ar}=r.name_ar${setCategory}
      FROM LATERAL (${resolverSql(target)}) r
      WHERE (${target.companyExpression})=${Number(companyId)}
        AND ${missingOnly}
        AND ${finalizedGuard}
        AND NULLIF(BTRIM(r.name_ar), '') IS NOT NULL
    `;
    const result = await executor.execute(sql.raw(query));
    const count = Number(result.rowCount ?? 0);
    byTable[table] = count;
    updated += count;
  }

  return { updated, byTable };
}

/** Update only live/current snapshots after a catalog Arabic edit. Finalized rows remain immutable. */
export async function propagateFactoryArabicCatalogChange(
  companyId: number,
  productId: number,
  executor: typeof db = db
): Promise<{ updated: number; byTable: Record<string, number> }> {
  let updated = 0;
  const byTable: Record<string, number> = {};

  for (const target of FACTORY_BILINGUAL_SNAPSHOT_TARGETS) {
    if (!(await targetExists(target, executor))) continue;
    const table = assertIdentifier(target.table);
    const ar = assertIdentifier(target.arabicColumn);
    const finalized = target.finalizedExpression ?? "false";
    const setCategory = table === "factory_bales" ? ", category_ar=r.category_name_ar" : "";
    const query = `
      UPDATE ${table} t
      SET ${ar}=r.name_ar${setCategory}
      FROM LATERAL (${resolverSql(target)}) r
      WHERE (${target.companyExpression})=${Number(companyId)}
        AND NOT (${finalized})
        AND r.id=${Number(productId)}
        AND NULLIF(BTRIM(r.name_ar), '') IS NOT NULL
    `;
    const result = await executor.execute(sql.raw(query));
    const count = Number(result.rowCount ?? 0);
    byTable[table] = count;
    updated += count;
  }

  return { updated, byTable };
}
