import { describe, expect, it } from "vitest";
import { decideExplicitCompanyScope } from "../server/services/security/companyRequestScopePolicy";

describe("explicit company request scope parsing", () => {
  it("returns none when the caller does not supply companyId", () => {
    expect(decideExplicitCompanyScope({})).toEqual({ kind: "none" });
  });

  it("normalizes a positive query or body companyId", () => {
    expect(decideExplicitCompanyScope({ queryCompanyId: "12" })).toEqual({
      kind: "company",
      companyId: 12,
    });
    expect(decideExplicitCompanyScope({ bodyCompanyId: 7 })).toEqual({
      kind: "company",
      companyId: 7,
    });
  });

  it("accepts matching query and body company identifiers", () => {
    expect(
      decideExplicitCompanyScope({ queryCompanyId: "4", bodyCompanyId: 4 })
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
    expect(decideExplicitCompanyScope({ queryCompanyId: [1, 2] })).toEqual({
      kind: "invalid",
      source: "query",
    });
  });

  it("rejects conflicting query and body companies", () => {
    expect(
      decideExplicitCompanyScope({ queryCompanyId: 2, bodyCompanyId: 3 })
    ).toEqual({ kind: "conflict", queryCompanyId: 2, bodyCompanyId: 3 });
  });
});
