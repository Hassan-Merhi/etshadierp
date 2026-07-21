/**
 * voucherPostingService — Phase 10 Central Accounting Engine
 *
 * Inserts one voucher row and its voucher-entry rows atomically using a
 * caller-supplied Drizzle transaction handle. Validation, audit logging,
 * balance synchronization, stock movement, and daybook side effects remain
 * owned by the calling domain service.
 *
 * Phase 1 multi-currency update:
 * buildEntryValues now persists all dual-currency fields from NormalizedEntryAmounts
 * or raw VoucherEntryInsertFields. Backward-compatible debitAmount / creditAmount
 * are always written as the historical base-currency (USD) amounts.
 */

import { vouchers, voucherEntries } from "@shared/schema";
import type { VoucherInsertFields, VoucherEntryInsertFields, VoucherWithEntries } from "./accountingTypes";

type VoucherRow = typeof vouchers.$inferSelect;
type VoucherEntryRow = typeof voucherEntries.$inferSelect;

// Method-syntax members (not property arrows) so parameters compare
// bivariantly — this lets a concrete Drizzle PgTransaction satisfy the
// structural contract without a cast at every call site.
interface TransactionLike {
  insert(table: any): any;
}

interface DatabaseLike {
  transaction: <T>(callback: (tx: TransactionLike) => Promise<T>) => Promise<T>;
}

function buildVoucherValues(voucher: VoucherInsertFields) {
  return {
    companyId: voucher.companyId,
    voucherNumber: voucher.voucherNumber,
    voucherType: voucher.voucherType,
    voucherDate: voucher.voucherDate,
    totalAmount: voucher.totalAmount,
    description: voucher.description ?? null,
    locationId: voucher.locationId ?? null,
    optional: voucher.optional ?? false,
    currency: voucher.currency ?? null,
    exchangeRate: voucher.exchangeRate ?? null,
    sourceModule: voucher.sourceModule ?? null,
  };
}

/**
 * Build the database row for a voucher entry.
 *
 * Dual-currency fields are persisted when provided. For new entries the caller
 * should supply values derived from normalizeVoucherEntryAmounts() so that:
 *
 *   debitAmount  = baseDebitAmount  (historical USD, backward-compat)
 *   creditAmount = baseCreditAmount (historical USD, backward-compat)
 *
 * Callers that do not supply dual-currency fields get the legacy behaviour
 * (debitAmount / creditAmount written as-is, new columns left null).
 */
function buildEntryValues(voucherId: number, item: VoucherEntryInsertFields) {
  return {
    voucherId,
    // ── Account linkage ──────────────────────────────────────────────────────
    ledgerAccountId: item.ledgerAccountId ?? null,
    bankAccountId: item.bankAccountId ?? null,
    fixedAssetId: item.fixedAssetId ?? null,
    supplierId: item.supplierId ?? null,
    employeeId: item.employeeId ?? null,
    customerId: item.customerId ?? null,
    factorySupplierId: item.factorySupplierId ?? null,
    // ── Backward-compatible amounts (always base/USD for new rows) ────────────
    debitAmount: item.debitAmount ?? "0",
    creditAmount: item.creditAmount ?? "0",
    narration: item.narration ?? null,
    // ── Dual-currency fields ─────────────────────────────────────────────────
    transactionCurrency: item.transactionCurrency ?? null,
    transactionDebitAmount: item.transactionDebitAmount ?? null,
    transactionCreditAmount: item.transactionCreditAmount ?? null,
    baseDebitAmount: item.baseDebitAmount ?? null,
    baseCreditAmount: item.baseCreditAmount ?? null,
    historicalExchangeRate: item.historicalExchangeRate ?? null,
    rateConvention: item.rateConvention ?? null,
  };
}

export async function insertVoucherWithEntriesTx(
  tx: TransactionLike,
  voucherFields: VoucherInsertFields,
  items: VoucherEntryInsertFields[],
): Promise<VoucherWithEntries<VoucherRow, VoucherEntryRow>> {
  const [voucher] = (await tx
    .insert(vouchers)
    .values(buildVoucherValues(voucherFields))
    .returning()) as VoucherRow[];
  if (!voucher || typeof voucher !== "object" || !("id" in voucher)) {
    throw new Error("Voucher insert did not return a persisted voucher");
  }

  const voucherId = Number(voucher.id);
  if (!Number.isInteger(voucherId) || voucherId <= 0) {
    throw new Error("Voucher insert returned an invalid voucher id");
  }

  if (items.length === 0) {
    return { voucher, entries: [] };
  }

  const entries = await tx
    .insert(voucherEntries)
    .values(items.map((item) => buildEntryValues(voucherId, item)))
    .returning();

  return { voucher, entries };
}

export async function insertVoucherWithEntries(
  db: DatabaseLike,
  voucherFields: VoucherInsertFields,
  items: VoucherEntryInsertFields[],
): Promise<VoucherWithEntries> {
  return db.transaction((tx) => insertVoucherWithEntriesTx(tx, voucherFields, items));
}
