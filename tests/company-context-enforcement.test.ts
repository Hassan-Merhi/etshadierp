import { describe, expect, it } from "vitest";
import {
  collectCompanyAssertions,
  decideExplicitCompanyContext,
  parsePositiveCompanyId,
} from "../server/services/security/companyContextPolicy";

describe("explicit company context policy", () => {
  it.each([
    [7, 7],
    ["7", 7],
    [" 7 ", 7],
    [0, null],
    [-1, null],
    [1.5, null],
    ["7.5", null],
    ["abc", null],
    [null, null],
  ])("parses company IDs without coercing invalid values", (input, expected) => {
    expect(parsePositiveCompanyId(input)).toBe(expected);
  });

  it("collects assertions from body, query and params in deterministic order", () => {
    expect(
      collectCompanyAssertions(
        [{ companyId: "7" }, { factoryCompanyId: 7 }, { companyId: 7 }],
        ["companyId", "factoryCompanyId"],
      ),
    ).toEqual([7, 7, 7]);
  });

  it("marks any malformed request assertion as a mismatch sentinel", () => {
    expect(collectCompanyAssertions([{ companyId: "nope" }, { companyId: 7 }], ["companyId"])).toEqual([-1]);
  });

  it("ignores absent assertion containers and empty values", () => {
    expect(
      collectCompanyAssertions([null, undefined, { companyId: "", factoryCompanyId: null }], [
        "companyId",
        "factoryCompanyId",
      ]),
    ).toEqual([]);
  });

  it("accepts the authenticated company with no assertions", () => {
    expect(decideExplicitCompanyContext({ currentCompanyId: 7 })).toEqual({
      allowed: true,
      companyId: 7,
      code: "COMPANY_CONTEXT_OK",
    });
  });

  it.each([{}, { currentCompanyId: 0 }, { currentCompanyId: "invalid" }, { factoryCompanyId: 7 }])(
    "rejects a missing or malformed authenticated company",
    (session) => {
      expect(decideExplicitCompanyContext(session)).toEqual({
        allowed: false,
        companyId: null,
        code: "COMPANY_CONTEXT_REQUIRED",
      });
    },
  );

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

  it.each([8, "invalid", 0])("rejects mismatched or malformed legacy factory context", (factoryCompanyId) => {
    expect(decideExplicitCompanyContext({ currentCompanyId: 7, factoryCompanyId })).toEqual({
      allowed: false,
      companyId: 7,
      code: "COMPANY_CONTEXT_MISMATCH",
    });
  });

  it("can ignore the legacy assertion only when the caller explicitly opts out", () => {
    expect(decideExplicitCompanyContext({ currentCompanyId: 7, factoryCompanyId: 8 }, [], false)).toEqual({
      allowed: true,
      companyId: 7,
      code: "COMPANY_CONTEXT_OK",
    });
  });
});
