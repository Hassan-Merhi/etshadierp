import { apiRequest } from "@/lib/queryClient";

export const stockApi = {
  bulkDeleteItems: (ids: number[]) =>
    apiRequest("POST", "/api/stock-items/bulk-delete", { ids }),

  bulkAssignCategory: (ids: number[], categoryId: number | null) =>
    apiRequest("POST", "/api/stock-items/bulk-assign-category", {
      ids,
      categoryId,
    }),

  quickAdjust: (data: {
    stockItemId: number;
    locationId: number;
    quantityDelta: number;
    note?: string;
    [key: string]: unknown;
  }) => apiRequest("POST", "/api/inventory/quick-adjust", data),

  createGrade: (name: string) =>
    apiRequest("POST", "/api/stock-grades", { name }),

  updateGrade: (id: number, name: string) =>
    apiRequest("PATCH", `/api/stock-grades/${id}`, { name }),

  deleteGrade: (id: number) =>
    apiRequest("DELETE", `/api/stock-grades/${id}`),

  createCategory: (name: string) =>
    apiRequest("POST", "/api/stock-categories", { name }),

  updateCategory: (id: number, name: string) =>
    apiRequest("PATCH", `/api/stock-categories/${id}`, { name }),

  deleteCategory: (id: number) =>
    apiRequest("DELETE", `/api/stock-categories/${id}`),
};
