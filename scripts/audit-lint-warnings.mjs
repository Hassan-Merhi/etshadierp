#!/usr/bin/env node
/**
 * audit-lint-warnings.mjs
 *
 * The per-rule half of the lint ratchet. `npm run lint` enforces the total
 * ceiling; this reads the report that run produced and checks each rule against
 * its own frozen count in config/lint-warning-ratchet.json.
 *
 * Why per-rule and not just a total
 * ---------------------------------
 * 11,440 of the 12,304 warnings are @typescript-eslint/no-explicit-any, so a
 * single total is effectively a count of `any`. Against a total-only gate,
 * deleting 500 `any` annotations buys room for 500 new react-hooks/exhaustive-
 * deps warnings — a rule whose warnings are stale-closure bugs waiting to be
 * reported as missing data. The trade would show up as a 0 net change and pass.
 * Freezing each rule separately makes that trade fail while still letting any
 * single rule fall freely.
 *
 * no-explicit-any is the one rule whose real gate lives elsewhere:
 * config/type-escape-boundaries.json freezes it per file, which is strictly
 * stronger. Its entry here exists so the two cannot drift apart, and this audit
 * checks that they still agree.
 *
 * Usage:
 *   npm run lint && npm run audit:lint-ratchet
 *   node scripts/audit-lint-warnings.mjs --json
 *   UPDATE_LINT_WARNING_BASELINE=1 node scripts/audit-lint-warnings.mjs
 *
 * Exits non-zero when a rule is above its ceiling, when the report disagrees
 * with the total the lint gate enforces, or when the no-explicit-any ceiling
 * has drifted from the type-escape ceiling. Headroom is reported, never fatal.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const ROOT = process.cwd();
const CONFIG_PATH = resolve(ROOT, "config/lint-warning-ratchet.json");
const TYPE_ESCAPE_CONFIG_PATH = resolve(ROOT, "config/type-escape-boundaries.json");
const ANY_RULE = "@typescript-eslint/no-explicit-any";

export function auditLintWarnings() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const reportPath = resolve(ROOT, config.scan.reportPath);

  if (!existsSync(reportPath)) {
    return { missingReport: true, reportPath: config.scan.reportPath, failures: [], warnings: [] };
  }

  const results = JSON.parse(readFileSync(reportPath, "utf8"));
  const failures = [];
  const advisories = [];

  const measured = {};
  let warningTotal = 0;
  let errorTotal = 0;

  for (const result of results) {
    errorTotal += result.errorCount;
    warningTotal += result.warningCount;
    for (const message of result.messages) {
      // severity 1 is a warning; errors are governed by the error ceiling and
      // are not part of any rule's drawdown.
      if (message.severity !== 1) continue;
      const rule = message.ruleId ?? "(no-rule)";
      measured[rule] = (measured[rule] ?? 0) + 1;
    }
  }

  const { warningCeiling, errorCeiling } = config.totals;

  if (errorTotal > errorCeiling) {
    failures.push(`${errorTotal} ESLint error(s) in the report, ceiling is ${errorCeiling}.`);
  }

  if (warningTotal > warningCeiling) {
    failures.push(
      `${warningTotal} warnings in the report exceeds totals.warningCeiling of ${warningCeiling}. ` +
        `The lint gate should already have failed — if it did not, the report on disk is stale.`
    );
  }

  for (const [rule, count] of Object.entries(measured)) {
    const ceiling = config.perRule[rule];
    if (ceiling === undefined) {
      failures.push(
        `${rule}: ${count} warning(s) but no entry in perRule. A rule with no ceiling ` +
          `is ungated — add it at its current count, or fix the warnings.`
      );
      continue;
    }
    if (count > ceiling) {
      failures.push(`${rule}: ${count} warning(s) exceeds its ceiling of ${ceiling} by ${count - ceiling}.`);
    } else if (count < ceiling) {
      advisories.push(`${rule}: ${count} vs ceiling ${ceiling} — lower it to ${count}.`);
    }
  }

  for (const rule of Object.keys(config.perRule)) {
    if (measured[rule] !== undefined) continue;
    // A rule that has reached zero is a finished drawdown. Its ceiling must go
    // to 0 rather than sit unused, or it silently re-authorises the warnings.
    if (config.perRule[rule] !== 0) {
      advisories.push(`${rule}: 0 warnings remain vs ceiling ${config.perRule[rule]} — lower it to 0.`);
    }
  }

  // The two configs count the same `any` from different places: ESLint reports
  // one warning per `any` in a type position, the type-escape audit counts the
  // same AnyKeyword nodes plus ts-comment suppressions, which are not a rule.
  let typeEscapeAgreement = null;
  if (existsSync(TYPE_ESCAPE_CONFIG_PATH)) {
    const typeEscapes = JSON.parse(readFileSync(TYPE_ESCAPE_CONFIG_PATH, "utf8"));
    const typeEscapeCeiling = typeEscapes.totals?.typeEscapeCeiling;
    const suppressions = Object.values(typeEscapes.scan?.baseline ?? {}).reduce(
      (total, entry) => total + (entry[2] ?? 0),
      0
    );
    const expected = typeEscapeCeiling - suppressions;
    typeEscapeAgreement = { typeEscapeCeiling, suppressions, expected, actual: config.perRule[ANY_RULE] };
    if (config.perRule[ANY_RULE] !== expected) {
      failures.push(
        `${ANY_RULE} ceiling is ${config.perRule[ANY_RULE]} but config/type-escape-boundaries.json implies ` +
          `${expected} (${typeEscapeCeiling} escapes - ${suppressions} suppressions). Lower both in the ` +
          `same change, or the weaker of the two gates stops describing the backlog.`
      );
    }
  }

  const step = config.scan.step;
  const headroom = warningCeiling - warningTotal;

  return {
    missingReport: false,
    summary: {
      lintedFiles: results.length,
      errorTotal,
      warningTotal,
      warningCeiling,
      headroom,
      step,
      stepEarned: headroom >= step,
      rules: Object.keys(config.perRule).length,
      typeEscapeAgreement,
    },
    measured,
    failures,
    warnings: advisories,
  };
}

/** Rebuilds perRule and the totals from the current report. Used to seed the ratchet, not to fix a red build. */
function writeBaseline(report) {
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  config.perRule = Object.fromEntries(Object.entries(report.measured).sort((a, b) => b[1] - a[1]));
  config.totals = { ...config.totals, warningCeiling: report.summary.warningTotal };
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  return Object.keys(config.perRule).length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = auditLintWarnings();

  if (report.missingReport) {
    console.log(`⏭️   No lint report at ${report.reportPath}. Run \`npm run lint\` first.`);
    process.exit(0);
  }

  if (process.env.UPDATE_LINT_WARNING_BASELINE === "1") {
    const rules = writeBaseline(report);
    console.log(
      `Baseline rewritten: ${rules} rule(s), ceiling ${report.summary.warningTotal} warnings.`
    );
    process.exit(0);
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.failures.length > 0 ? 1 : 0);
  }

  for (const advisory of report.warnings) console.warn(`WARNING: ${advisory}`);

  if (report.failures.length > 0) {
    console.error(`\n${report.failures.join("\n")}`);
    console.error(
      `\nCeilings in config/lint-warning-ratchet.json may only fall. Raising one to make a\n` +
        `change fit turns the ratchet back into the bookmark it replaced.`
    );
    process.exitCode = 1;
  } else {
    const { summary } = report;
    console.log(
      `Lint ratchet verified across ${summary.lintedFiles} files: ${summary.warningTotal} warning(s) ` +
        `against a ceiling of ${summary.warningCeiling}, ${summary.rules} rule(s) at or under their own.`
    );
    if (summary.stepEarned) {
      console.log(
        `${summary.headroom} warnings of headroom, at or past the ${summary.step}-warning step — ` +
          `lower the ceilings above to lock the drawdown in.`
      );
    } else {
      console.log(`${summary.headroom} of the ${summary.step}-warning step earned toward the next tightening.`);
    }
  }
}
