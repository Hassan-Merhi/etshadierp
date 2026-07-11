/**
 * Shared payroll accounting helpers.
 * Used by factoryPayrollRoutes (delete/undo) and workerStatementRoutes (repair utility)
 * to keep PAYROLL-GEN-* vouchers in sync when payroll records are removed.
 */

import { db as globalDb } from "../../db";
import { eq, and, sql, inArray, ne } from "drizzle-orm";
import { ledgerAccounts, vouchers, voucherEntries, factoryPayrolls, factoryWorkers } from "@shared/schema";

/**
 * Find or create a ledger account by name for a company.
 * Uses the global db (not a transaction) to avoid race-condition issues with unique constraints.
 */
export async function findOrCreateLedger(
  companyId: number,
  name: string,
  accountType: string
): Promise<{ id: number }> {
  const [existing] = await globalDb
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.companyId, companyId),
        eq(ledgerAccounts.name, name),
        eq(ledgerAccounts.isDeleted, false)
      )
    );
  if (existing) return existing;

  // Compute next account code
  const [maxRow] = await globalDb.execute(sql`
    SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(code, '[^0-9]', '', 'g') AS INTEGER)), 999) AS max_code
    FROM ledger_accounts
    WHERE company_id = ${companyId}
  `);
  const nextCode = ((maxRow as any).max_code ?? 999) + 1;

  try {
    const [created] = await globalDb
      .insert(ledgerAccounts)
      .values({
        companyId,
        name,
        accountType,
        code: String(nextCode),
        isDeleted: false,
      } as any)
      .returning({ id: ledgerAccounts.id });
    return created;
  } catch {
    // Unique constraint race — retry read
    const [retry] = await globalDb
      .select({ id: ledgerAccounts.id })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.companyId, companyId),
          eq(ledgerAccounts.name, name),
          eq(ledgerAccounts.isDeleted, false)
        )
      );
    return retry;
  }
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
  const remainingQuery = tx
    .select({
      baseSalary: factoryPayrolls.baseSalary,
      transport: factoryPayrolls.transport,
      bonuses: factoryPayrolls.bonuses,
      deductions: factoryPayrolls.deductions,
      advances: factoryPayrolls.advances,
      netSalary: factoryPayrolls.netSalary,
      city: factoryWorkers.city,
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

  const remaining: any[] = await remainingQuery;

  if (remaining.length === 0) return; // nothing left → no voucher needed

  // ── Step 3: aggregate amounts by city ────────────────────────────────────
  const salaryByCity = new Map<string, number>();
  const bonusByCity = new Map<string, number>();
  let totalNet = 0;
  let totalAdvances = 0;

  for (const p of remaining) {
    const ck = (p.city as string | null)?.trim() || "";
    const sal =
      parseFloat(p.baseSalary || "0") +
      parseFloat(p.transport || "0") -
      parseFloat(p.deductions || "0");
    const bon = parseFloat(p.bonuses || "0");
    salaryByCity.set(ck, (salaryByCity.get(ck) || 0) + sal);
    bonusByCity.set(ck, (bonusByCity.get(ck) || 0) + bon);
    totalNet += parseFloat(p.netSalary || "0");
    totalAdvances += parseFloat(p.advances || "0");
  }

  const totalGross = totalNet + totalAdvances;
  if (totalGross <= 0) return;

  // ── Step 4: resolve ledger accounts (outside tx to avoid constraint races) ──
  const payableAcc = await findOrCreateLedger(companyId, "Payroll Payable", "Liability");
  const advancesAcc = await findOrCreateLedger(companyId, "Factory Worker Advances", "Asset");

  const uniqueCities = new Set([...salaryByCity.keys(), ...bonusByCity.keys()]);
  const cityAccCache = new Map<string, { salaryId: number; bonusId: number }>();
  for (const ck of uniqueCities) {
    if (ck) {
      const capCity = ck.charAt(0).toUpperCase() + ck.slice(1).toLowerCase();
      const sa = await findOrCreateLedger(companyId, `Salary Expense - ${capCity}`, "Expense");
      const ba = await findOrCreateLedger(companyId, `Bonus Expense - ${capCity}`, "Expense");
      cityAccCache.set(ck, { salaryId: sa.id, bonusId: ba.id });
    } else {
      const fa = await findOrCreateLedger(companyId, "Factory Worker Payroll", "Expense");
      cityAccCache.set("", { salaryId: fa.id, bonusId: fa.id });
    }
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

  for (const [ck, salAmt] of salaryByCity) {
    const bonAmt = bonusByCity.get(ck) || 0;
    const accs = cityAccCache.get(ck) ?? cityAccCache.get("")!;
    if (ck) {
      const capCity = ck.charAt(0).toUpperCase() + ck.slice(1).toLowerCase();
      if (salAmt > 0) {
        journalEntries.push({
          voucherId: genVoucher.id,
          ledgerAccountId: accs.salaryId,
          debitAmount: salAmt.toFixed(2),
          creditAmount: "0",
          narration: `Salary expense - ${capCity} (${periodStart} – ${periodEnd})`,
        });
      }
      if (bonAmt > 0) {
        journalEntries.push({
          voucherId: genVoucher.id,
          ledgerAccountId: accs.bonusId,
          debitAmount: bonAmt.toFixed(2),
          creditAmount: "0",
          narration: `Bonus expense - ${capCity} (${periodStart} – ${periodEnd})`,
        });
      }
    } else {
      const totalForCity = salAmt + bonAmt;
      if (totalForCity > 0) {
        journalEntries.push({
          voucherId: genVoucher.id,
          ledgerAccountId: accs.salaryId,
          debitAmount: totalForCity.toFixed(2),
          creditAmount: "0",
          narration: desc,
        });
      }
    }
  }

  // Edge case: bonus-only cities not in salaryByCity
  for (const [ck, bonAmt] of bonusByCity) {
    if (!salaryByCity.has(ck) && bonAmt > 0) {
      const accs = cityAccCache.get(ck) ?? cityAccCache.get("")!;
      const capCity = ck ? ck.charAt(0).toUpperCase() + ck.slice(1).toLowerCase() : "";
      journalEntries.push({
        voucherId: genVoucher.id,
        ledgerAccountId: ck ? accs.bonusId : accs.salaryId,
        debitAmount: bonAmt.toFixed(2),
        creditAmount: "0",
        narration: ck ? `Bonus expense - ${capCity} (${periodStart} – ${periodEnd})` : desc,
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
