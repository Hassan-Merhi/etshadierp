/**
 * rentalPaymentPostingService.ts
 *
 * Responsible for transitioning SCHEDULED rental payment groups to POSTED when
 * their paymentDate arrives.  Called idempotently from page-load handlers and
 * the periodic scheduler.
 *
 * Design:
 *  - One pg_advisory_xact_lock per groupId prevents concurrent double-posting.
 *  - An idempotency guard (postingStatus check inside the lock) prevents replays.
 *  - Voucher creation, ledger update, and status change all happen in one transaction.
 *  - Auto-transfer fires exactly once per group, outside the transaction.
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
import { eq, and, sql, inArray } from "drizzle-orm";
import type { RentalModule } from "../../routes/rental/_rentalShared";
import { findOrCreateLedgerAccount, maybeRunAutoTransfer } from "../../routes/rental/_rentalShared";
import { isRentalPeriodDue, getRentalBillingDay } from "./rentalPeriodService";

/**
 * Posts all SCHEDULED payment groups whose paymentDate <= asOfDate.
 * Safe to call multiple times — already-posted groups are skipped via
 * the advisory lock + postingStatus check inside each group's transaction.
 *
 * @returns count of groups actually posted this run
 */
export async function postDueScheduledRentalPayments(
  companyId: number,
  module: RentalModule,
  asOfDate: string,
  shopExpenseAccountName: string = "Rent Expense - Shops"
): Promise<number> {
  // Find all distinct payment groups that are due but still SCHEDULED
  const { rows } = await pool.query<{ payment_group_id: string; payment_date: string }>(
    `SELECT DISTINCT payment_group_id, payment_date
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
  for (const { payment_group_id: groupId, payment_date: paymentDate } of rows) {
    try {
      const didPost = await postScheduledGroup(companyId, module, groupId, paymentDate, asOfDate, shopExpenseAccountName);
      if (didPost) posted++;
    } catch (err: any) {
      console.error(`[rentalPostingService] Failed to post group ${groupId}:`, err.message?.split("\n")[0]);
    }
  }
  return posted;
}

/**
 * Posts one SCHEDULED payment group atomically.
 * Returns true if the group was posted, false if it was already posted (idempotent).
 */
async function postScheduledGroup(
  companyId: number,
  module: RentalModule,
  groupId: string,
  paymentDate: string,
  asOfDate: string,
  shopExpenseAccountName: string
): Promise<boolean> {
  const lockKey = hashGroupId(groupId);
  let groupRows: (typeof propertyPayments.$inferSelect)[] = [];

  await db.transaction(async (tx) => {
    // Acquire advisory lock to prevent concurrent double-posting of the same group
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

    // Idempotency check inside the lock
    groupRows = await tx
      .select()
      .from(propertyPayments)
      .where(
        and(
          eq(propertyPayments.paymentGroupId, groupId),
          eq(propertyPayments.postingStatus, "SCHEDULED")
        )
      );

    if (groupRows.length === 0) return; // Already posted

    const firstRow = groupRows[0];
    const contractId = firstRow.contractId;
    const cashAccountId = firstRow.cashAccountId;
    const currency = firstRow.currency || "USD";
    const totalAmount = groupRows.reduce((s, r) => s + parseFloat(r.amount as string), 0);
    const totalAmountStr = totalAmount.toFixed(2);

    // Load contract and unit for narration
    const [contract] = await tx
      .select()
      .from(propertyContracts)
      .where(eq(propertyContracts.id, contractId));
    const unit = contract
      ? (await tx.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId)))[0] ?? null
      : null;

    const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${firstRow.unitId}`;
    const allocs = groupRows.map((r) => ({
      forYear: r.forYear,
      forMonth: r.forMonth,
      chunk: r.amount as string,
      ledgerRowId: r.ledgerRowId,
    }));
    const monthSpan =
      allocs.length > 1
        ? `${String(allocs[0].forMonth).padStart(2, "0")}/${allocs[0].forYear}–${String(allocs[allocs.length - 1].forMonth).padStart(2, "0")}/${allocs[allocs.length - 1].forYear}`
        : `${String(allocs[0].forMonth).padStart(2, "0")}/${allocs[0].forYear}`;

    const narration = `Rent paid - ${unitLabel} - ${monthSpan}`;
    const isShop = unit?.unitType === "SHOP" || !!(contract?.linkedCompanyId);

    let voucherId: number | null = null;

    if (cashAccountId) {
      if (isShop) {
        // Classify each period allocation into the right debit account
        const billingDay = contract ? getRentalBillingDay(contract.startDate as string) : 1;
        let accrualDebit = 0;
        let expenseDebit = 0;
        let prepaidDebit = 0;

        for (const alloc of allocs) {
          const chunk = parseFloat(alloc.chunk as string);
          const due = isRentalPeriodDue(alloc.forYear, alloc.forMonth, billingDay, asOfDate);
          if (due) {
            // Check if this month was already accrued (Dr Rent Expense / Cr Accrued Rent Payable)
            let wasAccrued = false;
            if (alloc.ledgerRowId) {
              const [lr] = await tx
                .select({ accrualVoucherId: propertyMonthlyLedger.accrualVoucherId })
                .from(propertyMonthlyLedger)
                .where(eq(propertyMonthlyLedger.id, alloc.ledgerRowId));
              wasAccrued = !!(lr?.accrualVoucherId);
            }
            if (wasAccrued) {
              accrualDebit += chunk; // Settle accrued liability
            } else {
              expenseDebit += chunk; // Direct expense (billing day already passed, no prior accrual)
            }
          } else {
            prepaidDebit += chunk; // Future month — prepaid asset
          }
        }

        const [v] = await tx
          .insert(vouchers)
          .values({
            companyId,
            voucherNumber: `RENT-${paymentDate.replace(/-/g, "")}-${groupId.slice(-6)}`,
            voucherType: "Payment",
            voucherDate: paymentDate as any,
            description: narration,
            totalAmount: totalAmountStr,
            currency,
            sourceModule: "ERP",
          })
          .returning();
        voucherId = v.id;

        const entries: any[] = [
          { voucherId: v.id, ledgerAccountId: cashAccountId, debitAmount: "0", creditAmount: totalAmountStr, narration },
        ];
        if (accrualDebit > 0.005) {
          const accPayId = await findOrCreateLedgerAccount(tx, companyId, "Accrued Rent Payable", "Liability", "ACC-RENT-PAY");
          entries.push({ voucherId: v.id, ledgerAccountId: accPayId, debitAmount: accrualDebit.toFixed(2), creditAmount: "0", narration });
        }
        if (expenseDebit > 0.005) {
          const expId = await findOrCreateLedgerAccount(tx, companyId, shopExpenseAccountName, "Indirect Expense", "SHOP-RENT-EXP");
          entries.push({ voucherId: v.id, ledgerAccountId: expId, debitAmount: expenseDebit.toFixed(2), creditAmount: "0", narration });
        }
        if (prepaidDebit > 0.005) {
          const prepId = await findOrCreateLedgerAccount(tx, companyId, "Prepaid Rent", "Asset", "PREPAID-RENT");
          entries.push({ voucherId: v.id, ledgerAccountId: prepId, debitAmount: prepaidDebit.toFixed(2), creditAmount: "0", narration });
        }
        // Fallback if all zero (rounding edge case)
        if (accrualDebit <= 0.005 && expenseDebit <= 0.005 && prepaidDebit <= 0.005) {
          const expId = await findOrCreateLedgerAccount(tx, companyId, shopExpenseAccountName, "Indirect Expense", "SHOP-RENT-EXP");
          entries.push({ voucherId: v.id, ledgerAccountId: expId, debitAmount: totalAmountStr, creditAmount: "0", narration });
        }
        await tx.insert(voucherEntries).values(entries);
      } else {
        // Landlord receipt: Dr Cash / Cr Rental Income [/ Cr Deferred Rent Revenue]
        const [v] = await tx
          .insert(vouchers)
          .values({
            companyId,
            voucherNumber: `RENT-${paymentDate.replace(/-/g, "")}-${groupId.slice(-6)}`,
            voucherType: "Receipt",
            voucherDate: paymentDate as any,
            description: narration,
            totalAmount: totalAmountStr,
            currency,
            sourceModule: "ERP",
          })
          .returning();
        voucherId = v.id;

        const incomeId = await findOrCreateLedgerAccount(tx, companyId, "Rental Income", "Income", "RENT-INC", "Indirect Income");
        const pd = new Date(paymentDate + "T00:00:00Z");
        const payYear = pd.getUTCFullYear();
        const payMonth = pd.getUTCMonth() + 1;
        const futureAllocs = allocs.filter((a) => a.forYear > payYear || (a.forYear === payYear && a.forMonth > payMonth));
        const deferredChunk = futureAllocs.reduce((s, a) => s + Number(a.chunk), 0);
        const earnedChunk = totalAmount - deferredChunk;

        const lEntries: any[] = [
          { voucherId: v.id, ledgerAccountId: cashAccountId, debitAmount: totalAmountStr, creditAmount: "0", narration },
        ];
        if (earnedChunk > 0.005) {
          lEntries.push({ voucherId: v.id, ledgerAccountId: incomeId, debitAmount: "0", creditAmount: earnedChunk.toFixed(2), narration });
        }
        if (deferredChunk > 0.005) {
          const defId = await findOrCreateLedgerAccount(tx, companyId, "Deferred Rent Revenue", "Liability", "DEF-RENT-REV");
          lEntries.push({ voucherId: v.id, ledgerAccountId: defId, debitAmount: "0", creditAmount: deferredChunk.toFixed(2), narration });
        }
        await tx.insert(voucherEntries).values(lEntries);
      }
    }

    // Update paid_amount on each monthly ledger row
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
      .set({ postingStatus: "POSTED", postedAt: new Date(), voucherId })
      .where(inArray(propertyPayments.id, rowIds));
  });

  if (groupRows.length === 0) return false;

  // Auto-transfer (best-effort, outside transaction)
  try {
    const firstRow = groupRows[0];
    if (firstRow.cashAccountId) {
      const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, firstRow.unitId));
      const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${firstRow.unitId}`;
      const totalAmount = groupRows.reduce((s, r) => s + parseFloat(r.amount as string), 0);
      await maybeRunAutoTransfer(
        companyId,
        module,
        firstRow.cashAccountId,
        totalAmount.toFixed(2),
        paymentDate,
        unitLabel,
        firstRow.id
      );
    }
  } catch (e: any) {
    console.warn("[rentalPostingService] auto-transfer failed:", e.message?.split("\n")[0]);
  }

  return true;
}

/**
 * Converts a payment group ID string into a stable int64 for use as a
 * PostgreSQL advisory lock key.  Uses DJB2 hash, sign-extended to int8.
 */
function hashGroupId(groupId: string): bigint {
  let h = 5381n;
  for (let i = 0; i < groupId.length; i++) {
    h = ((h << 5n) + h + BigInt(groupId.charCodeAt(i))) & 0xffffffffffffffffn;
  }
  if (h > 9223372036854775807n) h -= 18446744073709551616n;
  return h;
}
