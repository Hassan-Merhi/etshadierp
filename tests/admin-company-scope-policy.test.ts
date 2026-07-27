import { describe, expect, it } from "vitest";
import { decideAdminCompanyScope } from "../server/services/security/adminCompanyScopePolicy";

describe("admin company scope policy", () => {
  it("allows requests without an explicit company filter", () => {
    expect(decideAdminCompanyScope({ activeCompanyId: 4 })).toEqual({ kind: "none" });
  });

  it("allows matching query, body, and path identifiers", () => {
    expect(
      decideAdminCompanyScope({
        activeCompanyId: 4,
        queryCompanyId: "4",
        bodyCompanyId: 4,
        pathCompanyId: "4",
      })
    ).toEqual({ kind: "match", companyId: 4 });
  });

  it("rejects malformed identifiers before route logic", () => {
    expect(decideAdminCompanyScope({ activeCompanyId: 4, queryCompanyId: "0" })).toEqual({
      kind: "invalid",
      source: "query",
    });
    expect(decideAdminCompanyScope({ activeCompanyId: 4, bodyCompanyId: [4] })).toEqual({
      kind: "invalid",
      source: "body",
    });
  });

  it("rejects conflicting request sources", () => {
    expect(
      decideAdminCompanyScope({ activeCompanyId: 4, queryCompanyId: 4, bodyCompanyId: 5 })
    ).toEqual({ kind: "conflict", companyIds: [4, 5] });
  });

  it("rejects a different company even for an otherwise privileged caller", () => {
    expect(decideAdminCompanyScope({ activeCompanyId: 4, pathCompanyId: 5 })).toEqual({
      kind: "cross-company",
      requestedCompanyId: 5,
      activeCompanyId: 4,
    });
  });

  it("rejects an explicit company when the session has no active company", () => {
    expect(decideAdminCompanyScope({ queryCompanyId: 4 })).toEqual({
      kind: "cross-company",
      requestedCompanyId: 4,
      activeCompanyId: null,
    });
  });
});
