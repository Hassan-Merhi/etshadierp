import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db } from "../server/db";
import { eq } from "drizzle-orm";
import * as schema from "../shared/schema";

const TEST_PREFIX = "accttest";

let ctx: TestContext;
let agent: request.SuperAgentTest;

function accountsFromResponse(body: any): any[] {
  return Array.isArray(body) ? body : Array.isArray(body?.accounts) ? body.accounts : [];
}

async function loginAsTestUser() {
  const loginRes = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  const setCompanyRes = await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
  if (setCompanyRes.status !== 200) {
    throw new Error(`Set company failed: ${setCompanyRes.status} ${JSON.stringify(setCompanyRes.body)}`);
  }
}

async function cleanupVouchers() {
  const vouchers = await db
    .select({ id: schema.vouchers.id })
    .from(schema.vouchers)
    .where(eq(schema.vouchers.companyId, ctx.companyId));

  for (const voucher of vouchers) {
    await db.delete(schema.salesItems).where(eq(schema.salesItems.voucherId, voucher.id));
    await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, voucher.id));
  }
  await db.delete(schema.vouchers).where(eq(schema.vouchers.companyId, ctx.companyId));
}

function journalBody(amount: number, cashId: number, salesId: number) {
  return {
    voucherDate: new Date().toISOString().split("T")[0],
    notes: "Accounting test entry",
    entries: [
      { type: "DR", accountType: "ledger", accountId: cashId, amount: String(amount), narration: "" },
      { type: "CR", accountType: "ledger", accountId: salesId, amount: String(amount), narration: "" },
    ],
  };
}

function paymentReceiptBody(
  voucherType: "Payment" | "Receipt",
  amount: number,
  paymentAccountId: number,
  entryAccountId: number,
) {
  return {
    voucherType,
    voucherDate: new Date().toISOString().split("T")[0],
    paymentAccountType: "ledger",
    paymentAccountId,
    paymentAccountName: "Cash",
    entries: [
      {
        accountType: "ledger",
        accountId: entryAccountId,
        accountName: "Sales",
        amount: String(amount),
      },
    ],
    notes: `${voucherType} test entry`,
    currency: "USD",
  };
}

function voucherIdFrom(body: any): number | undefined {
  return body?.voucher?.id ?? body?.id ?? body?.voucherId;
}

async function assertVoucherBalanced(voucherId: number) {
  const entries = await db
    .select()
    .from(schema.voucherEntries)
    .where(eq(schema.voucherEntries.voucherId, voucherId));
  expect(entries.length).toBeGreaterThan(0);
  const totalDebit = entries.reduce((sum, entry) => sum + parseFloat(entry.debitAmount ?? "0"), 0);
  const totalCredit = entries.reduce((sum, entry) => sum + parseFloat(entry.creditAmount ?? "0"), 0);
  expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
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

describe("Ledger Accounts — API", () => {
  it("returns a 200 response from accounts/all", async () => {
    const res = await agent.get("/api/accounts/all");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.accounts)).toBe(true);
    expect(typeof res.body?.asOfDate).toBe("string");
  });

  it("accounts/all includes the seeded cash account", async () => {
    const res = await agent.get("/api/accounts/all");
    expect(res.status).toBe(200);
    const found = accountsFromResponse(res.body).some((account: any) => {
      const numId = typeof account.id === "string" ? parseInt(account.id.replace(/\D/g, ""), 10) : account.id;
      return numId === ctx.cashAccountId;
    });
    expect(found).toBe(true);
  });

  it("accounts/all includes the seeded sales account", async () => {
    const res = await agent.get("/api/accounts/all");
    expect(res.status).toBe(200);
    const found = accountsFromResponse(res.body).some((account: any) => {
      const numId = typeof account.id === "string" ? parseInt(account.id.replace(/\D/g, ""), 10) : account.id;
      return numId === ctx.salesAccountId;
    });
    expect(found).toBe(true);
  });

  it("accounts/all does not include accounts from other companies", async () => {
    const [otherCompany] = await db
      .insert(schema.companies)
      .values({ code: "ACCTOTHER", name: `${TEST_PREFIX}_OtherCo`, baseCurrency: "USD" })
      .returning();
    const uniqueCode = `${TEST_PREFIX}_OTHER_UNIQUE_${Date.now()}`;
    const [otherAccount] = await db
      .insert(schema.ledgerAccounts)
      .values({
        companyId: otherCompany.id,
        code: uniqueCode,
        name: "Other Cash",
        accountType: "Cash",
        subType: "Cash",
        openingBalance: "0",
        openingBalanceSide: "Dr",
      })
      .returning();

    try {
      const res = await agent.get("/api/accounts/all");
      const codes = accountsFromResponse(res.body).map((account: any) => account.code);
      expect(codes).not.toContain(uniqueCode);
    } finally {
      await db.delete(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.id, otherAccount.id));
      await db.delete(schema.companies).where(eq(schema.companies.id, otherCompany.id));
    }
  });

  it("returns ledger balance for a known account", async () => {
    const res = await agent.get(`/api/accounts/ledger/${ctx.cashAccountId}/balance`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("balance");
  });

  it("returns 4xx for ledger balance of non-existent account", async () => {
    const res = await agent.get("/api/accounts/ledger/99999999/balance");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("Accounting — Voucher DR=CR Invariant", () => {
  beforeEach(cleanupVouchers);

  it("persisted entries always balance (debit = credit) — Journal", async () => {
    const createRes = await agent
      .post("/api/vouchers/journal")
      .send(journalBody(1500, ctx.cashAccountId, ctx.salesAccountId));
    expect(createRes.status).toBeGreaterThanOrEqual(200);
    expect(createRes.status).toBeLessThan(300);
    const voucherId = voucherIdFrom(createRes.body);
    expect(voucherId).toBeDefined();
    await assertVoucherBalanced(voucherId!);
  });

  it("Payment voucher entries balance (debit = credit)", async () => {
    const createRes = await agent
      .post("/api/vouchers/payment-receipt")
      .send(paymentReceiptBody("Payment", 750, ctx.cashAccountId, ctx.salesAccountId));
    expect(createRes.status).toBeGreaterThanOrEqual(200);
    expect(createRes.status).toBeLessThan(300);
    const voucherId = voucherIdFrom(createRes.body);
    expect(voucherId).toBeDefined();
    await assertVoucherBalanced(voucherId!);
  });

  it("Receipt voucher entries balance (debit = credit)", async () => {
    const createRes = await agent
      .post("/api/vouchers/payment-receipt")
      .send(paymentReceiptBody("Receipt", 400, ctx.cashAccountId, ctx.salesAccountId));
    expect(createRes.status).toBeGreaterThanOrEqual(200);
    expect(createRes.status).toBeLessThan(300);
    const voucherId = voucherIdFrom(createRes.body);
    expect(voucherId).toBeDefined();
    await assertVoucherBalanced(voucherId!);
  });

  it("a POS sale creates balanced voucher entries", async () => {
    await db
      .insert(schema.inventory)
      .values({
        companyId: ctx.companyId,
        locationId: ctx.locationId,
        stockItemId: ctx.stockItemIds[0],
        quantity: "200.000",
        averageRate: "10.00",
        totalValue: "2000.00",
      })
      .onConflictDoNothing();

    const saleRes = await agent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [{ stockItemId: ctx.stockItemIds[0], quantity: 3, rate: 50 }],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });
    expect(saleRes.status).toBeGreaterThanOrEqual(200);
    expect(saleRes.status).toBeLessThan(300);
    const voucherId = voucherIdFrom(saleRes.body);
    expect(voucherId).toBeDefined();
    await assertVoucherBalanced(voucherId!);
  });
});

describe("Accounting — Ledger Transactions", () => {
  beforeEach(cleanupVouchers);

  it("cash account shows transactions after a journal entry", async () => {
    const createRes = await agent
      .post("/api/vouchers/journal")
      .send(journalBody(200, ctx.cashAccountId, ctx.salesAccountId));
    expect(createRes.status).toBeGreaterThanOrEqual(200);
    expect(createRes.status).toBeLessThan(300);

    const txRes = await agent.get(`/api/accounts/ledger/${ctx.cashAccountId}/transactions`);
    expect(txRes.status).toBe(200);
    const txBody = Array.isArray(txRes.body) ? txRes.body : txRes.body?.transactions ?? [];
    expect(txBody.length).toBeGreaterThan(0);
  });

  it("ledger balance endpoint returns numeric balance", async () => {
    const res = await agent.get(`/api/accounts/ledger/${ctx.salesAccountId}/balance`);
    expect(res.status).toBe(200);
    const balance = res.body?.balance ?? res.body?.closingBalance ?? res.body?.amount;
    expect(balance).not.toBeUndefined();
    expect(Number.isNaN(Number(balance))).toBe(false);
  });

  it("sales account balance changes after journal DR cash / CR sales", async () => {
    const before = await agent.get(`/api/accounts/ledger/${ctx.salesAccountId}/balance`);
    const beforeBalance = parseFloat(before.body?.balance ?? "0");
    const createRes = await agent
      .post("/api/vouchers/journal")
      .send(journalBody(999, ctx.cashAccountId, ctx.salesAccountId));
    expect(createRes.status).toBeGreaterThanOrEqual(200);
    expect(createRes.status).toBeLessThan(300);
    const after = await agent.get(`/api/accounts/ledger/${ctx.salesAccountId}/balance`);
    const afterBalance = parseFloat(after.body?.balance ?? "0");
    expect(Math.abs(afterBalance - beforeBalance)).toBeGreaterThan(0);
  });
});

describe("Accounting — Company Isolation", () => {
  it("accounts/all returns only current company accounts (by code check)", async () => {
    const [otherCompany] = await db
      .insert(schema.companies)
      .values({ code: "LEAKTEST3", name: `${TEST_PREFIX}_LeakCo3`, baseCurrency: "USD" })
      .returning();
    const uniqueCode = `${TEST_PREFIX}_LEAK_CODE_${Date.now()}`;
    const [otherAccount] = await db
      .insert(schema.ledgerAccounts)
      .values({
        companyId: otherCompany.id,
        code: uniqueCode,
        name: "Leak Test Cash",
        accountType: "Cash",
        subType: "Cash",
        openingBalance: "0",
        openingBalanceSide: "Dr",
      })
      .returning();

    try {
      const res = await agent.get("/api/accounts/all");
      const codes = accountsFromResponse(res.body).map((account: any) => account.code);
      expect(codes).not.toContain(uniqueCode);
    } finally {
      await db.delete(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.id, otherAccount.id));
      await db.delete(schema.companies).where(eq(schema.companies.id, otherCompany.id));
    }
  });

  it("GET /api/vouchers does not return vouchers from another company", async () => {
    const [otherCompany] = await db
      .insert(schema.companies)
      .values({ code: "VCHLEAKCO", name: `${TEST_PREFIX}_VchLeakCo`, baseCurrency: "USD" })
      .returning();
    const [otherVoucher] = await db
      .insert(schema.vouchers)
      .values({
        companyId: otherCompany.id,
        voucherType: "Journal",
        voucherDate: new Date(),
        description: "Leak test voucher",
        voucherNumber: `LEAK-${Date.now()}`,
        totalAmount: "0",
        currency: "USD",
      })
      .returning();

    try {
      const res = await agent.get("/api/vouchers");
      expect(res.status).toBe(200);
      const vouchers = Array.isArray(res.body) ? res.body : res.body?.vouchers ?? [];
      expect(vouchers.some((voucher: any) => voucher.id === otherVoucher.id)).toBe(false);
    } finally {
      await db.delete(schema.vouchers).where(eq(schema.vouchers.id, otherVoucher.id));
      await db.delete(schema.companies).where(eq(schema.companies.id, otherCompany.id));
    }
  });

  it("balance-sheet report returns 200 and does not expose other company account codes", async () => {
    const [otherCompany] = await db
      .insert(schema.companies)
      .values({ code: "BSLEAKCO", name: `${TEST_PREFIX}_BsLeakCo`, baseCurrency: "USD" })
      .returning();
    const uniqueCode = `${TEST_PREFIX}_BS_LEAK_${Date.now()}`;
    const [otherAccount] = await db
      .insert(schema.ledgerAccounts)
      .values({
        companyId: otherCompany.id,
        code: uniqueCode,
        name: "Balance Sheet Leak Account",
        accountType: "Cash",
        subType: "Cash",
        openingBalance: "0",
        openingBalanceSide: "Dr",
      })
      .returning();

    try {
      const res = await agent.get("/api/reports/balance-sheet");
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(uniqueCode);
    } finally {
      await db.delete(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.id, otherAccount.id));
      await db.delete(schema.companies).where(eq(schema.companies.id, otherCompany.id));
    }
  });

  it("profit-loss report returns 200 and does not expose other company account codes", async () => {
    const [otherCompany] = await db
      .insert(schema.companies)
      .values({ code: "PLLEAKCO", name: `${TEST_PREFIX}_PlLeakCo`, baseCurrency: "USD" })
      .returning();
    const uniqueCode = `${TEST_PREFIX}_PL_LEAK_${Date.now()}`;
    const [otherAccount] = await db
      .insert(schema.ledgerAccounts)
      .values({
        companyId: otherCompany.id,
        code: uniqueCode,
        name: "P&L Leak Account",
        accountType: "Income",
        subType: "Sales",
        openingBalance: "0",
        openingBalanceSide: "Cr",
      })
      .returning();

    try {
      const today = new Date().toISOString().split("T")[0];
      const res = await agent.get(`/api/reports/profit-loss?fromDate=2024-01-01&toDate=${today}`);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(uniqueCode);
    } finally {
      await db.delete(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.id, otherAccount.id));
      await db.delete(schema.companies).where(eq(schema.companies.id, otherCompany.id));
    }
  });
});
