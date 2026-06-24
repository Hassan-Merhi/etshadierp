import { apiRequest } from "@/lib/queryClient";

export const reportsApi = {
  startExport: (data: Record<string, unknown>) =>
    apiRequest("POST", "/api/export/start", data),

  updateExportSettings: (data: Record<string, unknown>) =>
    apiRequest("PUT", "/api/export/settings", data),

  addExportRecipient: (data: {
    email?: string;
    phone?: string;
    [key: string]: unknown;
  }) => apiRequest("POST", "/api/export/recipients", data),

  sendWhatsappNetPosition: (data: Record<string, unknown>) =>
    apiRequest("POST", "/api/whatsapp/send-net-position", data),

  sendWhatsappStockReport: (data: Record<string, unknown>) =>
    apiRequest("POST", "/api/whatsapp/send-stock-report", data),

  sendDailyExportWhatsapp: (data: Record<string, unknown>) =>
    apiRequest("POST", "/api/daily-export/trigger-whatsapp", data),
};
