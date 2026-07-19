import { describe, expect, it } from "vitest";
import {
  parseBoundedPagination,
  wantsBoundedPagination,
} from "../server/lib/boundedPagination";

describe("Program 6B bounded pagination", () => {
  it("preserves legacy response mode until pagination is explicitly requested", () => {
    expect(wantsBoundedPagination({})).toBe(false);
    expect(wantsBoundedPagination({ accountType: "Asset", search: "cash" })).toBe(false);

    expect(wantsBoundedPagination({ pagination: "1" })).toBe(true);
    expect(wantsBoundedPagination({ page: "1" })).toBe(true);
    expect(wantsBoundedPagination({ limit: "100" })).toBe(true);
    expect(wantsBoundedPagination({ pageSize: "100" })).toBe(true);
    expect(wantsBoundedPagination({ offset: "0" })).toBe(true);
  });

  it("uses conservative defaults and caps oversized limits", () => {
    expect(parseBoundedPagination({})).toEqual({ page: 1, limit: 100, offset: 0 });
    expect(parseBoundedPagination({ page: "3", limit: "5000" })).toEqual({
      page: 3,
      limit: 250,
      offset: 500,
    });
  });

  it("accepts pageSize as a compatibility alias", () => {
    expect(parseBoundedPagination({ page: "2", pageSize: "40" })).toEqual({
      page: 2,
      limit: 40,
      offset: 40,
    });
  });

  it("normalizes invalid and negative values without producing an unsafe offset", () => {
    expect(parseBoundedPagination({ page: "-4", limit: "0" })).toEqual({
      page: 1,
      limit: 100,
      offset: 0,
    });
    expect(parseBoundedPagination({ offset: "-900", limit: "25" })).toEqual({
      page: 1,
      limit: 25,
      offset: 0,
    });
    expect(parseBoundedPagination({ offset: "not-a-number", limit: "25" })).toEqual({
      page: 1,
      limit: 25,
      offset: 0,
    });
  });

  it("honors endpoint-specific defaults while never allowing max below default", () => {
    expect(
      parseBoundedPagination(
        { page: "2", limit: "1000" },
        { defaultLimit: 50, maxLimit: 200 }
      )
    ).toEqual({ page: 2, limit: 200, offset: 200 });

    expect(
      parseBoundedPagination(
        { limit: "1000" },
        { defaultLimit: 75, maxLimit: 25 }
      )
    ).toEqual({ page: 1, limit: 75, offset: 0 });
  });
});
