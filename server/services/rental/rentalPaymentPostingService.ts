/**
 * rentalPaymentPostingService.ts
 *
 * Single authoritative source for rental payment accounting.
 *
 * Design:
 *  - createRentalPaymentGroup: always creates SCHEDULED rows first, then posts
 *    immediately when paymentDate <= clientDate using the identical accounting
 *    path as the scheduled-to-posted transition.
 *  - postDueScheduledRentalPayments: transitions SCHEDULED → POSTED on their date.
 *  - Both paths share postGroupCore so accounting is always identical.
 *  - Advisory lock + idempotency guard prevents double-posting.
 *  - usedAdvanceAccount / usedPrepaidAccount flags are set atomically with posting.
 *
 * Shop payment accounting per period type:
 *   A. Accrued (accrualVoucherId set): Dr Accrued Rent Payable / Cr Cash
 *   B. Due-unaccrued:
 *        Payment voucher:    Dr Advance Rent Paid / Cr Cash
 *        Recognition journal: Dr Rent Expense    / Cr Advance Rent Paid (same tx)
 *   C. Not-yet-due (prepaid): Dr Prepaid Rent / Cr Cash
 *   D. Mixed: one balanced Cash voucher with all three debit accounts
 */

import { db } from "../../db";
import { pool } from "../../db";
import {
  propertyPayments,
  propertyMonthlyLedger,
  propertyContracts,
  propertyUnits,
  vouchers,
  voucherEntries,
} from "@shared/schema";
import { eq, and, sql, inArray, isNull } from "drizzle-orm";
import Decimal from "decimal.js";
import type { RentalModule } from "../../routes/rental/_rentalShared";
import { findOrCreateLedgerAccount, maybeRunAutoTransfer } from "../../routes/rental/_rentalShared";
import {
  isRentalPeriodDue,
  getRentalBillingDay,
  getRentalPeriodDueDate,
  getDuePeriods,
} from "./rentalPeriodService";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RentalPaymentGroupOptions {
  companyId: number;
  contractCompanyId: number;
  module: RentalModule;
  contract: any;
  unit: any | null;
  cashAccountId: number | null;
  amount: string;
  paymentDate: string;
  clientDate: string;
  scheduleFuturePayment?: boolean;
  currency: string;
  exchangeRate: string;
  notes: string | null;
  shopExpenseAccountName: string;
  incomeAccountName: string;
  isSharedPayment?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Deterministic int64 advisory-lock key for a payment group ID. */
function hashGroupId(groupId: string): bigint {
  let h = 5381n;
  for (let i = 0; i < groupId.length; i++) {
    h = ((h << 5n) + h + BigInt(groupId.charCodeAt(i))) & 0xffffffffffffffffn;
  }
  if (h > 9223372036854775807n) h -= 18446744073709551616n;
  return h;
}

/**
 * Billing-day-aware "earliest outstanding month" finder.
 * Uses POSTED property_payments rows as the authoritative paid total —
 * NOT the paidAmount cache which can be stale or include future SCHEDULED rows.
 *
 * Returns the earliest month where:
 *   1. billingDate(year, month, billingDay) <= paymentDate  (month is due by payment time)
 *   2. SUM(POSTED payments for that month) < expectedAmount
 *
 * Falls back to the payment month (as the start of prepaid allocations) if
 * every due month is fully paid.
 */
export async function findEarliestOutstandingMonth(
  contractId: number,
  billingDay: number,
  paymentDate: string
): Promise<{ year: number; month: number }> {
  // Load all ledger rows for this contract, ordered chronologically
  const ledgerRows = await db
    .select({
      year: propertyMonthlyLedger.year,
      month: propertyMonthlyLedger.month,
      expectedAmount: propertyMonthlyLedger.expectedAmount,
    })
    .from(propertyMonthlyLedger)
    .where(eq(propertyMonthlyLedger.contractId, contractId))
    .orderBy(propertyMonthlyLedger.year, propertyMonthlyLedger.month);

  // Sum POSTED payments per month from property_payments (authoritative)
  const { rows: postedRows } = await pool.query<{
    for_year: string;
    for_month: string;
    paid_total: string;
  }>(
    `SELECT for_year, for_month, COALESCE(SUM(amount::numeric), 0) AS paid_total
     FROM property_payments
     WHERE contract_id = $1 AND posting_status = 'POSTED'
     GROUP BY for_year, for_month`,
    [contractId]
  );

  const postedByMonth = new Map<string, number>();
  for (const r of postedRows) {
    postedByMonth.set(`${r.for_year}-${r.for_month}`, parseFloat(r.paid_total));
  }

  for (const row of ledgerRows) {
    const billingDate = getRentalPeriodDueDate(row.year, row.month, billingDay);
    if (billingDate > paymentDate) continue; // not yet due at payment time
    const posted = postedByMonth.get(`${row.year}-${row.month}`) ?? 0;
    const expected = parseFloat(row.expectedAmount as string) || 0;
    if (expected - posted > 0.005) {
      return { year: row.year, month: row.month };
    }
  }

  // No outstanding due months → start allocations from the payment month
  const pd = new Date(paymentDate + "T00:00:00Z");
  return { year: pd.getUTCFullYear(), month: pd.getUTCMonth() + 1 };
}

/**
 * Build allocations for a payment starting from (startYear, startMonth).
 * Uses billingDay + paymentDate to distinguish due vs. prepaid months.
 * Uses POSTED payments as the authoritative paid total.
 */
export async function buildAllocationsForPayment(
  contractId: number,
  startYear: number,
  startMonth: number,
  totalAmount: number,
  rentalAmount: number,
  billingDay: number,
  paymentDate: string
): Promise<Array<{ year: number; month: number; chunk: string }>> {
  // Load ledger map
  const ledgerRows = await db
    .select({
      year: propertyMonthlyLedger.year,
      month: propertyMonthlyLedger.month,
      expectedAmount: propertyMonthlyLedger.expectedAmount,
    })
    .from(propertyMonthlyLedger)
    .where(eq(propertyMonthlyLedger.contractId, contractId));

  const ledgerMap = new Map<string, number>();
  for (const r of ledgerRows) {
    ledgerMap.set(`${r.year}-${r.month}`, parseFloat(r.expectedAmount as string) || rentalAmount);
  }

  // POSTED payments per month
  const { rows: postedRows } = await pool.query<{
    for_year: string;
    for_month: string;
    paid_total: string;
  }>(
    `SELECT for_year, for_month, COALESCE(SUM(amount::numeric), 0) AS paid_total
     FROM property_payments
     WHERE contract_id = $1 AND posting_status = 'POSTED'
     GROUP BY for_year, for_month`,
    [contractId]
  );
  const postedByMonth = new Map<string, number>();
  for (const r of postedRows) {
    postedByMonth.set(`${r.for_year}-${r.for_month}`, parseFloat(r.paid_total));
  }

  const allocations: Array<{ year: number; month: number; chunk: string }> = [];
  let remaining = new Decimal(totalAmount);
  let ay = startYear,
    am = startMonth;
  let skipped = 0;

  while (remaining.gt(0.005)) {
    const billingDate = getRentalPeriodDueDate(ay, am, billingDay);
    const isDue = billingDate <= paymentDate;
    const expected = ledgerMap.get(`${ay}-${am}`) ?? rentalAmount;
    const posted = postedByMonth.get(`${ay}-${am}`) ?? 0;
    // For due months: outstanding = expected - posted; for prepaid: capacity = rentalAmount - posted
    const capacity = isDue
      ? Math.max(0, expected - posted)
      : Math.max(0, rentalAmount - posted);

    if (capacity <= 0.005) {
      ay = am === 12 ? ay + 1 : ay;
      am = am === 12 ? 1 : am + 1;
      skipped++;
      if (skipped > 500) break;
      continue;
    }

    skipped = 0;
    const chunk = new Decimal(Math.min(remaining.toNumber(), capacity));
    allocations.push({ year: ay, month: am, chunk: chunk.toFixed(2) });
    remaining = remaining.minus(chunk);
    ay = am === 12 ? ay + 1 : ay;
    am = am === 12 ? 1 : am + 1;
    if (allocations.length >= 120) break;
  }

  return allocations;
}

// ── Core accounting engine ────────────────────────────────────────────────────

/**
 * Creates and posts one payment group's accounting inside a provided
 * transaction. Shared by createRentalPaymentGroup and postScheduledGroup.
 * Returns the created voucherId (or null if no cashAccountId).
 */
async function postGroupCore(
  tx: any,
  opts: {
    companyId: number;
    module: RentalModule;
    contract: any;
    unit: any | null;
    cashAccountId: number | null;
    allocs: Array<{
      forYear: number;
      forMonth: number;
      chunk: string;
      ledgerRowId: number | null;
    }>;
    totalAmountStr: string;
    paymentDate: string;
    asOfDate: string;
    currency: string;
    narration: string;
    shopExpenseAccountName: string;
    incomeAccountName: string;
    isSharedPayment?: boolean;
    groupId: string;
  }
): Promise<number | null> {
  const {
    companyId, module: mod, contract, unit, cashAccountId, allocs,
    totalAmountStr, paymentDate, asOfDate, currency, narration,
    shopExpenseAccountName, incomeAccountName, isSharedPayment, groupId,
  } = opts;

  if (!cashAccountId) return null;

  const isShop = isSharedPayment || unit?.unitType === "SHOP";

  if (isShop) {
    const billingDay = contract ? getRentalBillingDay(contract.startDate as string) : 1;

    // Classify each allocation
    let accrualAmt = new Decimal(0);
    let advanceAmt = new Decimal(0);
    let prepaidAmt = new Decimal(0);

    const accrualLedgerIds: number[] = [];
    const advanceLedgerIds: number[] = [];
    const prepaidLedgerIds: number[] = [];

    for (const alloc of allocs) {
      const chunk = new Decimal(alloc.chunk);
      // FIX #2: classify using paymentDate, not asOfDate
      const due = isRentalPeriodDue(alloc.forYear, alloc.forMonth, billingDay, paymentDate);

      if (due) {
        let wasAccrued = false;
        if (alloc.ledgerRowId) {
          const [lr] = await tx
            .select({ accrualVoucherId: propertyMonthlyLedger.accrualVoucherId })
            .from(propertyMonthlyLedger)
            .where(eq(propertyMonthlyLedger.id, alloc.ledgerRowId));
          wasAccrued = !!(lr?.accrualVoucherId);
        }
        if (wasAccrued) {
          accrualAmt = accrualAmt.plus(chunk);
          if (alloc.ledgerRowId) accrualLedgerIds.push(alloc.ledgerRowId);
        } else {
          advanceAmt = advanceAmt.plus(chunk);
          if (alloc.ledgerRowId) advanceLedgerIds.push(alloc.ledgerRowId);
        }
      } else {
        prepaidAmt = prepaidAmt.plus(chunk);
        if (alloc.ledgerRowId) prepaidLedgerIds.push(alloc.ledgerRowId);
      }
    }

    // Sanity: if everything rounds to zero, fall back to full expense
    const sumCheck = accrualAmt.plus(advanceAmt).plus(prepaidAmt);
    if (sumCheck.lt(0.005) && new Decimal(totalAmountStr).gt(0.005)) {
      advanceAmt = new Decimal(totalAmountStr);
      for (const alloc of allocs) {
        if (alloc.ledgerRowId) advanceLedgerIds.push(alloc.ledgerRowId);
      }
    }

    // ONE payment voucher (all debits + one Cash credit)
    const voucherNum = `RENT-${paymentDate.replace(/-/g, "")}-${groupId.slice(-6)}`;
    const [v] = await tx
      .insert(vouchers)
      .values({
        companyId,
        voucherNumber: voucherNum,
        voucherType: "Payment",
        voucherDate: paymentDate as any,
        description: narration,
        totalAmount: totalAmountStr,
        currency,
        sourceModule: "ERP",
      })
      .returning();

    const payEntries: any[] = [
      { voucherId: v.id, ledgerAccountId: cashAccountId, debitAmount: "0", creditAmount: totalAmountStr, narration },
    ];

    if (accrualAmt.gt(0.005)) {
      const accPayId = await findOrCreateLedgerAccount(
        tx, companyId, "Accrued Rent Payable", "Liability", "ACC-RENT-PAY"
      );
      payEntries.push({
        voucherId: v.id, ledgerAccountId: accPayId,
        debitAmount: accrualAmt.toFixed(2), creditAmount: "0", narration,
      });
    }

    if (advanceAmt.gt(0.005)) {
      const advId = await findOrCreateLedgerAccount(
        tx, companyId, "Advance Rent Paid", "Asset", "ADV-RENT-PAID"
      );
      payEntries.push({
        voucherId: v.id, ledgerAccountId: advId,
        debitAmount: advanceAmt.toFixed(2), creditAmount: "0", narration,
      });
    }

    if (prepaidAmt.gt(0.005)) {
      const prepId = await findOrCreateLedgerAccount(
        tx, companyId, "Prepaid Rent", "Asset", "PREPAID-RENT"
      );
      payEntries.push({
        voucherId: v.id, ledgerAccountId: prepId,
        debitAmount: prepaidAmt.toFixed(2), creditAmount: "0", narration,
      });
    }

    await tx.insert(voucherEntries).values(payEntries);

    // Recognition journal for Advance Rent Paid portion (same transaction)
    let recognitionVoucherId: number | null = null;
    if (advanceAmt.gt(0.005)) {
      const recNarr = `Advance rent recognition - ${narration}`;
      const [rv] = await tx
        .insert(vouchers)
        .values({
          companyId,
          voucherNumber: `ADV-REC-${paymentDate.replace(/-/g, "")}-${groupId.slice(-6)}`,
          voucherType: "Journal",
          voucherDate: paymentDate as any,
          description: recNarr,
          totalAmount: advanceAmt.toFixed(2),
          currency,
          sourceModule: "ERP",
        })
        .returning();
      recognitionVoucherId = rv.id;

      const expId = await findOrCreateLedgerAccount(
        tx, companyId, shopExpenseAccountName, "Indirect Expense", "SHOP-RENT-EXP"
      );
      const advId = await findOrCreateLedgerAccount(
        tx, companyId, "Advance Rent Paid", "Asset", "ADV-RENT-PAID"
      );
      await tx.insert(voucherEntries).values([
        {
          voucherId: rv.id, ledgerAccountId: expId,
          debitAmount: advanceAmt.toFixed(2), creditAmount: "0", narration: recNarr,
        },
        {
          voucherId: rv.id, ledgerAccountId: advId,
          debitAmount: "0", creditAmount: advanceAmt.toFixed(2), narration: recNarr,
        },
      ]);
    }

    // Update flags on monthly ledger rows
    if (advanceLedgerIds.length > 0) {
      await tx
        .update(propertyMonthlyLedger)
        .set({
          usedAdvanceAccount: true,
          usedPrepaidAccount: false,
          // Set accrualVoucherId so Pass 1.5 won't re-run for these rows
          accrualVoucherId: recognitionVoucherId,
        })
        .where(inArray(propertyMonthlyLedger.id, advanceLedgerIds));
    }
    if (prepaidLedgerIds.length > 0) {
      await tx
        .update(propertyMonthlyLedger)
        .set({ usedPrepaidAccount: true, usedAdvanceAccount: false })
        .where(inArray(propertyMonthlyLedger.id, prepaidLedgerIds));
    }
    if (accrualLedgerIds.length > 0) {
      await tx
        .update(propertyMonthlyLedger)
        .set({ usedPrepaidAccount: false, usedAdvanceAccount: false })
        .where(inArray(propertyMonthlyLedger.id, accrualLedgerIds));
    }

    return v.id;
  } else {
    // Landlord receipt: Dr Cash / Cr Rental Income [/ Cr Deferred Rent Revenue]
    const incomeAccountId = await findOrCreateLedgerAccount(
      tx, companyId, incomeAccountName, "Income", "RENT-INC", "Indirect Income"
    );
    const pd = new Date(paymentDate + "T00:00:00Z");
    const payYear = pd.getUTCFullYear();
    const payMonth = pd.getUTCMonth() + 1;
    const futureAllocs = allocs.filter(
      (a) => a.forYear > payYear || (a.forYear === payYear && a.forMonth > payMonth)
    );
    const deferredChunk = futureAllocs.reduce((s, a) => s + Number(a.chunk), 0);
    const totalAmountNum = parseFloat(totalAmountStr);
    const earnedChunk = totalAmountNum - deferredChunk;

    const voucherNum = `RENT-${paymentDate.replace(/-/g, "")}-${groupId.slice(-6)}`;
    const [v] = await tx
      .insert(vouchers)
      .values({
        companyId,
        voucherNumber: voucherNum,
        voucherType: "Receipt",
        voucherDate: paymentDate as any,
        description: narration,
        totalAmount: totalAmountStr,
        currency,
        sourceModule: "ERP",
      })
      .returning();

    const lEntries: any[] = [
      { voucherId: v.id, ledgerAccountId: cashAccountId, debitAmount: totalAmountStr, creditAmount: "0", narration },
    ];
    if (earnedChunk > 0.005) {
      lEntries.push({
        voucherId: v.id, ledgerAccountId: incomeAccountId,
        debitAmount: "0", creditAmount: earnedChunk.toFixed(2), narration,
      });
    }
    if (deferredChunk > 0.005) {
      const deferredId = await findOrCreateLedgerAccount(
        tx, companyId, "Deferred Rent Revenue", "Liability", "DEF-RENT-REV"
      );
      lEntries.push({
        voucherId: v.id, ledgerAccountId: deferredId,
        debitAmount: "0", creditAmount: deferredChunk.toFixed(2), narration,
      });
      // Mark prepaid rows
      const futureIds = futureAllocs.map((a) => a.ledgerRowId).filter(Boolean) as number[];
      if (futureIds.length > 0) {
        await tx
          .update(propertyMonthlyLedger)
          .set({ usedPrepaidAccount: true })
          .where(inArray(propertyMonthlyLedger.id, futureIds));
      }
    }
    await tx.insert(voucherEntries).values(lEntries);

    return v.id;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates a rental payment group:
 *  - Always creates one SCHEDULED row per allocation in a transaction.
 *  - If paymentDate <= clientDate, immediately posts the group using the same
 *    postGroupCore accounting path as the scheduled-to-posted transition.
 *
 * Throws { status: 400, message: "..." } when:
 *   - paymentDate > clientDate AND scheduleFuturePayment !== true
 */
export async function createRentalPaymentGroup(
  opts: RentalPaymentGroupOptions
): Promise<{ paymentGroupId: string; scheduled: boolean; payments: any[] }> {
  const {
    companyId, contractCompanyId, module: mod, contract, unit,
    cashAccountId, amount, paymentDate, clientDate, scheduleFuturePayment,
    currency, exchangeRate, notes, shopExpenseAccountName, incomeAccountName,
    isSharedPayment,
  } = opts;

  // Guard: future date requires explicit flag
  if (paymentDate > clientDate && !scheduleFuturePayment) {
    const err: any = new Error("Future payment dates require Schedule future payment.");
    err.status = 400;
    throw err;
  }

  const billingDay = getRentalBillingDay(contract.startDate as string);
  const totalAmountNum = parseFloat(amount);
  const rentalAmountNum = parseFloat(contract.rentalAmount as string);

  // Find earliest outstanding month based on payment date
  const { year: startY, month: startM } = await findEarliestOutstandingMonth(
    contract.id, billingDay, paymentDate
  );

  // Build allocations
  const allocations = await buildAllocationsForPayment(
    contract.id, startY, startM, totalAmountNum, rentalAmountNum, billingDay, paymentDate
  );

  const paymentGroupId = `PG-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${contract.id}`;

  // Create SCHEDULED rows + ensure ledger rows exist
  const scheduledRows = await db.transaction(async (tx) => {
    // Upsert ledger rows for every allocated month.
    // FIX #1: expected_amount = 0 for future months (not yet due at paymentDate).
    //          ensureMonthlyLedgerRows() will promote 0 → rentalAmount when the billing date arrives.
    for (const alloc of allocations) {
      const allocDueDate = getRentalPeriodDueDate(alloc.year, alloc.month, billingDay);
      const allocIsDue = allocDueDate <= paymentDate;
      const expectedForAlloc = allocIsDue ? contract.rentalAmount : "0";
      await tx.execute(sql`
        INSERT INTO property_monthly_ledger (
          company_id, module, contract_id, unit_id, year, month, expected_amount, paid_amount
        ) VALUES (
          ${contractCompanyId}, ${mod}, ${contract.id}, ${contract.unitId},
          ${alloc.year}, ${alloc.month}, ${expectedForAlloc}, 0
        )
        ON CONFLICT (contract_id, year, month)
        DO UPDATE SET
          expected_amount = CASE
            WHEN property_monthly_ledger.expected_amount::numeric = 0
            THEN EXCLUDED.expected_amount
            ELSE property_monthly_ledger.expected_amount
          END
      `);
    }

    const created: (typeof propertyPayments.$inferSelect)[] = [];
    for (const alloc of allocations) {
      const [lr] = await tx
        .select({ id: propertyMonthlyLedger.id })
        .from(propertyMonthlyLedger)
        .where(
          and(
            eq(propertyMonthlyLedger.contractId, contract.id),
            eq(propertyMonthlyLedger.year, alloc.year),
            eq(propertyMonthlyLedger.month, alloc.month)
          )
        );

      // FIX #3: payment row belongs to the PAYER company so payer can list/post its own scheduled payments
      const [p] = await tx
        .insert(propertyPayments)
        .values({
          companyId: companyId,
          module: mod,
          contractId: contract.id,
          unitId: contract.unitId,
          ledgerRowId: lr?.id ?? null,
          cashAccountId: cashAccountId ?? null,
          voucherId: null,
          amount: alloc.chunk,
          paymentDate: paymentDate as any,
          forYear: alloc.year,
          forMonth: alloc.month,
          currency: currency || "USD",
          exchangeRate: exchangeRate || "1",
          notes:
            allocations.length > 1
              ? `${notes ? notes + " | " : ""}Split from ${amount} payment`
              : (notes ?? null),
          postingStatus: "SCHEDULED",
          paymentGroupId,
        } as any)
        .returning();
      created.push(p);
    }
    return created;
  });

  // If payment is on or before clientDate: post immediately
  if (paymentDate <= clientDate) {
    await postScheduledGroup(
      companyId, contractCompanyId, mod, contract, unit,
      paymentGroupId, paymentDate, clientDate,
      cashAccountId, currency, notes, shopExpenseAccountName, incomeAccountName,
      isSharedPayment ?? false
    );

    const posted = await db
      .select()
      .from(propertyPayments)
      .where(
        and(
          eq(propertyPayments.paymentGroupId, paymentGroupId),
          sql`${propertyPayments.postingStatus} = 'POSTED'`
        ) as any
      );

    return { paymentGroupId, scheduled: false, payments: posted };
  }

  return { paymentGroupId, scheduled: true, payments: scheduledRows };
}

/**
 * Posts all SCHEDULED payment groups whose paymentDate <= asOfDate.
 */
export async function postDueScheduledRentalPayments(
  companyId: number,
  module: RentalModule,
  asOfDate: string,
  shopExpenseAccountName: string = "Rent Expense - Shops",
  incomeAccountName: string = "Rental Income"
): Promise<number> {
  const { rows } = await pool.query<{
    payment_group_id: string;
    payment_date: string;
    cash_account_id: number | null;
    currency: string;
  }>(
    `SELECT DISTINCT payment_group_id, payment_date, cash_account_id, COALESCE(currency, 'USD') AS currency
     FROM property_payments
     WHERE company_id = $1
       AND module = $2
       AND posting_status = 'SCHEDULED'
       AND payment_group_id IS NOT NULL
       AND payment_date <= $3
     ORDER BY payment_date`,
    [companyId, module, asOfDate]
  );

  let posted = 0;
  for (const row of rows) {
    try {
      // Load contract + unit for each group
      const groupRows = await db
        .select()
        .from(propertyPayments)
        .where(eq(propertyPayments.paymentGroupId, row.payment_group_id));

      if (groupRows.length === 0) continue;
      const firstRow = groupRows[0];

      const [contract] = await db
        .select()
        .from(propertyContracts)
        .where(eq(propertyContracts.id, firstRow.contractId));

      const [unit] = contract
        ? await db
            .select()
            .from(propertyUnits)
            .where(eq(propertyUnits.id, contract.unitId))
        : [null];

      const isShared = !!(contract?.linkedCompanyId);

      // FIX #3 follow-up: contractCompanyId comes from the contract, not the payment row
      // (after fix #3 firstRow.companyId is the payer, not the contract owner)
      const didPost = await postScheduledGroup(
        companyId, contract.companyId, module, contract, unit,
        row.payment_group_id, row.payment_date, asOfDate,
        row.cash_account_id, row.currency, firstRow.notes as string | null,
        shopExpenseAccountName, incomeAccountName, isShared
      );
      if (didPost) posted++;
    } catch (err: any) {
      console.error(
        `[rentalPostingService] Failed to post group ${row.payment_group_id}:`,
        err.message?.split("\n")[0]
      );
    }
  }
  return posted;
}

/**
 * Posts one SCHEDULED payment group atomically.
 * Returns true if posted, false if already posted (idempotent).
 */
async function postScheduledGroup(
  companyId: number,
  contractCompanyId: number,
  module: RentalModule,
  contract: any,
  unit: any | null,
  groupId: string,
  paymentDate: string,
  asOfDate: string,
  cashAccountId: number | null,
  currency: string,
  notes: string | null,
  shopExpenseAccountName: string,
  incomeAccountName: string,
  isSharedPayment: boolean
): Promise<boolean> {
  const lockKey = hashGroupId(groupId);
  let groupRows: (typeof propertyPayments.$inferSelect)[] = [];

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

    // Idempotency check
    groupRows = await tx
      .select()
      .from(propertyPayments)
      .where(
        and(
          eq(propertyPayments.paymentGroupId, groupId),
          sql`${propertyPayments.postingStatus} = 'SCHEDULED'` as any
        )
      );

    if (groupRows.length === 0) return; // already posted

    const totalAmount = groupRows.reduce((s, r) => s + parseFloat(r.amount as string), 0);
    const totalAmountStr = new Decimal(totalAmount).toFixed(2);

    const allocs = groupRows.map((r) => ({
      forYear: r.forYear,
      forMonth: r.forMonth,
      chunk: r.amount as string,
      ledgerRowId: r.ledgerRowId,
    }));

    const unitLabel = unit
      ? `${unit.locationGroup}/${unit.unitNumber}`
      : `Unit#${groupRows[0].unitId}`;
    const monthSpan =
      allocs.length > 1
        ? `${String(allocs[0].forMonth).padStart(2, "0")}/${allocs[0].forYear}–${String(allocs[allocs.length - 1].forMonth).padStart(2, "0")}/${allocs[allocs.length - 1].forYear}`
        : `${String(allocs[0].forMonth).padStart(2, "0")}/${allocs[0].forYear}`;
    const narration = `Rent paid - ${unitLabel} - ${monthSpan}`;

    const voucherId = await postGroupCore(tx, {
      companyId,
      module,
      contract,
      unit,
      cashAccountId,
      allocs,
      totalAmountStr,
      paymentDate,
      asOfDate,
      currency: currency || "USD",
      narration,
      shopExpenseAccountName,
      incomeAccountName,
      isSharedPayment,
      groupId,
    });

    // Update paid_amount cache on ledger rows
    for (const alloc of allocs) {
      if (alloc.ledgerRowId) {
        await tx.execute(sql`
          UPDATE property_monthly_ledger
          SET paid_amount = paid_amount + ${alloc.chunk}::numeric
          WHERE id = ${alloc.ledgerRowId}
        `);
      }
    }

    // Mark all rows POSTED
    const rowIds = groupRows.map((r) => r.id);
    await tx
      .update(propertyPayments)
      .set({
        postingStatus: "POSTED",
        postedAt: new Date(),
        voucherId: voucherId ?? null,
      } as any)
      .where(inArray(propertyPayments.id, rowIds));
  });

  if (groupRows.length === 0) return false;

  // Auto-transfer (best-effort, outside transaction)
  try {
    const firstRow = groupRows[0];
    if (firstRow.cashAccountId && unit) {
      const unitLabel = `${unit.locationGroup}/${unit.unitNumber}`;
      const totalAmount = groupRows.reduce((s, r) => s + parseFloat(r.amount as string), 0);
      await maybeRunAutoTransfer(
        companyId, module, firstRow.cashAccountId,
        new Decimal(totalAmount).toFixed(2), paymentDate, unitLabel, firstRow.id, notes ?? undefined
      );
    }
  } catch (e: any) {
    console.warn("[rentalPostingService] auto-transfer failed:", e.message?.split("\n")[0]);
  }

  return true;
}
