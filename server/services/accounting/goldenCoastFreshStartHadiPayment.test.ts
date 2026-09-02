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
  freshStartEquityAccountId: 101,
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
  it("reduces both Fresh Start equity and the HADI intercompany asset", () => {
    const parsed = payment();
    const plan = planGoldenCoastFreshStartHadiPayment({
      payment: parsed,
      outstandingSalesCashUsd: "1000.00",
      hadiIntercompanyAssetUsd: "1000.00",
    });
    expect(plan.outstandingSalesCashAfterUsd).toBe("700.00");
    expect(plan.hadiIntercompanyAssetAfterUsd).toBe("700.00");

    const digest = goldenCoastFreshStartHadiPaymentDigest({ payment: parsed, accounts });
    const postings = buildGoldenCoastFreshStartHadiPaymentPostings({
      plan,
      accounts,
      digest,
      goldenCoastExchangeRate: null,
      hadiExchangeRate: null,
    });
    const gc = postings.find((posting) => posting.role === "golden_coast")!.request;
    const hadi = postings.find((posting) => posting.role === "hadi")!.request;

    expect(gc.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ledgerAccountId: 101, debitAmount: "300.00", creditAmount: "0" }),
        expect.objectContaining({ ledgerAccountId: 102, debitAmount: "0", creditAmount: "300.00" }),
      ])
    );
    expect(hadi.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ledgerAccountId: 201, debitAmount: "300.00", creditAmount: "0" }),
        expect.objectContaining({ bankAccountId: 301, debitAmount: "0", creditAmount: "300.00" }),
      ])
    );
  });

  it("does not allow a payment above HADI-held sales cash or the intercompany asset", () => {
    expect(() =>
      planGoldenCoastFreshStartHadiPayment({
        payment: payment(),
        outstandingSalesCashUsd: "250.00",
        hadiIntercompanyAssetUsd: "1000.00",
      })
    ).toThrow(GoldenCoastFreshStartHadiPaymentError);

    expect(() =>
      planGoldenCoastFreshStartHadiPayment({
        payment: payment(),
        outstandingSalesCashUsd: "1000.00",
        hadiIntercompanyAssetUsd: "250.00",
      })
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
    expect(goldenCoastFreshStartHadiPaymentDigest({ payment: first, accounts })).not.toBe(
      goldenCoastFreshStartHadiPaymentDigest({ payment: second, accounts })
    );
  });
});
