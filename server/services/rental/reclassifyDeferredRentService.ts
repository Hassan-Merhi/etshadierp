import { pool } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";

let inFlight: Promise<void> | null = null;

/**
 * One-time/idempotent data correction for Properties-mode landlord accounting.
 *
 * Properties now recognises landlord rent on receipt, so any balance left in
 * Deferred Rent Revenue must be moved into the existing Rental Income account.
 * The old deferred account is then hidden/inactivated and legacy prepaid flags
 * on landlord monthly rows are cleared so the old deferred-recognition pass can
 * never recognise the same cash a second time.
 *
 * Safe to call on every server start:
 *  - the company-scoped advisory lock prevents concurrent runs;
 *  - the transfer is based on the CURRENT deferred balance;
 *  - after the first successful run that balance is zero, so later calls no-op.
 */
export function reclassifyLegacyDeferredRentForProperties(): Promise<void> {
  if (!inFlight) {
    inFlight = runReclassification().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function runReclassification(): Promise<void> {
  const companies = await pool.query<{ id: number; name: string }>(`
    SELECT id, name
    FROM companies
    WHERE active = true
      AND company_type = 'properties'
    ORDER BY id
  `);

  for (const company of companies.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Stable namespace + company id. xact lock is released automatically on COMMIT/ROLLBACK.
      await client.query("SELECT pg_advisory_xact_lock($1)", [734_210_000 + Number(company.id)]);

      const accounts = await client.query<{
        deferred_id: number | null;
        income_id: number | null;
      }>(
        `
        SELECT
          (
            SELECT id
            FROM ledger_accounts
            WHERE company_id = $1
              AND deleted_at IS NULL
              AND (code = 'DEF-RENT-REV' OR LOWER(TRIM(name)) = 'deferred rent revenue')
            ORDER BY CASE WHEN code = 'DEF-RENT-REV' THEN 0 ELSE 1 END, id
            LIMIT 1
          ) AS deferred_id,
          (
            SELECT id
            FROM ledger_accounts
            WHERE company_id = $1
              AND deleted_at IS NULL
              AND (
                code = 'RENT-INC'
                OR LOWER(TRIM(name)) = 'rental income - properties'
                OR LOWER(TRIM(name)) = 'rental income'
              )
            ORDER BY
              CASE
                WHEN code = 'RENT-INC' THEN 0
                WHEN LOWER(TRIM(name)) = 'rental income - properties' THEN 1
                ELSE 2
              END,
              id
            LIMIT 1
          ) AS income_id
        `,
        [company.id]
      );

      const deferredId = accounts.rows[0]?.deferred_id ?? null;
      const incomeId = accounts.rows[0]?.income_id ?? null;

      // Nothing was ever deferred for this Properties company.
      if (!deferredId) {
        await clearLegacyLandlordPrepaidFlags(client, company.id);
        await client.query("COMMIT");
        continue;
      }

      // Lock the account row before reading its balance. PostgreSQL does not allow
      // FOR UPDATE on the grouped aggregate query itself, so the lock is acquired
      // separately and held until this transaction commits.
      await client.query("SELECT id FROM ledger_accounts WHERE id = $1 FOR UPDATE", [deferredId]);

      const balanceResult = await client.query<{ credit_balance: string }>(
        `
        SELECT (
          CASE
            WHEN la.opening_balance_side = 'Dr' THEN -COALESCE(la.opening_balance, 0)::numeric
            ELSE COALESCE(la.opening_balance, 0)::numeric
          END
          + COALESCE(SUM(
              CASE WHEN v.deleted_at IS NULL
                THEN COALESCE(ve.base_credit_amount, ve.credit_amount, 0)::numeric
                   - COALESCE(ve.base_debit_amount, ve.debit_amount, 0)::numeric
                ELSE 0
              END
            ), 0)
        )::text AS credit_balance
        FROM ledger_accounts la
        LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
        LEFT JOIN vouchers v ON v.id = ve.voucher_id
        WHERE la.id = $1
        GROUP BY la.id, la.opening_balance, la.opening_balance_side
        `,
        [deferredId]
      );

      const creditBalance = Number(balanceResult.rows[0]?.credit_balance ?? "0");

      if (Math.abs(creditBalance) >= 0.005) {
        if (!incomeId) {
          throw new Error(
            `Properties company ${company.id} (${company.name}) has ${creditBalance.toFixed(2)} in Deferred Rent Revenue but no existing Rental Income account (RENT-INC).`
          );
        }

        const amount = Math.abs(creditBalance).toFixed(2);
        const voucherNumber = `RENT-DEF-RECLASS-${company.id}-${Date.now()}`;
        const description = "One-time reclassification: Deferred Rent Revenue to Rental Income";

        const voucher = await client.query<{ id: number }>(
          `
          INSERT INTO vouchers
            (company_id, voucher_number, voucher_type, voucher_date, description,
             total_amount, currency, source_module)
          VALUES ($1, $2, 'Journal', CURRENT_DATE, $3, $4, 'USD', 'ERP')
          RETURNING id
          `,
          [company.id, voucherNumber, description, amount]
        );
        const voucherId = voucher.rows[0].id;

        const deferredDebit = creditBalance > 0 ? amount : "0";
        const deferredCredit = creditBalance < 0 ? amount : "0";
        const incomeDebit = creditBalance < 0 ? amount : "0";
        const incomeCredit = creditBalance > 0 ? amount : "0";

        await client.query(
          `
          INSERT INTO voucher_entries
            (voucher_id, ledger_account_id, debit_amount, credit_amount, narration,
             transaction_currency, transaction_debit_amount, transaction_credit_amount,
             base_debit_amount, base_credit_amount, historical_exchange_rate, rate_convention)
          VALUES
            ($1, $2, $3, $4, $5, 'USD', $3, $4, $3, $4, 1, 'IDENTITY'),
            ($1, $6, $7, $8, $5, 'USD', $7, $8, $7, $8, 1, 'IDENTITY')
          `,
          [
            voucherId,
            deferredId,
            deferredDebit,
            deferredCredit,
            description,
            incomeId,
            incomeDebit,
            incomeCredit,
          ]
        );

        logger.info(
          `[RentalIncome] Reclassified Deferred Rent Revenue for ${company.name} (company=${company.id}) amount=${amount}`
        );
      }

      // Preserve historical vouchers, but stop exposing/using the obsolete account.
      await client.query(
        `UPDATE ledger_accounts
         SET active = false, is_hidden = true
         WHERE id = $1`,
        [deferredId]
      );

      await clearLegacyLandlordPrepaidFlags(client, company.id);
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK").catch(() => {});
      logger.error(`[RentalIncome] Deferred-rent reclassification failed for company=${company.id}`, {
        error: getErrorMessage(error),
      });
      throw error;
    } finally {
      client.release();
    }
  }
}

async function clearLegacyLandlordPrepaidFlags(client: any, companyId: number): Promise<void> {
  await client.query(
    `
    UPDATE property_monthly_ledger pml
    SET used_prepaid_account = false
    WHERE pml.used_prepaid_account = true
      AND pml.contract_id IN (
        SELECT pc.id
        FROM property_contracts pc
        JOIN property_units pu ON pu.id = pc.unit_id
        WHERE pc.company_id = $1
          AND pc.module = 'PROPERTIES'
          AND pu.unit_type <> 'SHOP'
      )
    `,
    [companyId]
  );
}
