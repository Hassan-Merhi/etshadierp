import { describe, expect, it } from "vitest";
import { auditGodFileBoundaries } from "../scripts/audit-god-file-boundaries.mjs";

describe("repository-wide god-file architecture boundaries", () => {
  it("keeps retired registries deleted, explicit boundaries enforced, and source growth audited", () => {
    const report = auditGodFileBoundaries();

    expect(report.version).toBe(14);
    expect(report.failures, report.failures.join("\n")).toEqual([]);
    expect(report.summary.retiredFiles).toBe(4);
    expect(report.summary.boundedFiles).toBe(5);
    expect(report.summary.scannedFiles).toBeGreaterThan(0);
    expect(report.summary.failedScanFiles).toBe(0);
    expect(report.files.every((file) => file.lines <= file.maxLines)).toBe(true);
    expect(report.files.every((file) => file.matchedPatterns.length === 0)).toBe(true);
    expect(report.scannedFiles.every((file) => file.severity !== "failure")).toBe(true);
  });
});
