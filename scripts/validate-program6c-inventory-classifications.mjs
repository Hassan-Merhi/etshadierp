#!/usr/bin/env node

/**
 * Read-only validator for Program 6C inventory API audit classifications.
 *
 * Usage:
 *   node scripts/validate-program6c-inventory-classifications.mjs \
 *     --report=tmp/program6c-report.json \
 *     --classifications=docs/program-6c-inventory-classifications.json
 *
 *   node scripts/validate-program6c-inventory-classifications.mjs \
 *     --report=tmp/program6c-report.json \
 *     --classifications=docs/program-6c-inventory-classifications.json \
 *     --strict --json
 *
 * This script never changes application source, database rows, accounting,
 * inventory, costing, company isolation, mutations, or historical records.
 */

import fs from "node:fs";
import process from "node:process";

const STRICT = process.argv.includes("--strict");
const JSON_OUTPUT = process.argv.includes("--json");

function readArg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function readJson(path, label) {
  if (!path) fail(`Missing --${label}=<path>`);
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Unable to read ${label} JSON at ${path}: ${error.message}`);
  }
}

const reportPath = readArg("report");
const classificationsPath = readArg("classifications");
const report = readJson(reportPath, "report");
const classificationsDocument = readJson(classificationsPath, "classifications");

if (report.program !== "6C" || !report.audits) {
  fail("The report is not a combined Program 6C inventory review report");
}

const allowedStatuses = new Set([
  "verified-unbounded-read",
  "bounded-by-design",
  "mutation-or-cache-only",
  "false-positive",
  "deferred",
]);

const findings = [
  ...(report.audits.stockItems?.findings ?? []).map((finding) => ({
    ...finding,
    audit: "stock-items",
  })),
  ...(report.audits.inventoryPayloads?.findings ?? []).map((finding) => ({
    ...finding,
    audit: "inventory-payloads",
  })),
];

const reviewFindings = findings.filter(
  (finding) => finding.severity === "high" || finding.severity === "review",
);
const classificationEntries = classificationsDocument.classifications;
if (!Array.isArray(classificationEntries)) {
  fail("Classification document must contain a classifications array");
}

const errors = [];
const warnings = [];
const byId = new Map();

for (const entry of classificationEntries) {
  if (!entry || typeof entry !== "object") {
    errors.push("Each classification entry must be an object");
    continue;
  }
  if (!entry.findingId || typeof entry.findingId !== "string") {
    errors.push("Each classification entry must include findingId");
    continue;
  }
  if (byId.has(entry.findingId)) {
    errors.push(`Duplicate classification for ${entry.findingId}`);
    continue;
  }
  if (!allowedStatuses.has(entry.status)) {
    errors.push(`Invalid status for ${entry.findingId}: ${entry.status}`);
  }
  byId.set(entry.findingId, entry);
}

function requireText(entry, field, findingId) {
  if (typeof entry[field] !== "string" || entry[field].trim().length === 0) {
    errors.push(`${findingId} requires non-empty ${field}`);
  }
}

for (const finding of reviewFindings) {
  const entry = byId.get(finding.id);
  if (!entry) continue;

  requireText(entry, "reviewer", finding.id);
  requireText(entry, "evidence", finding.id);

  switch (entry.status) {
    case "verified-unbounded-read":
      requireText(entry, "proposedBounding", finding.id);
      requireText(entry, "behaviorPreservation", finding.id);
      break;
    case "bounded-by-design":
      requireText(entry, "boundingMechanism", finding.id);
      requireText(entry, "maximumRowsOrScope", finding.id);
      break;
    case "mutation-or-cache-only":
      requireText(entry, "referencePurpose", finding.id);
      break;
    case "false-positive":
      requireText(entry, "falsePositiveReason", finding.id);
      break;
    case "deferred":
      requireText(entry, "blocker", finding.id);
      requireText(entry, "nextEvidenceNeeded", finding.id);
      break;
  }
}

const findingIds = new Set(findings.map((finding) => finding.id));
for (const id of byId.keys()) {
  if (!findingIds.has(id)) warnings.push(`Classification ${id} is not present in this report`);
}

const unclassified = reviewFindings.filter((finding) => !byId.has(finding.id));
const deferred = reviewFindings.filter(
  (finding) => byId.get(finding.id)?.status === "deferred",
);
const unresolvedHighSeverity = reviewFindings.filter(
  (finding) =>
    finding.severity === "high" &&
    (!byId.has(finding.id) || byId.get(finding.id)?.status === "deferred"),
);

if (STRICT && unresolvedHighSeverity.length > 0) {
  errors.push(
    `${unresolvedHighSeverity.length} high-severity finding(s) remain unclassified or deferred`,
  );
}

const result = {
  program: "6C",
  reportPath,
  classificationsPath,
  strict: STRICT,
  findings: findings.length,
  reviewFindings: reviewFindings.length,
  classified: reviewFindings.length - unclassified.length,
  unclassified: unclassified.length,
  deferred: deferred.length,
  unresolvedHighSeverity: unresolvedHighSeverity.length,
  passed: errors.length === 0,
  errors,
  warnings,
  unclassifiedIds: unclassified.map((finding) => finding.id),
  deferredIds: deferred.map((finding) => finding.id),
  unresolvedHighSeverityIds: unresolvedHighSeverity.map((finding) => finding.id),
};

if (JSON_OUTPUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log("Program 6C inventory classification validation");
  console.log(`Review findings: ${result.reviewFindings}`);
  console.log(`Classified: ${result.classified}`);
  console.log(`Unclassified: ${result.unclassified}`);
  console.log(`Deferred: ${result.deferred}`);
  console.log(`Unresolved high severity: ${result.unresolvedHighSeverity}`);
  console.log(`Overall: ${result.passed ? "passed" : "failed"}`);
  for (const warning of warnings) console.log(`WARN: ${warning}`);
  for (const error of errors) console.error(`FAIL: ${error}`);
}

if (!result.passed) process.exitCode = 1;
