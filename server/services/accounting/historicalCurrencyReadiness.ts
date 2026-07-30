import { pool } from "../../db";

export interface HistoricalCurrencyReadiness {
  ready: boolean;
  schemaReady: boolean;
  legacyMode: boolean;
  unresolvedEntryCount: number;
  unresolvedVoucherCount: number;
  unresolvedLedgerOpeningCount: number;
  unresolvedBankOpeningCount: number;
  unresolvedCustomerOpeningCount: number;
  unresolvedSupplierOpeningCount: number;
  unresolvedEmployeeOpeningCount: number;
  unresolvedFixedAssetCount: number;
  totalUnresolvedCount: number;
  sampleVoucherIds: number[];
  asOfDate: string | null;
}

const REQUIRED_CURRENCY_COLUMNS: Record<string, readonly string[]> = {
  voucher_entries: [
    "transaction_currency",
    "transaction_debit_amount",
    "transaction_credit_amount",
    "base_debit_amount",
    "base_credit_amount",
    "historical_exchange_rate",
    "rate_convention",
  ],
  ledger_accounts: [
    "opening_balance_native_amount",
    "opening_balance_currency",
    "opening_balance_historical_rate",
    "opening_balance_base_amount",
  ],
  bank_accounts: [
    "opening_balance_native_amount",
    "opening_balance_currency",
    "opening_balance_historical_rate",
    "opening_balance_base_amount",
  ],
  customers: [
    "opening_balance_native_amount",
    "opening_balance_currency",
    "opening_balance_historical_rate",
    "opening_balance_base_amount",
  ],
  suppliers: [
    "opening_balance_native_amount",
    "opening_balance_currency",
    "opening_balance_historical_rate",
    "opening_balance_base_amount",
  ],
  employees: [
    "opening_balance_native_amount",
    "opening_balance_currency",
    "opening_balance_historical_rate",
    "opening_balance_base_amount",
  ],
  fixed_assets: [
    "purchase_native_amount",
    "purchase_currency",
    "purchase_historical_rate",
    "purchase_base_amount",
  ],
};

function schemaUnavailableReadiness(asOfDate: string | null): HistoricalCurrencyReadiness {
  return {
    ready: false,
    schemaReady: false,
    legacyMode: true,
    unresolvedEntryCount: 0,
    unresolvedVoucherCount: 0,
    unresolvedLedgerOpeningCount: 0,
    unresolvedBankOpeningCount: 0,
    unresolvedCustomerOpeningCount: 0,
    unresolvedSupplierOpeningCount: 0,
    unresolvedEmployeeOpeningCount: 0,
    unresolvedFixedAssetCount: 0,
    totalUnresolvedCount: 0,
    sampleVoucherIds: [],
    asOfDate,
  };
}

async function hasRequiredCurrencySchema(): Promise<boolean> {
  const expected = Object.values(REQUIRED_CURRENCY_COLUMNS).reduce((total, columns) => total + columns.length, 0);
  const tableNames = Object.keys(REQUIRED_CURRENCY_COLUMNS);
  const columnNames = [...new Set(Object.values(REQUIRED_CURRENCY_COLUMNS).flat())];
  const result = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ANY($1::text[])
        AND column_name = ANY($2::text[])`,
    [tableNames, columnNames],
  );
  const found = new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`));
  if (found.size < expected) return false;
  for (const [table, columns] of Object.entries(REQUIRED_CURRENCY_COLUMNS)) {
    for (const column of columns) {
      if (!found.has(`${table}.${column}`)) return false;
    }
  }
  return true;
}

/**
 * Returns whether historical accounting data is complete enough for financial
 * aggregation. Once the structural currency schema exists, readiness is based
 * on persisted row state only; it never treats an untouched or partially
 * repaired company as implicitly safe.
 */
export async function getHistoricalCurrencyReadiness(
  companyId: number,
  asOfDate?: string | null,
): Promise<HistoricalCurrencyReadiness> {
  const normalizedAsOfDate = asOfDate || null;
  if (!(await hasRequiredCurrencySchema())) {
    return schemaUnavailableReadiness(normalizedAsOfDate);
  }

  const params: Array<number | string> = [companyId];
  const dateClause = normalizedAsOfDate ? "AND v.voucher_date <= $2" : "";
  if (normalizedAsOfDate) params.push(normalizedAsOfDate);

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
         AND (
           ve.transaction_currency IS NULL
           OR ve.transaction_debit_amount IS NULL
           OR ve.transaction_credit_amount IS NULL
           OR ve.base_debit_amount IS NULL
           OR ve.base_credit_amount IS NULL
           OR ve.historical_exchange_rate IS NULL
           OR ve.rate_convention IS NULL
         )
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
      `WITH company_scope AS (
         SELECT COALESCE(UPPER(base_currency), 'USD') AS base_currency
           FROM companies
          WHERE id = $1
       )
       SELECT
         (SELECT COUNT(*)
            FROM ledger_accounts la, company_scope cs
           WHERE la.company_id = $1 AND la.deleted_at IS NULL
             AND COALESCE(la.opening_balance, 0)::numeric <> 0
             AND (la.opening_balance_native_amount IS NULL OR la.opening_balance_currency IS NULL OR la.opening_balance_base_amount IS NULL
               OR (UPPER(la.opening_balance_currency) <> cs.base_currency AND la.opening_balance_historical_rate IS NULL))
         )::text AS unresolved_ledger_openings,
         (SELECT COUNT(*)
            FROM bank_accounts ba, company_scope cs
           WHERE ba.company_id = $1 AND ba.deleted_at IS NULL
             AND COALESCE(ba.opening_balance, 0)::numeric <> 0
             AND (ba.opening_balance_native_amount IS NULL OR ba.opening_balance_currency IS NULL OR ba.opening_balance_base_amount IS NULL
               OR (UPPER(ba.opening_balance_currency) <> cs.base_currency AND ba.opening_balance_historical_rate IS NULL))
         )::text AS unresolved_bank_openings,
         (SELECT COUNT(*)
            FROM customers c, company_scope cs
           WHERE c.company_id = $1 AND c.deleted_at IS NULL
             AND COALESCE(c.opening_balance, 0)::numeric <> 0
             AND (c.opening_balance_native_amount IS NULL OR c.opening_balance_currency IS NULL OR c.opening_balance_base_amount IS NULL
               OR (UPPER(c.opening_balance_currency) <> cs.base_currency AND c.opening_balance_historical_rate IS NULL))
         )::text AS unresolved_customer_openings,
         (SELECT COUNT(*)
            FROM suppliers s, company_scope cs
           WHERE s.deleted_at IS NULL
             AND COALESCE(s.opening_balance, 0)::numeric <> 0
             AND (s.opening_balance_native_amount IS NULL OR s.opening_balance_currency IS NULL OR s.opening_balance_base_amount IS NULL
               OR (UPPER(s.opening_balance_currency) <> cs.base_currency AND s.opening_balance_historical_rate IS NULL))
             AND EXISTS (
               SELECT 1
                 FROM voucher_entries ve
                 JOIN vouchers v ON v.id = ve.voucher_id
                WHERE ve.supplier_id = s.id AND v.company_id = $1 AND v.deleted_at IS NULL
             )
         )::text AS unresolved_supplier_openings,
         (SELECT COUNT(*)
            FROM employees e, company_scope cs
           WHERE e.company_id = $1 AND e.deleted_at IS NULL
             AND COALESCE(e.opening_balance, 0)::numeric <> 0
             AND (e.opening_balance_native_amount IS NULL OR e.opening_balance_currency IS NULL OR e.opening_balance_base_amount IS NULL
               OR (UPPER(e.opening_balance_currency) <> cs.base_currency AND e.opening_balance_historical_rate IS NULL))
         )::text AS unresolved_employee_openings,
         (SELECT COUNT(*)
            FROM fixed_assets fa, company_scope cs
           WHERE fa.company_id = $1
             AND COALESCE(fa.purchase_amount, 0)::numeric <> 0
             AND (fa.purchase_native_amount IS NULL OR fa.purchase_currency IS NULL OR fa.purchase_base_amount IS NULL
               OR (UPPER(fa.purchase_currency) <> cs.base_currency AND fa.purchase_historical_rate IS NULL))
         )::text AS unresolved_fixed_assets`,
      [companyId],
    ),
  ]);

  const unresolvedEntryCount = Number.parseInt(entryResult.rows[0]?.unresolved_entry_count || "0", 10) || 0;
  const unresolvedVoucherCount = Number.parseInt(entryResult.rows[0]?.unresolved_voucher_count || "0", 10) || 0;
  const unresolvedLedgerOpeningCount = Number.parseInt(openingResult.rows[0]?.unresolved_ledger_openings || "0", 10) || 0;
  const unresolvedBankOpeningCount = Number.parseInt(openingResult.rows[0]?.unresolved_bank_openings || "0", 10) || 0;
  const unresolvedCustomerOpeningCount = Number.parseInt(openingResult.rows[0]?.unresolved_customer_openings || "0", 10) || 0;
  const unresolvedSupplierOpeningCount = Number.parseInt(openingResult.rows[0]?.unresolved_supplier_openings || "0", 10) || 0;
  const unresolvedEmployeeOpeningCount = Number.parseInt(openingResult.rows[0]?.unresolved_employee_openings || "0", 10) || 0;
  const unresolvedFixedAssetCount = Number.parseInt(openingResult.rows[0]?.unresolved_fixed_assets || "0", 10) || 0;
  const totalUnresolvedCount =
    unresolvedEntryCount +
    unresolvedLedgerOpeningCount +
    unresolvedBankOpeningCount +
    unresolvedCustomerOpeningCount +
    unresolvedSupplierOpeningCount +
    unresolvedEmployeeOpeningCount +
    unresolvedFixedAssetCount;

  return {
    ready: totalUnresolvedCount === 0,
    schemaReady: true,
    legacyMode: false,
    unresolvedEntryCount,
    unresolvedVoucherCount,
    unresolvedLedgerOpeningCount,
    unresolvedBankOpeningCount,
    unresolvedCustomerOpeningCount,
    unresolvedSupplierOpeningCount,
    unresolvedEmployeeOpeningCount,
    unresolvedFixedAssetCount,
    totalUnresolvedCount,
    sampleVoucherIds: entryResult.rows[0]?.sample_voucher_ids || [],
    asOfDate: normalizedAsOfDate,
  };
}
