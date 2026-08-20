import type Decimal from "decimal.js";

export function shouldInsertAdjustmentVoucherEntry(totalValue: Decimal, accountId: number | null): accountId is number {
  return totalValue.gt(0) && accountId !== null;
}
