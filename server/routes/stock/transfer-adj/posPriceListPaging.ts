import { pool } from "../../../db";
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

  const values: unknown[] = [companyId, locationId];
  const addValue = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const conditions = ["si.company_id = $1", "si.deleted_at IS NULL"];

  if (search) {
    const searchParam = addValue(`%${search}%`);
    conditions.push(`(
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
    conditions.push(`COALESCE(sg.name, '') = ${addValue(group)}`);
  }
  if (unpricedOnly) {
    conditions.push("COALESCE(silp.selling_price, si.selling_price, 0)::numeric = 0");
  }
  if (availableOnly) {
    conditions.push("silp.selling_price IS NOT NULL");
    conditions.push("COALESCE(inv.quantity, 0)::numeric > 0");
  }

  const whereSql = conditions.join(" AND ");
  const baseFrom = `
    FROM stock_items si
    LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
    LEFT JOIN stock_item_location_prices silp
      ON silp.stock_item_id = si.id
     AND silp.location_id = $2
    LEFT JOIN inventory inv
      ON inv.stock_item_id = si.id
     AND inv.location_id = $2`;

  const countValues = [...values];
  const rowsValues = [...values, pageSize, offset];
  const limitParam = `$${values.length + 1}`;
  const offsetParam = `$${values.length + 2}`;

  const [countResult, rowsResult, groupResult] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE COALESCE(silp.selling_price, si.selling_price, 0)::numeric > 0)::int AS priced,
         COUNT(*) FILTER (WHERE COALESCE(silp.selling_price, si.selling_price, 0)::numeric = 0)::int AS unpriced
       ${baseFrom}
       WHERE ${whereSql}`,
      countValues
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
       WHERE ${whereSql}
       ORDER BY si.name, si.id
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      rowsValues
    ),
    pool.query(
      `SELECT DISTINCT COALESCE(sg.name, '') AS name
       ${baseFrom}
       WHERE si.company_id = $1
         AND si.deleted_at IS NULL
         ${availableOnly ? "AND silp.selling_price IS NOT NULL AND COALESCE(inv.quantity, 0)::numeric > 0" : ""}
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

  const total = Number(countResult.rows[0]?.total ?? 0);
  return {
    data,
    groups: groupResult.rows.map((row) => String(row.name)).filter(Boolean),
    counts: {
      total,
      priced: Number(countResult.rows[0]?.priced ?? 0),
      unpriced: Number(countResult.rows[0]?.unpriced ?? 0),
    },
    ...buildPaginationMeta(total, page, pageSize),
  };
}
