#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`Missing required file: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function readJson(relativePath) {
  const source = read(relativePath);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    failures.push(`${relativePath} is not valid JSON: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

function requireMarkers(relativePath, markers) {
  const source = read(relativePath);
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`${relativePath}: missing required marker: ${marker}`);
  }
  return source;
}

function forbidMarkers(relativePath, markers) {
  const source = read(relativePath);
  for (const marker of markers) {
    if (source.includes(marker)) failures.push(`${relativePath}: forbidden marker present: ${marker}`);
  }
  return source;
}

requireMarkers("docs/final-production-readiness.md", [
  "Freeze one full 40-character Git commit",
  "autoDeploy: false",
  "RELEASE_EXPECTED_COMMIT",
  "verify-release-evidence.mjs",
  "Never test a restore by overwriting production",
  "Supplier Partner Phase 4 rehearsal",
  "Historical Replay Apply disabled",
  "Stop conditions",
]);

const deploymentChecklist = requireMarkers("docs/production-deployment-checklist.md", [
  "No release is ready until evidence verification passes",
  "run-release-readiness.mjs --static",
  "RELEASE_EXECUTION_CONFIRMATION=RUN_RELEASE_READINESS",
  "verify-migration-registry.mjs --strict",
  "commitVerified: true",
  "verify-release-evidence.mjs",
]);
for (const staleClaim of [
  "✅ READY FOR DEPLOYMENT",
  "No `render.yaml` is present",
  "formatting is cosmetic, not a deployment blocker",
  "Health Check Path: `/api/health`",
]) {
  if (deploymentChecklist.includes(staleClaim)) {
    failures.push(`docs/production-deployment-checklist.md retains stale claim: ${staleClaim}`);
  }
}

requireMarkers("docs/operations/database-backup-rollback-recovery.md", [
  "Never test a restore by overwriting the production database",
  "verify-database-backup.mjs",
  "Restore rehearsal on a disposable database",
  "/api/health/ready",
]);
requireMarkers("docs/program-3c-database-tenant-guards.md", [
  "tenant-control-integrity-audit.mjs",
  "0013_tenant_control_integrity_guards",
  "NOT VALID",
  "explicit owner approval",
]);
requireMarkers("migrations/0013_tenant_control_integrity_guards.sql", [
  "Foreign keys are NOT VALID",
  "No historical repair, DELETE, UPDATE, or backfill",
  "tenant-control-integrity-audit.mjs",
]);
requireMarkers("scripts/tenant-control-integrity-audit.mjs", [
  'client.query("BEGIN READ ONLY")',
  'client.query("ROLLBACK")',
  "summary.ok = summary.errorCount === 0",
]);
requireMarkers("scripts/run-versioned-migrations.mjs", [
  'const APPLY_FLAG = "--apply"',
  'const REQUIRED_CONFIRMATION = "APPLY_VERSIONED_MIGRATIONS"',
  "pg_try_advisory_lock",
  "Another versioned migration process already holds the migration lock",
]);
requireMarkers("docs/sp-migration-phase-4-runbook.md", [
  "/api/sp/migration/final-verification",
  "PREPARE CUTOVER",
  "FINALIZE CUTOVER",
  "ROLLBACK CUTOVER",
  "SP_SOURCE_READ_ONLY",
]);
requireMarkers("docs/historical-replay-phase-8-production-readiness.md", [
  "HISTORICAL_REPLAY_APPLY_MODE=APPROVED_V8_CONTROLLED_APPLY",
  "/historical-replay/readiness",
  "/historical-replay/verification",
  "Apply is disabled unless both runtime controls are present",
  "Remove `HISTORICAL_REPLAY_APPLY_MODE`",
]);

const policy = readJson("config/release-readiness.json");
if (policy) {
  if (policy.version !== 1) failures.push("config/release-readiness.json must use version 1");
  const pinnedNode = read(".node-version").trim();
  if (policy.nodeVersion !== pinnedNode) {
    failures.push(`Release policy Node ${policy.nodeVersion} must match .node-version ${pinnedNode}`);
  }
  if (policy.render?.autoDeploy !== false) failures.push("Release policy must require render.autoDeploy=false");
  if (policy.render?.healthCheckPath !== "/api/health/ready") {
    failures.push("Release policy must require /api/health/ready");
  }
  if (!Array.isArray(policy.requiredStaticChecks) || policy.requiredStaticChecks.length < 5) {
    failures.push("Release policy must retain at least five static checks");
  }
  if (!Array.isArray(policy.requiredExecutableChecks) || policy.requiredExecutableChecks.length < 10) {
    failures.push("Release policy must retain at least ten executable checks");
  }
  if (!policy.requiredExecutableChecks?.some((check) => check.command === "node scripts/run-phase12-business-regression.mjs")) {
    failures.push("Release policy must include the Phase 12 critical business regression runner");
  }
  if (!policy.requiredExecutableChecks?.some((check) => check.command === "npm run build")) {
    failures.push("Release policy must include the production build");
  }
  if (!Array.isArray(policy.requiredSmokeModules) || policy.requiredSmokeModules.length < 12) {
    failures.push("Release policy must retain the complete smoke module boundary");
  }
}

const renderConfig = requireMarkers("render.yaml", [
  "buildCommand: npm ci --registry=https://registry.npmjs.org/ && npm run build",
  "startCommand: npm start",
  "healthCheckPath: /api/health/ready",
  "autoDeploy: false",
  "value: 20.19.2",
]);
if (renderConfig.includes("autoDeploy: true")) failures.push("render.yaml must not enable automatic deployment");
for (const forbidden of policy?.forbiddenRenderEnvironmentKeys ?? []) {
  if (renderConfig.includes(`key: ${forbidden}`)) {
    failures.push(`render.yaml must not persist dangerous release control: ${forbidden}`);
  }
}

requireMarkers("server/releaseIdentityPolicy.mjs", [
  "RELEASE_EXPECTED_COMMIT",
  "full 40-character Git SHA",
  "does not match approved release commit",
  "commitVerified",
]);
const preflight = requireMarkers("server/deploymentPreflight.mjs", [
  'from "./releaseIdentityPolicy.mjs"',
  "resolveReleaseIdentity(process.env, isProduction)",
  "expectedCommitSha",
  "commitVerified",
]);
if (preflight.includes("RENDER_GIT_COMMIT?.trim()?.slice(0, 8)")) {
  failures.push("deploymentPreflight must not reduce the only release identity to eight characters");
}
requireMarkers("server/runtimeReleaseState.mjs", [
  "commitSha",
  "expectedCommitSha",
  "commitVerified",
  "releaseId",
]);
requireMarkers("server/runtimeHealthGuard.mjs", [
  'pathname === "/api/health/live"',
  'pathname === "/api/health/ready"',
  "release: runtimeReleaseState",
]);

const migrationDebt = readJson("config/migration-registry-debt.json");
if (migrationDebt) {
  const legacy = migrationDebt.legacyMissingRegisteredTags ?? [];
  const standalone = migrationDebt.approvedUnregisteredSqlFiles ?? [];
  if (legacy.length !== 3) failures.push(`Migration debt must contain exactly 3 legacy gaps, found ${legacy.length}`);
  if (standalone.length !== 6) {
    failures.push(`Migration debt must contain exactly 6 approved standalone SQL files, found ${standalone.length}`);
  }
  const duplicateTags = legacy.map((entry) => entry.tag).filter((tag, index, all) => all.indexOf(tag) !== index);
  const duplicateFiles = standalone.map((entry) => entry.file).filter((file, index, all) => all.indexOf(file) !== index);
  if (duplicateTags.length) failures.push(`Migration debt has duplicate tags: ${[...new Set(duplicateTags)].join(", ")}`);
  if (duplicateFiles.length) failures.push(`Migration debt has duplicate files: ${[...new Set(duplicateFiles)].join(", ")}`);
  for (const entry of [...legacy, ...standalone]) {
    if (!entry.classification || !entry.reason) failures.push("Every migration debt entry needs classification and reason");
  }
}
requireMarkers("scripts/verify-migration-registry.mjs", [
  "config",
  "migration-registry-debt.json",
  "Unapproved unregistered SQL files",
  "stale file allowances",
  "approvedLegacyGaps",
  "approvedUnregisteredFiles",
]);

requireMarkers("scripts/releaseEvidencePolicy.mjs", [
  "createReleaseEvidence",
  "validateReleaseEvidence",
  "release.deployedCommitSha must match release.commitSha",
  "dangerousControls.autoDeployEnabled",
]);
requireMarkers("scripts/create-release-evidence.mjs", [
  "--commit=",
  "--output=",
  "intentionally incomplete",
]);
requireMarkers("scripts/verify-release-evidence.mjs", [
  "validateReleaseEvidence",
  "Release evidence verification failed",
  "Release evidence verified for commit",
]);
requireMarkers("scripts/run-release-readiness.mjs", [
  "--list",
  "--static",
  "--execute",
  "RELEASE_EXECUTION_CONFIRMATION",
  "RUN_RELEASE_READINESS",
  "requiredStaticChecks",
  "requiredExecutableChecks",
]);
requireMarkers("tests/phase13-release-deployment-readiness.test.ts", [
  "accepts and verifies the exact approved runtime commit",
  "fails closed when the deployed commit differs from approval",
  "accepts complete evidence for the exact deployed commit",
  "requires manual Render promotion",
  "freezes the reviewed migration debt",
]);

const packageJson = readJson("package.json");
if (packageJson) {
  if (packageJson.scripts?.["verify:final-production-readiness"] !== "node scripts/verify-final-production-readiness.mjs") {
    failures.push("package.json is missing the exact verify:final-production-readiness script");
  }
  const start = String(packageJson.scripts?.start ?? "");
  for (const forbidden of ["run-versioned-migrations", "historical-replay", "MIGRATION_CONFIRMATION", "MASTER_PASSWORD"]) {
    if (start.includes(forbidden)) failures.push(`npm start must not contain ${forbidden}`);
  }
}

if (failures.length > 0) {
  console.error("Final production readiness contract verification failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Final production readiness contracts verified.");
console.log("This static check does not replace executable checks, database rehearsal, deployment, smoke testing, rollback rehearsal, or evidence approval.");
