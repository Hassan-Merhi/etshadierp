import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { auditGodFileBoundaries } from "../scripts/audit-god-file-boundaries.mjs";

interface BoundariesConfig {
  version: number;
  repositoryScan: {
    softMaxLines: number;
    ratchetBucketLines: number;
    grandfathered: Record<string, number>;
    excludeFiles: string[];
  };
}

const config = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "config/god-file-boundaries.json"), "utf8")
) as BoundariesConfig;

describe("repository-wide god-file architecture boundaries", () => {
  it("keeps retired registries deleted, explicit boundaries enforced, and source growth audited", () => {
    const report = auditGodFileBoundaries();

    expect(report.version).toBe(16);
    expect(report.failures, report.failures.join("\n")).toEqual([]);
    expect(report.summary.retiredFiles).toBe(4);
    expect(report.summary.boundedFiles).toBe(8);
    expect(report.summary.scannedFiles).toBeGreaterThan(0);
    expect(report.summary.failedScanFiles).toBe(0);
    expect(report.files.every((file) => file.lines <= file.maxLines)).toBe(true);
    expect(report.files.every((file) => file.matchedPatterns.length === 0)).toBe(true);
    expect(report.scannedFiles.every((file) => file.severity !== "failure")).toBe(true);
  });

  it("holds every oversized file at or below its frozen baseline", () => {
    const report = auditGodFileBoundaries();
    const grown = report.scannedFiles
      .filter((file) => file.severity === "failure")
      .map((file) => `${file.path}: ${file.lines} lines, cap ${file.cap}`);

    // The ratchet is the point: a file already over the limit may shrink freely,
    // but growing it - or pushing a new file over the limit - has to be a
    // deliberate, reviewed baseline change rather than silent drift.
    expect(grown, `Files exceeding their cap:\n${grown.join("\n")}`).toEqual([]);
  });

  it("only exempts vendored code from the size ratchet", () => {
    // Everything the team actually authors must be ratcheted. Blanket
    // exclusions are how the largest files escaped scrutiny previously.
    expect(config.repositoryScan.excludeFiles).toEqual(["client/src/components/ui/sidebar.tsx"]);
  });

  it("keeps the frozen baseline free of files that no longer qualify", () => {
    const report = auditGodFileBoundaries();
    const scanned = new Map(report.scannedFiles.map((file) => [file.path, file.lines]));

    const stale = Object.keys(config.repositoryScan.grandfathered).filter((filePath) => {
      const lines = scanned.get(filePath);
      // Either the file is gone, or it has shrunk back under the repository
      // limit - both mean the entry should be removed to lock in the gain.
      return lines === undefined || lines <= config.repositoryScan.softMaxLines;
    });

    expect(
      stale,
      "These files are baselined but no longer need to be. Remove them from " +
        `config/god-file-boundaries.json to make the gain permanent:\n${stale.join("\n")}`
    ).toEqual([]);
  });

  it("reports the outstanding split backlog as a falling ceiling", () => {
    const report = auditGodFileBoundaries();

    // A single number for the work remaining: lines carried above the repository
    // limit. It exists to be driven down, so it is asserted as a ceiling and
    // should be lowered as the split phases land.
    expect(report.summary.grandfatheredFiles).toBeLessThanOrEqual(140);
    expect(report.summary.grandfatheredExcessLines).toBeLessThanOrEqual(79007);
  });
});
