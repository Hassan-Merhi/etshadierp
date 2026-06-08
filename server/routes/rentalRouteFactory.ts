import { parseId, parseOptionalId } from "../lib/parseId";
import { logAudit } from "./_helpers";
import type { Express, Request, Response } from "express";
import { db } from "../db";
import { requireAuth } from "../auth";
import { getClientDate } from "../lib/dateUtils";
import {
  propertyUnits,
  propertyContracts,
  propertyMonthlyLedger,
  propertyPayments,
  insertPropertyUnitSchema,
  insertPropertyContractSchema,
  ledgerAccounts,
  vouchers,
  voucherEntries,
  rentalAutoTransferConfigs,
  interCompanyTransfers,
  companies,
} from "@shared/schema";
import { eq, and, sql, desc, inArray, isNull, isNotNull, ne } from "drizzle-orm";
import { z } from "zod";

type RentalModule = "PROPERTIES" | "ERP" | "FACTORY";

function getCompanyId(req: Request): number | null {
  return req.session.currentCompanyId ?? null;
}

async function findOrCreateLedgerAccount(
  tx: any,
  companyId: number,
  name: string,
  accountType: "Income" | "Liability" | "Indirect Expense" | "Indirect Income" | "Intercompany" | "Asset",
  codePrefix: string,
  subType?: string,
): Promise<number> {
  // Race-safe: INSERT ... ON CONFLICT DO NOTHING, then SELECT.
  // The unique index uq_ledger_accounts_company_name_active prevents duplicates
  // even when multiple transactions run in parallel (e.g. page-load batch accruals).
  const code = `${codePrefix}-${Date.now()}`;
  await tx.execute(sql`
    INSERT INTO ledger_accounts (company_id, code, name, account_type, sub_type, active)
    VALUES (${companyId}, ${code}, ${name}, ${accountType}, ${subType ?? null}, true)
    ON CONFLICT (company_id, name) WHERE deleted_at IS NULL DO NOTHING
  `);
  const [account] = await tx.select().from(ledgerAccounts).where(and(
    eq(ledgerAccounts.companyId, companyId),
    eq(ledgerAccounts.name, name),
    isNull(ledgerAccounts.deletedAt),
  ));
  // Patch type/subType if the existing row has stale values
  const needsPatch =
    account.accountType !== accountType ||
    (subType !== undefined && account.subType !== subType);
  if (needsPatch) {
    await tx.update(ledgerAccounts)
      .set({ accountType, ...(subType !== undefined ? { subType } : {}) })
      .where(eq(ledgerAccounts.id, account.id));
  }
  return account.id;
}

// ── Auto-transfer helper ──────────────────────────────────────────────────────
// Called after a payment is committed. Looks up the auto-transfer config for
// this company/module and, if enabled, posts two vouchers (one per company)
// using the same TRANSFER-CLEARING pattern as /api/simple-company-transfer.
async function maybeRunAutoTransfer(
  companyId: number,
  module: RentalModule,
  fromLedgerAccountId: number,
  amount: string,
  transferDate: string,
  unitLabel: string,
  sourcePaymentId?: number,
  notes?: string,
) {
  try {
    // Fetch ALL active rules for this company+module
    const configs = await db.select().from(rentalAutoTransferConfigs).where(and(
      eq(rentalAutoTransferConfigs.companyId, companyId),
      eq(rentalAutoTransferConfigs.module, module),
      eq(rentalAutoTransferConfigs.enabled, true),
    ));
    if (configs.length === 0) return;

    const [fromCompany] = await db.select().from(companies).where(eq(companies.id, companyId));
    if (!fromCompany) return;

    // Get or create TRANSFER-CLEARING account in a company
    async function getOrCreateClearing(cid: number) {
      const [existing] = await db.select().from(ledgerAccounts).where(and(
        eq(ledgerAccounts.companyId, cid),
        eq(ledgerAccounts.code, "TRANSFER-CLEARING"),
        isNull(ledgerAccounts.deletedAt),
      ));
      if (existing) return existing;
      const [created] = await db.insert(ledgerAccounts).values({
        companyId: cid, code: "TRANSFER-CLEARING", name: "Transfer Clearing",
        accountType: "Equity", active: true,
      }).returning();
      return created;
    }

    const fromClearing = await getOrCreateClearing(companyId);

    // Find the FIRST rule that matches the source account.
    // Rules with a specific sourceCashAccountIds list take precedence; fallback to the
    // first rule with an empty filter only when no specific rule matched.
    const specificMatch = configs.find(c => {
      const ids = (c.sourceCashAccountIds ?? []) as number[];
      return ids.length > 0 && ids.includes(fromLedgerAccountId);
    });
    const fallbackMatch = configs.find(c => {
      const ids = (c.sourceCashAccountIds ?? []) as number[];
      return ids.length === 0;
    });
    const cfg = specificMatch ?? fallbackMatch;
    if (!cfg) return;

    // Only one transfer per payment — use the matched rule.
    {
      const [toCompany] = await db.select().from(companies).where(eq(companies.id, cfg.destCompanyId));
      if (!toCompany) return;

      const toClearing = await getOrCreateClearing(cfg.destCompanyId);
      const baseDesc = `Auto rent transfer - ${unitLabel}`;
      const desc = notes ? `${baseDesc} - ${notes}` : baseDesc;
      const txId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const outNarration = notes
        ? `Transfer out to ${toCompany.name} - ${notes}`
        : `Transfer out to ${toCompany.name}`;
      const inNarration = notes
        ? `Transfer in from ${fromCompany.name} - ${notes}`
        : `Transfer in from ${fromCompany.name}`;

      // Voucher in FROM company (Payment — money leaves)
      const [fromVoucher] = await db.insert(vouchers).values({
        companyId, voucherNumber: `TR-OUT-${txId}`,
        voucherType: "Payment", voucherDate: transferDate as any,
        description: `${desc} → ${toCompany.name}`, totalAmount: amount, optional: false,
      }).returning();
      await db.insert(voucherEntries).values([
        { voucherId: fromVoucher.id, ledgerAccountId: fromClearing.id, debitAmount: amount,  creditAmount: "0", narration: outNarration },
        { voucherId: fromVoucher.id, ledgerAccountId: fromLedgerAccountId, debitAmount: "0", creditAmount: amount, narration: outNarration },
      ]);

      // Voucher in TO company (Receipt — money arrives)
      // DR destLedgerAccountId (cash/account receives money), CR toClearing (clearing settled)
      const [toVoucher] = await db.insert(vouchers).values({
        companyId: cfg.destCompanyId, voucherNumber: `TR-IN-${txId}`,
        voucherType: "Receipt", voucherDate: transferDate as any,
        description: notes ? `Transfer from ${fromCompany.name} - ${notes}` : `Transfer from ${fromCompany.name}`,
        totalAmount: amount, optional: false,
      }).returning();
      await db.insert(voucherEntries).values([
        { voucherId: toVoucher.id, ledgerAccountId: cfg.destLedgerAccountId, debitAmount: amount, creditAmount: "0",   narration: inNarration },
        { voucherId: toVoucher.id, ledgerAccountId: toClearing.id,           debitAmount: "0",   creditAmount: amount, narration: inNarration },
      ]);

      // Record link (sourcePaymentId links this transfer back to the originating payment)
      await db.insert(interCompanyTransfers).values({
        transferType: "Cash",
        fromCompanyId: companyId, toCompanyId: cfg.destCompanyId,
        transferDate: transferDate as any, amount,
        fromLedgerAccountId, toLedgerAccountId: cfg.destLedgerAccountId,
        fromVoucherId: fromVoucher.id, toVoucherId: toVoucher.id,
        description: desc,
        sourcePaymentId: sourcePaymentId ?? null,
      });
    }
  } catch (err) {
    console.error("[RentalAutoTransfer] failed:", err);
  }
}

async function ensureMonthlyLedgerRows(contractId: number) {
  const [contract] = await db.select().from(propertyContracts).where(eq(propertyContracts.id, contractId));
  if (!contract || contract.status !== "ACTIVE") return;

  const start = new Date(contract.startDate as any);
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth() + 1;
  const billingDay = start.getUTCDate(); // day-of-month the tenant started = monthly billing day
  const now = new Date();
  const curYear = now.getUTCFullYear();
  const curMonth = now.getUTCMonth() + 1;
  const curDay = now.getUTCDate();

  // If today is before the billing day, remove any unpaid current-month row that was
  // created prematurely (e.g. by the old code or after a startDate edit).
  if (curDay < billingDay) {
    await db.delete(propertyMonthlyLedger).where(
      and(
        eq(propertyMonthlyLedger.contractId, contract.id),
        eq(propertyMonthlyLedger.year, curYear),
        eq(propertyMonthlyLedger.month, curMonth),
        sql`${propertyMonthlyLedger.paidAmount} = '0'`,
      )
    );
  }

  const periods: Array<{ year: number; month: number }> = [];
  let y = startYear, m = startMonth;
  // Include a period if it is a past month, OR if it is the current month AND today's
  // day-of-month has reached the tenant's billing day (so a tenant starting on the 15th
  // won't have the current month's charge appear until the 15th).
  while (
    y < curYear ||
    (y === curYear && m < curMonth) ||
    (y === curYear && m === curMonth && curDay >= billingDay)
  ) {
    periods.push({ year: y, month: m });
    m++; if (m > 12) { m = 1; y++; }
    if (periods.length > 600) break;
  }
  if (periods.length === 0) return;

  await db.insert(propertyMonthlyLedger).values(
    periods.map(p => ({
      companyId: contract.companyId,
      module: contract.module,
      contractId: contract.id,
      unitId: contract.unitId,
      year: p.year,
      month: p.month,
      expectedAmount: contract.rentalAmount,
      paidAmount: "0",
    }))
  ).onConflictDoNothing({
    target: [propertyMonthlyLedger.contractId, propertyMonthlyLedger.year, propertyMonthlyLedger.month],
  });
}

// ── Oldest unpaid month finder ─────────────────────────────────────────────
// Returns the earliest past-or-current month for this contract that still has
// an outstanding balance.  Falls back to (fallbackYear, fallbackMonth) when
// every recorded month is fully paid.
async function findEarliestOutstandingMonth(
  contractId: number,
  fallbackYear: number,
  fallbackMonth: number,
): Promise<{ year: number; month: number }> {
  const rows = await db
    .select({
      year:           propertyMonthlyLedger.year,
      month:          propertyMonthlyLedger.month,
      paidAmount:     propertyMonthlyLedger.paidAmount,
      expectedAmount: propertyMonthlyLedger.expectedAmount,
    })
    .from(propertyMonthlyLedger)
    .where(eq(propertyMonthlyLedger.contractId, contractId))
    .orderBy(propertyMonthlyLedger.year, propertyMonthlyLedger.month);

  const now = new Date();
  const nowYear  = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;

  for (const row of rows) {
    // Only consider past and current months (not future prepaid months)
    const isPastOrCurrent =
      row.year < nowYear || (row.year === nowYear && row.month <= nowMonth);
    if (!isPastOrCurrent) continue;

    const outstanding =
      Math.max(0, parseFloat(row.expectedAmount as string) - parseFloat(row.paidAmount as string));
    if (outstanding > 0.005) {
      return { year: row.year, month: row.month };
    }
  }

  return { year: fallbackYear, month: fallbackMonth };
}

// ── Smart allocation builder ───────────────────────────────────────────────
// Builds the list of (year, month, chunk) allocations for a payment, starting
// from (startYear, startMonth) but SKIPPING any month that is already fully
// paid or fully prepaid, so the payment cascades to the next unpaid month.
//
// "Fully paid" rules:
//   • Current / past month  → paidAmount >= expectedAmount (standard due month)
//   • Future month          → paidAmount >= rentalAmount   (already prepaid in full)
async function buildAllocations(
  contractId: number,
  startYear: number,
  startMonth: number,
  totalAmount: number,
  rentalAmount: number,
): Promise<Array<{ year: number; month: number; chunk: string }>> {
  // Load all existing ledger rows for this contract so we can check balances
  const existingRows = await db
    .select({
      year: propertyMonthlyLedger.year,
      month: propertyMonthlyLedger.month,
      paidAmount: propertyMonthlyLedger.paidAmount,
      expectedAmount: propertyMonthlyLedger.expectedAmount,
    })
    .from(propertyMonthlyLedger)
    .where(eq(propertyMonthlyLedger.contractId, contractId));

  const ledgerMap = new Map<string, { paid: number; expected: number }>();
  for (const row of existingRows) {
    ledgerMap.set(`${row.year}-${row.month}`, {
      paid: parseFloat(row.paidAmount as string),
      expected: parseFloat(row.expectedAmount as string),
    });
  }

  const now = new Date();
  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;

  const allocations: Array<{ year: number; month: number; chunk: string }> = [];
  let remaining = totalAmount;
  let ay = startYear, am = startMonth;
  let skipped = 0; // guard against infinite loops of already-paid months

  while (remaining > 0.005) {
    const isFuture = ay > nowYear || (ay === nowYear && am > nowMonth);
    const existing = ledgerMap.get(`${ay}-${am}`);

    let outstanding: number;
    if (existing) {
      if (isFuture) {
        // Future prepaid month: compare against contract rental amount
        outstanding = Math.max(0, rentalAmount - existing.paid);
      } else {
        // Current / past due month: compare against its expected amount
        outstanding = Math.max(0, existing.expected - existing.paid);
      }
    } else {
      // No ledger row yet — full capacity available
      outstanding = rentalAmount > 0 ? rentalAmount : remaining;
    }

    if (outstanding <= 0.005) {
      // Already fully paid — skip this month and try the next
      am++; if (am > 12) { am = 1; ay++; }
      skipped++;
      if (skipped > 500) break; // absolute safety cap
      continue;
    }

    skipped = 0; // reset skip counter once we found an allocatable month
    const chunk = Math.min(remaining, outstanding);
    allocations.push({ year: ay, month: am, chunk: chunk.toFixed(2) });
    remaining = Math.round((remaining - chunk) * 100) / 100;
    am++; if (am > 12) { am = 1; ay++; }
    if (allocations.length >= 120) break; // safety cap ~10 years
  }

  return allocations;
}

export async function ensureMonthlyForCompany(companyId: number, module: RentalModule) {
  const active = await db
    .select({ id: propertyContracts.id })
    .from(propertyContracts)
    .where(and(
      eq(propertyContracts.companyId, companyId),
      eq(propertyContracts.module, module),
      eq(propertyContracts.status, "ACTIVE"),
    ));
  for (const c of active) await ensureMonthlyLedgerRows(c.id);
}

/**
 * Posts accrual journal vouchers (Dr Rent Expense / Cr Accrued Rent Payable) for
 * all unpaid ERP SHOP ledger rows where:
 *   - accrualVoucherId IS NULL (not yet accrued)
 *   - paidAmount < expectedAmount (still has an outstanding balance)
 *
 * Scoped to ERP module + SHOP unit type only. Safe to call for any contract —
 * it returns 0 immediately if the contract is not an ERP SHOP contract.
 *
 * Returns { accrued, skipped } where accrued = newly-posted rows,
 * skipped = due+unpaid rows that already had an accrual (nothing to do).
 */
async function postRentAccrualForContract(
  contractId: number,
  shopExpenseAccountName: string,
): Promise<{ accrued: number; skipped: number }> {
  // Load contract and verify it is an ERP contract
  const [contract] = await db.select().from(propertyContracts)
    .where(and(eq(propertyContracts.id, contractId), eq(propertyContracts.module, "ERP")));
  if (!contract) return { accrued: 0, skipped: 0 };

  // Verify the unit is SHOP type
  const [unit] = await db.select({ unitType: propertyUnits.unitType })
    .from(propertyUnits)
    .where(eq(propertyUnits.id, contract.unitId));
  if (!unit || unit.unitType !== "SHOP") return { accrued: 0, skipped: 0 };

  return postRentAccrualForCompany(contract.companyId, shopExpenseAccountName);
}

/**
 * Posts ONE combined accrual journal (Dr Rent Expense / Cr Accrued Rent Payable)
 * for ALL active ERP SHOP contracts of the company that have due, unpaid, unaccrued
 * ledger rows.
 *
 * All rows that are newly accrued point to the same voucher ID so the daybook
 * shows a single journal entry instead of one per unit/month.
 *
 * Returns { accrued: N, skipped: M } where:
 *   accrued = number of ledger rows newly stamped with the combined voucher
 *   skipped = due+unpaid rows already accrued in a prior run
 */
export async function postRentAccrualForCompany(
  companyId: number,
  shopExpenseAccountName: string,
  moduleParam: string = "ERP",
  incomeAccountName: string = "Rental Income",
): Promise<{ accrued: number; skipped: number }> {
  // Load all active SHOP contracts owned by this company for the given module
  const shopContracts = await db
    .select({
      id: propertyContracts.id,
      unitId: propertyContracts.unitId,
      unitNumber: propertyUnits.unitNumber,
      startDate: propertyContracts.startDate,
      currency: propertyContracts.currency,
    })
    .from(propertyContracts)
    .innerJoin(propertyUnits, eq(propertyUnits.id, propertyContracts.unitId))
    .where(and(
      eq(propertyContracts.companyId, companyId),
      eq(propertyContracts.module, moduleParam as any),
      eq(propertyContracts.status, "ACTIVE"),
      eq(propertyUnits.unitType, "SHOP"),
    ));

  // Also load shared contracts — units rented FROM another company (linkedCompanyId = this company).
  // These always appear in the Shops view regardless of their unit type, so they should
  // be accrued the same way (Dr Rent Expense / Cr Accrued Rent Payable).
  const sharedContracts = await db
    .select({
      id: propertyContracts.id,
      unitId: propertyContracts.unitId,
      unitNumber: propertyUnits.unitNumber,
      startDate: propertyContracts.startDate,
      currency: propertyContracts.currency,
    })
    .from(propertyContracts)
    .innerJoin(propertyUnits, eq(propertyUnits.id, propertyContracts.unitId))
    .where(and(
      eq(propertyContracts.linkedCompanyId, companyId),
      eq(propertyContracts.status, "ACTIVE"),
    ));

  // Deduplicate in case a contract somehow appears in both (shouldn't happen, but be safe)
  const seen = new Set<number>();
  const allContracts = [...shopContracts, ...sharedContracts].filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  // If there are no SHOP/shared contracts, pass 1 and pass 2 will no-op via
  // their own guards (contractIds.length === 0), but pass 3 (landlord deferred)
  // must still run for landlord-only companies.

  // Determine the dominant currency for this batch of contracts (fallback USD).
  const currencyCount = new Map<string, number>();
  for (const c of allContracts) {
    const cur = c.currency || "USD";
    currencyCount.set(cur, (currencyCount.get(cur) ?? 0) + 1);
  }
  const batchCurrency = currencyCount.size > 0
    ? [...currencyCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : "USD";

  const contractIds = allContracts.map(c => c.id);

  // Unit name (display label) keyed by unitId
  const unitNameById = new Map(allContracts.map(c => [c.unitId, c.unitNumber]));

  // Billing day (day-of-month) keyed by contractId
  const billingDayByContract = new Map(
    allContracts.map(c => [c.id, new Date(c.startDate as any).getUTCDate()])
  );

  const now = new Date();
  const curYear  = now.getUTCFullYear();
  const curMonth = now.getUTCMonth() + 1;
  const curDay   = now.getUTCDate();

  // isDue is defined here (outer scope) so pass 2 can use it even when
  // contractIds is empty (landlord-only company case).
  const isDue = (row: { year: number; month: number; contractId: number }) => {
    const billingDay = billingDayByContract.get(row.contractId) ?? 1;
    if (row.year < curYear) return true;
    if (row.year === curYear && row.month < curMonth) return true;
    if (row.year === curYear && row.month === curMonth && curDay >= billingDay) return true;
    return false;
  };

  let accrued = 0;
  let alreadyDone = 0;

  // ── Pass 1: Standard accrual for SHOP/shared contracts ────────────────────
  // Skipped entirely if this company has no SHOP/shared contracts (contractIds empty).
  // Pass 2 (tenant prepaid) and Pass 3 (landlord deferred) run independently below.
  if (contractIds.length > 0) {
    // Fetch ALL rows that have no accrual voucher yet (paid OR unpaid).
    // Exclude prepaid rows — pass 2 handles those exclusively to avoid double-counting.
    const allUnaccrued = await db.select()
      .from(propertyMonthlyLedger)
      .where(and(
        inArray(propertyMonthlyLedger.contractId, contractIds),
        isNull(propertyMonthlyLedger.accrualVoucherId),
        eq(propertyMonthlyLedger.usedPrepaidAccount, false),
        eq(propertyMonthlyLedger.usedAdvanceAccount, false),
        sql`${propertyMonthlyLedger.expectedAmount}::numeric > 0`,
      ));

    // Compute contract-level net outstanding so we don't accrue for contracts
    // that are fully covered by advance payments (outstanding ≤ 0).
    const unaccruedContractIds = [...new Set(allUnaccrued.map(r => r.contractId))];
    const contractsWithPositiveOutstanding = new Set<number>();
    if (unaccruedContractIds.length > 0) {
      const outstandingRows = await db.select({
        contractId: propertyMonthlyLedger.contractId,
        expected: sql<string>`COALESCE(SUM(
          CASE WHEN (
            ${propertyMonthlyLedger.year} < ${curYear}
            OR (${propertyMonthlyLedger.year} = ${curYear} AND ${propertyMonthlyLedger.month} <= ${curMonth})
          ) THEN ${propertyMonthlyLedger.expectedAmount}::numeric ELSE 0 END
        ), 0)`,
        paid: sql<string>`COALESCE(SUM(${propertyMonthlyLedger.paidAmount}::numeric), 0)`,
      })
        .from(propertyMonthlyLedger)
        .where(inArray(propertyMonthlyLedger.contractId, unaccruedContractIds))
        .groupBy(propertyMonthlyLedger.contractId);

      for (const r of outstandingRows) {
        if (Number(r.expected) - Number(r.paid) > 0.005) {
          contractsWithPositiveOutstanding.add(r.contractId);
        }
      }
    }

    // Count already-accrued rows for the "skipped" response metric
    const allAccruedForSkip = await db.select({ id: propertyMonthlyLedger.id })
      .from(propertyMonthlyLedger)
      .where(and(
        inArray(propertyMonthlyLedger.contractId, contractIds),
        isNotNull(propertyMonthlyLedger.accrualVoucherId),
      ));
    alreadyDone = allAccruedForSkip.length;

    const pendingRows = allUnaccrued.filter(r =>
      isDue(r) && contractsWithPositiveOutstanding.has(r.contractId),
    );

    console.log(`[postRentAccrual] company=${companyId} unaccrued=${allUnaccrued.length} pendingDue=${pendingRows.length} alreadyDone=${alreadyDone} curYear=${curYear} curMonth=${curMonth} curDay=${curDay} contractsWithPositiveOutstanding=${contractsWithPositiveOutstanding.size}`);
    if (pendingRows.length > 0) {
      console.log(`[postRentAccrual] pendingRows sample:`, JSON.stringify(pendingRows.slice(0, 3).map(r => ({ id: r.id, year: r.year, month: r.month, contractId: r.contractId, paid: r.paidAmount, expected: r.expectedAmount }))));
    }

    // ── Pass 1 transaction ──
    if (pendingRows.length > 0) {
    try {
    await db.transaction(async (tx) => {
      // Lock ALL pending rows in one shot — SKIP LOCKED guards against races.
      // Use IN (...) with a literal id list (all values are trusted integers from
      // the DB) rather than ANY($n::int[]) — Drizzle does not serialize a JS
      // array through the sql`` tag in a way pg accepts with ::int[] casting.
      const pendingIds = pendingRows.map(r => r.id);
      const idListSql = pendingIds.join(","); // safe: all are DB integers
      const lockResult = await tx.execute(sql.raw(
        `SELECT id, expected_amount, paid_amount, unit_id, month, year
         FROM property_monthly_ledger
         WHERE id IN (${idListSql})
           AND accrual_voucher_id IS NULL
           AND expected_amount::numeric > 0
           AND used_advance_account = false
         FOR UPDATE SKIP LOCKED`,
      ));

      if (!lockResult.rows || lockResult.rows.length === 0) return;

      type LockedRow = {
        id: number; expected_amount: string; paid_amount: string;
        unit_id: number; month: number; year: number;
      };
      const lockedRows = lockResult.rows as LockedRow[];

      type Entry = { id: number; amount: number; unitId: number; month: number; year: number };
      const entries: Entry[] = [];
      for (const locked of lockedRows) {
        // Accrue only the UNPAID portion (expectedAmount − paidAmount).
        //
        // When payment is made AFTER accrual the flow is:
        //   Accrual:  Dr Rent Expense / Cr Accrued Rent Payable  (full expected)
        //   Payment:  Dr Accrued Rent Payable / Cr Cash           (full paid)
        // → at accrual time paid_amount = 0, so we accrue the full expected amount ✓
        //
        // When payment is made BEFORE accrual the flow is:
        //   Payment:  Dr Rent Expense / Cr Cash  (isAccrued=false path, no AP entry)
        //   Accrual:  should only record the REMAINING unpaid portion
        // → using (expected − paid) avoids creating phantom AP balance ✓
        const expected = Number(locked.expected_amount);
        const paid     = Number(locked.paid_amount || "0");
        const amount   = expected - paid;
        if (amount <= 0) continue;
        entries.push({
          id:     Number(locked.id),
          amount,
          unitId: Number(locked.unit_id),
          month:  Number(locked.month),
          year:   Number(locked.year),
        });
      }
      if (entries.length === 0) return;

      const totalAmount = entries.reduce((s, e) => s + e.amount, 0);

      const expenseAccountId = await findOrCreateLedgerAccount(
        tx, companyId, shopExpenseAccountName, "Indirect Expense", "SHOP-RENT-EXP",
      );
      const liabilityAccountId = await findOrCreateLedgerAccount(
        tx, companyId, "Accrued Rent Payable", "Liability", "ACCR-RENT-PAY",
      );

      // Build a period label for the voucher description
      const months = [...new Set(
        entries.map(e => `${String(e.month).padStart(2, "0")}/${e.year}`)
      )].sort();
      const periodLabel = months.length === 1
        ? months[0]
        : `${months[0]}–${months[months.length - 1]}`;
      const voucherDesc = `Rent accrual - ${companyId} - ${periodLabel}`;

      // ONE voucher for all rows
      const [v] = await tx.insert(vouchers).values({
        companyId,
        voucherNumber: `ACCR-RENT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        voucherType:  "Journal",
        voucherDate:  new Date().toISOString().slice(0, 10) as any,
        description:  voucherDesc,
        totalAmount:  String(totalAmount),
        currency:     batchCurrency,
        sourceModule: moduleParam as any,
      }).returning();

      // One debit entry per row so the journal is traceable by unit + month
      const debitEntries = entries.map(e => ({
        voucherId:        v.id,
        ledgerAccountId:  expenseAccountId,
        debitAmount:      String(e.amount),
        creditAmount:     "0",
        narration:        `Rent accrual - ${unitNameById.get(e.unitId) ?? `unit${e.unitId}`} - ${String(e.month).padStart(2, "0")}/${e.year}`,
      }));

      // One combined credit to Accrued Rent Payable
      await tx.insert(voucherEntries).values([
        ...debitEntries,
        {
          voucherId:       v.id,
          ledgerAccountId: liabilityAccountId,
          debitAmount:     "0",
          creditAmount:    String(totalAmount),
          narration:       voucherDesc,
        },
      ]);

      // Stamp every locked row with the single voucher ID
      await tx.update(propertyMonthlyLedger)
        .set({ accrualVoucherId: v.id })
        .where(inArray(propertyMonthlyLedger.id, entries.map(e => e.id)));

      accrued += entries.length;
    });
  } catch (e: any) {
    // Log the full error — Drizzle formats errors as "Failed query:\n<SQL>\n<pg error>",
    // so split("\n")[0] always shows the useless header.  Log all lines instead.
    const detail = (e.message ?? String(e)).replace(/\n/g, " | ");
    console.error(`[ERP/rental] batch accrual failed company ${companyId}: ${detail}`);
    // intentional fall-through: partial failure logged, continue to recognition passes
  }
  } // end if (pendingRows.length > 0)
  } // end if (contractIds.length > 0) — Pass 1

  // ── Pass 1.5: Advance Rent Paid recognition ───────────────────────────────
  // When a payment is made for a current/due month BEFORE the accrual runs,
  // the payment uses Dr Advance Rent Paid / Cr Cash (visible in Net Position).
  // Pass 1.5 recognises the expense: Dr Rent Expense / Cr Advance Rent Paid.
  // Any remaining unpaid portion is also credited to Accrued Rent Payable.
  if (contractIds.length > 0) {
    try {
      const advanceRows = await db.select()
        .from(propertyMonthlyLedger)
        .where(and(
          inArray(propertyMonthlyLedger.contractId, contractIds),
          isNull(propertyMonthlyLedger.accrualVoucherId),
          eq(propertyMonthlyLedger.usedAdvanceAccount, true),
          sql`${propertyMonthlyLedger.expectedAmount}::numeric > 0`,
        ));
      const dueAdvanceRows = advanceRows.filter(r => isDue(r));
      if (dueAdvanceRows.length > 0) {
        await db.transaction(async (tx) => {
          const pendingIds15 = dueAdvanceRows.map(r => r.id);
          const idListSql15 = pendingIds15.join(",");
          const lock15 = await tx.execute(sql.raw(
            `SELECT id, expected_amount, paid_amount, unit_id, month, year
             FROM property_monthly_ledger
             WHERE id IN (${idListSql15})
               AND accrual_voucher_id IS NULL
               AND used_advance_account = true
             FOR UPDATE SKIP LOCKED`,
          ));
          if (!lock15.rows || lock15.rows.length === 0) return;
          type LR15 = { id: number; expected_amount: string; paid_amount: string; unit_id: number; month: number; year: number };
          const locked15 = lock15.rows as LR15[];

          const expenseAcctId = await findOrCreateLedgerAccount(tx, companyId, shopExpenseAccountName, "Indirect Expense", "SHOP-RENT-EXP");
          const advanceAcctId = await findOrCreateLedgerAccount(tx, companyId, "Advance Rent Paid", "Asset", "ADV-RENT-PAID");
          const liabilityAcctId = await findOrCreateLedgerAccount(tx, companyId, "Accrued Rent Payable", "Liability", "ACCR-RENT-PAY");

          const months15 = [...new Set(locked15.map(r => `${String(Number(r.month)).padStart(2,"0")}/${r.year}`))].sort();
          const period15 = months15.length === 1 ? months15[0] : `${months15[0]}–${months15[months15.length-1]}`;
          const desc15 = `Advance rent recognition - ${companyId} - ${period15}`;

          let totalExpense15 = 0;
          let totalAdvCredit15 = 0;
          let totalApCredit15 = 0;
          const debitEntries15: any[] = [];

          for (const r of locked15) {
            const expected = Number(r.expected_amount);
            const paid = Number(r.paid_amount || "0");
            const advCredit = Math.min(paid, expected);
            const apCredit = Math.max(0, expected - paid);
            const narr15 = `Advance rent recognition - unit${r.unit_id} - ${String(Number(r.month)).padStart(2,"0")}/${r.year}`;
            debitEntries15.push({ ledgerAccountId: expenseAcctId, debitAmount: String(expected), creditAmount: "0", narration: narr15 });
            totalExpense15 += expected;
            totalAdvCredit15 += advCredit;
            totalApCredit15 += apCredit;
          }

          const [v15] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber: `ADV-REC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            voucherType: "Journal",
            voucherDate: new Date().toISOString().slice(0, 10) as any,
            description: desc15,
            totalAmount: String(totalExpense15),
            currency: batchCurrency,
            sourceModule: moduleParam as any,
          }).returning();

          const allEntries15: any[] = debitEntries15.map(e => ({ ...e, voucherId: v15.id }));
          if (totalAdvCredit15 > 0.005) {
            allEntries15.push({ voucherId: v15.id, ledgerAccountId: advanceAcctId, debitAmount: "0", creditAmount: String(totalAdvCredit15), narration: desc15 });
          }
          if (totalApCredit15 > 0.005) {
            allEntries15.push({ voucherId: v15.id, ledgerAccountId: liabilityAcctId, debitAmount: "0", creditAmount: String(totalApCredit15), narration: desc15 });
          }
          await tx.insert(voucherEntries).values(allEntries15);
          await tx.update(propertyMonthlyLedger)
            .set({ accrualVoucherId: v15.id })
            .where(inArray(propertyMonthlyLedger.id, locked15.map(r => Number(r.id))));
          accrued += locked15.length;
        });
      }
    } catch (e: any) {
      const detail = (e.message ?? String(e)).replace(/\n/g, " | ");
      console.error(`[ERP/rental] advance recognition pass failed company ${companyId}: ${detail}`);
    }
  } // end Pass 1.5

  // ── Pass 2: Tenant prepaid rent recognition ──────────────────────────────
  // For rows where usedPrepaidAccount=true, accrualVoucherId IS NULL, and isDue:
  //   Dr Rent Expense (expectedAmount)
  //     Cr Prepaid Rent          (paidAmount  — reverses the asset)
  //     Cr Accrued Rent Payable  (unpaidPortion, if any — normal liability for remainder)
  // Using paidAmount (not expectedAmount) for the Prepaid Rent credit ensures we
  // never over-credit the asset for partial advance payments.
  if (contractIds.length > 0) {
    try {
      const prepaidUnaccrued = await db.select()
        .from(propertyMonthlyLedger)
        .where(and(
          inArray(propertyMonthlyLedger.contractId, contractIds),
          isNull(propertyMonthlyLedger.accrualVoucherId),
          eq(propertyMonthlyLedger.usedPrepaidAccount, true),
        ));
      const duePrepaid = prepaidUnaccrued.filter(r => isDue(r));
      if (duePrepaid.length > 0) {
        await db.transaction(async (tx) => {
          const expenseId    = await findOrCreateLedgerAccount(tx, companyId, shopExpenseAccountName, "Indirect Expense", "SHOP-RENT-EXP");
          const prepaidId    = await findOrCreateLedgerAccount(tx, companyId, "Prepaid Rent", "Asset", "PREP-RENT");
          const liabilityId  = await findOrCreateLedgerAccount(tx, companyId, "Accrued Rent Payable", "Liability", "ACCR-RENT-PAY");

          const months = [...new Set(duePrepaid.map(r => `${String(r.month).padStart(2,"0")}/${r.year}`))].sort();
          const periodLabel = months.length === 1 ? months[0] : `${months[0]}–${months[months.length-1]}`;

          // Total expense to recognize = full expected rent (prepaid portion + any outstanding)
          const totalExpected = duePrepaid.reduce((s, r) => s + Number(r.expectedAmount), 0);
          const totalPaid     = duePrepaid.reduce((s, r) => s + Math.min(Number(r.paidAmount), Number(r.expectedAmount)), 0);
          const totalUnpaid   = Math.max(0, totalExpected - totalPaid);

          const vDesc = `Prepaid rent recognized - ${companyId} - ${periodLabel}`;
          const [v] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber: `PREP-RENT-REC-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
            voucherType: "Journal",
            voucherDate: new Date().toISOString().slice(0,10) as any,
            description: vDesc,
            totalAmount: String(totalExpected),
            currency: batchCurrency,
            sourceModule: moduleParam as any,
          }).returning();

          // One debit line per row (Rent Expense = full expected)
          const entries: any[] = duePrepaid.map(r => {
            const rowLabel = `${unitNameById.get(r.unitId) ?? `unit${r.unitId}`} - ${String(r.month).padStart(2,"0")}/${r.year}`;
            return {
              voucherId: v.id,
              ledgerAccountId: expenseId,
              debitAmount: String(Number(r.expectedAmount)),
              creditAmount: "0",
              narration: `Prepaid rent recognized - ${rowLabel}`,
            };
          });

          // Credit Prepaid Rent for the portion already paid in advance
          if (totalPaid > 0.005) {
            entries.push({ voucherId: v.id, ledgerAccountId: prepaidId, debitAmount: "0", creditAmount: totalPaid.toFixed(2), narration: vDesc });
          }
          // Credit Accrued Rent Payable for the remainder (partial-prepay case)
          if (totalUnpaid > 0.005) {
            entries.push({ voucherId: v.id, ledgerAccountId: liabilityId, debitAmount: "0", creditAmount: totalUnpaid.toFixed(2), narration: vDesc });
          }

          await tx.insert(voucherEntries).values(entries);
          await tx.update(propertyMonthlyLedger)
            .set({ accrualVoucherId: v.id })
            .where(inArray(propertyMonthlyLedger.id, duePrepaid.map(r => r.id)));
          accrued += duePrepaid.length;
        });
      }
    } catch (e: any) {
      const detail = (e.message ?? String(e)).replace(/\n/g, " | ");
      console.error(`[ERP/rental] prepaid recognition failed company ${companyId}: ${detail}`);
    }
  }

  // ── Pass 3: Landlord deferred revenue recognition ─────────────────────────
  // For rows where usedPrepaidAccount=true, accrualVoucherId IS NULL, and isDue:
  //   Dr Deferred Rent Revenue / Cr Rent Income
  try {
    const landlordContracts = await db
      .select({
        id: propertyContracts.id,
        unitId: propertyContracts.unitId,
        unitNumber: propertyUnits.unitNumber,
        startDate: propertyContracts.startDate,
        currency: propertyContracts.currency,
      })
      .from(propertyContracts)
      .innerJoin(propertyUnits, eq(propertyUnits.id, propertyContracts.unitId))
      .where(and(
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, moduleParam as any),
        eq(propertyContracts.status, "ACTIVE"),
        ne(propertyUnits.unitType, "SHOP"),
      ));
    if (landlordContracts.length > 0) {
      const landlordIds = landlordContracts.map(c => c.id);
      const landlordUnitNames = new Map(landlordContracts.map(c => [c.unitId, c.unitNumber]));
      const landlordBillingDay = new Map(landlordContracts.map(c => [c.id, new Date(c.startDate as any).getUTCDate()]));
      const isLandlordDue = (row: { year: number; month: number; contractId: number }) => {
        const bd = landlordBillingDay.get(row.contractId) ?? 1;
        if (row.year < curYear) return true;
        if (row.year === curYear && row.month < curMonth) return true;
        if (row.year === curYear && row.month === curMonth && curDay >= bd) return true;
        return false;
      };
      const deferredUnaccrued = await db.select()
        .from(propertyMonthlyLedger)
        .where(and(
          inArray(propertyMonthlyLedger.contractId, landlordIds),
          isNull(propertyMonthlyLedger.accrualVoucherId),
          eq(propertyMonthlyLedger.usedPrepaidAccount, true),
        ));
      const dueDeferred = deferredUnaccrued.filter(r => isLandlordDue(r));
      if (dueDeferred.length > 0) {
        const lCurrCount = new Map<string, number>();
        for (const c of landlordContracts) {
          const cur = c.currency || "USD";
          lCurrCount.set(cur, (lCurrCount.get(cur) ?? 0) + 1);
        }
        const lBatchCurrency = [...lCurrCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
        await db.transaction(async (tx) => {
          // Recognize only the collected (deferred) portion — paidAmount, not expectedAmount.
          // Uncollected rent has no deferred account entry, so no recognition needed for it.
          const totalDeferred = dueDeferred.reduce(
            (s, r) => s + Math.min(Number(r.paidAmount), Number(r.expectedAmount)), 0
          );
          if (totalDeferred < 0.005) return; // nothing to recognize
          const incomeId = await findOrCreateLedgerAccount(tx, companyId, incomeAccountName, "Income", "RENT-INC", "Indirect Income");
          const deferredId = await findOrCreateLedgerAccount(tx, companyId, "Deferred Rent Revenue", "Liability", "DEF-RENT-REV");
          const months = [...new Set(dueDeferred.map(r => `${String(r.month).padStart(2,"0")}/${r.year}`))].sort();
          const periodLabel = months.length === 1 ? months[0] : `${months[0]}–${months[months.length-1]}`;
          const vDesc = `Deferred rent recognized - ${companyId} - ${periodLabel}`;
          const [v] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber: `DEF-RENT-REC-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
            voucherType: "Journal",
            voucherDate: new Date().toISOString().slice(0,10) as any,
            description: vDesc,
            totalAmount: String(totalDeferred),
            currency: lBatchCurrency,
            sourceModule: moduleParam as any,
          }).returning();
          // One debit line per row for only the deferred (collected) portion
          const debitEntries = dueDeferred
            .map(r => ({
              amount: Math.min(Number(r.paidAmount), Number(r.expectedAmount)),
              label: `${landlordUnitNames.get(r.unitId) ?? `unit${r.unitId}`} - ${String(r.month).padStart(2,"0")}/${r.year}`,
            }))
            .filter(e => e.amount > 0.005)
            .map(e => ({
              voucherId: v.id,
              ledgerAccountId: deferredId,
              debitAmount: e.amount.toFixed(2),
              creditAmount: "0",
              narration: `Deferred rent recognized - ${e.label}`,
            }));
          await tx.insert(voucherEntries).values([
            ...debitEntries,
            { voucherId: v.id, ledgerAccountId: incomeId, debitAmount: "0", creditAmount: totalDeferred.toFixed(2), narration: vDesc },
          ]);
          await tx.update(propertyMonthlyLedger)
            .set({ accrualVoucherId: v.id })
            .where(inArray(propertyMonthlyLedger.id, dueDeferred.map(r => r.id)));
        });
      }
    }
  } catch (e: any) {
    const detail = (e.message ?? String(e)).replace(/\n/g, " | ");
    console.error(`[ERP/rental] deferred recognition failed company ${companyId}: ${detail}`);
  }

  return { accrued, skipped: alreadyDone };
}

export function registerRentalRoutes(
  app: Express,
  module: RentalModule,
  urlPrefix: string,
  incomeAccountName: string,
  shopExpenseAccountName: string = "Rent Expense - Shops",
) {
  const tag = `[${module}/rental]`;

  // ── UNITS list ──
  app.get(`${urlPrefix}/units`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const unitType = (req.query.unitType as string) || "WAREHOUSE";

      await ensureMonthlyForCompany(companyId, module);

      // For ERP/FACTORY SHOP view: silently post any pending rent accruals on page load.
      // All due rows are combined into ONE journal voucher per run.
      // Fire-and-forget (errors are logged but do not block the response).
      if ((module === "ERP" || module === "FACTORY") && unitType === "SHOP") {
        postRentAccrualForCompany(companyId, shopExpenseAccountName, module, incomeAccountName).catch(e =>
          console.warn(`${tag} page-load accrual failed:`, e.message?.split("\n")[0]));
      }

      const regularUnits = await db.select().from(propertyUnits)
        .where(and(
          eq(propertyUnits.companyId, companyId),
          eq(propertyUnits.module, module),
          eq(propertyUnits.unitType, unitType),
          eq(propertyUnits.active, true),
        ))
        .orderBy(
          propertyUnits.locationGroup,
          propertyUnits.sortOrder,
          sql`NULLIF(regexp_replace(${propertyUnits.unitNumber}, '[^0-9]', '', 'g'), '')::bigint nulls last`,
          propertyUnits.unitNumber,
        );

      // When viewing SHOP type, also pull in any WAREHOUSE units that are marked as
      // "internal lease" (the company occupies its own warehouse) so they appear in both views.
      let internalWarehouseUnits: typeof regularUnits = [];
      if (unitType === "SHOP") {
        const allWarehouseUnits = await db.select().from(propertyUnits)
          .where(and(
            eq(propertyUnits.companyId, companyId),
            eq(propertyUnits.module, module),
            eq(propertyUnits.unitType, "WAREHOUSE"),
            eq(propertyUnits.active, true),
          ));
        if (allWarehouseUnits.length) {
          const internalContracts = await db.select().from(propertyContracts).where(and(
            eq(propertyContracts.companyId, companyId),
            eq(propertyContracts.module, module),
            inArray(propertyContracts.unitId, allWarehouseUnits.map(u => u.id)),
            eq(propertyContracts.status, "ACTIVE"),
            eq(propertyContracts.isInternal, true),
          ));
          const internalUnitIds = new Set(internalContracts.map(c => c.unitId));
          internalWarehouseUnits = allWarehouseUnits.filter(u => internalUnitIds.has(u.id));
        }
      }

      const units = [...regularUnits, ...internalWarehouseUnits];
      const unitIds = units.map(u => u.id);
      const contracts = unitIds.length
        ? await db.select().from(propertyContracts).where(and(
            eq(propertyContracts.companyId, companyId),
            eq(propertyContracts.module, module),
            inArray(propertyContracts.unitId, unitIds),
            eq(propertyContracts.status, "ACTIVE"),
          ))
        : [];
      const contractByUnit = new Map<number, typeof contracts[0]>();
      contracts.forEach(c => contractByUnit.set(c.unitId, c));

      const contractIds = contracts.map(c => c.id);
      const outstandingByContract = new Map<number, number>();
      const totalPaidByContract = new Map<number, number>();
      const guaranteeAppliedByContract = new Map<number, number>();
      if (contractIds.length > 0) {
        // Only count expectedAmount for months up to the current calendar month.
        // All paidAmount is counted regardless of month so advance payments create
        // a negative outstanding (credit) instead of silently zeroing out.
        const rows = await db.select({
          contractId: propertyMonthlyLedger.contractId,
          expected: sql<string>`COALESCE(SUM(
            CASE WHEN (
              ${propertyMonthlyLedger.year} < EXTRACT(YEAR FROM NOW())
              OR (
                ${propertyMonthlyLedger.year} = EXTRACT(YEAR FROM NOW())
                AND ${propertyMonthlyLedger.month} <= EXTRACT(MONTH FROM NOW())
              )
            ) THEN ${propertyMonthlyLedger.expectedAmount} ELSE 0 END
          ), 0)`,
          paid: sql<string>`COALESCE(SUM(${propertyMonthlyLedger.paidAmount}), 0)`,
        }).from(propertyMonthlyLedger)
          .where(inArray(propertyMonthlyLedger.contractId, contractIds))
          .groupBy(propertyMonthlyLedger.contractId);
        rows.forEach(r => {
          outstandingByContract.set(r.contractId, Number(r.expected) - Number(r.paid));
          totalPaidByContract.set(r.contractId, Number(r.paid));
        });

        // Sum payments tagged [Guarantee applied] to compute remaining guarantee
        const appliedRows = await db.select({
          contractId: propertyPayments.contractId,
          total: sql<string>`COALESCE(SUM(${propertyPayments.amount}), 0)`,
        }).from(propertyPayments)
          .where(and(
            inArray(propertyPayments.contractId, contractIds),
            sql`${propertyPayments.notes} LIKE '%[Guarantee applied]%'`,
          ))
          .groupBy(propertyPayments.contractId);
        appliedRows.forEach(r => guaranteeAppliedByContract.set(r.contractId, Number(r.total)));
      }

      const ownedResults = units.map(u => {
        const c = contractByUnit.get(u.id);
        const appliedAsRent = c ? (guaranteeAppliedByContract.get(c.id) ?? 0) : 0;
        const guaranteeRemaining = c
          ? Math.max(0, parseFloat(String(c.guaranteeAmount || "0")) - appliedAsRent)
          : null;
        return {
          ...u,
          contract: c ?? null,
          outstanding: c ? (outstandingByContract.get(c.id) ?? 0) : null,
          totalPaid: c ? (totalPaidByContract.get(c.id) ?? 0) : null,
          guaranteeRemaining,
          isShared: false,
          ownerCompanyName: null as string | null,
        };
      });

      // ── Shared contracts: contracts from OTHER companies that link to this company ──
      // Wrapped in its own try/catch — if the column hasn't been migrated yet this
      // gracefully returns [] so owned units always load.
      let sharedResults: typeof ownedResults = [];
      try {
        // Shared contracts (rented FROM another company) always appear in the Shops view only.
        // The owner may classify the unit differently in their system, so we ignore unitType
        // and pin shared units to the SHOP view to avoid them leaking into Warehouses.
        if (unitType === "SHOP") {
        const sharedContracts = await db.select().from(propertyContracts).where(and(
          eq(propertyContracts.linkedCompanyId, companyId),
          eq(propertyContracts.status, "ACTIVE"),
        ));

        if (sharedContracts.length > 0) {
          const sharedUnitIds = sharedContracts.map(c => c.unitId);
          // No unitType filter — show all shared contracts in the Shops view regardless of
          // how the owner classified the unit in their own system.
          const sharedUnits = await db.select().from(propertyUnits)
            .where(inArray(propertyUnits.id, sharedUnitIds));
          const sharedUnitMap = new Map(sharedUnits.map(u => [u.id, u]));

          const sharedContractIds = sharedContracts.map(c => c.id);
          const sharedLedgerRows = await db.select({
            contractId: propertyMonthlyLedger.contractId,
            expected: sql<string>`COALESCE(SUM(
              CASE WHEN (
                ${propertyMonthlyLedger.year} < EXTRACT(YEAR FROM NOW())
                OR (
                  ${propertyMonthlyLedger.year} = EXTRACT(YEAR FROM NOW())
                  AND ${propertyMonthlyLedger.month} <= EXTRACT(MONTH FROM NOW())
                )
              ) THEN ${propertyMonthlyLedger.expectedAmount} ELSE 0 END
            ), 0)`,
            paid: sql<string>`COALESCE(SUM(${propertyMonthlyLedger.paidAmount}), 0)`,
          }).from(propertyMonthlyLedger)
            .where(inArray(propertyMonthlyLedger.contractId, sharedContractIds))
            .groupBy(propertyMonthlyLedger.contractId);
          const sharedOutstanding = new Map<number, number>();
          const sharedPaid = new Map<number, number>();
          sharedLedgerRows.forEach(r => {
            sharedOutstanding.set(r.contractId, Number(r.expected) - Number(r.paid));
            sharedPaid.set(r.contractId, Number(r.paid));
          });

          // Fetch owner company names
          const ownerCompanyIds = [...new Set(sharedContracts.map(c => c.companyId))];
          const ownerCompanies = await db.select({ id: companies.id, name: companies.name })
            .from(companies)
            .where(inArray(companies.id, ownerCompanyIds));
          const ownerNameMap = new Map(ownerCompanies.map(c => [c.id, c.name]));

          // Sum [Guarantee applied] payments for shared contracts
          const sharedGuaranteeApplied = new Map<number, number>();
          const sharedAppliedRows = await db.select({
            contractId: propertyPayments.contractId,
            total: sql<string>`COALESCE(SUM(${propertyPayments.amount}), 0)`,
          }).from(propertyPayments)
            .where(and(
              inArray(propertyPayments.contractId, sharedContractIds),
              sql`${propertyPayments.notes} LIKE '%[Guarantee applied]%'`,
            ))
            .groupBy(propertyPayments.contractId);
          sharedAppliedRows.forEach(r => sharedGuaranteeApplied.set(r.contractId, Number(r.total)));

          sharedResults = sharedContracts.map(c => {
            const u = sharedUnitMap.get(c.unitId);
            if (!u) return null;
            const appliedAsRent = sharedGuaranteeApplied.get(c.id) ?? 0;
            const guaranteeRemaining = Math.max(0, parseFloat(String(c.guaranteeAmount || "0")) - appliedAsRent);
            return {
              ...u,
              contract: c,
              outstanding: sharedOutstanding.get(c.id) ?? 0,
              totalPaid: sharedPaid.get(c.id) ?? 0,
              guaranteeRemaining,
              isShared: true,
              ownerCompanyName: ownerNameMap.get(c.companyId) ?? null,
            };
          }).filter(Boolean) as typeof ownedResults;
        }
        } // end if (unitType === "SHOP")
      } catch (sharedErr: any) {
        // Column may not exist yet in production — owned units still load fine
        console.warn(`${tag} shared-units skipped:`, sharedErr.message?.split("\n")[0]);
      }

      res.json([...ownedResults, ...sharedResults]);
    } catch (e: any) {
      console.error(`${tag} units:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── CREATE unit ──
  app.post(`${urlPrefix}/units`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const data = insertPropertyUnitSchema.parse({ ...req.body, companyId });
      const [created] = await db.insert(propertyUnits).values({ ...data, module } as any).returning();
      await logAudit({ userId: req.session.userId!, username: (req.session as any).username || "unknown", companyId, action: "create", tableName: "property_units", recordId: created.id, recordIdentifier: created.unitNumber || String(created.id), changes: { unitNumber: { old: null, new: created.unitNumber } } });
      res.json(created);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── PATCH unit ──
  app.patch(`${urlPrefix}/units/:id`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const allowed = ["unitNumber", "size", "dimensions", "locationGroup", "notes", "sortOrder", "active"];
      const updates: any = {};
      for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
      const [updated] = await db.update(propertyUnits).set(updates)
        .where(and(eq(propertyUnits.id, id), eq(propertyUnits.companyId, companyId), eq(propertyUnits.module, module)))
        .returning();
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── DELETE unit ──
  app.delete(`${urlPrefix}/units/:id`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [active] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, module),
        eq(propertyContracts.unitId, id),
        eq(propertyContracts.status, "ACTIVE"),
      ));
      if (active) return res.status(400).json({ message: "Cannot delete: unit has active contract. End contract first." });
      await db.update(propertyUnits).set({ active: false })
        .where(and(eq(propertyUnits.id, id), eq(propertyUnits.companyId, companyId), eq(propertyUnits.module, module)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── START CONTRACT ──
  app.post(`${urlPrefix}/contracts`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const data = insertPropertyContractSchema.parse({ ...req.body, companyId });

      const [unit] = await db.select().from(propertyUnits).where(and(
        eq(propertyUnits.id, data.unitId),
        eq(propertyUnits.companyId, companyId),
        eq(propertyUnits.module, module),
      ));
      if (!unit) return res.status(404).json({ message: "Unit not found" });

      const [existing] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, module),
        eq(propertyContracts.unitId, data.unitId),
        eq(propertyContracts.status, "ACTIVE"),
      ));
      if (existing) return res.status(400).json({ message: "Unit already has an active contract" });

      const [created] = await db.insert(propertyContracts).values({ ...data, module } as any).returning();
      await ensureMonthlyLedgerRows(created.id);
      await logAudit({ userId: req.session.userId!, username: (req.session as any).username || "unknown", companyId, action: "create", tableName: "property_contracts", recordId: created.id, recordIdentifier: `Contract#${created.id} Unit#${created.unitId}`, changes: { unitId: { old: null, new: created.unitId }, rentalAmount: { old: null, new: created.rentalAmount }, startDate: { old: null, new: created.startDate } } });
      res.json(created);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      console.error(`${tag} contracts:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── MODIFY RENT ──
  app.patch(`${urlPrefix}/contracts/:id/rent`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { newAmount, effectiveFrom } = z.object({
        newAmount: z.union([z.string(), z.number()]).transform(v => String(v)),
        effectiveFrom: z.enum(["current", "next"]).default("current"),
      }).parse(req.body);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      await db.update(propertyContracts).set({ rentalAmount: newAmount }).where(eq(propertyContracts.id, id));

      const now = new Date();
      let y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
      if (effectiveFrom === "next") { m++; if (m > 12) { m = 1; y++; } }

      await db.execute(sql`
        UPDATE property_monthly_ledger
        SET expected_amount = ${newAmount}
        WHERE contract_id = ${id} AND paid_amount = 0
          AND ((year > ${y}) OR (year = ${y} AND month >= ${m}))
      `);
      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── EDIT CONTRACT INFO (tenant name + start date) ──
  app.patch(`${urlPrefix}/contracts/:id/info`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { tenantName, startDate, guaranteeAmount, guaranteePeriod, isInternal, linkedCompanyId } = z.object({
        tenantName: z.string().min(1, "Tenant name required"),
        startDate: z.string().min(1, "Start date required"),
        guaranteeAmount: z.string().optional(),
        guaranteePeriod: z.string().optional(),
        isInternal: z.boolean().optional(),
        linkedCompanyId: z.number().nullable().optional(),
      }).parse(req.body);
      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      const contractUpdates: any = { tenantName, startDate: startDate as any };
      if (guaranteeAmount !== undefined) contractUpdates.guaranteeAmount = guaranteeAmount;
      if (guaranteePeriod !== undefined) contractUpdates.guaranteePeriod = guaranteePeriod;
      if (isInternal !== undefined) contractUpdates.isInternal = isInternal;
      if (linkedCompanyId !== undefined) contractUpdates.linkedCompanyId = linkedCompanyId;
      await db.update(propertyContracts).set(contractUpdates).where(eq(propertyContracts.id, id));

      // Clean up ledger rows that are now before the new start date
      const newStart = new Date(startDate);
      const newStartYear = newStart.getUTCFullYear();
      const newStartMonth = newStart.getUTCMonth() + 1;

      // Delete rows before the new start date that have no payments (zero or null paidAmount)
      await db.execute(sql`
        DELETE FROM property_monthly_ledger
        WHERE contract_id = ${id}
          AND (year < ${newStartYear} OR (year = ${newStartYear} AND month < ${newStartMonth}))
          AND (paid_amount IS NULL OR paid_amount::numeric = 0)
      `);

      // Zero out expected amount for rows before the new start date that DO have payments
      // (they become pure credit entries rather than appearing as unpaid obligations)
      await db.execute(sql`
        UPDATE property_monthly_ledger
        SET expected_amount = 0
        WHERE contract_id = ${id}
          AND (year < ${newStartYear} OR (year = ${newStartYear} AND month < ${newStartMonth}))
          AND paid_amount::numeric > 0
      `);

      // Restore expected_amount for any paid months AT or AFTER the new start date
      // that were accidentally zeroed by a previous start-date change.
      // We set expected_amount = paid_amount so the month shows outstanding = $0
      // (the tenant paid what they owed; the zeroed expected was a data inconsistency).
      await db.execute(sql`
        UPDATE property_monthly_ledger
        SET expected_amount = paid_amount
        WHERE contract_id = ${id}
          AND (year > ${newStartYear} OR (year = ${newStartYear} AND month >= ${newStartMonth}))
          AND expected_amount::numeric = 0
          AND paid_amount::numeric > 0
      `);

      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── STATEMENT EXCEL EXPORT ──
  app.get(`${urlPrefix}/units/:id/statement/export`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const unitId = parseId(req.params.id);
      if (unitId === null) return res.status(400).json({ message: "Invalid id" });

      const [unit] = await db.select().from(propertyUnits).where(and(
        eq(propertyUnits.id, unitId), eq(propertyUnits.companyId, companyId), eq(propertyUnits.module, module),
      ));
      if (!unit) return res.status(404).json({ message: "Unit not found" });

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, module),
        eq(propertyContracts.unitId, unitId),
        eq(propertyContracts.status, "ACTIVE"),
      ));
      if (!contract) return res.status(404).json({ message: "No active contract" });

      await ensureMonthlyLedgerRows(contract.id);
      const ledger = await db.select().from(propertyMonthlyLedger)
        .where(eq(propertyMonthlyLedger.contractId, contract.id))
        .orderBy(propertyMonthlyLedger.year, propertyMonthlyLedger.month);
      const allPaymentsExport = await db.select().from(propertyPayments)
        .where(eq(propertyPayments.contractId, contract.id))
        .orderBy(desc(propertyPayments.paymentDate));
      const payments = allPaymentsExport.filter(
        p => p.ledgerRowId !== null && !(p.notes ?? "").includes("[Guarantee release]"),
      );
      const guaranteePaymentsExport = allPaymentsExport.filter(
        p => p.ledgerRowId === null || (p.notes ?? "").includes("[Guarantee release]"),
      );

      const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const fmtNum = (v: any) => Number(v || 0);

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "Rental Management";
      wb.created = new Date();

      const ws = wb.addWorksheet("Statement");
      ws.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } };

      const titleFont = { bold: true, size: 14 };
      const headerFont = { bold: true, size: 10 };
      const bodyFont = { size: 10 };
      const grayFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
      const blueFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A56DB" } };
      const totalFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };

      ws.columns = [
        { key: "month", width: 16 },
        { key: "expected", width: 16 },
        { key: "paid", width: 16 },
        { key: "outstanding", width: 16 },
        { key: "notes", width: 28 },
      ];

      // Title row
      const titleRow = ws.addRow(["RENTAL STATEMENT", "", "", "", ""]);
      ws.mergeCells(`A${titleRow.number}:E${titleRow.number}`);
      titleRow.getCell(1).font = { ...titleFont, color: { argb: "FFFFFFFF" } };
      titleRow.getCell(1).fill = blueFill;
      titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      titleRow.height = 28;

      // Info rows
      const addInfo = (label: string, value: string) => {
        const r = ws.addRow([label, value, "", "", ""]);
        ws.mergeCells(`B${r.number}:E${r.number}`);
        r.getCell(1).font = { bold: true, size: 10 };
        r.getCell(2).font = bodyFont;
        r.getCell(1).fill = grayFill;
        r.height = 16;
      };
      addInfo("Unit", `${unit.locationGroup} / ${unit.unitNumber}`);
      addInfo("Tenant", contract.tenantName);
      addInfo("Start Date", contract.startDate ? new Date(contract.startDate as any).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");
      addInfo("Monthly Rent", `$${fmtNum(contract.rentalAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      if (contract.guaranteeAmount && Number(contract.guaranteeAmount) > 0) {
        addInfo("Guarantee", `$${fmtNum(contract.guaranteeAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      }
      ws.addRow([]);

      // Table header
      const hdr = ws.addRow(["Month", "Expected ($)", "Paid ($)", "Outstanding ($)", "Notes"]);
      hdr.eachCell(c => {
        c.font = { ...headerFont, color: { argb: "FFFFFFFF" } };
        c.fill = blueFill;
        c.alignment = { horizontal: "center" };
        c.border = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
      });
      hdr.height = 18;

      // Data rows — only count expected for months up to today so advance payments show as credit
      const nowDate = new Date();
      const nowYear = nowDate.getUTCFullYear();
      const nowMonth = nowDate.getUTCMonth() + 1;
      let totalExpected = 0, totalPaid = 0;
      for (const row of ledger) {
        const isFutureRow = row.year > nowYear || (row.year === nowYear && row.month > nowMonth);
        const exp = isFutureRow ? 0 : fmtNum(row.expectedAmount);
        const paid = fmtNum(row.paidAmount);
        const out = exp - paid;
        totalExpected += exp; totalPaid += paid;
        const monthLabel = isFutureRow ? `${monthNames[row.month]} ${row.year} (prepaid)` : `${monthNames[row.month]} ${row.year}`;
        const r = ws.addRow([monthLabel, isFutureRow ? "" : exp, paid, out, row.notes || ""]);
        r.getCell(1).font = bodyFont;
        r.getCell(2).font = bodyFont; r.getCell(2).numFmt = "#,##0.00"; r.getCell(2).alignment = { horizontal: "right" };
        r.getCell(3).font = bodyFont; r.getCell(3).numFmt = "#,##0.00"; r.getCell(3).alignment = { horizontal: "right" };
        r.getCell(4).numFmt = "#,##0.00"; r.getCell(4).alignment = { horizontal: "right" };
        r.getCell(4).font = { ...bodyFont, color: { argb: out > 0 ? "FFCC0000" : out < 0 ? "FF006600" : "FF666666" } };
        r.getCell(5).font = { ...bodyFont, color: { argb: "FF666666" } };
        r.height = 15;
      }

      // Totals row
      const balance = totalExpected - totalPaid;
      const tot = ws.addRow(["TOTALS", totalExpected, totalPaid, balance, ""]);
      tot.eachCell((c, i) => {
        c.font = { bold: true, size: 10 };
        c.fill = totalFill;
        if (i >= 2 && i <= 4) { c.numFmt = "#,##0.00"; c.alignment = { horizontal: "right" }; }
        if (i === 4) c.font = { bold: true, size: 10, color: { argb: balance > 0 ? "FFCC0000" : balance < 0 ? "FF006600" : "FF000000" } };
      });
      tot.height = 18;

      if (contract.statementNote) {
        ws.addRow([]);
        const nr = ws.addRow(["NOTE:", contract.statementNote, "", "", ""]);
        ws.mergeCells(`B${nr.number}:E${nr.number}`);
        nr.getCell(1).font = { bold: true, size: 10 };
        nr.getCell(2).font = { italic: true, size: 10 };
        nr.getCell(2).alignment = { wrapText: true, vertical: "top" };
        nr.height = Math.max(18, Math.ceil(contract.statementNote.length / 60) * 15);
      }

      const addPaymentSection = (title: string, rows: typeof payments) => {
        if (rows.length === 0) return;
        ws.addRow([]);
        const ph = ws.addRow([title, "", "", "", ""]);
        ws.mergeCells(`A${ph.number}:E${ph.number}`);
        ph.getCell(1).font = { bold: true, size: 10 };
        ph.getCell(1).fill = grayFill;
        ph.height = 16;

        const ph2 = ws.addRow(["Date", "For", "Amount ($)", "Notes", ""]);
        ph2.eachCell(c => { c.font = headerFont; c.fill = grayFill; });
        ph2.height = 15;

        for (const p of rows) {
          const r = ws.addRow([
            new Date(p.paymentDate as any).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
            `${monthNames[p.forMonth]} ${p.forYear}`,
            Number(p.amount || 0),
            p.notes || "",
            "",
          ]);
          r.getCell(3).numFmt = "#,##0.00"; r.getCell(3).alignment = { horizontal: "right" };
          r.height = 15;
        }
      };

      addPaymentSection("RENT PAYMENT HISTORY", payments);
      addPaymentSection("GUARANTEE / DEPOSIT ACTIVITY", guaranteePaymentsExport);

      const filename = `Rental_${unit.unitNumber.replace(/\s+/g, "_")}_${contract.tenantName.replace(/\s+/g, "_")}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (e: any) {
      console.error(`${tag} statement export:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── UPDATE CONTRACT NOTE ──
  app.patch(`${urlPrefix}/contracts/:id/note`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { notes } = z.object({ notes: z.string() }).parse(req.body);
      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      await db.update(propertyContracts).set({ notes: notes || null }).where(eq(propertyContracts.id, id));
      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── SAVE STATEMENT NOTE ──
  app.patch(`${urlPrefix}/contracts/:id/statement-note`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { statementNote } = z.object({ statementNote: z.string() }).parse(req.body);
      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      await db.update(propertyContracts).set({ statementNote: statementNote || null }).where(eq(propertyContracts.id, id));
      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── END CONTRACT ──
  app.post(`${urlPrefix}/contracts/:id/end`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { endDate, notes, refundGuarantee, refundAmount, refundCashAccountId, refundNotes } = z.object({
        endDate: z.string().min(1),
        notes: z.string().optional(),
        refundGuarantee: z.boolean().optional().default(false),
        refundAmount: z.union([z.string(), z.number()]).transform(v => String(v)).optional(),
        refundCashAccountId: z.number().nullable().optional(),
        refundNotes: z.string().optional(),
      }).parse(req.body);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId));
      const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
      const tenantPays = module === "ERP" || module === "FACTORY";

      await db.transaction(async (tx) => {
        await tx.update(propertyContracts).set({
          status: "ENDED", endDate: endDate as any,
          notes: notes ? `${contract.notes ? contract.notes + "\n" : ""}END: ${notes}` : contract.notes,
        }).where(eq(propertyContracts.id, id));

        const end = new Date(endDate);
        const ey = end.getUTCFullYear(), em = end.getUTCMonth() + 1;
        await tx.execute(sql`
          DELETE FROM property_monthly_ledger
          WHERE contract_id = ${id} AND paid_amount = 0
            AND ((year > ${ey}) OR (year = ${ey} AND month > ${em}))
        `);

        // ── Optional: refund remaining guarantee to tenant ──
        if (refundGuarantee && refundAmount && parseFloat(refundAmount) > 0) {
          const amt = refundAmount;
          const dateStr = endDate;
          const narration = refundNotes
            ? `Guarantee refund on departure - ${unitLabel} - ${refundNotes}`
            : `Guarantee refund on departure - ${unitLabel}`;

          if (refundCashAccountId) {
            if (tenantPays) {
              // Tenant gets guarantee back: Dr Security Deposits Paid (asset↓) / Cr Cash (we return money)
              // Actually: landlord returns money to tenant — Dr Cash reversal: Cr Cash / Dr Sec Dep Paid
              // We PAID the guarantee as an asset (Sec Dep Paid debit). Refund: Dr Cash received back / Cr Sec Dep Paid cleared
              const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Security Deposits Paid", "Asset", "SEC-DEP-PAID");
              const [v] = await tx.insert(vouchers).values({
                companyId, voucherNumber: `GUAR-REFUND-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
                voucherType: "Receipt", voucherDate: dateStr as any,
                description: narration, totalAmount: amt, currency: contract.currency || "USD", sourceModule: "ERP",
              }).returning();
              await tx.insert(voucherEntries).values([
                { voucherId: v.id, ledgerAccountId: refundCashAccountId, debitAmount: amt,  creditAmount: "0",  narration },
                { voucherId: v.id, ledgerAccountId: depositAccountId,    debitAmount: "0",  creditAmount: amt, narration },
              ]);
            } else {
              // Landlord returns deposit to departing tenant: Dr Tenant Deposits (liability↓) / Cr Cash (we pay out)
              const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Tenant Deposits", "Liability", "TENANT-DEP");
              const [v] = await tx.insert(vouchers).values({
                companyId, voucherNumber: `GUAR-REFUND-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
                voucherType: "Payment", voucherDate: dateStr as any,
                description: narration, totalAmount: amt, currency: contract.currency || "USD", sourceModule: "ERP",
              }).returning();
              await tx.insert(voucherEntries).values([
                { voucherId: v.id, ledgerAccountId: depositAccountId,    debitAmount: amt,  creditAmount: "0",  narration },
                { voucherId: v.id, ledgerAccountId: refundCashAccountId, debitAmount: "0",  creditAmount: amt, narration },
              ]);
            }
          }

          // Record in payments log as a guarantee activity (ledgerRowId: null so it shows in guarantee section)
          await tx.insert(propertyPayments).values({
            companyId, module, contractId: contract.id, unitId: contract.unitId,
            ledgerRowId: null,
            cashAccountId: refundCashAccountId ?? null,
            voucherId: null,
            amount: amt,
            paymentDate: dateStr as any,
            forYear: new Date(dateStr).getUTCFullYear(),
            forMonth: new Date(dateStr).getUTCMonth() + 1,
            notes: `[Guarantee refund] ${narration}`,
          });
        }
      });

      await logAudit({ userId: req.session.userId!, username: (req.session as any).username || "unknown", companyId, action: "update", tableName: "property_contracts", recordId: id, recordIdentifier: `Contract#${id}`, changes: { status: { old: "ACTIVE", new: "ENDED" }, endDate: { old: null, new: endDate } } });
      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── GUARANTEE TO STATEMENT ──
  app.post(`${urlPrefix}/contracts/:id/guarantee-to-statement`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { amount, cashAccountId, paymentDate, notes } = z.object({
        amount: z.union([z.string(), z.number()]).transform(v => String(v)),
        cashAccountId: z.number().nullable().optional(),
        paymentDate: z.string().optional(),
        notes: z.string().optional(),
      }).parse(req.body);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId));
      const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
      const dateStr = paymentDate || getClientDate(req);

      await db.transaction(async (tx) => {
        await tx.update(propertyContracts).set({
          guaranteePostedToStatement: true,
          guaranteePostedAmount: amount,
          notes: notes ? `${contract.notes ? contract.notes + "\n" : ""}GUARANTEE→STMT: ${amount} (${notes})` : contract.notes,
        }).where(eq(propertyContracts.id, id));

        if (cashAccountId) {
          const tenantPays = module === "ERP" || module === "FACTORY";
          if (tenantPays) {
            // Tenant perspective: company PAYS the guarantee out — Dr Security Deposits Paid (Asset) / Cr Cash
            const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Security Deposits Paid", "Asset", "SEC-DEP-PAID");
            const narration = `Guarantee paid - ${unitLabel}`;
            const [v] = await tx.insert(vouchers).values({
              companyId, voucherNumber: `GUAR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
              voucherType: "Payment", voucherDate: dateStr as any,
              description: narration, totalAmount: amount, currency: contract.currency || "USD", sourceModule: "ERP",
            }).returning();
            await tx.insert(voucherEntries).values([
              { voucherId: v.id, ledgerAccountId: depositAccountId, debitAmount: amount, creditAmount: "0", narration },
              { voucherId: v.id, ledgerAccountId: cashAccountId, debitAmount: "0", creditAmount: amount, narration },
            ]);
          } else {
            // Landlord perspective: company RECEIVES the guarantee — Dr Cash / Cr Tenant Deposits (Liability)
            const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Tenant Deposits", "Liability", "TENANT-DEP");
            const narration = `Guarantee deposit - ${unitLabel}`;
            const [v] = await tx.insert(vouchers).values({
              companyId, voucherNumber: `GUAR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
              voucherType: "Receipt", voucherDate: dateStr as any,
              description: narration, totalAmount: amount, currency: contract.currency || "USD", sourceModule: "ERP",
            }).returning();
            await tx.insert(voucherEntries).values([
              { voucherId: v.id, ledgerAccountId: cashAccountId, debitAmount: amount, creditAmount: "0", narration },
              { voucherId: v.id, ledgerAccountId: depositAccountId, debitAmount: "0", creditAmount: amount, narration },
            ]);
          }
        }
      });

      // Fire auto-transfer if configured (only for landlord receiving cash)
      if (cashAccountId && !(module === "ERP" || module === "FACTORY")) {
        await maybeRunAutoTransfer(companyId, module, cashAccountId, amount, dateStr, unitLabel, undefined, notes);
      }

      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── RESET GUARANTEE STATUS (undo "post to statement") ──
  app.delete(`${urlPrefix}/contracts/:id/guarantee-to-statement`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      await db.update(propertyContracts)
        .set({ guaranteePostedToStatement: false })
        .where(eq(propertyContracts.id, id));

      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GUARANTEE TO CASH (release / apply guarantee deposit) ──
  app.post(`${urlPrefix}/contracts/:id/guarantee-to-cash`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { amount, cashAccountId, paymentDate, notes } = z.object({
        amount: z.union([z.string(), z.number()]).transform(v => String(v)),
        cashAccountId: z.number(),
        paymentDate: z.string().optional(),
        notes: z.string().optional(),
      }).parse(req.body);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId));
      const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
      const dateStr = paymentDate || getClientDate(req);

      const tenantPays = module === "ERP" || module === "FACTORY";
      let voucherId: number | null = null;
      await db.transaction(async (tx) => {
        const narration = notes
          ? `Guarantee moved to cash - ${unitLabel} - ${notes}`
          : `Guarantee moved to cash - ${unitLabel}`;
        const [v] = await tx.insert(vouchers).values({
          companyId, voucherNumber: `GUAR-CASH-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
          voucherType: "Journal", voucherDate: dateStr as any,
          description: narration, totalAmount: amount, currency: "USD", sourceModule: "ERP",
        }).returning();
        voucherId = v.id;
        if (tenantPays) {
          // Tenant perspective: company RECOVERS the guarantee back as cash — Dr Cash / Cr Security Deposits Paid (Asset)
          const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Security Deposits Paid", "Asset", "SEC-DEP-PAID");
          await tx.insert(voucherEntries).values([
            { voucherId: v.id, ledgerAccountId: cashAccountId,   debitAmount: amount, creditAmount: "0",   narration },
            { voucherId: v.id, ledgerAccountId: depositAccountId, debitAmount: "0",   creditAmount: amount, narration },
          ]);
        } else {
          // Landlord perspective: deposit moves into cash — Dr Cash / Cr Tenant Deposits (Liability)
          // Auto-transfer then debits Transfer Clearing and credits Cash, netting the cashbox to zero.
          const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Tenant Deposits", "Liability", "TENANT-DEP");
          await tx.insert(voucherEntries).values([
            { voucherId: v.id, ledgerAccountId: cashAccountId,   debitAmount: amount, creditAmount: "0",   narration },
            { voucherId: v.id, ledgerAccountId: depositAccountId, debitAmount: "0",   creditAmount: amount, narration },
          ]);
        }
        // Mark guarantee as paid on the contract
        await tx.update(propertyContracts)
          .set({ guaranteePostedToStatement: true, guaranteePostedAmount: amount })
          .where(eq(propertyContracts.id, id));
      });

      // Record in payments log so it's visible in cash flow / payments history
      const pd = new Date(dateStr);
      const [savedPayment] = await db.insert(propertyPayments).values({
        companyId, module, contractId: contract.id, unitId: contract.unitId,
        ledgerRowId: null, cashAccountId, voucherId,
        amount, paymentDate: dateStr as any,
        forYear: pd.getUTCFullYear(), forMonth: pd.getUTCMonth() + 1,
        notes: notes ? `[Guarantee release] ${notes}` : `[Guarantee release] ${unitLabel}`,
      }).returning();

      // Fire auto-transfer if configured — pass the payment ID so deletion can reverse both sides
      await maybeRunAutoTransfer(companyId, module, cashAccountId, amount, dateStr, unitLabel, savedPayment?.id, notes);

      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── APPLY GUARANTEE AS RENT ──
  // No cash changes hands — Dr Tenant Deposits (or Sec Dep Paid) / Cr Rent Income (or Rent Expense)
  app.post(`${urlPrefix}/contracts/:id/guarantee-to-rent`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const { amount, paymentDate, notes } = z.object({
        amount: z.union([z.string(), z.number()]).transform(v => String(v)),
        paymentDate: z.string().min(1),
        notes: z.string().optional(),
      }).parse(req.body);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id),
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      await ensureMonthlyLedgerRows(contract.id);

      const pd = new Date(paymentDate);
      const y = pd.getUTCFullYear(), m = pd.getUTCMonth() + 1;
      const totalAmountNum = parseFloat(amount);
      const rentalAmountNum = parseFloat(contract.rentalAmount as string);

      const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId));
      const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
      const isShop = unit?.unitType === "SHOP";
      const tenantPays = module === "ERP" || module === "FACTORY";

      const allocations = await buildAllocations(contract.id, y, m, totalAmountNum, rentalAmountNum);
      if (!allocations.length) return res.status(400).json({ message: "No outstanding rent to apply the guarantee to for that period." });

      await db.transaction(async (tx) => {
        // Ensure a ledger row exists for every allocated month
        for (const alloc of allocations) {
          await tx.insert(propertyMonthlyLedger).values({
            companyId, module, contractId: contract.id, unitId: contract.unitId,
            year: alloc.year, month: alloc.month,
            expectedAmount: contract.rentalAmount, paidAmount: "0",
          }).onConflictDoNothing({
            target: [propertyMonthlyLedger.contractId, propertyMonthlyLedger.year, propertyMonthlyLedger.month],
          });
        }

        const monthSpan = allocations.length > 1
          ? `${String(allocations[0].month).padStart(2,"0")}/${allocations[0].year} – ${String(allocations[allocations.length-1].month).padStart(2,"0")}/${allocations[allocations.length-1].year}`
          : `${String(m).padStart(2,"0")}/${y}`;
        const narration = notes
          ? `Guarantee applied to rent - ${unitLabel} - ${monthSpan} - ${notes}`
          : `Guarantee applied to rent - ${unitLabel} - ${monthSpan}`;

        // Journal: no cash account involved
        let voucherId: number;
        if (tenantPays && isShop) {
          // Tenant/shop pays rent: Dr Rent Expense - Shops (expense↑) / Cr Security Deposits Paid (asset↓)
          const expenseAccountId = await findOrCreateLedgerAccount(tx, companyId, shopExpenseAccountName, "Indirect Expense", "SHOP-RENT-EXP");
          const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Security Deposits Paid", "Asset", "SEC-DEP-PAID");
          const [v] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber: `GUAR-RENT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
            voucherType: "Journal",
            voucherDate: paymentDate as any,
            description: narration, totalAmount: amount, currency: "USD", sourceModule: "ERP",
          }).returning();
          voucherId = v.id;
          await tx.insert(voucherEntries).values([
            { voucherId: v.id, ledgerAccountId: expenseAccountId,  debitAmount: amount, creditAmount: "0",  narration },
            { voucherId: v.id, ledgerAccountId: depositAccountId,  debitAmount: "0",  creditAmount: amount, narration },
          ]);
        } else if (tenantPays) {
          // Non-shop tenant: Dr Rent Expense / Cr Security Deposits Paid
          const expenseAccountId = await findOrCreateLedgerAccount(tx, companyId, incomeAccountName, "Indirect Expense", "RENT-EXP");
          const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Security Deposits Paid", "Asset", "SEC-DEP-PAID");
          const [v] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber: `GUAR-RENT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
            voucherType: "Journal",
            voucherDate: paymentDate as any,
            description: narration, totalAmount: amount, currency: "USD", sourceModule: "ERP",
          }).returning();
          voucherId = v.id;
          await tx.insert(voucherEntries).values([
            { voucherId: v.id, ledgerAccountId: expenseAccountId, debitAmount: amount, creditAmount: "0",  narration },
            { voucherId: v.id, ledgerAccountId: depositAccountId, debitAmount: "0", creditAmount: amount, narration },
          ]);
        } else {
          // Landlord: Dr Tenant Deposits (liability↓) / Cr Rent Income (income↑)
          const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Tenant Deposits", "Liability", "TENANT-DEP");
          const incomeAccId = await findOrCreateLedgerAccount(tx, companyId, incomeAccountName, "Income", "RENT-INC", "Indirect Income");
          const [v] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber: `GUAR-RENT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
            voucherType: "Journal",
            voucherDate: paymentDate as any,
            description: narration, totalAmount: amount, currency: "USD", sourceModule: "ERP",
          }).returning();
          voucherId = v.id;
          await tx.insert(voucherEntries).values([
            { voucherId: v.id, ledgerAccountId: depositAccountId, debitAmount: amount, creditAmount: "0",  narration },
            { voucherId: v.id, ledgerAccountId: incomeAccId,      debitAmount: "0",  creditAmount: amount, narration },
          ]);
        }

        // Create one payment row per allocated month and update ledger
        for (const alloc of allocations) {
          const [row] = await tx.select().from(propertyMonthlyLedger).where(and(
            eq(propertyMonthlyLedger.contractId, contract.id),
            eq(propertyMonthlyLedger.year, alloc.year),
            eq(propertyMonthlyLedger.month, alloc.month),
          ));
          await tx.insert(propertyPayments).values({
            companyId, module, contractId: contract.id, unitId: contract.unitId,
            ledgerRowId: row.id,
            cashAccountId: null,
            voucherId,
            amount: alloc.chunk,
            paymentDate: paymentDate as any,
            forYear: alloc.year, forMonth: alloc.month,
            notes: allocations.length > 1
              ? `[Guarantee applied] ${narration} | Split from ${amount}`
              : `[Guarantee applied] ${narration}`,
          }).returning();
          await tx.execute(sql`
            UPDATE property_monthly_ledger SET paid_amount = paid_amount + ${alloc.chunk}::numeric WHERE id = ${row.id}
          `);
        }

        // guarantee_posted_amount is only managed by "Post to Statement" / "Move to Cash".
        // Applied-as-rent amounts are tracked via payment records ([Guarantee applied] notes).
      });

      res.json({ ok: true, allocations });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── UNDO GUARANTEE APPLIED AS RENT ──
  // Reverses every "[Guarantee applied]" payment on a contract: restores ledger
  // paid_amounts, soft-deletes accounting vouchers, removes inter-company
  // transfers, and resets the contract's guaranteePostedAmount.
  app.post(`${urlPrefix}/contracts/:id/undo-guarantee-as-rent`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id),
        eq(propertyContracts.companyId, companyId),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      // Find all guarantee-applied payments for this contract
      const appliedPayments = await db.select().from(propertyPayments).where(and(
        eq(propertyPayments.contractId, id),
        eq(propertyPayments.companyId, companyId),
        sql`${propertyPayments.notes} LIKE '%[Guarantee applied]%'`,
      ));

      if (appliedPayments.length === 0) {
        return res.json({ ok: true, reversed: 0, message: "No guarantee-applied payments found" });
      }

      let totalReversed = 0;

      await db.transaction(async tx => {
        for (const payment of appliedPayments) {
          // 1. Reverse the monthly ledger paid_amount
          if (payment.ledgerRowId) {
            await tx.execute(sql`
              UPDATE property_monthly_ledger
              SET paid_amount = GREATEST(0, paid_amount - ${payment.amount}::numeric)
              WHERE id = ${payment.ledgerRowId}
            `);
          }

          // 2. Soft-delete the voucher only if no other payment shares it
          if (payment.voucherId) {
            const siblings = await tx.select({ id: propertyPayments.id })
              .from(propertyPayments)
              .where(and(
                eq(propertyPayments.voucherId, payment.voucherId),
                sql`${propertyPayments.id} != ${payment.id}`,
              ));
            if (siblings.length === 0) {
              await tx.execute(sql`UPDATE vouchers SET deleted_at = NOW() WHERE id = ${payment.voucherId}`);
            }
          }

          // 3. Reverse any auto-transfers created for this payment
          const linkedTransfers = await tx.select()
            .from(interCompanyTransfers)
            .where(eq(interCompanyTransfers.sourcePaymentId, payment.id));
          for (const transfer of linkedTransfers) {
            await tx.delete(interCompanyTransfers).where(eq(interCompanyTransfers.id, transfer.id));
            if (transfer.fromVoucherId) {
              await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, transfer.fromVoucherId));
              await tx.delete(vouchers).where(eq(vouchers.id, transfer.fromVoucherId));
            }
            if (transfer.toVoucherId) {
              await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, transfer.toVoucherId));
              await tx.delete(vouchers).where(eq(vouchers.id, transfer.toVoucherId));
            }
          }

          // 4. Delete the payment row
          await tx.delete(propertyPayments).where(eq(propertyPayments.id, payment.id));
          totalReversed++;
        }

        // guarantee_posted_amount is only managed by "Post to Statement" / "Move to Cash".
        // Applied-as-rent amounts are tracked via payment records ([Guarantee applied] notes).
      });

      res.json({ ok: true, reversed: totalReversed });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── RECORD PAYMENT ──
  app.post(`${urlPrefix}/payments`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const data = z.object({
        contractId: z.number(),
        cashAccountId: z.number().nullable().optional(),
        amount: z.union([z.string(), z.number()]).transform(v => String(v)),
        paymentDate: z.string().min(1),
        notes: z.string().optional(),
        currency: z.string().optional().default("USD"),
        exchangeRate: z.union([z.string(), z.number()]).transform(v => String(v)).optional().default("1"),
      }).parse(req.body);

      let isSharedPayment = false;
      let [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, data.contractId),
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, module),
      ));
      // If not found as owner, check if it's a shared contract linked to this company
      if (!contract) {
        const [sharedContract] = await db.select().from(propertyContracts).where(and(
          eq(propertyContracts.id, data.contractId),
          eq(propertyContracts.linkedCompanyId, companyId),
          eq(propertyContracts.status, "ACTIVE"),
        ));
        if (sharedContract) { contract = sharedContract; isSharedPayment = true; }
      }
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      // For shared contracts, ledger/payment rows use the source company's ID;
      // vouchers use the caller's companyId (the tenant paying cash).
      const contractCompanyId = isSharedPayment ? contract.companyId : companyId;

      await ensureMonthlyLedgerRows(contract.id);

      const pd = new Date(data.paymentDate);
      const payYear = pd.getUTCFullYear(), payMonth = pd.getUTCMonth() + 1;

      const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId));

      // ── Build monthly allocations ──────────────────────────────────────────
      // Always start from the oldest outstanding past/current month so that
      // overdue months are filled before current or future months.
      const totalAmountNum = parseFloat(data.amount);
      const rentalAmountNum = parseFloat(contract.rentalAmount as string);
      const { year: y, month: m } = await findEarliestOutstandingMonth(contract.id, payYear, payMonth);
      const allocations = await buildAllocations(contract.id, y, m, totalAmountNum, rentalAmountNum);

      const payments = await db.transaction(async (tx) => {
        // Ensure a ledger row exists for every allocated month
        for (const alloc of allocations) {
          await tx.insert(propertyMonthlyLedger).values({
            companyId: contractCompanyId, module, contractId: contract.id, unitId: contract.unitId,
            year: alloc.year, month: alloc.month,
            expectedAmount: contract.rentalAmount, paidAmount: "0",
          }).onConflictDoNothing({
            target: [propertyMonthlyLedger.contractId, propertyMonthlyLedger.year, propertyMonthlyLedger.month],
          });
        }

        // Create ONE voucher for the full payment total
        let voucherId: number | null = null;
        if (data.cashAccountId) {
          // Both owned SHOP units AND shared units represent rent HADI pays outward as a tenant
          // (expense — Dr Rent Expense / Cr Cash → Payment voucher).
          // Shared units are rented FROM Hassan Properties, so HADI is paying OUT, not collecting.
          const isShop = isSharedPayment || unit?.unitType === "SHOP";
          const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
          const monthSpan = allocations.length > 1
            ? `${String(allocations[0].month).padStart(2,"0")}/${allocations[0].year} – ${String(allocations[allocations.length-1].month).padStart(2,"0")}/${allocations[allocations.length-1].year}`
            : `${String(m).padStart(2,"0")}/${y}`;

          const voucherCurrency = data.currency || "USD";
          if (isShop) {
            // Simple direct posting: Dr Rent Expense / Cr Cash for the full amount.
            // No accrual/prepaid/advance splitting — the expense is recognised at payment time.
            const narration = `Rent paid - ${unitLabel} - ${monthSpan}`;
            const [v] = await tx.insert(vouchers).values({
              companyId, voucherNumber: `RENT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${contract.id}`,
              voucherType: "Payment", voucherDate: data.paymentDate as any,
              description: narration, totalAmount: data.amount, currency: voucherCurrency, sourceModule: "ERP",
            }).returning();
            voucherId = v.id;

            const expenseId = await findOrCreateLedgerAccount(tx, companyId, rentExpenseAccountName, "Indirect Expense", "SHOP-RENT-EXP");
            await tx.insert(voucherEntries).values([
              { voucherId: v.id, ledgerAccountId: expenseId,          debitAmount: data.amount, creditAmount: "0", narration },
              { voucherId: v.id, ledgerAccountId: data.cashAccountId, debitAmount: "0", creditAmount: data.amount, narration },
            ]);
          } else {
            const incomeAccountId = await findOrCreateLedgerAccount(tx, companyId, incomeAccountName, "Income", "RENT-INC", "Indirect Income");
            const narration = `Rent received - ${unitLabel} - ${monthSpan}`;
            const [v] = await tx.insert(vouchers).values({
              companyId, voucherNumber: `RENT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${contract.id}`,
              voucherType: "Receipt", voucherDate: data.paymentDate as any,
              description: narration, totalAmount: data.amount, currency: voucherCurrency, sourceModule: "ERP",
            }).returning();
            voucherId = v.id;
            // Split: future months → Deferred Rent Revenue; due months → Rent Income
            const futureAllocsL = allocations.filter(a => a.year > payYear || (a.year === payYear && a.month > payMonth));
            const deferredChunkL = futureAllocsL.reduce((s, a) => s + Number(a.chunk), 0);
            const earnedChunkL = parseFloat(data.amount) - deferredChunkL;
            const lEntries: any[] = [
              { voucherId: v.id, ledgerAccountId: data.cashAccountId, debitAmount: data.amount, creditAmount: "0", narration },
            ];
            if (earnedChunkL > 0.005) {
              lEntries.push({ voucherId: v.id, ledgerAccountId: incomeAccountId, debitAmount: "0", creditAmount: earnedChunkL.toFixed(2), narration });
            }
            if (deferredChunkL > 0.005) {
              const deferredId = await findOrCreateLedgerAccount(tx, companyId, "Deferred Rent Revenue", "Liability", "DEF-RENT-REV");
              lEntries.push({ voucherId: v.id, ledgerAccountId: deferredId, debitAmount: "0", creditAmount: deferredChunkL.toFixed(2), narration });
            }
            await tx.insert(voucherEntries).values(lEntries);

            // ── Intercompany mirror voucher for the source (Properties) company ──
            // When HADI L'SHI collects rent on a shared unit, Hassan Properties also
            // books the income with a matching intercompany payable:
            //
            //   Hassan Properties journal:
            //     Dr  HADI L'SHI — Intercompany  (Properties owes HADI the cash it collected)
            //     Cr  Rental Income - Properties
            //
            //   HADI L'SHI journal (separate, so HADI's receipt stays balanced):
            //     Dr  Hassan Properties — Intercompany  (HADI is owed by Properties)
            //     Cr  Rental Income - ERP  (reclass: the income belongs to Properties, not HADI)
            //
            // The two intercompany accounts net to zero across both companies.
            if (isSharedPayment) {
              const sourceCompanyId = contract.companyId; // Hassan Properties (13)

              // ── HADI L'SHI intercompany account (Asset — Properties owes HADI) ──
              const hadiIntercoId = await findOrCreateLedgerAccount(
                tx, companyId,
                "Hassan Properties — Intercompany",
                "Intercompany",
                "PROP-IC",
                "hadi_prop_intercompany",
              );
              // ── Hassan Properties intercompany account (Liability — owes HADI) ──
              const propIntercoId = await findOrCreateLedgerAccount(
                tx, sourceCompanyId,
                "HADI L'SHI — Intercompany",
                "Intercompany",
                "HADI-IC",
                "prop_hadi_intercompany",
              );
              // ── Hassan Properties rental income account ──
              const propIncomeId = await findOrCreateLedgerAccount(
                tx, sourceCompanyId,
                "Rental Income - Properties",
                "Income",
                "RENT-INC",
                "Indirect Income",
              );

              const icNarration = `Rent collected by HADI L'SHI - ${unitLabel} - ${monthSpan}`;

              // HADI reclass journal: Dr Rental Income (reverse HADI's own income) / Cr Interco (HADI is owed by Properties)
              // This leaves HADI with: Dr Cash / Cr Interco Receivable — a clean collection on behalf of Properties.
              const [hadiIcV] = await tx.insert(vouchers).values({
                companyId,
                voucherNumber: `RENT-IC-H-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${contract.id}`,
                voucherType: "Journal", voucherDate: data.paymentDate as any,
                description: icNarration, totalAmount: data.amount, currency: voucherCurrency, sourceModule: "ERP",
              }).returning();
              await tx.insert(voucherEntries).values([
                { voucherId: hadiIcV.id, ledgerAccountId: incomeAccountId, debitAmount: data.amount, creditAmount: "0", narration: icNarration },
                { voucherId: hadiIcV.id, ledgerAccountId: hadiIntercoId,   debitAmount: "0", creditAmount: data.amount, narration: icNarration },
              ]);

              // Hassan Properties income journal: Dr Interco (liability) / Cr Rental Income
              const [propV] = await tx.insert(vouchers).values({
                companyId: sourceCompanyId,
                voucherNumber: `RENT-IC-P-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${contract.id}`,
                voucherType: "Journal", voucherDate: data.paymentDate as any,
                description: icNarration, totalAmount: data.amount, currency: voucherCurrency, sourceModule: "PROPERTIES",
              }).returning();
              await tx.insert(voucherEntries).values([
                { voucherId: propV.id, ledgerAccountId: propIntercoId, debitAmount: data.amount, creditAmount: "0", narration: icNarration },
                { voucherId: propV.id, ledgerAccountId: propIncomeId,  debitAmount: "0", creditAmount: data.amount, narration: icNarration },
              ]);
            }
          }
        }

        // Create one payment row per allocated month and update that month's ledger
        const created: (typeof propertyPayments.$inferSelect)[] = [];
        for (const alloc of allocations) {
          const [row] = await tx.select().from(propertyMonthlyLedger).where(and(
            eq(propertyMonthlyLedger.contractId, contract.id),
            eq(propertyMonthlyLedger.year, alloc.year),
            eq(propertyMonthlyLedger.month, alloc.month),
          ));

          const isFutureAlloc = alloc.year > payYear || (alloc.year === payYear && alloc.month > payMonth);

          const [p] = await tx.insert(propertyPayments).values({
            companyId: contractCompanyId, module, contractId: contract.id, unitId: contract.unitId,
            ledgerRowId: row.id,
            cashAccountId: data.cashAccountId ?? null,
            // All split rows share the same voucherId (one financial transaction)
            voucherId: voucherId ?? null,
            amount: alloc.chunk,
            paymentDate: data.paymentDate as any,
            forYear: alloc.year, forMonth: alloc.month,
            currency: data.currency || "USD",
            exchangeRate: data.exchangeRate || "1",
            notes: allocations.length > 1
              ? `${data.notes ? data.notes + " | " : ""}Split from ${data.amount} payment`
              : (data.notes ?? null),
          }).returning();
          created.push(p);

          await tx.execute(sql`
            UPDATE property_monthly_ledger SET paid_amount = paid_amount + ${alloc.chunk}::numeric WHERE id = ${row.id}
          `);
        }
        return created;
      });

      // Fire auto-transfer if configured (outside transaction — best-effort, use total amount)
      if (data.cashAccountId) {
        const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
        await maybeRunAutoTransfer(companyId, module, data.cashAccountId, data.amount, data.paymentDate, unitLabel, payments[0].id, data.notes);
      }

      res.json(payments[0]);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      console.error(`${tag} payments:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── BULK PAYMENTS ──
  app.post(`${urlPrefix}/payments/bulk`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const items = z.array(z.object({
        contractId: z.number(),
        cashAccountId: z.number().nullable().optional(),
        amount: z.union([z.string(), z.number()]).transform(v => String(v)),
        paymentDate: z.string().min(1),
        notes: z.string().optional(),
        currency: z.string().optional().default("USD"),
        exchangeRate: z.union([z.string(), z.number()]).transform(v => String(v)).optional().default("1"),
      })).min(1).parse(req.body);

      const results: any[] = [];
      for (const data of items) {
        const [contract] = await db.select().from(propertyContracts).where(and(
          eq(propertyContracts.id, data.contractId),
          eq(propertyContracts.companyId, companyId),
          eq(propertyContracts.module, module),
        ));
        if (!contract) { results.push({ contractId: data.contractId, error: "Contract not found" }); continue; }

        await ensureMonthlyLedgerRows(contract.id);

        const pd = new Date(data.paymentDate);
        const payYear = pd.getUTCFullYear(), payMonth = pd.getUTCMonth() + 1;
        const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId));

        const totalAmountNum = parseFloat(data.amount);
        const rentalAmountNum = parseFloat(contract.rentalAmount as string);
        // Always start from the oldest outstanding past/current month
        const { year: y, month: m } = await findEarliestOutstandingMonth(contract.id, payYear, payMonth);
        const allocations = await buildAllocations(contract.id, y, m, totalAmountNum, rentalAmountNum);

        const payments = await db.transaction(async (tx) => {
          for (const alloc of allocations) {
            await tx.insert(propertyMonthlyLedger).values({
              companyId, module, contractId: contract.id, unitId: contract.unitId,
              year: alloc.year, month: alloc.month,
              expectedAmount: contract.rentalAmount, paidAmount: "0",
            }).onConflictDoNothing({
              target: [propertyMonthlyLedger.contractId, propertyMonthlyLedger.year, propertyMonthlyLedger.month],
            });
          }

          let voucherId: number | null = null;
          if (data.cashAccountId) {
            const isShop = unit?.unitType === "SHOP";
            const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
            const monthSpan = allocations.length > 1
              ? `${String(allocations[0].month).padStart(2,"0")}/${allocations[0].year} – ${String(allocations[allocations.length-1].month).padStart(2,"0")}/${allocations[allocations.length-1].year}`
              : `${String(m).padStart(2,"0")}/${y}`;

            const voucherCurrency = data.currency || "USD";
            if (isShop) {
              // Simple direct posting: Dr Rent Expense / Cr Cash for the full amount.
              const narration = `Rent paid - ${unitLabel} - ${monthSpan}`;
              const [v] = await tx.insert(vouchers).values({
                companyId, voucherNumber: `RENT-${Date.now()}-${Math.random().toString(36).slice(2,7)}-${contract.id}`,
                voucherType: "Payment", voucherDate: data.paymentDate as any,
                description: narration, totalAmount: data.amount, currency: voucherCurrency, sourceModule: "ERP",
              }).returning();
              voucherId = v.id;
              const expenseId = await findOrCreateLedgerAccount(tx, companyId, rentExpenseAccountName, "Indirect Expense", "SHOP-RENT-EXP");
              await tx.insert(voucherEntries).values([
                { voucherId: v.id, ledgerAccountId: expenseId,          debitAmount: data.amount, creditAmount: "0", narration },
                { voucherId: v.id, ledgerAccountId: data.cashAccountId, debitAmount: "0", creditAmount: data.amount, narration },
              ]);
            } else {
              const incomeAccountId = await findOrCreateLedgerAccount(tx, companyId, incomeAccountName, "Income", "RENT-INC", "Indirect Income");
              const narration = `Rent received - ${unitLabel} - ${monthSpan}`;
              const [v] = await tx.insert(vouchers).values({
                companyId, voucherNumber: `RENT-${Date.now()}-${Math.random().toString(36).slice(2,7)}-${contract.id}`,
                voucherType: "Receipt", voucherDate: data.paymentDate as any,
                description: narration, totalAmount: data.amount, currency: voucherCurrency, sourceModule: "ERP",
              }).returning();
              voucherId = v.id;
              const futureAllocsLB = allocations.filter(a => a.year > payYear || (a.year === payYear && a.month > payMonth));
              const deferredChunkLB = futureAllocsLB.reduce((s, a) => s + Number(a.chunk), 0);
              const earnedChunkLB = parseFloat(data.amount) - deferredChunkLB;
              const lbEntries: any[] = [
                { voucherId: v.id, ledgerAccountId: data.cashAccountId, debitAmount: data.amount, creditAmount: "0", narration },
              ];
              if (earnedChunkLB > 0.005) {
                lbEntries.push({ voucherId: v.id, ledgerAccountId: incomeAccountId, debitAmount: "0", creditAmount: earnedChunkLB.toFixed(2), narration });
              }
              if (deferredChunkLB > 0.005) {
                const deferredId = await findOrCreateLedgerAccount(tx, companyId, "Deferred Rent Revenue", "Liability", "DEF-RENT-REV");
                lbEntries.push({ voucherId: v.id, ledgerAccountId: deferredId, debitAmount: "0", creditAmount: deferredChunkLB.toFixed(2), narration });
              }
              await tx.insert(voucherEntries).values(lbEntries);
            }
          }

          const created: (typeof propertyPayments.$inferSelect)[] = [];
          for (const alloc of allocations) {
            const [row] = await tx.select().from(propertyMonthlyLedger).where(and(
              eq(propertyMonthlyLedger.contractId, contract.id),
              eq(propertyMonthlyLedger.year, alloc.year),
              eq(propertyMonthlyLedger.month, alloc.month),
            ));
            const [p] = await tx.insert(propertyPayments).values({
              companyId, module, contractId: contract.id, unitId: contract.unitId,
              ledgerRowId: row.id, cashAccountId: data.cashAccountId ?? null,
              voucherId: voucherId ?? null, amount: alloc.chunk,
              paymentDate: data.paymentDate as any,
              forYear: alloc.year, forMonth: alloc.month,
              currency: data.currency || "USD",
              exchangeRate: data.exchangeRate || "1",
              notes: allocations.length > 1
                ? `${data.notes ? data.notes + " | " : ""}Split from ${data.amount} payment`
                : (data.notes ?? null),
            }).returning();
            created.push(p);
            await tx.execute(sql`
              UPDATE property_monthly_ledger SET paid_amount = paid_amount + ${alloc.chunk}::numeric WHERE id = ${row.id}
            `);
          }
          return created;
        });

        if (data.cashAccountId && payments.length > 0) {
          const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
          await maybeRunAutoTransfer(companyId, module, data.cashAccountId, data.amount, data.paymentDate, unitLabel, payments[0].id, data.notes);
        }
        results.push({ contractId: data.contractId, paymentsCreated: payments.length });
      }

      res.json({ processed: results.length, results });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      console.error(`${tag} bulk-payments:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── DELETE PAYMENT (full reversal) ──
  app.delete(`${urlPrefix}/payments/:id`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const paymentId = parseId(req.params.id);
      if (paymentId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(paymentId)) return res.status(400).json({ message: "Invalid payment id" });

      const [payment] = await db.select().from(propertyPayments).where(and(
        eq(propertyPayments.id, paymentId),
        eq(propertyPayments.companyId, companyId),
        eq(propertyPayments.module, module),
      ));
      if (!payment) return res.status(404).json({ message: "Payment not found" });

      await db.transaction(async tx => {
        // 1. Reverse the monthly ledger paid_amount
        if (payment.ledgerRowId) {
          await tx.execute(sql`
            UPDATE property_monthly_ledger
            SET paid_amount = GREATEST(0, paid_amount - ${payment.amount}::numeric)
            WHERE id = ${payment.ledgerRowId}
          `);
        }

        // 2. Soft-delete the linked payment voucher ONLY if no other payment row
        //    references the same voucherId (split payments share one voucher)
        if (payment.voucherId) {
          const siblings = await tx.select({ id: propertyPayments.id })
            .from(propertyPayments)
            .where(and(
              eq(propertyPayments.voucherId, payment.voucherId),
              sql`${propertyPayments.id} != ${paymentId}`,
            ));
          if (siblings.length === 0) {
            await tx.execute(sql`
              UPDATE vouchers SET deleted_at = NOW() WHERE id = ${payment.voucherId}
            `);
            // Also soft-delete the AP-CLEAR auto-clearing journal created alongside this payment
            await tx.execute(sql`
              UPDATE vouchers SET deleted_at = NOW()
              WHERE voucher_number = ${'AP-CLEAR-' + payment.voucherId}
                AND company_id = ${companyId}
                AND deleted_at IS NULL
            `);
          }
        }

        // 3. Reverse any auto-transfers that were created for this payment
        //    Hard-delete both sides (entries + voucher) so the destination company's
        //    books are fully clean — matching the simple-company-transfer pattern.
        const linkedTransfers = await tx
          .select()
          .from(interCompanyTransfers)
          .where(eq(interCompanyTransfers.sourcePaymentId, paymentId));

        for (const transfer of linkedTransfers) {
          const fvid = transfer.fromVoucherId;
          const tvid = transfer.toVoucherId;
          // Delete the transfer record FIRST to release FK "restrict" constraints
          // on fromVoucherId / toVoucherId before hard-deleting those voucher rows.
          await tx.delete(interCompanyTransfers).where(eq(interCompanyTransfers.id, transfer.id));
          if (fvid) {
            await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, fvid));
            await tx.delete(vouchers).where(eq(vouchers.id, fvid));
          }
          if (tvid) {
            await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, tvid));
            await tx.delete(vouchers).where(eq(vouchers.id, tvid));
          }
        }

        // 4. Delete the payment row itself
        await tx.delete(propertyPayments).where(eq(propertyPayments.id, paymentId));

        // 5. If this was a guarantee-release payment, reset guaranteePostedToStatement on the contract
        if (payment.notes && payment.notes.includes("[Guarantee release]") && payment.contractId) {
          await tx.update(propertyContracts)
            .set({ guaranteePostedToStatement: false })
            .where(eq(propertyContracts.id, payment.contractId));
        }
      });

      res.json({ ok: true });
    } catch (e: any) {
      console.error(`${tag} delete-payment:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── UNIT DETAIL (ledger view) ──
  app.get(`${urlPrefix}/units/:id/detail`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const unitId = parseId(req.params.id);
      if (unitId === null) return res.status(400).json({ message: "Invalid id" });

      let isShared = false;
      let [unit] = await db.select().from(propertyUnits).where(and(
        eq(propertyUnits.id, unitId), eq(propertyUnits.companyId, companyId), eq(propertyUnits.module, module),
      ));

      // If unit doesn't belong to this company, check if it's shared with this company
      // Wrapped in try/catch — gracefully skips if column not migrated yet in production
      if (!unit) {
        try {
          const [sharedContract] = await db.select().from(propertyContracts).where(and(
            eq(propertyContracts.unitId, unitId),
            eq(propertyContracts.linkedCompanyId, companyId),
            eq(propertyContracts.status, "ACTIVE"),
          ));
          if (sharedContract) {
            const [ownerUnit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, unitId));
            if (ownerUnit) { unit = ownerUnit; isShared = true; }
          }
        } catch (sharedErr: any) {
          console.warn(`${tag} shared-detail skipped:`, sharedErr.message?.split("\n")[0]);
        }
      }
      if (!unit) return res.status(404).json({ message: "Unit not found" });

      const [contract] = await db.select().from(propertyContracts).where(and(
        isShared
          ? eq(propertyContracts.linkedCompanyId, companyId)
          : eq(propertyContracts.companyId, companyId),
        // Shared contracts may live in any module on the owner's side; skip module filter
        ...(isShared ? [] : [eq(propertyContracts.module, module)]),
        eq(propertyContracts.unitId, unitId),
        eq(propertyContracts.status, "ACTIVE"),
      ));

      let ledger: any[] = [], rentPayments: any[] = [], guaranteePayments: any[] = [];
      if (contract) {
        await ensureMonthlyLedgerRows(contract.id);
        ledger = await db.select().from(propertyMonthlyLedger)
          .where(eq(propertyMonthlyLedger.contractId, contract.id))
          .orderBy(propertyMonthlyLedger.year, propertyMonthlyLedger.month);
        const allPayments = await db.select().from(propertyPayments)
          .where(eq(propertyPayments.contractId, contract.id))
          .orderBy(desc(propertyPayments.paymentDate));
        // Separate guarantee/deposit activity from normal rent payments.
        // A payment is a guarantee activity if its notes contain "[Guarantee release]"
        // OR if ledgerRowId is null (guarantee-to-cash inserts with ledgerRowId: null).
        guaranteePayments = allPayments.filter(
          p => p.ledgerRowId === null || (p.notes ?? "").includes("[Guarantee release]"),
        );
        rentPayments = allPayments.filter(
          p => p.ledgerRowId !== null && !(p.notes ?? "").includes("[Guarantee release]"),
        );
      }

      const pastContracts = await db.select().from(propertyContracts)
        .where(and(
          eq(propertyContracts.companyId, companyId),
          eq(propertyContracts.module, module),
          eq(propertyContracts.unitId, unitId),
          eq(propertyContracts.status, "ENDED"),
        ))
        .orderBy(desc(propertyContracts.endDate));

      res.json({ unit, contract: contract ?? null, ledger, payments: rentPayments, guaranteePayments, pastContracts, isShared });
    } catch (e: any) {
      console.error(`${tag} detail:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── CASH ACCOUNTS picker ──
  app.get(`${urlPrefix}/cash-accounts`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accts = await db.select().from(ledgerAccounts).where(and(
        eq(ledgerAccounts.companyId, companyId),
        eq(ledgerAccounts.active, true),
        isNull(ledgerAccounts.deletedAt),
      ));
      res.json(accts.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GLOBAL PAYMENTS LOG ──
  app.get(`${urlPrefix}/payments`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const payments = await db
        .select({
          id: propertyPayments.id,
          paymentDate: propertyPayments.paymentDate,
          amount: propertyPayments.amount,
          forYear: propertyPayments.forYear,
          forMonth: propertyPayments.forMonth,
          notes: propertyPayments.notes,
          contractId: propertyPayments.contractId,
          unitId: propertyPayments.unitId,
          currency: propertyPayments.currency,
          exchangeRate: propertyPayments.exchangeRate,
          cashAccountId: propertyPayments.cashAccountId,
          voucherId: propertyPayments.voucherId,
          tenantName: propertyContracts.tenantName,
          unitNumber: propertyUnits.unitNumber,
          locationGroup: propertyUnits.locationGroup,
        })
        .from(propertyPayments)
        .leftJoin(propertyContracts, eq(propertyContracts.id, propertyPayments.contractId))
        .leftJoin(propertyUnits, eq(propertyUnits.id, propertyPayments.unitId))
        .where(and(
          eq(propertyPayments.companyId, companyId),
          eq(propertyPayments.module, module),
        ))
        .orderBy(desc(propertyPayments.paymentDate));

      res.json(payments);
    } catch (e: any) {
      console.error(`${tag} payments-log:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── MANUAL MONTHLY ROLLOVER ──
  app.post(`${urlPrefix}/run-monthly`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      await ensureMonthlyForCompany(companyId, module);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── ACCRUAL (ERP SHOP only) ────────────────────────────────────────────────
  // Manually post rent accrual journal vouchers for all unpaid ERP shop months.
  // Returns { accrued: N } where N = number of newly-posted accrual voucher rows.
  app.post(`${urlPrefix}/accrue`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      await ensureMonthlyForCompany(companyId, module);

      // Post all due, unaccrued rows as ONE combined journal voucher
      const { accrued, skipped } = await postRentAccrualForCompany(companyId, shopExpenseAccountName, module, incomeAccountName);

      res.json({ accrued, skipped });
    } catch (e: any) {
      console.error(`${tag} accrue:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── RESET + RE-ACCRUE (ERP SHOP only) ────────────────────────────────────
  // Deletes all existing individual accrual vouchers (where no payment has been
  // applied yet) and then immediately re-runs the combined accrual so the daybook
  // shows ONE journal instead of one-per-unit.
  //
  // Safe guard: rows where paidAmount > 0 are left alone — their accrual is already
  // partially settled and reversing it would leave the books inconsistent.
  //
  // Returns { reset: N, accrued: M } where:
  //   reset   = number of old individual vouchers deleted
  //   accrued = number of rows stamped with the new combined voucher
  app.post(`${urlPrefix}/re-accrue`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      await ensureMonthlyForCompany(companyId, module);

      // 1. Find all active SHOP contract IDs for this company (module-aware)
      const shopContracts = await db
        .select({ id: propertyContracts.id })
        .from(propertyContracts)
        .innerJoin(propertyUnits, eq(propertyUnits.id, propertyContracts.unitId))
        .where(and(
          eq(propertyContracts.companyId, companyId),
          eq(propertyContracts.module, module as any),
          eq(propertyContracts.status, "ACTIVE"),
          eq(propertyUnits.unitType, "SHOP"),
        ));

      // 1b. Phantom-accrual repair (ALL months, historical + current).
      //
      // Problem: when a payment is recorded BEFORE the accrual runs, the payment
      // posts  Dr Rent Expense / Cr Cash  (no AP entry).  If the accrual is run
      // later it posts  Dr Rent Expense / Cr AP  using the FULL expectedAmount,
      // leaving a phantom AP credit with no matching debit — inflating the
      // liability by exactly the pre-paid amount.
      //
      // Fix: for every accrued ledger row whose payment voucher(s) never debited
      // Accrued Rent Payable, post a correcting journal:
      //   Dr Accrued Rent Payable  paid_amount
      //   Cr Rent Expense          paid_amount
      //
      // This removes the phantom AP and the duplicate expense entry in one shot
      // without touching the original accrual or payment vouchers.
      //
      // Net result for a fully-pre-paid row (paid = expected):
      //   Dr Expense = old_accrual + payment − correction = expected ✓
      //   Cr AP      = old_accrual − correction           = 0        ✓
      //
      // Net result for a partially-pre-paid row (paid < expected):
      //   Cr AP      = old_accrual − correction = expected − paid    ✓ (outstanding)
      //   Dr Expense = old_accrual + payment − correction = expected ✓
      if (shopContracts.length > 0) {
        const contractIds = shopContracts.map(c => c.id);

        // Find AP account for this company
        const [apAcct] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(
            eq(ledgerAccounts.companyId, companyId),
            eq(ledgerAccounts.code, "ACCR-RENT-PAY"),
          ));

        const [expAcct] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(
            eq(ledgerAccounts.companyId, companyId),
            eq(ledgerAccounts.code, "SHOP-RENT-EXP"),
          ));

        if (apAcct && expAcct) {
          // All accrued rows with some payment (candidates for phantom)
          const candidateRows = await db
            .select({
              id:             propertyMonthlyLedger.id,
              expectedAmount: propertyMonthlyLedger.expectedAmount,
              paidAmount:     propertyMonthlyLedger.paidAmount,
            })
            .from(propertyMonthlyLedger)
            .where(and(
              inArray(propertyMonthlyLedger.contractId, contractIds),
              isNotNull(propertyMonthlyLedger.accrualVoucherId),
              sql`${propertyMonthlyLedger.paidAmount}::numeric > 0`,
            ));

          // For each candidate, check whether any payment voucher debited AP
          // (= post-accrual payment, already correct).  If no AP debit found,
          // the payment was pre-accrual and the phantom fix is needed.
          let phantomFixTotal = 0;
          type PhantomRow = { id: number; correction: number };
          const phantomRows: PhantomRow[] = [];

          for (const row of candidateRows) {
            const paid = Number(row.paidAmount);
            if (paid <= 0) continue;

            // Find payment voucher IDs for this ledger row
            const paymentVouchers = await db
              .select({ voucherId: propertyPayments.voucherId })
              .from(propertyPayments)
              .where(eq(propertyPayments.ledgerRowId, row.id));

            const payVoucherIds = paymentVouchers
              .map(p => p.voucherId)
              .filter((id): id is number => id !== null && id !== undefined);

            if (payVoucherIds.length === 0) continue;

            // Check if any of those vouchers have a debit to AP
            const [apDebitEntry] = await db
              .select({ id: voucherEntries.id })
              .from(voucherEntries)
              .where(and(
                inArray(voucherEntries.voucherId, payVoucherIds),
                eq(voucherEntries.ledgerAccountId, apAcct.id),
                sql`${voucherEntries.debitAmount}::numeric > 0`,
              ))
              .limit(1);

            // Also check for AP-CLEAR auto-clearing journals linked to these payment vouchers.
            // New payment flow posts a separate journal (voucherNumber = "AP-CLEAR-{payVoucherId}")
            // with the AP debit instead of embedding it in the payment voucher itself.
            let apClearJournalDebit = false;
            if (!apDebitEntry) {
              for (const pvId of payVoucherIds) {
                const [clj] = await db
                  .select({ id: vouchers.id })
                  .from(vouchers)
                  .where(and(
                    eq(vouchers.companyId, companyId),
                    eq(vouchers.voucherNumber, `AP-CLEAR-${pvId}`),
                    isNull(vouchers.deletedAt),
                  ))
                  .limit(1);
                if (clj) {
                  const [apDr] = await db
                    .select({ id: voucherEntries.id })
                    .from(voucherEntries)
                    .where(and(
                      eq(voucherEntries.voucherId, clj.id),
                      eq(voucherEntries.ledgerAccountId, apAcct.id),
                      sql`${voucherEntries.debitAmount}::numeric > 0`,
                    ))
                    .limit(1);
                  if (apDr) { apClearJournalDebit = true; break; }
                }
              }
            }

            if (!apDebitEntry && !apClearJournalDebit) {
              // No AP debit in any payment → pre-accrual payment → phantom
              const correction = Math.min(paid, Number(row.expectedAmount));
              phantomRows.push({ id: row.id, correction });
              phantomFixTotal += correction;
            }
          }

          if (phantomRows.length > 0) {
            console.log(`[re-accrue] phantom fix: ${phantomRows.length} rows, total correction=${phantomFixTotal}`);
            await db.transaction(async (tx) => {
              const [corrV] = await tx.insert(vouchers).values({
                companyId,
                voucherNumber: `PHANTOM-FIX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                voucherType:  "Journal",
                voucherDate:  new Date().toISOString().slice(0, 10) as any,
                description:  `Phantom accrual correction — Dr AP / Cr Rent Expense (${phantomRows.length} rows)`,
                totalAmount:  String(phantomFixTotal),
                currency:     "USD",
                sourceModule: module as any,
              }).returning();

              const corrEntries: {
                voucherId: number; ledgerAccountId: number;
                debitAmount: string; creditAmount: string; narration: string;
              }[] = [];

              for (const p of phantomRows) {
                corrEntries.push({
                  voucherId:        corrV.id,
                  ledgerAccountId:  apAcct.id,
                  debitAmount:      String(p.correction),
                  creditAmount:     "0",
                  narration:        `Phantom accrual correction — ledger row ${p.id}`,
                });
                corrEntries.push({
                  voucherId:        corrV.id,
                  ledgerAccountId:  expAcct.id,
                  debitAmount:      "0",
                  creditAmount:     String(p.correction),
                  narration:        `Phantom accrual correction — ledger row ${p.id}`,
                });
              }
              await tx.insert(voucherEntries).values(corrEntries);
            });
            console.log(`[re-accrue] phantom fix voucher posted, total corrected=${phantomFixTotal}`);
          } else {
            console.log(`[re-accrue] no phantom accruals detected`);
          }
        }
      }

      if (shopContracts.length === 0) {
        return res.json({ reset: 0, accrued: 0, skipped: 0 });
      }

      const contractIds = shopContracts.map(c => c.id);

      // 2a. Dangling-reference sweep (ALL months):
      //     If the user manually deleted vouchers through the UI the voucher rows
      //     are soft-deleted (deletedAt IS NOT NULL) or hard-deleted, but the
      //     accrualVoucherId stamp on the ledger rows still has the old ID.
      //     postRentAccrualForCompany queries WHERE accrualVoucherId IS NULL, so
      //     those rows would never be picked up.  Clear every stale reference now
      //     so the normal flow can proceed unblocked.
      //
      //     Before clearing: detect "orphaned AP debits" — months whose accrual
      //     was deleted AFTER payments had already debited AP.  Those Dr AP entries
      //     have no matching Cr AP from an accrual anymore, leaving a phantom debit
      //     that makes the AP balance lower than the real outstanding.
      //     Auto-fix: Dr Rent Expense / Cr AP for the orphaned amount so AP nets
      //     to zero for those months and the next accrual starts clean.
      const danglingRows = await db
        .select({
          id:         propertyMonthlyLedger.id,
          paidAmount: propertyMonthlyLedger.paidAmount,
        })
        .from(propertyMonthlyLedger)
        .where(and(
          inArray(propertyMonthlyLedger.contractId, contractIds),
          isNotNull(propertyMonthlyLedger.accrualVoucherId),
          sql`${propertyMonthlyLedger.accrualVoucherId} NOT IN (
            SELECT id FROM vouchers WHERE deleted_at IS NULL
          )`,
          sql`${propertyMonthlyLedger.paidAmount}::numeric > 0`,
        ));

      if (danglingRows.length > 0) {
        const [apAcctD] = await db.select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(
            eq(ledgerAccounts.companyId, companyId),
            eq(ledgerAccounts.code, "ACCR-RENT-PAY"),
            isNull(ledgerAccounts.deletedAt),
          ));
        const [expAcctD] = await db.select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(
            eq(ledgerAccounts.companyId, companyId),
            eq(ledgerAccounts.code, "SHOP-RENT-EXP"),
            isNull(ledgerAccounts.deletedAt),
          ));

        if (apAcctD && expAcctD) {
          // For each dangling paid row, find how much was debited from AP in payment vouchers
          let orphanedTotal = 0;
          type OrphanRow = { ledgerRowId: number; apDebit: number };
          const orphanRows: OrphanRow[] = [];

          for (const dr of danglingRows) {
            const payVouchers = await db
              .select({ voucherId: propertyPayments.voucherId })
              .from(propertyPayments)
              .where(eq(propertyPayments.ledgerRowId, dr.id));
            const payVoucherIds = payVouchers
              .map(p => p.voucherId)
              .filter((id): id is number => id !== null && id !== undefined);
            if (payVoucherIds.length === 0) continue;

            const apDebits = await db
              .select({ amount: voucherEntries.debitAmount })
              .from(voucherEntries)
              .where(and(
                inArray(voucherEntries.voucherId, payVoucherIds),
                eq(voucherEntries.ledgerAccountId, apAcctD.id),
                sql`${voucherEntries.debitAmount}::numeric > 0`,
              ));
            const rowApDebit = apDebits.reduce((s, e) => s + Number(e.amount), 0);
            if (rowApDebit > 0) {
              orphanRows.push({ ledgerRowId: dr.id, apDebit: rowApDebit });
              orphanedTotal += rowApDebit;
            }
          }

          if (orphanRows.length > 0) {
            await db.transaction(async (tx) => {
              const [corrV] = await tx.insert(vouchers).values({
                companyId,
                voucherNumber: `ORPHAN-AP-FIX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                voucherType:   "Journal",
                voucherDate:   new Date().toISOString().slice(0, 10) as any,
                description:   `Orphaned AP debit correction (${orphanRows.length} row${orphanRows.length > 1 ? "s" : ""}) — Dr Rent Expense / Cr AP`,
                totalAmount:   String(orphanedTotal),
                currency:      "USD",
                sourceModule:  module as any,
              }).returning();

              const corrEntries: {
                voucherId: number; ledgerAccountId: number;
                debitAmount: string; creditAmount: string; narration: string;
              }[] = [];
              for (const o of orphanRows) {
                corrEntries.push({
                  voucherId:       corrV.id,
                  ledgerAccountId: expAcctD.id,
                  debitAmount:     String(o.apDebit),
                  creditAmount:    "0",
                  narration:       `Orphaned AP debit correction — ledger row ${o.ledgerRowId}`,
                });
                corrEntries.push({
                  voucherId:       corrV.id,
                  ledgerAccountId: apAcctD.id,
                  debitAmount:     "0",
                  creditAmount:    String(o.apDebit),
                  narration:       `Orphaned AP debit correction — ledger row ${o.ledgerRowId}`,
                });
              }
              await tx.insert(voucherEntries).values(corrEntries);
            });
            console.log(`[re-accrue] orphaned AP debit fix: ${orphanRows.length} rows, total corrected=${orphanedTotal}`);
          }
        }
      }

      await db
        .update(propertyMonthlyLedger)
        .set({ accrualVoucherId: null })
        .where(and(
          inArray(propertyMonthlyLedger.contractId, contractIds),
          isNotNull(propertyMonthlyLedger.accrualVoucherId),
          sql`${propertyMonthlyLedger.accrualVoucherId} NOT IN (
            SELECT id FROM vouchers WHERE deleted_at IS NULL
          )`,
        ));
      console.log(`[re-accrue] dangling stamp sweep cleared rows`);

      // 2b. Full reset for ALL fully-unpaid months (paidAmount = 0):
      //     Find every ledger row that still has an accrual stamp but has NOT yet
      //     received any payment.  Since paidAmount = 0 there are no Dr AP entries
      //     from payments that could become "orphaned" when we delete the accrual
      //     credit — it is always safe to wipe and re-accrue these rows.
      //     Rows with paidAmount > 0 are left alone; the phantom-fix in step 1b
      //     already corrects any pre-payment / post-accrual mismatches for those.
      //
      //     This replaces the old "current month only" reset and fixes the case
      //     where multiple past months are outstanding but only the current month's
      //     accrual was being rebuilt.
      const now = new Date();
      const curYear  = now.getUTCFullYear();
      const curMonth = now.getUTCMonth() + 1;

      // All accrued rows with no payment whatsoever (safe to delete + re-accrue)
      const allUnpaidAccruedRows = await db
        .select({
          id:               propertyMonthlyLedger.id,
          accrualVoucherId: propertyMonthlyLedger.accrualVoucherId,
          paidAmount:       propertyMonthlyLedger.paidAmount,
          expectedAmount:   propertyMonthlyLedger.expectedAmount,
          year:             propertyMonthlyLedger.year,
          month:            propertyMonthlyLedger.month,
        })
        .from(propertyMonthlyLedger)
        .where(and(
          inArray(propertyMonthlyLedger.contractId, contractIds),
          isNotNull(propertyMonthlyLedger.accrualVoucherId),
          sql`${propertyMonthlyLedger.paidAmount}::numeric = 0`,
        ));
      console.log(`[re-accrue] company=${companyId} ${curYear}-${curMonth} unpaidAccruedRows=${allUnpaidAccruedRows.length}`, JSON.stringify(allUnpaidAccruedRows));

      const voucherIdsToDelete = [
        ...new Set(
          allUnpaidAccruedRows
            .map(r => r.accrualVoucherId)
            .filter((id): id is number => id !== null && id !== undefined),
        ),
      ];

      console.log(`[re-accrue] vouchersToDelete=${JSON.stringify(voucherIdsToDelete)}`);

      let reset = 0;
      if (voucherIdsToDelete.length > 0) {
        await db.transaction(async (tx) => {
          await tx.delete(voucherEntries)
            .where(inArray(voucherEntries.voucherId, voucherIdsToDelete));
          await tx.delete(vouchers)
            .where(and(
              inArray(vouchers.id, voucherIdsToDelete),
              eq(vouchers.companyId, companyId),
            ));
          // Clear stamps on all the rows we just wiped
          await tx.update(propertyMonthlyLedger)
            .set({ accrualVoucherId: null })
            .where(inArray(propertyMonthlyLedger.id, allUnpaidAccruedRows.map(r => r.id)));
        });
        reset = voucherIdsToDelete.length;
      }

      // 3. Re-run the combined accrual
      const { accrued, skipped } = await postRentAccrualForCompany(companyId, shopExpenseAccountName, module, incomeAccountName);
      console.log(`[re-accrue] result reset=${reset} accrued=${accrued} skipped=${skipped}`);

      res.json({ reset, accrued, skipped });
    } catch (e: any) {
      console.error(`${tag} re-accrue:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── REVERSE ACCRUAL (ERP SHOP only) ──────────────────────────────────────
  // Posts the mirror-image Journal voucher for an accrued ledger row and clears
  // accrualVoucherId so the month can be re-accrued if needed.
  // Blocked if any payment has already been applied to that month (payment would
  // have debited Accrued Rent Payable; reversing the original accrual would then
  // leave the books inconsistent — void the payment first).
  app.delete(`${urlPrefix}/ledger/:rowId/accrual`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (module !== "ERP") return res.status(400).json({ message: "Accrual reversal is only available for ERP module" });

      const rowId = parseId(req.params.rowId);
      if (rowId === null) return res.status(400).json({ message: "Invalid row id" });

      // Load ledger row and verify company ownership
      const [row] = await db.select().from(propertyMonthlyLedger).where(and(
        eq(propertyMonthlyLedger.id, rowId),
        eq(propertyMonthlyLedger.companyId, companyId),
        eq(propertyMonthlyLedger.module, "ERP"),
      ));
      if (!row) return res.status(404).json({ message: "Ledger row not found" });
      if (!row.accrualVoucherId) return res.status(400).json({ message: "This month has no posted accrual to reverse" });

      // Verify unit is SHOP type
      const [unit] = await db.select({ unitType: propertyUnits.unitType, unitNumber: propertyUnits.unitNumber })
        .from(propertyUnits).where(eq(propertyUnits.id, row.unitId));
      if (!unit || unit.unitType !== "SHOP") return res.status(400).json({ message: "Accrual reversal is only available for SHOP units" });

      // Block if payments have already been applied (they debited Accrued Rent Payable).
      if (Number(row.paidAmount) > 0) {
        return res.status(400).json({
          message: `Cannot reverse: ${row.paidAmount} has already been paid against this month. Void the payment first.`,
        });
      }

      const amount = String(Number(row.expectedAmount) - Number(row.paidAmount));

      const reversalVoucherId = await db.transaction(async (tx) => {
        const liabilityAccountId = await findOrCreateLedgerAccount(tx, companyId, "Accrued Rent Payable", "Liability", "ACCR-RENT-PAY");
        const expenseAccountId   = await findOrCreateLedgerAccount(tx, companyId, shopExpenseAccountName, "Indirect Expense", "SHOP-RENT-EXP");

        const monthStr  = `${String(row.month).padStart(2, "0")}/${row.year}`;
        const unitLabel = `unit${row.unitId}${unit.unitNumber ? `-${unit.unitNumber}` : ""}`;
        const narration = `Accrual reversal - ${unitLabel} - ${monthStr}`;

        const [v] = await tx.insert(vouchers).values({
          companyId,
          voucherNumber: `ACCR-REV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${rowId}`,
          voucherType: "Journal",
          voucherDate:  new Date().toISOString().slice(0, 10) as any,
          description:  narration,
          totalAmount:  amount,
          currency:     "USD",
          sourceModule: "ERP",
        }).returning();

        // Mirror image of the original accrual:
        //   Original:  Dr Rent Expense  /  Cr Accrued Rent Payable
        //   Reversal:  Dr Accrued Rent Payable  /  Cr Rent Expense
        await tx.insert(voucherEntries).values([
          { voucherId: v.id, ledgerAccountId: liabilityAccountId, debitAmount: amount, creditAmount: "0", narration },
          { voucherId: v.id, ledgerAccountId: expenseAccountId,   debitAmount: "0",   creditAmount: amount, narration },
        ]);

        // Clear the stamp — month is now clean and eligible to be re-accrued
        await tx.update(propertyMonthlyLedger)
          .set({ accrualVoucherId: null })
          .where(eq(propertyMonthlyLedger.id, rowId));

        return v.id;
      });

      res.json({ ok: true, reversalVoucherId });
    } catch (e: any) {
      console.error(`${tag} reverse-accrual:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── AUTO-TRANSFER CONFIG ───────────────────────────────────────────────────

  // GET — return current config for this company+module (or null), enriched with names
  app.get(`${urlPrefix}/auto-transfer-config`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      // Return all configs for this company+module, enriched with names
      const allCfgs = await db.select().from(rentalAutoTransferConfigs).where(and(
        eq(rentalAutoTransferConfigs.companyId, companyId),
        eq(rentalAutoTransferConfigs.module, module),
      ));

      const enriched = await Promise.all(allCfgs.map(async cfg => {
        const [destCompany] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, cfg.destCompanyId));
        const [destAccount] = await db.select({ name: ledgerAccounts.name }).from(ledgerAccounts).where(eq(ledgerAccounts.id, cfg.destLedgerAccountId));
        const sourceIds = (cfg.sourceCashAccountIds ?? []) as number[];
        let sourceAccountNames: { id: number; name: string }[] = [];
        if (sourceIds.length > 0) {
          sourceAccountNames = await db
            .select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
            .from(ledgerAccounts)
            .where(inArray(ledgerAccounts.id, sourceIds));
        }
        return { ...cfg, destCompanyName: destCompany?.name ?? null, destAccountName: destAccount?.name ?? null, sourceAccountNames };
      }));

      res.json(enriched);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST — upsert config (insert or update on conflict)
  app.post(`${urlPrefix}/auto-transfer-config`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const data = z.object({
        destCompanyId: z.number().min(1),
        destLedgerAccountId: z.number().min(1),
        sourceCashAccountIds: z.array(z.number()).default([]),
        enabled: z.boolean().default(true),
      }).parse(req.body);

      // Always insert a new rule (multiple rules per company+module are supported)
      const [created] = await db.insert(rentalAutoTransferConfigs).values({
        companyId, module, ...data,
      }).returning();
      res.status(201).json(created);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // DELETE — remove a specific auto-transfer rule by ID
  app.delete(`${urlPrefix}/auto-transfer-config/:id`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      await db.delete(rentalAutoTransferConfigs).where(and(
        eq(rentalAutoTransferConfigs.id, id),
        eq(rentalAutoTransferConfigs.companyId, companyId),
      ));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
