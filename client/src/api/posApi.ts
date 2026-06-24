import { apiRequest } from "@/lib/queryClient";

export const posApi = {
  openShift: (data: {
    locationId: number;
    openingCash?: number;
    [key: string]: unknown;
  }) => apiRequest("POST", "/api/pos/shifts/open", data),

  closeShift: (
    shiftId: number,
    data: {
      closingCash?: number;
      notes?: string;
      [key: string]: unknown;
    }
  ) => apiRequest("POST", `/api/pos/shifts/${shiftId}/close`, data),

  createSale: (data: {
    locationId: number;
    items: unknown[];
    [key: string]: unknown;
  }) => apiRequest("POST", "/api/pos/sales", data),

  saveDraft: (data: Record<string, unknown>) =>
    apiRequest("POST", "/api/pos/drafts", data),
};
