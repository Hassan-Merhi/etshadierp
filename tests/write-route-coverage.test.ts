import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { auditWriteRouteCoverage } from "../scripts/audit-write-route-coverage.mjs";

const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config/write-route-coverage.json"), "utf8")) as {
  uncoveredSensitiveCeiling: number;
};

describe("write-route coverage ratchet", () => {
  it("never lets the untested write surface grow", () => {
    const report = auditWriteRouteCoverage();

    // The smoke sweep excludes mutating endpoints on purpose, so this is the
    // only thing measuring them. A new POST that writes to the ledger and
    // arrives with no test now fails here instead of arriving unnoticed.
    expect(
      report.summary.uncoveredSensitive,
      `${report.summary.uncoveredSensitive} write routes touching money or stock tables have no test ` +
        `referencing them; the ceiling is ${config.uncoveredSensitiveCeiling}. Run ` +
        `\`npm run audit:write-routes -- --list\` to see them.`
    ).toBeLessThanOrEqual(config.uncoveredSensitiveCeiling);
    expect(report.failures, report.failures.join("\n")).toEqual([]);
  });

  it("still resolves most routes to the file that registers them", () => {
    const report = auditWriteRouteCoverage();

    // The owner lookup finds the file containing the route's path literal. If a
    // refactor started building paths by concatenation, that lookup would
    // quietly return null for everything and the sensitivity classification
    // would collapse to zero without failing anything.
    expect(report.summary.unownedRoutes).toBeLessThan(report.summary.writeRoutes * 0.1);
  });

  it("classifies a meaningful share of write routes as sensitive", () => {
    const report = auditWriteRouteCoverage();

    // Guards the other direction: if SENSITIVE_TABLES stopped matching — a
    // table renamed, the drizzle builders replaced — the ceiling would be
    // trivially satisfied by a set that had become empty.
    expect(report.summary.sensitiveRoutes).toBeGreaterThan(100);
  });
});
