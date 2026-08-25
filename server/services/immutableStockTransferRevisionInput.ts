import { createHash } from "node:crypto";

export interface ImmutableRevisionItemInput {
  stockItemId: number;
  stockItemName: string;
  sourceLocationId: number;
  sourceLocationName?: string | null;
  originalQuantity: number;
  newQuantity: number;
}

export interface NormalizedImmutableRevisionItem extends ImmutableRevisionItemInput {
  delta: number;
}

/** The stock-transfer voucher row the revision lifecycle locks FOR UPDATE. */
export type LockedTransferRow = Record<string, unknown> & {
  id: number;
  voucher_id: number;
  company_id: number;
  voucher_type: string;
  voucher_number: string;
  voucher_date: string;
  deleted_at: Date | null;
  inventory_applied: boolean;
  source_location_id: number | null;
  destination_location_id: number;
  source_location_name: string | null;
  destination_location_name: string;
};

/** A lifecycle failure that carries a stable code (and sometimes the offending item). */
export type LifecycleError = Error & {
  code?: string;
  stockItemId?: number;
  sourceLocationId?: number | null;
  requiredQuantity?: number;
  availableQuantity?: number;
};

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function finiteNonNegative(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative number`);
  return parsed;
}

export function normalizeImmutableRevisionItems(
  items: ImmutableRevisionItemInput[]
): NormalizedImmutableRevisionItem[] {
  if (!Array.isArray(items) || items.length === 0) throw new Error("At least one changed item is required");
  const byKey = new Map<string, NormalizedImmutableRevisionItem>();

  for (const raw of items) {
    const stockItemId = positiveInteger(raw.stockItemId, "Stock item ID");
    const sourceLocationId = positiveInteger(raw.sourceLocationId, "Source location ID");
    const originalQuantity = finiteNonNegative(raw.originalQuantity, "Original quantity");
    const newQuantity = finiteNonNegative(raw.newQuantity, "New quantity");
    const delta = newQuantity - originalQuantity;
    if (Math.abs(delta) < 0.0005) continue;

    const key = `${stockItemId}:${sourceLocationId}`;
    if (byKey.has(key))
      throw new Error(`Revision contains duplicate item ${stockItemId} at source ${sourceLocationId}`);
    byKey.set(key, {
      stockItemId,
      stockItemName: String(raw.stockItemName || `Item ${stockItemId}`).trim(),
      sourceLocationId,
      sourceLocationName: raw.sourceLocationName ? String(raw.sourceLocationName).trim() : null,
      originalQuantity,
      newQuantity,
      delta,
    });
  }

  const normalized = Array.from(byKey.values()).sort(
    (a, b) => a.sourceLocationId - b.sourceLocationId || a.stockItemId - b.stockItemId
  );
  if (normalized.length === 0) throw new Error("Revision has no effective quantity changes");
  return normalized;
}

export function immutableRevisionPayloadHash(items: NormalizedImmutableRevisionItem[], note: string | null): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        note,
        items: items.map((item) => ({
          stockItemId: item.stockItemId,
          sourceLocationId: item.sourceLocationId,
          originalQuantity: item.originalQuantity.toFixed(3),
          newQuantity: item.newQuantity.toFixed(3),
        })),
      })
    )
    .digest("hex");
}
