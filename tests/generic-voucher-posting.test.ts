import { describe, expect, it } from "vitest";
import {
  buildGenericVoucherPostingRequest,
  supportsCentralGenericVoucher,
} from "../server/services/accounting/genericVoucherPosting";
import { PostingValidationError } from "../server/services/accounting/centralPostingEngine";

function payload() {
  return {
    clientRequestId: "generic-request-1",
    voucher: {
      voucherNumber: "INS-CHARGE-1",
      voucherType: "Journal",
      voucherDate: "2026-07-25",
      description: "Insurance charge",
      optional: false,
    },
    entries: [
      { ledgerAccountId: 10, debitAmount: "25.00", creditAmount: "0", narration: "Insurance charge" },
      { ledgerAccountId: 20, debitAmount: "0", creditAmount: "25.00", narration: "Insurance charge" },
    ],
  };
}

describe("supportsCentralGenericVoucher", () => {
  it("accepts retry-identified simple USD active vouchers", () => {
    expect(supportsCentralGenericVoucher(payload())).toBe(true);
  });

  it("keeps optional, non-USD, dual-currency, and high-precision payloads on legacy", () => {
    expect(supportsCentralGenericVoucher({
      ...payload(),
      voucher: { ...payload().voucher, optional: true },
    })).toBe(false);

    expect(supportsCentralGenericVoucher({
      ...payload(),
      voucher: { ...payload().voucher, currency: "CFA" },
    })).toBe(false);

    expect(supportsCentralGenericVoucher({
      ...payload(),
      entries: [
        { ...payload().entries[0], transactionCurrency: "USD" },
        payload().entries[1],
      ],
    })).toBe(false);

    expect(supportsCentralGenericVoucher({
      ...payload(),
      entries: [
        { ...payload().entries[0], debitAmount: "25.001" },
        { ...payload().entries[1], creditAmount: "25.001" },
      ],
    })).toBe(false);
  });
});

describe("buildGenericVoucherPostingRequest", () => {
  it("builds a balanced USD posting and preserves voucher compatibility fields", () => {
    const built = buildGenericVoucherPostingRequest({
      companyId: 1,
      clientRequestId: payload().clientRequestId,
      voucher: payload().voucher,
      entries: payload().entries,
      exchangeRate: "2500",
      actor: { userId: "1", username: "tester" },
    });

    expect(built.request.voucher).toMatchObject({
      companyId: 1,
      voucherNumber: "INS-CHARGE-1",
      voucherType: "Journal",
      voucherDate: "2026-07-25",
      totalAmount: "25.00",
      optional: false,
      currency: "USD",
      exchangeRate: "2500",
    });
    expect(built.request.entries).toEqual([
      expect.objectContaining({
        ledgerAccountId: 10,
        debitAmount: "25",
        creditAmount: "0",
        transactionCurrency: "USD",
        baseDebitAmount: "25.000000",
      }),
      expect.objectContaining({
        ledgerAccountId: 20,
        debitAmount: "0",
        creditAmount: "25",
        transactionCurrency: "USD",
        baseCreditAmount: "25.000000",
      }),
    ]);
  });

  it("keeps idempotency stable for the same normalized payload", () => {
    const input = {
      companyId: 1,
      clientRequestId: payload().clientRequestId,
      voucher: payload().voucher,
      entries: payload().entries,
      exchangeRate: null,
    };
    const first = buildGenericVoucherPostingRequest(input);
    const retry = buildGenericVoucherPostingRequest(input);

    expect(retry.request.source.idempotencyKey).toBe(first.request.source.idempotencyKey);
  });

  it("accepts the verified customer plus linked-ledger representation", () => {
    const built = buildGenericVoucherPostingRequest({
      companyId: 1,
      clientRequestId: "customer-linked-1",
      voucher: payload().voucher,
      entries: [
        { customerId: 30, ledgerAccountId: 31, debitAmount: "25", creditAmount: "0" },
        { ledgerAccountId: 20, debitAmount: "0", creditAmount: "25" },
      ],
      exchangeRate: null,
    });

    expect(built.request.entries[0]).toMatchObject({ customerId: 30, ledgerAccountId: 31 });
  });

  it("rejects unbalanced or invalid-side entries before writes", () => {
    expect(() => buildGenericVoucherPostingRequest({
      companyId: 1,
      clientRequestId: "bad-1",
      voucher: payload().voucher,
      entries: [
        { ledgerAccountId: 10, debitAmount: "25", creditAmount: "0" },
        { ledgerAccountId: 20, debitAmount: "0", creditAmount: "24" },
      ],
      exchangeRate: null,
    })).toThrowError(expect.objectContaining<PostingValidationError>({ code: "POSTING_UNBALANCED" }));

    expect(() => buildGenericVoucherPostingRequest({
      companyId: 1,
      clientRequestId: "bad-2",
      voucher: payload().voucher,
      entries: [
        { ledgerAccountId: 10, debitAmount: "25", creditAmount: "1" },
        { ledgerAccountId: 20, debitAmount: "0", creditAmount: "24" },
      ],
      exchangeRate: null,
    })).toThrowError(expect.objectContaining<PostingValidationError>({ code: "POSTING_ENTRY_SIDE_INVALID" }));
  });
});
