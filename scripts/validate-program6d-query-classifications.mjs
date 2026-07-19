#!/usr/bin/env node

/**
 * Program 6D classification validator.
 *
 * Validates a saved JSON report from audit-program6d-database-query-risks.mjs
 * against a manually maintained classification file. This script is read-only:
 * it never modifies application code, database state, or historical records.
 *
 * Usage:
 *   node scripts/validate-program6d-query-classifications.mjs \
 *     --report=tmp/program6d-report.json \
 *     --classifications=docs/program-6d-query-classifications.json
 *
 * Add --strict to fail while any high-severity finding is unclassified,
 * deferred, or missing the evidence required by its classification.
 */

import { readFile } from "node:fs/promises";
import process from "node:process";

const args = new Map(
  process.argv.slice(2).map((argument) => {
    const [key, ...valueParts] = argument.split("=");
    return [key, valueParts.join("=")];
  }),
);

const reportPath = args.get("--report");
const classificationsPath = args.get("--classifications");
const strict = process.argv.includes("--strict");
const jsonOutput = process.argv.includes("--json");

const ALLOWED_STATUSES = new Set([
  "verified-optimization",
  "intentional-full-read",
  "transaction-order-dependency",
  "false-positive",
  "deferred",
]);

function failUsage(message) {
  console.error(message);
  console.error(
    "Usage: node scripts/validate-program6d-query-classifications.mjs --report=<report.json> --classifications=<classifications.json> [--strict] [--json]",
  );
  process.exit(2);
}

if (!reportPath) failUsage("Missing --report path.");
if (!classificationsPath) failUsage("Missing --classifications path.");

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Unable to read ${label} at ${path}: ${message}`);
    process.exit(2);
  }
}

const report = await readJson(reportPath, "Program 6D report");
const classificationDocument = await readJson(classificationsPath, "Program 6D classifications");

if (report?.program !== "6D" || !Array.isArray(report.findings)) {
  failUsage("The report is not a valid Program 6D audit JSON document.");
}

const entries = Array.isArray(classificationDocument)
  ? classificationDocument
  : classificationDocument?.classifications;

if (!Array.isArray(entries)) {
  failUsage("The classification document must be an array or contain a classifications array.");
}

const errors = [];
const warnings = [];
const classificationsById = new Map();

for (const [index, entry] of entries.entries()) {
  const label = `classification[${index}]`;
  if (!entry || typeof entry !== "object") {
    errors.push(`${label} must be an object.`);
    continue;
  }

  if (typeof entry.id !== "string" || !entry.id.startsWith("P6D-")) {
    errors.push(`${label} has an invalid finding id.`);
    continue;
  }

  if (classificationsById.has(entry.id)) {
    errors.push(`Duplicate classification for ${entry.id}.`);
    continue;
  }

  if (!ALLOWED_STATUSES.has(entry.status)) {
    errors.push(`${entry.id} has unsupported status ${JSON.stringify(entry.status)}.`);
  }

  if (typeof entry.rationale !== "string" || entry.rationale.trim().length < 20) {
    errors.push(`${entry.id} requires a rationale of at least 20 characters.`);
  }

  if (entry.status === "verified-optimization") {
    if (typeof entry.change !== "string" || entry.change.trim().length < 10) {
      errors.push(`${entry.id} verified optimization requires a concrete change description.`);
    }
    if (!Array.isArray(entry.verification) || entry.verification.length === 0) {
      errors.push(`${entry.id} verified optimization requires verification evidence.`);
    }
  }

  if (entry.status === "intentional-full-read") {
    if (typeof entry.maximumRows !== "number" || entry.maximumRows < 0) {
      errors.push(`${entry.id} intentional full read requires a non-negative maximumRows value.`);
    }
    if (typeof entry.boundingEvidence !== "string" || entry.boundingEvidence.trim().length < 10) {
      errors.push(`${entry.id} intentional full read requires bounding evidence.`);
    }
  }

  if (entry.status === "transaction-order-dependency") {
    if (typeof entry.orderingDependency !== "string" || entry.orderingDependency.trim().length < 10) {
      errors.push(`${entry.id} transaction dependency requires orderingDependency evidence.`);
    }
  }

  if (entry.status === "false-positive") {
    if (typeof entry.falsePositiveReason !== "string" || entry.falsePositiveReason.trim().length < 10) {
      errors.push(`${entry.id} false positive requires a concrete reason.`);
    }
  }

  if (entry.status === "deferred") {
    if (typeof entry.blocker !== "string" || entry.blocker.trim().length < 10) {
      errors.push(`${entry.id} deferred classification requires a blocker.`);
    }
  }

  classificationsById.set(entry.id, entry);
}

const reportIds = new Set(report.findings.map((finding) => finding.id));
for (const id of classificationsById.keys()) {
  if (!reportIds.has(id)) warnings.push(`${id} is classified but is not present in the supplied report.`);
}

const reviewedFindings = [];
const unclassifiedFindings = [];
const unresolvedHighSeverity = [];

for (const finding of report.findings) {
  const classification = classificationsById.get(finding.id);
  if (!classification) {
    unclassifiedFindings.push(finding);
    if (finding.severity === "high") unresolvedHighSeverity.push(finding);
    continue;
  }

  reviewedFindings.push({ finding, classification });
  if (finding.severity === "high" && classification.status === "deferred") {
    unresolvedHighSeverity.push(finding);
  }
}

if (strict && unresolvedHighSeverity.length > 0) {
  errors.push(
    `${unresolvedHighSeverity.length} high-severity finding(s) remain unclassified or deferred.`,
  );
}

const result = {
  program: "6D",
  reportPath,
  classificationsPath,
  strict,
  reportFindingCount: report.findings.length,
  classifiedCount: reviewedFindings.length,
  unclassifiedCount: unclassifiedFindings.length,
  unresolvedHighSeverityCount: unresolvedHighSeverity.length,
  passed: errors.length === 0,
  errors,
  warnings,
  unclassifiedFindings: unclassifiedFindings.map(({ id, file, line, category, severity }) => ({
    id,
    file,
    line,
    category,
    severity,
  })),
};

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log("Program 6D query-risk classification validation");
  console.log(`Report findings: ${result.reportFindingCount}`);
  console.log(`Classified: ${result.classifiedCount}`);
  console.log(`Unclassified: ${result.unclassifiedCount}`);
  console.log(`Unresolved high severity: ${result.unresolvedHighSeverityCount}`);

  for (const warning of warnings) console.warn(`WARN: ${warning}`);
  for (const error of errors) console.error(`FAIL: ${error}`);
}

if (!result.passed) process.exitCode = 1;
