#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "release-readiness.json"), "utf8"));
const listMode = process.argv.includes("--list") || process.argv.length === 2;
const staticMode = process.argv.includes("--static");
const executeMode = process.argv.includes("--execute");
const evidenceArg = process.argv.find((argument) => argument.startsWith("--evidence="));

if ([listMode, staticMode, executeMode].filter(Boolean).length > 1) {
  console.error("Choose only one mode: --list, --static, or --execute.");
  process.exit(2);
}

function printPlan() {
  console.log(JSON.stringify({
    nodeVersion: policy.nodeVersion,
    render: policy.render,
    staticChecks: policy.requiredStaticChecks,
    executableChecks: policy.requiredExecutableChecks,
    requiredEvidenceSections: policy.requiredEvidenceSections,
    requiredSmokeModules: policy.requiredSmokeModules,
  }, null, 2));
}

function runCheck(check) {
  console.log(`\n[release:${check.id}] ${check.command}`);
  const result = spawnSync(check.command, {
    cwd: root,
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "test" },
    stdio: "inherit",
    shell: true,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (listMode) {
  printPlan();
  process.exit(0);
}

if (staticMode) {
  for (const check of policy.requiredStaticChecks) runCheck(check);
  console.log("\nStatic release readiness checks passed.");
}

if (executeMode) {
  if (process.env.RELEASE_EXECUTION_CONFIRMATION !== "RUN_RELEASE_READINESS") {
    console.error("Refusing the full release suite without RELEASE_EXECUTION_CONFIRMATION=RUN_RELEASE_READINESS.");
    process.exit(2);
  }
  for (const check of policy.requiredStaticChecks) runCheck(check);
  for (const check of policy.requiredExecutableChecks) runCheck(check);
  console.log("\nExecutable release readiness checks passed. Database, deployment, smoke, and rollback evidence are still required.");
}

if (evidenceArg) {
  const evidencePath = evidenceArg.slice("--evidence=".length);
  runCheck({
    id: "release-evidence",
    command: `node scripts/verify-release-evidence.mjs --file=${JSON.stringify(evidencePath)}`,
  });
}
