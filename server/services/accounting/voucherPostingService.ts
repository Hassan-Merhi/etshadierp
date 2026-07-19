/**
 * voucherPostingService — Phase 10 Central Accounting Engine
 *
 * Inserts one voucher row and its voucher-entry rows atomically using a
 * caller-supplied Drizzle transaction handle. Validation, audit logging,
 * balance synchronization, stock movement, and daybook side effects remain
 * owned by the calling domain service.
 */

import { vouchers, voucherEntries } from "@shared/schema";
import type { VoucherInsertFields, VoucherEntryInsertFields, VoucherWithEntries } from "./accountingTypes";

interface TransactionLike {
  insert: (table: unknown) => {
    values: (values: unknown) => {
      returning: () => Promise<unknown[]>;
    };
  };
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
  };
}

export async function insertVoucherWithEntriesTx(
  tx: TransactionLike,
  voucherFields: VoucherInsertFields,
  items: VoucherEntryInsertFields[],
): Promise<VoucherWithEntries> {
  const [voucher] = await tx.insert(vouchers).values(buildVoucherValues(voucherFields)).returning();
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
