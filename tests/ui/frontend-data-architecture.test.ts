import { QueryClient } from "@tanstack/react-query";
import {
  canonicalApiUrl,
  companyDataKey,
  invalidateApiFamily,
  queryMatchesApiFamily,
  unwrapList,
} from "@/lib/frontendDataArchitecture";

describe("frontend data architecture", () => {
  it("canonicalizes equivalent filter objects", () => {
    expect(canonicalApiUrl("/api/vouchers", { page: 2, search: "cash", empty: "" })).toBe(
      "/api/vouchers?page=2&search=cash",
    );
    expect(canonicalApiUrl("/api/vouchers", { search: "cash", page: 2 })).toBe(
      "/api/vouchers?page=2&search=cash",
    );
  });

  it("keeps request URL first and company identity second", () => {
    expect(companyDataKey("/api/accounts/all?endDate=2026-07-29", 7)).toEqual([
      "/api/accounts/all?endDate=2026-07-29",
      7,
    ]);
  });

  it("matches endpoint families without prefix collisions", () => {
    expect(queryMatchesApiFamily(["/api/accounts/all?limit=100", 1], "/api/accounts")).toBe(true);
    expect(queryMatchesApiFamily(["/api/accounts-old", 1], "/api/accounts")).toBe(false);
    expect(queryMatchesApiFamily(["/api/stock-items/light", 1], "/api/stock-items")).toBe(true);
  });

  it("invalidates only the intended endpoint family", async () => {
    const client = new QueryClient();
    client.setQueryData(["/api/accounts/all", 1], { accounts: [] });
    client.setQueryData(["/api/accounts-old", 1], { accounts: [] });

    await invalidateApiFamily(client, "/api/accounts", { refetchType: "none" });

    expect(client.getQueryState(["/api/accounts/all", 1])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["/api/accounts-old", 1])?.isInvalidated).toBe(false);
  });

  it("unwraps legacy arrays and common paginated response shapes", () => {
    expect(unwrapList([1, 2])).toEqual([1, 2]);
    expect(unwrapList({ data: [3] })).toEqual([3]);
    expect(unwrapList({ items: [4] })).toEqual([4]);
    expect(unwrapList({ rows: [5] })).toEqual([5]);
    expect(unwrapList({ results: [6] })).toEqual([6]);
    expect(unwrapList(null)).toEqual([]);
  });
});
