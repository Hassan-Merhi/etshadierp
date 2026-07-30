#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

function requireFile(relativePath) {
  if (!existsSync(path.join(root, relativePath))) failures.push(`${relativePath}: file is missing`);
}

function requireText(relativePath, text, label = text) {
  if (!read(relativePath).includes(text)) failures.push(`${relativePath}: missing ${label}`);
}

function forbidText(relativePath, text, label = text) {
  if (read(relativePath).includes(text)) failures.push(`${relativePath}: forbidden ${label}`);
}

for (const relativePath of [
  "server/services/security/companyContextPolicy.ts",
  "tests/company-context-enforcement.test.ts",
  "tests/customer-linked-ledger-validation.test.ts",
  "tests/ui/authenticated-app-route-guard.test.ts",
  "tests/inventory-cost-memory-legacy-regression.test.ts",
  "config/critical-test-debt.json",
  "scripts/verify-critical-test-debt.mjs",
  "scripts/run-phase12-business-regression.mjs",
  "tests/phase12-business-regression-suite.test.ts",
  "docs/engineering/phase12-business-regression-suite.md",
]) {
  requireFile(relativePath);
}

const runner = "scripts/run-phase12-business-regression.mjs";
for (const marker of [
  "const backendDomains",
  "const frontendDomains",
  "--domain=",
  "--smoke",
  "--list",
  "--maxWorkers=1",
  "--no-file-parallelism",
  "vitest.config.frontend.ts",
  "tests/inventory-cost-memory-legacy-regression.test.ts",
  "tests/ui/authenticated-app-route-guard.test.ts",
  "tests/program-5-end-to-end-security.test.ts",
  "tests/factory-raw-material-moving-avg.test.ts",
]) {
  requireText(runner, marker);
}

const backendConfig = "vitest.config.ts";
for (const marker of [
  "lines: 10",
  "statements: 10",
  "functions: 8",
  "branches: 8",
  '"server/services/security/companyContextPolicy.ts"',
  '"server/services/accounting/customerLinkedLedgerValidation.ts"',
]) {
  requireText(backendConfig, marker);
}

const frontendConfig = "vitest.config.frontend.ts";
for (const marker of [
  '"client/src/app/authenticatedAppRouteGuard.ts"',
  '"client/src/app/factoryAccessGuard.ts"',
  "lines: 90",
  "branches: 85",
  "lines: 85",
  "branches: 80",
]) {
  requireText(frontendConfig, marker);
}

const companyPolicy = "server/services/security/companyContextPolicy.ts";
for (const marker of [
  "parsePositiveCompanyId",
  "collectCompanyAssertions",
  "decideExplicitCompanyContext",
  "COMPANY_CONTEXT_REQUIRED",
  "COMPANY_CONTEXT_MISMATCH",
]) {
  requireText(companyPolicy, marker);
}

const adapter = "server/services/security/companyContextEnforcementAdapter.ts";
requireText(adapter, 'from "./companyContextPolicy"');
requireText(adapter, 'export { decideExplicitCompanyContext } from "./companyContextPolicy"');
forbidText(adapter, "function positiveInteger", "embedded company-ID parser");
forbidText(adapter, "function assertionValues", "embedded assertion collector");

const routeTest = "tests/ui/authenticated-app-route-guard.test.ts";
for (const marker of [
  "authenticated application route policy",
  "Factory page access policy",
  "canonicalizes Properties route",
  "rejects Supplier Partner routes",
  "enforces feature flags",
  "enforces hidden production analytics tabs",
]) {
  requireText(routeTest, marker);
}

const inventoryReplacement = "tests/inventory-cost-memory-legacy-regression.test.ts";
for (const marker of [
  "zero asset value and non-negative cost memory",
  "preserving the previous valid rate",
  "repeated matched receive and exact-reversal cycles",
  "without accumulating phantom inventory value",
]) {
  requireText(inventoryReplacement, marker);
}

const debtResult = spawnSync(process.execPath, ["scripts/verify-critical-test-debt.mjs"], {
  cwd: root,
  encoding: "utf8",
});
if (debtResult.status !== 0) {
  failures.push(`critical test debt verifier failed: ${(debtResult.stderr || debtResult.stdout || "unknown error").trim()}`);
}

const documentation = "docs/engineering/phase12-business-regression-suite.md";
for (const marker of [
  "coverage gates",
  "route-policy matrix",
  "critical test-debt budget",
  "cost memory",
  "rollback-safe",
  "not executed",
]) {
  requireText(documentation, marker);
}

if (failures.length > 0) {
  console.error("Phase 12 test coverage and reliability verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Phase 12 test coverage and reliability boundaries verified.");
