/**
 * Behavioural coverage for the insurance write routes.
 *
 * All five were guard-only. Four maintain `insurance_members` and the ledger
 * account each member owns; the fifth, `POST /api/insurance/generate`, posts a
 * monthly journal into `vouchers` and `voucher_entries` with one leg per member.
 *
 * Two things are worth holding here and neither had a test:
 *
 *   - **Proration.** A member whose start date falls inside the period is
 *     charged for the remaining days only, `amount / daysInMonth * daysRemaining`.
 *     Getting that wrong overcharges or undercharges every month it runs, and
 *     the totals still balance, so nothing downstream notices.
 *   - **The member's ledger account tracks the member.** Creating a member
 *     opens one, renaming the member renames it, and deleting the member
 *     tombstones it. A rename that left the account behind puts the next
 *     month's journal under the old name.
 *
 * DIRECTION: `generate` debits Insurance Expense and credits each member's
 * liability account. It ran the other way round until the direction was
 * corrected — the expense credited, the liabilities debited — which made the
 * monthly journal reduce recorded expense and made each member's account read
 * as an asset. The specific direction is asserted below rather than merely that
 * the legs land on opposite sides, so the correction cannot be quietly undone.
 * Journals posted before the fix keep the old direction; repairing those is a
 * data question and is left to whoever owns the chart of accounts.
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { pool } from "../server/db";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";

const TEST_PREFIX = "inswr";

let ctx: TestContext;
let agent: request.SuperAgentTest;

interface MemberRow {
  id: number;
  name: string;
  active: boolean;
  amount: string;
  ledger_account_id: number | null;
}

async function memberRow(id: number): Promise<MemberRow | null> {
  const result = await pool.query<MemberRow>(
    `SELECT id, name, active, amount, ledger_account_id FROM insurance_members WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

async function createMember(fields: { name: string; amount: string; startDate: string; active?: boolean }) {
  const response = await agent.post("/api/insurance/members").send({
    name: fields.name,
    amount: fields.amount,
    startDate: fields.startDate,
    active: fields.active ?? true,
  });
  if (response.status !== 201) throw new Error(`Seed member failed: ${response.status} ${response.text}`);
  return response.body as MemberRow;
}

/** Deactivate everything so each generate test controls its own population. */
async function deactivateAllMembers() {
  await pool.query(`UPDATE insurance_members SET active = false WHERE company_id = $1`, [ctx.companyId]);
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);

  const login = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  if (login.status !== 200) throw new Error(`Login failed: ${login.status}`);
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
}, 120000);

afterAll(async () => {
  await pool.query(`DELETE FROM insurance_members WHERE company_id = $1`, [ctx.companyId]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60000);

describe("POST /api/insurance/members", () => {
  it("creates the member with a liability ledger account named after them", async () => {
    const member = await createMember({ name: `${TEST_PREFIX} Alpha`, amount: "100.00", startDate: "2026-01-01" });

    expect(member.ledger_account_id).toBeTruthy();
    const account = await pool.query<{ name: string; account_type: string; company_id: number }>(
      `SELECT name, account_type, company_id FROM ledger_accounts WHERE id = $1`,
      [member.ledger_account_id]
    );
    expect(account.rows[0].name).toBe(`Insurance - ${TEST_PREFIX} Alpha`);
    expect(account.rows[0].account_type).toBe("Liability");
    expect(account.rows[0].company_id).toBe(ctx.companyId);
  });

  it("rejects a member with no name or no amount", async () => {
    expect((await agent.post("/api/insurance/members").send({ amount: "10", startDate: "2026-01-01" })).status).toBe(
      400
    );
    expect((await agent.post("/api/insurance/members").send({ name: "x", startDate: "2026-01-01" })).status).toBe(400);
  });
});

describe("PATCH /api/insurance/members/:id", () => {
  it("renames the member's ledger account when the member is renamed", async () => {
    const member = await createMember({ name: `${TEST_PREFIX} Before`, amount: "50.00", startDate: "2026-01-01" });

    const response = await agent.patch(`/api/insurance/members/${member.id}`).send({ name: `${TEST_PREFIX} After` });
    expect(response.status).toBe(200);

    // The account carries the name into every future journal; leaving it behind
    // files next month's entry under someone who no longer exists.
    const account = await pool.query<{ name: string }>(`SELECT name FROM ledger_accounts WHERE id = $1`, [
      member.ledger_account_id,
    ]);
    expect(account.rows[0].name).toBe(`Insurance - ${TEST_PREFIX} After`);
  });

  it("returns 404 for an unknown member and 400 for a bad id", async () => {
    expect((await agent.patch("/api/insurance/members/999999").send({ name: "x" })).status).toBe(404);
    expect((await agent.patch("/api/insurance/members/0").send({ name: "x" })).status).toBe(400);
  });
});

describe("PATCH /api/insurance/members/:id/toggle", () => {
  it("flips active and flips it back", async () => {
    const member = await createMember({ name: `${TEST_PREFIX} Toggle`, amount: "10.00", startDate: "2026-01-01" });
    expect((await memberRow(member.id))?.active).toBe(true);

    await agent.patch(`/api/insurance/members/${member.id}/toggle`);
    expect((await memberRow(member.id))?.active).toBe(false);

    await agent.patch(`/api/insurance/members/${member.id}/toggle`);
    expect((await memberRow(member.id))?.active).toBe(true);
  });
});

describe("DELETE /api/insurance/members/:id", () => {
  it("removes the member and tombstones their ledger account", async () => {
    const member = await createMember({ name: `${TEST_PREFIX} Gone`, amount: "10.00", startDate: "2026-01-01" });

    const response = await agent.delete(`/api/insurance/members/${member.id}`);
    expect(response.status).toBe(200);

    expect(await memberRow(member.id)).toBeNull();
    // The account is soft-deleted rather than dropped, because past journals
    // still have entries pointing at it.
    const account = await pool.query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM ledger_accounts WHERE id = $1`,
      [member.ledger_account_id]
    );
    expect(account.rows[0].deleted_at).not.toBeNull();
  });
});

describe("POST /api/insurance/generate", () => {
  it("refuses a period with no eligible members rather than posting an empty voucher", async () => {
    await deactivateAllMembers();

    const response = await agent.post("/api/insurance/generate").send({ month: 6, year: 2026 });

    expect(response.status).toBe(400);
  });

  it("rejects a month or year outside the allowed range", async () => {
    expect((await agent.post("/api/insurance/generate").send({ month: 13, year: 2026 })).status).toBe(400);
    expect((await agent.post("/api/insurance/generate").send({ month: 1, year: 1999 })).status).toBe(400);
  });

  it("posts one balanced journal with a leg per member", async () => {
    await deactivateAllMembers();
    await createMember({ name: `${TEST_PREFIX} Full A`, amount: "120.00", startDate: "2025-01-01" });
    await createMember({ name: `${TEST_PREFIX} Full B`, amount: "80.00", startDate: "2025-01-01" });

    const response = await agent.post("/api/insurance/generate").send({ month: 6, year: 2026 });
    expect(response.status).toBe(200);

    const legs = await pool.query<{ debit_amount: string; credit_amount: string }>(
      `SELECT debit_amount, credit_amount FROM voucher_entries WHERE voucher_id = $1`,
      [response.body.voucherId]
    );
    // One expense leg plus one per member.
    expect(legs.rowCount).toBe(3);

    const debits = legs.rows.reduce((sum, leg) => sum + Number(leg.debit_amount), 0);
    const credits = legs.rows.reduce((sum, leg) => sum + Number(leg.credit_amount), 0);
    expect(debits).toBeCloseTo(200, 2);
    expect(credits).toBeCloseTo(200, 2);

    const voucher = await pool.query<{ total_amount: string }>(`SELECT total_amount FROM vouchers WHERE id = $1`, [
      response.body.voucherId,
    ]);
    expect(Number(voucher.rows[0].total_amount)).toBeCloseTo(200, 2);
  });

  it("prorates a member who starts inside the period", async () => {
    await deactivateAllMembers();
    // June has 30 days; starting on the 16th leaves 15 days, so half of 300.
    await createMember({ name: `${TEST_PREFIX} Prorated`, amount: "300.00", startDate: "2026-06-16" });

    const response = await agent.post("/api/insurance/generate").send({ month: 6, year: 2026 });
    expect(response.status).toBe(200);

    const legs = await pool.query<{ debit_amount: string; credit_amount: string }>(
      `SELECT debit_amount, credit_amount FROM voucher_entries WHERE voucher_id = $1`,
      [response.body.voucherId]
    );
    const debits = legs.rows.reduce((sum, leg) => sum + Number(leg.debit_amount), 0);
    const credits = legs.rows.reduce((sum, leg) => sum + Number(leg.credit_amount), 0);

    // 300 / 30 * (30 - 16 + 1) = 150. A whole-month charge would post 300 and
    // still balance, which is exactly why this needs asserting on the amount.
    expect(debits).toBeCloseTo(150, 2);
    expect(credits).toBeCloseTo(150, 2);
  });

  it("excludes a member whose start date is after the period ends", async () => {
    await deactivateAllMembers();
    await createMember({ name: `${TEST_PREFIX} Present`, amount: "60.00", startDate: "2025-01-01" });
    await createMember({ name: `${TEST_PREFIX} Future`, amount: "999.00", startDate: "2027-01-01" });

    const response = await agent.post("/api/insurance/generate").send({ month: 6, year: 2026 });
    expect(response.status).toBe(200);

    const legs = await pool.query<{ debit_amount: string }>(
      `SELECT debit_amount FROM voucher_entries WHERE voucher_id = $1`,
      [response.body.voucherId]
    );
    // Expense leg plus the one eligible member — the future starter is absent.
    expect(legs.rowCount).toBe(2);
    const debits = legs.rows.reduce((sum, leg) => sum + Number(leg.debit_amount), 0);
    expect(debits).toBeCloseTo(60, 2);
  });

  it("debits the expense account and credits the member's liability", async () => {
    await deactivateAllMembers();
    const member = await createMember({
      name: `${TEST_PREFIX} Sides`,
      amount: "45.00",
      startDate: "2025-01-01",
    });

    const response = await agent.post("/api/insurance/generate").send({ month: 6, year: 2026 });
    expect(response.status).toBe(200);

    const legs = await pool.query<{ ledger_account_id: number; debit_amount: string; credit_amount: string }>(
      `SELECT ledger_account_id, debit_amount, credit_amount FROM voucher_entries WHERE voucher_id = $1`,
      [response.body.voucherId]
    );
    const memberLeg = legs.rows.find((leg) => leg.ledger_account_id === member.ledger_account_id);
    const expenseLeg = legs.rows.find((leg) => leg.ledger_account_id !== member.ledger_account_id);

    // Incurring the month's insurance is an expense, and what the company now
    // owes the member is a liability. Run the other way — as this did until the
    // direction was corrected — it reduces recorded expense and makes the
    // member's account read as an asset.
    expect(Number(expenseLeg?.debit_amount)).toBeCloseTo(45, 2);
    expect(Number(expenseLeg?.credit_amount)).toBeCloseTo(0, 2);
    expect(Number(memberLeg?.credit_amount)).toBeCloseTo(45, 2);
    expect(Number(memberLeg?.debit_amount)).toBeCloseTo(0, 2);
  });
});

describe("POST /api/insurance/admin/repair-reversed-journals", () => {
  it("defaults to a dry run", async () => {
    const response = await agent.post("/api/insurance/admin/repair-reversed-journals").send({});
    expect(response.status).toBe(200);
    expect(response.body.dryRun).toBe(true);
    expect(response.body.confirmationRequired).toBe("REPAIR_REVERSED_INSURANCE_JOURNALS");
  });
});
