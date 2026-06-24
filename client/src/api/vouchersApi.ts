import { apiRequest } from "@/lib/queryClient";

export const vouchersApi = {
  bulkDelete: (voucherIds: number[]) =>
    apiRequest("POST", "/api/vouchers/bulk-delete", { voucherIds }),

  // NOTE: createVoucher and updateVoucher are intentionally left inline in
  // VoucherEdit.tsx — that page has complex multi-step logic and needs
  // verification before further abstraction.
  // See docs/frontend-api-client-audit.md for full classification.
};
