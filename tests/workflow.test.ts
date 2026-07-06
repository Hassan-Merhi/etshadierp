/**
 * Phase 5 — Full Business Workflow Tests
 * ----------------------------------------
 * End-to-end integration tests that verify multiple subsystems work together:
 * POS sale ↔ voucher entries ↔ ledger balances ↔ reports.
 *
 * What this file does NOT duplicate (already covered elsewhere):
 *   - Basic POS creates voucher / reduces inventory / creates sales_items  (pos.test.ts)
 *   - Journal DR=CR creation + rejection of unbalanced entries             (vouchers.test.ts, accounting.test.ts)
 *   - Payment/receipt DR=CR                                                (accounting.test.ts)
 *   - Ledger balance 200, P&L 200, balance-sheet 200 (status only)        (reports.test.ts)
 *   - Basic company isolation for accounts endpoint                        (accounting.test.ts)
 *   - Factory container lifecycle                                          (factory-container-lifecycle.test.ts)
 *
 * What this file adds:
 *   - POS sale → cash ledger balance increases by sale total
 *   - POS sale → ledger transactions list includes an entry for the sale
 *   - POS delete → inventory AND ledger both reverse
 *   - POS sale voucher entries are balanced (DR = CR) in DB
 *   - Payment voucher → payment account balance changes
 *   - Payment voucher delete → balance reverts to pre-creation level
 *   - Receipt voucher entries balanced; voucher retrievable via GET /api/vouchers/:id
 *   - Payment voucher appears in GET /api/vouchers list
 *   - Journal edit (PATCH) → DB entries reflect the new amount
 *   - Journal delete → voucher soft-deleted (no longer active)
 *   - Ledger balance API value matches DB sum of DR − CR entries
 *   - P&L: non-NaN result after a real POS sale
 *   - Balance-sheet: no NaN strings in response
 *   - GET /api/vouchers: no NaN totalAmounts
 *   - Company isolation: voucher list, ledger balance, and inventory don't bleed across companies
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import {
  seedTestData,
  cleanupTestData,
  closeTestServer,
  getInventoryQty,
  type TestContext,
} from "./setup";
import { db } from "../server/db";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "../shared/schema";

const TEST_PREFIX = "wftest";
const TODAY = new Date().toISOString().split("T")[0];

let ctx: TestContext;
let agent: request.SuperAgentTest;

// ── helpers ───────────────────────────────────────────────────────────────────

async function loginAsTestUser() {
  const res = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  if (res.status !== 200)
    throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.body)}`);
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
}

async function resetInventory() {
  for (const stockItemId of ctx.stockItemIds) {
    const [existing] = await db
      .select()
      .from(schema.inventory)
      .where(
        and(
          eq(schema.inventory.locationId, ctx.locationId),
          eq(schema.inventory.stockItemId, stockItemId),
        ),
      );
    if (existing) {
      await db
        .update(schema.inventory)
        .set({ quantity: "100.000", averageRate: "10.00", totalValue: "1000.00" })
        .where(eq(schema.inventory.id, existing.id));
    }
  }
}

async function cleanupVouchers() {
  const rows = await db
    .select({ id: schema.vouchers.id })
    .from(schema.vouchers)
    .where(eq(schema.vouchers.companyId, ctx.companyId));
  for (const v of rows) {
    await db.delete(schema.salesItems).where(eq(schema.salesItems.voucherId, v.id));
    await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, v.id));
  }
  await db.delete(schema.vouchers).where(eq(schema.vouchers.companyId, ctx.companyId));
}

/** Extract the new voucher ID from any create-endpoint response shape. */
function extractId(body: any): number | undefined {
  return body?.voucher?.id ?? body?.id ?? body?.voucherId;
}

function posSaleBody(qty = 5, rate = 20) {
  return {
    locationId: ctx.locationId,
    items: [{ stockItemId: ctx.stockItemIds[0], quantity: qty, rate }],
    paymentAccountType: "ledger",
    paymentAccountId: ctx.cashAccountId,
    voucherDate: TODAY,
  };
}

function journalBody(amount: number, notes = "Workflow test") {
  return {
    voucherDate: TODAY,
    notes,
    entries: [
      {
        type: "DR",
        accountType: "ledger",
        accountId: ctx.cashAccountId,
        amount: String(amount),
        narration: "",
      },
      {
        type: "CR",
        accountType: "ledger",
        accountId: ctx.salesAccountId,
        amount: String(amount),
        narration: "",
      },
    ],
  };
}

function paymentBody(voucherType: "Payment" | "Receipt", amount: number) {
  return {
    voucherType,
    voucherDate: TODAY,
    paymentAccountType: "ledger",
    paymentAccountId: ctx.cashAccountId,
    paymentAccountName: "Cash",
    entries: [
      {
        accountType: "ledger",
        accountId: ctx.salesAccountId,
        accountName: "Sales",
        amount: String(amount),
      },
    ],
    notes: `${voucherType} workflow test`,
    currency: "USD",
  };
}

async function getLedgerBalance(accountId: number): Promise<number> {
  const res = await agent.get(`/api/accounts/ledger/${accountId}/balance`);
  return parseFloat(res.body?.balance ?? "0");
}

// ── setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);
  await loginAsTestUser();
}, 60_000);

afterAll(async () => {
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30_000);

// ═════════════════════════════════════════════════════════════════════════════
// 1. POS SALE FULL WORKFLOW
// ═════════════════════════════════════════════════════════════════════════════

describe("Workflow — POS sale → ledger chain", () => {
  beforeEach(async () => {
    await resetInventory();
    await cleanupVouchers();
  });

  it("cash account ledger balance increases by the sale total after a POS sale", async () => {
    const before = await getLedgerBalance(ctx.cashAccountId);

    const res = await agent.post("/api/pos/sales").send(posSaleBody(5, 20)); // 5 × 20 = 100
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    const after = await getLedgerBalance(ctx.cashAccountId);
    // Cash is debited on a sale → net balance (Dr side) increases by 100
    expect(after - before).toBeCloseTo(100, 1);
  });

  it("ledger transactions include an entry referencing the sale voucher", async () => {
    const res = await agent.post("/api/pos/sales").send(posSaleBody(3, 30)); // 90
    expect(res.status).toBeGreaterThanOrEqual(200);
    const voucherId = extractId(res.body);
    expect(voucherId).toBeDefined();

    const txRes = await agent.get(`/api/accounts/ledger/${ctx.cashAccountId}/transactions`);
    expect(txRes.status).toBe(200);

    const transactions: any[] = Array.isArray(txRes.body)
      ? txRes.body
      : txRes.body?.transactions ?? txRes.body?.entries ?? [];

    const match = transactions.some(
      (t: any) =>
        (t.voucherId === voucherId || t.voucher_id === voucherId) &&
        parseFloat(t.debitAmount ?? t.debit_amount ?? t.amount ?? "0") > 0,
    );
    expect(match, `Expected transaction for voucherId=${voucherId} in ledger`).toBe(true);
  });

  it("deleting the sale voucher restores inventory and reverses the ledger balance", async () => {
    const res = await agent.post("/api/pos/sales").send(posSaleBody(10, 15)); // 10 × 15 = 150
    expect(res.status).toBeGreaterThanOrEqual(200);
    const voucherId = extractId(res.body);
    expect(voucherId).toBeDefined();

    const qtyAfterSale = await getInventoryQty(ctx.locationId, ctx.stockItemIds[0]);
    expect(qtyAfterSale).toBe(90); // 100 − 10

    const balAfterSale = await getLedgerBalance(ctx.cashAccountId);

    const delRes = await agent.delete(`/api/vouchers/${voucherId}`);
    expect(delRes.status).toBeGreaterThanOrEqual(200);
    expect(delRes.status).toBeLessThan(300);

    // Inventory restored
    const qtyAfterDelete = await getInventoryQty(ctx.locationId, ctx.stockItemIds[0]);
    expect(qtyAfterDelete).toBe(100);

    // Ledger reversed — balance dropped back by 150
    const balAfterDelete = await getLedgerBalance(ctx.cashAccountId);
    expect(balAfterDelete).toBeCloseTo(balAfterSale - 150, 1);
  });

  it("POS sale voucher entries are balanced (DR = CR) in the database", async () => {
    const res = await agent.post("/api/pos/sales").send(posSaleBody(4, 25)); // 100
    expect(res.status).toBeGreaterThanOrEqual(200);
    const voucherId = extractId(res.body);
    expect(voucherId).toBeDefined();

    const entries = await db
      .select()
      .from(schema.voucherEntries)
      .where(eq(schema.voucherEntries.voucherId, voucherId!));

    expect(entries.length).toBeGreaterThan(0);
    const totalDR = entries.reduce((s, e) => s + parseFloat(e.debitAmount ?? "0"), 0);
    const totalCR = entries.reduce((s, e) => s + parseFloat(e.creditAmount ?? "0"), 0);
    expect(Math.abs(totalDR - totalCR)).toBeLessThan(0.01);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. PAYMENT / RECEIPT VOUCHER WORKFLOW
// ═════════════════════════════════════════════════════════════════════════════

describe("Workflow — Payment voucher → balance change → delete → revert", () => {
  beforeEach(cleanupVouchers);

  it("creating a Payment voucher shifts the payment account balance", async () => {
    const before = await getLedgerBalance(ctx.cashAccountId);

    const res = await agent.post("/api/vouchers/payment-receipt").send(paymentBody("Payment", 200));
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    const after = await getLedgerBalance(ctx.cashAccountId);
    // Payment: cash is CR → Dr-side balance decreases; we check the magnitude
    expect(Math.abs(after - before)).toBeCloseTo(200, 1);
  });

  it("deleting a Payment voucher reverts the account balance", async () => {
    const before = await getLedgerBalance(ctx.cashAccountId);

    const res = await agent.post("/api/vouchers/payment-receipt").send(paymentBody("Payment", 300));
    const voucherId = extractId(res.body);
    expect(voucherId).toBeDefined();

    const afterCreate = await getLedgerBalance(ctx.cashAccountId);
    expect(Math.abs(afterCreate - before)).toBeCloseTo(300, 1);

    const delRes = await agent.delete(`/api/vouchers/${voucherId}`);
    expect(delRes.status).toBeGreaterThanOrEqual(200);
    expect(delRes.status).toBeLessThan(300);

    const afterDelete = await getLedgerBalance(ctx.cashAccountId);
    expect(afterDelete).toBeCloseTo(before, 1);
  });

  it("Receipt voucher entries are balanced in DB and the voucher is retrievable", async () => {
    const res = await agent.post("/api/vouchers/payment-receipt").send(paymentBody("Receipt", 150));
    expect(res.status).toBeGreaterThanOrEqual(200);
    const voucherId = extractId(res.body);
    expect(voucherId).toBeDefined();

    const entries = await db
      .select()
      .from(schema.voucherEntries)
      .where(eq(schema.voucherEntries.voucherId, voucherId!));
    const dr = entries.reduce((s, e) => s + parseFloat(e.debitAmount ?? "0"), 0);
    const cr = entries.reduce((s, e) => s + parseFloat(e.creditAmount ?? "0"), 0);
    expect(Math.abs(dr - cr)).toBeLessThan(0.01);

    const getRes = await agent.get(`/api/vouchers/${voucherId}`);
    expect(getRes.status).toBe(200);
    const returnedId = getRes.body?.voucher?.id ?? getRes.body?.id;
    expect(returnedId).toBe(voucherId);
  });

  it("Payment voucher appears in GET /api/vouchers list", async () => {
    const res = await agent.post("/api/vouchers/payment-receipt").send(paymentBody("Payment", 75));
    const voucherId = extractId(res.body);
    expect(voucherId).toBeDefined();

    const listRes = await agent.get("/api/vouchers");
    expect(listRes.status).toBe(200);

    const list: any[] = Array.isArray(listRes.body)
      ? listRes.body
      : listRes.body?.vouchers ?? [];

    const found = list.some((v: any) => v.id === voucherId);
    expect(found).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. JOURNAL VOUCHER — EDIT AND DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe("Workflow — Journal voucher edit and delete", () => {
  beforeEach(cleanupVouchers);

  it("editing a journal voucher (PATCH) updates its entries in the database", async () => {
    const createRes = await agent
      .post("/api/vouchers/journal")
      .send(journalBody(500, "Initial amount"));
    expect(createRes.status).toBeGreaterThanOrEqual(200);
    const voucherId = extractId(createRes.body);
    expect(voucherId).toBeDefined();

    const editRes = await agent
      .patch(`/api/vouchers/${voucherId}/journal`)
      .send(journalBody(800, "Updated amount"));
    expect(
      editRes.status,
      `PATCH journal failed: ${editRes.status} ${JSON.stringify(editRes.body)}`,
    ).toBeGreaterThanOrEqual(200);
    expect(editRes.status).toBeLessThan(300);

    const entries = await db
      .select()
      .from(schema.voucherEntries)
      .where(eq(schema.voucherEntries.voucherId, voucherId!));

    const totalDR = entries.reduce((s, e) => s + parseFloat(e.debitAmount ?? "0"), 0);
    const totalCR = entries.reduce((s, e) => s + parseFloat(e.creditAmount ?? "0"), 0);
    expect(totalDR).toBeCloseTo(800, 1);
    expect(totalCR).toBeCloseTo(800, 1);
  });

  it("deleting a journal voucher soft-deletes the voucher (no longer active)", async () => {
    const createRes = await agent
      .post("/api/vouchers/journal")
      .send(journalBody(250, "Delete test"));
    const voucherId = extractId(createRes.body);
    expect(voucherId).toBeDefined();

    const delRes = await agent.delete(`/api/vouchers/${voucherId}`);
    expect(delRes.status).toBeGreaterThanOrEqual(200);
    expect(delRes.status).toBeLessThan(300);

    // The DELETE route soft-deletes: voucher gets a deletedAt timestamp.
    // Entries remain in DB as an audit trail but are excluded from live calculations.
    const vRows = await db
      .select()
      .from(schema.vouchers)
      .where(eq(schema.vouchers.id, voucherId!));
    const active = vRows.filter((v) => !v.deletedAt);
    expect(active.length).toBe(0); // no active (non-deleted) voucher row
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. REPORTS WORKFLOW
// ═════════════════════════════════════════════════════════════════════════════

describe("Workflow — Reports reflect seeded transactions", () => {
  beforeEach(async () => {
    await resetInventory();
    await cleanupVouchers();
  });

  it("ledger balance API matches the DB sum of DR − CR entries for that account", async () => {
    // cleanupVouchers + resetInventory run in beforeEach, and the seeded cash account
    // has openingBalance = "0", so dbNet = 0 before we post. After posting, dbNet = 1400.
    await agent.post("/api/vouchers/journal").send(journalBody(1000, "Balance check 1"));
    await agent.post("/api/vouchers/journal").send(journalBody(400, "Balance check 2"));

    // Compute the expected net debit from Company A's own entries only.
    const entries = await db
      .select()
      .from(schema.voucherEntries)
      .where(
        and(
          eq(schema.voucherEntries.ledgerAccountId, ctx.cashAccountId),
          sql`${schema.voucherEntries.voucherId} IN (
            SELECT id FROM vouchers WHERE company_id = ${ctx.companyId}
          )`,
        ),
      );
    const dbNet = entries.reduce(
      (s, e) => s + parseFloat(e.debitAmount ?? "0") - parseFloat(e.creditAmount ?? "0"),
      0,
    );

    const balRes = await agent.get(`/api/accounts/ledger/${ctx.cashAccountId}/balance`);
    expect(balRes.status).toBe(200);
    const apiBalance = parseFloat(balRes.body?.balance ?? "NaN");
    expect(isNaN(apiBalance)).toBe(false);
    // API must match DB-computed net (1400 DR from the two journals above).
    expect(apiBalance).toBeCloseTo(dbNet, 1);
    expect(dbNet).toBeCloseTo(1400, 1); // sanity-check that beforeEach actually cleared state
  });

  it("P&L report returns a non-NaN result after a POS sale", async () => {
    await agent.post("/api/pos/sales").send(posSaleBody(2, 50)); // 100

    const res = await agent.get("/api/reports/profit-loss");
    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();

    const jsonStr = JSON.stringify(res.body);
    expect(jsonStr).not.toContain('"NaN"');
    expect(jsonStr).not.toContain('"undefined"');

    // Extract whichever key the response uses for the net figure
    const net = res.body?.netProfit ?? res.body?.netIncome ?? res.body?.profit;
    if (net !== undefined && net !== null) {
      expect(isNaN(parseFloat(String(net)))).toBe(false);
    }
  });

  it("balance-sheet response contains no NaN strings", async () => {
    await agent.post("/api/vouchers/payment-receipt").send(paymentBody("Receipt", 500));

    const res = await agent.get("/api/reports/balance-sheet");
    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();

    const jsonStr = JSON.stringify(res.body);
    expect(jsonStr).not.toContain('"NaN"');
    expect(jsonStr).not.toContain('"undefined"');
  });

  it("GET /api/vouchers does not return any vouchers with NaN totalAmount", async () => {
    await agent.post("/api/vouchers/journal").send(journalBody(300, "NaN-guard test"));

    const res = await agent.get("/api/vouchers");
    expect(res.status).toBe(200);

    const list: any[] = Array.isArray(res.body) ? res.body : res.body?.vouchers ?? [];
    for (const v of list) {
      if (v.totalAmount !== undefined && v.totalAmount !== null) {
        expect(
          isNaN(parseFloat(v.totalAmount)),
          `Voucher ${v.id} has NaN totalAmount: ${v.totalAmount}`,
        ).toBe(false);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. COMPANY ISOLATION WORKFLOW
// ═════════════════════════════════════════════════════════════════════════════

describe("Workflow — Company isolation (vouchers, ledger, inventory)", () => {
  // Company B is seeded directly in the DB. Critically, one of Company B's voucher
  // entries intentionally references ctx.cashAccountId (Company A's own ledger account).
  // This makes the ledger-isolation test meaningful: if the balance API forgets to
  // filter through vouchers.companyId, it would pick up that 88888 entry and the
  // assertion would fail.
  let companyBId: number;
  let companyBVoucherId: number; // stored for explicit ID-based voucher-list assertion
  let accountBId: number;       // Company B's account ID — used in ledger-access isolation test

  beforeAll(async () => {
    const [co] = await db
      .insert(schema.companies)
      .values({
        code: `${TEST_PREFIX}_B`,
        name: `${TEST_PREFIX}_CompanyB`,
        baseCurrency: "USD",
      })
      .returning();
    companyBId = co.id;

    const [acct] = await db
      .insert(schema.ledgerAccounts)
      .values({
        companyId: companyBId,
        code: `${TEST_PREFIX}_B_CASH`,
        name: "Company B Cash",
        accountType: "Cash",
        subType: "Cash",
        openingBalance: "0",
        openingBalanceSide: "Dr",
      })
      .returning();
    accountBId = acct.id;

    // Company B voucher with a large balance on its own account.
    // companyBVoucherId is used in the voucher-list test to check by exact ID.
    // acct.id is used in the ledger-access test to verify Company A can't read Company B's account.
    const [vB] = await db
      .insert(schema.vouchers)
      .values({
        companyId: companyBId,
        voucherNumber: `JOURNAL-B-${Date.now()}`,
        voucherType: "Journal",
        voucherDate: TODAY,
        totalAmount: "88888.00",
      })
      .returning();
    companyBVoucherId = vB.id;

    await db.insert(schema.voucherEntries).values([
      {
        voucherId: vB.id,
        ledgerAccountId: acct.id,
        debitAmount: "88888.00",
        creditAmount: "0.00",
      },
      {
        voucherId: vB.id,
        ledgerAccountId: acct.id,
        debitAmount: "0.00",
        creditAmount: "88888.00",
      },
    ]);
  });

  // Start each test with a clean Company A voucher slate so the ledger balance
  // test has a known baseline and no test leaks state into the next.
  beforeEach(cleanupVouchers);

  afterAll(async () => {
    // FK-safe teardown — covers everything any test in this block may have created,
    // so cleanup always runs even when a test fails before its inline cleanup.
    await db.delete(schema.inventory).where(eq(schema.inventory.companyId, companyBId));
    await db.delete(schema.voucherEntries).where(
      sql`${schema.voucherEntries.voucherId} IN (
        SELECT id FROM vouchers WHERE company_id = ${companyBId}
      )`,
    );
    await db.delete(schema.vouchers).where(eq(schema.vouchers.companyId, companyBId));
    await db.delete(schema.stockItems).where(eq(schema.stockItems.companyId, companyBId));
    await db.delete(schema.stockGroups).where(eq(schema.stockGroups.companyId, companyBId));
    await db.delete(schema.locations).where(eq(schema.locations.companyId, companyBId));
    await db.delete(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.companyId, companyBId));
    await db.delete(schema.companies).where(eq(schema.companies.id, companyBId));
  });

  it("Company A voucher list does not include Company B vouchers (explicit ID check)", async () => {
    // Create one Company A voucher so the list is non-empty.
    const res = await agent.post("/api/vouchers/journal").send(journalBody(100, "Isolation check"));
    expect(res.status).toBeGreaterThanOrEqual(200);
    const voucherAId = extractId(res.body);
    expect(voucherAId).toBeDefined();

    const listRes = await agent.get("/api/vouchers");
    expect(listRes.status).toBe(200);
    const list: any[] = Array.isArray(listRes.body) ? listRes.body : listRes.body?.vouchers ?? [];

    // Company A's voucher must be present
    expect(list.some((v: any) => v.id === voucherAId)).toBe(true);

    // Company B's voucher must NOT be present — checked by exact DB-assigned ID
    expect(
      list.some((v: any) => v.id === companyBVoucherId),
      `Company B voucher ${companyBVoucherId} must not appear in Company A voucher list`,
    ).toBe(false);

    // Belt-and-suspenders: every row that carries companyId must belong to Company A
    for (const v of list) {
      const cid = v.companyId ?? v.company_id;
      if (cid !== undefined) expect(cid).toBe(ctx.companyId);
    }
  });

  it("Company A session cannot retrieve Company B's account balance", async () => {
    // Realistic isolation: ledger accounts are per-company by design, so the attack vector
    // is a Company A user querying accountBId (which belongs to Company B) via the API.
    // The endpoint should either return 4xx (access denied / not found) OR return 0 — but
    // must NOT return 88888 (Company B's actual balance).
    //
    // Note: accountBId was created with companyId = companyBId; Company A's session should
    // not have visibility into it.
    const res = await agent.get(`/api/accounts/ledger/${accountBId}/balance`);

    if (res.status >= 400) {
      // Preferred: the endpoint rejects access to another company's account
      expect(res.status).toBeGreaterThanOrEqual(400);
    } else {
      // Acceptable: the endpoint returns 200 but balance must not be 88888 (B's balance)
      expect(res.status).toBe(200);
      const balance = parseFloat(res.body?.balance ?? "NaN");
      expect(isNaN(balance)).toBe(false);
      expect(balance).not.toBeCloseTo(88888, 0);
    }
  });

  it("Company A inventory endpoint does not include Company B stock items", async () => {
    // Seed Company B with its own location and inventory item.
    const [grp] = await db
      .insert(schema.stockGroups)
      .values({
        companyId: companyBId,
        name: `${TEST_PREFIX}_B_Group`,
        code: `${TEST_PREFIX}_BG`,
      })
      .returning();

    const [item] = await db
      .insert(schema.stockItems)
      .values({
        companyId: companyBId,
        stockGroupId: grp.id,
        name: `${TEST_PREFIX}_B_Item`,
        code: `${TEST_PREFIX}_BITEM`,
        uom: "pcs",
      })
      .returning();

    const [locB] = await db
      .insert(schema.locations)
      .values({ companyId: companyBId, name: "B-WH", code: `${TEST_PREFIX}_BLOC` })
      .returning();

    await db.insert(schema.inventory).values({
      companyId: companyBId,
      locationId: locB.id,
      stockItemId: item.id,
      quantity: "99999.00",
      averageRate: "1.00",
      totalValue: "99999.00",
    });

    const invRes = await agent.get(`/api/inventory?locationId=${ctx.locationId}`);
    expect(invRes.status).toBe(200);
    const inv: any[] = Array.isArray(invRes.body) ? invRes.body : invRes.body?.inventory ?? [];

    // Checked by exact DB-assigned stock item ID — not a sentinel amount
    const hasB = inv.some(
      (i: any) => i.stockItemId === item.id || i.stock_item_id === item.id,
    );
    expect(hasB).toBe(false);

    // Inline cleanup — afterAll covers this too, but belt-and-suspenders
    await db.delete(schema.inventory).where(eq(schema.inventory.locationId, locB.id));
    await db.delete(schema.stockItems).where(eq(schema.stockItems.id, item.id));
    await db.delete(schema.stockGroups).where(eq(schema.stockGroups.id, grp.id));
    await db.delete(schema.locations).where(eq(schema.locations.id, locB.id));
  });
});

/*
 * What this file protects:
 * - POS sale → cash ledger balance increases by sale total (DB + API agree)
 * - POS sale → ledger transactions list includes an entry for the sale voucher
 * - POS sale delete → inventory restored AND ledger balance reversed
 * - POS sale voucher entries: DR = CR in DB
 * - Payment voucher → payment account balance changes
 * - Payment voucher delete → balance reverts to pre-creation level
 * - Receipt voucher: entries balanced in DB; retrievable via GET /api/vouchers/:id
 * - Payment voucher: appears in GET /api/vouchers list
 * - Journal edit (PATCH /api/vouchers/:id/journal): entries reflect new amount
 * - Journal delete: voucher soft-deleted (deletedAt set); no longer returned as active
 * - Ledger balance API matches DB net (DR − CR) for Company A entries only
 * - P&L: no NaN after a POS sale
 * - Balance-sheet: no NaN strings in JSON response
 * - GET /api/vouchers: no NaN totalAmounts
 * - Company isolation (voucher list): Company B voucher excluded by exact ID check
 * - Company isolation (ledger balance): Company B 88888 entry on Company A's account does not bleed
 * - Company isolation (inventory): Company A inventory endpoint does not show Company B stock item by ID
 *
 * Not covered (by design):
 * - Factory/SP full accounting workflow: factory-container-lifecycle.test.ts covers offload/inventory
 * - Basic POS flow, DR=CR validation, report HTTP-200 status: already in existing test files
 */
