import { apiRequest, keyStartsWith, queryClient } from "@/lib/queryClient";

export function locationInventoryFullUrl(locationId: number, search = ""): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  // The Location Inventory page consumes the reporting/view fields, not transport
  // metadata such as lastUpdated/barcode/selling-price. Keep the historical helper
  // name for cache compatibility while opting the UI into the compact view contract.
  params.set("profile", "view");
  return `/api/locations/${locationId}/inventory?${params.toString()}`;
}

export function locationInventoryLightUrl(locationId: number, includePricing = false): string {
  return `/api/locations/${locationId}/inventory?profile=light${includePricing ? "&includePricing=true" : ""}`;
}

/** Invalidate every cached full/light representation for exactly one location. */
export function invalidateLocationInventoryQueries(locationId: number | null | undefined): void {
  if (!locationId || locationId <= 0) return;
  queryClient.invalidateQueries({
    predicate: keyStartsWith(`/api/locations/${locationId}/inventory`),
    refetchType: "active",
  });
}

export const inventoryApi = {
  addLocation: (name: string) => apiRequest("POST", "/api/locations", { name }),

  updateLocation: (
    id: number,
    payload: {
      name?: string;
      whatsappGroupChatId?: string | null;
      [key: string]: unknown;
    }
  ) => apiRequest("PATCH", `/api/locations/${id}`, payload),

  deleteLocation: (id: number) => apiRequest("DELETE", `/api/locations/${id}`),

  archiveStockGroup: (data: { stockGroupId: number; locationId: number; [key: string]: unknown }) =>
    apiRequest("POST", "/api/stock-group-archives", data),

  silentProduction: (data: { locationId: number; items: unknown[]; [key: string]: unknown }) =>
    apiRequest("POST", "/api/inventory/silent-production", data),
};
