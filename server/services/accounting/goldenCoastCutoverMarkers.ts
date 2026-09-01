export const GOLDEN_COAST_EXISTING_POSITION_CARRY_FORWARD_VOUCHER = "GC-EXISTING-POSITION-20260901";

export function goldenCoastExistingPositionCarryForwardVoucherNumber(companyId: number): string {
  return `${GOLDEN_COAST_EXISTING_POSITION_CARRY_FORWARD_VOUCHER}-C${companyId}`;
}
