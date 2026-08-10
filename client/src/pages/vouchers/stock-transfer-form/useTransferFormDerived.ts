/**
 * Derived state for StockTransferForm.
 *
 * These three pieces used to sit inline in the form. Each one re-ran on every
 * render — the inventory filter/sort over a whole location's stock, and a
 * per-row inventory fetch for rate auto-fill — which is what made typing and
 * saving on large transfers feel sluggish.
 */
import { useEffect, useMemo } from "react";
import type { UseFormReturn } from "react-hook-form";
import { queryClient } from "@/lib/queryClient";

/** Source-location inventory, filtered by the sidebar search and sorted by name. */
export function useFilteredTransferInventory(transferInventory: any[], transferSearchTerm: string) {
  return useMemo(() => {
    const term = transferSearchTerm.trim().toLowerCase();
    const filtered = term
      ? transferInventory.filter(
          (item: any) =>
            item.stockItemName?.toLowerCase().includes(term) || item.stockItemCode?.toLowerCase().includes(term)
        )
      : transferInventory.slice();
    return filtered.sort((a: any, b: any) => (a.stockItemName || "").localeCompare(b.stockItemName || ""));
  }, [transferInventory, transferSearchTerm]);
}

/**
 * Revisions still awaiting review. Approving one applies all of them, so the
 * approve dialog previews the whole set rather than just the clicked row.
 */
export function usePendingTransferRevisions(transferRevisions: any[]) {
  return useMemo(() => transferRevisions.filter((rev) => rev.optional), [transferRevisions]);
}

/**
 * Fill in missing rates from each source location's average rate. One cached
 * request per distinct location, not one per entry row.
 */
export function useTransferRateAutofill(
  transferEntries: { sourceLocationId: number; stockItemId: number; rate?: string }[],
  stockTransferForm: UseFormReturn<any>
) {
  const signature = transferEntries.map((e) => `${e.sourceLocationId}-${e.stockItemId}-${e.rate ? 1 : 0}`).join(",");

  useEffect(() => {
    const missingByLocation = new Map<number, { index: number; stockItemId: number }[]>();
    transferEntries.forEach((entry, index) => {
      if (entry.sourceLocationId > 0 && entry.stockItemId > 0 && !entry.rate) {
        const pending = missingByLocation.get(entry.sourceLocationId) ?? [];
        pending.push({ index, stockItemId: entry.stockItemId });
        missingByLocation.set(entry.sourceLocationId, pending);
      }
    });
    if (missingByLocation.size === 0) return;

    let cancelled = false;
    for (const [locationId, pending] of missingByLocation) {
      queryClient
        .fetchQuery<any[]>({ queryKey: [`/api/locations/${locationId}/inventory`], staleTime: 60_000 })
        .then((locationInventory) => {
          if (cancelled || !Array.isArray(locationInventory)) return;
          const rateByItem = new Map<number, string>();
          for (const item of locationInventory) {
            if (item?.averageRate) rateByItem.set(item.stockItemId, item.averageRate);
          }
          for (const { index, stockItemId } of pending) {
            const rate = rateByItem.get(stockItemId);
            if (rate) stockTransferForm.setValue(`entries.${index}.rate`, rate);
          }
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}
