#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateReleaseEvidence } from "./releaseEvidencePolicy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fileArg = process.argv.find((argument) => argument.startsWith("--file="));
const positional = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const evidencePath = path.resolve(root, fileArg?.slice("--file=".length) || positional || "release-evidence.json");
const policyPath = path.join(root, "config", "release-readiness.json");

if (!fs.existsSync(evidencePath)) {
  console.error(`Release evidence file not found: ${path.relative(root, evidencePath)}`);
  process.exit(2);
}

let evidence;
let policy;
try {
  evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
} catch (error) {
  console.error(`Unable to parse release evidence or policy: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
}

const failures = validateReleaseEvidence(evidence, policy);
if (failures.length > 0) {
  console.error("Release evidence verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Release evidence verified for commit ${evidence.release.commitSha}.`);
console.log(`Deployment: ${evidence.release.deploymentId}; approver: ${evidence.approval.approver}.`);
