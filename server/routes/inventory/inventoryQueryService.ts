import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
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
    const [{ total }] = await db
      .select({ total: sql<number>`count(DISTINCT ${inventory.stockItemId})::int` })
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

    return {
      data,
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize),
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
    totalPages: Math.ceil(total / filters.pageSize),
  };
}
