import { describe, expect, it } from "vitest";

describe("god-files Wave 6 import compatibility", () => {
  it("preserves the original StockTransferForm named export path", async () => {
    const stockTransferFormModule = await import("@/pages/vouchers/StockTransferForm");

    expect(stockTransferFormModule.StockTransferForm).toBeTypeOf("function");
  });
});
