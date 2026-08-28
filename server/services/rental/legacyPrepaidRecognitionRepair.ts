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
  payment_date: string;
  amount: string;
  voucher_id: number | null;
};

type DebitSummary = {
  name: string;
  account_type: string;
  debit: string;
};

/**
 * Repairs legacy owned SHOP rental rows that were fully paid before their billing
 * date but were posted before the prepaid-rent workflow existed, or lost their
 * prepaid flag. Ambiguous rows are left untouched rather than guessed.
 *
 * For old direct-expense postings, historical accounting is corrected at the
 * original dates:
 *   payment date: Dr Prepaid Rent / Cr Rent Expense
 *   billing date: Dr Rent Expense / Cr Prepaid Rent
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
      `SELECT payment_date::text, amount::text, voucher_id
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
      `SELECT la.name, la.account_type, COALESCE(SUM(ve.debit_amount::numeric), 0)::text AS debit
       FROM voucher_entries ve
       JOIN ledger_accounts la ON la.id = ve.ledger_account_id
       WHERE ve.voucher_id = ANY($1::int[])
         AND la.company_id = $2
         AND ve.debit_amount::numeric > 0
         AND la.deleted_at IS NULL
       GROUP BY la.name, la.account_type`,
      [voucherIds, companyId]
    );

    const prepaidDebit = debitSummary
      .filter((entry) => entry.name.toLowerCase() === "prepaid rent")
      .reduce((sum, entry) => sum + Number(entry.debit), 0);
    const rentExpenseDebit = debitSummary
      .filter(
        (entry) =>
          (entry.account_type === "Indirect Expense" || entry.account_type === "Expense") &&
          entry.name.toLowerCase().includes("rent")
      )
      .reduce((sum, entry) => sum + Number(entry.debit), 0);

    const alreadyPrepaid = prepaidDebit >= expected - 0.005;
    const legacyDirectExpense = !alreadyPrepaid && rentExpenseDebit >= expected - 0.005;
    if (!alreadyPrepaid && !legacyDirectExpense) {
      skippedAmbiguous++;
      logger.warn("[RentalLegacyPrepaidRepair] skipped ambiguous row", {
        companyId,
        module,
        ledgerRowId: row.id,
        dueDate,
        expected,
        prepaidDebit,
        rentExpenseDebit,
      });
      continue;
    }

    const paymentDate = earlyPayments[0].payment_date.slice(0, 10);
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

        if (legacyDirectExpense) {
          const narration = `Legacy prepaid rent reclassification - unit${row.unit_id} - ${period}`;
          const { voucher } = await insertInfrastructureVoucherTx(
            tx,
            {
              companyId,
              voucherNumber: `LEGACY-PREPAID-RECLASS-${companyId}-${row.id}`,
              voucherType: "Journal",
              voucherDate: paymentDate,
              description: narration,
              totalAmount: amount,
              currency,
              sourceModule: module,
            },
            infrastructurePostingIdentity("rental-prepaid-repair", sourceId, "reclass"),
            { ledgerRowId: row.id, amount, paymentDate, dueDate }
          );

          await tx.insert(voucherEntries).values([
            {
              voucherId: voucher.id,
              ledgerAccountId: prepaidId,
              debitAmount: amount,
              creditAmount: "0",
              narration,
            },
            {
              voucherId: voucher.id,
              ledgerAccountId: expenseId,
              debitAmount: "0",
              creditAmount: amount,
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
          { ledgerRowId: row.id, amount, paymentDate, dueDate }
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
        paymentDate,
        expected,
        legacyDirectExpense,
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
