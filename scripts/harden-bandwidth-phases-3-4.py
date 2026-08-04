from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"Could not find {label}")
    return text.replace(old, new, 1)


def remove_block(text: str, start: str, end: str, label: str) -> str:
    start_index = text.find(start)
    if start_index < 0:
        return text
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"Could not find end of {label}")
    return text[:start_index] + text[end_index:]


# Default lightweight stock-item calls are bounded. Large identity-list callers
# must opt in explicitly with all=true while selector flows use server search.
path = Path("server/routes/stock/stockLightRoutes.ts")
text = path.read_text()
old = '''      const paginated =
        req.query.paginated === "true" ||
        req.query.page != null ||
        req.query.pageSize != null ||
        req.query.limit != null ||
        req.query.search != null ||
        req.query.locationId != null ||
        req.query.ids != null;
'''
new = '''      const explicitFullList = req.query.all === "true";
      const paginated = !explicitFullList;
'''
text = replace_once(text, old, new, "bounded stock light default")
text = text.replace(
    'res.setHeader("Warning", \'299 - "Unpaginated stock-items/light response is deprecated"\');',
    'res.setHeader("Warning", \'299 - "Explicit full stock-items/light response; selectors should use paging/search"\');',
)
path.write_text(text)

# Canonical location inventory query: selected-ID hydration, multi-category
# filtering, and reliable uncategorized metadata for summary cards.
Path("server/routes/location/locationInventoryPaging.ts").write_text(r'''import { pool } from "../../db";
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

export async function getPaginatedLocationInventory({
  companyId,
  locationId,
  query,
  isPOS,
}: LocationInventoryArgs) {
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
''')

# Combined inventory pages retain global filtered totals while returning only
# the visible page rows.
Path("server/routes/inventory/inventoryQueryService.ts").write_text(r'''import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { inventory, locations, stockCategories, stockGroups, stockItems } from "@shared/schema";

import { db } from "../../db";
import type { InventoryListFilters } from "./inventoryRequestContext";

function buildInventoryConditions(companyId: number, filters: InventoryListFilters) {
  const conditions: any[] = [
    eq(inventory.companyId, companyId),
    isNull(locations.deletedAt),
    isNull(stockItems.deletedAt),
  ];
  if (filters.locationId) conditions.push(eq(inventory.locationId, filters.locationId));
  if (filters.unassignedStockGroup) conditions.push(isNull(stockItems.stockGroupId));
  else if (filters.stockGroupId) conditions.push(eq(stockItems.stockGroupId, filters.stockGroupId));

  if (filters.categoryIds?.length || filters.includeUncategorized) {
    const categoryConditions: any[] = [];
    if (filters.categoryIds?.length) categoryConditions.push(inArray(stockItems.categoryId, filters.categoryIds));
    if (filters.includeUncategorized) categoryConditions.push(isNull(stockItems.categoryId));
    conditions.push(or(...categoryConditions));
  }

  if (filters.search) {
    const query = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(stockItems.name, query),
        ilike(stockItems.code, query),
        ilike(stockGroups.name, query),
        ilike(stockCategories.name, query)
      )
    );
  }
  return and(...conditions);
}

export async function getInventoryPage(companyId: number, filters: InventoryListFilters) {
  const where = buildInventoryConditions(companyId, filters);
  const offset = (filters.page - 1) * filters.pageSize;

  if (filters.profile === "combined") {
    const [summary] = await db
      .select({
        total: sql<number>`count(DISTINCT ${inventory.stockItemId})::int`,
        totalQuantity: sql<string>`COALESCE(SUM(${inventory.quantity}::numeric), 0)::text`,
        totalValue: sql<string>`COALESCE(SUM(${inventory.totalValue}::numeric), 0)::text`,
      })
      .from(inventory)
      .leftJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
      .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
      .leftJoin(stockCategories, eq(stockItems.categoryId, stockCategories.id))
      .innerJoin(locations, eq(inventory.locationId, locations.id))
      .where(where);

    const data = await db
      .select({
        stockItemId: inventory.stockItemId,
        stockItemName: sql<string>`COALESCE(${stockItems.name}, '')`,
        stockItemCode: sql<string>`COALESCE(${stockItems.code}, '')`,
        totalQty: sql<string>`COALESCE(SUM(${inventory.quantity}::numeric), 0)::text`,
        avgCost: sql<string>`CASE
          WHEN COALESCE(SUM(${inventory.quantity}::numeric), 0) = 0 THEN '0'
          ELSE (COALESCE(SUM(${inventory.totalValue}::numeric), 0) / NULLIF(SUM(${inventory.quantity}::numeric), 0))::text
        END`,
        totalValue: sql<string>`COALESCE(SUM(${inventory.totalValue}::numeric), 0)::text`,
        stockGroupId: stockItems.stockGroupId,
        stockGroupName: sql<string>`COALESCE(${stockGroups.name}, 'Unassigned')`,
        categoryId: stockItems.categoryId,
        categoryName: stockCategories.name,
        qtyByLocationName: sql<Record<string, string>>`COALESCE(
          jsonb_object_agg(${locations.name}, ${inventory.quantity})
            FILTER (WHERE ${locations.name} IS NOT NULL),
          '{}'::jsonb
        )`,
      })
      .from(inventory)
      .leftJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
      .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
      .leftJoin(stockCategories, eq(stockItems.categoryId, stockCategories.id))
      .innerJoin(locations, eq(inventory.locationId, locations.id))
      .where(where)
      .groupBy(
        inventory.stockItemId,
        stockItems.name,
        stockItems.code,
        stockItems.stockGroupId,
        stockGroups.name,
        stockItems.categoryId,
        stockCategories.name
      )
      .orderBy(asc(stockGroups.name), asc(stockItems.name))
      .limit(filters.pageSize)
      .offset(offset);

    const total = Number(summary?.total ?? 0);
    return {
      data,
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
      totals: {
        quantity: Number(summary?.totalQuantity ?? 0),
        value: Number(summary?.totalValue ?? 0),
      },
    };
  }

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(inventory)
    .leftJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
    .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
    .leftJoin(stockCategories, eq(stockItems.categoryId, stockCategories.id))
    .innerJoin(locations, eq(inventory.locationId, locations.id))
    .where(where);

  const data = await db
    .select({
      inventoryId: inventory.id,
      locationId: inventory.locationId,
      locationName: locations.name,
      locationCode: locations.code,
      stockItemId: inventory.stockItemId,
      quantity: inventory.quantity,
      averageRate: inventory.averageRate,
      totalValue: inventory.totalValue,
      stockItemCode: stockItems.code,
      stockItemName: stockItems.name,
      stockItemUom: stockItems.uom,
      stockGroupId: stockItems.stockGroupId,
      stockGroupName: sql<string>`COALESCE(${stockGroups.name}, '')`,
      stockGroupCode: sql<string>`COALESCE(${stockGroups.code}, '')`,
      categoryId: stockItems.categoryId,
      categoryName: stockCategories.name,
    })
    .from(inventory)
    .leftJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
    .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
    .leftJoin(stockCategories, eq(stockItems.categoryId, stockCategories.id))
    .innerJoin(locations, eq(inventory.locationId, locations.id))
    .where(where)
    .orderBy(asc(stockItems.code), asc(locations.name))
    .limit(filters.pageSize)
    .offset(offset);

  return {
    data,
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
  };
}
''')

# POS paging keeps filtered pagination separate from global location KPIs and
# computes group-level unpriced counts without loading all rows.
Path("server/routes/stock/transfer-adj/posPriceListPaging.ts").write_text(r'''import { pool } from "../../../db";
import { buildPaginationMeta, parsePagination, parseSearchQuery } from "../../../lib/pagination";

interface PaginatedPosPriceListArgs {
  companyId: number;
  locationId: number;
  query: Record<string, unknown>;
  isPrivileged: boolean;
  isPOS: boolean;
}

export async function getPaginatedPosPriceList({
  companyId,
  locationId,
  query,
  isPrivileged,
  isPOS,
}: PaginatedPosPriceListArgs) {
  const { page, pageSize, offset } = parsePagination(query, { defaultPageSize: isPOS ? 30 : 50, maxPageSize: 100 });
  const search = parseSearchQuery(query.search);
  const group = String(query.group ?? "").trim();
  const unpricedOnly = query.unpriced === "true";
  const availableOnly = isPOS || query.availableOnly === "true";

  const filterValues: unknown[] = [companyId, locationId];
  const addFilterValue = (value: unknown) => {
    filterValues.push(value);
    return `$${filterValues.length}`;
  };
  const scopeConditions = ["si.company_id = $1", "si.deleted_at IS NULL"];
  if (availableOnly) {
    scopeConditions.push("silp.selling_price IS NOT NULL");
    scopeConditions.push("COALESCE(inv.quantity, 0)::numeric > 0");
  }
  const filterConditions = [...scopeConditions];

  if (search) {
    const searchParam = addFilterValue(`%${search}%`);
    filterConditions.push(`(
      si.code ILIKE ${searchParam}
      OR si.name ILIKE ${searchParam}
      OR COALESCE(sg.name, '') ILIKE ${searchParam}
      OR EXISTS (
        SELECT 1 FROM stock_item_code_aliases a
        WHERE a.company_id = si.company_id
          AND a.stock_item_id = si.id
          AND a.alias_code ILIKE ${searchParam}
      )
    )`);
  }
  if (group && group !== "all") {
    filterConditions.push(`COALESCE(sg.name, '') = ${addFilterValue(group)}`);
  }
  if (unpricedOnly) {
    filterConditions.push("COALESCE(silp.selling_price, si.selling_price, 0)::numeric = 0");
  }

  const scopeWhereSql = scopeConditions.join(" AND ");
  const filterWhereSql = filterConditions.join(" AND ");
  const baseFrom = `
    FROM stock_items si
    LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
    LEFT JOIN stock_item_location_prices silp
      ON silp.stock_item_id = si.id
     AND silp.location_id = $2
    LEFT JOIN inventory inv
      ON inv.stock_item_id = si.id
     AND inv.location_id = $2`;

  const rowsValues = [...filterValues, pageSize, offset];
  const limitParam = `$${filterValues.length + 1}`;
  const offsetParam = `$${filterValues.length + 2}`;

  const [filteredCountResult, scopeCountResult, rowsResult, groupResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total ${baseFrom} WHERE ${filterWhereSql}`, filterValues),
    pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE COALESCE(silp.selling_price, si.selling_price, 0)::numeric > 0)::int AS priced,
         COUNT(*) FILTER (WHERE COALESCE(silp.selling_price, si.selling_price, 0)::numeric = 0)::int AS unpriced
       ${baseFrom}
       WHERE ${scopeWhereSql}`,
      [companyId, locationId]
    ),
    pool.query(
      `SELECT
         si.id AS "stockItemId",
         si.code,
         si.name,
         COALESCE(sg.name, '') AS "stockGroupName",
         si.selling_price AS "baseSellingPrice",
         (silp.selling_price IS NOT NULL) AS "hasCustomPrice",
         COALESCE(silp.selling_price, si.selling_price) AS "sellingPrice",
         COALESCE(inv.quantity, '0')::text AS quantity
       ${baseFrom}
       WHERE ${filterWhereSql}
       ORDER BY si.name, si.id
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      rowsValues
    ),
    pool.query(
      `SELECT
         COALESCE(sg.name, '') AS name,
         COUNT(*) FILTER (WHERE COALESCE(silp.selling_price, si.selling_price, 0)::numeric = 0)::int AS "unpricedCount"
       ${baseFrom}
       WHERE ${scopeWhereSql}
       GROUP BY COALESCE(sg.name, '')
       ORDER BY name`,
      [companyId, locationId]
    ),
  ]);

  let data = rowsResult.rows;
  if (isPrivileged && data.length > 0) {
    const itemIds = data.map((row) => Number(row.stockItemId));
    const [dubaiCostResult, offloadCostResult] = await Promise.all([
      pool.query(
        `SELECT DISTINCT ON (pli.stock_item_id)
           pli.stock_item_id AS "stockItemId",
           pli.rate AS "costDubai"
         FROM po_line_items pli
         JOIN purchase_orders po ON pli.po_id = po.id
         JOIN containers c ON po.container_id = c.id
         WHERE po.company_id = $1
           AND pli.stock_item_id = ANY($2::int[])
         ORDER BY pli.stock_item_id, pli.id DESC`,
        [companyId, itemIds]
      ),
      pool.query(
        `SELECT DISTINCT ON (pli.stock_item_id)
           pli.stock_item_id AS "stockItemId",
           co.additional_cost_per_bale AS "offloadingCost"
         FROM container_offloads co
         JOIN containers c ON co.container_id = c.id
         JOIN purchase_orders po ON po.container_id = c.id
         JOIN po_line_items pli ON pli.po_id = po.id
         WHERE c.company_id = $1
           AND pli.stock_item_id = ANY($2::int[])
         ORDER BY pli.stock_item_id, co.offloaded_at DESC`,
        [companyId, itemIds]
      ),
    ]);
    const dubaiMap = new Map(dubaiCostResult.rows.map((row) => [Number(row.stockItemId), String(row.costDubai ?? "0")]));
    const offloadMap = new Map(
      offloadCostResult.rows.map((row) => [Number(row.stockItemId), String(row.offloadingCost ?? "0")])
    );
    data = data.map((row) => ({
      ...row,
      costPrice: dubaiMap.get(Number(row.stockItemId)) ?? null,
      offloadingCost: offloadMap.get(Number(row.stockItemId)) ?? null,
    }));
  }

  const filteredTotal = Number(filteredCountResult.rows[0]?.total ?? 0);
  const scopeCounts = scopeCountResult.rows[0] ?? {};
  return {
    data,
    groups: groupResult.rows.map((row) => String(row.name)).filter(Boolean),
    unpricedByGroup: groupResult.rows
      .map((row) => ({ name: String(row.name || "(No Group)"), count: Number(row.unpricedCount ?? 0) }))
      .filter((row) => row.count > 0),
    counts: {
      total: Number(scopeCounts.total ?? 0),
      priced: Number(scopeCounts.priced ?? 0),
      unpriced: Number(scopeCounts.unpriced ?? 0),
    },
    ...buildPaginationMeta(filteredTotal, page, pageSize),
  };
}
''')

# Remove the now-unused full stock-item request from the parent voucher shell.
path = Path("client/src/pages/vouchers/useVoucherQueries.ts")
text = path.read_text()
text = text.replace("  StockItem,\n", "")
text = remove_block(
    text,
    '  // Voucher transfer/adjustment/POS pickers only use id, code, name and uom.\n',
    '  const { data: locations = [] }',
    "voucher shell stock item query",
)
text = text.replace("    stockItems,\n", "")
path.write_text(text)

path = Path("client/src/pages/Vouchers.tsx")
text = path.read_text().replace("    stockItems,\n", "")
path.write_text(text)

# Stock adjustment selectors now query the selected location with server search,
# include zero-stock items for production, and hydrate only selected/edit IDs.
path = Path("client/src/pages/vouchers/StockAdjustmentForm.tsx")
text = path.read_text()
if 'import { useDebouncedValue } from "@/hooks/useDebouncedValue";' not in text:
    text = text.replace(
        'import { useToast } from "@/hooks/use-toast";\n',
        'import { useToast } from "@/hooks/use-toast";\nimport { useDebouncedValue } from "@/hooks/useDebouncedValue";\n',
        1,
    )
text = text.replace("  StockItem,\n", "")
text = remove_block(
    text,
    '  const { data: stockItems = [] } = useQuery<StockItem[]>({\n',
    '  const { data: locations = [] }',
    "stock adjustment full item query",
)
start = text.find('  const { data: locationInventory = [] } = useQuery<any[]>({\n')
end = text.find('\n\n  useEffect(() => {\n    if (showAdjustmentSidebar', start)
if start >= 0:
    if end < 0:
        raise RuntimeError("Could not find stock adjustment inventory block end")
    replacement = r'''  const [adjustmentSearchTerm, setAdjustmentSearchTerm] = useState("");
  const debouncedAdjustmentSearch = useDebouncedValue(adjustmentSearchTerm, 250);
  const [adjustmentHighlightedIndex, setAdjustmentHighlightedIndex] = useState(0);
  const [activeAdjustmentRow, setActiveAdjustmentRow] = useState<number | null>(null);
  const [showAdjustmentSidebar, setShowAdjustmentSidebar] = useState(false);
  const adjustmentFocusIdRef = useRef(0);
  const adjustmentSidebarRef = useRef<HTMLDivElement>(null);

  const effectiveAdjustmentLocationId =
    adjustmentLocationId || Number(stockAdjustmentToEdit?.locationId || 0);
  const selectedAdjustmentItemIds = Array.from(
    new Set([
      ...adjustmentEntries.map((entry) => entry.stockItemId).filter((id) => id > 0),
      ...((stockAdjustmentToEdit?.items ?? []) as any[])
        .map((item) => Number(item.stockItemId))
        .filter((id) => id > 0),
    ])
  );
  const { data: locationInventoryPage } = useQuery<{ data: any[] }>({
    queryKey: [
      "/api/locations",
      effectiveAdjustmentLocationId,
      "inventory",
      "adjustment-search",
      debouncedAdjustmentSearch,
      selectedAdjustmentItemIds.join(","),
    ],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ page: "1", pageSize: "100", includeZero: "true" });
      if (debouncedAdjustmentSearch.trim()) params.set("search", debouncedAdjustmentSearch.trim());
      if (selectedAdjustmentItemIds.length > 0) params.set("ids", selectedAdjustmentItemIds.join(","));
      const response = await fetch(
        `/api/locations/${effectiveAdjustmentLocationId}/inventory?${params.toString()}`,
        { credentials: "include", signal }
      );
      if (!response.ok) throw new Error("Failed to fetch inventory");
      return response.json();
    },
    enabled: effectiveAdjustmentLocationId > 0,
    placeholderData: (previous) => previous,
  });
  const locationInventory = locationInventoryPage?.data ?? [];

  const adjustmentItemsWithInventory = useMemo(
    () =>
      locationInventory.map((item: any) => ({
        stockItemId: Number(item.stockItemId),
        stockItemCode: item.stockItemCode || "",
        stockItemName: item.stockItemName || "",
        quantity: item.quantity || "0",
        averageRate: item.averageRate || "0",
      })),
    [locationInventory]
  );
  const filteredAdjustmentItems = adjustmentItemsWithInventory;
'''
    text = text[:start] + replacement + text[end:]
text = text.replace("stockItems.length > 0", "locationInventory.length > 0")
text = text.replace("const stockItem = stockItems.find((s) => s.id === item.stockItemId);", "const stockItem = locationInventory.find((s: any) => s.stockItemId === item.stockItemId);")
text = text.replace("stockItem?.code || \"\"", "stockItem?.stockItemCode || \"\"")
text = text.replace("stockItem?.name || \"\"", "stockItem?.stockItemName || \"\"")
text = text.replace("[stockAdjustmentToEdit, voucherToEdit, stockItems, stockAdjustmentForm]", "[stockAdjustmentToEdit, voucherToEdit, locationInventory, stockAdjustmentForm]")
if "stockItems" in text:
    raise RuntimeError("StockAdjustmentForm still contains an unbounded stockItems dependency")
path.write_text(text)

# Transfer Order already receives complete visible inventory identity in the
# location summary. Only edit-only IDs are hydrated through the lightweight
# endpoint, avoiding a full-company list on ordinary navigation.
path = Path("client/src/pages/StockTransferOrder.tsx")
text = path.read_text()
text = text.replace(
    'import { useState, useEffect, Fragment, useRef, useCallback } from "react";',
    'import { useState, useEffect, Fragment, useRef, useCallback, useMemo } from "react";',
)
if 'import { useStockItemSearch } from "@/hooks/useStockItemSearch";' not in text:
    text = text.replace(
        'import { formatNumber } from "@/lib/formatNumber";\n',
        'import { formatNumber } from "@/lib/formatNumber";\nimport { useStockItemSearch } from "@/hooks/useStockItemSearch";\n',
        1,
    )
old_query = '''  const { data: stockItems = [] } = useQuery<Array<{ id: number; name: string; code: string; uom: string }>>({
    queryKey: ["/api/stock-items/light", selectedCompany?.id],
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

'''
new_query = '''  const editStockItemIds = Array.from(
    new Set(
      ((existingTransfer?.items ?? []) as any[])
        .map((item) => Number(item.stockItemId))
        .filter((id) => id > 0)
    )
  );
  const { items: editStockItems } = useStockItemSearch<{
    id: number;
    name: string;
    code: string;
    uom: string;
  }>({
    companyId: selectedCompany?.id,
    selectedIds: editStockItemIds,
    enabled: !!editVoucherId && editStockItemIds.length > 0,
    pageSize: 100,
  });

'''
text = replace_once(text, old_query, new_query, "transfer order selected item hydration")
summary_end = '''  const { data: summaryData, isLoading } = useQuery<LocationSummaryResponse>({
    queryKey: ["/api/location-summary", { locationIds: selectedLocationIds.join(",") }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedLocationIds.length > 0) {
        params.append("locationIds", selectedLocationIds.join(","));
      }
      const res = await fetch(`/api/location-summary?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch location summary");
      return res.json();
    },
    enabled: selectedLocationIds.length > 0,
  });
'''
summary_replacement = summary_end + '''

  const stockItems = useMemo<StockItemData[]>(() => {
    const byId = new Map<number, StockItemData>();
    for (const group of summaryData?.stockGroups ?? []) {
      for (const item of group.items) byId.set(item.id, item);
    }
    for (const item of editStockItems) {
      if (!byId.has(item.id)) byId.set(item.id, { ...item, locationData: {} });
    }
    return Array.from(byId.values());
  }, [summaryData, editStockItems]);
'''
text = replace_once(text, summary_end, summary_replacement, "transfer order summary item reuse")
path.write_text(text)

# Remaining full-list consumers are explicit management/on-demand flows. Their
# URLs opt in to the compatibility array so the default endpoint stays bounded.
for path in Path("client/src").rglob("*.ts*"):
    if path.name == "useStockItemSearch.ts":
        continue
    text = path.read_text()
    updated = text.replace('"/api/stock-items/light"', '"/api/stock-items/light?all=true"')
    updated = updated.replace("'/api/stock-items/light'", "'/api/stock-items/light?all=true'")
    if updated != text:
        path.write_text(updated)

# Location inventory UI sends all selected categories and retains global totals.
path = Path("client/src/pages/location-inventory/useLocationInventoryQueries.ts")
text = path.read_text()
text = text.replace(
    '''interface CombinedInventoryPage {
  data: any[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}''',
    '''interface CombinedInventoryPage {
  data: any[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  totals: { quantity: number; value: number | null };
}''',
)
text = text.replace(
    '''const EMPTY_COMBINED_PAGE: CombinedInventoryPage = {
  data: [],
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 1,
};''',
    '''const EMPTY_COMBINED_PAGE: CombinedInventoryPage = {
  data: [],
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 1,
  totals: { quantity: 0, value: null },
};''',
)
text = text.replace(
    'if (itemCategoryFilter.length === 1) params.set("categoryId", itemCategoryFilter[0]);',
    'if (itemCategoryFilter.length > 0) params.set("categoryIds", itemCategoryFilter.join(","));',
)
text = text.replace(
    '''    allInventoryPagination: {
      page: allInventoryPage.page,
      pageSize: allInventoryPage.pageSize,
      total: allInventoryPage.total,
      totalPages: allInventoryPage.totalPages,
    },''',
    '''    allInventoryPagination: {
      page: allInventoryPage.page,
      pageSize: allInventoryPage.pageSize,
      total: allInventoryPage.total,
      totalPages: allInventoryPage.totalPages,
    },
    allInventoryTotals: allInventoryPage.totals,''',
)
path.write_text(text)

path = Path("client/src/pages/location-inventory/useStockGroupSummaries.ts")
text = path.read_text()
text = text.replace(
    'groups: Array<StockGroupSummary & { hasNegative?: boolean; categoryIds?: number[] }>;',
    'groups: Array<StockGroupSummary & { hasNegative?: boolean; hasUncategorized?: boolean; categoryIds?: number[] }>;',
)
text = text.replace(
    '''          if (groupCategoryFilter === "none") {
            if (!categoryIds.includes("null") && categoryIds.length === group.itemCount) return false;
          } else if (!categoryIds.includes(groupCategoryFilter)) {''',
    '''          if (groupCategoryFilter === "none") {
            if (!group.hasUncategorized) return false;
          } else if (!categoryIds.includes(groupCategoryFilter)) {''',
)
path.write_text(text)

path = Path("client/src/pages/location-inventory/CombinedStockView.tsx")
text = path.read_text()
text = text.replace(
    '''  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };''',
    '''  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };
  totals: { quantity: number; value: number | null };''',
)
text = text.replace("  pagination,\n}: CombinedStockViewProps)", "  pagination,\n  totals,\n}: CombinedStockViewProps)")
text = text.replace(
    "{formatAmount(filteredCombinedRows.reduce((s, r) => s + r.totalValue, 0))}",
    "{formatAmount(Number(totals.value ?? 0))}",
)
path.write_text(text)

path = Path("client/src/pages/LocationInventory.tsx")
text = path.read_text()
text = text.replace("    allInventoryPagination,\n", "    allInventoryPagination,\n    allInventoryTotals,\n")
text = text.replace(
    '''              pagination={{
                ...allInventoryPagination,
                onPageChange: setAllStockPage,
              }}''',
    '''              pagination={{
                ...allInventoryPagination,
                onPageChange: setAllStockPage,
              }}
              totals={allInventoryTotals}''',
)
path.write_text(text)

# POS UI consumes global group counts, refetches the active paged query family,
# and explicitly walks all filtered pages only when export is requested.
path = Path("client/src/pages/pos/pospricelist/types.ts")
text = path.read_text()
text = text.replace(
    '''  groups: string[];
  counts: { total: number; priced: number; unpriced: number };''',
    '''  groups: string[];
  unpricedByGroup: { name: string; count: number }[];
  counts: { total: number; priced: number; unpriced: number };''',
)
path.write_text(text)

path = Path("client/src/pages/pos/POSPriceList.tsx")
text = path.read_text()
old_group_memo = '''  const unpricedByGroup = useMemo<{ name: string; count: number }[]>(() => {
    if (!showUnpriced) return [];
    const map = new Map<string, number>();
    for (const item of locationPricedList) {
      if (!isItemUnpriced(item)) continue;
      const g = item.stockGroupName || "(No Group)";
      map.set(g, (map.get(g) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [locationPricedList, showUnpriced, isAllMode]);'''
new_group_memo = '''  const unpricedByGroup = useMemo<{ name: string; count: number }[]>(() => {
    if (!showUnpriced) return [];
    if (!isAllMode) return priceListResponse?.unpricedByGroup ?? [];
    const map = new Map<string, number>();
    for (const item of locationPricedList) {
      if (!isItemUnpriced(item)) continue;
      const g = item.stockGroupName || "(No Group)";
      map.set(g, (map.get(g) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [locationPricedList, showUnpriced, isAllMode, priceListResponse?.unpricedByGroup]);'''
text = replace_once(text, old_group_memo, new_group_memo, "POS unpriced group counts")
text = text.replace(
    'queryClient.invalidateQueries({ queryKey: ["/api/pos/price-list", selectedLocationId] });',
    'queryClient.invalidateQueries({ queryKey: ["/api/pos/price-list"], refetchType: "active" });',
)
old_export_start = '''  const exportToExcel = async () => {
    if (filteredItems.length === 0) return;
    setExporting(true);
    try {
      const XLSX = await import("@/lib/excelHelper");

      const rows = filteredItems.map((item: any) => {'''
new_export_start = '''  const exportToExcel = async () => {
    if (totalItemCount === 0) return;
    setExporting(true);
    try {
      const XLSX = await import("@/lib/excelHelper");
      let exportItems = filteredItems;

      if (!isAllMode && selectedLocationId) {
        const fetchPage = async (exportPage: number) => {
          const params = new URLSearchParams({
            locationId: String(selectedLocationId),
            page: String(exportPage),
            pageSize: "100",
          });
          if (search.trim()) params.set("search", search.trim());
          if (groupFilter !== "all") params.set("group", groupFilter);
          if (showUnpriced) params.set("unpriced", "true");
          if (posUser) params.set("availableOnly", "true");
          const response = await fetch(`/api/pos/price-list?${params.toString()}`, {
            credentials: "include",
          });
          if (!response.ok) throw new Error("Failed to load the complete filtered price list");
          return (await response.json()) as PaginatedPriceListResponse;
        };
        const firstPage = await fetchPage(1);
        const remainingPages = [];
        for (let exportPage = 2; exportPage <= firstPage.totalPages; exportPage += 1) {
          remainingPages.push(await fetchPage(exportPage));
        }
        exportItems = [firstPage, ...remainingPages]
          .flatMap((result) => result.data)
          .filter(
            (item) =>
              !showUnpriced || !hiddenUnpricedGroups.has(item.stockGroupName || "(No Group)")
          );
      }

      const rows = exportItems.map((item: any) => {'''
text = replace_once(text, old_export_start, new_export_start, "POS full filtered export")
path.write_text(text)

# Documentation and source contract now distinguish bounded selectors from
# explicit full-list management flows.
path = Path("docs/stock-items-bandwidth-light-callers.md")
if path.exists():
    path.write_text('''# Stock items bandwidth: lightweight callers

## Default behavior

`/api/stock-items/light` is paginated by default, capped at 100 records, and supports server-side search by original item name, code, barcode alias, selected IDs, and location. It returns only selector identity fields. Original stock item and stock group names are never translated or modified.

## Selector flows

Stock transfer, stock adjustment, and transfer-order workflows use server search or already-loaded location summaries. Selected/edit items are hydrated by ID, so opening a normal voucher screen no longer downloads the full company item list.

## Explicit full-list flows

Management, import, repair, and bulk-edit pages that genuinely require every lightweight identity record opt in with `all=true`. These are explicit on-demand operations rather than ordinary selector navigation.

## Full records

Full stock item data remains available from `/api/stock-items/:id` only after an item is selected or opened.
''')
