/**
 * Guard against editing/voiding/deleting historical vouchers that were copied in
 * read-only mode by the GC-LSHI (or any future) migration tool.
 *
 * A voucher is considered a read-only migrated voucher if either:
 *  - its sourceModule is 'SP_MIGRATION_READONLY' (new migration tool), or
 *  - its voucherNumber starts with 'MIG-' (legacy migrated vouchers created
 *    before the dedicated sourceModule value existed).
 *
 * These vouchers must never move stock again and must never be edited, voided,
 * or deleted — they exist purely as historical accounting record copies.
 */
export function isReadonlyMigratedVoucher(voucher: {
  sourceModule?: string | null;
  voucherNumber?: string | null;
}): boolean {
  if (!voucher) return false;
  if (voucher.sourceModule === "SP_MIGRATION_READONLY") return true;
  if (voucher.voucherNumber && voucher.voucherNumber.startsWith("MIG-")) return true;
  return false;
}

export const READONLY_MIGRATED_VOUCHER_MESSAGE =
  "This voucher was copied in read-only mode by the GC-LSHI migration tool and cannot be edited, voided, or deleted.";
