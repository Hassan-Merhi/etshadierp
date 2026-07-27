export interface PosSaleCapabilityBody {
  isCreditSale?: unknown;
  discount?: unknown;
  discountAmount?: unknown;
  discountPercent?: unknown;
  items?: unknown;
}

function positiveNumber(value: unknown): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function hasRequestedDiscount(body: PosSaleCapabilityBody): boolean {
  if (
    positiveNumber(body.discount) ||
    positiveNumber(body.discountAmount) ||
    positiveNumber(body.discountPercent)
  ) {
    return true;
  }

  if (!Array.isArray(body.items)) return false;
  return body.items.some((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return (
      positiveNumber(row.discount) ||
      positiveNumber(row.discountAmount) ||
      positiveNumber(row.discountPercent)
    );
  });
}

export function isCreditSaleRequested(body: PosSaleCapabilityBody): boolean {
  return body.isCreditSale === true || body.isCreditSale === "true" || body.isCreditSale === 1;
}

export function isPosSaleSubmission(method: string, path: string): boolean {
  return method.toUpperCase() === "POST" && path === "/api/pos/sales";
}

export function requestedPosSaleCapabilities(input: {
  method: string;
  path: string;
  body: PosSaleCapabilityBody;
  hasPriceOverride: boolean;
}): string[] {
  if (!isPosSaleSubmission(input.method, input.path)) return [];

  const keys: string[] = [];
  if (isCreditSaleRequested(input.body)) keys.push("pos_perm_credit_sale");
  if (hasRequestedDiscount(input.body)) keys.push("pos_perm_discount");
  if (input.hasPriceOverride) keys.push("pos_perm_override_price");
  return keys;
}
