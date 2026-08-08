/**
 * Behavioural coverage for the worker deduction write routes and the bulk
 * advance route in `workerStatsAdvancesRoutes.ts`.
 *
 * All five were guard-only. A deduction is money that comes off a worker's
 * wages; an advance is money already handed over. Both feed payroll, and both
 * were reachable with nothing asserting what they wrote.
 *
 * What is pinned here:
 *
 *   - **An applied deduction cannot be deleted.** Once `applied` is true the
 *     amount has already come off a payroll run. Deleting it then leaves the
 *     run short against a deduction that no longer exists, and the worker has
 *     no record of what was taken. This is the one rule in the cluster whose
 *     absence costs real money, so it is asserted on both the ERP and the
 *     factory route.
 *   - **The ERP and factory endpoints are the same endpoint twice.** They
 *     differ only in how the company is resolved (`/api/payroll/...` reads the
 *     session's current company, `/api/factory/...` the factory company). Every
 *     rule below is asserted against both, because a fix applied to one and not
 *     the other is exactly the failure this duplication invites.
 *   - **Deductions are created unapplied.** Payroll is what flips the flag;
 *     creating one already applied would take the money without a run behind it.
 *   - **Bulk advances post per worker, not per batch.** Each item gets its own
 *     `factory_worker_advances` row with `remaining_balance` at the full amount
 *     and, when a cash account is given, its own balanced Dr advances / Cr cash
 *     voucher. A batch that posted one voucher for the total would reconcile
 *     fine and still be wrong per worker.
 *   - **Unusable items are skipped, not fatal.** A zero amount or a worker
 *     outside the company is dropped and the rest of the batch still lands —
 *     the handler reports how many it created, and that count is the contract.
 *
 * The daybook attribution is asserted too: `created_by` used to be written
 * through `parseInt(req.session.userId)` while `users.id` is a UUID, storing a
 * truncated number that looks like a real id. The full id is pinned below.
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { pool } from "../server/db";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";

const TEST_PREFIX = "wdedwr";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let workerId: number;
let worker2Id: number;

interface DeductionRow {
  id: number;
  company_id: number;
  worker_id: number;
  amount: string;
  reason: string | null;
  applied: boolean | null;
}

async function deductionRow(id: number): Promise<DeductionRow | null> {
  const result = await pool.query<DeductionRow>(
    `SELECT id, company_id, worker_id, amount, reason, applied FROM factory_worker_deductions WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/** The two route families are the same handler twice; every case runs on both. */
const FAMILIES = [
  {
    label: "POST /api/payroll/workers/:id/deductions, DELETE /api/payroll/workers/:workerId/deductions/:id",
    create: (id: number) => `/api/payroll/workers/${id}/deductions`,
    remove: (workerIdArg: number, id: number) => `/api/payroll/workers/${workerIdArg}/deductions/${id}`,
  },
  {
    label: "POST /api/factory/workers/:id/deductions, DELETE /api/factory/workers/:workerId/deductions/:id",
    create: (id: number) => `/api/factory/workers/${id}/deductions`,
    remove: (workerIdArg: number, id: number) => `/api/factory/workers/${workerIdArg}/deductions/${id}`,
  },
];

async function createDeduction(family: (typeof FAMILIES)[number], amount: string, reason?: string) {
  const response = await agent
    .post(family.create(workerId))
    .send({ amount, reason: reason ?? `${TEST_PREFIX} reason`, deductionDate: "2026-05-04" });
  if (response.status !== 200) throw new Error(`Seed deduction failed: ${response.status} ${response.text}`);
  return response.body as { id: number };
}

async function advanceRowsFor(workerIdArg: number) {
  const result = await pool.query<{ id: number; amount: string; remaining_balance: string | null }>(
    `SELECT id, amount, remaining_balance FROM factory_worker_advances
     WHERE company_id = $1 AND worker_id = $2 ORDER BY id`,
    [ctx.companyId, workerIdArg]
  );
  return result.rows;
}

async function advanceLegs(advanceId: number) {
  const result = await pool.query<{ ledger_account_id: number; debit_amount: string; credit_amount: string }>(
    `SELECT ve.ledger_account_id, ve.debit_amount, ve.credit_amount
     FROM voucher_entries ve
     JOIN vouchers v ON v.id = ve.voucher_id
     WHERE v.company_id = $1 AND v.voucher_number LIKE $2
     ORDER BY ve.id`,
    [ctx.companyId, `PAYMENT-ADV-${advanceId}-%`]
  );
  return result.rows;
}

/** Bulk advances accumulate; each test starts from a clean slate for its worker. */
async function clearAdvances() {
  await pool.query(`DELETE FROM factory_worker_advances WHERE company_id = $1`, [ctx.companyId]);
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

  const workers = await pool.query<{ id: number }>(
    `INSERT INTO factory_workers (company_id, full_name) VALUES ($1, $2), ($1, $3) RETURNING id`,
    [ctx.companyId, `${TEST_PREFIX} Worker One`, `${TEST_PREFIX} Worker Two`]
  );
  workerId = workers.rows[0].id;
  worker2Id = workers.rows[1].id;
}, 120000);

afterAll(async () => {
  await pool.query(`DELETE FROM factory_worker_deductions WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM factory_worker_advances WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM factory_workers WHERE company_id = $1`, [ctx.companyId]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60000);

describe.each(FAMILIES)("worker deductions — $label", (family) => {
  describe("create", () => {
    it("records the deduction against the worker, unapplied", async () => {
      const created = await createDeduction(family, "75.5", `${TEST_PREFIX} tools`);

      const row = await deductionRow(created.id);
      expect(row?.company_id).toBe(ctx.companyId);
      expect(row?.worker_id).toBe(workerId);
      expect(Number(row?.amount)).toBeCloseTo(75.5, 2);
      expect(row?.reason).toBe(`${TEST_PREFIX} tools`);
      // Payroll is what applies a deduction. Created already-applied, the
      // amount would count as taken without any run having taken it.
      expect(row?.applied).toBe(false);
    });

    it("rejects a missing, zero, negative or non-numeric amount", async () => {
      const bodies = [
        { deductionDate: "2026-05-04" },
        { amount: "0", deductionDate: "2026-05-04" },
        { amount: "-10", deductionDate: "2026-05-04" },
        { amount: "not-a-number", deductionDate: "2026-05-04" },
      ];
      for (const body of bodies) {
        const response = await agent.post(family.create(workerId)).send(body);
        expect(response.status).toBe(400);
      }
    });

    it("requires a deduction date", async () => {
      const response = await agent.post(family.create(workerId)).send({ amount: "10" });
      expect(response.status).toBe(400);
    });

    it("rejects a non-numeric worker id", async () => {
      const response = await agent
        .post(family.create("abc" as unknown as number))
        .send({ amount: "10", deductionDate: "2026-05-04" });
      expect(response.status).toBe(400);
    });
  });

  describe("delete", () => {
    it("removes an unapplied deduction", async () => {
      const created = await createDeduction(family, "20.00");

      const response = await agent.delete(family.remove(workerId, created.id));
      expect(response.status).toBe(200);
      expect(await deductionRow(created.id)).toBeNull();
    });

    it("refuses to delete an already-applied deduction", async () => {
      const created = await createDeduction(family, "30.00");
      await pool.query(`UPDATE factory_worker_deductions SET applied = true WHERE id = $1`, [created.id]);

      const response = await agent.delete(family.remove(workerId, created.id));

      // The amount has already come off a payroll run. Removing it leaves the
      // run short against a deduction the worker can no longer see.
      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/already-applied/i);
      expect(await deductionRow(created.id)).not.toBeNull();
    });

    it("returns 404 for an unknown deduction and 400 for a bad id", async () => {
      expect((await agent.delete(family.remove(workerId, 99999999))).status).toBe(404);
      expect((await agent.delete(family.remove(workerId, 0))).status).toBe(400);
    });
  });
});

describe("POST /api/factory/advances/bulk", () => {
  it("creates one advance per item, each fully outstanding", async () => {
    await clearAdvances();

    const response = await agent.post("/api/factory/advances/bulk").send({
      advanceDate: "2026-05-04",
      items: [
        { workerId, amount: "100" },
        { workerId: worker2Id, amount: "40" },
      ],
    });
    expect(response.status).toBe(200);
    expect(response.body.created).toBe(2);

    const first = await advanceRowsFor(workerId);
    const second = await advanceRowsFor(worker2Id);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(Number(first[0].amount)).toBeCloseTo(100, 2);
    // Payroll deducts against remaining_balance. Starting it at zero forgives
    // the loan outright; starting it high over-deducts from wages.
    expect(Number(first[0].remaining_balance)).toBeCloseTo(100, 2);
    expect(Number(second[0].remaining_balance)).toBeCloseTo(40, 2);
  });

  it("posts a balanced Dr advances / Cr cash voucher per advance", async () => {
    await clearAdvances();

    const response = await agent.post("/api/factory/advances/bulk").send({
      advanceDate: "2026-05-04",
      cashAccountId: ctx.cashAccountId,
      items: [
        { workerId, amount: "120" },
        { workerId: worker2Id, amount: "80" },
      ],
    });
    expect(response.status).toBe(200);

    const [firstAdvance] = await advanceRowsFor(workerId);
    const [secondAdvance] = await advanceRowsFor(worker2Id);

    for (const [advance, amount] of [
      [firstAdvance, 120],
      [secondAdvance, 80],
    ] as const) {
      const legs = await advanceLegs(advance.id);
      // Each worker gets their own voucher. One voucher for the batch total
      // would reconcile against cash and still be untraceable per worker.
      expect(legs).toHaveLength(2);

      const cashLeg = legs.find((leg) => leg.ledger_account_id === ctx.cashAccountId);
      const advancesLeg = legs.find((leg) => leg.ledger_account_id !== ctx.cashAccountId);
      // An advance is an asset — money owed back — so cash is what leaves.
      expect(Number(advancesLeg?.debit_amount)).toBeCloseTo(amount, 2);
      expect(Number(cashLeg?.credit_amount)).toBeCloseTo(amount, 2);
      expect(Number(advancesLeg?.credit_amount)).toBeCloseTo(0, 2);
      expect(Number(cashLeg?.debit_amount)).toBeCloseTo(0, 2);
    }
  });

  it("writes no voucher at all when no cash account is given", async () => {
    await clearAdvances();

    const response = await agent
      .post("/api/factory/advances/bulk")
      .send({ advanceDate: "2026-05-04", items: [{ workerId, amount: "55" }] });
    expect(response.status).toBe(200);

    const [advance] = await advanceRowsFor(workerId);
    // Recording an advance without picking a cash account is allowed. What is
    // not allowed is a half-posted voucher — a one-sided entry in the ledger.
    expect(await advanceLegs(advance.id)).toHaveLength(0);
  });

  it("skips unusable items and still creates the rest", async () => {
    await clearAdvances();

    const response = await agent.post("/api/factory/advances/bulk").send({
      advanceDate: "2026-05-04",
      items: [
        { workerId, amount: "10" },
        { workerId, amount: "0" },
        { workerId: 99999999, amount: "500" },
        { workerId: worker2Id, amount: "25" },
      ],
    });
    expect(response.status).toBe(200);

    // The count is the contract: a worker outside the company and a zero amount
    // are dropped, and the two valid rows still land.
    expect(response.body.created).toBe(2);
    expect(await advanceRowsFor(workerId)).toHaveLength(1);
    expect(await advanceRowsFor(worker2Id)).toHaveLength(1);
  });

  it("rejects an empty or missing item list", async () => {
    expect((await agent.post("/api/factory/advances/bulk").send({ items: [] })).status).toBe(400);
    expect((await agent.post("/api/factory/advances/bulk").send({})).status).toBe(400);
  });

  it("rejects a cash account belonging to another company", async () => {
    const foreign = await pool.query<{ id: number }>(
      `SELECT id FROM ledger_accounts WHERE company_id <> $1 ORDER BY id LIMIT 1`,
      [ctx.companyId]
    );
    if (foreign.rowCount === 0) return;

    const response = await agent.post("/api/factory/advances/bulk").send({
      advanceDate: "2026-05-04",
      cashAccountId: foreign.rows[0].id,
      items: [{ workerId, amount: "10" }],
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/cash account/i);
  });

  it("attributes each daybook entry to the full session user id", async () => {
    await clearAdvances();

    const response = await agent
      .post("/api/factory/advances/bulk")
      .send({ advanceDate: "2026-05-04", items: [{ workerId, amount: "65" }] });
    expect(response.status).toBe(200);

    const [advance] = await advanceRowsFor(workerId);
    const entry = await pool.query<{ created_by: string | null }>(
      `SELECT created_by FROM factory_daybook_entries
       WHERE company_id = $1 AND reference_table = 'factory_worker_advances' AND reference_id = $2`,
      [ctx.companyId, advance.id]
    );

    expect(entry.rowCount).toBe(1);
    // users.id is a UUID. Written through parseInt this became a truncated
    // number indistinguishable by eye from a real id belonging to someone else.
    expect(entry.rows[0].created_by).toBe(ctx.userId);
  });
});
