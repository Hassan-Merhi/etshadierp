import { pool } from "../../db";
import { buildPaginationMeta, parseIdList, parsePagination, parseSearchQuery } from "../../lib/pagination";

interface InventoryQuery {
  [key: string]: unknown;
}

interface LocationInventoryArgs {
  companyId: number;
  locationId: number;
  query: InventoryQuery;
  isPOS: boolean;
}

function buildInventoryBase(includeZero: boolean): string {
  if (includeZero) {
    return `
      SELECT
        inv.id AS "inventoryId",
        $1::int AS "locationId",
        si.id AS "stockItemId",
        COALESCE(inv.quantity, '0') AS quantity,
        COALESCE(inv.average_rate, '0') AS "averageRate",
        COALESCE(inv.total_value, '0') AS "totalValue",
        si.code AS "stockItemCode",
        si.name AS "stockItemName",
        si.uom AS "stockItemUom",
        si.stock_group_id AS "stockGroupId",
        NULLIF(COALESCE(sg.name, ''), '') AS "stockGroupName",
        NULLIF(COALESCE(sg.code, ''), '') AS "stockGroupCode",
        CASE WHEN si.deleted_at IS NOT NULL THEN false ELSE si.active END AS "stockItemActive",
        si.category_id AS "categoryId",
        sc.name AS "categoryName"
      FROM stock_items si
      LEFT JOIN inventory inv
        ON inv.stock_item_id = si.id
       AND inv.location_id = $1
      LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
      LEFT JOIN stock_categories sc ON sc.id = si.category_id
      WHERE si.company_id = $2
        AND (
          (si.deleted_at IS NULL AND COALESCE(si.active, true) = true)
          OR (si.deleted_at IS NOT NULL AND COALESCE(inv.quantity::numeric, 0) <> 0)
        )`;
  }

  return `
    SELECT
      inv.id AS "inventoryId",
      inv.location_id AS "locationId",
      inv.stock_item_id AS "stockItemId",
      inv.quantity,
      inv.average_rate AS "averageRate",
      inv.total_value AS "totalValue",
      si.code AS "stockItemCode",
      si.name AS "stockItemName",
      si.uom AS "stockItemUom",
      si.stock_group_id AS "stockGroupId",
      NULLIF(COALESCE(sg.name, ''), '') AS "stockGroupName",
      NULLIF(COALESCE(sg.code, ''), '') AS "stockGroupCode",
      CASE WHEN si.deleted_at IS NOT NULL THEN false ELSE si.active END AS "stockItemActive",
      si.category_id AS "categoryId",
      sc.name AS "categoryName"
    FROM inventory inv
    INNER JOIN stock_items si ON si.id = inv.stock_item_id
    LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
    LEFT JOIN stock_categories sc ON sc.id = si.category_id
    WHERE inv.location_id = $1
      AND inv.company_id = $2
      AND COALESCE(inv.quantity::numeric, 0) <> 0
      AND (si.deleted_at IS NULL OR COALESCE(inv.quantity::numeric, 0) <> 0)`;
}

function buildFilters(query: InventoryQuery, values: unknown[]): string[] {
  const conditions: string[] = [];
  const addValue = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  const identityConditions: string[] = [];
  const search = parseSearchQuery(query.search);
  if (search) {
    const searchParam = addValue(`%${search}%`);
    identityConditions.push(`(
      "stockItemCode" ILIKE ${searchParam}
      OR "stockItemName" ILIKE ${searchParam}
      OR COALESCE("stockGroupName", '') ILIKE ${searchParam}
      OR COALESCE("categoryName", '') ILIKE ${searchParam}
    )`);
  }
  const selectedIds = parseIdList(query.ids);
  if (selectedIds.length > 0) {
    identityConditions.push(`"stockItemId" = ANY(${addValue(selectedIds)}::int[])`);
  }
  if (identityConditions.length > 0) {
    conditions.push(`(${identityConditions.join(" OR ")})`);
  }

  const groupId = String(query.groupId ?? "").trim();
  if (groupId === "none" || groupId === "null") {
    conditions.push('"stockGroupId" IS NULL');
  } else if (/^\d+$/.test(groupId)) {
    conditions.push(`"stockGroupId" = ${addValue(Number(groupId))}`);
  }

  const categoryParts = String(query.categoryIds ?? query.categoryId ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const includeUncategorized = categoryParts.includes("none") || categoryParts.includes("null");
  const categoryIds = Array.from(
    new Set(categoryParts.filter((part) => /^\d+$/.test(part)).map((part) => Number(part)))
  ).slice(0, 50);
  if (categoryIds.length > 0 && includeUncategorized) {
    conditions.push(`("categoryId" = ANY(${addValue(categoryIds)}::int[]) OR "categoryId" IS NULL)`);
  } else if (categoryIds.length > 0) {
    conditions.push(`"categoryId" = ANY(${addValue(categoryIds)}::int[])`);
  } else if (includeUncategorized) {
    conditions.push('"categoryId" IS NULL');
  }

  if (query.negativeOnly === "true") {
    conditions.push("quantity::numeric < 0");
  }

  return conditions;
}

export async function getPaginatedLocationInventory({ companyId, locationId, query, isPOS }: LocationInventoryArgs) {
  const includeZero = query.includeZero === "true";
  const { page, pageSize, offset } = parsePagination(query, { defaultPageSize: 50, maxPageSize: 100 });
  const values: unknown[] = [locationId, companyId];
  const filters = buildFilters(query, values);
  const filteredWhere = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const baseSql = buildInventoryBase(includeZero);

  const countValues = [...values];
  const pageValues = [...values, pageSize, offset];
  const limitParam = `$${values.length + 1}`;
  const offsetParam = `$${values.length + 2}`;

  const [countResult, rowsResult] = await Promise.all([
    pool.query(
      `WITH inventory_base AS (${baseSql}), filtered AS (
         SELECT * FROM inventory_base ${filteredWhere}
       )
       SELECT
         COUNT(*)::int AS total,
         COALESCE(SUM(quantity::numeric), 0)::text AS "totalQuantity",
         COALESCE(SUM("totalValue"::numeric), 0)::text AS "totalValue"
       FROM filtered`,
      countValues
    ),
    pool.query(
      `WITH inventory_base AS (${baseSql}), filtered AS (
         SELECT * FROM inventory_base ${filteredWhere}
       )
       SELECT * FROM filtered
       ORDER BY COALESCE("stockGroupName", ''), "stockItemName", "stockItemId"
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      pageValues
    ),
  ]);

  const total = Number(countResult.rows[0]?.total ?? 0);
  const data = isPOS
    ? rowsResult.rows.map((row) => ({ ...row, averageRate: null, totalValue: null }))
    : rowsResult.rows;

  return {
    data,
    ...buildPaginationMeta(total, page, pageSize),
    totals: {
      quantity: Number(countResult.rows[0]?.totalQuantity ?? 0),
      value: isPOS ? null : Number(countResult.rows[0]?.totalValue ?? 0),
    },
  };
}

export async function getLocationInventorySummary({ companyId, locationId, query, isPOS }: LocationInventoryArgs) {
  const includeZero = query.includeZero === "true";
  const values: unknown[] = [locationId, companyId];
  const filters = buildFilters(query, values);
  const filteredWhere = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const baseSql = buildInventoryBase(includeZero);

  const result = await pool.query(
    `WITH inventory_base AS (${baseSql}), filtered AS (
       SELECT * FROM inventory_base ${filteredWhere}
     )
     SELECT
       "stockGroupId" AS "groupId",
       MAX("stockGroupCode") AS "groupCode",
       COALESCE(MAX("stockGroupName"), 'Ungrouped') AS "groupName",
       COUNT(*)::int AS "itemCount",
       COALESCE(SUM(quantity::numeric), 0)::text AS "totalQuantity",
       COALESCE(SUM("totalValue"::numeric), 0)::text AS "totalValue",
       COALESCE(BOOL_OR(quantity::numeric < 0), false) AS "hasNegative",
       COALESCE(BOOL_OR("categoryId" IS NULL), false) AS "hasUncategorized",
       COALESCE(array_remove(array_agg(DISTINCT "categoryId"), NULL), ARRAY[]::int[]) AS "categoryIds"
     FROM filtered
     GROUP BY "stockGroupId"
     ORDER BY COALESCE(MAX("stockGroupName"), 'Ungrouped')`,
    values
  );

  const groups = result.rows.map((row) => {
    const totalQuantity = Number(row.totalQuantity ?? 0);
    const totalValue = isPOS ? 0 : Number(row.totalValue ?? 0);
    return {
      groupId: row.groupId == null ? null : Number(row.groupId),
      groupCode: row.groupCode ?? null,
      groupName: row.groupName || "Ungrouped",
      itemCount: Number(row.itemCount ?? 0),
      totalQuantity,
      totalValue,
      averageRate: !isPOS && totalQuantity !== 0 ? totalValue / totalQuantity : 0,
      hasNegative: Boolean(row.hasNegative),
      hasUncategorized: Boolean(row.hasUncategorized),
      categoryIds: (row.categoryIds ?? []).map(Number),
      items: [],
    };
  });

  return {
    groups,
    totals: {
      items: groups.reduce((sum, group) => sum + group.itemCount, 0),
      quantity: groups.reduce((sum, group) => sum + group.totalQuantity, 0),
      value: isPOS ? null : groups.reduce((sum, group) => sum + group.totalValue, 0),
    },
  };
}
