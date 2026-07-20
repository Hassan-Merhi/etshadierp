import { pool } from "../../db";

export interface HistoricalCurrencyReadiness {
  ready: boolean;
  unresolvedEntryCount: number;
  unresolvedVoucherCount: number;
  unresolvedLedgerOpeningCount: number;
  unresolvedBankOpeningCount: number;
  sampleVoucherIds: number[];
  asOfDate: string | null;
}

/**
 * Financial reports must never treat an unresolved non-USD legacy amount as a
 * historical base amount. This check is intentionally read-only and does not
 * apply the backfill or modify opening balances.
 */
export async function getHistoricalCurrencyReadiness(
  companyId: number,
  asOfDate?: string | null,
): Promise<HistoricalCurrencyReadiness> {
  const params: Array<number | string> = [companyId];
  const dateClause = asOfDate ? "AND v.voucher_date <= $2" : "";
  if (asOfDate) params.push(asOfDate);

  const [entryResult, openingResult] = await Promise.all([
    pool.query<{
      unresolved_entry_count: string;
      unresolved_voucher_count: string;
      sample_voucher_ids: number[] | null;
    }>(
      `SELECT
         COUNT(*)::text AS unresolved_entry_count,
         COUNT(DISTINCT v.id)::text AS unresolved_voucher_count,
         COALESCE(
           (ARRAY_AGG(DISTINCT v.id ORDER BY v.id) FILTER (WHERE v.id IS NOT NULL))[1:25],
           ARRAY[]::integer[]
         ) AS sample_voucher_ids
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id
       WHERE v.company_id = $1
         AND v.optional = false
         AND v.deleted_at IS NULL
         AND COALESCE(UPPER(v.currency), 'USD') <> 'USD'
         AND ve.base_debit_amount IS NULL
         AND ve.base_credit_amount IS NULL
         ${dateClause}`,
      params,
    ),
    pool.query<{
      unresolved_ledger_openings: string;
      unresolved_bank_openings: string;
    }>(
      `SELECT
         (SELECT COUNT(*)
            FROM ledger_accounts la
           WHERE la.company_id = $1
             AND la.deleted_at IS NULL
             AND COALESCE(la.opening_balance, 0)::numeric <> 0
             AND (la.opening_balance_currency IS NULL OR la.opening_balance_base_amount IS NULL)
         )::text AS unresolved_ledger_openings,
         (SELECT COUNT(*)
            FROM bank_accounts ba
           WHERE ba.company_id = $1
             AND ba.deleted_at IS NULL
             AND COALESCE(ba.opening_balance, 0)::numeric <> 0
             AND (ba.opening_balance_currency IS NULL OR ba.opening_balance_base_amount IS NULL)
         )::text AS unresolved_bank_openings`,
      [companyId],
    ),
  ]);

  const unresolvedEntryCount = Number.parseInt(entryResult.rows[0]?.unresolved_entry_count || "0", 10) || 0;
  const unresolvedVoucherCount = Number.parseInt(entryResult.rows[0]?.unresolved_voucher_count || "0", 10) || 0;
  const unresolvedLedgerOpeningCount =
    Number.parseInt(openingResult.rows[0]?.unresolved_ledger_openings || "0", 10) || 0;
  const unresolvedBankOpeningCount =
    Number.parseInt(openingResult.rows[0]?.unresolved_bank_openings || "0", 10) || 0;

  return {
    ready:
      unresolvedEntryCount === 0 &&
      unresolvedLedgerOpeningCount === 0 &&
      unresolvedBankOpeningCount === 0,
    unresolvedEntryCount,
    unresolvedVoucherCount,
    unresolvedLedgerOpeningCount,
    unresolvedBankOpeningCount,
    sampleVoucherIds: entryResult.rows[0]?.sample_voucher_ids || [],
    asOfDate: asOfDate || null,
  };
}
