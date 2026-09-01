/**
 * Shared state and helpers for the voucherSalesUpdateRoutes routes.
 *
 * Extracted verbatim from the former single-file voucherSalesUpdateRoutes.ts.
 */
import {} from "drizzle-orm";

/**
 * After saving a journal voucher, if it has a customer entry + a ledger account entry,
 * look for order charges linked to that ledger account for that customer.
 * If exactly one charge is found, update its amount and recalculate the order totals.
 */
