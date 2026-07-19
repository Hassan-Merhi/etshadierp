#!/usr/bin/env node

/**
 * Program 6C combined, read-only inventory API review runner.
 *
 * Runs the stock-item caller audit and inventory-payload audit together, emits
 * one deterministic summary, optionally persists that exact JSON report, and
 * can validate a classification document against the persisted report.
 *
 * This runner never applies --fix-safe and therefore cannot modify application
 * source, database rows, accounting, inventory, costing, company isolation,
 * mutations, or historical records.
 *
 * Usage:
 *   node scripts/run-program6c-inventory-review.mjs
 *   node scripts/run-program6c-inventory-review.mjs --json
 *   node scripts/run-program6c-inventory-review.mjs \
 *     --report=tmp/program6c-report.json
 *   node scripts/run-program6c-inventory-review.mjs \
 *     --report=tmp/program6c-report.json \
 *     --classifications=docs/program-6c-inventory-classifications.json \
 *     --strict
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

const STRICT = process.argv.includes("--strict");
const JSON_OUTPUT = process.argv.includes("--json");

function readArg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const reportArgument = readArg("report");
const classificationsArgument = readArg("classifications");
const reportPath = reportArgument ? resolve(process.cwd(), reportArgument) : undefined;
const classificationsPath = classificationsArgument
  ? resolve(process.cwd(), classificationsArgument)
  : undefined;

if (classificationsPath && !reportPath) {
  console.error("--classifications requires --report so validation uses the exact persisted report");
  process.exit(2);
}

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

function validateClassifications() {
  const args = [
    "scripts/validate-program6c-inventory-classifications.mjs",
    `--report=${reportPath}`,
    `--classifications=${classificationsPath}`,
    "--json",
  ];
  if (STRICT) args.push("--strict");

  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { result: JSON.parse(stdout), exitCode: 0 };
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    try {
      return { result: JSON.parse(stdout), exitCode: error.status ?? 1 };
    } catch {
      throw new Error(
        `Classification validation failed without valid JSON: ${error.message}`,
      );
    }
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

if (reportPath) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

const validation = classificationsPath ? validateClassifications() : undefined;

if (JSON_OUTPUT) {
  console.log(
    JSON.stringify(
      {
        ...report,
        reportPath,
        validation: validation?.result,
      },
      null,
      2,
    ),
  );
} else {
  console.log("Program 6C inventory API review");
  console.log(`Stock-item caller audit: ${stockItems.exitCode === 0 ? "passed" : "review required"}`);
  console.log(
    `Inventory payload audit: ${inventoryPayloads.exitCode === 0 ? "passed" : "review required"}`,
  );
  console.log(`Overall: ${report.passed ? "passed" : "review required"}`);
  if (reportPath) console.log(`Report written to ${reportPath}`);
  if (validation) {
    console.log(
      `Classification validation: ${validation.exitCode === 0 ? "passed" : "failed"}`,
    );
    console.log(
      `Unresolved high severity: ${validation.result.unresolvedHighSeverity ?? "unknown"}`,
    );
  }
  for (const reason of failureReasons) console.log(`- ${reason}`);
}

if (!report.passed || (validation && validation.exitCode !== 0)) {
  process.exitCode = 1;
}
