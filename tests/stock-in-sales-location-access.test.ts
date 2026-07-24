import { describe, expect, it } from "vitest";

import {
  StockInSalesLocationAccessError,
  applyRequestedLocationScope,
} from "../server/services/reports/stockInSalesLocationAccess";

describe("stock in and sales report location scope", () => {
  it("uses every assigned location when no explicit location filter is supplied", () => {
    expect(applyRequestedLocationScope([], [12, 13, 12])).toEqual([12, 13]);
  });

  it("keeps an explicitly requested subset of assigned locations", () => {
    expect(applyRequestedLocationScope([13], [12, 13])).toEqual([13]);
  });

  it("rejects any requested location outside the user's assignments", () => {
    expect(() => applyRequestedLocationScope([12, 99], [12, 13])).toThrow(
      "You can only view report data for your assigned locations"
    );
  });

  it("rejects restricted users without an assigned report location", () => {
    expect(() => applyRequestedLocationScope([], [])).toThrow(StockInSalesLocationAccessError);
  });
});
