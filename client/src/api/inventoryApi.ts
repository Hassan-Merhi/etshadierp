import { apiRequest, keyStartsWith, queryClient } from "@/lib/queryClient";

export function locationInventoryFullUrl(locationId: number, search = ""): string {
  const suffix = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `/api/locations/${locationId}/inventory${suffix}`;
}

export function locationInventoryLightUrl(locationId: number, includePricing = false): string {
  return `/api/locations/${locationId}/inventory/light${includePricing ? "?includePricing=true" : ""}`;
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

  archiveStockGroup: (data: {
    stockGroupId: number;
    locationId: number;
    [key: string]: unknown;
  }) => apiRequest("POST", "/api/stock-group-archives", data),

  silentProduction: (data: {
    locationId: number;
    items: unknown[];
    [key: string]: unknown;
  }) => apiRequest("POST", "/api/inventory/silent-production", data),
};
