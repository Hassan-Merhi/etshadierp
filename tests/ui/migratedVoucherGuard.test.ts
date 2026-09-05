/**
 * Unit tests for client/src/lib/migratedVoucherGuard.ts — detects read-only
 * vouchers copied by the GC-LSHI migration tool. A false negative here would
 * let the UI enable edit/delete on a record that must stay immutable, so the
 * detection rules are pinned down explicitly.
 */
import {
  isGoldenCoastPosCashSettlementVoucher,
  isGoldenCoastProgrammeVoucher,
  isReadonlyMigratedVoucher,
  isVoucherMutationBlocked,
  voucherLockLabel,
} from "@/lib/migratedVoucherGuard";

describe("isReadonlyMigratedVoucher", () => {
  it("flags vouchers with the read-only migration source module", () => {
    expect(isReadonlyMigratedVoucher({ sourceModule: "SP_MIGRATION_READONLY" })).toBe(true);
  });

  it("flags vouchers whose number starts with the MIG- prefix", () => {
    expect(isReadonlyMigratedVoucher({ voucherNumber: "MIG-000123" })).toBe(true);
  });

  it("does not flag ordinary vouchers", () => {
    expect(isReadonlyMigratedVoucher({ voucherNumber: "SAL-0001", sourceModule: "sales" })).toBe(false);
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

describe("isGoldenCoastProgrammeVoucher", () => {
  it("flags every Golden Coast programme voucher number", () => {
    // One per generator: cutover, POS sale, settlement pair, deduction, HADI
    // transfer, container offload, savings withdrawal, monthly close, reversal.
    for (const voucherNumber of [
      "GC-CUTOVER-20260901",
      "GC-POS-C7-req1",
      "GC-POS-C7-req1-COGS",
      "GC-POS-abc-create-PAYABLE",
      "GC-POS-abc-create-CASH-HADI",
      "GC-POS-C7-req1-DED",
      "GC-P7-C7-req1-COLLECT",
      "GC-SCS-C7-req1",
      "GC-C8-7-req1-O",
      "GC-HSW-C7-req1",
      "GC-MC-C7-202607",
      "GC-POS-abc-create-CASH-REV-2",
    ]) {
      expect(isGoldenCoastProgrammeVoucher({ voucherNumber })).toBe(true);
    }
  });

  it("does not flag ordinary vouchers or a mid-string GC-", () => {
    expect(isGoldenCoastProgrammeVoucher({ voucherNumber: "SAL-0001" })).toBe(false);
    expect(isGoldenCoastProgrammeVoucher({ voucherNumber: "X-GC-1" })).toBe(false);
    expect(isGoldenCoastProgrammeVoucher({})).toBe(false);
    expect(isGoldenCoastProgrammeVoucher(null as any)).toBe(false);
  });
});

describe("Golden Coast POS cash settlement delete exception", () => {
  it("recognizes only CASH/CASH-HADI settlement journals, including revisions", () => {
    for (const voucherNumber of [
      "GC-POS-abc-create-CASH",
      "GC-POS-abc-create-CASH-HADI",
      "GC-POS-abc-edit2-CASH",
      "GC-POS-abc-edit2-CASH-HADI",
      "GC-POS-abc-create-CASH-REV-2",
      "GC-POS-abc-create-CASH-HADI-REV-2",
    ]) {
      expect(isGoldenCoastPosCashSettlementVoucher({ voucherNumber })).toBe(true);
    }

    for (const voucherNumber of ["GC-POS-abc-create-PAYABLE", "GC-POS-C7-req1", "GC-SCS-C7-req1", "SAL-0001"]) {
      expect(isGoldenCoastPosCashSettlementVoucher({ voucherNumber })).toBe(false);
    }
  });
});

describe("isVoucherMutationBlocked", () => {
  it("blocks protected classes while allowing the dedicated POS cash-delete lifecycle", () => {
    expect(isVoucherMutationBlocked({ sourceModule: "SP_MIGRATION_READONLY" })).toBe(true);
    expect(isVoucherMutationBlocked({ voucherNumber: "MIG-1" })).toBe(true);
    expect(isVoucherMutationBlocked({ voucherNumber: "GC-SCS-C7-req1" })).toBe(true);
    expect(isVoucherMutationBlocked({ voucherNumber: "GC-POS-abc-create-PAYABLE" })).toBe(true);
    expect(isVoucherMutationBlocked({ voucherNumber: "GC-POS-abc-create-CASH" })).toBe(false);
    expect(isVoucherMutationBlocked({ voucherNumber: "GC-POS-abc-create-CASH-HADI" })).toBe(false);
    expect(isVoucherMutationBlocked({ voucherNumber: "SAL-0001", sourceModule: "sales" })).toBe(false);
  });

  it("labels each protected class distinctly so the UI can explain the lock", () => {
    expect(voucherLockLabel({ voucherNumber: "MIG-1" })).toBe("Read-only migration");
    expect(voucherLockLabel({ voucherNumber: "GC-SCS-C7-req1" })).toBe("Golden Coast posting");
    expect(voucherLockLabel({ voucherNumber: "SAL-0001" })).toBeNull();
  });
});

/**
 * Golden Coast Phase 15 — French/Arabic UI verification.
 *
 * The payable rename introduced and reworded a set of Golden Coast panel
 * strings. Each must resolve in both non-English languages, or a French or
 * Arabic user reads the old receivable wording in English while the English
 * UI says "payable".
 */
import { isFinalCloseoutText, translateFinalCloseoutText } from "@/i18n/finalCloseoutTranslations";

const PAYABLE_MODEL_STRINGS = [
  "GC Sales Cash payable",
  "GC Sales Cash payable due",
  "Outstanding payable balance",
  "Direct GC Sales Cash payment is ready.",
  "Payment is not ready. Refresh after resolving the server-reported account state.",
  "Payment date",
  "Paying cash/bank account",
  "Transfer fee (USD)",
  "Shared Charges is not configured, so no transfer fee can be charged.",
  "Paid on top of the settlement and booked to Shared Charges; the payable still falls by the full amount.",
  "The outstanding sales-cash payable was refreshed.",
  "Phase 10 pays down only the server-calculated outstanding GC Sales Cash payable, out of an approved Golden Coast cash or bank account.",
  "A collection raises the GC Sales Cash payable and is not capped by it.",
];

describe("Golden Coast payable-model strings", () => {
  it.each(PAYABLE_MODEL_STRINGS)("translates %s into French and Arabic", (text) => {
    expect(isFinalCloseoutText(text)).toBe(true);

    for (const language of ["fr", "ar"] as const) {
      const translated = translateFinalCloseoutText(text, language);
      expect(translated).toBeTruthy();
      // A translation that is still the English source is an untranslated stub.
      expect(translated).not.toBe(text);
    }
  });

  it("keeps the English rendering unchanged", () => {
    expect(translateFinalCloseoutText("Payment date", "en")).toBe("Payment date");
  });
});
