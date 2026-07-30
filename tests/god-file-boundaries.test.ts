import { describe, expect, it } from "vitest";
import { auditGodFileBoundaries } from "../scripts/audit-god-file-boundaries.mjs";

describe("final god-file architecture boundaries", () => {
  it("keeps legacy route registries retired and composition files bounded", () => {
    const report = auditGodFileBoundaries();

    expect(report.version).toBe(10);
    expect(report.failures, report.failures.join("\n")).toEqual([]);
    expect(report.summary.retiredFiles).toBe(4);
    expect(report.summary.boundedFiles).toBe(2);
    expect(report.files.every((file) => file.lines <= file.maxLines)).toBe(true);
    expect(report.files.every((file) => file.matchedPatterns.length === 0)).toBe(true);
  });
});
