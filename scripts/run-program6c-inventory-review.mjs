#!/usr/bin/env node

/**
 * Program 6C combined, read-only inventory API review runner.
 *
 * Runs the stock-item caller audit and inventory-payload audit together, then
 * emits one deterministic summary. This runner never applies --fix-safe and
 * therefore cannot modify application source, database rows, accounting,
 * inventory, costing, or historical records.
 *
 * Usage:
 *   node scripts/run-program6c-inventory-review.mjs
 *   node scripts/run-program6c-inventory-review.mjs --json
 *   node scripts/run-program6c-inventory-review.mjs --strict --json
 */

import { execFileSync } from "node:child_process";
import process from "node:process";

const STRICT = process.argv.includes("--strict");
const JSON_OUTPUT = process.argv.includes("--json");

function runAudit(script) {
  const args = [script, "--json"];
  if (STRICT) args.push("--strict");

  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { report: JSON.parse(stdout), exitCode: 0 };
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    let report;
    try {
      report = JSON.parse(stdout);
    } catch {
      throw new Error(
        `${script} failed without a valid JSON report: ${error.message}`,
      );
    }
    return { report, exitCode: error.status ?? 1 };
  }
}

const stockItems = runAudit("scripts/audit-program6c-stock-item-callers.mjs");
const inventoryPayloads = runAudit("scripts/audit-program6c-inventory-payloads.mjs");

const failureReasons = [
  ...(stockItems.report.failureReasons ?? []).map((reason) =>
    `stock-items: ${reason}`,
  ),
  ...(inventoryPayloads.report.failureReasons ?? []).map((reason) =>
    `inventory-payloads: ${reason}`,
  ),
];

const report = {
  program: "6C",
  strict: STRICT,
  passed:
    stockItems.exitCode === 0 &&
    inventoryPayloads.exitCode === 0 &&
    failureReasons.length === 0,
  audits: {
    stockItems: stockItems.report,
    inventoryPayloads: inventoryPayloads.report,
  },
  failureReasons,
};

if (JSON_OUTPUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Program 6C inventory API review");
  console.log(`Stock-item caller audit: ${stockItems.exitCode === 0 ? "passed" : "review required"}`);
  console.log(
    `Inventory payload audit: ${inventoryPayloads.exitCode === 0 ? "passed" : "review required"}`,
  );
  console.log(`Overall: ${report.passed ? "passed" : "review required"}`);
  for (const reason of failureReasons) console.log(`- ${reason}`);
}

if (!report.passed) process.exitCode = 1;
