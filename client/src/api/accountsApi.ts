import { apiRequest } from "@/lib/queryClient";

export const accountsApi = {
  createLedgerAccount: (data: {
    name: string;
    code?: string;
    type?: string;
    parentId?: number | null;
    companyId?: number;
    [key: string]: unknown;
  }) => apiRequest("POST", "/api/ledger-accounts", data),

  updateLedgerAccount: (
    id: number,
    data: {
      name?: string;
      code?: string;
      type?: string;
      parentId?: number | null;
      [key: string]: unknown;
    }
  ) => apiRequest("PUT", `/api/ledger-accounts/${id}`, data),

  bulkAssignParent: (accountIds: number[], parentId: number | null) =>
    apiRequest("PATCH", "/api/ledger-accounts/bulk-assign-parent", {
      accountIds,
      parentId,
    }),
};
