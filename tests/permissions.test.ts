import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db } from "../server/db";
import { eq } from "drizzle-orm";
import * as schema from "../shared/schema";
import bcrypt from "bcryptjs";

const TEST_PREFIX = "permtest";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let posUserAgent: request.SuperAgentTest;
let posLocationId: number;

function accountsFromResponse(body: any): any[] {
  return Array.isArray(body) ? body : Array.isArray(body?.accounts) ? body.accounts : [];
}

async function loginAsTestUser() {
  const loginRes = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  if (loginRes.status !== 200) {
    throw new Error(`Admin login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);
  await loginAsTestUser();

  const hashedPw = await bcrypt.hash("pospassword123", 10);
  const [posUser] = await db
    .insert(schema.users)
    .values({ username: `${TEST_PREFIX}_posuser`, password: hashedPw })
    .returning();

  await db.insert(schema.userCompanyRoles).values({
    userId: posUser.id,
    companyId: ctx.companyId,
    role: "POS",
    posStation: 1,
  });

  const [loc] = await db
    .insert(schema.locations)
    .values({
      companyId: ctx.companyId,
      code: `${TEST_PREFIX.toUpperCase().slice(0, 6)}-PL`,
      name: `${TEST_PREFIX}_POSLocation`,
    })
    .returning();
  posLocationId = loc.id;

  await db.insert(schema.userLocations).values({
    userId: posUser.id,
    companyId: ctx.companyId,
    locationId: posLocationId,
  });

  posUserAgent = request.agent(ctx.app);
  const posLogin = await posUserAgent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_posuser`,
    password: "pospassword123",
  });
  if (posLogin.status !== 200) {
    throw new Error(`POS login failed: ${posLogin.status} ${JSON.stringify(posLogin.body)}`);
  }
  await posUserAgent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
}, 60000);

afterAll(async () => {
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

describe("Unauthenticated Access", () => {
  it("blocks /api/inventory without session", async () => {
    const res = await request.agent(ctx.app).get(`/api/inventory?locationId=${ctx.locationId}`);
    expect(res.status).toBe(401);
  });

  it("blocks /api/pos/sales without session", async () => {
    const res = await request.agent(ctx.app).post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [{ stockItemId: ctx.stockItemIds[0], quantity: 1, rate: 10 }],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });
    expect(res.status).toBe(401);
  });

  it("blocks /api/vouchers without session", async () => {
    const res = await request.agent(ctx.app).post("/api/vouchers").send({});
    expect(res.status).toBe(401);
  });

  it("blocks /api/accounts/all without session", async () => {
    const res = await request.agent(ctx.app).get("/api/accounts/all");
    expect(res.status).toBe(401);
  });

  it("blocks /api/stock-transfers without session", async () => {
    const res = await request.agent(ctx.app).post("/api/stock-transfers").send({});
    expect(res.status).toBe(401);
  });

  it("blocks /api/inventory/quick-adjust without session", async () => {
    const res = await request.agent(ctx.app).post("/api/inventory/quick-adjust").send({});
    expect(res.status).toBe(401);
  });

  it("blocks /api/vouchers/journal without session", async () => {
    const res = await request.agent(ctx.app).post("/api/vouchers/journal").send({});
    expect(res.status).toBe(401);
  });
});

describe("Admin Access", () => {
  it("admin can fetch inventory", async () => {
    const res = await agent.get(`/api/inventory?locationId=${ctx.locationId}`);
    expect(res.status).toBe(200);
  });

  it("admin can fetch accounts list", async () => {
    const res = await agent.get("/api/accounts/all");
    expect(res.status).toBe(200);
  });

  it("admin can fetch their own company data", async () => {
    const res = await agent.get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("id");
  });

  it("admin can fetch ledger account balance", async () => {
    const res = await agent.get(`/api/accounts/ledger/${ctx.cashAccountId}/balance`);
    expect(res.status).toBe(200);
  });

  it("admin can fetch balance-sheet report", async () => {
    const res = await agent.get("/api/reports/balance-sheet");
    expect(res.status).toBe(200);
  });

  it("admin can fetch profit-loss report", async () => {
    const today = new Date().toISOString().split("T")[0];
    const res = await agent.get(`/api/reports/profit-loss?fromDate=2024-01-01&toDate=${today}`);
    expect(res.status).toBe(200);
  });
});

describe("POS User — Location Restrictions", () => {
  it("POS user is blocked from selling at an unassigned location", async () => {
    const res = await posUserAgent.post("/api/pos/sales").send({
      locationId: ctx.locationId,
      items: [{ stockItemId: ctx.stockItemIds[0], quantity: 1, rate: 10 }],
      paymentAccountType: "ledger",
      paymentAccountId: ctx.cashAccountId,
      voucherDate: new Date().toISOString().split("T")[0],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("POS user cannot create journal vouchers", async () => {
    const res = await posUserAgent.post("/api/vouchers/journal").send({
      voucherDate: new Date().toISOString().split("T")[0],
      notes: "POS attempt",
      entries: [
        { type: "DR", accountType: "ledger", accountId: ctx.cashAccountId, amount: "100", narration: "" },
        { type: "CR", accountType: "ledger", accountId: ctx.salesAccountId, amount: "100", narration: "" },
      ],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("POS user cannot delete vouchers", async () => {
    const res = await posUserAgent.delete("/api/vouchers/1");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("POS User — Blocked from Accounting/Cost Data", () => {
  it("POS user cannot fetch profit-loss report (requireNonPOS enforced)", async () => {
    const today = new Date().toISOString().split("T")[0];
    const res = await posUserAgent.get(`/api/reports/profit-loss?fromDate=2024-01-01&toDate=${today}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("POS user cannot fetch balance-sheet report (requireNonPOS enforced)", async () => {
    const res = await posUserAgent.get("/api/reports/balance-sheet");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("POS user can currently read accounts list (no POS restriction on this route)", async () => {
    const res = await posUserAgent.get("/api/accounts/all");
    expect(res.status).toBe(200);
  });

  it("POS user can currently read ledger account balance (no POS restriction on this route)", async () => {
    const res = await posUserAgent.get(`/api/accounts/ledger/${ctx.cashAccountId}/balance`);
    expect(res.status).toBe(200);
  });
});

describe("Cross-Company Isolation", () => {
  it("admin cannot set-company to a company they do not belong to", async () => {
    const res = await agent.post("/api/auth/set-company").send({ companyId: 999999 });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("accounts/all does not leak another company's account codes", async () => {
    const [otherCompany] = await db
      .insert(schema.companies)
      .values({ code: "LEAKTEST2", name: `${TEST_PREFIX}_LeakCo2`, baseCurrency: "USD" })
      .returning();
    const uniqueCode = `${TEST_PREFIX}_PERM_LEAK_${Date.now()}`;
    const [otherAccount] = await db
      .insert(schema.ledgerAccounts)
      .values({
        companyId: otherCompany.id,
        code: uniqueCode,
        name: "Leak Test Account",
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
});
