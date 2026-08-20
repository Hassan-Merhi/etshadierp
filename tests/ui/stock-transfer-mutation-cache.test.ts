import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { applyReferenceMutationResponse } from "@/lib/referenceMutationCache";

describe("stock transfer mutation cache refresh", () => {
  it("resets the exact transfer and voucher detail caches after an edit save", async () => {
    const resetQueries = vi.fn().mockResolvedValue(undefined);
    const client = { resetQueries } as unknown as QueryClient;
    const response = new Response(
      JSON.stringify({
        transfer: { id: 9, voucherId: 90, inventoryApplied: true },
        lifecycle: { transferId: 9, voucherId: 90 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    await expect(
      applyReferenceMutationResponse({
        client,
        method: "PUT",
        pathname: "/api/stock-transfers/9",
        response,
      })
    ).resolves.toBe(true);

    expect(resetQueries).toHaveBeenCalledTimes(2);
    expect(resetQueries).toHaveBeenCalledWith({
      queryKey: ["/api/stock-transfers", 90],
      exact: true,
    });
    expect(resetQueries).toHaveBeenCalledWith({
      queryKey: ["/api/vouchers", 90],
      exact: true,
    });
  });
});
