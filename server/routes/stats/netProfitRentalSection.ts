import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";

import { propertyContracts, propertyMonthlyLedger, propertyPayments } from "@shared/schema";
import { db } from "../../db";
import { divideInventoryValues, inventoryMoney, subtractInventoryValues, toInventoryDecimal } from "../../lib/inventoryMath";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";

export interface RentalOutstanding {
  /** We overpaid rent: a prepaid-rent asset. */
  prepaidRent: number;
  /** We still owe rent: a rent-payable liability. */
  rentPayable: number;
}

/** Rental outstanding for the net-profit report. */
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

    const contractIds = activeContracts.map((contract) => contract.id);
    const asOfExpr = toDate ? sql`${toDate}::date` : sql`CURRENT_DATE`;
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
    const paidMap = new Map(paidRows.map((row) => [row.contractId, toInventoryDecimal(row.paid)]));

    let prepaidRent = toInventoryDecimal(0);
    let rentPayable = toInventoryDecimal(0);
    const cfaRate = toInventoryDecimal(currentCfaRate);
    for (const row of expectedRows) {
      const net = subtractInventoryValues(paidMap.get(row.contractId), row.expected);
      const contract = activeContracts.find((candidate) => candidate.id === row.contractId);
      const usd = contract?.currency === "CFA" && cfaRate.isPositive() ? divideInventoryValues(net, cfaRate) : net;
      if (usd.isPositive()) prepaidRent = prepaidRent.plus(usd);
      else if (usd.isNegative()) rentPayable = rentPayable.plus(usd.abs());
    }

    return {
      prepaidRent: Number(inventoryMoney(prepaidRent)),
      rentPayable: Number(inventoryMoney(rentPayable)),
    };
  } catch (rentalError: unknown) {
    logger.warn("[/api/stats/net-profit] Rental section skipped (schema or data error):", {
      error: getErrorMessage(rentalError),
    });
    return empty;
  }
}
