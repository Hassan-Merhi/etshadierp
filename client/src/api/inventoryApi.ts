import { apiRequest } from "@/lib/queryClient";

export const inventoryApi = {
  addLocation: (name: string) =>
    apiRequest("POST", "/api/locations", { name }),

  updateLocation: (
    id: number,
    payload: {
      name?: string;
      whatsappGroupChatId?: string | null;
      [key: string]: unknown;
    }
  ) => apiRequest("PATCH", `/api/locations/${id}`, payload),

  deleteLocation: (id: number) =>
    apiRequest("DELETE", `/api/locations/${id}`),

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
