import { storage } from "../../storage";
import { db } from "../../db";
import { employees } from "@shared/schema";
import { eq } from "drizzle-orm";

// ─── Employee balance sync ────────────────────────────────────────────────────
export async function syncEmployeeBalancesFromEntries(
  entries: Array<{
    ledgerAccountId: number | null;
    employeeId?: number | null;
    debitAmount: string | null;
    creditAmount: string | null;
  }>,
  companyId: number,
  reverse: boolean = false
): Promise<void> {
  const allAccounts = await storage.getAllLedgerAccounts(companyId);

  const employeeAccountMap = new Map<number, { code: string; employeeCode: string }>();
  for (const account of allAccounts) {
    if (account.code && account.code.startsWith("EMP-")) {
      const employeeCode = account.code.replace("EMP-", "");
      employeeAccountMap.set(account.id, { code: account.code, employeeCode });
    }
  }

  const employeeChangesById = new Map<number, { balanceChange: number; deposits: number; withdrawals: number }>();
  const employeeChangesByCode = new Map<string, { balanceChange: number; deposits: number; withdrawals: number }>();

  for (const entry of entries) {
    const debit = parseFloat(entry.debitAmount || "0");
    const credit = parseFloat(entry.creditAmount || "0");
    let balanceChange = credit - debit;
    if (reverse) balanceChange = -balanceChange;
    const depositChange = reverse ? -credit : credit;
    const withdrawalChange = reverse ? -debit : debit;

    if (entry.employeeId) {
      const current = employeeChangesById.get(entry.employeeId) || {
        balanceChange: 0,
        deposits: 0,
        withdrawals: 0,
      };
      employeeChangesById.set(entry.employeeId, {
        balanceChange: current.balanceChange + balanceChange,
        deposits: current.deposits + depositChange,
        withdrawals: current.withdrawals + withdrawalChange,
      });
      continue;
    }

    if (entry.ledgerAccountId) {
      const employeeAccount = employeeAccountMap.get(entry.ledgerAccountId);
      if (employeeAccount) {
        const current = employeeChangesByCode.get(employeeAccount.employeeCode) || {
          balanceChange: 0,
          deposits: 0,
          withdrawals: 0,
        };
        employeeChangesByCode.set(employeeAccount.employeeCode, {
          balanceChange: current.balanceChange + balanceChange,
          deposits: current.deposits + depositChange,
          withdrawals: current.withdrawals + withdrawalChange,
        });
      }
    }
  }

  for (const [employeeId, changes] of Array.from(employeeChangesById.entries())) {
    if (changes.balanceChange === 0 && changes.deposits === 0 && changes.withdrawals === 0) continue;
    const employee = await storage.getEmployeeById(employeeId);
    if (!employee) continue;
    const newBalance = parseFloat(employee.currentBalance || "0") + changes.balanceChange;
    const newDeposits = Math.max(0, parseFloat(employee.totalDeposits || "0") + changes.deposits);
    const newWithdrawals = Math.max(0, parseFloat(employee.totalWithdrawals || "0") + changes.withdrawals);
    await db
      .update(employees)
      .set({
        currentBalance: newBalance.toFixed(2),
        totalDeposits: newDeposits.toFixed(2),
        totalWithdrawals: newWithdrawals.toFixed(2),
      })
      .where(eq(employees.id, employee.id));
  }

  for (const [employeeCode, changes] of Array.from(employeeChangesByCode.entries())) {
    if (changes.balanceChange === 0 && changes.deposits === 0 && changes.withdrawals === 0) continue;
    const employee = await storage.getEmployeeByCode(employeeCode);
    if (!employee) continue;
    const newBalance = parseFloat(employee.currentBalance || "0") + changes.balanceChange;
    const newDeposits = Math.max(0, parseFloat(employee.totalDeposits || "0") + changes.deposits);
    const newWithdrawals = Math.max(0, parseFloat(employee.totalWithdrawals || "0") + changes.withdrawals);
    await db
      .update(employees)
      .set({
        currentBalance: newBalance.toFixed(2),
        totalDeposits: newDeposits.toFixed(2),
        totalWithdrawals: newWithdrawals.toFixed(2),
      })
      .where(eq(employees.id, employee.id));
  }
}
