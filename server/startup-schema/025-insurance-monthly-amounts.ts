/**
 * Per-month Insurance member amounts imported from multi-sheet workbooks.
 *
 * The member row keeps its existing amount as the current/default value. This
 * table only stores explicit monthly overrides, so old data and manual entry
 * continue to work without a data migration.
 */
export const insuranceMonthlyAmounts: string[] = [
  `CREATE TABLE IF NOT EXISTS insurance_member_monthly_amounts (
      id serial PRIMARY KEY,
      company_id integer NOT NULL,
      member_id integer NOT NULL REFERENCES insurance_members(id) ON DELETE CASCADE,
      month_start date NOT NULL,
      amount decimal(15,2) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT insurance_member_monthly_amounts_nonnegative CHECK (amount >= 0),
      CONSTRAINT insurance_member_monthly_amounts_month_start CHECK (
        month_start = date_trunc('month', month_start)::date
      )
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS insurance_member_monthly_amounts_member_month_unique
     ON insurance_member_monthly_amounts (company_id, member_id, month_start)`,
  `CREATE INDEX IF NOT EXISTS insurance_member_monthly_amounts_company_month_idx
     ON insurance_member_monthly_amounts (company_id, month_start)`,
];