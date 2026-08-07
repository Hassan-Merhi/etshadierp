/**
 * Derived state for the StockTransferOrder inventory matrix.
 *
 * The matrix redraws on every keystroke and state change, so anything computed
 * per render is paid repeatedly across hundreds of items and every selected
 * location. These hooks compute each piece once per input change.
 */
import { useMemo } from "react";
import type { Location, StockItemData, LocationSummaryResponse } from "../stocktransferorder/types";

/** Selected source locations, resolved through a map instead of a per-id scan. */
export function useSelectedLocations(locations: Location[], selectedLocationIds: number[]) {
  const locationsById = useMemo(() => new Map(locations.map((loc) => [loc.id, loc])), [locations]);
  return useMemo(
    () => selectedLocationIds.map((id) => locationsById.get(id)).filter((loc): loc is Location => loc !== undefined),
    [selectedLocationIds, locationsById]
  );
}

/**
 * Matrix rows: each group's items sorted once, the flattened list of visible
 * rows, and an id → row-index map. Resolving the row index per rendered row
 * with findIndex made the matrix quadratic in the number of visible items.
 */
export function useMatrixRows(summaryData: LocationSummaryResponse | undefined, expandedGroups: Set<number>) {
  const sortedGroupItems = useMemo(() => {
    const byGroup = new Map<number, StockItemData[]>();
    for (const group of summaryData?.stockGroups ?? []) {
      byGroup.set(
        group.id,
        [...group.items].sort((a, b) => a.name.localeCompare(b.name))
      );
    }
    return byGroup;
  }, [summaryData]);

  const flatItems = useMemo(
    () =>
      (summaryData?.stockGroups ?? []).flatMap((group) =>
        expandedGroups.has(group.id) ? (sortedGroupItems.get(group.id) ?? []) : []
      ),
    [summaryData, expandedGroups, sortedGroupItems]
  );

  const flatRowIndexById = useMemo(() => {
    const index = new Map<number, number>();
    flatItems.forEach((item, i) => index.set(item.id, i));
    return index;
  }, [flatItems]);

  return { sortedGroupItems, flatItems, flatRowIndexById };
}
