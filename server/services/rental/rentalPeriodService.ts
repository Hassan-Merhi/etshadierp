/**
 * rentalPeriodService.ts
 *
 * Single authoritative source for all rental billing-day and effective-date
 * calculations.  Every function accepts explicit date strings (YYYY-MM-DD) so
 * there is no hidden reliance on server-local time.
 */

/**
 * Returns the billing day-of-month derived from the contract's start date.
 * The start date is treated as UTC so a 2026-07-20 start always yields 20,
 * regardless of the server's local timezone.
 */
export function getRentalBillingDay(startDate: string | Date): number {
  const d = typeof startDate === "string" ? new Date(startDate + "T00:00:00Z") : startDate;
  return d.getUTCDate();
}

/**
 * Returns the exact due date (YYYY-MM-DD) for a given (year, month, billingDay).
 * If billingDay is greater than the last day of the month (e.g. 31 in February),
 * the last calendar day of that month is used instead.
 */
export function getRentalPeriodDueDate(year: number, month: number, billingDay: number): string {
  // Last day of the target month
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-based; Date(y, m, 0) = last day of month m-1 in 0-based = month in 1-based
  const effectiveDay = Math.min(billingDay, lastDay);
  const mm = String(month).padStart(2, "0");
  const dd = String(effectiveDay).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Returns true when the rental period (year, month) is due as of asOfDate.
 * A period is due when its billing date (the billingDay-th of that month, or
 * month-end if the month is shorter) has arrived — i.e. asOfDate >= dueDate.
 *
 * NEVER uses `year <= currentYear && month <= currentMonth` alone, because
 * that would incorrectly include e.g. July when today is July 16 and the
 * billing day is 20.
 */
export function isRentalPeriodDue(
  year: number,
  month: number,
  billingDay: number,
  asOfDate: string
): boolean {
  const dueDate = getRentalPeriodDueDate(year, month, billingDay);
  return asOfDate >= dueDate;
}

/**
 * Returns true when a payment dated paymentDate is effective as of asOfDate.
 * A payment is effective when its date is on or before the as-of date.
 */
export function isPaymentEffective(paymentDate: string, asOfDate: string): boolean {
  return paymentDate <= asOfDate;
}

/**
 * Returns today's date as YYYY-MM-DD in UTC.
 * Use this only when no req object is available (e.g. scripts, schedulers).
 * In request handlers, always use getClientDate(req) instead.
 */
export function getUtcTodayString(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Returns all year/month periods between two dates (inclusive), as UTC.
 * Useful for building allocation slots.
 */
export function getMonthRange(
  fromYear: number,
  fromMonth: number,
  toYear: number,
  toMonth: number
): Array<{ year: number; month: number }> {
  const periods: Array<{ year: number; month: number }> = [];
  let y = fromYear,
    m = fromMonth;
  while (y < toYear || (y === toYear && m <= toMonth)) {
    periods.push({ year: y, month: m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (periods.length > 600) break;
  }
  return periods;
}

/**
 * Returns the year/month periods between a contract start and an as-of date
 * for which a billing row should exist (periods whose due date <= asOfDate).
 */
export function getDuePeriods(
  startDate: string,
  billingDay: number,
  asOfDate: string
): Array<{ year: number; month: number; dueDate: string }> {
  const start = new Date(startDate + "T00:00:00Z");
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth() + 1;

  const asOf = new Date(asOfDate + "T00:00:00Z");
  const asOfYear = asOf.getUTCFullYear();
  const asOfMonth = asOf.getUTCMonth() + 1;

  const result: Array<{ year: number; month: number; dueDate: string }> = [];
  let y = startYear,
    m = startMonth;

  while (y < asOfYear || (y === asOfYear && m <= asOfMonth)) {
    const dueDate = getRentalPeriodDueDate(y, m, billingDay);
    if (dueDate <= asOfDate) {
      result.push({ year: y, month: m, dueDate });
    }
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (result.length > 600) break;
  }
  return result;
}
