import { describe, expect, it } from "vitest";
import {
  buildGoldenCoastFreshStartHadiPaymentPostings,
  goldenCoastFreshStartHadiPaymentDigest,
  parseGoldenCoastFreshStartHadiPayment,
  planGoldenCoastFreshStartHadiPayment,
  GoldenCoastFreshStartHadiPaymentError,
  type GoldenCoastFreshStartHadiPaymentAccounts,
} from "./goldenCoastFreshStartHadiPayment";

const accounts: GoldenCoastFreshStartHadiPaymentAccounts = {
  gcSalesCashAccountId: 101,
  goldenCoastHadiIntercompanyAccountId: 102,
  hadiGoldenCoastIntercompanyAccountId: 201,
};

function payment() {
  return parseGoldenCoastFreshStartHadiPayment({
    companyId: 14,
    hadiCompanyId: 1,
    body: {
      paymentDate: "2026-09-12",
      amountUsd: "300.00",
      clientRequestId: "fresh-start-001",
      reference: "Supplier settlement",
      hadiCashAccount: { kind: "bank", id: 301 },
    },
  });
}

describe("Golden Coast Fresh Start payment from HADI", () => {
  it("reduces the GC Sales Cash tracker and the HADI intercompany asset together", () => {
    const parsed = payment();
    const plan = planGoldenCoastFreshStartHadiPayment({
      payment: parsed,
      gcSalesCashPayableUsd: "1000.00",
      outstandingHadiSalesCashUsd: "1000.00",
      hadiIntercompanyAssetUsd: "1000.00",
    });
    expect(plan.gcSalesCashPayableAfterUsd).toBe("700.00");
    expect(plan.outstandingHadiSalesCashAfterUsd).toBe("700.00");
    expect(plan.hadiIntercompanyAssetAfterUsd).toBe("700.00");

    const digest = goldenCoastFreshStartHadiPaymentDigest({
      payment: parsed,
      accounts,
    });
    const postings = buildGoldenCoastFreshStartHadiPaymentPostings({
      plan,
      accounts,
      digest,
      goldenCoastExchangeRate: null,
      hadiExchangeRate: null,
    });
    const gc = postings.find(
      (posting) => posting.role === "golden_coast",
    )!.request;
    const hadi = postings.find((posting) => posting.role === "hadi")!.request;

    expect(gc.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ledgerAccountId: 101,
          debitAmount: "300",
          creditAmount: "0",
        }),
        expect.objectContaining({
          ledgerAccountId: 102,
          debitAmount: "0",
          creditAmount: "300",
        }),
      ]),
    );
    expect(hadi.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ledgerAccountId: 201,
          debitAmount: "300",
          creditAmount: "0",
        }),
        expect.objectContaining({
          bankAccountId: 301,
          debitAmount: "0",
          creditAmount: "300",
        }),
      ]),
    );
  });

  it("uses the smallest payable/HADI balance as the payment cap", () => {
    expect(() =>
      planGoldenCoastFreshStartHadiPayment({
        payment: payment(),
        gcSalesCashPayableUsd: "250.00",
        outstandingHadiSalesCashUsd: "1000.00",
        hadiIntercompanyAssetUsd: "1000.00",
      }),
    ).toThrow(GoldenCoastFreshStartHadiPaymentError);

    expect(() =>
      planGoldenCoastFreshStartHadiPayment({
        payment: payment(),
        gcSalesCashPayableUsd: "1000.00",
        outstandingHadiSalesCashUsd: "250.00",
        hadiIntercompanyAssetUsd: "1000.00",
      }),
    ).toThrow(GoldenCoastFreshStartHadiPaymentError);

    expect(() =>
      planGoldenCoastFreshStartHadiPayment({
        payment: payment(),
        gcSalesCashPayableUsd: "1000.00",
        outstandingHadiSalesCashUsd: "1000.00",
        hadiIntercompanyAssetUsd: "250.00",
      }),
    ).toThrow(GoldenCoastFreshStartHadiPaymentError);
  });

  it("binds idempotency digest to the economic payload", () => {
    const first = payment();
    const second = parseGoldenCoastFreshStartHadiPayment({
      companyId: 14,
      hadiCompanyId: 1,
      body: {
        paymentDate: "2026-09-12",
        amountUsd: "301.00",
        clientRequestId: "fresh-start-001",
        reference: "Supplier settlement",
        hadiCashAccount: { kind: "bank", id: 301 },
      },
    });
    expect(
      goldenCoastFreshStartHadiPaymentDigest({ payment: first, accounts }),
    ).not.toBe(
      goldenCoastFreshStartHadiPaymentDigest({ payment: second, accounts }),
    );
  });
});
