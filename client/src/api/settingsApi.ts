import { apiRequest } from "@/lib/queryClient";

export const settingsApi = {
  deleteSession: (sid: string) =>
    apiRequest("DELETE", `/api/sessions/${sid}`),

  deleteAllSessions: () => apiRequest("DELETE", "/api/sessions"),

  updateUserPreferences: (data: Record<string, unknown>) =>
    apiRequest("PUT", "/api/user-preferences", data),

  updateExportSettings: (data: Record<string, unknown>) =>
    apiRequest("PUT", "/api/export/settings", data),

  startExport: (data: Record<string, unknown>) =>
    apiRequest("POST", "/api/export/start", data),
};
