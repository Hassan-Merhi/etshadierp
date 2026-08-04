import { QueryClient } from "@tanstack/react-query";
import {
  companyQueryKey,
  isCompanySessionQueryKey,
  isGlobalQueryKey,
  removeCompanySessionQueries,
} from "@/lib/companyQueryScope";

describe("company query scope", () => {
  it("keeps the request URL first and company identity in the cache key", () => {
    expect(companyQueryKey("/api/accounts/all", 4, "2026-07-29")).toEqual([
      "/api/accounts/all",
      4,
      "2026-07-29",
    ]);
    expect(companyQueryKey("/api/accounts/all", null)).toEqual([
      "/api/accounts/all",
      "no-company",
    ]);
  });

  it("preserves only the explicit global query allow-list", () => {
    expect(isGlobalQueryKey(["/api/auth/me"])).toBe(true);
    expect(isGlobalQueryKey(["/api/user/companies"])).toBe(true);
    expect(isCompanySessionQueryKey(["/api/accounts/all", 1])).toBe(true);
    expect(isCompanySessionQueryKey(["account-statement", 1, "ledger", 10])).toBe(true);
  });

  it("removes company data and resets active-company authentication fields", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    client.setQueryData(["/api/auth/me"], {
      id: "user-1",
      canSellNegativeStock: false,
    });
    client.setQueryData(["/api/user/companies"], [
      { companyId: 1 },
      { companyId: 2 },
    ]);
    client.setQueryData(["/api/accounts/all", 1], { accounts: [{ id: 1 }] });
    client.setQueryData(["/api/inventory", 1], [{ id: 2 }]);
    client.setQueryData(["account-statement", 1, "ledger", 10], [{ id: 3 }]);

    removeCompanySessionQueries(client);

    expect(client.getQueryData(["/api/auth/me"])).toBeUndefined();
    expect(client.getQueryData(["/api/user/companies"])).toEqual([
      { companyId: 1 },
      { companyId: 2 },
    ]);
    expect(client.getQueryData(["/api/accounts/all", 1])).toBeUndefined();
    expect(client.getQueryData(["/api/inventory", 1])).toBeUndefined();
    expect(
      client.getQueryData(["account-statement", 1, "ledger", 10]),
    ).toBeUndefined();
  });
});
