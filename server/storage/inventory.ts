import { eq, and, or, isNull, isNotNull, asc, desc, sql, inArray, ilike, ne } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export async function getAllLocations(companyId: number): Promise<schema.Location[]> {
  return await db.select().from(schema.locations)
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

// ---------------------------------------------------------------------------
// Stock Groups
// ---------------------------------------------------------------------------

export async function getAllStockGroups(companyId: number): Promise<schema.StockGroup[]> {
  return await db.select().from(schema.stockGroups)
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

export async function updateStockGroup(id: number, updates: Partial<schema.InsertStockGroup>): Promise<schema.StockGroup> {
  const [updated] = await db.update(schema.stockGroups).set(updates).where(eq(schema.stockGroups.id, id)).returning();
  return updated;
}

export async function deleteStockGroup(id: number): Promise<void> {
  await db.delete(schema.stockGroups).where(eq(schema.stockGroups.id, id));
}

// ---------------------------------------------------------------------------
// Stock Items
// ---------------------------------------------------------------------------

export async function getAllStockItems(companyId: number, includeDeleted: boolean = false): Promise<schema.StockItem[]> {
  const conditions = [eq(schema.stockItems.companyId, companyId)];
  if (!includeDeleted) conditions.push(isNull(schema.stockItems.deletedAt));
  return await db.select().from(schema.stockItems).where(and(...conditions)).orderBy(asc(schema.stockItems.name));
}

export async function getStockItemById(id: number): Promise<schema.StockItem | undefined> {
  const [item] = await db.select().from(schema.stockItems).where(eq(schema.stockItems.id, id));
  return item;
}

export async function getStockItemByCode(code: string, companyId: number): Promise<schema.StockItem | undefined> {
  const [item] = await db.select().from(schema.stockItems).where(and(eq(schema.stockItems.code, code), eq(schema.stockItems.companyId, companyId), isNull(schema.stockItems.deletedAt)));
  return item;
}

export async function getStockItemByCodeOrAlias(codeOrAlias: string, companyId: number): Promise<schema.StockItem | undefined> {
  const [directMatch] = await db.select().from(schema.stockItems)
    .where(and(eq(schema.stockItems.code, codeOrAlias), eq(schema.stockItems.companyId, companyId), isNull(schema.stockItems.deletedAt)))
    .limit(1);
  if (directMatch) return directMatch;

  const [aliasMatch] = await db
    .select({ stockItem: schema.stockItems })
    .from(schema.codeAliases)
    .innerJoin(schema.stockItems, eq(schema.codeAliases.stockItemId, schema.stockItems.id))
    .where(and(eq(schema.codeAliases.alias, codeOrAlias), eq(schema.stockItems.companyId, companyId), isNull(schema.stockItems.deletedAt)))
    .limit(1);
  return aliasMatch?.stockItem;
}

export async function getStockItemByBarcode(barcode: string, companyId: number): Promise<schema.StockItem | undefined> {
  const [item] = await db.select().from(schema.stockItems)
    .where(and(eq(schema.stockItems.barcode, barcode), eq(schema.stockItems.companyId, companyId), isNull(schema.stockItems.deletedAt)));
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

export async function searchStockItems(companyId: number, query: string, limit: number = 20): Promise<schema.StockItem[]> {
  return await db.select().from(schema.stockItems)
    .where(and(
      eq(schema.stockItems.companyId, companyId),
      isNull(schema.stockItems.deletedAt),
      or(ilike(schema.stockItems.name, `%${query}%`), ilike(schema.stockItems.code, `%${query}%`))
    ))
    .orderBy(asc(schema.stockItems.name))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Code Aliases
// ---------------------------------------------------------------------------

export async function getCodeAliasesByStockItem(stockItemId: number): Promise<schema.CodeAlias[]> {
  return await db.select().from(schema.codeAliases).where(eq(schema.codeAliases.stockItemId, stockItemId));
}

export async function createCodeAlias(alias: schema.InsertCodeAlias): Promise<schema.CodeAlias> {
  const [created] = await db.insert(schema.codeAliases).values(alias).returning();
  return created;
}

export async function deleteCodeAlias(id: number): Promise<void> {
  await db.delete(schema.codeAliases).where(eq(schema.codeAliases.id, id));
}

// ---------------------------------------------------------------------------
// Location Prices
// ---------------------------------------------------------------------------

export async function getLocationPrices(companyId: number, locationId: number): Promise<schema.LocationPrice[]> {
  return await db.select().from(schema.locationPrices)
    .where(and(eq(schema.locationPrices.companyId, companyId), eq(schema.locationPrices.locationId, locationId)));
}

export async function getLocationPricesByStockItem(stockItemId: number, companyId: number): Promise<schema.LocationPrice[]> {
  return await db.select().from(schema.locationPrices)
    .where(and(eq(schema.locationPrices.stockItemId, stockItemId), eq(schema.locationPrices.companyId, companyId)));
}

export async function upsertLocationPrice(price: schema.InsertLocationPrice): Promise<schema.LocationPrice> {
  const [result] = await db
    .insert(schema.locationPrices)
    .values(price)
    .onConflictDoUpdate({
      target: [schema.locationPrices.locationId, schema.locationPrices.stockItemId],
      set: { sellingPrice: price.sellingPrice, updatedAt: sql`now()` },
    })
    .returning();
  return result;
}

export async function deleteLocationPrice(locationId: number, stockItemId: number): Promise<void> {
  await db.delete(schema.locationPrices)
    .where(and(eq(schema.locationPrices.locationId, locationId), eq(schema.locationPrices.stockItemId, stockItemId)));
}

// ---------------------------------------------------------------------------
// Location Inventory
// ---------------------------------------------------------------------------

export async function getLocationInventory(companyId: number, locationId: number): Promise<any[]> {
  return await db
    .select({
      stockItemId: schema.inventory.stockItemId,
      quantity: schema.inventory.quantity,
      averageRate: schema.inventory.averageRate,
      totalValue: schema.inventory.totalValue,
      lastUpdated: schema.inventory.lastUpdated,
      stockItemName: schema.stockItems.name,
      stockItemCode: schema.stockItems.code,
      stockItemUnit: schema.stockItems.unit,
      stockGroupId: schema.stockItems.stockGroupId,
      stockGroupName: schema.stockGroups.name,
      barcode: schema.stockItems.barcode,
    })
    .from(schema.inventory)
    .leftJoin(schema.stockItems, eq(schema.inventory.stockItemId, schema.stockItems.id))
    .leftJoin(schema.stockGroups, eq(schema.stockItems.stockGroupId, schema.stockGroups.id))
    .where(and(
      eq(schema.inventory.companyId, companyId),
      eq(schema.inventory.locationId, locationId),
      isNotNull(schema.stockItems.id),
      isNull(schema.stockItems.deletedAt)
    ));
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
    .where(and(
      eq(schema.inventory.companyId, companyId),
      sql`CAST(${schema.inventory.quantity} AS numeric) < ${threshold}`
    ));
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
      sellingPrice: schema.locationPrices.sellingPrice,
    })
    .from(schema.inventory)
    .leftJoin(schema.stockItems, eq(schema.inventory.stockItemId, schema.stockItems.id))
    .leftJoin(schema.locations, eq(schema.inventory.locationId, schema.locations.id))
    .leftJoin(schema.locationPrices, and(
      eq(schema.locationPrices.stockItemId, schema.inventory.stockItemId),
      eq(schema.locationPrices.locationId, schema.inventory.locationId)
    ))
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
    const stockGroup = await db.select().from(schema.stockGroups).where(eq(schema.stockGroups.id, stockGroupId)).limit(1);
    if (!stockGroup.length) throw new Error("Stock group not found");
    stockGroupName = stockGroup[0].name;
  } else {
    const uncategorizedGroup = await db.select().from(schema.stockGroups).where(and(
      eq(schema.stockGroups.companyId, companyId),
      sql`UPPER(${schema.stockGroups.code}) = 'UNCATEGORIZED'`
    )).limit(1);
    if (uncategorizedGroup.length > 0) uncategorizedGroupId = uncategorizedGroup[0].id;
  }

  if (!location) throw new Error("Location not found");

  let stockItems;
  if (stockGroupId !== null) {
    stockItems = await db.select().from(schema.stockItems).where(and(
      eq(schema.stockItems.companyId, companyId),
      eq(schema.stockItems.stockGroupId, stockGroupId),
      isNull(schema.stockItems.deletedAt)
    ));
  } else {
    if (uncategorizedGroupId !== null) {
      stockItems = await db.select().from(schema.stockItems).where(and(
        eq(schema.stockItems.companyId, companyId),
        or(isNull(schema.stockItems.stockGroupId), eq(schema.stockItems.stockGroupId, uncategorizedGroupId)),
        isNull(schema.stockItems.deletedAt)
      ));
    } else {
      stockItems = await db.select().from(schema.stockItems).where(and(
        eq(schema.stockItems.companyId, companyId),
        isNull(schema.stockItems.stockGroupId),
        isNull(schema.stockItems.deletedAt)
      ));
    }
  }

  if (stockItems.length === 0) throw new Error("No stock items found in this stock group");

  const stockItemIds = stockItems.map(item => item.id);
  const inventoryRecords = await db
    .select({
      stockItemId: schema.inventory.stockItemId,
      quantity: schema.inventory.quantity,
      averageRate: schema.inventory.averageRate,
      totalValue: schema.inventory.totalValue,
    })
    .from(schema.inventory)
    .where(and(
      eq(schema.inventory.locationId, locationId),
      eq(schema.inventory.companyId, companyId),
      inArray(schema.inventory.stockItemId, stockItemIds),
      sql`${schema.inventory.quantity}::numeric > 0`
    ));

  if (inventoryRecords.length === 0) throw new Error("No inventory found for this stock group at this location");

  let totalQuantity = 0;
  let totalValue = 0;
  for (const inv of inventoryRecords) {
    totalQuantity += parseFloat(inv.quantity);
    totalValue += parseFloat(inv.totalValue);
  }

  const [archive] = await db.insert(schema.stockGroupLocationArchives).values({
    companyId, locationId, stockGroupId,
    locationName: location.name,
    stockGroupName,
    totalQuantity: totalQuantity.toString(),
    totalValue: totalValue.toString(),
    itemCount: inventoryRecords.length,
    archivedBy, notes,
  }).returning();

  const archiveItems = inventoryRecords.map(inv => {
    const item = stockItems.find(s => s.id === inv.stockItemId);
    return {
      archiveId: archive.id,
      stockItemId: inv.stockItemId,
      stockItemCode: item?.code || '',
      stockItemName: item?.name || '',
      quantity: inv.quantity,
      averageRate: inv.averageRate,
      totalValue: inv.totalValue,
    };
  });
  await db.insert(schema.stockGroupLocationArchiveItems).values(archiveItems);

  await db.update(schema.inventory)
    .set({ quantity: "0", totalValue: "0", lastUpdated: sql`now()` })
    .where(and(
      eq(schema.inventory.locationId, locationId),
      eq(schema.inventory.companyId, companyId),
      inArray(schema.inventory.stockItemId, stockItemIds)
    ));

  return archive;
}

export async function getStockGroupLocationArchives(companyId: number): Promise<schema.StockGroupLocationArchive[]> {
  return await db.select().from(schema.stockGroupLocationArchives)
    .where(and(
      eq(schema.stockGroupLocationArchives.companyId, companyId),
      isNull(schema.stockGroupLocationArchives.deletedAt),
      isNull(schema.stockGroupLocationArchives.restoredAt)
    ))
    .orderBy(desc(schema.stockGroupLocationArchives.archivedAt));
}

export async function getStockGroupLocationArchiveById(id: number, companyId: number): Promise<schema.StockGroupLocationArchive | undefined> {
  const [archive] = await db.select().from(schema.stockGroupLocationArchives)
    .where(and(eq(schema.stockGroupLocationArchives.id, id), eq(schema.stockGroupLocationArchives.companyId, companyId)));
  return archive;
}

export async function getStockGroupLocationArchiveItems(archiveId: number): Promise<schema.StockGroupLocationArchiveItem[]> {
  return await db.select().from(schema.stockGroupLocationArchiveItems)
    .where(eq(schema.stockGroupLocationArchiveItems.archiveId, archiveId));
}

export async function restoreStockGroupLocationArchive(archiveId: number, companyId: number): Promise<schema.StockGroupLocationArchive> {
  const archive = await getStockGroupLocationArchiveById(archiveId, companyId);
  if (!archive) throw new Error("Archive not found");
  if (archive.restoredAt) throw new Error("Archive has already been restored");
  if (archive.deletedAt) throw new Error("Archive has been deleted");

  const archiveItems = await getStockGroupLocationArchiveItems(archiveId);

  for (const item of archiveItems) {
    const [existing] = await db.select().from(schema.inventory)
      .where(and(
        eq(schema.inventory.stockItemId, item.stockItemId),
        eq(schema.inventory.locationId, archive.locationId),
        eq(schema.inventory.companyId, companyId)
      ));

    if (existing) {
      const existingQty = parseFloat(existing.quantity);
      const existingValue = parseFloat(existing.totalValue);
      const archivedQty = parseFloat(item.quantity);
      const archivedValue = parseFloat(item.totalValue);
      const newQty = existingQty + archivedQty;
      const newValue = existingValue + archivedValue;
      const newRate = newQty > 0 ? newValue / newQty : 0;

      await db.update(schema.inventory).set({
        quantity: newQty.toString(),
        averageRate: newRate.toFixed(2),
        totalValue: newValue.toFixed(2),
        lastUpdated: sql`now()`,
      }).where(eq(schema.inventory.id, existing.id));
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

  const [updated] = await db.update(schema.stockGroupLocationArchives)
    .set({ restoredAt: sql`now()` })
    .where(eq(schema.stockGroupLocationArchives.id, archiveId))
    .returning();
  return updated;
}

export async function deleteStockGroupLocationArchive(archiveId: number, companyId: number): Promise<void> {
  const archive = await getStockGroupLocationArchiveById(archiveId, companyId);
  if (!archive) throw new Error("Archive not found");
  await db.update(schema.stockGroupLocationArchives)
    .set({ deletedAt: sql`now()` })
    .where(eq(schema.stockGroupLocationArchives.id, archiveId));
}

export async function permanentlyDeleteStockGroupLocationArchive(archiveId: number, companyId: number): Promise<void> {
  const archive = await getStockGroupLocationArchiveById(archiveId, companyId);
  if (!archive) throw new Error("Archive not found");
  await db.delete(schema.stockGroupLocationArchiveItems).where(eq(schema.stockGroupLocationArchiveItems.archiveId, archiveId));
  await db.delete(schema.stockGroupLocationArchives).where(eq(schema.stockGroupLocationArchives.id, archiveId));
}
