import { describe, expect, it, vi } from "vitest";
import {
  postBalancedVoucherTx,
  PostingValidationError,
  validateCentralPostingRequest,
  type CentralPostingRequest,
} from "../server/services/accounting/centralPostingEngine";

function request(overrides: Partial<CentralPostingRequest> = {}): CentralPostingRequest {
  return {
    voucher: {
      companyId: 1,
      voucherNumber: "JV-0001",
      voucherType: "JOURNAL",
      voucherDate: "2026-07-18",
      totalAmount: "100.000000",
    },
    entries: [
      { ledgerAccountId: 10, debitAmount: "100.000000", creditAmount: "0" },
      { bankAccountId: 20, debitAmount: "0", creditAmount: "100.000000" },
    ],
    source: {
      sourceType: "test-document",
      sourceId: "doc-1",
      idempotencyKey: "test-document:doc-1:v1",
    },
    actor: { userId: "1", username: "tester" },
    ...overrides,
  };
}

describe("validateCentralPostingRequest", () => {
  it("accepts a balanced decimal posting", () => {
    expect(validateCentralPostingRequest(request())).toEqual({
      debitTotal: "100",
      creditTotal: "100",
    });
  });

  it("rejects unbalanced entries", () => {
    const input = request({
      entries: [
        { ledgerAccountId: 10, debitAmount: "100", creditAmount: "0" },
        { bankAccountId: 20, debitAmount: "0", creditAmount: "99.99" },
      ],
    });
    expect(() => validateCentralPostingRequest(input)).toThrowError(
      expect.objectContaining<PostingValidationError>({ code: "POSTING_UNBALANCED" })
    );
  });

  it("rejects entries with multiple accounting targets", () => {
    const input = request({
      entries: [
        {
          ledgerAccountId: 10,
          customerId: 30,
          debitAmount: "100",
          creditAmount: "0",
        },
        { bankAccountId: 20, debitAmount: "0", creditAmount: "100" },
      ],
    });
    expect(() => validateCentralPostingRequest(input)).toThrowError(
      expect.objectContaining<PostingValidationError>({ code: "POSTING_TARGET_INVALID" })
    );
  });

  it("rejects a declared total that differs from the balanced debit total", () => {
    const input = request({ voucher: { ...request().voucher, totalAmount: "90" } });
    expect(() => validateCentralPostingRequest(input)).toThrowError(
      expect.objectContaining<PostingValidationError>({ code: "POSTING_TOTAL_MISMATCH" })
    );
  });
});

describe("postBalancedVoucherTx", () => {
  it("returns an existing posting without inserting or auditing again", async () => {
    const existing = { voucher: { id: 77 }, entries: [{ id: 88 }] };
    const dependencies = {
      ownership: { validateVoucherOwnership: vi.fn() },
      idempotency: {
        findExisting: vi.fn().mockResolvedValue(existing),
        record: vi.fn(),
      },
      audit: { recordPosting: vi.fn() },
    };

    await expect(postBalancedVoucherTx({}, request(), dependencies)).resolves.toBe(existing);
    expect(dependencies.ownership.validateVoucherOwnership).not.toHaveBeenCalled();
    expect(dependencies.idempotency.record).not.toHaveBeenCalled();
    expect(dependencies.audit.recordPosting).not.toHaveBeenCalled();
  });
});
