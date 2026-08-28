import { and, eq, isNull } from "drizzle-orm";
import { propertyMonthlyLedger, voucherEntries } from "@shared/schema";

import { db, pool } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { findOrCreateLedgerAccount } from "../../routes/rental/shared/ledger";
import {
  infrastructurePostingIdentity,
  insertInfrastructureVoucherTx,
} from "../accounting/infrastructureVoucherIdentity";
import { getRentalBillingDay, getRentalPeriodDueDate } from "./rentalPeriodService";

type CandidateRow = {
  id: number;
  unit_id: number;
  year: number;
  month: number;
  expected_amount: string;
  start_date: string;
  currency: string | null;
};

type PaymentRow = {
  id: number;
  payment_date: string;
  amount: string;
  voucher_id: number | null;
};

type DebitSummary = {
  voucher_id: number;
  name: string;
  account_type: string;
  debit: string;
};

type ReclassChunk = {
  paymentId: number;
  paymentDate: string;
  amount: number;
};

/**
 * Repairs legacy owned SHOP rental rows that were fully paid before their billing
 * date but were posted before the prepaid-rent workflow existed, or lost their
 * prepaid flag. Ambiguous rows are left untouched rather than guessed.
 *
 * For old direct-expense postings, historical accounting is corrected at the
 * original payment dates, then recognized on the actual billing date.
 */
export async function repairLegacyFullyPrepaidRentRecognition(
  companyId: number,
  module: string,
  shopExpenseAccountName: string,
  asOfDate: string
): Promise<{ repaired: number; skippedAmbiguous: number }> {
  if (module === "PROPERTIES") return { repaired: 0, skippedAmbiguous: 0 };

  const { rows: candidates } = await pool.query<CandidateRow>(
    `SELECT
       pml.id,
       pml.unit_id,
       pml.year,
       pml.month,
       pml.expected_amount::text,
       pc.start_date::text,
       COALESCE(pc.currency, 'USD') AS currency
     FROM property_monthly_ledger pml
     JOIN property_contracts pc ON pc.id = pml.contract_id
     JOIN property_units pu ON pu.id = pml.unit_id
     WHERE pml.company_id = $1
       AND pml.module = $2
       AND pml.accrual_voucher_id IS NULL
       AND pml.used_prepaid_account = false
       AND pml.used_advance_account = false
       AND pml.expected_amount::numeric > 0
       AND pml.paid_amount::numeric >= pml.expected_amount::numeric - 0.005
       AND pc.company_id = $1
       AND pc.module = $2
       AND pc.status = 'ACTIVE'
       AND pu.unit_type = 'SHOP'
     ORDER BY pml.year, pml.month, pml.id`,
    [companyId, module]
  );

  let repaired = 0;
  let skippedAmbiguous = 0;

  for (const row of candidates) {
    const expected = Number(row.expected_amount);
    if (!(expected > 0.005)) continue;

    const billingDay = getRentalBillingDay(row.start_date.slice(0, 10));
    const dueDate = getRentalPeriodDueDate(row.year, row.month, billingDay);
    if (dueDate > asOfDate) continue;

    const { rows: earlyPayments } = await pool.query<PaymentRow>(
      `SELECT id, payment_date::text, amount::text, voucher_id
       FROM property_payments
       WHERE ledger_row_id = $1
         AND company_id = $2
         AND module = $3
         AND posting_status = 'POSTED'
         AND payment_date < $4
       ORDER BY payment_date, id`,
      [row.id, companyId, module, dueDate]
    );

    const earlyPaid = earlyPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    if (earlyPaid < expected - 0.005) continue;

    const voucherIds = [
      ...new Set(earlyPayments.map((payment) => payment.voucher_id).filter((id): id is number => id !== null)),
    ];
    if (voucherIds.length === 0) {
      skippedAmbiguous++;
      continue;
    }

    const { rows: debitSummary } = await pool.query<DebitSummary>(
      `SELECT ve.voucher_id, la.name, la.account_type,
              COALESCE(SUM(ve.debit_amount::numeric), 0)::text AS debit
       FROM voucher_entries ve
       JOIN ledger_accounts la ON la.id = ve.ledger_account_id
       WHERE ve.voucher_id = ANY($1::int[])
         AND la.company_id = $2
         AND ve.debit_amount::numeric > 0
         AND la.deleted_at IS NULL
       GROUP BY ve.voucher_id, la.name, la.account_type`,
      [voucherIds, companyId]
    );

    const summariesByVoucher = new Map<number, DebitSummary[]>();
    for (const entry of debitSummary) {
      const entries = summariesByVoucher.get(entry.voucher_id) ?? [];
      entries.push(entry);
      summariesByVoucher.set(entry.voucher_id, entries);
    }

    let remaining = expected;
    let ambiguous = false;
    const reclassChunks: ReclassChunk[] = [];

    for (const payment of earlyPayments) {
      if (remaining <= 0.005) break;
      const paymentAmount = Number(payment.amount);
      if (!(paymentAmount > 0.005) || payment.voucher_id === null) {
        ambiguous = true;
        break;
      }

      const allocated = Math.min(paymentAmount, remaining);
      const summaries = summariesByVoucher.get(payment.voucher_id) ?? [];
      const prepaidDebit = summaries
        .filter((entry) => entry.name.toLowerCase() === "prepaid rent")
        .reduce((sum, entry) => sum + Number(entry.debit), 0);
      const rentExpenseDebit = summaries
        .filter(
          (entry) =>
            (entry.account_type === "Indirect Expense" || entry.account_type === "Expense") &&
            entry.name.toLowerCase().includes("rent")
        )
        .reduce((sum, entry) => sum + Number(entry.debit), 0);

      const paymentAlreadyPrepaid = prepaidDebit >= allocated - 0.005;
      const paymentWasDirectExpense = !paymentAlreadyPrepaid && rentExpenseDebit >= allocated - 0.005;
      if (!paymentAlreadyPrepaid && !paymentWasDirectExpense) {
        ambiguous = true;
        break;
      }

      if (paymentWasDirectExpense) {
        reclassChunks.push({
          paymentId: payment.id,
          paymentDate: payment.payment_date.slice(0, 10),
          amount: allocated,
        });
      }
      remaining -= allocated;
    }

    if (ambiguous || remaining > 0.005) {
      skippedAmbiguous++;
      logger.warn("[RentalLegacyPrepaidRepair] skipped ambiguous row", {
        companyId,
        module,
        ledgerRowId: row.id,
        dueDate,
        expected,
        remaining,
      });
      continue;
    }

    const currency = row.currency || "USD";
    const amount = expected.toFixed(2);
    const period = `${String(row.month).padStart(2, "0")}/${row.year}`;
    const sourceId = `${companyId}:${module}:${row.id}`;

    try {
      await db.transaction(async (tx) => {
        const expenseId = await findOrCreateLedgerAccount(
          tx,
          companyId,
          shopExpenseAccountName,
          "Indirect Expense",
          "SHOP-RENT-EXP"
        );
        const prepaidId = await findOrCreateLedgerAccount(tx, companyId, "Prepaid Rent", "Asset", "PREP-RENT");

        for (const chunk of reclassChunks) {
          const chunkAmount = chunk.amount.toFixed(2);
          const narration = `Legacy prepaid rent reclassification - unit${row.unit_id} - ${period}`;
          const { voucher } = await insertInfrastructureVoucherTx(
            tx,
            {
              companyId,
              voucherNumber: `LEGACY-PREPAID-RECLASS-${companyId}-${row.id}-${chunk.paymentId}`,
              voucherType: "Journal",
              voucherDate: chunk.paymentDate,
              description: narration,
              totalAmount: chunkAmount,
              currency,
              sourceModule: module,
            },
            infrastructurePostingIdentity("rental-prepaid-repair", sourceId, `reclass:${chunk.paymentId}`),
            {
              ledgerRowId: row.id,
              paymentId: chunk.paymentId,
              amount: chunkAmount,
              paymentDate: chunk.paymentDate,
              dueDate,
            }
          );

          await tx.insert(voucherEntries).values([
            {
              voucherId: voucher.id,
              ledgerAccountId: prepaidId,
              debitAmount: chunkAmount,
              creditAmount: "0",
              narration,
            },
            {
              voucherId: voucher.id,
              ledgerAccountId: expenseId,
              debitAmount: "0",
              creditAmount: chunkAmount,
              narration,
            },
          ]);
        }

        const narration = `Prepaid rent recognized - unit${row.unit_id} - ${period}`;
        const { voucher: recognitionVoucher } = await insertInfrastructureVoucherTx(
          tx,
          {
            companyId,
            voucherNumber: `LEGACY-PREPAID-REC-${companyId}-${row.id}`,
            voucherType: "Journal",
            voucherDate: dueDate,
            description: narration,
            totalAmount: amount,
            currency,
            sourceModule: module,
          },
          infrastructurePostingIdentity("rental-prepaid-repair", sourceId, "recognition"),
          { ledgerRowId: row.id, amount, dueDate }
        );

        await tx.insert(voucherEntries).values([
          {
            voucherId: recognitionVoucher.id,
            ledgerAccountId: expenseId,
            debitAmount: amount,
            creditAmount: "0",
            narration,
          },
          {
            voucherId: recognitionVoucher.id,
            ledgerAccountId: prepaidId,
            debitAmount: "0",
            creditAmount: amount,
            narration,
          },
        ]);

        await tx
          .update(propertyMonthlyLedger)
          .set({
            accrualVoucherId: recognitionVoucher.id,
            usedPrepaidAccount: true,
            usedAdvanceAccount: false,
          })
          .where(
            and(
              eq(propertyMonthlyLedger.id, row.id),
              eq(propertyMonthlyLedger.companyId, companyId),
              isNull(propertyMonthlyLedger.accrualVoucherId)
            )
          );
      });

      repaired++;
      logger.info("[RentalLegacyPrepaidRepair] repaired fully prepaid month", {
        companyId,
        module,
        ledgerRowId: row.id,
        dueDate,
        expected,
        reclassifiedPayments: reclassChunks.length,
      });
    } catch (error: unknown) {
      logger.error("[RentalLegacyPrepaidRepair] row repair failed", {
        companyId,
        module,
        ledgerRowId: row.id,
        error: getErrorMessage(error),
      });
    }
  }

  return { repaired, skippedAmbiguous };
}
