import { pool } from "../../db";

export interface HistoricalCurrencyReadiness {
  ready: boolean;
  unresolvedEntryCount: number;
  unresolvedVoucherCount: number;
  unresolvedLedgerOpeningCount: number;
  unresolvedBankOpeningCount: number;
  unresolvedCustomerOpeningCount: number;
  unresolvedSupplierOpeningCount: number;
  unresolvedEmployeeOpeningCount: number;
  unresolvedFixedAssetCount: number;
  sampleVoucherIds: number[];
  asOfDate: string | null;
}

/**
 * Financial reports must never treat an unresolved non-USD legacy amount as a
 * historical base amount. This check is intentionally read-only and does not
 * apply the backfill or modify opening balances/acquisition values.
 */
export async function getHistoricalCurrencyReadiness(
  companyId: number,
  asOfDate?: string | null,
): Promise<HistoricalCurrencyReadiness> {
  const READY_LEGACY: HistoricalCurrencyReadiness = {
    ready: true,
    unresolvedEntryCount: 0,
    unresolvedVoucherCount: 0,
    unresolvedLedgerOpeningCount: 0,
    unresolvedBankOpeningCount: 0,
    unresolvedCustomerOpeningCount: 0,
    unresolvedSupplierOpeningCount: 0,
    unresolvedEmployeeOpeningCount: 0,
    unresolvedFixedAssetCount: 0,
    sampleVoucherIds: [],
    asOfDate: asOfDate || null,
  };

  // ── Phase-gate: only enforce multi-currency completeness once the backfill
  // has actually been started for this company.  If the column does not exist
  // (pre-migration production) OR no entries have been backfilled yet, the
  // system is in pure-legacy mode — the net-profit route already handles this
  // via COALESCE(base_debit_amount, debit_amount) fallbacks.  Blocking a
  // zero-backfill company with 409 is incorrect behaviour.
  try {
    const migratedCheck = await pool.query<{ has_migrated: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM voucher_entries ve
         JOIN vouchers v ON ve.voucher_id = v.id
         WHERE v.company_id = $1
           AND ve.base_debit_amount IS NOT NULL
       ) AS has_migrated`,
      [companyId],
    );
    const hasMigrated = migratedCheck.rows[0]?.has_migrated === true;
    if (!hasMigrated) {
      // Backfill never started → legacy mode, allow all financial endpoints
      return READY_LEGACY;
    }
  } catch {
    // Column doesn't exist yet in this deployment → definitely legacy mode
    return READY_LEGACY;
  }

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
      unresolved_customer_openings: string;
      unresolved_supplier_openings: string;
      unresolved_employee_openings: string;
      unresolved_fixed_assets: string;
    }>(
      `SELECT
         (SELECT COUNT(*)
            FROM ledger_accounts la
           WHERE la.company_id = $1
             AND la.deleted_at IS NULL
             AND COALESCE(la.opening_balance, 0)::numeric <> 0
             AND (
               la.opening_balance_native_amount IS NULL OR
               la.opening_balance_currency IS NULL OR
               la.opening_balance_base_amount IS NULL
             )
         )::text AS unresolved_ledger_openings,
         (SELECT COUNT(*)
            FROM bank_accounts ba
           WHERE ba.company_id = $1
             AND ba.deleted_at IS NULL
             AND COALESCE(ba.opening_balance, 0)::numeric <> 0
             AND (
               ba.opening_balance_native_amount IS NULL OR
               ba.opening_balance_currency IS NULL OR
               ba.opening_balance_base_amount IS NULL
             )
         )::text AS unresolved_bank_openings,
         (SELECT COUNT(*)
            FROM customers c
           WHERE c.company_id = $1
             AND c.deleted_at IS NULL
             AND COALESCE(c.opening_balance, 0)::numeric <> 0
             AND (
               c.opening_balance_native_amount IS NULL OR
               c.opening_balance_currency IS NULL OR
               c.opening_balance_base_amount IS NULL
             )
         )::text AS unresolved_customer_openings,
         (SELECT COUNT(*)
            FROM suppliers s
           WHERE s.deleted_at IS NULL
             AND COALESCE(s.opening_balance, 0)::numeric <> 0
             AND (
               s.opening_balance_native_amount IS NULL OR
               s.opening_balance_currency IS NULL OR
               s.opening_balance_base_amount IS NULL
             )
             AND EXISTS (
               SELECT 1
                 FROM voucher_entries ve
                 JOIN vouchers v ON v.id = ve.voucher_id
                WHERE ve.supplier_id = s.id
                  AND v.company_id = $1
                  AND v.deleted_at IS NULL
             )
         )::text AS unresolved_supplier_openings,
         (SELECT COUNT(*)
            FROM employees e
           WHERE e.company_id = $1
             AND e.deleted_at IS NULL
             AND COALESCE(e.opening_balance, 0)::numeric <> 0
             AND (
               e.opening_balance_native_amount IS NULL OR
               e.opening_balance_currency IS NULL OR
               e.opening_balance_base_amount IS NULL
             )
         )::text AS unresolved_employee_openings,
         (SELECT COUNT(*)
            FROM fixed_assets fa
           WHERE fa.company_id = $1
             AND COALESCE(fa.purchase_amount, 0)::numeric <> 0
             AND (
               fa.purchase_native_amount IS NULL OR
               fa.purchase_currency IS NULL OR
               fa.purchase_base_amount IS NULL
             )
         )::text AS unresolved_fixed_assets`,
      [companyId],
    ),
  ]);

  const unresolvedEntryCount = Number.parseInt(entryResult.rows[0]?.unresolved_entry_count || "0", 10) || 0;
  const unresolvedVoucherCount = Number.parseInt(entryResult.rows[0]?.unresolved_voucher_count || "0", 10) || 0;
  const unresolvedLedgerOpeningCount =
    Number.parseInt(openingResult.rows[0]?.unresolved_ledger_openings || "0", 10) || 0;
  const unresolvedBankOpeningCount =
    Number.parseInt(openingResult.rows[0]?.unresolved_bank_openings || "0", 10) || 0;
  const unresolvedCustomerOpeningCount =
    Number.parseInt(openingResult.rows[0]?.unresolved_customer_openings || "0", 10) || 0;
  const unresolvedSupplierOpeningCount =
    Number.parseInt(openingResult.rows[0]?.unresolved_supplier_openings || "0", 10) || 0;
  const unresolvedEmployeeOpeningCount =
    Number.parseInt(openingResult.rows[0]?.unresolved_employee_openings || "0", 10) || 0;
  const unresolvedFixedAssetCount =
    Number.parseInt(openingResult.rows[0]?.unresolved_fixed_assets || "0", 10) || 0;

  return {
    ready:
      unresolvedEntryCount === 0 &&
      unresolvedLedgerOpeningCount === 0 &&
      unresolvedBankOpeningCount === 0 &&
      unresolvedCustomerOpeningCount === 0 &&
      unresolvedSupplierOpeningCount === 0 &&
      unresolvedEmployeeOpeningCount === 0 &&
      unresolvedFixedAssetCount === 0,
    unresolvedEntryCount,
    unresolvedVoucherCount,
    unresolvedLedgerOpeningCount,
    unresolvedBankOpeningCount,
    unresolvedCustomerOpeningCount,
    unresolvedSupplierOpeningCount,
    unresolvedEmployeeOpeningCount,
    unresolvedFixedAssetCount,
    sampleVoucherIds: entryResult.rows[0]?.sample_voucher_ids || [],
    asOfDate: asOfDate || null,
  };
}
