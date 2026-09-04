import { describe, expect, it } from "vitest";
import {
  GC_SALES_CASH_NORMAL_SIDE,
  GoldenCoastSalesCashBalanceError,
  gcSalesCashConservativePayable,
  gcSalesCashPayableAfterPayment,
  gcSalesCashPayableBalance,
  gcSalesCashSettleableFromSignedBalance,
  gcSalesCashSettleablePayable,
} from "./goldenCoastSalesCashPayable";

describe("Golden Coast GC Sales Cash payable convention", () => {
  it("treats GC Sales Cash as credit-normal", () => {
    expect(GC_SALES_CASH_NORMAL_SIDE).toBe("Cr");
  });

  it("reads a credit ledger balance as a positive payable", () => {
    // Sales credited 1,800: the ledger reports -1800 as debits minus credits.
    expect(gcSalesCashPayableBalance("-1800")).toBe("1800.00");
    expect(gcSalesCashPayableBalance(-1800)).toBe("1800.00");
  });

  it("reads a debit ledger balance as an overpaid (negative) payable", () => {
    expect(gcSalesCashPayableBalance("250")).toBe("-250.00");
    expect(gcSalesCashSettleablePayable("-250.00")).toBe("0.00");
  });

  it("floors the settleable payable at zero", () => {
    expect(gcSalesCashSettleableFromSignedBalance("-1800")).toBe("1800.00");
    expect(gcSalesCashSettleableFromSignedBalance("0")).toBe("0.00");
    expect(gcSalesCashSettleableFromSignedBalance("50")).toBe("0.00");
  });

  it("reduces the payable when a payment is applied", () => {
    expect(gcSalesCashPayableAfterPayment("1800.00", "600.00")).toBe("1200.00");
    expect(gcSalesCashPayableAfterPayment("1800.00", "1800.00")).toBe("0.00");
  });

  it("takes the lower of the dated and all-posted payable readings", () => {
    expect(gcSalesCashConservativePayable({ datedPayableUsd: "1800", allPostedPayableUsd: "1200" })).toBe("1200.00");
    expect(gcSalesCashConservativePayable({ datedPayableUsd: "900", allPostedPayableUsd: "1200" })).toBe("900.00");
  });

  it("rejects values that are not finite numbers", () => {
    expect(() => gcSalesCashPayableBalance("not-a-number")).toThrow(GoldenCoastSalesCashBalanceError);
    expect(() => gcSalesCashPayableBalance(Number.POSITIVE_INFINITY)).toThrow(GoldenCoastSalesCashBalanceError);
    expect(() => gcSalesCashPayableBalance(null as unknown as string)).toThrow(GoldenCoastSalesCashBalanceError);
  });

  it("rounds half up to cents", () => {
    expect(gcSalesCashPayableBalance("-1800.005")).toBe("1800.01");
  });
});
