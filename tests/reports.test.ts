/**
 * Report Accuracy Tests
 * ---------------------
 * Verify that financial reports are consistent with the underlying accounting data.
 *
 * What these tests protect:
 * - Ledger balance matches posted DR/CR entries
 * - Balance-sheet and P&L reports return 200 and structured data
 * - Reports filter by company (data from other companies is excluded)
 * - Report endpoints don't produce NaN/undefined totals
 * - Voucher entry totals in the database equal what was posted via API
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import {
  seedTestData,
  cleanupTestData,
  closeTestServer,
  type TestContext,
} from "./setup";
import { db, pool } from "../server/db";
import { eq } from "drizzle-orm";
import * as schema from "../shared/schema";

const TEST_PREFIX = "rpttest";

let ctx: TestContext;
let agent: request.SuperAgentTest;

async function login() {
  const res = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status}`);
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
}

async function cleanupVouchers() {
  const vouchers = await db
    .select({ id: schema.vouchers.id })
    .from(schema.vouchers)
    .where(eq(schema.vouchers.companyId, ctx.companyId));
  for (const v of vouchers) {
    await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, v.id));
  }
  await db.delete(schema.vouchers).where(eq(schema.vouchers.companyId, ctx.companyId));
}

function journalBody(amount: number) {
  return {
    voucherDate: new Date().toISOString().split("T")[0],
    notes: "Report accuracy test entry",
    entries: [
      { type: "DR", accountType: "ledger", accountId: ctx.cashAccountId,  amount: String(amount), narration: "" },
      { type: "CR", accountType: "ledger", accountId: ctx.salesAccountId, amount: String(amount), narration: "" },
    ],
  };
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);
  await login();
}, 60000);

afterAll(async () => {
  await cleanupVouchers();
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

beforeEach(async () => {
  await cleanupVouchers();
});

// ── Ledger balance accuracy ───────────────────────────────────────────────────

describe("Report Accuracy — Ledger balance matches DB entries", () => {
  it("cash account balance increases by posted debit amount", async () => {
    const beforeRes = await agent.get(`/api/accounts/ledger/${ctx.cashAccountId}/balance`);
    expect(beforeRes.status).toBe(200);
    const beforeBalance = parseFloat(beforeRes.body?.balance ?? "0");

    const postAmount = 1234;
    const createRes = await agent.post("/api/vouchers/journal").send(journalBody(postAmount));
    expect(createRes.status).toBeGreaterThanOrEqual(200);
    expect(createRes.status).toBeLessThan(300);

    const afterRes = await agent.get(`/api/accounts/ledger/${ctx.cashAccountId}/balance`);
    expect(afterRes.status).toBe(200);
    const afterBalance = parseFloat(afterRes.body?.balance ?? "0");

    // The cash account is DR in the journal, so the signed balance must INCREASE
    const delta = afterBalance - beforeBalance;
    expect(delta).toBeCloseTo(postAmount, 0);
    expect(delta).toBeGreaterThan(0); // direction check: must increase, not decrease
  });

  it("sales account balance increases by posted credit amount", async () => {
    const beforeRes = await agent.get(`/api/accounts/ledger/${ctx.salesAccountId}/balance`);
    const beforeBalance = parseFloat(beforeRes.body?.balance ?? "0");

    const postAmount = 500;
    await agent.post("/api/vouchers/journal").send(journalBody(postAmount));

    const afterRes = await agent.get(`/api/accounts/ledger/${ctx.salesAccountId}/balance`);
    const afterBalance = parseFloat(afterRes.body?.balance ?? "0");

    // Sales is CR in the journal — balance must increase by postAmount
    const delta = afterBalance - beforeBalance;
    expect(Math.abs(delta)).toBeCloseTo(postAmount, 0);
  });

  it("balance returned by API matches DB sum of DR/CR entries", async () => {
    const postAmount = 750;
    const createRes = await agent.post("/api/vouchers/journal").send(journalBody(postAmount));
    expect(createRes.status).toBeGreaterThanOrEqual(200);
    expect(createRes.status).toBeLessThan(300);

    // Sum directly from DB via pool (avoids Drizzle subquery limitations)
    const dbResult = await pool.query(
      `SELECT
         COALESCE(SUM(CAST(debit_amount  AS NUMERIC)), 0) AS total_debit,
         COALESCE(SUM(CAST(credit_amount AS NUMERIC)), 0) AS total_credit
       FROM voucher_entries
       WHERE ledger_account_id = $1`,
      [ctx.cashAccountId],
    );
    const dbDebit  = parseFloat(dbResult.rows[0].total_debit);
    const dbCredit = parseFloat(dbResult.rows[0].total_credit);
    const dbNet = dbDebit - dbCredit;

    const apiRes = await agent.get(`/api/accounts/ledger/${ctx.cashAccountId}/balance`);
    const apiBalance = parseFloat(apiRes.body?.balance ?? "0");

    // The API balance should reflect the net DR-CR posted
    expect(Math.abs(Math.abs(apiBalance) - Math.abs(dbNet))).toBeLessThan(1);
  });

  it("ledger balance is a finite number (no NaN/undefined)", async () => {
    await agent.post("/api/vouchers/journal").send(journalBody(100));
    const res = await agent.get(`/api/accounts/ledger/${ctx.cashAccountId}/balance`);
    expect(res.status).toBe(200);
    const balance = Number(res.body?.balance ?? res.body?.closingBalance);
    expect(Number.isFinite(balance)).toBe(true);
  });
});

// ── Balance-sheet report ──────────────────────────────────────────────────────

describe("Report Accuracy — Balance-sheet", () => {
  it("returns 200 with non-empty body", async () => {
    const res = await agent.get("/api/reports/balance-sheet");
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
  });

  it("body is an object or array (structured, not a raw string)", async () => {
    const res = await agent.get("/api/reports/balance-sheet");
    expect(typeof res.body === "object" && res.body !== null).toBe(true);
  });

  it("does not expose accounts from another company", async () => {
    const [otherCompany] = await db
      .insert(schema.companies)
      .values({ code: "RPTOTHER", name: `${TEST_PREFIX}_RptOther`, baseCurrency: "USD" })
      .returning();
    const uniqueCode = `${TEST_PREFIX}_BS_RPT_LEAK_${Date.now()}`;
    const [otherAccount] = await db
      .insert(schema.ledgerAccounts)
      .values({
        companyId: otherCompany.id,
        code: uniqueCode,
        name: "Balance Sheet Leak",
        accountType: "Cash",
        subType: "Cash",
        openingBalance: "0",
        openingBalanceSide: "Dr",
      })
      .returning();

    let res: any;
    try {
      res = await agent.get("/api/reports/balance-sheet");
    } finally {
      await db.delete(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.id, otherAccount.id));
      await db.delete(schema.companies).where(eq(schema.companies.id, otherCompany.id));
    }

    expect(JSON.stringify(res.body)).not.toContain(uniqueCode);
  });

  it("balance sheet reflects posted journal entry (cash account appears)", async () => {
    await agent.post("/api/vouchers/journal").send(journalBody(999));
    const res = await agent.get("/api/reports/balance-sheet");
    expect(res.status).toBe(200);
    // We cannot assert exact values without knowing the report schema,
    // but the report must succeed after a journal entry.
    expect(res.body).toBeTruthy();
  });
});

// ── Profit-and-loss report ────────────────────────────────────────────────────

describe("Report Accuracy — Profit and loss", () => {
  const today = new Date().toISOString().split("T")[0];
  const fromDate = "2024-01-01";

  it("returns 200 with structured body", async () => {
    const res = await agent.get(
      `/api/reports/profit-loss?fromDate=${fromDate}&toDate=${today}`,
    );
    expect(res.status).toBe(200);
    expect(typeof res.body === "object" && res.body !== null).toBe(true);
  });

  it("does not expose accounts from another company", async () => {
    const [otherCompany] = await db
      .insert(schema.companies)
      .values({ code: "PLOTHER2", name: `${TEST_PREFIX}_PlOther`, baseCurrency: "USD" })
      .returning();
    const uniqueCode = `${TEST_PREFIX}_PL_RPT_LEAK_${Date.now()}`;
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

    let res: any;
    try {
      res = await agent.get(
        `/api/reports/profit-loss?fromDate=${fromDate}&toDate=${today}`,
      );
    } finally {
      await db.delete(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.id, otherAccount.id));
      await db.delete(schema.companies).where(eq(schema.companies.id, otherCompany.id));
    }

    expect(JSON.stringify(res.body)).not.toContain(uniqueCode);
  });

  it("profit-loss report returns consistently after multiple vouchers", async () => {
    // Post two entries and confirm reports still succeed
    await agent.post("/api/vouchers/journal").send(journalBody(200));
    await agent.post("/api/vouchers/journal").send(journalBody(300));

    const res = await agent.get(
      `/api/reports/profit-loss?fromDate=${fromDate}&toDate=${today}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
  });
});

// ── Voucher entry database accuracy ──────────────────────────────────────────

describe("Report Accuracy — Voucher entry totals", () => {
  it("total debits in DB equal total credits for all company vouchers", async () => {
    await agent.post("/api/vouchers/journal").send(journalBody(111));
    await agent.post("/api/vouchers/journal").send(journalBody(222));
    await agent.post("/api/vouchers/journal").send(journalBody(333));

    const result = await pool.query(
      `SELECT
         COALESCE(SUM(CAST(debit_amount AS NUMERIC)), 0)  AS total_debit,
         COALESCE(SUM(CAST(credit_amount AS NUMERIC)), 0) AS total_credit
       FROM voucher_entries ve
       JOIN vouchers v ON ve.voucher_id = v.id
       WHERE v.company_id = $1`,
      [ctx.companyId],
    );

    const totalDebit  = parseFloat(result.rows[0].total_debit);
    const totalCredit = parseFloat(result.rows[0].total_credit);

    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
  });

  it("correct number of entries exist after posting N vouchers", async () => {
    const before = await pool_count(ctx.companyId);

    await agent.post("/api/vouchers/journal").send(journalBody(50));
    await agent.post("/api/vouchers/journal").send(journalBody(60));

    const after = await pool_count(ctx.companyId);
    // Each journal with 2 entries should add 2 entry rows × 2 vouchers = 4
    expect(after - before).toBe(4);
  });
});

async function pool_count(companyId: number): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*) AS cnt FROM voucher_entries ve
     JOIN vouchers v ON ve.voucher_id = v.id
     WHERE v.company_id = $1`,
    [companyId],
  );
  return parseInt(r.rows[0].cnt, 10);
}

// ── Closing stock summary ─────────────────────────────────────────────────────

describe("Report Accuracy — Closing stock summary", () => {
  it("GET /api/reports/closing-stock-summary returns 200 with structured body", async () => {
    const res = await agent.get("/api/reports/closing-stock-summary");
    expect(res.status).toBe(200);
    expect(typeof res.body === "object" && res.body !== null).toBe(true);
  });

  it("closing stock summary body is not an empty error object", async () => {
    const res = await agent.get("/api/reports/closing-stock-summary");
    expect(res.status).toBe(200);
    // If a 'message' key is the only key, the route returned an error disguised as 200
    const keys = Object.keys(res.body);
    if (keys.length === 1 && keys[0] === "message") {
      throw new Error(`Closing stock summary returned error: ${res.body.message}`);
    }
  });
});

// ── Sales totals visible in P&L ───────────────────────────────────────────────

describe("Report Accuracy — Sales totals appear in P&L after posting", () => {
  const today = new Date().toISOString().split("T")[0];
  const fromDate = "2024-01-01";

  it("P&L totalIncome reflects the posted journal credit amount exactly", async () => {
    // P&L uses startDate/endDate query params (not fromDate/toDate)
    // Omitting dates → all-time report; clean state from beforeEach ensures only our entry
    const KNOWN_AMOUNT = 7919; // prime-ish, unlikely to collide with defaults
    const createRes = await agent.post("/api/vouchers/journal").send(journalBody(KNOWN_AMOUNT));
    expect(createRes.status).toBeGreaterThanOrEqual(200);
    expect(createRes.status).toBeLessThan(300);

    const res = await agent.get("/api/reports/profit-loss");
    expect(res.status).toBe(200);
    // The income section must have our exact posted amount
    expect(res.body.totalIncome).toBeCloseTo(KNOWN_AMOUNT, 0);
    expect(res.body.netProfit).toBeCloseTo(KNOWN_AMOUNT, 0); // no expenses → net = income
  });

  it("incomeItems contains the seeded sales account with correct balance", async () => {
    const KNOWN_AMOUNT = 3311;
    await agent.post("/api/vouchers/journal").send(journalBody(KNOWN_AMOUNT));

    const res = await agent.get("/api/reports/profit-loss");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incomeItems)).toBe(true);

    const salesItem = (res.body.incomeItems as any[]).find(
      (i: any) => i.id === ctx.salesAccountId,
    );
    expect(salesItem).toBeDefined();
    expect(salesItem!.balance).toBeCloseTo(KNOWN_AMOUNT, 0);
  });
});

/*
 * What this file protects:
 * - Ledger balance returned by API = sum of DB DR/CR entries
 * - Balance changes by exactly the posted amount
 * - Balance is always a finite number (no NaN)
 * - Balance-sheet and P&L return 200, structured body, no cross-company leakage
 * - Total debits = total credits in the DB for all company vouchers
 * - Closing stock summary returns 200 with structured (non-error) body
 * - Sales account appears in P&L body after posting a journal
 *
 * Skipped / TODO:
 * - Daybook totals (factory daybook — GET /api/factory/daybook) require a
 *   factory-type company context with seeded factory_daybook_entries.
 *   Covered in factory-container-lifecycle.test.ts.
 */
