import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db } from "../server/db";
import { eq } from "drizzle-orm";
import * as schema from "../shared/schema";
import { storage } from "../server/storage";
import { resolveParentCompanyId, isParentCompanyContext } from "../server/routes/helpers/supplierBalanceHelpers";

// Regression suite for: a newly created ERP child company must NOT show
// suppliers/balances belonging to the parent company.
//
// Business rules under test:
//  - supplier master identities are global, but supplier BALANCES are company-specific.
//  - supplier.openingBalance only ever applies in the explicitly configured parent
//    company's context (never guessed via "lowest company ID").
//  - a child company starts every supplier at $0 and only accrues balance from its
//    own vouchers.
//  - child companies omit suppliers with no activity in that company from the
//    Accounts-style lists.
//  - the parent supplier record itself is never mutated by any of this.

const TEST_PREFIX = "supisotest";

let ctx: TestContext; // parent company
let agent: request.SuperAgentTest; // logged in, scoped to parent

let childCompanyId: number;
let childCashLedgerId: number;
let childAgent: request.SuperAgentTest;

let supplierId: number;
let originalParentCompanyId: number | null;

async function setCompany(a: request.SuperAgentTest, companyId: number) {
  const res = await a.post("/api/auth/set-company").send({ companyId });
  if (res.status !== 200) {
    throw new Error(`set-company to ${companyId} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

function supplierJournalBody(type: "DR" | "CR", cashLedgerId: number, amount: number) {
  const other: "DR" | "CR" = type === "DR" ? "CR" : "DR";
  return {
    voucherDate: new Date().toISOString().split("T")[0],
    notes: "Supplier isolation test entry",
    entries: [
      { type, accountType: "supplier", accountId: supplierId, amount: String(amount), narration: "" },
      { type: other, accountType: "ledger", accountId: cashLedgerId, amount: String(amount), narration: "" },
    ],
  };
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);
  const loginRes = await agent
    .post("/api/auth/login")
    .send({ username: `${TEST_PREFIX}_testuser`, password: "testpassword123" });
  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  await setCompany(agent, ctx.companyId);

  // Create a child ERP company and give the same test user access to it.
  const [childCompany] = await db
    .insert(schema.companies)
    .values({ code: `${TEST_PREFIX.toUpperCase().slice(0, 6)}CH`, name: `${TEST_PREFIX}_ChildCo`, baseCurrency: "USD" })
    .returning();
  childCompanyId = childCompany.id;

  await db.insert(schema.userCompanyRoles).values({
    userId: ctx.userId,
    companyId: childCompanyId,
    role: "Admin",
  });

  const [childCash] = await db
    .insert(schema.ledgerAccounts)
    .values({
      companyId: childCompanyId,
      code: `${TEST_PREFIX}_CHCASH`,
      name: "Child Cash Account",
      accountType: "Cash",
      subType: "Cash",
      openingBalance: "0",
      openingBalanceSide: "Dr",
    })
    .returning();
  childCashLedgerId = childCash.id;

  childAgent = request.agent(ctx.app);
  const childLogin = await childAgent
    .post("/api/auth/login")
    .send({ username: `${TEST_PREFIX}_testuser`, password: "testpassword123" });
  if (childLogin.status !== 200) {
    throw new Error(`Child login failed: ${childLogin.status} ${JSON.stringify(childLogin.body)}`);
  }
  await setCompany(childAgent, childCompanyId);

  // A supplier with a historical opening balance, as if it were set up in the
  // parent company's books before this child company ever existed.
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({
      code: `${TEST_PREFIX}_SUP1`,
      legalName: `${TEST_PREFIX} Supplier One`,
      email: `${TEST_PREFIX}.supplier@example.com`,
      openingBalance: "500.00",
      active: true,
    })
    .returning();
  supplierId = supplier.id;

  // Point the explicit parent-company setting at our seeded parent company,
  // and remember the original value so we can restore it afterwards.
  originalParentCompanyId = await storage.getParentCompanyId();
  await storage.setParentCompanyId(ctx.companyId);
}, 60000);

afterAll(async () => {
  await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.supplierId, supplierId));
  await db.delete(schema.suppliers).where(eq(schema.suppliers.id, supplierId));
  await storage.setParentCompanyId(originalParentCompanyId);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

describe("Supplier balance isolation across companies", () => {
  it("1. parent company sees the supplier's full opening balance intact", async () => {
    const res = await agent.get("/api/accounts/all").set("Cache-Control", "no-cache");
    expect(res.status).toBe(200);
    const acct = res.body.find((a: any) => a.accountId === supplierId && a.type === "supplier");
    expect(acct).toBeTruthy();
    expect(parseFloat(acct.balance)).toBeCloseTo(500, 2);
    expect(parseFloat(acct.openingBalance)).toBeCloseTo(500, 2);
  });

  it("2. child company omits the supplier entirely before any activity (no cross-company bleed, no opening balance)", async () => {
    const res = await agent.get("/api/accounts/all").set("Cache-Control", "no-cache");
    expect(res.status).toBe(200);

    const childRes = await childAgent.get("/api/accounts/all").set("Cache-Control", "no-cache");
    expect(childRes.status).toBe(200);
    const acct = childRes.body.find((a: any) => a.accountId === supplierId && a.type === "supplier");
    expect(acct).toBeFalsy();
  });

  it("3. suppliers/stats omits the no-activity supplier for the child, and suppliers/:id/balance reports zero", async () => {
    const statsRes = await childAgent.get("/api/suppliers/stats");
    expect(statsRes.status).toBe(200);
    // Child has no activity for this supplier yet — it must be omitted from
    // the activity-gated stats list entirely.
    expect(statsRes.body.find((s: any) => s.id === supplierId)).toBeFalsy();

    const balRes = await childAgent.get(`/api/suppliers/${supplierId}/balance`);
    expect(balRes.status).toBe(200);
    expect(balRes.body.balance).toBeCloseTo(0, 2);
  });

  it("4. child company can post its own supplier voucher, and only accrues its own activity", async () => {
    const res = await childAgent
      .post("/api/vouchers/journal")
      .send(supplierJournalBody("CR", childCashLedgerId, 200));
    expect(res.status).toBe(200);

    const allRes = await childAgent.get("/api/accounts/all").set("Cache-Control", "no-cache");
    const acct = allRes.body.find((a: any) => a.accountId === supplierId && a.type === "supplier");
    expect(acct).toBeTruthy();
    expect(parseFloat(acct.balance)).toBeCloseTo(200, 2);
    expect(parseFloat(acct.openingBalance)).toBeCloseTo(0, 2);

    const statsRes = await childAgent.get("/api/suppliers/stats");
    const stat = statsRes.body.find((s: any) => s.id === supplierId);
    expect(stat).toBeTruthy();
    expect(stat.hasActivity).toBe(true);
    expect(stat.balance).toBeCloseTo(200, 2);
  });

  it("5. parent company's balance is unaffected by the child's voucher", async () => {
    const res = await agent.get("/api/accounts/all").set("Cache-Control", "no-cache");
    const acct = res.body.find((a: any) => a.accountId === supplierId && a.type === "supplier");
    expect(acct).toBeTruthy();
    expect(parseFloat(acct.balance)).toBeCloseTo(500, 2);
  });

  it("6. suppliers/stats, payables, and voucher-sidebar stay consistent with accounts/all for both companies", async () => {
    const [childStats, childPayables, childSidebar] = await Promise.all([
      childAgent.get("/api/suppliers/stats"),
      childAgent.get("/api/accounts/payables"),
      childAgent.get("/api/accounts/voucher-sidebar"),
    ]);
    expect(childStats.body.find((s: any) => s.id === supplierId).balance).toBeCloseTo(200, 2);
    expect(childPayables.body.find((p: any) => p.id === supplierId).balance).toBeCloseTo(200, 2);
    const childSidebarSupplier = childSidebar.body.suppliers?.find?.((s: any) => s.id === supplierId) ??
      (Array.isArray(childSidebar.body) ? childSidebar.body.find((s: any) => s.id === supplierId) : undefined);
    if (childSidebarSupplier) {
      expect(childSidebarSupplier.balance).toBeCloseTo(-200, 2);
    }

    const [parentStats, parentPayables] = await Promise.all([
      agent.get("/api/suppliers/stats"),
      agent.get("/api/accounts/payables"),
    ]);
    expect(parentStats.body.find((s: any) => s.id === supplierId).balance).toBeCloseTo(500, 2);
    expect(parentPayables.body.find((p: any) => p.id === supplierId).balance).toBeCloseTo(500, 2);
  });

  it("7. date-filtered/brought-forward supplier transactions are scoped per company, not global", async () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    const futureStr = future.toISOString().split("T")[0];

    const childTx = await childAgent.get(
      `/api/accounts/supplier/${supplierId}/transactions?startDate=${futureStr}`
    );
    expect(childTx.status).toBe(200);
    // Brought-forward for the child should reflect only the child's own 200 CR entry,
    // never any entries that might exist under the parent company.
    expect(parseFloat(childTx.body.preNetBalance)).toBeCloseTo(-200, 2);

    // The parent company has no *voucher entries* for this supplier at all (its
    // balance comes entirely from supplier.openingBalance, which this endpoint's
    // brought-forward figure does not include) — so it must show 0, and critically
    // must NOT pick up the child's -200 across the (shared) supplier record.
    const parentTx = await agent.get(`/api/accounts/supplier/${supplierId}/transactions?startDate=${futureStr}`);
    expect(parentTx.status).toBe(200);
    expect(parseFloat(parentTx.body.preNetBalance)).toBeCloseTo(0, 2);
  });

  it("8. an unauthorized companyId query param on supplier transactions is rejected", async () => {
    const res = await childAgent.get(`/api/accounts/supplier/${supplierId}/transactions?companyId=1`);
    expect(res.status).toBe(403);
  });

  it("9. pre-period-balance for supplier type is scoped per company", async () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    const futureStr = future.toISOString().split("T")[0];

    const childPre = await childAgent.get(
      `/api/accounts/supplier/${supplierId}/pre-period-balance?endDate=${futureStr}`
    );
    expect(childPre.status).toBe(200);
    expect(parseFloat(childPre.body.balance)).toBeCloseTo(200, 2);

    const parentPre = await agent.get(`/api/accounts/supplier/${supplierId}/pre-period-balance?endDate=${futureStr}`);
    expect(parentPre.status).toBe(200);
    expect(parseFloat(parentPre.body.balance)).toBeCloseTo(500, 2);
  });

  it("10. parent detection never guesses via lowest company ID, even though a lower-ID company exists", async () => {
    const allCompanies = await storage.getAllCompanies();
    const lowestId = Math.min(...allCompanies.map((c: any) => c.id));
    expect(lowestId).toBeLessThan(ctx.companyId);

    const resolved = await resolveParentCompanyId();
    expect(resolved).toBe(ctx.companyId);
    expect(resolved).not.toBe(lowestId);

    expect(await isParentCompanyContext(lowestId)).toBe(false);
    expect(await isParentCompanyContext(ctx.companyId)).toBe(true);
  });

  it("11. creating a brand-new company does not copy supplier balances, and the parent's supplier record is never mutated", async () => {
    const [grandchild] = await db
      .insert(schema.companies)
      .values({
        code: `${TEST_PREFIX.toUpperCase().slice(0, 5)}GC`,
        name: `${TEST_PREFIX}_GrandchildCo`,
        baseCurrency: "USD",
      })
      .returning();

    await db.insert(schema.userCompanyRoles).values({
      userId: ctx.userId,
      companyId: grandchild.id,
      role: "Admin",
    });

    const gcAgent = request.agent(ctx.app);
    await gcAgent.post("/api/auth/login").send({ username: `${TEST_PREFIX}_testuser`, password: "testpassword123" });
    await setCompany(gcAgent, grandchild.id);

    const gcAll = await gcAgent.get("/api/accounts/all").set("Cache-Control", "no-cache");
    expect(gcAll.body.find((a: any) => a.accountId === supplierId)).toBeFalsy();

    const gcBalance = await gcAgent.get(`/api/suppliers/${supplierId}/balance`);
    expect(gcBalance.body.balance).toBeCloseTo(0, 2);

    // The parent supplier row itself must be untouched by any of this.
    const [supplierRow] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, supplierId));
    expect(parseFloat(supplierRow.openingBalance || "0")).toBeCloseTo(500, 2);

    await db.delete(schema.userCompanyRoles).where(eq(schema.userCompanyRoles.companyId, grandchild.id));
    await db.delete(schema.companies).where(eq(schema.companies.id, grandchild.id));
  });
});
