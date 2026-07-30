import { describe, expect, it } from "vitest";
import { auditLegacyRouteBoundaries } from "../scripts/audit-legacy-route-boundaries.mjs";

describe("legacy route reduction boundaries", () => {
  it("keeps the retired compatibility registry inventory empty", () => {
    const report = auditLegacyRouteBoundaries();

    expect(report.failures, report.failures.join("\n")).toEqual([]);
    expect(report.summary.legacyFiles).toBe(0);
    expect(report.files).toEqual([]);
  });
});
