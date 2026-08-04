import type { APIInventoryItem } from "../pos-components/posTypes";

export interface SpMovement {
  id: number;
  articleCode: string;
  description: string | null;
  stockItemId: number | null;
  locationId: number | null;
  qtyRemaining: string;
  finalUnitCostUsd: string;
}

interface MovementAggregate {
  stockItemId: number | null;
  code: string;
  name: string;
  stock: number;
  totalFinalCost: number;
}

export interface PosInventoryItem {
  code: string;
  name: string;
  stock: number;
  price: number;
  configuredPrice: number;
  stockItemId: number;
}

function normalizeCode(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function aggregateSpMovements(movements: SpMovement[]): Map<string, MovementAggregate> {
  const map = new Map<string, MovementAggregate>();

  for (const movement of movements) {
    const qty = parseFloat(movement.qtyRemaining) || 0;
    if (qty <= 0) continue;

    const normalizedCode = normalizeCode(movement.articleCode);
    const key = movement.stockItemId != null ? `id:${movement.stockItemId}` : `code:${normalizedCode}`;
    if (!normalizedCode && movement.stockItemId == null) continue;

    const finalUnitCost = parseFloat(movement.finalUnitCostUsd) || 0;
    const existing = map.get(key);
    if (existing) {
      existing.stock += qty;
      existing.totalFinalCost += qty * finalUnitCost;
      continue;
    }

    map.set(key, {
      stockItemId: movement.stockItemId,
      code: movement.articleCode,
      name: movement.description || movement.articleCode,
      stock: qty,
      totalFinalCost: qty * finalUnitCost,
    });
  }

  return map;
}

export function buildPosInventory(
  apiInventory: APIInventoryItem[],
  spStock: SpMovement[],
  isSpCompany: boolean,
  activeLocationId: number | null
): PosInventoryItem[] {
  const normalInventory = (Array.isArray(apiInventory) ? apiInventory : []).map((item) => ({
    code: (item.stockItemCode || "").trim(),
    name: (item.stockItemName || "Unknown Item").trim(),
    stock: parseFloat(item.quantity) || 0,
    price: parseFloat(item.lastSellingPrice || item.averageRate) || 0,
    configuredPrice: parseFloat(item.lastSellingPrice || "0") || 0,
    stockItemId: item.stockItemId,
  }));

  if (!isSpCompany) return normalInventory;

  const allMovements = Array.isArray(spStock) ? spStock : [];
  const scopedMovements = allMovements.filter((movement) => {
    if (activeLocationId == null || movement.locationId == null) return true;
    return Number(movement.locationId) === activeLocationId;
  });

  const scopedByKey = aggregateSpMovements(scopedMovements);
  const allByKey = aggregateSpMovements(allMovements);
  const representedIds = new Set<number>();

  const merged = normalInventory.map((item) => {
    representedIds.add(item.stockItemId);
    const idKey = `id:${item.stockItemId}`;
    const codeKey = `code:${normalizeCode(item.code)}`;
    const movement = scopedByKey.get(idKey) || scopedByKey.get(codeKey) || allByKey.get(idKey) || allByKey.get(codeKey);
    const finalCost =
      movement && movement.stock > 0 ? movement.totalFinalCost / movement.stock : parseFloat(String(item.price)) || 0;

    return {
      ...item,
      price: finalCost,
      configuredPrice: finalCost,
    };
  });

  for (const movement of scopedByKey.values()) {
    if (movement.stockItemId == null || representedIds.has(movement.stockItemId) || movement.stock <= 0) continue;
    const finalCost = movement.totalFinalCost / movement.stock;
    merged.push({
      code: movement.code,
      name: movement.name,
      stock: movement.stock,
      price: finalCost,
      configuredPrice: finalCost,
      stockItemId: movement.stockItemId,
    });
  }

  return merged;
}
