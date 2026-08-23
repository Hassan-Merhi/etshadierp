import { pool } from "../../db";

export interface OverdueCustomerBalanceRow {
  id: number;
  legal_name: string;
  payment_terms_days: number;
  company_id: number;
  net_balance: string;
  earliest_invoice_date: string | Date | null;
}

/**
 * The customer_balances table stores explicit debit/credit columns and a
 * transaction_date. Keeping this query in one tested module prevents the
 * scheduler from drifting back to the removed entry_type/amount schema.
 */
export const OVERDUE_CUSTOMER_BALANCE_SQL = `
  SELECT
    c.id,
    c.legal_name,
    c.payment_terms_days,
    c.company_id,
    COALESCE(SUM(
      COALESCE(cb.debit_amount, 0)::numeric - COALESCE(cb.credit_amount, 0)::numeric
    ), 0) + COALESCE(
      CASE WHEN c.opening_balance_side = 'Dr' THEN c.opening_balance::numeric
           WHEN c.opening_balance_side = 'Cr' THEN -c.opening_balance::numeric
           ELSE 0 END, 0
    ) AS net_balance,
    MIN(
      CASE WHEN COALESCE(cb.debit_amount, 0)::numeric > 0 THEN cb.transaction_date ELSE NULL END
    ) AS earliest_invoice_date
  FROM customers c
  LEFT JOIN customer_balances cb
    ON cb.customer_id = c.id
   AND cb.company_id = c.company_id
  WHERE c.payment_terms_days IS NOT NULL
    AND c.deleted_at IS NULL
    AND c.active = true
  GROUP BY c.id, c.legal_name, c.payment_terms_days, c.company_id,
           c.opening_balance, c.opening_balance_side
  HAVING COALESCE(SUM(
      COALESCE(cb.debit_amount, 0)::numeric - COALESCE(cb.credit_amount, 0)::numeric
    ), 0) + COALESCE(
      CASE WHEN c.opening_balance_side = 'Dr' THEN c.opening_balance::numeric
           WHEN c.opening_balance_side = 'Cr' THEN -c.opening_balance::numeric
           ELSE 0 END, 0
    ) > 0
`;

export async function loadOverdueCustomerBalances(): Promise<OverdueCustomerBalanceRow[]> {
  const result = await pool.query<OverdueCustomerBalanceRow>(OVERDUE_CUSTOMER_BALANCE_SQL);
  return result.rows;
}
