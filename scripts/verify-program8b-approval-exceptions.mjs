#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const baselinePath = path.join(root, "scripts/program8b-approval-exception-baseline.json");

function fail(message) {
  console.error(`Program 8B verification failed: ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(baselinePath)) {
  fail("missing approval and exception baseline");
  process.exit();
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const controlIds = new Set((baseline.controlClasses ?? []).map((entry) => entry.id));
const workflowIds = new Set();

if ((baseline.version ?? 0) < 1) fail("baseline version must be at least 1");
if (controlIds.size < 7) fail("expected the complete minimum control-class set");

for (const required of [
  "authorization",
  "validation",
  "preview-or-dry-run",
  "explicit-confirmation",
  "transactional-write",
  "audit-trail",
  "idempotency-or-replay-protection",
]) {
  if (!controlIds.has(required)) fail(`missing control class: ${required}`);
}

for (const workflow of baseline.workflowFamilies ?? []) {
  if (!workflow.id) fail("workflow family without an id");
  if (workflowIds.has(workflow.id)) fail(`duplicate workflow id: ${workflow.id}`);
  workflowIds.add(workflow.id);

  if (!["high", "critical"].includes(workflow.risk)) {
    fail(`invalid risk level for ${workflow.id}`);
  }

  if (!Array.isArray(workflow.requiredControls) || workflow.requiredControls.length === 0) {
    fail(`workflow ${workflow.id} has no required controls`);
    continue;
  }

  for (const control of workflow.requiredControls) {
    if (!controlIds.has(control)) fail(`${workflow.id} references unknown control ${control}`);
  }

  if (!workflow.requiredControls.includes("authorization")) {
    fail(`${workflow.id} must require authorization`);
  }
  if (!workflow.requiredControls.includes("validation")) {
    fail(`${workflow.id} must require validation`);
  }
  if (!workflow.requiredControls.includes("audit-trail")) {
    fail(`${workflow.id} must require an audit trail`);
  }
}

if (workflowIds.size < 7) fail("expected all high-risk workflow families to be classified");

const docsPath = path.join(root, "docs/program-8b-approval-exception-workflows.md");
if (!fs.existsSync(docsPath)) fail("missing Program 8B audit document");
else {
  const docs = fs.readFileSync(docsPath, "utf8");
  for (const phrase of [
    "No universal approval engine",
    "fail closed",
    "No runtime behavior was changed",
    "Program 8C",
  ]) {
    if (!docs.includes(phrase)) fail(`audit document missing required statement: ${phrase}`);
  }
}

if (!process.exitCode) {
  console.log(`Program 8B static contract verified: ${workflowIds.size} workflow families, ${controlIds.size} control classes.`);
}
