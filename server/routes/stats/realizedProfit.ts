import { pool } from "../../db";

export interface RealizedProfitQuery {
  text: string;
  params: Array<number | string>;
}

/**
 * Build the bounded POS-profit query separately from the net-position
 * calculation. The baseline is a lower bound (inclusive); a missing baseline
 * deliberately omits that predicate to preserve the legacy all-time result.
 */
export function buildRealizedProfitQuery(
  companyId: number,
  baselineDate: string | null,
  toDate: string | null | undefined
): RealizedProfitQuery {
  const params: Array<number | string> = [companyId];
  const predicates = ["v.company_id = $1", "v.voucher_type = 'Sales'", "v.deleted_at IS NULL"];

  if (baselineDate) {
    params.push(baselineDate);
    predicates.push(`v.voucher_date >= $${params.length}`);
  }
  if (toDate) {
    params.push(toDate);
    predicates.push(`v.voucher_date <= $${params.length}`);
  }

  return {
    text: `
      SELECT COALESCE(SUM(si.profit::numeric), 0) AS total
      FROM sales_items si
      JOIN vouchers v ON si.voucher_id = v.id
      WHERE ${predicates.join("\n        AND ")}
    `,
    params,
  };
}

export async function getSupplierPartnerPosProfit(
  companyId: number,
  baselineDate: string | null,
  toDate: string | null | undefined
): Promise<number> {
  const query = buildRealizedProfitQuery(companyId, baselineDate, toDate);
  const result = await pool.query<{ total: string | null }>(query.text, query.params);
  return Number(result.rows[0]?.total ?? 0);
}
