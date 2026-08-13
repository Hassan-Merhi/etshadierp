import { describe, expect, it, vi } from "vitest";
import {
  buildExactVoucherReversal,
  reverseVoucherExactlyTx,
} from "../server/services/accounting/voucherReversal";

const original = {
  voucher: {
    id: 91,
    companyId: 7,
    voucherNumber: "PAY-91",
    voucherType: "Payment",
    voucherDate: "2026-08-01",
    totalAmount: "12.345600",
    currency: "CFA",
    exchangeRate: "650.125000",
    locationId: 4,
    optional: false,
    sourceModule: "ERP",
    deletedAt: null,
  },
  entries: [
    {
      id: 1,
      voucherId: 91,
      ledgerAccountId: 11,
      debitAmount: "12.345600",
      creditAmount: "0",
      transactionCurrency: "CFA",
      transactionDebitAmount: "8026.543210",
      transactionCreditAmount: "0.000000",
      baseDebitAmount: "12.345600",
      baseCreditAmount: "0.000000",
      historicalExchangeRate: "650.1250000000",
      rateConvention: "TRANSACTION_PER_BASE",
    },
    {
      id: 2,
      voucherId: 91,
      bankAccountId: 3,
      debitAmount: "0",
      creditAmount: "12.345600",
      transactionCurrency: "CFA",
      transactionDebitAmount: "0.000000",
      transactionCreditAmount: "8026.543210",
      baseDebitAmount: "0.000000",
      baseCreditAmount: "12.345600",
      historicalExchangeRate: "650.1250000000",
      rateConvention: "TRANSACTION_PER_BASE",
    },
  ],
};

describe("exact voucher reversal", () => {
  it("derives all monetary and ownership fields from the locked original", () => {
    const reversal = buildExactVoucherReversal({
      companyId: 7,
      originalVoucherId: 91,
      original,
      reversalVoucherNumber: "REV-91",
      reversalDate: "2026-08-13",
    });

    expect(reversal.voucher).toMatchObject({
      companyId: 7,
      voucherNumber: "REV-91",
      voucherType: "Payment",
      totalAmount: "12.345600",
      currency: "CFA",
      exchangeRate: "650.125000",
      locationId: 4,
      sourceModule: "ERP",
    });
    expect(reversal.entries[0]).toMatchObject({
      ledgerAccountId: 11,
      debitAmount: "0",
      creditAmount: "12.345600",
      transactionDebitAmount: "0.000000",
      transactionCreditAmount: "8026.543210",
      baseDebitAmount: "0.000000",
      baseCreditAmount: "12.345600",
      historicalExchangeRate: "650.1250000000",
    });
    expect(reversal.entries[1]).toMatchObject({
      bankAccountId: 3,
      debitAmount: "12.345600",
      creditAmount: "0",
      transactionDebitAmount: "8026.543210",
      transactionCreditAmount: "0.000000",
    });
  });

  it("fails closed when the locked row belongs to another company", () => {
    expect(() =>
      buildExactVoucherReversal({
        companyId: 8,
        originalVoucherId: 91,
        original,
        reversalVoucherNumber: "REV-91",
        reversalDate: "2026-08-13",
      }),
    ).toThrow(/different company/i);
  });

  it("forbids reversal-of-reversal chains", () => {
    expect(() =>
      buildExactVoucherReversal({
        companyId: 7,
        originalVoucherId: 91,
        original: { ...original, isReversal: true },
        reversalVoucherNumber: "REV-REV-91",
        reversalDate: "2026-08-13",
      }),
    ).toThrow(/cannot itself be reversed/i);
  });

  it("uses a deterministic source key so retries replay instead of double-posting", async () => {
    const loader = { loadOriginalForUpdate: vi.fn().mockResolvedValue(original) };
    const existing = { voucher: { id: 200 }, entries: [] };
    const dependencies: any = {
      ownership: { validateVoucherOwnership: vi.fn() },
      idempotency: {
        findExisting: vi.fn().mockResolvedValue(existing),
        record: vi.fn(),
      },
      audit: { recordPosting: vi.fn() },
    };

    const result = await reverseVoucherExactlyTx(
      {},
      {
        companyId: 7,
        originalVoucherId: 91,
        reversalVoucherNumber: "REV-91",
        reversalDate: "2026-08-13",
      },
      loader,
      dependencies,
    );

    expect(loader.loadOriginalForUpdate).toHaveBeenCalledWith({
      tx: {},
      companyId: 7,
      voucherId: 91,
    });
    expect(dependencies.idempotency.findExisting).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 7,
        source: {
          sourceType: "voucher-reversal",
          sourceId: "91",
          idempotencyKey: "voucher-reversal:7:91",
        },
      }),
    );
    expect(result.replayed).toBe(true);
    expect(dependencies.idempotency.record).not.toHaveBeenCalled();
  });
});
