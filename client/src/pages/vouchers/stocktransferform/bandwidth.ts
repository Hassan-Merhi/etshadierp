interface TransferRateEntry {
  stockItemId: number;
  sourceLocationId: number;
  rate: string;
}

export async function fetchLocationInventoryRates(
  sourceLocationId: number,
  stockItemIds: Iterable<number>
): Promise<TransferRateEntry[]> {
  const ids = Array.from(new Set(stockItemIds)).filter((id) => id > 0);
  if (sourceLocationId <= 0 || ids.length === 0) return [];
  try {
    const response = await fetch(
      `/api/locations/${sourceLocationId}/inventory-rates?stockItemIds=${ids.join(",")}`,
      { credentials: "include" }
    );
    if (!response.ok) return [];
    const rows = await response.json();
    return rows.map((row: any) => ({
      stockItemId: Number(row.stockItemId),
      sourceLocationId,
      rate: row.averageRate || "0",
    }));
  } catch {
    return [];
  }
}

export async function fetchMissingTransferRates(
  entries: Array<{ stockItemId: number; sourceLocationId: number }>
): Promise<TransferRateEntry[]> {
  const itemIdsByLocation = new Map<number, Set<number>>();
  for (const entry of entries) {
    const ids = itemIdsByLocation.get(entry.sourceLocationId) ?? new Set<number>();
    ids.add(entry.stockItemId);
    itemIdsByLocation.set(entry.sourceLocationId, ids);
  }
  return (
    await Promise.all(
      Array.from(itemIdsByLocation, ([sourceLocationId, itemIds]) =>
        fetchLocationInventoryRates(sourceLocationId, itemIds)
      )
    )
  ).flat();
}
