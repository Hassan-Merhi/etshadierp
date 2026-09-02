import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { applyReferenceMutationResponse } from "@/lib/referenceMutationCache";
import { isSingleAmountVoucherType } from "@/pages/daybook/voucherdetailsdialog/utils";

describe("Supplier Partner profit report refresh", () => {
  it.each([
    ["POST", "/api/vouchers/journal"],
    ["PATCH", "/api/vouchers/10817/journal"],
    ["DELETE", "/api/vouchers/10817"],
  ])("refreshes every cached profit-report date range after %s %s", async (method, pathname) => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const client = { invalidateQueries } as unknown as QueryClient;
    const response = new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(
      applyReferenceMutationResponse({
        client,
        method,
        pathname,
        response,
      })
    ).resolves.toBe(true);

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const options = invalidateQueries.mock.calls[0][0];
    expect(options.refetchType).toBe("all");
    expect(options.predicate({ queryKey: ["/api/sp/report/profit?startDate=2026-09-01&endDate=2026-09-30"] })).toBe(
      true
    );
    expect(options.predicate({ queryKey: ["/api/sp/report/stock"] })).toBe(false);
  });

  it("renders Journal vouchers with separate debit and credit columns", () => {
    expect(isSingleAmountVoucherType("Journal")).toBe(false);
    expect(isSingleAmountVoucherType("Payment")).toBe(true);
    expect(isSingleAmountVoucherType("Receipt")).toBe(true);
  });
});
