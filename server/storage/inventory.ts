import { eq, and, or, isNull, isNotNull, asc, desc, sql, inArray, ilike, ne } from "drizzle-orm";
import { db, pool } from "../db";
import * as schema from "@shared/schema";

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export async function getAllLocations(companyId: number): Promise<schema.Location[]> {
  return await db
    .select()
    .from(schema.locations)
    .where(and(eq(schema.locations.companyId, companyId), isNull(schema.locations.deletedAt)))
    .orderBy(asc(schema.locations.name));
}

export async function getLocationById(id: number): Promise<schema.Location | undefined> {
  const [location] = await db.select().from(schema.locations).where(eq(schema.locations.id, id));
  return location;
}

export async function createLocation(location: schema.InsertLocation): Promise<schema.Location> {
  const [created] = await db.insert(schema.locations).values(location).returning();
  return created;
}

export async function updateLocation(id: number, updates: Partial<schema.InsertLocation>): Promise<schema.Location> {
  const [updated] = await db.update(schema.locations).set(updates).where(eq(schema.locations.id, id)).returning();
  return updated;
}

export async function deleteLocation(id: number): Promise<void> {
  await db.update(schema.locations).set({ deletedAt: new Date() }).where(eq(schema.locations.id, id));
}

export async function getLocationByCode(code: string, companyId: number): Promise<schema.Location | undefined> {
  const [location] = await db
    .select()
    .from(schema.locations)
    .where(
      and(
        eq(schema.locations.code, code),
        eq(schema.locations.companyId, companyId),
        isNull(schema.locations.deletedAt)
      )
    );
  return location;
}

// ---------------------------------------------------------------------------
// Stock Groups
// ---------------------------------------------------------------------------

export async function getAllStockGroups(companyId: number): Promise<schema.StockGroup[]> {
  return await db
    .select()
    .from(schema.stockGroups)
    .where(eq(schema.stockGroups.companyId, companyId))
    .orderBy(asc(schema.stockGroups.name));
}

export async function getStockGroupById(id: number): Promise<schema.StockGroup | undefined> {
  const [group] = await db.select().from(schema.stockGroups).where(eq(schema.stockGroups.id, id));
  return group;
}

export async function createStockGroup(group: schema.InsertStockGroup): Promise<schema.StockGroup> {
  const [created] = await db.insert(schema.stockGroups).values(group).returning();
  return created;
}

export async function updateStockGroup(
  id: number,
  updates: Partial<schema.InsertStockGroup>
): Promise<schema.StockGroup> {
  const [updated] = await db.update(schema.stockGroups).set(updates).where(eq(schema.stockGroups.id, id)).returning();
  return updated;
}

export async function deleteStockGroup(id: number): Promise<void> {
  await db.delete(schema.stockGroups).where(eq(schema.stockGroups.id, id));
}

export async function getStockGroupByCode(code: string, companyId: number): Promise<schema.StockGroup | undefined> {
  const [group] = await db
    .select()
    .from(schema.stockGroups)
    .where(and(eq(schema.stockGroups.code, code), eq(schema.stockGroups.companyId, companyId)));
  return group;
}

// ---------------------------------------------------------------------------
// Stock Items
// ---------------------------------------------------------------------------

export async function getAllStockItems(
  companyId: number,
  includeDeleted: boolean = false
): Promise<schema.StockItem[]> {
  const conditions = [eq(schema.stockItems.companyId, companyId)];
  if (!includeDeleted) conditions.push(isNull(schema.stockItems.deletedAt));
  return await db
    .select()
    .from(schema.stockItems)
    .where(and(...conditions))
    .orderBy(asc(schema.stockItems.name));
}

export async function getStockItemById(id: number): Promise<schema.StockItem | undefined> {
  const [item] = await db.select().from(schema.stockItems).where(eq(schema.stockItems.id, id));
  return item;
}

export async function getStockItemByCode(code: string, companyId: number): Promise<schema.StockItem | undefined> {
  const [item] = await db
    .select()
    .from(schema.stockItems)
    .where(
      and(
        eq(schema.stockItems.code, code),
        eq(schema.stockItems.companyId, companyId),
        isNull(schema.stockItems.deletedAt)
      )
    );
  return item;
}

export async function getStockItemByCodeOrAlias(
  codeOrAlias: string,
  companyId: number
): Promise<schema.StockItem | undefined> {
  const [directMatch] = await db
    .select()
    .from(schema.stockItems)
    .where(
      and(
        eq(schema.stockItems.code, codeOrAlias),
        eq(schema.stockItems.companyId, companyId),
        isNull(schema.stockItems.deletedAt)
      )
    )
    .limit(1);
  if (directMatch) return directMatch;

  const [aliasMatch] = await db
    .select({ stockItem: schema.stockItems })
    .from(schema.stockItemCodeAliases)
    .innerJoin(schema.stockItems, eq(schema.stockItemCodeAliases.stockItemId, schema.stockItems.id))
    .where(
      and(
        eq(schema.stockItemCodeAliases.alias, codeOrAlias),
        eq(schema.stockItems.companyId, companyId),
        isNull(schema.stockItems.deletedAt)
      )
    )
    .limit(1);
  return aliasMatch?.stockItem;
}

export async function getStockItemByBarcode(barcode: string, companyId: number): Promise<schema.StockItem | undefined> {
  const [item] = await db
    .select()
    .from(schema.stockItems)
    .where(
      and(
        eq(schema.stockItems.barcode, barcode),
        eq(schema.stockItems.companyId, companyId),
        isNull(schema.stockItems.deletedAt)
      )
    );
  return item;
}

export async function createStockItem(item: schema.InsertStockItem): Promise<schema.StockItem> {
  const [created] = await db.insert(schema.stockItems).values(item).returning();
  return created;
}

export async function updateStockItem(id: number, updates: Partial<schema.InsertStockItem>): Promise<schema.StockItem> {
  const [updated] = await db.update(schema.stockItems).set(updates).where(eq(schema.stockItems.id, id)).returning();
  return updated;
}

export async function deleteStockItem(id: number): Promise<void> {
  await db.update(schema.stockItems).set({ deletedAt: new Date() }).where(eq(schema.stockItems.id, id));
}

export async function searchStockItems(
  companyId: number,
  query: string,
  limit: number = 20
): Promise<schema.StockItem[]> {
  return await db
    .select()
    .from(schema.stockItems)
    .where(
      and(
        eq(schema.stockItems.companyId, companyId),
        isNull(schema.stockItems.deletedAt),
        or(ilike(schema.stockItems.name, `%${query}%`), ilike(schema.stockItems.code, `%${query}%`))
      )
    )
    .orderBy(asc(schema.stockItems.name))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Code Aliases
// ---------------------------------------------------------------------------

export async function getCodeAliasesByStockItem(stockItemId: number): Promise<schema.StockItemCodeAlias[]> {
  return await db
    .select()
    .from(schema.stockItemCodeAliases)
    .where(eq(schema.stockItemCodeAliases.stockItemId, stockItemId));
}

export async function getStockItemCodeAliases(stockItemId: number): Promise<schema.StockItemCodeAlias[]> {
  return getCodeAliasesByStockItem(stockItemId);
}

export async function getStockItemCodeAliasById(aliasId: number): Promise<schema.StockItemCodeAlias | undefined> {
  const [alias] = await db
    .select()
    .from(schema.stockItemCodeAliases)
    .where(eq(schema.stockItemCodeAliases.id, aliasId));
  return alias;
}

export async function createCodeAlias(alias: schema.InsertStockItemCodeAlias): Promise<schema.StockItemCodeAlias> {
  const [created] = await db.insert(schema.stockItemCodeAliases).values(alias).returning();
  return created;
}

export async function deleteCodeAlias(id: number): Promise<void> {
  await db.delete(schema.stockItemCodeAliases).where(eq(schema.stockItemCodeAliases.id, id));
}

// ---------------------------------------------------------------------------
// Location Prices
// ---------------------------------------------------------------------------

export async function getLocationPrices(
  companyId: number,
  locationId: number
): Promise<schema.StockItemLocationPrice[]> {
  return await db
    .select()
    .from(schema.stockItemLocationPrices)
    .where(eq(schema.stockItemLocationPrices.locationId, locationId));
}

export async function getAllLocationPrices(companyId: number): Promise<schema.StockItemLocationPrice[]> {
  return await db
    .select({
      id: schema.stockItemLocationPrices.id,
      stockItemId: schema.stockItemLocationPrices.stockItemId,
      locationId: schema.stockItemLocationPrices.locationId,
      sellingPrice: schema.stockItemLocationPrices.sellingPrice,
      createdAt: schema.stockItemLocationPrices.createdAt,
      updatedAt: schema.stockItemLocationPrices.updatedAt,
    })
    .from(schema.stockItemLocationPrices)
    .innerJoin(schema.locations, eq(schema.stockItemLocationPrices.locationId, schema.locations.id))
    .where(eq(schema.locations.companyId, companyId));
}

export async function getLocationPricesByStockItem(
  stockItemId: number,
  companyId: number
): Promise<schema.StockItemLocationPrice[]> {
  return await db
    .select()
    .from(schema.stockItemLocationPrices)
    .where(eq(schema.stockItemLocationPrices.stockItemId, stockItemId));
}

export async function getStockItemLocationPrices(
  stockItemId: number,
  companyId: number
): Promise<schema.StockItemLocationPrice[]> {
  return getLocationPricesByStockItem(stockItemId, companyId);
}

export async function upsertLocationPrice(
  stockItemId: number,
  locationId: number,
  sellingPrice: string
): Promise<schema.StockItemLocationPrice> {
  const [result] = await db
    .insert(schema.stockItemLocationPrices)
    .values({ stockItemId, locationId, sellingPrice })
    .onConflictDoUpdate({
      target: [schema.stockItemLocationPrices.locationId, schema.stockItemLocationPrices.stockItemId],
      set: { sellingPrice, updatedAt: sql`now()` },
    })
    .returning();
  return result;
}

export async function deleteLocationPrice(priceId: number): Promise<void> {
  await db.delete(schema.stockItemLocationPrices).where(eq(schema.stockItemLocationPrices.id, priceId));
}

// ---------------------------------------------------------------------------
// Location Inventory
// ---------------------------------------------------------------------------

export async function getLocationInventory(companyId: number, locationId: number, includeZero = false): Promise<any[]> {
  if (!includeZero) {
    // Use pool.query() directly — bypasses Drizzle result-processing layer.
    const qr = await pool.query(
      `SELECT
        inv.id                AS "inventoryId",
        inv.location_id       AS "locationId",
        inv.stock_item_id     AS "stockItemId",
        inv.quantity,
        inv.average_rate      AS "averageRate",
        inv.total_value       AS "totalValue",
        inv.last_updated      AS "lastUpdated",
        si.name               AS "stockItemName",
        si.code               AS "stockItemCode",
        si.uom                AS "stockItemUom",
        si.stock_group_id     AS "stockGroupId",
        COALESCE(sg.name, '') AS "stockGroupName",
        COALESCE(sg.code, '') AS "stockGroupCode",
        CASE WHEN si.deleted_at IS NOT NULL THEN false ELSE si.active END AS "stockItemActive",
        NULL::text            AS barcode,
        si.category_id        AS "categoryId",
        sc.name               AS "categoryName",
        COALESCE(lp.selling_price, si.selling_price) AS "lastSellingPrice"
      FROM inventory inv
      INNER JOIN locations loc
        ON loc.id = inv.location_id
      LEFT JOIN stock_items si
        ON si.id = inv.stock_item_id
      LEFT JOIN stock_groups sg
        ON sg.id = si.stock_group_id
      LEFT JOIN stock_categories sc
        ON sc.id = si.category_id
      LEFT JOIN stock_item_location_prices lp
        ON lp.stock_item_id = inv.stock_item_id
        AND lp.location_id  = $1
      WHERE inv.location_id  = $1
        AND loc.company_id   = $2
        AND si.id IS NOT NULL
        AND (
          si.deleted_at IS NULL
          OR COALESCE(inv.quantity::numeric, 0) <> 0
        )
      ORDER BY si.code ASC`,
      [locationId, companyId]
    );

    const result = qr.rows;
    console.log(
      `[getLocationInventory] companyId=${companyId} locationId=${locationId} includeZero=false → ${result.length} rows`
    );
    return result;
  }

  // includeZero=true: start from stock_items so zero-stock items appear.
  const qr2 = await pool.query(
    `SELECT
      inv.id                AS "inventoryId",
      $1::int               AS "locationId",
      si.id                 AS "stockItemId",
      COALESCE(inv.quantity,     '0') AS quantity,
      COALESCE(inv.average_rate, '0') AS "averageRate",
      COALESCE(inv.total_value,  '0') AS "totalValue",
      inv.last_updated      AS "lastUpdated",
      si.name               AS "stockItemName",
      si.code               AS "stockItemCode",
      si.uom                AS "stockItemUom",
      si.stock_group_id     AS "stockGroupId",
      COALESCE(sg.name, '') AS "stockGroupName",
      COALESCE(sg.code, '') AS "stockGroupCode",
      CASE WHEN si.deleted_at IS NOT NULL THEN false ELSE si.active END AS "stockItemActive",
      si.barcode,
      si.category_id        AS "categoryId",
      sc.name               AS "categoryName",
      COALESCE(lp.selling_price, si.selling_price) AS "lastSellingPrice"
    FROM stock_items si
    LEFT JOIN inventory inv
      ON inv.stock_item_id = si.id
      AND inv.location_id  = $1
    LEFT JOIN stock_groups sg
      ON sg.id = si.stock_group_id
    LEFT JOIN stock_categories sc
      ON sc.id = si.category_id
    LEFT JOIN stock_item_location_prices lp
      ON lp.stock_item_id = si.id
      AND lp.location_id  = $1
    WHERE (
        (si.deleted_at IS NULL AND COALESCE(si.active, true) = true)
        OR
        (si.deleted_at IS NOT NULL AND COALESCE(NULLIF(CAST(inv.quantity AS TEXT), '')::numeric, 0) <> 0)
      )
      AND (
        si.company_id = $2
        OR EXISTS (
          SELECT 1 FROM inventory inv2
          WHERE inv2.stock_item_id = si.id
            AND inv2.location_id   = $1
        )
      )
    ORDER BY si.code ASC`,
    [locationId, companyId]
  );

  const result = qr2.rows;
  console.log(
    `[getLocationInventory] companyId=${companyId} locationId=${locationId} includeZero=true → ${result.length} rows`
  );
  return result;
}

export async function getCompanyInventory(companyId: number): Promise<any[]> {
  return await db
    .select({
      inventoryId: schema.inventory.id,
      locationId: schema.inventory.locationId,
      locationName: schema.locations.name,
      locationCode: schema.locations.code,
      stockItemId: schema.inventory.stockItemId,
      quantity: schema.inventory.quantity,
      averageRate: schema.inventory.averageRate,
      totalValue: schema.inventory.totalValue,
      lastUpdated: schema.inventory.lastUpdated,
      stockItemCode: schema.stockItems.code,
      stockItemName: schema.stockItems.name,
      stockItemUom: schema.stockItems.uom,
      stockGroupId: schema.stockItems.stockGroupId,
      stockGroupName: sql<string>`COALESCE(${schema.stockGroups.name}, '')`,
      stockGroupCode: sql<string>`COALESCE(${schema.stockGroups.code}, '')`,
      categoryId: schema.stockItems.categoryId,
      categoryName: schema.stockCategories.name,
    })
    .from(schema.inventory)
    .leftJoin(schema.stockItems, eq(schema.inventory.stockItemId, schema.stockItems.id))
    .leftJoin(schema.stockGroups, eq(schema.stockItems.stockGroupId, schema.stockGroups.id))
    .leftJoin(schema.stockCategories, eq(schema.stockItems.categoryId, schema.stockCategories.id))
    .innerJoin(schema.locations, eq(schema.inventory.locationId, schema.locations.id))
    .where(
      and(
        eq(schema.inventory.companyId, companyId),
        isNull(schema.locations.deletedAt),
        isNull(schema.stockItems.deletedAt)
      )
    )
    .orderBy(asc(schema.stockItems.code), asc(schema.locations.name));
}

// ---------------------------------------------------------------------------
// Stock Queries
// ---------------------------------------------------------------------------

export async function getInventoryByStockItem(stockItemId: number, companyId: number): Promise<any[]> {
  return await db
    .select({
      locationId: schema.inventory.locationId,
      quantity: schema.inventory.quantity,
      averageRate: schema.inventory.averageRate,
      totalValue: schema.inventory.totalValue,
      lastUpdated: schema.inventory.lastUpdated,
      locationName: schema.locations.name,
    })
    .from(schema.inventory)
    .leftJoin(schema.locations, eq(schema.inventory.locationId, schema.locations.id))
    .where(and(eq(schema.inventory.stockItemId, stockItemId), eq(schema.inventory.companyId, companyId)));
}

export async function updateInventory(
  locationId: number,
  stockItemId: number,
  quantity: string,
  averageRate: string,
  totalValue: string,
  companyId?: number
): Promise<void> {
  let resolvedCompanyId = companyId;
  if (!resolvedCompanyId) {
    const [loc] = await db
      .select({ companyId: schema.locations.companyId })
      .from(schema.locations)
      .where(eq(schema.locations.id, locationId));
    resolvedCompanyId = loc?.companyId ?? 0;
  }
  await db
    .insert(schema.inventory)
    .values({ locationId, stockItemId, quantity, averageRate, totalValue, companyId: resolvedCompanyId })
    .onConflictDoUpdate({
      target: [schema.inventory.locationId, schema.inventory.stockItemId],
      set: { quantity, averageRate, totalValue, lastUpdated: sql`now()` },
    });
}

export async function getTotalInventoryValue(companyId: number): Promise<number> {
  const [result] = await db
    .select({ total: sql<string>`COALESCE(SUM(CAST(${schema.inventory.totalValue} AS numeric)), 0)` })
    .from(schema.inventory)
    .where(eq(schema.inventory.companyId, companyId));
  return result ? parseFloat(result.total) : 0;
}

export async function getLowStockItems(companyId: number, threshold: number = 10): Promise<any[]> {
  return await db
    .select({
      stockItemId: schema.inventory.stockItemId,
      quantity: schema.inventory.quantity,
      stockItemName: schema.stockItems.name,
      stockItemCode: schema.stockItems.code,
      locationId: schema.inventory.locationId,
      locationName: schema.locations.name,
    })
    .from(schema.inventory)
    .leftJoin(schema.stockItems, eq(schema.inventory.stockItemId, schema.stockItems.id))
    .leftJoin(schema.locations, eq(schema.inventory.locationId, schema.locations.id))
    .where(
      and(eq(schema.inventory.companyId, companyId), sql`CAST(${schema.inventory.quantity} AS numeric) < ${threshold}`)
    );
}

export async function getInventorySummary(companyId: number): Promise<any[]> {
  return await db
    .select({
      stockItemId: schema.inventory.stockItemId,
      stockItemName: schema.stockItems.name,
      stockItemCode: schema.stockItems.code,
      totalQuantity: sql<string>`SUM(CAST(${schema.inventory.quantity} AS numeric))`,
      totalValue: sql<string>`SUM(CAST(${schema.inventory.totalValue} AS numeric))`,
      averageRate: sql<string>`CASE WHEN SUM(CAST(${schema.inventory.quantity} AS numeric)) > 0 THEN SUM(CAST(${schema.inventory.totalValue} AS numeric)) / SUM(CAST(${schema.inventory.quantity} AS numeric)) ELSE 0 END`,
    })
    .from(schema.inventory)
    .leftJoin(schema.stockItems, eq(schema.inventory.stockItemId, schema.stockItems.id))
    .where(eq(schema.inventory.companyId, companyId))
    .groupBy(schema.inventory.stockItemId, schema.stockItems.name, schema.stockItems.code);
}

export async function getStockItemsWithInventory(companyId: number, locationId?: number): Promise<any[]> {
  const conditions: any[] = [eq(schema.inventory.companyId, companyId)];
  if (locationId) conditions.push(eq(schema.inventory.locationId, locationId));
  return await db
    .select({
      stockItemId: schema.inventory.stockItemId,
      stockItemName: schema.stockItems.name,
      stockItemCode: schema.stockItems.code,
      stockItemUnit: schema.stockItems.unit,
      barcode: schema.stockItems.barcode,
      quantity: schema.inventory.quantity,
      averageRate: schema.inventory.averageRate,
      totalValue: schema.inventory.totalValue,
      locationId: schema.inventory.locationId,
      locationName: schema.locations.name,
      sellingPrice: schema.stockItemLocationPrices.sellingPrice,
    })
    .from(schema.inventory)
    .leftJoin(schema.stockItems, eq(schema.inventory.stockItemId, schema.stockItems.id))
    .leftJoin(schema.locations, eq(schema.inventory.locationId, schema.locations.id))
    .leftJoin(
      schema.stockItemLocationPrices,
      and(
        eq(schema.stockItemLocationPrices.stockItemId, schema.inventory.stockItemId),
        eq(schema.stockItemLocationPrices.locationId, schema.inventory.locationId)
      )
    )
    .where(and(...conditions, isNull(schema.stockItems.deletedAt)));
}

// ---------------------------------------------------------------------------
// Stock Group Location Archives
// ---------------------------------------------------------------------------

export async function archiveStockGroupAtLocation(
  companyId: number,
  locationId: number,
  stockGroupId: number | null,
  archivedBy: string,
  notes?: string
): Promise<schema.StockGroupLocationArchive> {
  const location = await getLocationById(locationId);

  let stockGroupName = "Uncategorized";
  let uncategorizedGroupId: number | null = null;

  if (stockGroupId !== null) {
    const stockGroup = await db
      .select()
      .from(schema.stockGroups)
      .where(eq(schema.stockGroups.id, stockGroupId))
      .limit(1);
    if (!stockGroup.length) throw new Error("Stock group not found");
    stockGroupName = stockGroup[0].name;
  } else {
    const uncategorizedGroup = await db
      .select()
      .from(schema.stockGroups)
      .where(and(eq(schema.stockGroups.companyId, companyId), sql`UPPER(${schema.stockGroups.code}) = 'UNCATEGORIZED'`))
      .limit(1);
    if (uncategorizedGroup.length > 0) uncategorizedGroupId = uncategorizedGroup[0].id;
  }

  if (!location) throw new Error("Location not found");

  let stockItems;
  if (stockGroupId !== null) {
    stockItems = await db
      .select()
      .from(schema.stockItems)
      .where(
        and(
          eq(schema.stockItems.companyId, companyId),
          eq(schema.stockItems.stockGroupId, stockGroupId),
          isNull(schema.stockItems.deletedAt)
        )
      );
  } else {
    if (uncategorizedGroupId !== null) {
      stockItems = await db
        .select()
        .from(schema.stockItems)
        .where(
          and(
            eq(schema.stockItems.companyId, companyId),
            or(isNull(schema.stockItems.stockGroupId), eq(schema.stockItems.stockGroupId, uncategorizedGroupId)),
            isNull(schema.stockItems.deletedAt)
          )
        );
    } else {
      stockItems = await db
        .select()
        .from(schema.stockItems)
        .where(
          and(
            eq(schema.stockItems.companyId, companyId),
            isNull(schema.stockItems.stockGroupId),
            isNull(schema.stockItems.deletedAt)
          )
        );
    }
  }

  if (stockItems.length === 0) throw new Error("No stock items found in this stock group");

  const stockItemIds = stockItems.map((item) => item.id);
  const inventoryRecords = await db
    .select({
      stockItemId: schema.inventory.stockItemId,
      quantity: schema.inventory.quantity,
      averageRate: schema.inventory.averageRate,
      totalValue: schema.inventory.totalValue,
    })
    .from(schema.inventory)
    .where(
      and(
        eq(schema.inventory.locationId, locationId),
        eq(schema.inventory.companyId, companyId),
        inArray(schema.inventory.stockItemId, stockItemIds),
        sql`${schema.inventory.quantity}::numeric > 0`
      )
    );

  if (inventoryRecords.length === 0) throw new Error("No inventory found for this stock group at this location");

  let totalQuantity = 0;
  let totalValue = 0;
  for (const inv of inventoryRecords) {
    totalQuantity += parseFloat(inv.quantity);
    totalValue += parseFloat(inv.totalValue);
  }

  const [archive] = await db
    .insert(schema.stockGroupLocationArchives)
    .values({
      companyId,
      locationId,
      stockGroupId,
      locationName: location.name,
      stockGroupName,
      totalQuantity: totalQuantity.toString(),
      totalValue: totalValue.toString(),
      itemCount: inventoryRecords.length,
      archivedBy,
      notes,
    })
    .returning();

  const archiveItems = inventoryRecords.map((inv) => {
    const item = stockItems.find((s) => s.id === inv.stockItemId);
    return {
      archiveId: archive.id,
      stockItemId: inv.stockItemId,
      stockItemCode: item?.code || "",
      stockItemName: item?.name || "",
      quantity: inv.quantity,
      averageRate: inv.averageRate,
      totalValue: inv.totalValue,
    };
  });
  await db.insert(schema.stockGroupLocationArchiveItems).values(archiveItems);

  await db
    .update(schema.inventory)
    .set({ quantity: "0", totalValue: "0", lastUpdated: sql`now()` })
    .where(
      and(
        eq(schema.inventory.locationId, locationId),
        eq(schema.inventory.companyId, companyId),
        inArray(schema.inventory.stockItemId, stockItemIds)
      )
    );

  return archive;
}

export async function getStockGroupLocationArchives(companyId: number): Promise<schema.StockGroupLocationArchive[]> {
  return await db
    .select()
    .from(schema.stockGroupLocationArchives)
    .where(
      and(
        eq(schema.stockGroupLocationArchives.companyId, companyId),
        isNull(schema.stockGroupLocationArchives.deletedAt),
        isNull(schema.stockGroupLocationArchives.restoredAt)
      )
    )
    .orderBy(desc(schema.stockGroupLocationArchives.archivedAt));
}

export async function getStockGroupLocationArchiveById(
  id: number,
  companyId: number
): Promise<schema.StockGroupLocationArchive | undefined> {
  const [archive] = await db
    .select()
    .from(schema.stockGroupLocationArchives)
    .where(
      and(eq(schema.stockGroupLocationArchives.id, id), eq(schema.stockGroupLocationArchives.companyId, companyId))
    );
  return archive;
}

export async function getStockGroupLocationArchiveItems(
  archiveId: number
): Promise<schema.StockGroupLocationArchiveItem[]> {
  return await db
    .select()
    .from(schema.stockGroupLocationArchiveItems)
    .where(eq(schema.stockGroupLocationArchiveItems.archiveId, archiveId));
}

export async function restoreStockGroupLocationArchive(
  archiveId: number,
  companyId: number
): Promise<schema.StockGroupLocationArchive> {
  const archive = await getStockGroupLocationArchiveById(archiveId, companyId);
  if (!archive) throw new Error("Archive not found");
  if (archive.restoredAt) throw new Error("Archive has already been restored");
  if (archive.deletedAt) throw new Error("Archive has been deleted");

  const archiveItems = await getStockGroupLocationArchiveItems(archiveId);

  for (const item of archiveItems) {
    const [existing] = await db
      .select()
      .from(schema.inventory)
      .where(
        and(
          eq(schema.inventory.stockItemId, item.stockItemId),
          eq(schema.inventory.locationId, archive.locationId),
          eq(schema.inventory.companyId, companyId)
        )
      );

    if (existing) {
      const existingQty = parseFloat(existing.quantity);
      const existingValue = parseFloat(existing.totalValue);
      const archivedQty = parseFloat(item.quantity);
      const archivedValue = parseFloat(item.totalValue);
      const newQty = existingQty + archivedQty;
      const newValue = existingValue + archivedValue;
      const newRate = newQty > 0 ? newValue / newQty : 0;

      await db
        .update(schema.inventory)
        .set({
          quantity: newQty.toString(),
          averageRate: newRate.toFixed(2),
          totalValue: newValue.toFixed(2),
          lastUpdated: sql`now()`,
        })
        .where(eq(schema.inventory.id, existing.id));
    } else {
      await db.insert(schema.inventory).values({
        companyId,
        locationId: archive.locationId,
        stockItemId: item.stockItemId,
        quantity: item.quantity,
        averageRate: item.averageRate,
        totalValue: item.totalValue,
      });
    }
  }

  const [updated] = await db
    .update(schema.stockGroupLocationArchives)
    .set({ restoredAt: sql`now()` })
    .where(eq(schema.stockGroupLocationArchives.id, archiveId))
    .returning();
  return updated;
}

export async function deleteStockGroupLocationArchive(archiveId: number, companyId: number): Promise<void> {
  const archive = await getStockGroupLocationArchiveById(archiveId, companyId);
  if (!archive) throw new Error("Archive not found");
  await db
    .update(schema.stockGroupLocationArchives)
    .set({ deletedAt: sql`now()` })
    .where(eq(schema.stockGroupLocationArchives.id, archiveId));
}

export async function permanentlyDeleteStockGroupLocationArchive(archiveId: number, companyId: number): Promise<void> {
  const archive = await getStockGroupLocationArchiveById(archiveId, companyId);
  if (!archive) throw new Error("Archive not found");
  await db
    .delete(schema.stockGroupLocationArchiveItems)
    .where(eq(schema.stockGroupLocationArchiveItems.archiveId, archiveId));
  await db.delete(schema.stockGroupLocationArchives).where(eq(schema.stockGroupLocationArchives.id, archiveId));
}
