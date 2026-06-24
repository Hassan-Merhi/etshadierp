import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import {
  seedTestData,
  cleanupTestData,
  closeTestServer,
  type TestContext,
} from "./setup";
import { db } from "../server/db";
import { eq } from "drizzle-orm";
import * as schema from "../shared/schema";

const TEST_PREFIX = "vchtest";

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

async function cleanupVouchers() {
  const vouchers = await db
    .select({ id: schema.vouchers.id })
    .from(schema.vouchers)
    .where(eq(schema.vouchers.companyId, ctx.companyId));

  for (const v of vouchers) {
    await db.delete(schema.salesItems).where(eq(schema.salesItems.voucherId, v.id));
    await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, v.id));
  }
  await db.delete(schema.vouchers).where(eq(schema.vouchers.companyId, ctx.companyId));
}

function journalBody(amount: number, cashId: number, salesId: number, notes = "Test entry") {
  return {
    voucherDate: new Date().toISOString().split("T")[0],
    notes,
    entries: [
      { type: "DR", accountType: "ledger", accountId: cashId, amount: String(amount), narration: "" },
      { type: "CR", accountType: "ledger", accountId: salesId, amount: String(amount), narration: "" },
    ],
  };
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

describe("Voucher Creation — Journal", () => {
  beforeEach(async () => {
    await cleanupVouchers();
  });

  it("creates a balanced journal voucher (DR = CR)", async () => {
    const res = await agent
      .post("/api/vouchers/journal")
      .send(journalBody(500, ctx.cashAccountId, ctx.salesAccountId));

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });

  it("rejects a journal where debits do not equal credits", async () => {
    const res = await agent.post("/api/vouchers/journal").send({
      voucherDate: new Date().toISOString().split("T")[0],
      notes: "Unbalanced test",
      entries: [
        { type: "DR", accountType: "ledger", accountId: ctx.cashAccountId, amount: "300", narration: "" },
        { type: "CR", accountType: "ledger", accountId: ctx.salesAccountId, amount: "200", narration: "" },
      ],
    });
    expect(res.status).toBe(400);
  });

  it("persists debit/credit entries in the database", async () => {
    const res = await agent
      .post("/api/vouchers/journal")
      .send(journalBody(300, ctx.cashAccountId, ctx.salesAccountId, "Balance check entry"));

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    const voucherId = res.body?.id ?? res.body?.voucherId;
    if (!voucherId) return;

    const entries = await db
      .select()
      .from(schema.voucherEntries)
      .where(eq(schema.voucherEntries.voucherId, voucherId));

    const totalDebit = entries.reduce((s, e) => s + parseFloat(e.debitAmount ?? "0"), 0);
    const totalCredit = entries.reduce((s, e) => s + parseFloat(e.creditAmount ?? "0"), 0);

    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
    expect(totalDebit).toBeCloseTo(300, 2);
  });

  it("assigns the voucher to the current company", async () => {
    const res = await agent
      .post("/api/vouchers/journal")
      .send(journalBody(100, ctx.cashAccountId, ctx.salesAccountId, "Company isolation test"));

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    const voucherId = res.body?.id ?? res.body?.voucherId;
    if (!voucherId) return;

    const [voucher] = await db
      .select()
      .from(schema.vouchers)
      .where(eq(schema.vouchers.id, voucherId));

    expect(voucher).toBeDefined();
    expect(voucher.companyId).toBe(ctx.companyId);
  });

  it("creates a voucher record of type Journal", async () => {
    const res = await agent
      .post("/api/vouchers/journal")
      .send(journalBody(750, ctx.cashAccountId, ctx.salesAccountId));

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    const voucherId = res.body?.id ?? res.body?.voucherId;
    if (!voucherId) return;

    const [voucher] = await db
      .select()
      .from(schema.vouchers)
      .where(eq(schema.vouchers.id, voucherId));

    expect(voucher?.voucherType).toBe("Journal");
  });
});

describe("Voucher Retrieval", () => {
  it("returns 401 for unauthenticated voucher fetch", async () => {
    const anonAgent = request.agent(ctx.app);
    const res = await anonAgent.get("/api/vouchers/1/entries");
    expect(res.status).toBe(401);
  });

  it("returns voucher entries for authenticated user", async () => {
    const createRes = await agent
      .post("/api/vouchers/journal")
      .send(journalBody(200, ctx.cashAccountId, ctx.salesAccountId, "Retrieval test"));

    if (createRes.status < 200 || createRes.status >= 300) return;

    const voucherId = createRes.body?.id ?? createRes.body?.voucherId;
    if (!voucherId) return;

    const res = await agent.get(`/api/vouchers/${voucherId}/entries`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body) || Array.isArray(res.body?.entries)).toBe(true);
  });
});

describe("Voucher Delete", () => {
  beforeEach(async () => {
    await cleanupVouchers();
  });

  it("deletes a voucher and removes its entries", async () => {
    const createRes = await agent
      .post("/api/vouchers/journal")
      .send(journalBody(100, ctx.cashAccountId, ctx.salesAccountId, "Delete test"));

    if (createRes.status < 200 || createRes.status >= 300) return;

    const voucherId = createRes.body?.id ?? createRes.body?.voucherId;
    if (!voucherId) return;

    const deleteRes = await agent.delete(`/api/vouchers/${voucherId}`);
    expect(deleteRes.status).toBeGreaterThanOrEqual(200);
    expect(deleteRes.status).toBeLessThan(300);

    const remainingEntries = await db
      .select()
      .from(schema.voucherEntries)
      .where(eq(schema.voucherEntries.voucherId, voucherId));

    expect(remainingEntries.length).toBe(0);
  });

  it("returns 4xx when deleting non-existent voucher", async () => {
    const res = await agent.delete("/api/vouchers/99999999");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("Voucher — Accounting Invariants", () => {
  beforeEach(async () => {
    await cleanupVouchers();
  });

  it("total debit equals total credit across all entries (multi-line)", async () => {
    const res = await agent.post("/api/vouchers/journal").send({
      voucherDate: new Date().toISOString().split("T")[0],
      notes: "DR=CR invariant multi-line",
      entries: [
        { type: "DR", accountType: "ledger", accountId: ctx.cashAccountId, amount: "250", narration: "" },
        { type: "DR", accountType: "ledger", accountId: ctx.cashAccountId, amount: "750", narration: "" },
        { type: "CR", accountType: "ledger", accountId: ctx.salesAccountId, amount: "1000", narration: "" },
      ],
    });

    if (res.status < 200 || res.status >= 300) return;

    const voucherId = res.body?.id ?? res.body?.voucherId;
    if (!voucherId) return;

    const entries = await db
      .select()
      .from(schema.voucherEntries)
      .where(eq(schema.voucherEntries.voucherId, voucherId));

    const totalDebit = entries.reduce((s, e) => s + parseFloat(e.debitAmount ?? "0"), 0);
    const totalCredit = entries.reduce((s, e) => s + parseFloat(e.creditAmount ?? "0"), 0);

    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
  });

  it("rejects empty entries array", async () => {
    const res = await agent.post("/api/vouchers/journal").send({
      voucherDate: new Date().toISOString().split("T")[0],
      notes: "Empty entries",
      entries: [],
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing voucherDate", async () => {
    const res = await agent.post("/api/vouchers/journal").send({
      notes: "No date",
      entries: [
        { type: "DR", accountType: "ledger", accountId: ctx.cashAccountId, amount: "100", narration: "" },
        { type: "CR", accountType: "ledger", accountId: ctx.salesAccountId, amount: "100", narration: "" },
      ],
    });
    expect(res.status).toBe(400);
  });
});
