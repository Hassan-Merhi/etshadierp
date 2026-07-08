import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { eq } from "drizzle-orm";
import * as schema from "../shared/schema";
import { seedTestData, cleanupTestData, closeTestServer, TestContext } from "./setup";
import {
  buildStockTransferSuggestionContext,
  loadOtwStockByItem,
  matchLocationByName,
} from "../server/services/stockTransferAnalysis";

const PREFIX = "otwtx";

let ctx: TestContext;
let supplierId: number;

async function makeContainer(opts: {
  containerNumber: string;
  shopName?: string | null;
  eta?: string | null;
  trackingLastStatus?: string | null;
  trackingLastLocation?: string | null;
  status?: string;
}) {
  const [container] = await db
    .insert(schema.containers)
    .values({
      companyId: ctx.companyId,
      containerNumber: opts.containerNumber,
      supplierId,
      status: opts.status ?? "OTW",
      importDate: "2026-06-01",
      shopName: opts.shopName ?? null,
      eta: opts.eta ?? null,
      trackingLastStatus: opts.trackingLastStatus ?? null,
      trackingLastLocation: opts.trackingLastLocation ?? null,
    })
    .returning();
  return container;
}

async function makePoWithLine(containerId: number, stockItemId: number, quantity: number, poNumber: string) {
  const [po] = await db
    .insert(schema.purchaseOrders)
    .values({
      companyId: ctx.companyId,
      poNumber,
      containerId,
      supplierId,
      currency: "USD",
    })
    .returning();

  await db.insert(schema.poLineItems).values({
    poId: po.id,
    stockItemId,
    itemName: `line-${stockItemId}`,
    quantity: quantity.toFixed(3),
    rate: "1.00",
    lineTotal: quantity.toFixed(2),
  });
  return po;
}

beforeAll(async () => {
  ctx = await seedTestData(PREFIX);

  const [supplier] = await db
    .insert(schema.suppliers)
    .values({
      code: `${PREFIX}_SUP`,
      legalName: "Test OTW Supplier",
      email: "otwsupplier@example.com",
    })
    .returning();
  supplierId = supplier.id;
});

afterAll(async () => {
  // cleanupTestData deletes po_line_items/purchase_orders/containers for this
  // company before stockItems, so the supplier FK is free to delete after.
  await cleanupTestData(PREFIX);
  await db.delete(schema.suppliers).where(eq(schema.suppliers.id, supplierId));
  closeTestServer();
});

describe("loadOtwStockByItem", () => {
  it("aggregates OTW quantity for a stock item with no destination filter", async () => {
    const c1 = await makeContainer({ containerNumber: `${PREFIX}-C1` });
    await makePoWithLine(c1.id, ctx.stockItemIds[0], 10, `${PREFIX}-PO1`);

    const result = await loadOtwStockByItem(ctx.companyId);
    expect(result.otwQtyByItem.get(ctx.stockItemIds[0])).toBe(10);
    const details = result.otwDetailsByItem.get(ctx.stockItemIds[0]);
    expect(details).toBeDefined();
    expect(details![0].containerNumber).toBe(`${PREFIX}-C1`);
    expect(details![0].matchType).toBe("unknown"); // no destination given -> can't be "direct"
  });

  it("counts OTW qty even when shopName is set, if no destination is given to compare against", async () => {
    const c = await makeContainer({ containerNumber: `${PREFIX}-NODEST1`, shopName: "Some Shop With A Name" });
    await makePoWithLine(c.id, ctx.stockItemIds[1], 20, `${PREFIX}-PO-NODEST`);

    const result = await loadOtwStockByItem(ctx.companyId);
    expect(result.otwQtyByItem.get(ctx.stockItemIds[1])).toBe(20);
    const details = result.otwDetailsByItem.get(ctx.stockItemIds[1]);
    expect(details!.find((d) => d.containerNumber === `${PREFIX}-NODEST1`)!.matchType).toBe("unknown");
  });

  it("does not include containers with a non-OTW status", async () => {
    const before = (await loadOtwStockByItem(ctx.companyId)).otwQtyByItem.get(ctx.stockItemIds[1]) || 0;

    const c = await makeContainer({ containerNumber: `${PREFIX}-SOLD1`, status: "Delivered" });
    await makePoWithLine(c.id, ctx.stockItemIds[1], 99, `${PREFIX}-PO-SOLD`);

    const after = (await loadOtwStockByItem(ctx.companyId)).otwQtyByItem.get(ctx.stockItemIds[1]) || 0;
    expect(after).toBe(before); // the non-OTW-status container must not add anything
  });

  it("marks a container as direct match when shopName equals the destination location name", async () => {
    // fetch destination location name to use as shop name
    const [destLoc] = await db.select().from(schema.locations).where(eq(schema.locations.id, ctx.location2Id));
    const cDirect = await makeContainer({ containerNumber: `${PREFIX}-DIRECT2`, shopName: destLoc.name });
    await makePoWithLine(cDirect.id, ctx.stockItemIds[2], 7, `${PREFIX}-PO-DIRECT`);

    const result = await loadOtwStockByItem(ctx.companyId, ctx.location2Id);
    const details = result.otwDetailsByItem.get(ctx.stockItemIds[2]);
    expect(details!.some((d) => d.matchType === "direct")).toBe(true);
    expect(result.otwQtyByItem.get(ctx.stockItemIds[2])).toBe(7);
  });

  it("excludes a different-shop container's qty from a destination's counted total, but keeps it in details", async () => {
    const before = (await loadOtwStockByItem(ctx.companyId, ctx.location2Id)).otwQtyByItem.get(ctx.stockItemIds[0]) || 0;

    const cOther = await makeContainer({ containerNumber: `${PREFIX}-OTHER1`, shopName: "Some Totally Different Shop" });
    await makePoWithLine(cOther.id, ctx.stockItemIds[0], 15, `${PREFIX}-PO-OTHER`);

    const result = await loadOtwStockByItem(ctx.companyId, ctx.location2Id);
    const details = result.otwDetailsByItem.get(ctx.stockItemIds[0]);
    expect(details!.some((d) => d.matchType === "other" && d.containerNumber === `${PREFIX}-OTHER1`)).toBe(true);
    // "other" shop qty must not be counted toward this destination's total.
    const otherDetail = details!.find((d) => d.containerNumber === `${PREFIX}-OTHER1`)!;
    expect(otherDetail.quantity).toBe(15);
    const after = result.otwQtyByItem.get(ctx.stockItemIds[0]) || 0;
    expect(after).toBe(before); // 15 units from the other shop must not be added to the counted total
  });
});

describe("buildStockTransferSuggestionContext OTW integration", () => {
  it("reports otwAvailable and reduces/skips suggested qty when OTW covers destination need", async () => {
    // Build enough destination sales history to create demand, then cover it with OTW.
    const stockItemId = ctx.stockItemIds[0];

    // Give destination location some sales so destRate > 0 and it looks like it needs stock.
    const [voucher] = await db
      .insert(schema.vouchers)
      .values({
        companyId: ctx.companyId,
        voucherNumber: `${PREFIX}-SALE-1`,
        voucherType: "Sales",
        voucherDate: "2026-06-15",
        locationId: ctx.location2Id,
        totalAmount: "500.00",
        optional: false,
      })
      .returning();
    await db.insert(schema.salesItems).values({
      voucherId: voucher.id,
      stockItemId,
      quantity: "50.000",
      sellingPrice: "10.00",
      costPrice: "5.00",
      totalSales: "500.00",
      totalCost: "250.00",
      profit: "250.00",
    });

    const c = await makeContainer({ containerNumber: `${PREFIX}-COVER1`, eta: "2026-08-01" });
    await makePoWithLine(c.id, stockItemId, 500, `${PREFIX}-PO-COVER`);

    const ctxResult = await buildStockTransferSuggestionContext(
      ctx.companyId,
      ctx.locationId,
      ctx.location2Id,
      "2026-06-01",
      "2026-06-30"
    );

    expect(ctxResult.otwAvailable).toBe(true);
    expect(ctxResult.analysisSummary).toContain("Included Stock OTW from Inventory.");
    const item = ctxResult.items.find((i) => i.stockItemId === stockItemId);
    // Large OTW should fully cover destination need, so item should not be suggested at all.
    expect(item).toBeUndefined();
  });
});

describe("matchLocationByName null-safety", () => {
  it("does not throw and matches by name even if some location codes are falsy", async () => {
    const result = await matchLocationByName(ctx.companyId, `${PREFIX}_Warehouse2`);
    expect(result.matched).not.toBeNull();
    expect(result.matched!.id).toBe(ctx.location2Id);
  });
});
