/**
 * voucherPostingService — Phase 10 Central Accounting Engine
 *
 * Inserts one voucher row and its voucher-entry rows atomically using a
 * caller-supplied Drizzle transaction handle. Validation, audit logging,
 * balance synchronization, stock movement, and daybook side effects remain
 * owned by the calling domain service.
 *
 * Phase 3 request-identity hardening:
 * this low-level primitive now requires a validated source identity at its API
 * boundary. The CentralPostingEngine owns the durable lookup/recording around
 * this insert; requiring the identity here prevents future production callers
 * from bypassing that contract accidentally.
 */

import { vouchers, voucherEntries } from "@shared/schema";
import type { PostingSourceIdentity } from "./centralPostingEngine";
import type { VoucherInsertFields, VoucherEntryInsertFields, VoucherWithEntries } from "./accountingTypes";

type VoucherRow = typeof vouchers.$inferSelect;
type VoucherEntryRow = typeof voucherEntries.$inferSelect;

interface TransactionLike {
  insert(table: any): any;
}

interface DatabaseLike {
  transaction: <T>(callback: (tx: TransactionLike) => Promise<T>) => Promise<T>;
}

function requireSourceIdentity(source: PostingSourceIdentity): void {
  for (const [field, value] of [
    ["sourceType", source?.sourceType],
    ["sourceId", source?.sourceId],
    ["idempotencyKey", source?.idempotencyKey],
  ] as const) {
    if (!String(value ?? "").trim()) {
      throw new Error(`${field} is required before a voucher can be inserted`);
    }
  }
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
    currency: voucher.currency ?? "USD",
    exchangeRate: voucher.exchangeRate ?? null,
    effectiveDate: voucher.effectiveDate ?? null,
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
    ledgerAccountId: item.ledgerAccountId ?? null,
    bankAccountId: item.bankAccountId ?? null,
    fixedAssetId: item.fixedAssetId ?? null,
    supplierId: item.supplierId ?? null,
    employeeId: item.employeeId ?? null,
    customerId: item.customerId ?? null,
    factorySupplierId: item.factorySupplierId ?? null,
    debitAmount: item.debitAmount ?? "0",
    creditAmount: item.creditAmount ?? "0",
    narration: item.narration ?? null,
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
  source: PostingSourceIdentity
): Promise<VoucherWithEntries<VoucherRow, VoucherEntryRow>> {
  requireSourceIdentity(source);

  const [voucher] = (await tx.insert(vouchers).values(buildVoucherValues(voucherFields)).returning()) as VoucherRow[];
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
  source: PostingSourceIdentity
): Promise<VoucherWithEntries> {
  requireSourceIdentity(source);
  return db.transaction((tx) => insertVoucherWithEntriesTx(tx, voucherFields, items, source));
}
