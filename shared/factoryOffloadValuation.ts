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
 * One authoritative quantity basis for initial offload costing.
 *
 * The landed rate belongs to the full agreed container quantity. A partial
 * receipt receives only its proportional value, so changing the received
 * quantity must not change the established landed cost/kg. Both the client
 * preview and the server calculation call this helper to prevent denominator
 * drift.
 */
export function resolveFactoryOffloadValuationKg(input: FactoryOffloadValuationInput): number {
  return (
    positiveDecimal(input.totalKg) ??
    positiveDecimal(input.declaredKg) ??
    positiveDecimal(input.receivedKg) ??
    new Decimal(0)
  ).toNumber();
}
