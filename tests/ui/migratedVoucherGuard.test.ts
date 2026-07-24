/**
 * Unit tests for client/src/lib/migratedVoucherGuard.ts — detects read-only
 * vouchers copied by the GC-LSHI migration tool. A false negative here would
 * let the UI enable edit/delete on a record that must stay immutable, so the
 * detection rules are pinned down explicitly.
 */
import { isReadonlyMigratedVoucher } from "@/lib/migratedVoucherGuard";

describe("isReadonlyMigratedVoucher", () => {
  it("flags vouchers with the read-only migration source module", () => {
    expect(isReadonlyMigratedVoucher({ sourceModule: "SP_MIGRATION_READONLY" })).toBe(true);
  });

  it("flags vouchers whose number starts with the MIG- prefix", () => {
    expect(isReadonlyMigratedVoucher({ voucherNumber: "MIG-000123" })).toBe(true);
  });

  it("does not flag ordinary vouchers", () => {
    expect(isReadonlyMigratedVoucher({ voucherNumber: "SAL-0001", sourceModule: "sales" })).toBe(
      false,
    );
    expect(isReadonlyMigratedVoucher({})).toBe(false);
  });

  it("does not flag when MIG appears mid-string rather than as a prefix", () => {
    expect(isReadonlyMigratedVoucher({ voucherNumber: "X-MIG-1" })).toBe(false);
  });

  it("is null/undefined safe", () => {
    expect(isReadonlyMigratedVoucher(null as any)).toBe(false);
    expect(isReadonlyMigratedVoucher(undefined as any)).toBe(false);
  });
});
