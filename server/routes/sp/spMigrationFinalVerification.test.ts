import { describe, expect, it } from "vitest";
import { summarizeVerification, type VerificationArea } from "./spMigrationFinalVerification";

function area(status: VerificationArea["status"]): VerificationArea {
  return { area: status, status, detail: status, mismatches: [] };
}

describe("summarizeVerification", () => {
  it("returns PASS when every verification area passes", () => {
    expect(summarizeVerification([area("PASS"), area("PASS")])).toBe("PASS");
  });

  it("returns WARN when there are warnings but no failures", () => {
    expect(summarizeVerification([area("PASS"), area("WARN")])).toBe("WARN");
  });

  it("returns FAIL whenever any area fails", () => {
    expect(summarizeVerification([area("WARN"), area("FAIL"), area("PASS")])).toBe("FAIL");
  });
});
