export interface CustomerOrderBaleScanPatch {
  compactBaleScan: true;
  orderId: number;
  order: Record<string, unknown>;
  bale: Record<string, unknown>;
  line: Record<string, unknown> | null;
  totals: {
    subtotalBales: string;
    freightAmount: string;
    otherChargesTotal: string;
    grandTotal: string;
    totalQtyBales: number;
    updatedAt: string | Date | null;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isCustomerOrderBaleScanPatch(value: unknown): value is CustomerOrderBaleScanPatch {
  if (!isRecord(value)) return false;
  return (
    value.compactBaleScan === true &&
    Number.isInteger(Number(value.orderId)) &&
    isRecord(value.order) &&
    isRecord(value.bale) &&
    (value.line === null || isRecord(value.line)) &&
    isRecord(value.totals)
  );
}

function replaceOrAppendById(rows: unknown, incoming: Record<string, unknown>): Record<string, unknown>[] {
  const existing = Array.isArray(rows) ? rows.filter(isRecord) : [];
  const incomingId = Number(incoming.id);
  if (!Number.isFinite(incomingId)) return [...existing, incoming];
  const index = existing.findIndex((row) => Number(row.id) === incomingId);
  if (index < 0) return [...existing, incoming];
  const next = [...existing];
  next[index] = { ...existing[index], ...incoming };
  return next;
}

function replaceOrAppendLine(rows: unknown, incoming: Record<string, unknown> | null): Record<string, unknown>[] {
  const existing = Array.isArray(rows) ? rows.filter(isRecord) : [];
  if (!incoming) return existing;
  const articleCode = String(incoming.articleCode || "");
  const index = existing.findIndex((row) => String(row.articleCode || "") === articleCode);
  if (index < 0) return [...existing, incoming];
  const next = [...existing];
  next[index] = { ...existing[index], ...incoming };
  return next;
}

/**
 * Rebuild the legacy full-order shape from the tiny single-scan server patch.
 * Existing pages can keep their current success handlers while the network no
 * longer carries every previously scanned bale, line, and charge on each scan.
 */
export function mergeCustomerOrderBaleScanPatch(
  current: unknown,
  patch: CustomerOrderBaleScanPatch
): Record<string, unknown> {
  const base = isRecord(current) ? current : patch.order;
  return {
    ...patch.order,
    ...base,
    ...patch.totals,
    id: Number(base.id || patch.orderId),
    bales: replaceOrAppendById(base.bales, patch.bale),
    lines: replaceOrAppendLine(base.lines, patch.line),
    charges: Array.isArray(base.charges) ? base.charges : [],
  };
}
