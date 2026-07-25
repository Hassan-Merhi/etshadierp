import { describe, expect, it } from "vitest";
import { buildLegacyPaymentReceiptEditTarget } from "../server/routes/vouchers/centralPaymentReceiptLifecycleRoute";
import { PostingValidationError } from "../server/services/accounting/centralPostingEngine";

describe("Payment/Receipt lifecycle compatibility", () => {
  it("preserves one target per edited entry", () => {
    expect(buildLegacyPaymentReceiptEditTarget("ledger", 10)).toEqual({
      ledgerAccountId: 10,
    });
    expect(buildLegacyPaymentReceiptEditTarget("customer", 20)).toEqual({
      customerId: 20,
    });
    expect(buildLegacyPaymentReceiptEditTarget("employee", 30)).toEqual({
      employeeId: 30,
    });
  });

  it("does not add a linked customer or ledger during edit target construction", () => {
    const ledger = buildLegacyPaymentReceiptEditTarget("ledger", 10);
    const customer = buildLegacyPaymentReceiptEditTarget("customer", 20);

    expect(ledger).not.toHaveProperty("customerId");
    expect(customer).not.toHaveProperty("ledgerAccountId");
  });

  it("rejects unsupported account types", () => {
    expect(() => buildLegacyPaymentReceiptEditTarget("unknown", 1)).toThrow(
      PostingValidationError
    );
  });

  it("rejects invalid account IDs", () => {
    expect(() => buildLegacyPaymentReceiptEditTarget("bank", 0)).toThrow(
      PostingValidationError
    );
    expect(() => buildLegacyPaymentReceiptEditTarget("bank", "abc")).toThrow(
      PostingValidationError
    );
  });
});
