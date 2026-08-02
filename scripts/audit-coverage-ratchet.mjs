#!/usr/bin/env node
/**
 * audit-coverage-ratchet.mjs
 *
 * Compares measured coverage against the floors in
 * config/coverage-thresholds.json and reports where they have drifted apart.
 *
 * The floors are a one-way ratchet, the same shape as the god-file boundaries:
 * CI fails when coverage drops below a floor, and this audit tells you when
 * coverage has climbed well above one so you can lock the gain in. Without the
 * second half a floor only ever describes the day it was written — which is how
 * the backend gate ended up at 8% while the suite actually covered 19%.
 *
 * Usage:
 *   npm run test:backend:coverage && npm run test:frontend:coverage
 *   node scripts/audit-coverage-ratchet.mjs [--headroom N]
 *
 * Exits non-zero only when coverage is BELOW a floor — that means the summary
 * on disk disagrees with what CI enforces, which should never happen. Headroom
 * is reported, never fatal.
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ROOT = process.cwd();
const CONFIG_PATH = resolve(ROOT, "config/coverage-thresholds.json");
const METRICS = ["lines", "statements", "functions", "branches"];

// Floors are generated a little under measured coverage (10% of the value,
// capped at 3 points, then floored to an integer — so up to ~4 points under).
// The headroom default has to sit above that or every floor reports as drifted
// the moment it is written, and the signal is worth nothing.
const headroomIndex = process.argv.indexOf("--headroom");
const HEADROOM = headroomIndex === -1 ? 5 : Number(process.argv[headroomIndex + 1]);

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

const SUITES = [
  { name: "backend", summary: "coverage/backend/coverage-summary.json", command: "npm run test:backend:coverage" },
  { name: "frontend", summary: "coverage/frontend/coverage-summary.json", command: "npm run test:frontend:coverage" },
];

let belowFloor = 0;
let withHeadroom = 0;
let checked = 0;
let skipped = 0;

function compare(label, measured, floors, findings) {
  for (const metric of METRICS) {
    const floor = floors[metric];
    if (floor === undefined) continue;
    const actual = measured[metric].pct;
    checked += 1;

    if (actual < floor) {
      findings.below.push(`   ${label} ${metric}: ${actual}% is BELOW its floor of ${floor}%`);
      belowFloor += 1;
    } else if (actual - floor > HEADROOM) {
      findings.headroom.push(
        `   ${label} ${metric}: ${actual}% vs floor ${floor}% — raise to ${Math.floor(actual - 1)}%`
      );
      withHeadroom += 1;
    }
  }
}

for (const suite of SUITES) {
  const summaryPath = resolve(ROOT, suite.summary);
  if (!existsSync(summaryPath)) {
    console.log(`⏭️   ${suite.name}: no coverage report on disk. Run \`${suite.command}\` first.`);
    skipped += 1;
    continue;
  }

  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const thresholds = config[suite.name];
  const findings = { below: [], headroom: [] };

  compare(`${suite.name} (global)`, summary.total, thresholds.global, findings);

  for (const [file, floors] of Object.entries(thresholds.perFile)) {
    const entry = summary[resolve(ROOT, file)] ?? summary[file];
    if (!entry) {
      // A gated file that the coverage run never saw is a silent hole: the
      // threshold cannot fail, so it reads as passing forever.
      findings.below.push(`   ${file}: gated in config but absent from the ${suite.name} coverage report`);
      belowFloor += 1;
      continue;
    }
    compare(file, entry, floors, findings);
  }

  if (findings.below.length > 0) {
    console.log(`\n❌  ${suite.name}: coverage below the configured floor`);
    for (const line of findings.below) console.log(line);
  }

  if (findings.headroom.length > 0) {
    console.log(`\n⚠️   ${suite.name}: ${findings.headroom.length} floor(s) more than ${HEADROOM} points below measured coverage`);
    for (const line of findings.headroom) console.log(line);
    console.log(`   Raise these in config/coverage-thresholds.json to lock the gain in.`);
  }

  if (findings.below.length === 0 && findings.headroom.length === 0) {
    console.log(`✅  ${suite.name}: every floor is met and none has drifted more than ${HEADROOM} points.`);
  }
}

console.log(
  `\nChecked ${checked} threshold(s) across ${SUITES.length - skipped} suite(s): ` +
    `${belowFloor} below floor, ${withHeadroom} with headroom.`
);

if (belowFloor > 0) {
  console.error(
    "\nCoverage is below a floor that CI enforces. Either the tests regressed, or a\n" +
      "floor was raised without re-running the suite. Fix the tests rather than\n" +
      "lowering the floor — and if you must lower one, say why in the commit message."
  );
  process.exit(1);
}
