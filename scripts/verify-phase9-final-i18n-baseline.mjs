#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const releasePath = process.env.PHASE9_I18N_RELEASE_BASELINE || "config/i18n-phase9-final-release.json";
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "phase9-i18n-"));
const reportPath = path.join(temporaryDirectory, "report.json");

try {
  const audit = spawnSync(
    process.execPath,
    ["scripts/audit-i18n-phase14.mjs", "--json-out", reportPath],
    { encoding: "utf8", stdio: "pipe" },
  );

  if (audit.stdout) process.stdout.write(audit.stdout);
  if (audit.stderr) process.stderr.write(audit.stderr);
  if (audit.status !== 0) process.exit(audit.status ?? 1);

  const approved = JSON.parse(fs.readFileSync(releasePath, "utf8"));
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const errors = [];

  if (report.detectorVersion !== approved.detectorVersion) {
    errors.push(`Detector version changed: expected ${approved.detectorVersion}, received ${report.detectorVersion}.`);
  }

  for (const key of ["candidates", "actionable", "excluded", "unclassified"]) {
    if (report.totals[key] !== approved.totals[key]) {
      errors.push(`Total ${key} changed: expected ${approved.totals[key]}, received ${report.totals[key]}.`);
    }
  }

  const approvedModules = Object.keys(approved.modules).sort();
  const reportModules = Object.keys(report.modules).sort();
  if (JSON.stringify(reportModules) !== JSON.stringify(approvedModules)) {
    errors.push(`Module set changed: expected ${approvedModules.join(", ")}, received ${reportModules.join(", ")}.`);
  }

  for (const [module, expected] of Object.entries(approved.modules)) {
    const actual = report.modules[module]?.actionable;
    if (actual !== expected) {
      errors.push(`Module ${module} changed: expected ${expected}, received ${actual ?? "missing"}.`);
    }
  }

  if (report.totals.unclassified !== 0) {
    errors.push(`Unclassified findings must remain zero; received ${report.totals.unclassified}.`);
  }

  if (errors.length > 0) {
    console.error("Phase 9 final untranslated-text baseline verification failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(
    `Phase 9 final untranslated-text baseline verified exactly: ${report.totals.actionable} actionable, ${report.totals.unclassified} unclassified.`,
  );
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
