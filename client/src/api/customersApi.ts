import { apiRequest } from "@/lib/queryClient";

export const customersApi = {
  // Note: the customers API accepts `legalName` (not `name`) plus companyId and
  // other optional fields — this type annotation only reflects actual call-site
  // usage (see Customers.tsx), it does not change the request payload.
  create: (data: { legalName: string; companyId?: number; [key: string]: unknown }) =>
    apiRequest("POST", "/api/customers", data),

  update: (id: number, data: { legalName?: string; [key: string]: unknown }) =>
    apiRequest("PUT", `/api/customers/${id}`, data),
};
