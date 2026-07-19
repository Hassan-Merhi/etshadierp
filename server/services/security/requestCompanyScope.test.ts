import { describe, expect, it } from "vitest";
import { CompanyIsolationError } from "./companyIsolationPolicy";
import { resolveRequestCompanyId, resolveSessionCompanyActor } from "./requestCompanyScope";

const session = {
  userId: 7,
  currentRole: "Admin",
  currentCompanyId: 11,
};

describe("requestCompanyScope", () => {
  it("uses the authenticated session company when none is supplied", () => {
    expect(resolveRequestCompanyId({ session })).toBe(11);
  });

  it("accepts a matching supplied company", () => {
    expect(resolveRequestCompanyId({ session, query: { companyId: "11" } })).toBe(11);
  });

  it("rejects a cross-company request", () => {
    expect(() => resolveRequestCompanyId({ session, body: { companyId: 12 } })).toThrow(CompanyIsolationError);
  });

  it("rejects missing authenticated company context", () => {
    expect(() => resolveSessionCompanyActor({ session: { userId: 7 } })).toThrow(CompanyIsolationError);
  });
});
