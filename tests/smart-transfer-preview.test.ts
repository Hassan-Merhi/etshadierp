import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import * as schema from "../shared/schema";
import { buildSmartTransferPreview } from "../server/services/smartTransferAllocation";

const PREFIX = `smart-preview-${Date.now()}`;

let companyId: number;
let destinationId: number;
let sourceIds: number[] = [];
let groupAId: number;
let groupBId: number;
let itemAId: number;
let itemBId: number;

async function createLocation(name: string, code: string): Promise<number> {
  const [row] = await db.insert(schema.locations).values({ companyId, name, code }).returning();
  return row.id;
}

async function createTransfer(
  voucherNumber: string,
  voucherDate: string,
  lines: Array<{ stockItemId: number; sourceLocationId: number; quantity: number }>
) {
  const [voucher] = await db
    .insert(schema.vouchers)
    .values({
      companyId,
      locationId: lines[0].sourceLocationId,
      voucherNumber,
      voucherType: "Stock Transfer",
      voucherDate,
      description: `${PREFIX} completed transfer`,
      totalAmount: "0",
      currency: "USD",
      optional: false,
    })
    .returning();

  const [transfer] = await db
    .insert(schema.stockTransferVouchers)
    .values({
      voucherId: voucher.id,
      sourceLocationId: lines[0].sourceLocationId,
      destinationLocationId: destinationId,
      notes: PREFIX,
      inventoryApplied: true,
    })
    .returning();

  await db.insert(schema.stockTransferItems).values(
    lines.map((line) => ({
      transferId: transfer.id,
      stockItemId: line.stockItemId,
      sourceLocationId: line.sourceLocationId,
      quantity: String(line.quantity),
      rate: "1.00",
      totalAmount: String(line.quantity),
    }))
  );
}

async function createSale(voucherNumber: string, voucherDate: string, stockItemId: number, quantity: number) {
  const [voucher] = await db
    .insert(schema.vouchers)
    .values({
      companyId,
      locationId: destinationId,
      voucherNumber,
      voucherType: "Sales",
      voucherDate,
      description: `${PREFIX} destination sale`,
      totalAmount: String(quantity * 2),
      currency: "USD",
      optional: false,
    })
    .returning();

  await db.insert(schema.salesItems).values({
    voucherId: voucher.id,
    stockItemId,
    quantity: String(quantity),
    sellingPrice: "2.000000",
    costPrice: "1.00",
    totalSales: String(quantity * 2),
    totalCost: String(quantity),
    profit: String(quantity),
  });
}

async function setInventory(locationId: number, stockItemId: number, quantity: number) {
  await db.insert(schema.inventory).values({
    companyId,
    locationId,
    stockItemId,
    quantity: String(quantity),
    averageRate: "1.00",
    totalValue: String(quantity),
  });
}

async function cleanup() {
  if (!companyId) return;

  const companyVouchers = await db
    .select({ id: schema.vouchers.id })
    .from(schema.vouchers)
    .where(eq(schema.vouchers.companyId, companyId));
  const voucherIds = companyVouchers.map((row) => row.id);

  if (voucherIds.length > 0) {
    const transfers = await db
      .select({ id: schema.stockTransferVouchers.id })
      .from(schema.stockTransferVouchers)
      .where(inArray(schema.stockTransferVouchers.voucherId, voucherIds));
    const transferIds = transfers.map((row) => row.id);
    if (transferIds.length > 0) {
      await db.delete(schema.stockTransferItems).where(inArray(schema.stockTransferItems.transferId, transferIds));
      await db.delete(schema.stockTransferVouchers).where(inArray(schema.stockTransferVouchers.id, transferIds));
    }
    await db.delete(schema.vouchers).where(inArray(schema.vouchers.id, voucherIds));
  }

  await db.delete(schema.inventory).where(eq(schema.inventory.companyId, companyId));
  await db.delete(schema.stockItems).where(eq(schema.stockItems.companyId, companyId));
  await db.delete(schema.stockGroups).where(eq(schema.stockGroups.companyId, companyId));
  await db.delete(schema.locations).where(eq(schema.locations.companyId, companyId));
  await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
}

beforeAll(async () => {
  const [company] = await db
    .insert(schema.companies)
    .values({ code: `${PREFIX}-CO`, name: `${PREFIX} Company`, baseCurrency: "USD" })
    .returning();
  companyId = company.id;

  destinationId = await createLocation("Kolwezi", `${PREFIX}-DEST`);
  sourceIds = await Promise.all([
    createLocation("Hadi 1", `${PREFIX}-H1`),
    createLocation("Hadi 2", `${PREFIX}-H2`),
    createLocation("Hadi 3", `${PREFIX}-H3`),
    createLocation("Hadi 4", `${PREFIX}-H4`),
  ]);

  const [groupA] = await db
    .insert(schema.stockGroups)
    .values({ companyId, code: `${PREFIX}-GA`, name: "Fast Sellers" })
    .returning();
  const [groupB] = await db
    .insert(schema.stockGroups)
    .values({ companyId, code: `${PREFIX}-GB`, name: "Normal Sellers" })
    .returning();
  groupAId = groupA.id;
  groupBId = groupB.id;

  const [itemA] = await db
    .insert(schema.stockItems)
    .values({
      companyId,
      code: `${PREFIX}-A`,
      name: "Item A Strong",
      uom: "BALE",
      stockGroupId: groupAId,
      active: true,
    })
    .returning();
  const [itemB] = await db
    .insert(schema.stockItems)
    .values({
      companyId,
      code: `${PREFIX}-B`,
      name: "Item B Normal",
      uom: "BALE",
      stockGroupId: groupBId,
      active: true,
    })
    .returning();
  itemAId = itemA.id;
  itemBId = itemB.id;

  await createTransfer(`${PREFIX}-OLD`, "2026-07-01", [
    { stockItemId: itemAId, sourceLocationId: sourceIds[0], quantity: 10 },
    { stockItemId: itemAId, sourceLocationId: sourceIds[1], quantity: 10 },
    { stockItemId: itemBId, sourceLocationId: sourceIds[2], quantity: 5 },
    { stockItemId: itemBId, sourceLocationId: sourceIds[3], quantity: 5 },
  ]);
  await createTransfer(`${PREFIX}-NEW`, "2026-07-15", [
    { stockItemId: itemAId, sourceLocationId: sourceIds[2], quantity: 10 },
    { stockItemId: itemAId, sourceLocationId: sourceIds[3], quantity: 10 },
    { stockItemId: itemBId, sourceLocationId: sourceIds[0], quantity: 5 },
    { stockItemId: itemBId, sourceLocationId: sourceIds[1], quantity: 5 },
  ]);

  await createSale(`${PREFIX}-SALE-A1`, "2026-07-05", itemAId, 18);
  await createSale(`${PREFIX}-SALE-A2`, "2026-07-18", itemAId, 18);
  await createSale(`${PREFIX}-SALE-B1`, "2026-07-06", itemBId, 5);
  await createSale(`${PREFIX}-SALE-B2`, "2026-07-19", itemBId, 5);

  for (const sourceId of sourceIds) {
    await setInventory(sourceId, itemAId, 20);
    await setInventory(sourceId, itemBId, 10);
  }
  await setInventory(destinationId, itemAId, 2);
  await setInventory(destinationId, itemBId, 3);
});

afterAll(async () => {
  await cleanup();
});

describe("buildSmartTransferPreview", () => {
  it("generates an exact target across four sources while preserving reserves", async () => {
    const beforeInventory = await db
      .select({ locationId: schema.inventory.locationId, stockItemId: schema.inventory.stockItemId, quantity: schema.inventory.quantity })
      .from(schema.inventory)
      .where(eq(schema.inventory.companyId, companyId));

    const result = await buildSmartTransferPreview(companyId, sourceIds, destinationId, 50, {
      asOfDate: "2026-07-22",
      includeOtw: false,
      minimumSourceReserve: 5,
      targetCoverageDays: 21,
    });

    expect(result.readOnly).toBe(true);
    expect(result.achievedQuantity).toBe(50);
    expect(result.shortfall).toBe(false);
    expect(result.lines.reduce((sum, line) => sum + line.suggestedQuantity, 0)).toBe(50);
    expect(new Set(result.lines.map((line) => line.sourceLocationId))).toEqual(new Set(sourceIds));
    expect(result.lines.every((line) => line.suggestedQuantity <= line.availableAtSource)).toBe(true);
    expect(result.lines.every((line) => line.sourceReserveQty === 5)).toBe(true);
    expect(result.lines.every((line) => line.sourceLocationId !== destinationId)).toBe(true);

    const afterInventory = await db
      .select({ locationId: schema.inventory.locationId, stockItemId: schema.inventory.stockItemId, quantity: schema.inventory.quantity })
      .from(schema.inventory)
      .where(eq(schema.inventory.companyId, companyId));
    expect(afterInventory).toEqual(beforeInventory);
  });

  it("applies the selected stock-group filter", async () => {
    const result = await buildSmartTransferPreview(companyId, sourceIds, destinationId, 30, {
      asOfDate: "2026-07-22",
      includeOtw: false,
      minimumSourceReserve: 5,
      stockGroupIds: [groupAId],
    });

    expect(result.achievedQuantity).toBe(30);
    expect(new Set(result.lines.map((line) => line.stockItemId))).toEqual(new Set([itemAId]));
    expect(result.excludedItems.some((item) => item.stockItemId === itemBId && /stock-group filter/i.test(item.reason))).toBe(
      true
    );
  });

  it("returns an explainable shortfall when reserves leave insufficient stock", async () => {
    const result = await buildSmartTransferPreview(companyId, sourceIds, destinationId, 50, {
      asOfDate: "2026-07-22",
      includeOtw: false,
      minimumSourceReserve: 19,
    });

    expect(result.achievedQuantity).toBe(4);
    expect(result.shortfall).toBe(true);
    expect(result.shortfallQuantity).toBe(46);
    expect(result.warnings.some((warning) => /short by 46/i.test(warning))).toBe(true);
  });

  it("returns source totals matching the generated preview lines", async () => {
    const result = await buildSmartTransferPreview(companyId, sourceIds, destinationId, 40, {
      asOfDate: "2026-07-22",
      includeOtw: false,
      minimumSourceReserve: 5,
    });

    const lineTotal = result.lines.reduce((sum, line) => sum + line.suggestedQuantity, 0);
    const sourceTotal = result.totalsBySource.reduce((sum, source) => sum + source.suggestedQuantity, 0);
    expect(sourceTotal).toBe(lineTotal);
    expect(result.summary).toMatch(/read-only smart transfer preview/i);
  });
});
