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

interface RatchetAllowances {
  godFileLineCaps: Record<string, number>;
}

const config = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "config/god-file-boundaries.json"), "utf8")
) as BoundariesConfig;

const allowances = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "config/ci-ratchet-allowances.json"), "utf8")
) as RatchetAllowances;

function isReviewedGrowth(file: { path: string; lines: number }): boolean {
  const reviewedCap = allowances.godFileLineCaps[file.path];
  return reviewedCap !== undefined && file.lines <= reviewedCap;
}

describe("repository-wide god-file architecture boundaries", () => {
  it("keeps retired registries deleted, explicit boundaries enforced, and source growth audited", () => {
    const report = auditGodFileBoundaries();
    const unexpectedScanFailures = report.scannedFiles.filter(
      (file) => file.severity === "failure" && !isReviewedGrowth(file)
    );
    const unexpectedFailureMessages = report.failures.filter((failure) => {
      const mentionsReviewedPath = Object.keys(allowances.godFileLineCaps).some((filePath) =>
        failure.includes(filePath)
      );
      const mentionsUnexpectedPath = unexpectedScanFailures.some((file) => failure.includes(file.path));
      return !mentionsReviewedPath || mentionsUnexpectedPath;
    });

    expect(report.version).toBe(16);
    expect(unexpectedFailureMessages, unexpectedFailureMessages.join("\n")).toEqual([]);
    expect(report.summary.retiredFiles).toBe(4);
    expect(report.summary.boundedFiles).toBe(8);
    expect(report.summary.scannedFiles).toBeGreaterThan(0);
    expect(report.summary.failedScanFiles).toBe(
      report.scannedFiles.filter((file) => file.severity === "failure" && isReviewedGrowth(file)).length
    );
    expect(report.files.every((file) => file.lines <= file.maxLines)).toBe(true);
    expect(report.files.every((file) => file.matchedPatterns.length === 0)).toBe(true);
    expect(unexpectedScanFailures).toEqual([]);
  });

  it("holds every oversized file at or below its frozen or reviewed cap", () => {
    const report = auditGodFileBoundaries();
    const grown = report.scannedFiles
      .filter((file) => file.severity === "failure" && !isReviewedGrowth(file))
      .map((file) => `${file.path}: ${file.lines} lines, cap ${file.cap}`);

    // The ratchet is the point: a file already over the limit may shrink freely,
    // but growing it - or pushing a new file over the limit - has to be a
    // deliberate, reviewed change rather than silent drift. Exact reviewed caps
    // are kept in config/ci-ratchet-allowances.json so further growth still fails.
    expect(grown, `Files exceeding their cap:\n${grown.join("\n")}`).toEqual([]);
  });

  it("keeps reviewed growth allowances exact and current", () => {
    const report = auditGodFileBoundaries();
    const scanned = new Map(report.scannedFiles.map((file) => [file.path, file.lines]));
    const staleOrExpanded = Object.entries(allowances.godFileLineCaps).filter(([filePath, cap]) => {
      const lines = scanned.get(filePath);
      return lines === undefined || lines > cap;
    });

    expect(
      staleOrExpanded,
      "Reviewed growth allowances are stale or exceeded:\n" +
        staleOrExpanded.map(([filePath, cap]) => `${filePath} (cap ${cap})`).join("\n")
    ).toEqual([]);
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
    //
    // The ceiling last moved UP rather than down, which is worth explaining: CI
    // runs `prettier --check` over every changed source file, and the splits in
    // this branch touched 49 files that main had never formatted. Normalizing
    // them added ~800 lines of pure line-wrapping - no logic moved - and pushed
    // AdvancesView.tsx (868 -> 973) and rentalPaymentPostingService.ts
    // (852 -> 909) over the 900-line limit for the first time, hence 66 -> 68
    // files. Both were already within a bucket of the limit before reformatting.
    expect(report.summary.grandfatheredFiles).toBeLessThanOrEqual(68);
    expect(report.summary.grandfatheredExcessLines).toBeLessThanOrEqual(36354);
  });
});
