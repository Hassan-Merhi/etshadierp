import { describe, expect, it } from "vitest";
import {
  normalizeLoadingArticleCode,
  shouldEnforceProformaOverload,
  shouldRequireProformaMembership,
} from "../server/routes/factory/customer-orders/bale-scanning/proformaScanPolicy";

describe("factory loading proforma scan policy", () => {
  it("normalizes proforma article codes across whitespace and case", () => {
    expect(normalizeLoadingArticleCode("  AbC-123  ")).toBe("abc-123");
    expect(normalizeLoadingArticleCode(null)).toBe("");
  });

  it("Ignore Proforma bypasses the overload confirmation on the first scan", () => {
    expect(
      shouldEnforceProformaOverload({
        ignoreProforma: true,
        allowBypassOverload: false,
      })
    ).toBe(false);
  });

  it("keeps the normal double-scan overload confirmation when Ignore Proforma is off", () => {
    expect(
      shouldEnforceProformaOverload({
        ignoreProforma: false,
        allowBypassOverload: false,
      })
    ).toBe(true);
    expect(
      shouldEnforceProformaOverload({
        ignoreProforma: false,
        allowBypassOverload: true,
      })
    ).toBe(false);
  });

  it("Ignore Proforma bypasses not-in-proforma confirmation but normal mode still requires it", () => {
    expect(shouldRequireProformaMembership({ ignoreProforma: true, hasProformaLine: false })).toBe(false);
    expect(shouldRequireProformaMembership({ ignoreProforma: false, hasProformaLine: false })).toBe(true);
    expect(shouldRequireProformaMembership({ ignoreProforma: false, hasProformaLine: true })).toBe(false);
  });
});
