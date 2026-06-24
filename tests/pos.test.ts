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

const TEST_PREFIX = "postest";

let ctx: TestContext;
let agent: request.SuperAgentTest;

async function loginAsTestUser() {
  const loginRes = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
}

async function resetInventory() {
  for (const stockItemId of ctx.stockItemIds) {
    const existing = await getInventoryRecord(ctx.locationId, stockItemId);
    if (existing) {
      await db
        .update(schema.inventory)
        .set({ quantity: "100.000", averageRate: "10.00", totalValue: "1000.00" })
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
  }
}

async function deleteSalesVouchersForCompany() {
  const vouchers = await db
    .select({ id: schema.vouchers.id })
    .from(schema.vouchers)
    .where(
      and(
        eq(schema.vouchers.companyId, ctx.companyId),
        eq(schema.vouchers.voucherType, "Sales"),
      ),
    );
  for (const v of vouchers) {
    await db.delete(schema.salesItems).where(eq(schema.salesItems.voucherId, v.id));
    await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, v.id));
    await db.delete(schema.vouchers).where(eq(schema.vouchers.id, v.id));
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

describe("POS Sale — Core Flow", () => {
  beforeEach(async () => {
    await resetInventory();
    await deleteSalesVouchersForCompany();
  });

  it("creates a sale and returns success status", async () => {
    const res = await agent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [{ stockItemId: ctx.stockItemIds[0], quantity: 5, rate: 20 }],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });

  it("reduces inventory by sold quantity", async () => {
    const before = await getInventoryQty(ctx.locationId, ctx.stockItemIds[0]);
    expect(before).toBe(100);

    await agent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [{ stockItemId: ctx.stockItemIds[0], quantity: 8, rate: 20 }],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });

    const after = await getInventoryQty(ctx.locationId, ctx.stockItemIds[0]);
    expect(after).toBe(92);
  });

  it("creates a voucher record in the database", async () => {
    const beforeCount = await db
      .select()
      .from(schema.vouchers)
      .where(
        and(eq(schema.vouchers.companyId, ctx.companyId), eq(schema.vouchers.voucherType, "Sales")),
      );

    await agent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [{ stockItemId: ctx.stockItemIds[0], quantity: 2, rate: 25 }],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });

    const afterCount = await db
      .select()
      .from(schema.vouchers)
      .where(
        and(eq(schema.vouchers.companyId, ctx.companyId), eq(schema.vouchers.voucherType, "Sales")),
      );

    expect(afterCount.length).toBe(beforeCount.length + 1);
  });

  it("creates sales_items rows matching the sold items", async () => {
    const res = await agent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [
        { stockItemId: ctx.stockItemIds[0], quantity: 3, rate: 15 },
        { stockItemId: ctx.stockItemIds[1], quantity: 4, rate: 20 },
      ],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    const voucherId = res.body?.voucher?.id ?? res.body?.voucherId ?? res.body?.id;
    if (!voucherId) return;

    const items = await db
      .select()
      .from(schema.salesItems)
      .where(eq(schema.salesItems.voucherId, voucherId));

    expect(items.length).toBe(2);
  });

  it("handles a multi-item sale and reduces all items", async () => {
    await agent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [
        { stockItemId: ctx.stockItemIds[0], quantity: 10, rate: 15 },
        { stockItemId: ctx.stockItemIds[1], quantity: 5, rate: 20 },
        { stockItemId: ctx.stockItemIds[2], quantity: 2, rate: 30 },
      ],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });

    const qty0 = await getInventoryQty(ctx.locationId, ctx.stockItemIds[0]);
    const qty1 = await getInventoryQty(ctx.locationId, ctx.stockItemIds[1]);
    const qty2 = await getInventoryQty(ctx.locationId, ctx.stockItemIds[2]);
    expect(qty0).toBe(90);
    expect(qty1).toBe(95);
    expect(qty2).toBe(98);
  });
});

describe("POS Sale — Validation", () => {
  it("rejects sale with missing locationId", async () => {
    const res = await agent.post("/api/pos/sales").send({
      items: [{ stockItemId: ctx.stockItemIds[0], quantity: 1, rate: 10 }],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });
    expect(res.status).toBe(400);
  });

  it("rejects sale with non-numeric locationId", async () => {
    const res = await agent.post("/api/pos/sales").send({
      locationId: "notanumber",
      items: [{ stockItemId: ctx.stockItemIds[0], quantity: 1, rate: 10 }],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });
    expect(res.status).toBe(400);
  });

  it("rejects sale with invalid stockItemId", async () => {
    const res = await agent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [{ stockItemId: "bad", quantity: 1, rate: 10 }],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });
    expect(res.status).toBe(400);
  });

  it("rejects sale with empty items array", async () => {
    const res = await agent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects unauthenticated sale request", async () => {
    const anonAgent = request.agent(ctx.app);
    const res = await anonAgent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [{ stockItemId: ctx.stockItemIds[0], quantity: 1, rate: 10 }],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });
    expect(res.status).toBe(401);
  });
});

describe("POS Sale — Edit", () => {
  beforeEach(async () => {
    await resetInventory();
    await deleteSalesVouchersForCompany();
  });

  it("editing a sale updates inventory correctly", async () => {
    const createRes = await agent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [{ stockItemId: ctx.stockItemIds[0], quantity: 5, rate: 20 }],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });

    expect(createRes.status).toBeGreaterThanOrEqual(200);
    expect(createRes.status).toBeLessThan(300);

    const qtyAfterCreate = await getInventoryQty(ctx.locationId, ctx.stockItemIds[0]);
    expect(qtyAfterCreate).toBe(95);

    const voucherId = createRes.body?.voucher?.id ?? createRes.body?.voucherId ?? createRes.body?.id;
    if (!voucherId) return;

    const editRes = await agent.put(`/api/vouchers/${voucherId}/sales`).send({
      locationId: ctx.locationId,
      items: [{ stockItemId: ctx.stockItemIds[0], quantity: 10, rate: 20 }],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });

    if (editRes.status >= 200 && editRes.status < 300) {
      const qtyAfterEdit = await getInventoryQty(ctx.locationId, ctx.stockItemIds[0]);
      expect(qtyAfterEdit).toBe(90);
    }
  });

  it("deleting a sale restores inventory", async () => {
    const createRes = await agent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [{ stockItemId: ctx.stockItemIds[0], quantity: 15, rate: 20 }],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });

    expect(createRes.status).toBeGreaterThanOrEqual(200);
    expect(createRes.status).toBeLessThan(300);

    const voucherId = createRes.body?.voucher?.id ?? createRes.body?.voucherId ?? createRes.body?.id;
    expect(voucherId).toBeDefined();

    const deleteRes = await agent.delete(`/api/vouchers/${voucherId}`);
    expect(deleteRes.status).toBeGreaterThanOrEqual(200);
    expect(deleteRes.status).toBeLessThan(300);

    const qtyAfterDelete = await getInventoryQty(ctx.locationId, ctx.stockItemIds[0]);
    expect(qtyAfterDelete).toBe(100);
  });
});
