import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";

import { propertyContracts, propertyMonthlyLedger, propertyPayments } from "@shared/schema";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface RentalOutstanding {
  /** We overpaid rent: a prepaid-rent asset. */
  prepaidRent: number;
  /** We still owe rent: a rent-payable liability. */
  rentPayable: number;
}

/**
 * Rental outstanding for the net-profit report.
 *
 * For every ACTIVE rental contract under this company (any module), outstanding
 * is SUM(expected for past and current months) - SUM(paid). The company is the
 * TENANT paying rent to landlords, so paid > expected means we overpaid and the
 * difference is a prepaid-rent asset; expected > paid means we still owe.
 *
 * Extracted from the /api/stats/net-profit handler. It returns the two figures
 * rather than mutating the caller's accumulators, which is the only change -
 * the queries and the arithmetic are verbatim, and
 * config/report-characterization.json pins the endpoint's output across the move.
 *
 * Errors are swallowed on purpose: if the property tables are missing columns
 * (for example `currency` on a pre-migration deployment) the dashboard should
 * still load with rent figures omitted rather than fail the whole response.
 */
export async function computeRentalOutstanding(
  companyId: number,
  toDate: string | null | undefined,
  currentCfaRate: number
): Promise<RentalOutstanding> {
  const empty: RentalOutstanding = { prepaidRent: 0, rentPayable: 0 };

  try {
    const activeContracts = await db
      .select({ id: propertyContracts.id, currency: propertyContracts.currency })
      .from(propertyContracts)
      .where(and(eq(propertyContracts.companyId, companyId), eq(propertyContracts.status, "ACTIVE")));
    if (activeContracts.length === 0) return empty;

    const contractIds = activeContracts.map((c) => c.id);
    const asOfExpr = toDate ? sql`${toDate}::date` : sql`CURRENT_DATE`;

    // Expected: months on or before the asOf date
    const expectedRows = await db
      .select({
        contractId: propertyMonthlyLedger.contractId,
        expected: sql<string>`COALESCE(SUM(
              CASE WHEN (
                ${propertyMonthlyLedger.year} < EXTRACT(YEAR FROM ${asOfExpr})
                OR (
                  ${propertyMonthlyLedger.year} = EXTRACT(YEAR FROM ${asOfExpr})
                  AND ${propertyMonthlyLedger.month} <= EXTRACT(MONTH FROM ${asOfExpr})
                )
              ) THEN CAST(${propertyMonthlyLedger.expectedAmount} AS numeric) ELSE 0 END
            ), 0)`,
      })
      .from(propertyMonthlyLedger)
      .where(inArray(propertyMonthlyLedger.contractId, contractIds))
      .groupBy(propertyMonthlyLedger.contractId);

    // Paid: only rent-linked payments (ledgerRowId IS NOT NULL) made on or before the asOf date.
    // Payments with ledgerRowId=null are guarantee-release/refund log entries — they are NOT
    // rent payments and must not inflate the "paid" total (which would falsely produce prepaid rent).
    const paidConditions: any[] = [
      inArray(propertyPayments.contractId, contractIds),
      isNotNull(propertyPayments.ledgerRowId),
    ];
    if (toDate) paidConditions.push(lte(propertyPayments.paymentDate, toDate));
    const paidRows = await db
      .select({
        contractId: propertyPayments.contractId,
        paid: sql<string>`COALESCE(SUM(CAST(${propertyPayments.amount} AS numeric)), 0)`,
      })
      .from(propertyPayments)
      .where(and(...paidConditions))
      .groupBy(propertyPayments.contractId);
    const paidMap = new Map(paidRows.map((r) => [r.contractId, parseFloat(r.paid)]));

    let prepaidRent = 0;
    let rentPayable = 0;
    for (const row of expectedRows) {
      const expected = parseFloat(row.expected);
      const paid = paidMap.get(row.contractId) ?? 0;
      const net = paid - expected; // positive = overpaid
      const contract = activeContracts.find((c) => c.id === row.contractId);
      const isCfa = contract?.currency === "CFA";
      const usd = isCfa && currentCfaRate > 0 ? net / currentCfaRate : net;
      if (usd > 0) prepaidRent += usd;
      else if (usd < 0) rentPayable += -usd;
    }

    return { prepaidRent: round2(prepaidRent), rentPayable: round2(rentPayable) };
  } catch (rentalErr: unknown) {
    logger.warn("[/api/stats/net-profit] Rental section skipped (schema or data error):", {
      error: getErrorMessage(rentalErr),
    });
    // Non-fatal: dashboard continues without rent figures
    return empty;
  }
}
