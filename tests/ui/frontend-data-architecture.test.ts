import { QueryClient } from "@tanstack/react-query";
import {
  canonicalApiUrl,
  canonicalSetValues,
  companyDataKey,
  invalidateApiFamily,
  invalidateCompanyApiFamily,
  paginatedCompanyDataKey,
  queryMatchesApiFamily,
  queryMatchesCompanyApiFamily,
  unwrapList,
  unwrapPage,
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

  it("normalizes set-like filter selections before URL creation", () => {
    expect(canonicalSetValues(["Kolwezi", "Lubumbashi", "Kolwezi", ""])).toEqual([
      "Kolwezi",
      "Lubumbashi",
    ]);
  });

  it("keeps request URL first and company identity second", () => {
    expect(companyDataKey("/api/accounts/all?endDate=2026-07-29", 7)).toEqual([
      "/api/accounts/all?endDate=2026-07-29",
      7,
    ]);
    expect(paginatedCompanyDataKey("/api/vouchers?page=3", 7, 3, 100, "daybook")).toEqual([
      "/api/vouchers?page=3",
      7,
      "page",
      3,
      100,
      "daybook",
    ]);
  });

  it("matches endpoint families without prefix collisions", () => {
    expect(queryMatchesApiFamily(["/api/accounts/all?limit=100", 1], "/api/accounts")).toBe(true);
    expect(queryMatchesApiFamily(["/api/accounts-old", 1], "/api/accounts")).toBe(false);
    expect(queryMatchesApiFamily(["/api/stock-items/light", 1], "/api/stock-items")).toBe(true);
  });

  it("matches endpoint families only inside the requested company identity", () => {
    expect(queryMatchesCompanyApiFamily(["/api/vouchers?page=1", 7], "/api/vouchers", 7)).toBe(true);
    expect(queryMatchesCompanyApiFamily(["/api/vouchers?page=1", 8], "/api/vouchers", 7)).toBe(false);
  });

  it("invalidates only the intended endpoint family", async () => {
    const client = new QueryClient();
    client.setQueryData(["/api/accounts/all", 1], { accounts: [] });
    client.setQueryData(["/api/accounts-old", 1], { accounts: [] });

    await invalidateApiFamily(client, "/api/accounts", { refetchType: "none" });

    expect(client.getQueryState(["/api/accounts/all", 1])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["/api/accounts-old", 1])?.isInvalidated).toBe(false);
  });

  it("invalidates one company without touching another company's page", async () => {
    const client = new QueryClient();
    const companySeven = ["/api/vouchers?page=1", 7] as const;
    const companyEight = ["/api/vouchers?page=1", 8] as const;
    client.setQueryData(companySeven, { data: [] });
    client.setQueryData(companyEight, { data: [] });

    await invalidateCompanyApiFamily(client, "/api/vouchers", 7, { refetchType: "none" });

    expect(client.getQueryState(companySeven)?.isInvalidated).toBe(true);
    expect(client.getQueryState(companyEight)?.isInvalidated).toBe(false);
  });

  it("unwraps legacy arrays and common paginated response shapes", () => {
    expect(unwrapList([1, 2])).toEqual([1, 2]);
    expect(unwrapList({ data: [3] })).toEqual([3]);
    expect(unwrapList({ items: [4] })).toEqual([4]);
    expect(unwrapList({ rows: [5] })).toEqual([5]);
    expect(unwrapList({ results: [6] })).toEqual([6]);
    expect(unwrapList(null)).toEqual([]);
  });

  it("normalizes page metadata for paginated and legacy responses", () => {
    expect(
      unwrapPage({ data: [1, 2], page: 2, pageSize: 2, total: 5, totalPages: 3, hasMore: true }),
    ).toEqual({ data: [1, 2], page: 2, pageSize: 2, total: 5, totalPages: 3, hasMore: true });
    expect(unwrapPage([1, 2], { page: 1, pageSize: 100 })).toEqual({
      data: [1, 2],
      page: 1,
      pageSize: 100,
      total: 2,
      totalPages: 1,
      hasMore: false,
    });
  });
});
