export interface PaymentReceiptDeletionPolicyInput {
  voucherType: string | null | undefined;
  optional: boolean | null | undefined;
  voucherNumber?: string | null;
  salesItemCount?: number;
}

export function isPaymentReceiptVoucherType(
  value: string | null | undefined
): value is "Payment" | "Receipt" {
  return value === "Payment" || value === "Receipt";
}

/**
 * Only plain active Payment/Receipt vouchers are converged in Phase 2B.
 *
 * POS sales are frequently stored as Receipt vouchers and require inventory
 * restoration through the legacy deletion path. Payroll vouchers with SAL-*
 * numbers require payroll-run and salary-advance reversal, which remains in
 * Program 2D. Optional vouchers also remain on their compatibility path.
 */
export function shouldUseCentralPaymentReceiptDeletion(
  input: PaymentReceiptDeletionPolicyInput
): boolean {
  if (!isPaymentReceiptVoucherType(input.voucherType)) return false;
  if (input.optional === true) return false;
  if (input.voucherNumber && /^SAL-\d+-/.test(input.voucherNumber)) return false;
  if (input.voucherType === "Receipt" && Number(input.salesItemCount || 0) > 0) {
    return false;
  }
  return true;
}
