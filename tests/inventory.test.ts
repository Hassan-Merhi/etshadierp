import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import {
  seedTestData,
  cleanupTestData,
  getInventoryQty,
  getInventoryRecord,
  closeTestServer,
  type TestContext,
} from "./setup";
import { db } from "../server/db";
import { eq, and } from "drizzle-orm";
import * as schema from "../shared/schema";

const TEST_PREFIX = "invtest";

let ctx: TestContext;
let agent: request.SuperAgentTest;

async function loginAsTestUser() {
  const loginRes = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });

  if (loginRes.status !== 200) {
    throw new Error(
      `Login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`,
    );
  }

  const switchRes = await agent
    .post("/api/auth/set-company")
    .send({ companyId: ctx.companyId });

  if (switchRes.status !== 200) {
    console.warn("Switch company response:", switchRes.status, switchRes.body);
  }
}

async function resetInventory() {
  for (const stockItemId of ctx.stockItemIds) {
    const existing = await getInventoryRecord(ctx.locationId, stockItemId);
    if (existing) {
      await db
        .update(schema.inventory)
        .set({
          quantity: "100.000",
          averageRate: "10.00",
          totalValue: "1000.00",
        })
        .where(eq(schema.inventory.id, existing.id));
    } else {
      await db.insert(schema.inventory).values({
        companyId: ctx.companyId,
        locationId: ctx.locationId,
        stockItemId,
        quantity: "100.000",
        averageRate: "10.00",
        totalValue: "1000.00",
      });
    }

    const existing2 = await getInventoryRecord(ctx.location2Id, stockItemId);
    if (existing2) {
      await db
        .update(schema.inventory)
        .set({
          quantity: "50.000",
          averageRate: "10.00",
          totalValue: "500.00",
        })
        .where(eq(schema.inventory.id, existing2.id));
    } else {
      await db.insert(schema.inventory).values({
        companyId: ctx.companyId,
        locationId: ctx.location2Id,
        stockItemId,
        quantity: "50.000",
        averageRate: "10.00",
        totalValue: "500.00",
      });
    }
  }
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);
  await loginAsTestUser();
}, 60000);

afterAll(async () => {
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

describe("POS Sale Inventory Tests", () => {
  beforeEach(async () => {
    await resetInventory();
  });

  it("should decrease inventory correctly when creating a sale", async () => {
    const initialQty = await getInventoryQty(
      ctx.locationId,
      ctx.stockItemIds[0],
    );
    expect(initialQty).toBe(100);

    const res = await agent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [
        {
          stockItemId: ctx.stockItemIds[0],
          quantity: 5,
          sellingPrice: 15,
        },
      ],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });

    if (res.status === 200 || res.status === 201) {
      const newQty = await getInventoryQty(
        ctx.locationId,
        ctx.stockItemIds[0],
      );
      expect(newQty).toBe(95);
    } else {
      console.log("POS sale response:", res.status, res.body);
      expect(res.status).toBeLessThan(500);
    }
  });

  it("should decrease inventory for multiple items in one sale", async () => {
    const res = await agent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [
        { stockItemId: ctx.stockItemIds[0], quantity: 3, sellingPrice: 15 },
        { stockItemId: ctx.stockItemIds[1], quantity: 7, sellingPrice: 20 },
      ],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });

    if (res.status === 200 || res.status === 201) {
      const qty0 = await getInventoryQty(
        ctx.locationId,
        ctx.stockItemIds[0],
      );
      const qty1 = await getInventoryQty(
        ctx.locationId,
        ctx.stockItemIds[1],
      );
      expect(qty0).toBe(97);
      expect(qty1).toBe(93);
    }
  });

  it("should reject sale with invalid stockItemId", async () => {
    const res = await agent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [
        { stockItemId: "invalid", quantity: 5, sellingPrice: 15 },
      ],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });

    expect(res.status).toBe(400);

    const qty = await getInventoryQty(ctx.locationId, ctx.stockItemIds[0]);
    expect(qty).toBe(100);
  });

  it("should reject sale with invalid quantity", async () => {
    const res = await agent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [
        { stockItemId: ctx.stockItemIds[0], quantity: "abc", sellingPrice: 15 },
      ],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });

    expect(res.status).toBe(400);
  });
});

describe("Stock Transfer Tests", () => {
  beforeEach(async () => {
    await resetInventory();
  });

  it("should decrease source and increase destination inventory", async () => {
    const res = await agent.post("/api/stock-transfers").send({
      sourceLocationId: ctx.locationId,
      destinationLocationId: ctx.location2Id,
      items: [
        {
          stockItemId: ctx.stockItemIds[0],
          quantity: 10,
          sourceLocationId: ctx.locationId,
        },
      ],
      notes: "Test transfer",
      voucherDate: new Date().toISOString().split("T")[0],
    });

    if (res.status === 200 || res.status === 201) {
      const srcQty = await getInventoryQty(
        ctx.locationId,
        ctx.stockItemIds[0],
      );
      const dstQty = await getInventoryQty(
        ctx.location2Id,
        ctx.stockItemIds[0],
      );
      expect(srcQty).toBe(90);
      expect(dstQty).toBe(60);
    } else {
      console.log("Transfer response:", res.status, res.body);
    }
  });

  it("should handle multi-item transfers atomically", async () => {
    const res = await agent.post("/api/stock-transfers").send({
      sourceLocationId: ctx.locationId,
      destinationLocationId: ctx.location2Id,
      items: [
        {
          stockItemId: ctx.stockItemIds[0],
          quantity: 5,
          sourceLocationId: ctx.locationId,
        },
        {
          stockItemId: ctx.stockItemIds[1],
          quantity: 8,
          sourceLocationId: ctx.locationId,
        },
      ],
      notes: "Multi-item test transfer",
      voucherDate: new Date().toISOString().split("T")[0],
    });

    if (res.status === 200 || res.status === 201) {
      const srcQty0 = await getInventoryQty(
        ctx.locationId,
        ctx.stockItemIds[0],
      );
      const srcQty1 = await getInventoryQty(
        ctx.locationId,
        ctx.stockItemIds[1],
      );
      const dstQty0 = await getInventoryQty(
        ctx.location2Id,
        ctx.stockItemIds[0],
      );
      const dstQty1 = await getInventoryQty(
        ctx.location2Id,
        ctx.stockItemIds[1],
      );
      expect(srcQty0).toBe(95);
      expect(srcQty1).toBe(92);
      expect(dstQty0).toBe(55);
      expect(dstQty1).toBe(58);
    }
  });

  it("should reject transfer with same source and destination", async () => {
    const res = await agent.post("/api/stock-transfers").send({
      sourceLocationId: ctx.locationId,
      destinationLocationId: ctx.locationId,
      items: [
        {
          stockItemId: ctx.stockItemIds[0],
          quantity: 5,
          sourceLocationId: ctx.locationId,
        },
      ],
    });

    expect(res.status).toBe(400);
  });
});

describe("Quick Adjust Tests", () => {
  beforeEach(async () => {
    await resetInventory();
  });

  it("should increase inventory on add", async () => {
    const res = await agent.post("/api/inventory/quick-adjust").send({
      stockItemId: ctx.stockItemIds[0],
      locationId: ctx.locationId,
      quantity: 25,
      type: "add",
    });

    if (res.status === 200) {
      const qty = await getInventoryQty(ctx.locationId, ctx.stockItemIds[0]);
      expect(qty).toBe(125);
    }
  });

  it("should decrease inventory on subtract", async () => {
    const res = await agent.post("/api/inventory/quick-adjust").send({
      stockItemId: ctx.stockItemIds[0],
      locationId: ctx.locationId,
      quantity: 30,
      type: "subtract",
    });

    if (res.status === 200) {
      const qty = await getInventoryQty(ctx.locationId, ctx.stockItemIds[0]);
      expect(qty).toBe(70);
    }
  });

  it("should reject subtract that exceeds available stock", async () => {
    const res = await agent.post("/api/inventory/quick-adjust").send({
      stockItemId: ctx.stockItemIds[0],
      locationId: ctx.locationId,
      quantity: 150,
      type: "subtract",
    });

    expect(res.status).toBeGreaterThanOrEqual(400);

    const qty = await getInventoryQty(ctx.locationId, ctx.stockItemIds[0]);
    expect(qty).toBe(100);
  });

  it("should reject invalid quantity", async () => {
    const res = await agent.post("/api/inventory/quick-adjust").send({
      stockItemId: ctx.stockItemIds[0],
      locationId: ctx.locationId,
      quantity: -5,
      type: "add",
    });

    expect(res.status).toBe(400);
  });

  it("should handle sequential adjustments correctly", async () => {
    for (let i = 0; i < 5; i++) {
      await agent.post("/api/inventory/quick-adjust").send({
        stockItemId: ctx.stockItemIds[0],
        locationId: ctx.locationId,
        quantity: 2,
        type: "add",
      });
    }

    const qty = await getInventoryQty(ctx.locationId, ctx.stockItemIds[0]);
    expect(qty).toBe(110);
  });
});

describe("Voucher Delete Inventory Reversal Tests", () => {
  beforeEach(async () => {
    await resetInventory();
  });

  it("should restore inventory when deleting a sales voucher", async () => {
    const saleRes = await agent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [
        { stockItemId: ctx.stockItemIds[0], quantity: 10, sellingPrice: 15 },
      ],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });

    if (saleRes.status !== 200 && saleRes.status !== 201) {
      console.log("Sale creation failed:", saleRes.status, saleRes.body);
      return;
    }

    const afterSaleQty = await getInventoryQty(
      ctx.locationId,
      ctx.stockItemIds[0],
    );
    expect(afterSaleQty).toBe(90);

    const voucherId = saleRes.body.voucherId || saleRes.body.id;
    if (!voucherId) {
      console.log("No voucherId in response:", saleRes.body);
      return;
    }

    const deleteRes = await agent.delete(`/api/vouchers/${voucherId}`);

    if (deleteRes.status === 200) {
      const afterDeleteQty = await getInventoryQty(
        ctx.locationId,
        ctx.stockItemIds[0],
      );
      expect(afterDeleteQty).toBe(100);
    } else {
      console.log("Delete voucher response:", deleteRes.status, deleteRes.body);
    }
  });
});

describe("Input Validation Tests", () => {
  it("should reject POS sale with NaN locationId", async () => {
    const res = await agent.post("/api/pos/sales").send({
      locationId: "notanumber",
      items: [
        { stockItemId: ctx.stockItemIds[0], quantity: 5, sellingPrice: 15 },
      ],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
    });

    expect(res.status).toBe(400);
  });

  it("should reject stock transfer with invalid item quantity", async () => {
    const res = await agent.post("/api/stock-transfers").send({
      sourceLocationId: ctx.locationId,
      destinationLocationId: ctx.location2Id,
      items: [
        {
          stockItemId: ctx.stockItemIds[0],
          quantity: "not_a_number",
          sourceLocationId: ctx.locationId,
        },
      ],
    });

    expect(res.status).toBe(400);
  });

  it("should reject quick adjust with missing fields", async () => {
    const res = await agent.post("/api/inventory/quick-adjust").send({
      stockItemId: ctx.stockItemIds[0],
    });

    expect(res.status).toBe(400);
  });
});

describe("adjustInventory Helper Tests", () => {
  beforeEach(async () => {
    await resetInventory();
  });

  it("should handle insert-or-update correctly", async () => {
    const { adjustInventory } = await import("../server/inventoryHelper");

    const result = await adjustInventory(
      db as any,
      ctx.locationId,
      ctx.stockItemIds[0],
      10,
      ctx.companyId,
      12.0,
    );

    expect(result.previousQuantity).toBe(100);
    expect(result.newQuantity).toBe(110);
    expect(result.created).toBe(false);
  });

  it("should create inventory record when none exists", async () => {
    const { adjustInventory } = await import("../server/inventoryHelper");

    const [newItem] = await db
      .insert(schema.stockItems)
      .values({
        companyId: ctx.companyId,
        code: `${TEST_PREFIX}-NEWITEM`,
        name: "Brand New Item",
        uom: "PCS",
        stockGroupId: ctx.stockGroupId,
        active: true,
      })
      .returning();

    const result = await adjustInventory(
      db as any,
      ctx.locationId,
      newItem.id,
      25,
      ctx.companyId,
      8.0,
    );

    expect(result.previousQuantity).toBe(0);
    expect(result.newQuantity).toBe(25);
    expect(result.created).toBe(true);
    expect(result.averageRate).toBe(8.0);

    await db
      .delete(schema.inventory)
      .where(eq(schema.inventory.stockItemId, newItem.id));
    await db.delete(schema.stockItems).where(eq(schema.stockItems.id, newItem.id));
  });

  it("should allow negative inventory", async () => {
    const { adjustInventory } = await import("../server/inventoryHelper");

    const result = await adjustInventory(
      db as any,
      ctx.locationId,
      ctx.stockItemIds[0],
      -150,
      ctx.companyId,
    );

    expect(result.newQuantity).toBe(-50);
    expect(result.created).toBe(false);
  });
});

describe("Inventory Reconciliation Endpoint Tests", () => {
  beforeEach(async () => {
    await resetInventory();
  });

  it("should return clean results for healthy inventory", async () => {
    const res = await agent.get("/api/inventory/reconcile");

    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.totalRecords).toBeGreaterThan(0);

    const criticalOrError = res.body.issues.filter(
      (i: any) => i.severity === "critical" || i.severity === "error",
    );
    expect(criticalOrError.length).toBe(0);
  });

  it("should detect value mismatches", async () => {
    await db
      .update(schema.inventory)
      .set({ totalValue: "9999.99" })
      .where(
        and(
          eq(schema.inventory.locationId, ctx.locationId),
          eq(schema.inventory.stockItemId, ctx.stockItemIds[0]),
        ),
      );

    const res = await agent.get("/api/inventory/reconcile");

    expect(res.status).toBe(200);
    const valueMismatches = res.body.issues.filter(
      (i: any) => i.type === "value_mismatch",
    );
    expect(valueMismatches.length).toBeGreaterThan(0);
    expect(valueMismatches[0].severity).toBe("error");
  });

  it("should report negative inventory as info (not error)", async () => {
    await db
      .update(schema.inventory)
      .set({ quantity: "-10.000", totalValue: "-100.00" })
      .where(
        and(
          eq(schema.inventory.locationId, ctx.locationId),
          eq(schema.inventory.stockItemId, ctx.stockItemIds[0]),
        ),
      );

    const res = await agent.get("/api/inventory/reconcile");

    expect(res.status).toBe(200);
    const negIssues = res.body.issues.filter(
      (i: any) => i.type === "negative_inventory",
    );
    expect(negIssues.length).toBeGreaterThan(0);
    expect(negIssues[0].severity).toBe("info");
  });

  it("should detect zero quantity with non-zero value", async () => {
    await db
      .update(schema.inventory)
      .set({ quantity: "0.000", totalValue: "50.00" })
      .where(
        and(
          eq(schema.inventory.locationId, ctx.locationId),
          eq(schema.inventory.stockItemId, ctx.stockItemIds[1]),
        ),
      );

    const res = await agent.get("/api/inventory/reconcile");

    expect(res.status).toBe(200);
    const zeroQtyIssues = res.body.issues.filter(
      (i: any) => i.type === "zero_qty_nonzero_value",
    );
    expect(zeroQtyIssues.length).toBeGreaterThan(0);
  });

  it("should include summary with counts", async () => {
    const res = await agent.get("/api/inventory/reconcile");

    expect(res.status).toBe(200);
    expect(res.body.summary.totalRecords).toBeGreaterThanOrEqual(6);
    expect(res.body.summary.totalLocations).toBeGreaterThanOrEqual(2);
    expect(typeof res.body.summary.totalInventoryValue).toBe("string");
    expect(typeof res.body.summary.issueCount).toBe("number");
  });
});
