/**
 * The Factory Daybook mirror is written exactly once per centrally posted
 * Payment or Receipt.
 *
 * The mirror is written inside the voucher's own transaction, so the ways it
 * can go wrong are the ways a transaction can be repeated or undone: a client
 * retry with the same request id, two submissions racing, a reversal that
 * should not mirror again, and a soft-deleted voucher whose mirror must not
 * outlive it as a second unexplained row.
 *
 * Every case here is asserted by counting the mirrors in the database, not by
 * trusting the response.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db, pool } from "../server/db";
import * as schema from "../shared/schema";

const TEST_PREFIX = "dbkonce";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let factorySettingsCreated = false;
let secondCompanyId: number;

function paymentReceiptBody(voucherType: "Payment" | "Receipt", amount: number, clientRequestId: string) {
  return {
    voucherType,
    voucherDate: new Date().toISOString().split("T")[0],
    paymentAccountType: "ledger",
    paymentAccountId: ctx.cashAccountId,
    paymentAccountName: "Cash",
    clientRequestId,
    entries: [
      {
        accountType: "ledger",
        accountId: ctx.salesAccountId,
        accountName: "Sales",
        amount: String(amount),
      },
    ],
  };
}

function voucherIdFrom(body: Record<string, unknown>): number {
  const candidate =
    (body?.voucher as { id?: unknown })?.id ?? body?.voucherId ?? (body?.posted as { id?: unknown })?.id ?? body?.id;
  return Number(candidate);
}

async function mirrorCount(voucherId: number, companyId?: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM factory_daybook_entries
      WHERE company_id = $1 AND reference_table = 'vouchers' AND reference_id = $2`,
    [companyId ?? ctx.companyId, voucherId]
  );
  return rows[0].count;
}

/** The mirror count regardless of which company owns the row. */
async function mirrorCountAnyCompany(voucherId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM factory_daybook_entries
      WHERE reference_table = 'vouchers' AND reference_id = $1`,
    [voucherId]
  );
  return rows[0].count;
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);
  await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });

  // The mirror is only written for companies that run the Factory Daybook.
  const { rowCount } = await pool.query(
    `INSERT INTO factory_settings (company_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`,
    [ctx.companyId]
  );
  factorySettingsCreated = (rowCount ?? 0) > 0;

  // A second company the same user may switch into, for the cases that ask what
  // a session standing somewhere else can see and do.
  const [secondCompany] = await db
    .insert(schema.companies)
    .values({
      code: "DBKONCE2",
      name: `${TEST_PREFIX}_SecondCompany`,
      baseCurrency: "USD",
    })
    .returning();
  secondCompanyId = secondCompany.id;
  await db.insert(schema.userCompanyRoles).values({
    userId: ctx.userId,
    companyId: secondCompanyId,
    role: "Admin",
  });
}, 60000);

afterAll(async () => {
  await pool.query(
    `DELETE FROM factory_daybook_entries WHERE company_id = $1 AND reference_table = 'vouchers'`,
    [ctx.companyId]
  );
  if (factorySettingsCreated) {
    await pool.query(`DELETE FROM factory_settings WHERE company_id = $1`, [ctx.companyId]);
  }
  if (secondCompanyId) {
    await pool.query(`DELETE FROM login_history WHERE company_id = $1`, [secondCompanyId]);
    await pool.query(`DELETE FROM user_company_roles WHERE company_id = $1`, [secondCompanyId]);
    await pool.query(`DELETE FROM companies WHERE id = $1`, [secondCompanyId]);
  }
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

describe("Daybook mirror is written exactly once", () => {
  it("writes one mirror for a posted Payment", async () => {
    const res = await agent
      .post("/api/vouchers/payment-receipt")
      .send(paymentReceiptBody("Payment", 120, `dbk-once-${Date.now()}`));
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    const voucherId = voucherIdFrom(res.body);
    expect(Number.isInteger(voucherId)).toBe(true);
    expect(await mirrorCount(voucherId)).toBe(1);
  }, 60000);

  it("writes no second mirror when the client retries the same request id", async () => {
    const clientRequestId = `dbk-retry-${Date.now()}`;
    const body = paymentReceiptBody("Receipt", 80, clientRequestId);

    const first = await agent.post("/api/vouchers/payment-receipt").send(body);
    expect(first.status).toBeLessThan(300);
    const voucherId = voucherIdFrom(first.body);
    expect(await mirrorCount(voucherId)).toBe(1);

    // A browser retry, an aborted connection, a double click: the replay must
    // return the original posting and leave the Daybook alone.
    const replay = await agent.post("/api/vouchers/payment-receipt").send(body);
    expect(replay.status).toBeLessThan(300);
    expect(voucherIdFrom(replay.body)).toBe(voucherId);
    expect(await mirrorCount(voucherId)).toBe(1);
  }, 60000);

  it("writes one mirror when two identical submissions race", async () => {
    const clientRequestId = `dbk-race-${Date.now()}`;
    const body = paymentReceiptBody("Payment", 65, clientRequestId);

    const [first, second] = await Promise.allSettled([
      agent.post("/api/vouchers/payment-receipt").send(body),
      agent.post("/api/vouchers/payment-receipt").send(body),
    ]);

    const succeeded = [first, second].filter(
      (outcome) => outcome.status === "fulfilled" && outcome.value.status < 300
    );
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    const voucherId = voucherIdFrom(
      (succeeded[0] as PromiseFulfilledResult<{ body: Record<string, unknown> }>).value.body
    );
    // Whichever attempt lost the race, the posting is mirrored once.
    expect(await mirrorCount(voucherId)).toBe(1);
  }, 60000);

  it("does not add a mirror for the reversal of a mirrored voucher", async () => {
    const posted = await agent
      .post("/api/vouchers/payment-receipt")
      .send(paymentReceiptBody("Payment", 45, `dbk-rev-${Date.now()}`));
    expect(posted.status).toBeLessThan(300);
    const originalId = voucherIdFrom(posted.body);
    expect(await mirrorCount(originalId)).toBe(1);

    const reversal = await agent.post(`/api/vouchers/${originalId}/exact-reversal`).send({});
    expect([200, 201]).toContain(reversal.status);

    // The original keeps its single mirror, and the reversal — which is not a
    // centrally posted Payment/Receipt request — adds none of its own.
    expect(await mirrorCount(originalId)).toBe(1);
    const reversalId = Number(reversal.body.voucher?.id ?? reversal.body.voucherId);
    if (Number.isInteger(reversalId)) {
      expect(await mirrorCount(reversalId)).toBe(0);
    }
  }, 60000);

  it("withdraws the mirror when the voucher is cancelled", async () => {
    const posted = await agent
      .post("/api/vouchers/payment-receipt")
      .send(paymentReceiptBody("Payment", 33, `dbk-cancel-${Date.now()}`));
    expect(posted.status).toBeLessThan(300);
    const voucherId = voucherIdFrom(posted.body);
    expect(await mirrorCount(voucherId)).toBe(1);

    const deleted = await agent.delete(`/api/vouchers/${voucherId}`);
    expect(deleted.status).toBe(200);

    // The Daybook is a cash view. A cancelled Payment that kept its mirror
    // would keep reporting money moving for a voucher nobody can open, and the
    // reconciliation reads live vouchers, so nothing else would ever notice.
    expect(await mirrorCountAnyCompany(voucherId)).toBe(0);

    const { rows } = await pool.query(`SELECT deleted_at FROM vouchers WHERE id = $1`, [voucherId]);
    expect(rows[0]?.deleted_at).not.toBeNull();
  }, 60000);

  it("keeps the mirror out of reach of a session standing in another company", async () => {
    const posted = await agent
      .post("/api/vouchers/payment-receipt")
      .send(paymentReceiptBody("Receipt", 27, `dbk-switch-${Date.now()}`));
    expect(posted.status).toBeLessThan(300);
    const voucherId = voucherIdFrom(posted.body);
    expect(await mirrorCount(voucherId)).toBe(1);

    const switched = await agent.post("/api/auth/set-company").send({ companyId: secondCompanyId });
    expect(switched.status).toBe(200);

    // The mirror belongs to the company that posted it: it is not counted in
    // the company the session moved to, and cannot be cancelled from there.
    expect(await mirrorCount(voucherId, secondCompanyId)).toBe(0);
    const crossCompanyDelete = await agent.delete(`/api/vouchers/${voucherId}`);
    // 404 rather than 403: the boundary does not confirm that the voucher
    // exists somewhere else.
    expect(crossCompanyDelete.status).toBe(404);
    expect(await mirrorCount(voucherId)).toBe(1);

    // Switching back does not duplicate it either — the mirror is a property of
    // the posting, not of the session that happens to be looking.
    const switchedBack = await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
    expect(switchedBack.status).toBe(200);
    expect(await mirrorCount(voucherId)).toBe(1);
  }, 60000);

  it("never leaves more than one mirror per voucher across the whole company", async () => {
    const { rows } = await pool.query(
      `SELECT reference_id, count(*)::int AS count
         FROM factory_daybook_entries
        WHERE company_id = $1 AND reference_table = 'vouchers'
        GROUP BY reference_id
       HAVING count(*) > 1`,
      [ctx.companyId]
    );

    // Duplicate mirrors are the failure the reconciliation fails closed on, so
    // the suite that creates them should catch it first.
    expect(rows).toEqual([]);
  }, 60000);
});
