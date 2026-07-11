/**
 * Shared payroll accounting helpers.
 * Used by factoryPayrollRoutes (delete/undo) and workerStatementRoutes (repair utility)
 * to keep PAYROLL-GEN-* vouchers in sync when payroll records are removed.
 */

import { db as globalDb } from "../../db";
import { eq, and, sql, inArray, ne, isNull } from "drizzle-orm";
import { ledgerAccounts, vouchers, voucherEntries, factoryPayrolls, factoryWorkers } from "@shared/schema";

/**
 * Find or create a ledger account by name for a company.
 * Uses the global db (not a transaction) to avoid race-condition issues with unique constraints.
 * Pass opts.parentId to set the parent group account id on creation.
 * Pass opts.subType (e.g. "Group") to mark the account as a group header.
 */
export async function findOrCreateLedger(
  companyId: number,
  name: string,
  accountType: string,
  opts?: { parentId?: number; subType?: string }
): Promise<{ id: number }> {
  const [existing] = await globalDb
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.companyId, companyId),
        eq(ledgerAccounts.name, name),
        isNull(ledgerAccounts.deletedAt)
      )
    );
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt++) {
    const [maxCodeRow] = await globalDb
      .select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\\d+$'`));
    const nextCode = String((parseInt((maxCodeRow as any)?.maxCode || "0") || 0) + 1 + attempt);
    try {
      const insertVals: any = {
        companyId,
        code: nextCode,
        name,
        accountType,
        active: true,
        isHidden: false,
      };
      if (opts?.parentId) insertVals.parentId = opts.parentId;
      if (opts?.subType) insertVals.subType = opts.subType;

      const [created] = await globalDb
        .insert(ledgerAccounts)
        .values(insertVals)
        .returning({ id: ledgerAccounts.id });
      return created;
    } catch (err: any) {
      if (err?.code === "23505" || err?.message?.includes("unique")) {
        const [nowFound] = await globalDb
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, companyId),
              eq(ledgerAccounts.name, name),
              isNull(ledgerAccounts.deletedAt)
            )
          );
        if (nowFound) return nowFound;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Unable to create ledger account "${name}" after multiple attempts`);
}

/**
 * Rebuilds the PAYROLL-GEN-* expense voucher for a payroll period after one or more
 * payroll records have been removed.
 *
 * Steps:
 *  1. Delete all existing PAYROLL-GEN vouchers for company + period (inside tx).
 *  2. Query remaining payrolls for that period (excluding `excludePayrollId`).
 *  3. If any remain → recreate a correctly-sized expense voucher from stored amounts.
 *
 * Must be called BEFORE the payroll row being deleted is actually removed from the DB
 * (pass its id as `excludePayrollId`) so the remaining-payroll query excludes it.
 *
 * @param tx             Drizzle transaction handle
 * @param companyId      Company scope
 * @param periodStart    Period start date string (YYYY-MM-DD)
 * @param periodEnd      Period end date string (YYYY-MM-DD)
 * @param excludePayrollId  The payroll id being deleted (excluded from "remaining" query)
 */
export async function rebuildPayrollGenVoucher(
  tx: any,
  companyId: number,
  periodStart: string,
  periodEnd: string,
  excludePayrollId?: number
): Promise<void> {
  // ── Step 1: delete existing PAYROLL-GEN vouchers for this period ──────────
  const existingGenVouchers = await tx
    .select({ id: vouchers.id })
    .from(vouchers)
    .where(
      and(
        eq(vouchers.companyId, companyId),
        sql`${vouchers.voucherNumber} LIKE 'PAYROLL-GEN-%'`,
        eq(vouchers.voucherDate, periodStart),
        sql`${vouchers.description} LIKE ${"%" + periodEnd + "%"}`
      )
    );

  if (existingGenVouchers.length > 0) {
    const vIds = existingGenVouchers.map((v: any) => v.id);
    await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
    await tx.delete(vouchers).where(inArray(vouchers.id, vIds));
  }

  // ── Step 2: remaining payrolls for this period ────────────────────────────
  const remaining: any[] = await tx
    .select({
      workerId: factoryPayrolls.workerId,
      baseSalary: factoryPayrolls.baseSalary,
      transport: factoryPayrolls.transport,
      bonuses: factoryPayrolls.bonuses,
      deductions: factoryPayrolls.deductions,
      advances: factoryPayrolls.advances,
      netSalary: factoryPayrolls.netSalary,
      fullName: factoryWorkers.fullName,
    })
    .from(factoryPayrolls)
    .leftJoin(factoryWorkers, eq(factoryWorkers.id, factoryPayrolls.workerId))
    .where(
      and(
        eq(factoryPayrolls.companyId, companyId),
        eq(factoryPayrolls.periodStart, periodStart),
        eq(factoryPayrolls.periodEnd, periodEnd),
        ...(excludePayrollId !== undefined ? [ne(factoryPayrolls.id, excludePayrollId)] : [])
      )
    );

  if (remaining.length === 0) return; // nothing left → no voucher needed

  // ── Step 3: aggregate totals and per-worker expense amounts ──────────────
  let totalNet = 0;
  let totalAdvances = 0;
  const workerRows: { workerId: number; workerName: string; salAmt: number; bonAmt: number }[] = [];

  for (const p of remaining) {
    const workerName = (p.fullName as string | null) || `Worker #${p.workerId}`;
    const salAmt =
      parseFloat(p.baseSalary || "0") +
      parseFloat(p.transport || "0") -
      parseFloat(p.deductions || "0");
    const bonAmt = parseFloat(p.bonuses || "0");
    workerRows.push({ workerId: p.workerId, workerName, salAmt, bonAmt });
    totalNet += parseFloat(p.netSalary || "0");
    totalAdvances += parseFloat(p.advances || "0");
  }

  const totalGross = totalNet + totalAdvances;
  if (totalGross <= 0) return;

  // ── Step 4: resolve per-worker ledger accounts (outside tx) ──────────────
  const payableAcc = await findOrCreateLedger(companyId, "Payroll Payable", "Liability");
  const advancesAcc = await findOrCreateLedger(companyId, "Factory Worker Advances", "Asset");

  // Ensure salary/bonus group parents exist
  const salaryGroup = await findOrCreateLedger(companyId, "Salary Expense - Workers", "Expense", { subType: "Group" });
  const bonusGroup  = await findOrCreateLedger(companyId, "Bonus Expense - Workers",  "Expense", { subType: "Group" });

  // Ensure both headers carry subType="Group" even if they existed without it
  await globalDb.execute(
    sql`UPDATE ledger_accounts SET sub_type='Group' WHERE id IN (${salaryGroup.id}, ${bonusGroup.id}) AND (sub_type IS NULL OR sub_type <> 'Group')`
  );

  const workerAccCache = new Map<number, { salaryId: number; bonusId: number }>();
  for (const { workerId, workerName } of workerRows) {
    if (workerAccCache.has(workerId)) continue;
    const sa = await findOrCreateLedger(companyId, `Salary Expense - ${workerName}`, "Expense", { parentId: salaryGroup.id });
    const ba = await findOrCreateLedger(companyId, `Bonus Expense - ${workerName}`,  "Expense", { parentId: bonusGroup.id });
    // Ensure parentId is set even for pre-existing accounts that were created without it
    await globalDb.execute(
      sql`UPDATE ledger_accounts SET parent_id = ${salaryGroup.id} WHERE id = ${sa.id} AND (parent_id IS NULL OR parent_id <> ${salaryGroup.id})`
    );
    await globalDb.execute(
      sql`UPDATE ledger_accounts SET parent_id = ${bonusGroup.id} WHERE id = ${ba.id} AND (parent_id IS NULL OR parent_id <> ${bonusGroup.id})`
    );
    workerAccCache.set(workerId, { salaryId: sa.id, bonusId: ba.id });
  }

  // ── Step 5: create replacement voucher ───────────────────────────────────
  const count = remaining.length;
  const desc = `Payroll expense: ${count} worker${count !== 1 ? "s" : ""} (${periodStart} – ${periodEnd})`;

  const [genVoucher] = await tx
    .insert(vouchers)
    .values({
      companyId,
      voucherNumber: `PAYROLL-GEN-${Date.now()}`,
      voucherType: "Journal",
      voucherDate: periodStart,
      description: desc,
      totalAmount: totalGross.toFixed(2),
      currency: "USD",
      sourceModule: "FACTORY",
    })
    .returning();

  const journalEntries: any[] = [];

  for (const { workerId, workerName, salAmt, bonAmt } of workerRows) {
    const accs = workerAccCache.get(workerId)!;
    if (salAmt > 0) {
      journalEntries.push({
        voucherId: genVoucher.id,
        ledgerAccountId: accs.salaryId,
        debitAmount: salAmt.toFixed(2),
        creditAmount: "0",
        narration: `Salary - ${workerName} (${periodStart} – ${periodEnd})`,
      });
    }
    if (bonAmt > 0) {
      journalEntries.push({
        voucherId: genVoucher.id,
        ledgerAccountId: accs.bonusId,
        debitAmount: bonAmt.toFixed(2),
        creditAmount: "0",
        narration: `Bonus - ${workerName} (${periodStart} – ${periodEnd})`,
      });
    }
  }

  if (totalNet > 0) {
    journalEntries.push({
      voucherId: genVoucher.id,
      ledgerAccountId: payableAcc.id,
      debitAmount: "0",
      creditAmount: totalNet.toFixed(2),
      narration: desc,
    });
  }

  if (totalAdvances > 0) {
    journalEntries.push({
      voucherId: genVoucher.id,
      ledgerAccountId: advancesAcc.id,
      debitAmount: "0",
      creditAmount: totalAdvances.toFixed(2),
      narration: `Advance deductions settled - ${count} worker${count !== 1 ? "s" : ""} (${periodStart} – ${periodEnd})`,
    });
  }

  if (journalEntries.length > 0) {
    await tx.insert(voucherEntries).values(journalEntries);
  }
}
