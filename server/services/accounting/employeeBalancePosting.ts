import Decimal from "decimal.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { employees, ledgerAccounts } from "@shared/schema";

export interface EmployeeBalancePostingEntry {
  ledgerAccountId?: number | null;
  employeeId?: number | null;
  debitAmount?: string | null;
  creditAmount?: string | null;
}

export interface EmployeeBalanceDelta {
  balanceChange: string;
  deposits: string;
  withdrawals: string;
}

export interface EmployeeBalanceDeltaCollection {
  byEmployeeId: Map<number, EmployeeBalanceDelta>;
  byEmployeeCode: Map<string, EmployeeBalanceDelta>;
}

interface MutableDelta {
  balanceChange: Decimal;
  deposits: Decimal;
  withdrawals: Decimal;
}

function emptyDelta(): MutableDelta {
  return {
    balanceChange: new Decimal(0),
    deposits: new Decimal(0),
    withdrawals: new Decimal(0),
  };
}

function addDelta(
  target: Map<number | string, MutableDelta>,
  key: number | string,
  debit: Decimal,
  credit: Decimal
): void {
  const current = target.get(key) ?? emptyDelta();
  current.balanceChange = current.balanceChange.plus(credit).minus(debit);
  current.deposits = current.deposits.plus(credit);
  current.withdrawals = current.withdrawals.plus(debit);
  target.set(key, current);
}

function serializeDelta(delta: MutableDelta): EmployeeBalanceDelta {
  return {
    balanceChange: delta.balanceChange.toDecimalPlaces(2).toFixed(2),
    deposits: delta.deposits.toDecimalPlaces(2).toFixed(2),
    withdrawals: delta.withdrawals.toDecimalPlaces(2).toFixed(2),
  };
}

function parseAmount(value: string | null | undefined): Decimal {
  const amount = new Decimal(value ?? "0");
  if (!amount.isFinite() || amount.isNegative()) {
    throw new Error(`Employee balance posting received invalid amount: ${value}`);
  }
  return amount;
}

/**
 * Reproduces the existing employee balance rule:
 *
 *   currentBalance += credit - debit
 *   totalDeposits  += credit
 *   totalWithdrawals += debit
 *
 * Direct employeeId entries take precedence. Entries without employeeId may map
 * through a company ledger whose code is `EMP-<employee code>`.
 */
export function collectEmployeeBalanceDeltas(input: {
  entries: EmployeeBalancePostingEntry[];
  employeeCodeByLedgerId?: ReadonlyMap<number, string>;
}): EmployeeBalanceDeltaCollection {
  const byEmployeeIdMutable = new Map<number | string, MutableDelta>();
  const byEmployeeCodeMutable = new Map<number | string, MutableDelta>();
  const employeeCodeByLedgerId = input.employeeCodeByLedgerId ?? new Map<number, string>();

  for (const entry of input.entries) {
    const debit = parseAmount(entry.debitAmount);
    const credit = parseAmount(entry.creditAmount);

    if (entry.employeeId != null) {
      const employeeId = Number(entry.employeeId);
      if (!Number.isInteger(employeeId) || employeeId <= 0) {
        throw new Error(`Invalid employeeId in balance posting: ${entry.employeeId}`);
      }
      addDelta(byEmployeeIdMutable, employeeId, debit, credit);
      continue;
    }

    if (entry.ledgerAccountId != null) {
      const ledgerId = Number(entry.ledgerAccountId);
      const employeeCode = employeeCodeByLedgerId.get(ledgerId);
      if (employeeCode) addDelta(byEmployeeCodeMutable, employeeCode, debit, credit);
    }
  }

  return {
    byEmployeeId: new Map(
      [...byEmployeeIdMutable.entries()].map(([key, value]) => [Number(key), serializeDelta(value)])
    ),
    byEmployeeCode: new Map(
      [...byEmployeeCodeMutable.entries()].map(([key, value]) => [String(key), serializeDelta(value)])
    ),
  };
}

async function applyDeltaByEmployeeId(
  tx: any,
  companyId: number,
  employeeId: number,
  delta: EmployeeBalanceDelta
): Promise<void> {
  const updated = await tx
    .update(employees)
    .set({
      currentBalance: sql`COALESCE(${employees.currentBalance}, 0) + CAST(${delta.balanceChange} AS numeric)`,
      totalDeposits: sql`GREATEST(0, COALESCE(${employees.totalDeposits}, 0) + CAST(${delta.deposits} AS numeric))`,
      totalWithdrawals: sql`GREATEST(0, COALESCE(${employees.totalWithdrawals}, 0) + CAST(${delta.withdrawals} AS numeric))`,
    })
    .where(and(eq(employees.id, employeeId), eq(employees.companyId, companyId)))
    .returning({ id: employees.id });

  if (updated.length !== 1) {
    throw new Error(`Employee ${employeeId} not found in company ${companyId} during balance posting`);
  }
}

async function applyDeltaByEmployeeCode(
  tx: any,
  companyId: number,
  employeeCode: string,
  delta: EmployeeBalanceDelta
): Promise<void> {
  const updated = await tx
    .update(employees)
    .set({
      currentBalance: sql`COALESCE(${employees.currentBalance}, 0) + CAST(${delta.balanceChange} AS numeric)`,
      totalDeposits: sql`GREATEST(0, COALESCE(${employees.totalDeposits}, 0) + CAST(${delta.deposits} AS numeric))`,
      totalWithdrawals: sql`GREATEST(0, COALESCE(${employees.totalWithdrawals}, 0) + CAST(${delta.withdrawals} AS numeric))`,
    })
    .where(and(eq(employees.code, employeeCode), eq(employees.companyId, companyId)))
    .returning({ id: employees.id });

  if (updated.length !== 1) {
    // Preserve the legacy behavior for an EMP-* ledger with no matching employee:
    // it does not block the voucher posting.
    return;
  }
}

export async function applyEmployeeBalanceDeltasTx(input: {
  tx: any;
  companyId: number;
  entries: EmployeeBalancePostingEntry[];
}): Promise<void> {
  const ledgerIds = [...new Set(
    input.entries
      .filter((entry) => entry.employeeId == null && entry.ledgerAccountId != null)
      .map((entry) => Number(entry.ledgerAccountId))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];

  const employeeCodeByLedgerId = new Map<number, string>();
  if (ledgerIds.length > 0) {
    const rows = await input.tx
      .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.companyId, input.companyId),
          inArray(ledgerAccounts.id, ledgerIds)
        )
      );

    for (const row of rows) {
      if (row.code?.startsWith("EMP-")) {
        employeeCodeByLedgerId.set(Number(row.id), row.code.slice(4));
      }
    }
  }

  const deltas = collectEmployeeBalanceDeltas({
    entries: input.entries,
    employeeCodeByLedgerId,
  });

  for (const [employeeId, delta] of deltas.byEmployeeId) {
    await applyDeltaByEmployeeId(input.tx, input.companyId, employeeId, delta);
  }

  for (const [employeeCode, delta] of deltas.byEmployeeCode) {
    await applyDeltaByEmployeeCode(input.tx, input.companyId, employeeCode, delta);
  }
}
