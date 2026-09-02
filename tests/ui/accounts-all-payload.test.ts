import { describe, expect, it } from "vitest";

import { selectAccountsArray } from "../../client/src/lib/accountsAllPayload";

describe("selectAccountsArray", () => {
  const accounts = [
    { id: "ledger:1", name: "Cash" },
    { id: "bank:2", name: "Bank" },
  ];

  it("unwraps the documented /api/accounts/all envelope", () => {
    expect(selectAccountsArray({ accounts, asOfDate: "2026-09-01" })).toBe(accounts);
  });

  it("accepts a legacy bare-array cache entry during client navigation", () => {
    expect(selectAccountsArray(accounts)).toBe(accounts);
  });

  it("fails closed instead of exposing a non-array value to filter/map callers", () => {
    expect(selectAccountsArray(undefined)).toEqual([]);
    expect(selectAccountsArray({ accounts: undefined })).toEqual([]);
  });
});
