import { eq } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "@shared/schema";

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
