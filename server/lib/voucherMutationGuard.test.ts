/**
 * Golden Coast Phase 15 — "old documents cannot be altered incorrectly".
 *
 * Two classes of voucher must never be mutated in place: read-only migration
 * copies, and vouchers the Golden Coast programme posted through the central
 * engine. The second class is the one Phase 15 added: those vouchers carry an
 * idempotency marker describing their exact entries, and every Golden Coast
 * route caps new postings against balances they contribute to, so a hand edit
 * both corrupts the GC Sales Cash payable and makes the next replay of the same
 * client request fail as inconsistent.
 *
 * The suite also checks that every write path into vouchers/voucher entries
 * asks the combined question rather than testing one protection alone — the
 * failure mode a reviewer previously caught on the migration guard.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  GOLDEN_COAST_PROGRAMME_VOUCHER_MESSAGE,
  READONLY_MIGRATED_VOUCHER_MESSAGE,
  isGoldenCoastProgrammeVoucher,
  voucherMutationBlockReason,
} from "./migratedVoucherGuard";

describe("isGoldenCoastProgrammeVoucher", () => {
  it("flags a voucher from every Golden Coast generator", () => {
    for (const voucherNumber of [
      "GC-CUTOVER-20260901",
      "GC-POS-C7-req1",
      "GC-POS-C7-req1-COGS",
      "GC-POS-abc-create-PAYABLE",
      "GC-POS-abc-create-CASH",
      "GC-POS-abc-create-CASH-HADI",
      "GC-POS-C7-req1-DED",
      "GC-P7-C7-req1-COLLECT",
      "GC-P7-C7-req1-REMIT-HADI",
      "GC-SCS-C7-req1",
      "GC-C8-7-req1-F",
      "GC-HSW-C7-req1",
      "GC-MC-C7-202607",
      "GC-POS-abc-create-CASH-REV-2",
    ]) {
      expect(isGoldenCoastProgrammeVoucher({ voucherNumber })).toBe(true);
    }
  });

  it("leaves ordinary vouchers editable", () => {
    expect(isGoldenCoastProgrammeVoucher({ voucherNumber: "SAL-0001" })).toBe(false);
    expect(isGoldenCoastProgrammeVoucher({ voucherNumber: "X-GC-1" })).toBe(false);
    expect(isGoldenCoastProgrammeVoucher({ voucherNumber: null })).toBe(false);
    expect(isGoldenCoastProgrammeVoucher({})).toBe(false);
  });
});

describe("voucherMutationBlockReason", () => {
  it("reports the migration reason for a read-only migrated voucher", () => {
    expect(voucherMutationBlockReason({ sourceModule: "SP_MIGRATION_READONLY" })).toBe(
      READONLY_MIGRATED_VOUCHER_MESSAGE
    );
    expect(voucherMutationBlockReason({ voucherNumber: "MIG-000123" })).toBe(READONLY_MIGRATED_VOUCHER_MESSAGE);
  });

  it("reports the programme reason for a Golden Coast voucher", () => {
    expect(voucherMutationBlockReason({ voucherNumber: "GC-SCS-C7-req1" })).toBe(
      GOLDEN_COAST_PROGRAMME_VOUCHER_MESSAGE
    );
  });

  it("returns null for an ordinary editable voucher", () => {
    expect(voucherMutationBlockReason({ voucherNumber: "SAL-0001", sourceModule: "sales" })).toBeNull();
    expect(voucherMutationBlockReason(null as never)).toBeNull();
  });

  it("keeps the migration reason when a voucher somehow matches both", () => {
    expect(voucherMutationBlockReason({ voucherNumber: "GC-X", sourceModule: "SP_MIGRATION_READONLY" })).toBe(
      READONLY_MIGRATED_VOUCHER_MESSAGE
    );
  });

  it("still refuses to mutate a Golden Coast reversal voucher", () => {
    // Reversals are themselves programme postings: correcting one means posting
    // another reversal, never editing the reversal in place.
    expect(voucherMutationBlockReason({ voucherNumber: "GC-POS-abc-create-CASH-REV-2" })).toBe(
      GOLDEN_COAST_PROGRAMME_VOUCHER_MESSAGE
    );
  });
});

describe("voucher mutation write paths", () => {
  /**
   * Companion tables have independent mutation endpoints, so the guard has to
   * reach every one of them, not just the routes with "edit" in the name.
   */
  it("asks the combined question everywhere, never one protection alone", () => {
    const files = execFileSync(
      "grep",
      ["-rl", "voucherMutationBlockReason\\|isReadonlyMigratedVoucher", "--include=*.ts", "server/"],
      { encoding: "utf8" }
    )
      .split("\n")
      .filter((file) => file && !file.endsWith(".test.ts") && !file.includes("migratedVoucherGuard.ts"));

    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("voucherMutationBlockReason");
      // A write path that consults only the migration guard would silently let
      // a Golden Coast programme voucher through.
      expect(source).not.toContain("isReadonlyMigratedVoucher(");
    }
  });
});
