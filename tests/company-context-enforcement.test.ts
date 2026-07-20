import { describe, expect, it } from "vitest";
import { decideExplicitCompanyContext } from "../server/services/security/companyContextEnforcementAdapter";

describe("explicit company context enforcement", () => {
  it("accepts the authenticated company with no assertions", () => {
    expect(decideExplicitCompanyContext({ currentCompanyId: 7 })).toEqual({
      allowed: true,
      companyId: 7,
      code: "COMPANY_CONTEXT_OK",
    });
  });

  it("rejects a missing authenticated company", () => {
    expect(decideExplicitCompanyContext({})).toEqual({
      allowed: false,
      companyId: null,
      code: "COMPANY_CONTEXT_REQUIRED",
    });
  });

  it("accepts matching request and legacy factory assertions", () => {
    expect(decideExplicitCompanyContext({ currentCompanyId: 7, factoryCompanyId: 7 }, [7, 7])).toEqual({
      allowed: true,
      companyId: 7,
      code: "COMPANY_CONTEXT_OK",
    });
  });

  it("rejects a mismatched request-supplied company assertion", () => {
    expect(decideExplicitCompanyContext({ currentCompanyId: 7 }, [8])).toEqual({
      allowed: false,
      companyId: 7,
      code: "COMPANY_CONTEXT_MISMATCH",
    });
  });

  it("rejects a mismatched legacy factory session company", () => {
    expect(decideExplicitCompanyContext({ currentCompanyId: 7, factoryCompanyId: 8 })).toEqual({
      allowed: false,
      companyId: 7,
      code: "COMPANY_CONTEXT_MISMATCH",
    });
  });

  it("does not permit legacy factoryCompanyId to replace a missing current company", () => {
    expect(decideExplicitCompanyContext({ factoryCompanyId: 7 })).toEqual({
      allowed: false,
      companyId: null,
      code: "COMPANY_CONTEXT_REQUIRED",
    });
  });
});
