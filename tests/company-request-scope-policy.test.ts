import { describe, expect, it } from "vitest";
import { decideExplicitCompanyScope } from "../server/services/security/companyRequestScopePolicy";

describe("explicit company request scope parsing", () => {
  it("returns none when the caller does not supply companyId", () => {
    expect(decideExplicitCompanyScope({})).toEqual({ kind: "none" });
  });

  it("normalizes a positive query, body, or path companyId", () => {
    expect(decideExplicitCompanyScope({ queryCompanyId: "12" })).toEqual({
      kind: "company",
      companyId: 12,
    });
    expect(decideExplicitCompanyScope({ bodyCompanyId: 7 })).toEqual({
      kind: "company",
      companyId: 7,
    });
    expect(decideExplicitCompanyScope({ pathCompanyId: "9" })).toEqual({
      kind: "company",
      companyId: 9,
    });
  });

  it("accepts matching identifiers from multiple request sources", () => {
    expect(
      decideExplicitCompanyScope({ queryCompanyId: "4", bodyCompanyId: 4, pathCompanyId: "4" })
    ).toEqual({ kind: "company", companyId: 4 });
  });

  it("rejects invalid identifiers", () => {
    expect(decideExplicitCompanyScope({ queryCompanyId: "0" })).toEqual({
      kind: "invalid",
      source: "query",
    });
    expect(decideExplicitCompanyScope({ bodyCompanyId: -1 })).toEqual({
      kind: "invalid",
      source: "body",
    });
    expect(decideExplicitCompanyScope({ pathCompanyId: [1, 2] })).toEqual({
      kind: "invalid",
      source: "path",
    });
  });

  it("rejects conflicting companies from any request source", () => {
    expect(
      decideExplicitCompanyScope({ queryCompanyId: 2, bodyCompanyId: 3, pathCompanyId: 2 })
    ).toEqual({ kind: "conflict", companyIds: [2, 3] });
  });
});
