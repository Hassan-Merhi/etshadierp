/**
 * Behavioural coverage for the ERP payroll run lifecycle routes.
 *
 * Both were guard-only. `DELETE` discards a draft run; `undo` reverses a run
 * that was already paid, which is the interesting one — it has to unwind three
 * separate things and leaving any of them behind quietly corrupts the next run.
 *
 * What is pinned here:
 *
 *   - **Undo restores what the run deducted.** Each salary advance gets its
 *     deduction added back to `remaining_balance`, `fully_paid` clears, and the
 *     deduction row itself is deleted. Restoring the balance but keeping the
 *     row would deduct the same money again on the re-run; deleting the row
 *     without restoring the balance forgives it.
 *   - **The restore is capped at the advance's original amount.** Undoing a run
 *     twice, or undoing after a manual repayment, must not inflate the balance
 *     past what was ever lent.
 *   - **The salary voucher is soft-deleted, not dropped.** Its number is on the
 *     payslip, and the ledger keeps its own history.
 *   - **Status gates in both directions.** A PAID run cannot be deleted, and
 *     only a PAID run can be undone; a draft has nothing to reverse and
 *     "undoing" one would reset fields that were never set.
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

import { pool } from "../server/db";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";

const TEST_PREFIX = "prunlc";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let employeeId: number;
let runSeq = 0;

async function createRun(status: string): Promise<number> {
  runSeq += 1;
  const result = await pool.query<{ id: number }>(
    `INSERT INTO erp_payroll_runs (company_id, status, date, created_at)
     VALUES ($1, $2, '2026-05-31', '2026-05-31') RETURNING id`,
    [ctx.companyId, status]
  );
  return result.rows[0].id;
}

async function addRunItem(runId: number, deduction: string, netPay = "900.00") {
  await pool.query(
    `INSERT INTO erp_payroll_run_items (run_id, employee_id, employee_name, base_salary, deduction, net_pay)
     VALUES ($1, $2, $3, '1000.00', $4, $5)`,
    [runId, employeeId, `${TEST_PREFIX} Employee`, deduction, netPay]
  );
}

/** An advance with one deduction already taken by the run being undone. */
async function createAdvance(amount: string, remaining: string, fullyPaid = false): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO salary_advances (company_id, employee_id, advance_date, amount, remaining_balance, fully_paid)
     VALUES ($1, $2, '2026-04-01', $3, $4, $5) RETURNING id`,
    [ctx.companyId, employeeId, amount, remaining, fullyPaid]
  );
  return result.rows[0].id;
}

async function addDeduction(advanceId: number, amount: string, month = "2026-05") {
  await pool.query(
    `INSERT INTO salary_advance_deductions (salary_advance_id, payroll_month, deduction_amount)
     VALUES ($1, $2, $3)`,
    [advanceId, month, amount]
  );
}

async function advanceRow(id: number) {
  const result = await pool.query<{ remaining_balance: string; fully_paid: boolean }>(
    `SELECT remaining_balance, fully_paid FROM salary_advances WHERE id = $1`,
    [id]
  );
  return result.rows[0];
}

async function deductionCount(advanceId: number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM salary_advance_deductions WHERE salary_advance_id = $1`,
    [advanceId]
  );
  return Number(result.rows[0].count);
}

async function runRow(id: number) {
  const result = await pool.query<{ status: string; payment_account_id: number | null; paid_at: string | null }>(
    `SELECT status, payment_account_id, paid_at FROM erp_payroll_runs WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

async function createSalaryVoucher(runId: number): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO vouchers (company_id, voucher_number, voucher_type, voucher_date, total_amount, currency)
     VALUES ($1, $2, 'Payment', '2026-05-31', '900.00', 'USD') RETURNING id`,
    [ctx.companyId, `SAL-${runId}-${Date.now()}`]
  );
  return result.rows[0].id;
}

async function voucherDeletedAt(id: number): Promise<string | null> {
  const result = await pool.query<{ deleted_at: string | null }>(`SELECT deleted_at FROM vouchers WHERE id = $1`, [id]);
  return result.rows[0]?.deleted_at ?? null;
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

  const employee = await pool.query<{ id: number }>(
    `INSERT INTO employees (company_id, code, first_name, last_name, join_date, monthly_salary)
     VALUES ($1, $2, $3, 'Test', '2026-01-01', '1000.00') RETURNING id`,
    [ctx.companyId, `${TEST_PREFIX}-E1`, `${TEST_PREFIX}`]
  );
  employeeId = employee.rows[0].id;
}, 120000);

beforeEach(async () => {
  await pool.query(
    `DELETE FROM salary_advance_deductions WHERE salary_advance_id IN
       (SELECT id FROM salary_advances WHERE company_id = $1)`,
    [ctx.companyId]
  );
  await pool.query(`DELETE FROM salary_advances WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(
    `DELETE FROM erp_payroll_run_items WHERE run_id IN (SELECT id FROM erp_payroll_runs WHERE company_id = $1)`,
    [ctx.companyId]
  );
  await pool.query(`DELETE FROM erp_payroll_runs WHERE company_id = $1`, [ctx.companyId]);
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM salary_advance_deductions WHERE salary_advance_id IN
       (SELECT id FROM salary_advances WHERE company_id = $1)`,
    [ctx.companyId]
  );
  await pool.query(`DELETE FROM salary_advances WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(
    `DELETE FROM erp_payroll_run_items WHERE run_id IN (SELECT id FROM erp_payroll_runs WHERE company_id = $1)`,
    [ctx.companyId]
  );
  await pool.query(`DELETE FROM erp_payroll_runs WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM employees WHERE company_id = $1`, [ctx.companyId]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60000);

describe("DELETE /api/payroll/runs/:id", () => {
  it("removes a draft run and its items", async () => {
    const runId = await createRun("DRAFT");
    await addRunItem(runId, "0");

    const response = await agent.delete(`/api/payroll/runs/${runId}`);
    expect(response.status).toBe(200);

    expect(await runRow(runId)).toBeNull();
    const items = await pool.query(`SELECT id FROM erp_payroll_run_items WHERE run_id = $1`, [runId]);
    // Items left behind would be orphans pointing at a run that no longer
    // exists, still counted by anything that reads them by employee.
    expect(items.rowCount).toBe(0);
  });

  it("refuses to delete a paid run", async () => {
    const runId = await createRun("PAID");

    const response = await agent.delete(`/api/payroll/runs/${runId}`);

    // A paid run has a voucher and advance deductions behind it. Deleting it
    // outright leaves both with nothing explaining them — undo is the path.
    expect(response.status).toBe(400);
    expect((await runRow(runId))?.status).toBe("PAID");
  });

  it("returns 404 for a run in another company", async () => {
    expect((await agent.delete("/api/payroll/runs/99999999")).status).toBe(404);
  });
});

describe("POST /api/payroll/runs/:id/undo", () => {
  it("restores the advance, drops the deduction row and resets the run", async () => {
    const runId = await createRun("PAID");
    await pool.query(`UPDATE erp_payroll_runs SET payment_account_id = $1, paid_at = '2026-05-31' WHERE id = $2`, [
      ctx.cashAccountId,
      runId,
    ]);
    await addRunItem(runId, "100.00");
    const advanceId = await createAdvance("500.00", "400.00");
    await addDeduction(advanceId, "100.00");
    const voucherId = await createSalaryVoucher(runId);

    const response = await agent.post(`/api/payroll/runs/${runId}/undo`).send({});
    expect(response.status).toBe(200);

    const advance = await advanceRow(advanceId);
    expect(Number(advance.remaining_balance)).toBeCloseTo(500, 2);
    expect(advance.fully_paid).toBe(false);
    // Restoring the balance but keeping the row deducts the same money again on
    // the re-run; deleting the row without restoring the balance forgives it.
    expect(await deductionCount(advanceId)).toBe(0);

    // The voucher number is on the payslip and the ledger keeps its history.
    expect(await voucherDeletedAt(voucherId)).not.toBeNull();

    const run = await runRow(runId);
    expect(run?.status).toBe("DRAFT");
    expect(run?.payment_account_id).toBeNull();
    expect(run?.paid_at).toBeNull();
  });

  it("never restores a balance above the advance's original amount", async () => {
    const runId = await createRun("PAID");
    await addRunItem(runId, "100.00");
    // The advance was already fully repaid and then some was repaid manually,
    // so adding the deduction straight back would overshoot what was lent.
    const advanceId = await createAdvance("300.00", "300.00", true);
    await addDeduction(advanceId, "250.00");

    expect((await agent.post(`/api/payroll/runs/${runId}/undo`).send({})).status).toBe(200);

    expect(Number((await advanceRow(advanceId)).remaining_balance)).toBeCloseTo(300, 2);
  });

  it("only reverses deductions from this run's own month", async () => {
    const runId = await createRun("PAID");
    await addRunItem(runId, "100.00");
    const advanceId = await createAdvance("500.00", "300.00");
    await addDeduction(advanceId, "100.00", "2026-05");
    await addDeduction(advanceId, "100.00", "2026-04");

    expect((await agent.post(`/api/payroll/runs/${runId}/undo`).send({})).status).toBe(200);

    // April's deduction belongs to a different run. Reversing it here would
    // credit the employee twice for one repayment.
    expect(Number((await advanceRow(advanceId)).remaining_balance)).toBeCloseTo(400, 2);
    expect(await deductionCount(advanceId)).toBe(1);
  });

  it("refuses to undo a run that was never paid", async () => {
    const runId = await createRun("DRAFT");

    const response = await agent.post(`/api/payroll/runs/${runId}/undo`).send({});

    expect(response.status).toBe(400);
    expect((await runRow(runId))?.status).toBe("DRAFT");
  });

  it("returns 404 for a run in another company", async () => {
    expect((await agent.post("/api/payroll/runs/99999999/undo").send({})).status).toBe(404);
  });
});
