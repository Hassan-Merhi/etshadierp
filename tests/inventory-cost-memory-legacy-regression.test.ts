import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
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

const TEST_PREFIX = "inventory-cost-memory-legacy";
let ctx: TestContext;

async function setInventory(quantity: number, averageRate: number, totalValue: number): Promise<void> {
  const existing = await getInventoryRecord(ctx.locationId, ctx.stockItemIds[0]);
  if (!existing) throw new Error("Expected seeded inventory row");

  await db
    .update(schema.inventory)
    .set({
      quantity: quantity.toFixed(3),
      averageRate: averageRate.toFixed(2),
      totalValue: totalValue.toFixed(2),
    })
    .where(eq(schema.inventory.id, existing.id));
}

async function inventoryState() {
  const record = await getInventoryRecord(ctx.locationId, ctx.stockItemIds[0]);
  if (!record) throw new Error("Inventory row disappeared");
  return {
    quantity: Number(record.quantity),
    averageRate: Number(record.averageRate),
    totalValue: Number(record.totalValue ?? 0),
  };
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
}, 60_000);

beforeEach(async () => {
  await db.execute(sql`
    DELETE FROM inventory_negative_layers
    WHERE company_id = ${ctx.companyId}
      AND location_id = ${ctx.locationId}
      AND stock_item_id = ${ctx.stockItemIds[0]}
  `);
  await setInventory(100, 10, 1000);
});

afterAll(async () => {
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30_000);

describe("legacy inventory cost-memory regressions", () => {
  it("keeps zero asset value and non-negative cost memory below zero quantity", async () => {
    const result = await adjustInventory(
      db as any,
      ctx.locationId,
      ctx.stockItemIds[0],
      -150,
      ctx.companyId,
      undefined,
      "LEGACY_REGRESSION",
    );

    expect(result.newQuantity).toBe(-50);
    expect(result.newTotalValue).toBe(0);
    expect(result.averageRate).toBe(10);
    expect(await inventoryState()).toEqual({ quantity: -50, averageRate: 10, totalValue: 0 });
  });

  it("normalizes exact reversal value while preserving the previous valid rate", async () => {
    await setInventory(190, 5.56, 1056.4);

    await reverseInventoryByExactValue(
      db as any,
      ctx.locationId,
      ctx.stockItemIds[0],
      200,
      500,
      ctx.companyId,
      "LEGACY_REGRESSION",
    );

    expect(await inventoryState()).toEqual({ quantity: -10, averageRate: 5.56, totalValue: 0 });
  });

  it("remains stable across repeated matched receive and exact-reversal cycles", async () => {
    await setInventory(0, 0, 0);
    const expectedPositive = { quantity: 200, averageRate: 5, totalValue: 1000 };

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await adjustInventory(
        db as any,
        ctx.locationId,
        ctx.stockItemIds[0],
        200,
        ctx.companyId,
        5,
        "LEGACY_REGRESSION",
      );
      expect(await inventoryState()).toEqual(expectedPositive);

      await reverseInventoryByExactValue(
        db as any,
        ctx.locationId,
        ctx.stockItemIds[0],
        200,
        1000,
        ctx.companyId,
        "LEGACY_REGRESSION",
      );
      expect(await inventoryState()).toEqual({ quantity: 0, averageRate: 5, totalValue: 0 });
    }
  });

  it("re-offloads negative stock without accumulating phantom inventory value", async () => {
    await setInventory(-10, 0, 0);

    await adjustInventory(
      db as any,
      ctx.locationId,
      ctx.stockItemIds[0],
      200,
      ctx.companyId,
      1,
      "LEGACY_REGRESSION",
    );
    const firstOffload = await inventoryState();
    expect(firstOffload.quantity).toBe(190);
    expect(firstOffload.totalValue).toBe(200);
    expect(firstOffload.averageRate).toBeCloseTo(1.05, 2);

    await reverseInventoryByExactValue(
      db as any,
      ctx.locationId,
      ctx.stockItemIds[0],
      200,
      200,
      ctx.companyId,
      "LEGACY_REGRESSION",
    );
    expect(await inventoryState()).toEqual({
      quantity: -10,
      averageRate: firstOffload.averageRate,
      totalValue: 0,
    });

    await adjustInventory(
      db as any,
      ctx.locationId,
      ctx.stockItemIds[0],
      200,
      ctx.companyId,
      1,
      "LEGACY_REGRESSION",
    );
    const secondOffload = await inventoryState();

    expect(secondOffload.quantity).toBe(firstOffload.quantity);
    expect(secondOffload.totalValue).toBe(firstOffload.totalValue);
    expect(secondOffload.averageRate).toBe(firstOffload.averageRate);
  });
});
