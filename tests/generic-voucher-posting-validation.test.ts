import { describe, expect, it } from "vitest";
import {
  buildGenericVoucherPostingRequest,
  supportsCentralGenericVoucher,
} from "../server/services/accounting/genericVoucherPosting";
import { PostingValidationError } from "../server/services/accounting/centralPostingEngine";

const voucher = {
  voucherNumber: "JV-VALIDATION-1",
  voucherType: "Journal",
  voucherDate: "2026-08-11",
  description: "Validation coverage",
  optional: false,
};

const entries = [
  { ledgerAccountId: 10, debitAmount: "25", creditAmount: "0" },
  { ledgerAccountId: 20, debitAmount: "0", creditAmount: "25" },
];

function request(overrides: Record<string, unknown> = {}) {
  return {
    companyId: 1,
    clientRequestId: "generic-validation-1",
    voucher,
    entries,
    exchangeRate: null,
    ...overrides,
  };
}

describe("generic voucher validation coverage", () => {
  it("keeps malformed eligibility inputs on the legacy path", () => {
    expect(supportsCentralGenericVoucher(null)).toBe(false);
    expect(supportsCentralGenericVoucher({})).toBe(false);
    expect(supportsCentralGenericVoucher({ clientRequestId: "x" })).toBe(false);
    expect(supportsCentralGenericVoucher({ clientRequestId: "x", voucher, entries: null })).toBe(false);
  });

  it("rejects invalid company and request identifiers", () => {
    expect(() => buildGenericVoucherPostingRequest(request({ companyId: 0 }) as never)).toThrowError(
      expect.objectContaining<PostingValidationError>({ code: "POSTING_COMPANY_INVALID" }),
    );
    expect(() => buildGenericVoucherPostingRequest(request({ clientRequestId: "" }) as never)).toThrowError(
      expect.objectContaining<PostingValidationError>({ code: "POSTING_REQUEST_ID_REQUIRED" }),
    );
    expect(() =>
      buildGenericVoucherPostingRequest(request({ clientRequestId: "bad request id" }) as never),
    ).toThrowError(expect.objectContaining<PostingValidationError>({ code: "POSTING_REQUEST_ID_INVALID" }));
  });

  it("rejects invalid currency and target identifiers", () => {
    const cfaVoucher = { ...voucher, currency: "CFA" };
    expect(() => buildGenericVoucherPostingRequest(request({ voucher: cfaVoucher }) as never)).toThrowError(
      expect.objectContaining<PostingValidationError>({ code: "POSTING_CURRENCY_INVALID" }),
    );
    const badEntries = [{ ...entries[0], ledgerAccountId: "abc" }, entries[1]];
    expect(() => buildGenericVoucherPostingRequest(request({ entries: badEntries }) as never)).toThrowError(
      expect.objectContaining<PostingValidationError>({ code: "POSTING_TARGET_ID_INVALID" }),
    );
  });

  it("normalizes supported target ids and narration", () => {
    const targetEntries = [
      {
        ledgerAccountId: "10",
        bankAccountId: "11",
        fixedAssetId: "12",
        supplierId: "13",
        employeeId: "14",
        customerId: "15",
        factorySupplierId: "16",
        debitAmount: "25",
        creditAmount: "0",
        narration: "  debit note  ",
      },
      { ledgerAccountId: 20, debitAmount: "0", creditAmount: "25", narration: "   " },
    ];
    const built = buildGenericVoucherPostingRequest(request({ entries: targetEntries }) as never);

    expect(built.request.entries[0]).toMatchObject({
      ledgerAccountId: 10,
      bankAccountId: 11,
      fixedAssetId: 12,
      supplierId: 13,
      employeeId: 14,
      customerId: 15,
      factorySupplierId: 16,
      narration: "debit note",
    });
    expect(built.request.entries[1].narration).toBeNull();
  });
});
