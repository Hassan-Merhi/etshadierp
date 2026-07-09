/**
 * Client-side mirror of server/lib/migratedVoucherGuard.ts — detects vouchers
 * copied in read-only mode by the GC-LSHI migration tool so the UI can disable
 * edit/delete actions and show a "Read-only migration" badge.
 */
export function isReadonlyMigratedVoucher(voucher: { voucherNumber?: string | null; sourceModule?: string | null }) {
  if (!voucher) return false;
  if ((voucher as any).sourceModule === "SP_MIGRATION_READONLY") return true;
  if (voucher.voucherNumber && voucher.voucherNumber.startsWith("MIG-")) return true;
  return false;
}
