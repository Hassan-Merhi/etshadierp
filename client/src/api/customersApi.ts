import { apiRequest } from "@/lib/queryClient";

export const customersApi = {
  create: (data: { name: string; companyId?: number; [key: string]: unknown }) =>
    apiRequest("POST", "/api/customers", data),

  update: (id: number, data: { name?: string; [key: string]: unknown }) =>
    apiRequest("PUT", `/api/customers/${id}`, data),
};
