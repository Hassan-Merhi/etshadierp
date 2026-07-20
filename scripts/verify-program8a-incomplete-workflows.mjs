#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(root, "scripts/program8a-incomplete-workflow-baseline.json");
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const failures = [];

const allowedClassifications = new Set(baseline.classifications ?? []);
const ids = new Set();

for (const workflow of baseline.workflows ?? []) {
  if (!workflow.id || ids.has(workflow.id)) failures.push(`Workflow id is missing or duplicated: ${workflow.id ?? "<missing>"}`);
  ids.add(workflow.id);

  if (!allowedClassifications.has(workflow.classification)) {
    failures.push(`${workflow.id}: unknown classification ${workflow.classification}`);
  }
  if (!workflow.path || !workflow.marker || !workflow.userImpact || !workflow.nextOwnerPhase) {
    failures.push(`${workflow.id}: path, marker, userImpact, and nextOwnerPhase are required`);
    continue;
  }

  const absolutePath = path.join(root, workflow.path);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`${workflow.id}: source file is missing (${workflow.path})`);
    continue;
  }

  const source = fs.readFileSync(absolutePath, "utf8");
  if (!source.includes(workflow.marker)) {
    failures.push(`${workflow.id}: expected marker is no longer present; reclassify or remove the baseline entry`);
  }
}

const scanRoots = ["client/src", "server", "shared"];
const suspiciousPatterns = [
  /onClick=\{\(\) => \{\}\}/g,
  /onSubmit=\{\(\) => \{\}\}/g,
  /onChange=\{\(\) => \{\}\}/g,
  /not yet implemented/gi,
  /coming soon/gi,
  /Source data stubs/g,
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

const approved = new Set((baseline.workflows ?? []).map((workflow) => `${workflow.path}::${workflow.marker}`));
for (const scanRoot of scanRoots) {
  const absoluteRoot = path.join(root, scanRoot);
  if (!fs.existsSync(absoluteRoot)) continue;
  for (const file of walk(absoluteRoot)) {
    const relativePath = path.relative(root, file).replaceAll(path.sep, "/");
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of suspiciousPatterns) {
      for (const match of source.matchAll(pattern)) {
        const marker = match[0];
        const isApproved = [...approved].some((entry) => {
          const [approvedPath, approvedMarker] = entry.split("::");
          return approvedPath === relativePath && (marker.includes(approvedMarker) || approvedMarker.includes(marker));
        });
        if (!isApproved) failures.push(`Unclassified incomplete-workflow marker: ${relativePath} -> ${marker}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Program 8A incomplete-workflow verification failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Program 8A incomplete-workflow baseline verified (${baseline.workflows.length} classified workflows).`);
