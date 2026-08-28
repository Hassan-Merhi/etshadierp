import { pool } from "../../db";
import { getRentalBillingDay, getRentalPeriodDueDate } from "./rentalPeriodService";
import { logger } from "../../lib/logger";
import { getErrorMessage } from "../../lib/httpHandlers";

type CandidateRow = {
  id: number;
  contract_id: number;
  unit_id: number;
  year: number;
  month: number;
  expected_amount: string;
  paid_amount: string;
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

async function findOrCreateAccount(
  client: import("pg").PoolClient,
  companyId: number,
  name: string,
  accountType: string,
  codePrefix: string
): Promise<number> {
  await client.query(
    `INSERT INTO ledger_accounts (company_id, code, name, account_type, active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (company_id, name) WHERE deleted_at IS NULL DO NOTHING`,
    [companyId, `${codePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, accountType]
  );
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM ledger_accounts
     WHERE company_id = $1 AND name = $2 AND deleted_at IS NULL
     ORDER BY id ASC LIMIT 1`,
    [companyId, name]
  );
  if (!rows[0]) throw new Error(`Could not find/create rental account ${name}`);
  return rows[0].id;
}

async function findExistingVoucher(
  client: import("pg").PoolClient,
  companyId: number,
  voucherNumber: string
): Promise<number | null> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM vouchers
     WHERE company_id = $1 AND voucher_number = $2 AND deleted_at IS NULL
     ORDER BY id ASC LIMIT 1`,
    [companyId, voucherNumber]
  );
  return rows[0]?.id ?? null;
}

/**
 * Repairs legacy SHOP/shared rental rows that were fully paid before their billing
 * date but were posted before the prepaid-rent workflow existed (or lost their
 * prepaid flag). The repair is intentionally conservative: it only touches a
 * fully-paid month when the full month was paid before its exact billing date and
 * the original payment evidence shows either a Prepaid Rent debit or a rent-expense
 * debit. Ambiguous rows are left untouched.
 *
 * For old direct-expense postings, the historical accounting is corrected at the
 * original dates:
 *   payment date: Dr Prepaid Rent / Cr Rent Expense
 *   billing date: Dr Rent Expense / Cr Prepaid Rent
 *
 * This moves rent expense into the month in which it was actually earned, stamps
 * accrualVoucherId so the statement badge is consistent, and is idempotent through
 * deterministic voucher numbers.
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
       pml.id, pml.contract_id, pml.unit_id, pml.year, pml.month,
       pml.expected_amount::text, pml.paid_amount::text,
       pc.start_date::text, COALESCE(pc.currency, 'USD') AS currency
     FROM property_monthly_ledger pml
     JOIN property_contracts pc ON pc.id = pml.contract_id
     JOIN property_units pu ON pu.id = pml.unit_id
     WHERE pml.module = $2
       AND pml.accrual_voucher_id IS NULL
       AND pml.used_prepaid_account = false
       AND pml.used_advance_account = false
       AND pml.expected_amount::numeric > 0
       AND pml.paid_amount::numeric >= pml.expected_amount::numeric - 0.005
       AND pc.status = 'ACTIVE'
       AND (
         (pc.company_id = $1 AND pc.module = $2 AND pu.unit_type = 'SHOP')
         OR pc.linked_company_id = $1
       )
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

    const earlyPaid = earlyPayments.reduce((sum, p) => sum + Number(p.amount), 0);
    if (earlyPaid < expected - 0.005) continue;

    const voucherIds = [...new Set(earlyPayments.map((p) => p.voucher_id).filter((id): id is number => id != null))];
    if (voucherIds.length === 0) {
      skippedAmbiguous++;
      continue;
    }

    const { rows: debitSummary } = await pool.query<DebitSummary>(
      `SELECT la.name, la.account_type, COALESCE(SUM(ve.debit_amount::numeric), 0)::text AS debit
       FROM voucher_entries ve
       JOIN ledger_accounts la ON la.id = ve.ledger_account_id
       WHERE ve.voucher_id = ANY($1::int[])
         AND ve.debit_amount::numeric > 0
         AND la.deleted_at IS NULL
       GROUP BY la.name, la.account_type`,
      [voucherIds]
    );

    const prepaidDebit = debitSummary
      .filter((d) => d.name.toLowerCase() === "prepaid rent")
      .reduce((sum, d) => sum + Number(d.debit), 0);
    const rentExpenseDebit = debitSummary
      .filter(
        (d) =>
          (d.account_type === "Indirect Expense" || d.account_type === "Expense") &&
          d.name.toLowerCase().includes("rent")
      )
      .reduce((sum, d) => sum + Number(d.debit), 0);

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
    const reclassNumber = `LEGACY-PREPAID-RECLASS-${companyId}-${row.id}`;
    const recognitionNumber = `LEGACY-PREPAID-REC-${companyId}-${row.id}`;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const expenseId = await findOrCreateAccount(client, companyId, shopExpenseAccountName, "Indirect Expense", "SHOP-RENT-EXP");
      const prepaidId = await findOrCreateAccount(client, companyId, "Prepaid Rent", "Asset", "PREP-RENT");

      if (legacyDirectExpense) {
        const existingReclass = await findExistingVoucher(client, companyId, reclassNumber);
        if (!existingReclass) {
          const { rows: inserted } = await client.query<{ id: number }>(
            `INSERT INTO vouchers
               (company_id, voucher_number, voucher_type, voucher_date, description, total_amount, currency, source_module)
             VALUES ($1, $2, 'Journal', $3, $4, $5, $6, $7)
             RETURNING id`,
            [
              companyId,
              reclassNumber,
              paymentDate,
              `Legacy prepaid rent reclassification - unit${row.unit_id} - ${String(row.month).padStart(2, "0")}/${row.year}`,
              expected.toFixed(2),
              currency,
              module,
            ]
          );
          const reclassVoucherId = inserted[0].id;
          await client.query(
            `INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
             VALUES
               ($1, $2, $3, '0', $4),
               ($1, $5, '0', $3, $4)`,
            [
              reclassVoucherId,
              prepaidId,
              expected.toFixed(2),
              `Legacy prepaid rent reclassification - ledger row ${row.id}`,
              expenseId,
            ]
          );
        }
      }

      let recognitionVoucherId = await findExistingVoucher(client, companyId, recognitionNumber);
      if (!recognitionVoucherId) {
        const { rows: inserted } = await client.query<{ id: number }>(
          `INSERT INTO vouchers
             (company_id, voucher_number, voucher_type, voucher_date, description, total_amount, currency, source_module)
           VALUES ($1, $2, 'Journal', $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            companyId,
            recognitionNumber,
            dueDate,
            `Prepaid rent recognized - unit${row.unit_id} - ${String(row.month).padStart(2, "0")}/${row.year}`,
            expected.toFixed(2),
            currency,
            module,
          ]
        );
        recognitionVoucherId = inserted[0].id;
        await client.query(
          `INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
           VALUES
             ($1, $2, $3, '0', $4),
             ($1, $5, '0', $3, $4)`,
          [
            recognitionVoucherId,
            expenseId,
            expected.toFixed(2),
            `Prepaid rent recognized - ledger row ${row.id}`,
            prepaidId,
          ]
        );
      }

      await client.query(
        `UPDATE property_monthly_ledger
         SET accrual_voucher_id = $2,
             used_prepaid_account = true,
             used_advance_account = false
         WHERE id = $1
           AND accrual_voucher_id IS NULL`,
        [row.id, recognitionVoucherId]
      );

      await client.query("COMMIT");
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
      await client.query("ROLLBACK");
      logger.error("[RentalLegacyPrepaidRepair] row repair failed", {
        companyId,
        module,
        ledgerRowId: row.id,
        error: getErrorMessage(error),
      });
    } finally {
      client.release();
    }
  }

  return { repaired, skippedAmbiguous };
}
