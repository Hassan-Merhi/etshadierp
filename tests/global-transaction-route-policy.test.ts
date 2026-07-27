import { describe, expect, it } from "vitest";
import { classifyGlobalVoucherRoute } from "../server/services/security/globalTransactionRoutePolicy";

describe("global transaction route policy", () => {
  it("classifies detail and rich-entry views", () => {
    expect(classifyGlobalVoucherRoute("/api/global/transactions/42/detail")).toEqual({
      voucherId: 42,
      view: "detail",
    });
    expect(classifyGlobalVoucherRoute("/api/global/transactions/42/view-entries")).toEqual({
      voucherId: 42,
      view: "view-entries",
    });
  });

  it("does not classify list, type, or malformed routes", () => {
    expect(classifyGlobalVoucherRoute("/api/global/transactions")).toBeNull();
    expect(classifyGlobalVoucherRoute("/api/global/transactions/voucher-types")).toBeNull();
    expect(classifyGlobalVoucherRoute("/api/global/transactions/0/detail")).toBeNull();
    expect(classifyGlobalVoucherRoute("/api/global/transactions/not-an-id/detail")).toBeNull();
  });
});
