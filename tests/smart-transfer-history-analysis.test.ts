import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "../server/db";
import * as schema from "../shared/schema";
import { analyzeLastTwoMultiSourceTransfers } from "../server/services/smartTransferHistoryAnalysis";

const RUN_ID = `stha-${Date.now()}`;
let companyId = 0;
let destinationId = 0;
let otherDestinationId = 0;
let sourceIds: number[] = [];
let itemAId = 0;
let itemBId = 0;
let olderVoucherNumber = "";
let newerVoucherNumber = "";

async function cleanup(): Promise<void> {
  const companyRows = await db
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(like(schema.companies.name, `${RUN_ID}%`));
  const companyIds = companyRows.map((row) => row.id);
  if (companyIds.length === 0) return;

  const voucherRows = await db
    .select({ id: schema.vouchers.id })
    .from(schema.vouchers)
    .where(inArray(schema.vouchers.companyId, companyIds));
  const voucherIds = voucherRows.map((row) => row.id);

  if (voucherIds.length > 0) {
    const transferRows = await db
      .select({ id: schema.stockTransferVouchers.id })
      .from(schema.stockTransferVouchers)
      .where(inArray(schema.stockTransferVouchers.voucherId, voucherIds));
    const transferIds = transferRows.map((row) => row.id);
    if (transferIds.length > 0) {
      await db.delete(schema.stockTransferItems).where(inArray(schema.stockTransferItems.transferId, transferIds));
      await db.delete(schema.stockTransferVouchers).where(inArray(schema.stockTransferVouchers.id, transferIds));
    }
    await db.delete(schema.salesItems).where(inArray(schema.salesItems.voucherId, voucherIds));
    await db.delete(schema.vouchers).where(inArray(schema.vouchers.id, voucherIds));
  }

  await db.delete(schema.inventory).where(inArray(schema.inventory.companyId, companyIds));
  await db.delete(schema.stockItems).where(inArray(schema.stockItems.companyId, companyIds));
  await db.delete(schema.stockGroups).where(inArray(schema.stockGroups.companyId, companyIds));
  await db.delete(schema.locations).where(inArray(schema.locations.companyId, companyIds));
  await db.delete(schema.companies).where(inArray(schema.companies.id, companyIds));
}

async function createVoucher(input: {
  voucherNumber: string;
  voucherType: "Stock Transfer" | "Sales";
  voucherDate: string;
  locationId: number;
  optional?: boolean;
  deleted?: boolean;
}) {
  const [voucher] = await db
    .insert(schema.vouchers)
    .values({
      companyId,
      locationId: input.locationId,
      voucherNumber: input.voucherNumber,
      voucherType: input.voucherType,
      voucherDate: input.voucherDate,
      description: RUN_ID,
      totalAmount: "0",
      optional: input.optional ?? false,
      deletedAt: input.deleted ? new Date() : null,
    })
    .returning();
  return voucher;
}

async function createTransfer(input: {
  voucherNumber: string;
  voucherDate: string;
  destinationLocationId: number;
  items: Array<{ sourceLocationId: number; stockItemId: number; quantity: number }>;
  optional?: boolean;
  deleted?: boolean;
}) {
  const voucher = await createVoucher({
    voucherNumber: input.voucherNumber,
    voucherType: "Stock Transfer",
    voucherDate: input.voucherDate,
    locationId: input.items[0].sourceLocationId,
    optional: input.optional,
    deleted: input.deleted,
  });
  const [transfer] = await db
    .insert(schema.stockTransferVouchers)
    .values({
      voucherId: voucher.id,
      sourceLocationId: input.items[0].sourceLocationId,
      destinationLocationId: input.destinationLocationId,
      notes: RUN_ID,
      inventoryApplied: input.optional !== true,
    })
    .returning();
  await db.insert(schema.stockTransferItems).values(
    input.items.map((item) => ({
      transferId: transfer.id,
      stockItemId: item.stockItemId,
      sourceLocationId: item.sourceLocationId,
      quantity: String(item.quantity),
      rate: "1",
      totalAmount: String(item.quantity),
    }))
  );
}

async function createSale(stockItemId: number, quantity: number, voucherDate: string, suffix: string) {
  const voucher = await createVoucher({
    voucherNumber: `${RUN_ID}-SALE-${suffix}`,
    voucherType: "Sales",
    voucherDate,
    locationId: destinationId,
  });
  await db.insert(schema.salesItems).values({
    voucherId: voucher.id,
    stockItemId,
    quantity: String(quantity),
    sellingPrice: "1",
    costPrice: "1",
    totalSales: String(quantity),
    totalCost: String(quantity),
    profit: "0",
  });
}

beforeAll(async () => {
  await cleanup();
  const [company] = await db
    .insert(schema.companies)
    .values({ code: RUN_ID.toUpperCase(), name: `${RUN_ID}-company`, baseCurrency: "USD" })
    .returning();
  companyId = company.id;

  const locationNames = ["Hadi 1", "Hadi 2", "Hadi 3", "Hadi 4", "Kolwezi", "Kolwezi 2"];
  const createdLocations = await db
    .insert(schema.locations)
    .values(locationNames.map((name, index) => ({ companyId, code: `${RUN_ID}-${index}`, name })))
    .returning();
  sourceIds = createdLocations.slice(0, 4).map((location) => location.id);
  destinationId = createdLocations[4].id;
  otherDestinationId = createdLocations[5].id;

  const [group] = await db
    .insert(schema.stockGroups)
    .values({ companyId, code: `${RUN_ID}-G`, name: `${RUN_ID}-group` })
    .returning();
  const createdItems = await db
    .insert(schema.stockItems)
    .values([
      { companyId, code: `${RUN_ID}-A`, name: "Item A", uom: "BALE", stockGroupId: group.id, active: true },
      { companyId, code: `${RUN_ID}-B`, name: "Item B", uom: "BALE", stockGroupId: group.id, active: true },
    ])
    .returning();
  itemAId = createdItems[0].id;
  itemBId = createdItems[1].id;

  await db.insert(schema.inventory).values([
    {
      companyId,
      locationId: destinationId,
      stockItemId: itemAId,
      quantity: "3",
      averageRate: "1",
      totalValue: "3",
    },
    {
      companyId,
      locationId: destinationId,
      stockItemId: itemBId,
      quantity: "18",
      averageRate: "1",
      totalValue: "18",
    },
  ]);

  olderVoucherNumber = `${RUN_ID}-OLDER`;
  newerVoucherNumber = `${RUN_ID}-NEWER`;
  await createTransfer({
    voucherNumber: olderVoucherNumber,
    voucherDate: "2026-06-01",
    destinationLocationId: destinationId,
    items: [
      { sourceLocationId: sourceIds[0], stockItemId: itemAId, quantity: 10 },
      { sourceLocationId: sourceIds[1], stockItemId: itemBId, quantity: 20 },
    ],
  });
  await createTransfer({
    voucherNumber: newerVoucherNumber,
    voucherDate: "2026-07-01",
    destinationLocationId: destinationId,
    items: [
      { sourceLocationId: sourceIds[2], stockItemId: itemAId, quantity: 12 },
      { sourceLocationId: sourceIds[3], stockItemId: itemBId, quantity: 15 },
    ],
  });

  // These are newer by date but must not qualify.
  await createTransfer({
    voucherNumber: `${RUN_ID}-DELETED`,
    voucherDate: "2026-07-15",
    destinationLocationId: destinationId,
    items: [{ sourceLocationId: sourceIds[0], stockItemId: itemAId, quantity: 99 }],
    deleted: true,
  });
  await createTransfer({
    voucherNumber: `${RUN_ID}-OPTIONAL`,
    voucherDate: "2026-07-18",
    destinationLocationId: destinationId,
    items: [{ sourceLocationId: sourceIds[0], stockItemId: itemAId, quantity: 99 }],
    optional: true,
  });
  await createTransfer({
    voucherNumber: `${RUN_ID}-OTHER-DEST`,
    voucherDate: "2026-07-20",
    destinationLocationId: otherDestinationId,
    items: [{ sourceLocationId: sourceIds[0], stockItemId: itemAId, quantity: 99 }],
  });

  await createSale(itemAId, 8, "2026-06-15", "A1");
  await createSale(itemBId, 4, "2026-06-20", "B1");
  await createSale(itemAId, 11, "2026-07-10", "A2");
  await createSale(itemBId, 2, "2026-07-11", "B2");
});

afterAll(async () => {
  await cleanup();
});

describe("analyzeLastTwoMultiSourceTransfers", () => {
  it("selects the last two completed vouchers rather than the last two item lines", async () => {
    const result = await analyzeLastTwoMultiSourceTransfers(companyId, sourceIds, destinationId, {
      asOfDate: "2026-07-22",
    });

    expect(result.newerTransfer?.voucherNumber).toBe(newerVoucherNumber);
    expect(result.olderTransfer?.voucherNumber).toBe(olderVoucherNumber);
    expect(result.newerTransfer?.items).toHaveLength(2);
    expect(result.olderTransfer?.items).toHaveLength(2);
  });

  it("keeps all four selected source locations isolated from the destination", async () => {
    const result = await analyzeLastTwoMultiSourceTransfers(companyId, sourceIds, destinationId, {
      asOfDate: "2026-07-22",
    });

    const historicalSourceIds = new Set(result.items.flatMap((item) => item.historicalSourceLocationIds));
    expect(historicalSourceIds).toEqual(new Set(sourceIds));
    expect(historicalSourceIds.has(destinationId)).toBe(false);
    expect(result.destinationLocationName).toBe("Kolwezi");
  });

  it("calculates sales separately between transfers and after the latest transfer", async () => {
    const result = await analyzeLastTwoMultiSourceTransfers(companyId, sourceIds, destinationId, {
      asOfDate: "2026-07-22",
    });
    const itemA = result.items.find((item) => item.stockItemId === itemAId)!;
    const itemB = result.items.find((item) => item.stockItemId === itemBId)!;

    expect(itemA.olderTransferQty).toBe(10);
    expect(itemA.newerTransferQty).toBe(12);
    expect(itemA.salesAfterOlderTransfer).toBe(8);
    expect(itemA.salesAfterNewerTransfer).toBe(11);
    expect(itemA.currentDestinationQty).toBe(3);
    expect(itemA.classification).toBe("strong_seller");

    expect(itemB.salesAfterOlderTransfer).toBe(4);
    expect(itemB.salesAfterNewerTransfer).toBe(2);
    expect(itemB.currentDestinationQty).toBe(18);
    expect(["slow_seller", "overstocked"]).toContain(itemB.classification);
  });

  it("rejects source locations that belong to another company or do not exist", async () => {
    await expect(
      analyzeLastTwoMultiSourceTransfers(companyId, [...sourceIds, 999999999], destinationId, {
        asOfDate: "2026-07-22",
      })
    ).rejects.toThrow(/Source location\(s\) not found/);
  });
});
