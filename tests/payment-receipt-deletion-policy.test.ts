import { describe, expect, it } from "vitest";
import {
  isPaymentReceiptVoucherType,
  shouldUseCentralPaymentReceiptDeletion,
} from "../server/services/accounting/paymentReceiptDeletionPolicy";

describe("Payment/Receipt deletion policy", () => {
  it("accepts plain active Payment and Receipt vouchers", () => {
    expect(
      shouldUseCentralPaymentReceiptDeletion({
        voucherType: "Payment",
        optional: false,
        voucherNumber: "PAYMENT-100",
      })
    ).toBe(true);
    expect(
      shouldUseCentralPaymentReceiptDeletion({
        voucherType: "Receipt",
        optional: false,
        voucherNumber: "RECEIPT-100",
        salesItemCount: 0,
      })
    ).toBe(true);
  });

  it("keeps POS sale Receipts on the legacy inventory-reversal path", () => {
    expect(
      shouldUseCentralPaymentReceiptDeletion({
        voucherType: "Receipt",
        optional: false,
        voucherNumber: "RECEIPT-POS-1",
        salesItemCount: 2,
      })
    ).toBe(false);
  });

  it("keeps SAL payroll vouchers on the payroll-aware path", () => {
    expect(
      shouldUseCentralPaymentReceiptDeletion({
        voucherType: "Payment",
        optional: false,
        voucherNumber: "SAL-42-2026-07",
      })
    ).toBe(false);
  });

  it("keeps optional and unrelated vouchers on their compatibility paths", () => {
    expect(
      shouldUseCentralPaymentReceiptDeletion({
        voucherType: "Payment",
        optional: true,
        voucherNumber: "PAYMENT-OPTIONAL",
      })
    ).toBe(false);
    expect(
      shouldUseCentralPaymentReceiptDeletion({
        voucherType: "Journal",
        optional: false,
        voucherNumber: "JOURNAL-1",
      })
    ).toBe(false);
  });

  it("narrows only Payment and Receipt types", () => {
    expect(isPaymentReceiptVoucherType("Payment")).toBe(true);
    expect(isPaymentReceiptVoucherType("Receipt")).toBe(true);
    expect(isPaymentReceiptVoucherType("Sales")).toBe(false);
  });
});
