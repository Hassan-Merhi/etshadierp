import { apiRequest } from "@/lib/queryClient";

export const suppliersApi = {
  delete: (id: number) => apiRequest("DELETE", `/api/suppliers/${id}`),
};
