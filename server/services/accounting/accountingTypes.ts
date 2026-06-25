/**
 * Shared TypeScript types for the accounting service layer.
 *
 * Phase 10 — Central Accounting Engine
 * These types mirror the Drizzle schema shapes but are defined here so that
 * service helpers can be imported without pulling in the full schema module.
 */

/** Minimal shape needed to insert a voucher row. */
export interface VoucherInsertFields {
  companyId: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  totalAmount: string;
  description?: string | null;
  locationId?: number | null;
  optional?: boolean;
  currency?: string | null;
  exchangeRate?: string | null;
}

/** Minimal shape needed to insert a voucher entry row. */
export interface VoucherEntryInsertFields {
  ledgerAccountId?: number | null;
  bankAccountId?: number | null;
  fixedAssetId?: number | null;
  supplierId?: number | null;
  employeeId?: number | null;
  customerId?: number | null;
  factorySupplierId?: number | null;
  debitAmount?: string;
  creditAmount?: string;
  narration?: string | null;
}

/** Shape returned by insertVoucherWithEntriesTx. */
export interface VoucherWithEntries<V = any, E = any> {
  voucher: V;
  entries: E[];
}
