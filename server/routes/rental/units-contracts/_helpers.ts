/**
 * Shared state and helpers for the rentalUnitsContractsRoutes routes.
 *
 * Extracted verbatim from the former single-file rentalUnitsContractsRoutes.ts.
 */
import { getRentalPeriodDueDate } from "../../../services/rental/rentalPeriodService";

import type { RentalModule } from "../shared";

/**
 * The five arguments registerRentalUnitsContractsRoutes is called with, plus
 * the log tag derived from them. ERP and factory each mount this module once
 * under their own prefix, so every handler needs the whole set.
 */
export interface RentalRoutesContext {
  module: RentalModule;
  urlPrefix: string;
  incomeAccountName: string;
  shopExpenseAccountName: string;
  tag: string;
}

/** Returns the next billing date on or after asOf for a given billingDay (1-28). */
export function computeNextBillingDate(billingDay: number, asOf: string): string {
  const d = new Date(asOf + "T00:00:00Z");
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const thisMonthBilling = getRentalPeriodDueDate(y, m, billingDay);
  if (thisMonthBilling >= asOf) return thisMonthBilling;
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  return getRentalPeriodDueDate(nextY, nextM, billingDay);
}
