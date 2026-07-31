import Decimal from "decimal.js";

export interface FactoryOffloadValuationInput {
  totalKg?: string | number | null;
  declaredKg?: string | number | null;
  receivedKg?: string | number | null;
}

function positiveDecimal(value: string | number | null | undefined): Decimal | null {
  try {
    const parsed = new Decimal(value ?? 0);
    return parsed.isFinite() && parsed.gt(0) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Authoritative quantity used to calculate the container's fixed material value.
 *
 * The numerator is based on the agreed container quantity. The actual received
 * quantity is only a fallback when no agreed quantity exists; it is not the
 * normal cost-per-kg divisor. Client and server divide the resulting fixed total
 * value by the actual received weight separately.
 */
export function resolveFactoryOffloadValuationKg(input: FactoryOffloadValuationInput): number {
  return (
    positiveDecimal(input.totalKg) ??
    positiveDecimal(input.declaredKg) ??
    positiveDecimal(input.receivedKg) ??
    new Decimal(0)
  ).toNumber();
}
