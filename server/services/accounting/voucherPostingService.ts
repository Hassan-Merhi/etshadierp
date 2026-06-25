/**
 * voucherPostingService — Phase 10 Central Accounting Engine
 *
 * Safe extraction of the lowest-level voucher + entries insertion boilerplate
 * (Pattern A from the accounting audit).
 *
 * WHAT THIS DOES:
 *   Inserts one voucher row and N voucher-entry rows atomically, using
 *   a caller-supplied Drizzle transaction handle, and returns both.
 *
 * WHAT THIS DOES NOT DO:
 *   - No validation (caller owns debit=credit enforcement)
 *   - No balance sync (caller calls syncEmployeeBalancesFromEntries if needed)
 *   - No audit log (caller calls logAudit if needed)
 *   - No notifications / side effects
 *   - No daybook posting
 *   - No stock mutations
 *
 * Preserves the exact operation order: voucher insert → entries insert (loop).
 */

import { vouchers, voucherEntries } from "@shared/schema";
import type { VoucherInsertFields, VoucherEntryInsertFields, VoucherWithEntries } from "./accountingTypes";

/**
 * Insert a single voucher row followed by its entry rows inside an existing
 * Drizzle transaction. Returns the persisted voucher and entries.
 *
 * @param tx     Drizzle transaction handle (from db.transaction callback arg)
 * @param v      Voucher field values
 * @param items  Array of entry field values (may be empty)
 */
export async function insertVoucherWithEntriesTx(
  tx: any,
  v: VoucherInsertFields,
  items: VoucherEntryInsertFields[]
): Promise<VoucherWithEntries> {
  const [voucher] = await tx
    .insert(vouchers)
    .values({
      companyId: v.companyId,
      voucherNumber: v.voucherNumber,
      voucherType: v.voucherType,
      voucherDate: v.voucherDate,
      totalAmount: v.totalAmount,
      description: v.description ?? null,
      locationId: v.locationId ?? null,
      optional: v.optional ?? false,
      currency: v.currency ?? null,
      exchangeRate: v.exchangeRate ?? null,
    })
    .returning();

  const entries: (typeof voucherEntries.$inferSelect)[] = [];

  for (const item of items) {
    const [entry] = await tx
      .insert(voucherEntries)
      .values({
        voucherId: voucher.id,
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
      })
      .returning();
    entries.push(entry);
  }

  return { voucher, entries };
}

/**
 * Convenience wrapper: opens a new Drizzle transaction, inserts voucher +
 * entries, and returns the result. Use this only when the call site does NOT
 * already have an open transaction. When an outer transaction exists, use
 * insertVoucherWithEntriesTx directly.
 *
 * @param db     Drizzle db instance
 * @param v      Voucher field values
 * @param items  Array of entry field values
 */
export async function insertVoucherWithEntries(
  db: any,
  v: VoucherInsertFields,
  items: VoucherEntryInsertFields[]
): Promise<VoucherWithEntries> {
  return db.transaction(async (tx: any) => {
    return insertVoucherWithEntriesTx(tx, v, items);
  });
}
