#!/usr/bin/env node

/**
 * Program 6D reproducible query-review runner.
 *
 * Runs the read-only database-query scanner, persists its JSON report, and can
 * optionally validate a classification document against that exact report.
 * It does not modify application code, database state, accounting, inventory,
 * costing, company isolation, or historical records.
 *
 * Usage:
 *   node scripts/run-program6d-query-review.mjs
 *   node scripts/run-program6d-query-review.mjs --report=tmp/program6d-report.json
 *   node scripts/run-program6d-query-review.mjs \
 *     --classifications=docs/program-6d-query-classifications.json --strict
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const ROOT = process.cwd();
const argumentsMap = new Map(
  process.argv.slice(2).map((argument) => {
    const [key, ...valueParts] = argument.split("=");
    return [key, valueParts.join("=")];
  }),
);

const reportPath = resolve(ROOT, argumentsMap.get("--report") || "tmp/program6d-report.json");
const classificationsPath = argumentsMap.get("--classifications");
const strict = process.argv.includes("--strict");

function runNodeScript(scriptPath, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });
}

const auditArgs = ["--json"];
const audit = await runNodeScript("scripts/audit-program6d-database-query-risks.mjs", auditArgs);

if (audit.code !== 0) {
  if (audit.stderr) process.stderr.write(audit.stderr);
  console.error("Program 6D scanner failed before a report could be persisted.");
  process.exit(audit.code);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch (error) {
  console.error(`Program 6D scanner returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Program 6D report written to ${reportPath}`);
console.log(`Files scanned: ${report.filesScanned}`);
console.log(`Findings: ${report.findingCount}`);
console.log(`High severity: ${report.highSeverityCount}`);

if (!classificationsPath) {
  if (strict && report.highSeverityCount > 0) {
    console.error("Strict review requires classifications for all high-severity findings.");
    process.exitCode = 1;
  }
} else {
  const validationArgs = [
    `--report=${reportPath}`,
    `--classifications=${resolve(ROOT, classificationsPath)}`,
    "--json",
  ];
  if (strict) validationArgs.push("--strict");

  const validation = await runNodeScript("scripts/validate-program6d-query-classifications.mjs", validationArgs);
  if (validation.stdout) process.stdout.write(validation.stdout);
  if (validation.stderr) process.stderr.write(validation.stderr);
  if (validation.code !== 0) process.exitCode = validation.code;
}
