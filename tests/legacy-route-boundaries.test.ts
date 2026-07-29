import { describe, expect, it } from "vitest";
import { auditLegacyRouteBoundaries } from "../scripts/audit-legacy-route-boundaries.mjs";

describe("legacy route reduction boundaries", () => {
  it("keeps every compatibility registry at or below its frozen Phase 1 size", () => {
    const report = auditLegacyRouteBoundaries();

    expect(report.failures, report.failures.join("\n")).toEqual([]);
    expect(report.summary.legacyFiles).toBe(4);
    expect(report.files.map((file) => file.path)).toEqual([
      "server/routes/reportsRoutesLegacy.ts",
      "server/routes/authRoutesLegacy.ts",
      "server/routesLegacy.ts",
      "server/routes/customerRoutesLegacy.ts",
    ]);
  });

  it("produces an endpoint-level inventory for every legacy registry", () => {
    const report = auditLegacyRouteBoundaries();

    for (const file of report.files) {
      expect(file.actualLines).toBeGreaterThan(0);
      expect(file.routeRegistrations).toBe(file.routes.length);
      expect(file.routes.every((route) => route.file === file.path)).toBe(true);
    }
  });
});
