export interface SmartPreviewImportLine {
  stockItemId: number;
  stockItemName: string;
  stockItemCode: string;
  uom: string;
  sourceLocationId: number;
  sourceLocationName: string;
  suggestedQuantity: number;
  availableAtSource: number;
  sourceAverageRate: number;
}

export interface SmartPreviewOrderItem {
  stockItemId: number;
  stockItemName: string;
  stockItemCode: string;
  uom: string;
  sourceLocationId: number;
  sourceLocationName: string;
  quantity: number;
  availableQty: number;
  rate: number;
}

export function mergeSmartPreviewLines(lines: SmartPreviewImportLine[]): SmartPreviewOrderItem[] {
  const merged = new Map<string, SmartPreviewOrderItem>();

  for (const line of lines) {
    const quantity = Math.floor(Number(line.suggestedQuantity));
    const availableQty = Math.floor(Number(line.availableAtSource));
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    if (!Number.isInteger(line.stockItemId) || !Number.isInteger(line.sourceLocationId)) continue;

    const key = `${line.stockItemId}:${line.sourceLocationId}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += quantity;
      existing.availableQty = Math.max(existing.availableQty, availableQty);
      if (existing.rate <= 0 && line.sourceAverageRate > 0) existing.rate = line.sourceAverageRate;
      continue;
    }

    merged.set(key, {
      stockItemId: line.stockItemId,
      stockItemName: line.stockItemName,
      stockItemCode: line.stockItemCode,
      uom: line.uom,
      sourceLocationId: line.sourceLocationId,
      sourceLocationName: line.sourceLocationName,
      quantity,
      availableQty,
      rate: Number.isFinite(line.sourceAverageRate) ? line.sourceAverageRate : 0,
    });
  }

  return Array.from(merged.values()).sort(
    (a, b) =>
      a.sourceLocationName.localeCompare(b.sourceLocationName) ||
      a.stockItemName.localeCompare(b.stockItemName) ||
      a.stockItemId - b.stockItemId
  );
}

export function validateSmartPreviewLines(lines: SmartPreviewImportLine[]): string[] {
  const errors: string[] = [];
  const totalsBySourceItem = new Map<string, { quantity: number; available: number; label: string }>();

  for (const line of lines) {
    const quantity = Number(line.suggestedQuantity);
    const available = Number(line.availableAtSource);
    const label = `${line.stockItemName} from ${line.sourceLocationName}`;

    if (!Number.isInteger(quantity) || quantity <= 0) {
      errors.push(`${label}: quantity must be a positive whole number.`);
      continue;
    }

    const key = `${line.stockItemId}:${line.sourceLocationId}`;
    const current = totalsBySourceItem.get(key) ?? { quantity: 0, available, label };
    current.quantity += quantity;
    current.available = Math.min(current.available, available);
    totalsBySourceItem.set(key, current);
  }

  for (const entry of totalsBySourceItem.values()) {
    if (entry.quantity > entry.available) {
      errors.push(`${entry.label}: requested ${entry.quantity}, but only ${entry.available} is available after reserve.`);
    }
  }

  return Array.from(new Set(errors));
}
