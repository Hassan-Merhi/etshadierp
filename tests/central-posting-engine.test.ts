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

  it("accepts the customer plus linked-ledger compatibility shape", () => {
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

    expect(validateCentralPostingRequest(input)).toEqual({
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

  it("rejects unrelated multiple accounting targets", () => {
    const input = request({
      entries: [
        {
          ledgerAccountId: 10,
          supplierId: 30,
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
  it("returns an existing posting as a replay without inserting or auditing again", async () => {
    const existing = { voucher: { id: 77 }, entries: [{ id: 88 }] };
    // The engine asserts the transaction-local company scope before it looks
    // for an existing posting, so the stub transaction has to run statements.
    const tx = { execute: vi.fn(async () => ({ rows: [] })) };
    const dependencies = {
      ownership: { validateVoucherOwnership: vi.fn() },
      idempotency: {
        findExisting: vi.fn().mockResolvedValue(existing),
        record: vi.fn(),
      },
      audit: { recordPosting: vi.fn() },
    };

    await expect(postBalancedVoucherTx(tx, request(), dependencies)).resolves.toEqual({
      ...existing,
      replayed: true,
    });
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(dependencies.ownership.validateVoucherOwnership).not.toHaveBeenCalled();
    expect(dependencies.idempotency.record).not.toHaveBeenCalled();
    expect(dependencies.audit.recordPosting).not.toHaveBeenCalled();
  });

  it("rejects a posting into a month the Golden Coast monthly close finalized", async () => {
    // execute() is called twice before ownership: the transaction-scope
    // assertion, then the finalized-period probe. Only the second returns a row.
    const tx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ finalized: 1 }] }),
    };
    const dependencies = {
      ownership: { validateVoucherOwnership: vi.fn() },
      idempotency: { findExisting: vi.fn().mockResolvedValue(null), record: vi.fn() },
      audit: { recordPosting: vi.fn() },
    };

    await expect(postBalancedVoucherTx(tx, request(), dependencies)).rejects.toThrowError(
      expect.objectContaining<PostingValidationError>({ code: "POSTING_PERIOD_FINALIZED" })
    );
    // A frozen period must stop before anything is written or audited.
    expect(dependencies.ownership.validateVoucherOwnership).not.toHaveBeenCalled();
    expect(dependencies.idempotency.record).not.toHaveBeenCalled();
    expect(dependencies.audit.recordPosting).not.toHaveBeenCalled();
  });

  it("skips the finalized-period probe when the voucher date carries no YYYY-MM", async () => {
    const tx = { execute: vi.fn(async () => ({ rows: [] })) };
    const ownershipReached = new Error("ownership reached");
    const dependencies = {
      ownership: { validateVoucherOwnership: vi.fn().mockRejectedValue(ownershipReached) },
      idempotency: { findExisting: vi.fn().mockResolvedValue(null), record: vi.fn() },
      audit: { recordPosting: vi.fn() },
    };
    const input = request();
    input.voucher.voucherDate = "not-a-date";

    await expect(postBalancedVoucherTx(tx, input, dependencies)).rejects.toBe(ownershipReached);
    // Only the transaction-scope assertion ran: with no month to check, the
    // guard returns before querying rather than treating it as finalized.
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });
});
