#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const baselinePath = path.join(root, "scripts", "program8c-reporting-traceability-baseline.json");
const auditPath = path.join(root, "docs", "program-8c-reporting-traceability.md");

const fail = (message) => {
  console.error(`[program8c] ${message}`);
  process.exitCode = 1;
};

if (!fs.existsSync(baselinePath)) {
  fail("missing reporting and traceability baseline");
  process.exit();
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const requiredTraceFields = new Set(baseline.requiredTraceFields ?? []);
const requiredReportProperties = new Set(baseline.requiredReportProperties ?? []);
const families = baseline.families ?? [];

const mandatoryTrace = [
  "stable-record-identity",
  "company-scope",
  "business-date",
  "source-workflow",
  "status-or-lifecycle-state",
  "reference-or-document-number",
];
const mandatoryReport = [
  "deterministic-ordering",
  "explicit-date-boundaries",
  "company-isolation",
  "export-parity-with-visible-filters",
];

for (const field of mandatoryTrace) {
  if (!requiredTraceFields.has(field)) fail(`required trace field is missing: ${field}`);
}
for (const property of mandatoryReport) {
  if (!requiredReportProperties.has(property)) fail(`required report property is missing: ${property}`);
}

const ids = new Set();
const allowedRisk = new Set(["critical", "high", "medium", "low"]);
for (const family of families) {
  if (!family.id) fail("workflow family is missing an id");
  if (ids.has(family.id)) fail(`duplicate workflow family id: ${family.id}`);
  ids.add(family.id);

  if (!allowedRisk.has(family.risk)) fail(`invalid risk classification for ${family.id}: ${family.risk}`);
  if (!Array.isArray(family.traceRequirements) || family.traceRequirements.length === 0) {
    fail(`${family.id} has no trace requirements`);
  }
  if (!Array.isArray(family.reportRequirements) || family.reportRequirements.length === 0) {
    fail(`${family.id} has no report requirements`);
  }
  if (!Array.isArray(family.preserve) || family.preserve.length === 0) {
    fail(`${family.id} has no preservation contract`);
  }

  for (const item of family.traceRequirements ?? []) {
    if (!requiredTraceFields.has(item)) fail(`${family.id} references unknown trace requirement: ${item}`);
  }
  for (const item of family.reportRequirements ?? []) {
    if (!requiredReportProperties.has(item)) fail(`${family.id} references unknown report requirement: ${item}`);
  }

  if (["critical", "high"].includes(family.risk)) {
    for (const item of ["stable-record-identity", "company-scope", "source-workflow"]) {
      if (!family.traceRequirements.includes(item)) fail(`${family.id} is ${family.risk} but lacks ${item}`);
    }
    for (const item of ["deterministic-ordering", "company-isolation"]) {
      if (!family.reportRequirements.includes(item)) fail(`${family.id} is ${family.risk} but lacks ${item}`);
    }
  }
}

const expectedFamilies = [
  "accounting-journal-and-vouchers",
  "inventory-and-stock-movements",
  "factory-costing-and-mix-batches",
  "container-and-offload-lifecycle",
  "payroll-and-employee-adjustments",
  "administrative-repairs-and-imports",
];
for (const id of expectedFamilies) {
  if (!ids.has(id)) fail(`required workflow family is missing: ${id}`);
}

if (!fs.existsSync(auditPath)) {
  fail("missing Program 8C audit documentation");
} else {
  const audit = fs.readFileSync(auditPath, "utf8");
  for (const phrase of [
    "No accounting, inventory, costing, posting, or historical transaction behavior was changed",
    "full-filter totals",
    "company isolation",
    "export parity",
  ]) {
    if (!audit.includes(phrase)) fail(`audit documentation is missing required safety statement: ${phrase}`);
  }
}

if (!process.exitCode) {
  console.log(`[program8c] verified ${families.length} reporting and traceability workflow families`);
}
