import { apiRequest } from "@/lib/queryClient";

export const containersApi = {
  syncAllVouchers: () =>
    apiRequest("POST", "/api/containers/sync-all-vouchers", {}),

  updateTracking: (
    id: number,
    data: {
      trackingStatus?: string;
      notes?: string;
      [key: string]: unknown;
    }
  ) => apiRequest("PATCH", `/api/containers/${id}/tracking`, data),

  updateNumber: (id: number, containerNumber: string) =>
    apiRequest("PATCH", `/api/containers/${id}/number`, { containerNumber }),
};
