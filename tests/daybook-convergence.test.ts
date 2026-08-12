import { describe, expect, it } from "vitest";
import { buildFactoryDaybookPosting } from "../server/services/accounting/daybookConvergence";

describe("buildFactoryDaybookPosting", () => {
  it("preserves USD totals as decimal strings without floating-point conversion", () => {
    const row = buildFactoryDaybookPosting({
      companyId: 7,
      voucher: {
        id: 101,
        voucherDate: "2026-08-12",
        voucherType: "Payment",
        voucherNumber: "PAYMENT-101",
        currency: "USD",
        totalAmount: "1234567890.123456",
      },
    });

    expect(row.amountUsd).toBe("1234567890.123456");
    expect(row.amountCurrency).toBe("1234567890.123456");
    expect(row.currencyCode).toBe("USD");
    expect(row.txType).toBe("PAYMENT");
  });

  it("converts a non-USD voucher using the stored historical ERP rate exactly", () => {
    const row = buildFactoryDaybookPosting({
      companyId: 7,
      voucher: {
        id: 102,
        voucherDate: "2026-08-12",
        voucherType: "Receipt",
        voucherNumber: "RECEIPT-102",
        currency: "CFA",
        exchangeRate: "600.125",
        totalAmount: "10.500000",
      },
    });

    expect(row.amountUsd).toBe("10.500000");
    expect(row.amountCurrency).toBe("6301.312500");
    expect(row.txType).toBe("RECEIPT");
  });

  it("rejects a missing or non-positive rate for non-USD daybook mirrors", () => {
    expect(() =>
      buildFactoryDaybookPosting({
        companyId: 7,
        voucher: {
          id: 103,
          voucherDate: "2026-08-12",
          voucherType: "Payment",
          voucherNumber: "PAYMENT-103",
          currency: "CFA",
          exchangeRate: null,
          totalAmount: "1",
        },
      })
    ).toThrow(/exchangeRate must be positive/);
  });

  it("rejects unrelated voucher types so convergence cannot mirror the wrong workflow", () => {
    expect(() =>
      buildFactoryDaybookPosting({
        companyId: 7,
        voucher: {
          id: 104,
          voucherDate: "2026-08-12",
          voucherType: "Journal",
          voucherNumber: "JOURNAL-104",
          currency: "USD",
          totalAmount: "1",
        },
      })
    ).toThrow(/Unsupported factory daybook voucher type/);
  });
});
