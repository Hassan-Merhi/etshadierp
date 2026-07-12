import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "../shared/schema";
import { db } from "../server/db";
import { adjustInventory, reverseInventoryByExactValue } from "../server/inventoryHelper";
import {
  cleanupTestData,
  closeTestServer,
  getInventoryRecord,
  seedTestData,
  type TestContext,
} from "./setup";

const TEST_PREFIX = "invint";

let ctx: TestContext;

async function setInventory(quantity: number, averageRate: number, totalValue: number): Promise<void> {
  const stockItemId = ctx.stockItemIds[0];
  const existing = await getInventoryRecord(ctx.locationId, stockItemId);

  if (existing) {
    await db
      .update(schema.inventory)
      .set({
        quantity: quantity.toFixed(3),
        averageRate: averageRate.toFixed(2),
        totalValue: totalValue.toFixed(2),
      })
      .where(eq(schema.inventory.id, existing.id));
    return;
  }

  await db.insert(schema.inventory).values({
    companyId: ctx.companyId,
    locationId: ctx.locationId,
    stockItemId,
    quantity: quantity.toFixed(3),
    averageRate: averageRate.toFixed(2),
    totalValue: totalValue.toFixed(2),
  });
}

async function negativeLayerQuantity(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COALESCE(SUM(qty), 0)::numeric AS qty
    FROM inventory_negative_layers
    WHERE company_id = ${ctx.companyId}
      AND location_id = ${ctx.locationId}
      AND stock_item_id = ${ctx.stockItemIds[0]}
  `);
  const row = (result as any).rows?.[0] ?? (result as any)[0];
  return Number(row?.qty ?? 0);
}

async function clearNegativeLayers(): Promise<void> {
  await db.execute(sql`
    DELETE FROM inventory_negative_layers
    WHERE company_id = ${ctx.companyId}
      AND location_id = ${ctx.locationId}
      AND stock_item_id = ${ctx.stockItemIds[0]}
  `);
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
}, 60_000);

afterAll(async () => {
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30_000);

beforeEach(async () => {
  await clearNegativeLayers();
  await setInventory(100, 10, 1000);
});

describe("negative inventory layer integrity", () => {
  it("records only incremental shortage across repeated deductions", async () => {
    await adjustInventory(
      db as any,
      ctx.locationId,
      ctx.stockItemIds[0],
      -150,
      ctx.companyId,
      undefined,
      "TEST",
    );

    expect(await negativeLayerQuantity()).toBe(50);

    await adjustInventory(
      db as any,
      ctx.locationId,
      ctx.stockItemIds[0],
      -10,
      ctx.companyId,
      undefined,
      "TEST",
    );

    const record = await getInventoryRecord(ctx.locationId, ctx.stockItemIds[0]);
    expect(Number(record!.quantity)).toBe(-60);
    expect(await negativeLayerQuantity()).toBe(60);
  });

  it("records only incremental shortage across repeated exact reversals", async () => {
    await reverseInventoryByExactValue(
      db as any,
      ctx.locationId,
      ctx.stockItemIds[0],
      150,
      1500,
      ctx.companyId,
      "TEST",
    );

    expect(await negativeLayerQuantity()).toBe(50);

    await reverseInventoryByExactValue(
      db as any,
      ctx.locationId,
      ctx.stockItemIds[0],
      10,
      100,
      ctx.companyId,
      "TEST",
    );

    const record = await getInventoryRecord(ctx.locationId, ctx.stockItemIds[0]);
    expect(Number(record!.quantity)).toBe(-60);
    expect(await negativeLayerQuantity()).toBe(60);
  });

  it("fully settles repeated shortage layers without phantom remainder", async () => {
    await adjustInventory(db as any, ctx.locationId, ctx.stockItemIds[0], -150, ctx.companyId, undefined, "TEST");
    await adjustInventory(db as any, ctx.locationId, ctx.stockItemIds[0], -10, ctx.companyId, undefined, "TEST");

    await adjustInventory(db as any, ctx.locationId, ctx.stockItemIds[0], 60, ctx.companyId, 12, "TEST");

    const record = await getInventoryRecord(ctx.locationId, ctx.stockItemIds[0]);
    expect(Number(record!.quantity)).toBe(0);
    expect(Number(record!.totalValue)).toBe(0);
    expect(await negativeLayerQuantity()).toBe(0);
  });
});