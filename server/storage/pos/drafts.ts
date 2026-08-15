import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "@shared/schema";

export async function getAllDraftPosSales(userId: string, locationId?: number): Promise<unknown[]> {
  const { pool } = await import("../../db");
  const locationFilter = locationId ? "AND d.location_id = $2" : "";
  const params = locationId ? [userId, locationId] : [userId];
  const { rows } = await pool.query(
    `SELECT d.id,
            d.location_id,
            d.location_id AS "locationId",
            d.created_at,
            d.created_at AS "createdAt",
            d.updated_at,
            d.updated_at AS "updatedAt",
            COALESCE(s.item_count, 0)::int AS item_count,
            COALESCE(s.total_qty, 0) AS total_qty,
            COALESCE(s.total_amount, 0) AS total_amount
     FROM draft_pos_sales d
     LEFT JOIN (
       SELECT draft_id,
              COUNT(*) AS item_count,
              SUM(quantity::numeric) AS total_qty,
              SUM(amount::numeric) AS total_amount
       FROM draft_pos_sale_items
       GROUP BY draft_id
     ) s ON s.draft_id = d.id
     WHERE d.user_id = $1 ${locationFilter}
     ORDER BY COALESCE(d.updated_at, d.created_at) DESC`,
    params
  );
  return rows;
}

export async function getDraftPosSaleById(id: number): Promise<any | undefined> {
  const [draft] = await db.select().from(schema.draftPosSales).where(eq(schema.draftPosSales.id, id));
  if (!draft) return undefined;

  const items = await db
    .select({
      id: schema.draftPosSaleItems.id,
      stockItemId: schema.draftPosSaleItems.stockItemId,
      stockItemName: schema.stockItems.name,
      stockItemCode: schema.stockItems.code,
      quantity: schema.draftPosSaleItems.quantity,
      rate: schema.draftPosSaleItems.rate,
      amount: schema.draftPosSaleItems.amount,
    })
    .from(schema.draftPosSaleItems)
    .leftJoin(schema.stockItems, eq(schema.draftPosSaleItems.stockItemId, schema.stockItems.id))
    .where(eq(schema.draftPosSaleItems.draftId, id));

  return { ...draft, items };
}

export async function createDraftPosSale(
  draft: schema.InsertDraftPosSale,
  items: Array<{ stockItemId: number; quantity: string; rate: string; amount: string }>
): Promise<schema.DraftPosSale> {
  const [newDraft] = await db.insert(schema.draftPosSales).values(draft).returning();

  if (items && items.length > 0) {
    await db.insert(schema.draftPosSaleItems).values(
      items.map((item) => ({
        draftId: newDraft.id,
        stockItemId: item.stockItemId,
        quantity: item.quantity,
        rate: item.rate,
        amount: item.amount,
      }))
    );
  }

  return newDraft;
}

export async function updateDraftPosSale(
  id: number,
  draft: Partial<schema.InsertDraftPosSale>,
  items?: Array<{ stockItemId: number; quantity: string; rate: string; amount: string }>
): Promise<schema.DraftPosSale> {
  const [updatedDraft] = await db
    .update(schema.draftPosSales)
    .set({ ...draft, updatedAt: sql`now()` })
    .where(eq(schema.draftPosSales.id, id))
    .returning();

  if (items) {
    await db.delete(schema.draftPosSaleItems).where(eq(schema.draftPosSaleItems.draftId, id));
    if (items.length > 0) {
      await db.insert(schema.draftPosSaleItems).values(
        items.map((item) => ({
          draftId: id,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          rate: item.rate,
          amount: item.amount,
        }))
      );
    }
  }

  return updatedDraft;
}

export async function deleteDraftPosSale(id: number): Promise<void> {
  await db.delete(schema.draftPosSaleItems).where(eq(schema.draftPosSaleItems.draftId, id));
  await db.delete(schema.draftPosSales).where(eq(schema.draftPosSales.id, id));
}
