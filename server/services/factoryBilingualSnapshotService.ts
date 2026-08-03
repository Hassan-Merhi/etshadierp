import { sql } from "drizzle-orm";
import { db } from "../db";

export interface FactoryBilingualSnapshotTarget {
  table: string;
  arabicColumn: string;
  englishColumn: string;
  companyExpression: string;
  productIdExpression: string;
  articleCodeExpression: string;
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
  totals: { missing: number; resolvable: number; orphaned: number; finalized: number };
  targets: FactoryBilingualSnapshotPlanRow[];
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const SQL_RELATION_REFERENCE = /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)\b/gi;

const target = (
  value: Omit<FactoryBilingualSnapshotTarget, "productIdExpression" | "articleCodeExpression"> &
    Partial<Pick<FactoryBilingualSnapshotTarget, "productIdExpression" | "articleCodeExpression">>,
): FactoryBilingualSnapshotTarget => ({
  productIdExpression: "NULL",
  articleCodeExpression: "NULL",
  ...value,
});

export const FACTORY_BILINGUAL_SNAPSHOT_TARGETS: FactoryBilingualSnapshotTarget[] = [
  target({ table: "factory_bales", arabicColumn: "product_name_ar", englishColumn: "product_name", companyExpression: "t.company_id", productIdExpression: "t.product_id", articleCodeExpression: "t.article_code", finalizedExpression: "t.finalized_at IS NOT NULL OR t.status IN ('FINALIZED','SOLD','DISPATCHED')" }),
  target({ table: "customer_proforma_lines", arabicColumn: "product_name_ar", englishColumn: "product_name", companyExpression: "(SELECT p.company_id FROM customer_proformas p WHERE p.id=t.proforma_id)", articleCodeExpression: "t.article_code", finalizedExpression: "false" }),
  target({ table: "customer_order_lines", arabicColumn: "bale_name_ar", englishColumn: "bale_name", companyExpression: "(SELECT o.company_id FROM customer_orders o WHERE o.id=t.order_id)", articleCodeExpression: "t.article_code", finalizedExpression: "EXISTS (SELECT 1 FROM customer_orders o WHERE o.id=t.order_id AND o.status IN ('FINALIZED','INVOICED','COMPLETED','CANCELLED'))" }),
  target({ table: "customer_order_bales", arabicColumn: "bale_name_ar", englishColumn: "bale_name", companyExpression: "(SELECT o.company_id FROM customer_orders o WHERE o.id=t.order_id)", productIdExpression: "(SELECT b.product_id FROM factory_bales b WHERE b.id=t.bale_id)", articleCodeExpression: "COALESCE(t.article_code,(SELECT b.article_code FROM factory_bales b WHERE b.id=t.bale_id))", finalizedExpression: "EXISTS (SELECT 1 FROM customer_orders o WHERE o.id=t.order_id AND o.status IN ('FINALIZED','INVOICED','COMPLETED','CANCELLED'))" }),
  target({ table: "customer_order_bales_history", arabicColumn: "bale_name_ar", englishColumn: "bale_name", companyExpression: "(SELECT o.company_id FROM customer_orders o WHERE o.id=t.order_id)", productIdExpression: "(SELECT b.product_id FROM factory_bales b WHERE b.id=t.bale_id)", articleCodeExpression: "COALESCE(t.article_code,(SELECT b.article_code FROM factory_bales b WHERE b.id=t.bale_id))", finalizedExpression: "true" }),
  target({ table: "customer_order_expected_lines", arabicColumn: "product_name_ar", englishColumn: "product_name", companyExpression: "t.company_id", articleCodeExpression: "t.article_code", finalizedExpression: "EXISTS (SELECT 1 FROM customer_orders o WHERE o.id=t.order_id AND o.status IN ('FINALIZED','INVOICED','COMPLETED','CANCELLED'))" }),
  target({ table: "factory_pos_sale_items", arabicColumn: "product_name_ar", englishColumn: "product_name", companyExpression: "(SELECT s.company_id FROM factory_pos_sales s WHERE s.id=t.sale_id)", productIdExpression: "t.product_id", articleCodeExpression: "t.article_code", finalizedExpression: "true" }),
  target({ table: "customer_order_bale_removals", arabicColumn: "product_name_ar", englishColumn: "product_name", companyExpression: "(SELECT o.company_id FROM customer_orders o WHERE o.id=t.order_id)", productIdExpression: "(SELECT b.product_id FROM factory_bales b WHERE b.id=t.bale_id)", articleCodeExpression: "COALESCE(t.article_code,(SELECT b.article_code FROM factory_bales b WHERE b.id=t.bale_id))", finalizedExpression: "true" }),
  target({ table: "factory_v3_load_bales", arabicColumn: "product_name_ar", englishColumn: "product_name", companyExpression: "(SELECT l.company_id FROM factory_v3_loads l WHERE l.id=t.load_id)", productIdExpression: "(SELECT b.product_id FROM factory_bales b WHERE b.id=t.bale_id)", articleCodeExpression: "COALESCE(t.article_code,(SELECT b.article_code FROM factory_bales b WHERE b.id=t.bale_id))", finalizedExpression: "false" }),
  target({ table: "factory_invoice_loading_bales", arabicColumn: "product_name_ar", englishColumn: "product_name", companyExpression: "(SELECT l.company_id FROM factory_invoice_loadings l WHERE l.id=t.loading_id)", productIdExpression: "(SELECT b.product_id FROM factory_bales b WHERE b.id=t.bale_id)", articleCodeExpression: "COALESCE(t.article_code,(SELECT b.article_code FROM factory_bales b WHERE b.id=t.bale_id))", finalizedExpression: "false" }),
  target({ table: "customer_dispatch_bale_scans", arabicColumn: "product_name_ar", englishColumn: "product_name", companyExpression: "(SELECT d.company_id FROM customer_dispatch_batches d WHERE d.id=t.batch_id)", productIdExpression: "(SELECT b.product_id FROM factory_bales b WHERE b.id=t.bale_id)", articleCodeExpression: "COALESCE(t.article_code,(SELECT b.article_code FROM factory_bales b WHERE b.id=t.bale_id))", finalizedExpression: "false" }),
  target({ table: "bale_recode_items", arabicColumn: "product_name_ar", englishColumn: "product_name", companyExpression: "(SELECT s.company_id FROM bale_recode_sessions s WHERE s.id=t.session_id)", productIdExpression: "t.product_id", articleCodeExpression: "t.article_code", finalizedExpression: "true" }),
];

function assertIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return value;
}

function referencedTables(item: FactoryBilingualSnapshotTarget): string[] {
  const relations = new Set<string>([item.table, "factory_bale_products", "factory_categories"]);
  const expressions = [
    item.companyExpression,
    item.productIdExpression,
    item.articleCodeExpression,
    item.finalizedExpression ?? "",
  ];

  for (const expression of expressions) {
    SQL_RELATION_REFERENCE.lastIndex = 0;
    for (let match = SQL_RELATION_REFERENCE.exec(expression); match; match = SQL_RELATION_REFERENCE.exec(expression)) {
      relations.add(assertIdentifier(match[1]));
    }
  }

  return [...relations];
}

async function targetExists(item: FactoryBilingualSnapshotTarget, executor: typeof db = db): Promise<boolean> {
  const relations = referencedTables(item);

  try {
    const columnResult = await executor.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ${item.table}
          AND column_name = ${item.arabicColumn}
      ) AS column_exists
    `);

    const columnExists = Boolean(
      (columnResult.rows[0] as { column_exists?: boolean } | undefined)?.column_exists,
    );
    if (!columnExists) return false;

    for (const relation of relations) {
      const tableResult = await executor.execute(sql`
        SELECT to_regclass(${`public.${relation}`}) IS NOT NULL AS table_exists
      `);
      const tableExists = Boolean(
        (tableResult.rows[0] as { table_exists?: boolean } | undefined)?.table_exists,
      );
      if (!tableExists) return false;
    }

    return true;
  } catch (error) {
    console.error("Factory bilingual schema check failed", {
      table: item.table,
      arabicColumn: item.arabicColumn,
      dependencies: relations,
      error,
    });
    return false;
  }
}

function resolverSql(item: FactoryBilingualSnapshotTarget): string {
  const productId = item.productIdExpression;
  const articleCode = item.articleCodeExpression;
  return `
    SELECT p.id, p.name_ar, c.name_ar AS category_name_ar
    FROM factory_bale_products p
    LEFT JOIN factory_categories c
      ON c.id=p.category_id AND c.company_id=p.company_id AND c.deleted_at IS NULL
    WHERE p.company_id=(${item.companyExpression})
      AND p.deleted_at IS NULL
      AND (
        ((${productId}) IS NOT NULL AND p.id=(${productId}))
        OR ((${productId}) IS NULL AND (${articleCode}) IS NOT NULL
          AND UPPER(BTRIM(p.article_code))=UPPER(BTRIM((${articleCode})::text)))
      )
    ORDER BY CASE WHEN p.id=(${productId}) THEN 0 ELSE 1 END
    LIMIT 1
  `;
}

function scalarResolver(item: FactoryBilingualSnapshotTarget, column: "name_ar" | "category_name_ar" | "id"): string {
  return `(SELECT r.${column} FROM LATERAL (${resolverSql(item)}) r)`;
}

export async function buildFactoryBilingualSnapshotPlan(companyId: number, executor: typeof db = db): Promise<FactoryBilingualSnapshotPlan> {
  const targets: FactoryBilingualSnapshotPlanRow[] = [];
  for (const item of FACTORY_BILINGUAL_SNAPSHOT_TARGETS) {
    if (!(await targetExists(item, executor))) continue;
    const table = assertIdentifier(item.table);
    const ar = assertIdentifier(item.arabicColumn);
    const finalized = item.finalizedExpression ?? "false";
    const query = `
      SELECT
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(t.${ar}), '') IS NULL)::int AS missing,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(t.${ar}), '') IS NULL AND r.id IS NOT NULL AND NULLIF(BTRIM(r.name_ar), '') IS NOT NULL)::int AS resolvable,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(t.${ar}), '') IS NULL AND (r.id IS NULL OR NULLIF(BTRIM(r.name_ar), '') IS NULL))::int AS orphaned,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(t.${ar}), '') IS NULL AND (${finalized}))::int AS finalized
      FROM ${table} t
      LEFT JOIN LATERAL (${resolverSql(item)}) r ON true
      WHERE (${item.companyExpression})=${Number(companyId)}
    `;
    const result = await executor.execute(sql.raw(query));
    const row = (result.rows[0] ?? {}) as Record<string, number>;
    targets.push({ table, arabicColumn: ar, missing: Number(row.missing ?? 0), resolvable: Number(row.resolvable ?? 0), orphaned: Number(row.orphaned ?? 0), finalized: Number(row.finalized ?? 0) });
  }
  return {
    companyId,
    totals: targets.reduce((sum, row) => ({ missing: sum.missing + row.missing, resolvable: sum.resolvable + row.resolvable, orphaned: sum.orphaned + row.orphaned, finalized: sum.finalized + row.finalized }), { missing: 0, resolvable: 0, orphaned: 0, finalized: 0 }),
    targets,
  };
}

async function applyTargets(companyId: number, options: { overwrite?: boolean; includeFinalized?: boolean; productId?: number } = {}, executor: typeof db = db): Promise<{ updated: number; byTable: Record<string, number> }> {
  let updated = 0;
  const byTable: Record<string, number> = {};
  for (const item of FACTORY_BILINGUAL_SNAPSHOT_TARGETS) {
    if (!(await targetExists(item, executor))) continue;
    const table = assertIdentifier(item.table);
    const ar = assertIdentifier(item.arabicColumn);
    const finalized = item.finalizedExpression ?? "false";
    const nameValue = scalarResolver(item, "name_ar");
    const categoryValue = scalarResolver(item, "category_name_ar");
    const resolvedId = scalarResolver(item, "id");
    const setCategory = table === "factory_bales" ? `, category_ar=${categoryValue}` : "";
    const missingGuard = options.overwrite ? "true" : `NULLIF(BTRIM(t.${ar}), '') IS NULL`;
    const finalizedGuard = options.includeFinalized ? "true" : `NOT (${finalized})`;
    const productGuard = options.productId ? `${resolvedId}=${Number(options.productId)}` : "true";
    const query = `
      UPDATE ${table} t
      SET ${ar}=${nameValue}${setCategory}
      WHERE (${item.companyExpression})=${Number(companyId)}
        AND ${missingGuard}
        AND ${finalizedGuard}
        AND ${productGuard}
        AND NULLIF(BTRIM(${nameValue}), '') IS NOT NULL
    `;
    const result = await executor.execute(sql.raw(query));
    const count = Number(result.rowCount ?? 0);
    byTable[table] = count;
    updated += count;
  }
  return { updated, byTable };
}

export function applyFactoryBilingualSnapshotBackfill(companyId: number, options: { overwrite?: boolean; includeFinalized?: boolean } = {}, executor: typeof db = db) {
  return applyTargets(companyId, options, executor);
}

export function propagateFactoryArabicCatalogChange(companyId: number, productId: number, executor: typeof db = db) {
  return applyTargets(companyId, { overwrite: true, includeFinalized: false, productId }, executor);
}
