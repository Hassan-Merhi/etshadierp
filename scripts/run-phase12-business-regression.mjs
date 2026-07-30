#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

const backendDomains = {
  smoke: [
    "tests/workflow.test.ts",
    "tests/factory-container-lifecycle.test.ts",
  ],
  accounting: [
    "tests/accounting.test.ts",
    "tests/central-posting-engine.test.ts",
    "tests/manual-journal-posting.test.ts",
    "tests/generic-voucher-posting.test.ts",
    "tests/payment-receipt-posting.test.ts",
    "tests/customer-linked-ledger-validation.test.ts",
  ],
  inventory: [
    "tests/pos.test.ts",
    "tests/vouchers.test.ts",
    "tests/inventory.test.ts",
    "tests/inventory-hardening.test.ts",
    "tests/inventory-cost-memory-legacy-regression.test.ts",
  ],
  costing: [
    "tests/factory-mix-batch-stable-cost.test.ts",
    "tests/factory-locked-rate-migration.test.ts",
    "tests/factory-raw-material-moving-avg.test.ts",
  ],
  reports: ["tests/reports.test.ts"],
  security: [
    "tests/permissions.test.ts",
    "tests/named-permission-service.test.ts",
    "tests/credential-version-service.test.ts",
    "tests/company-context-enforcement.test.ts",
    "tests/legacy-privileged-write-guard.test.ts",
    "tests/raw-stock-sensitive-input-guard.test.ts",
    "tests/stored-file-protected-access.test.ts",
    "tests/program-5-end-to-end-security.test.ts",
    "tests/program-4-end-to-end-enforcement.test.ts",
    "tests/protected-asset-download-adapter.test.ts",
    "tests/security-audit-runtime.test.ts",
  ],
};

const frontendDomains = {
  smoke: ["tests/ui/authenticated-app-route-guard.test.ts"],
  frontend: ["tests/ui/authenticated-app-route-guard.test.ts"],
};

const domainArg = process.argv.find((argument) => argument.startsWith("--domain="));
const requestedDomain = domainArg?.slice("--domain=".length);
const smokeMode = process.argv.includes("--smoke");
const listMode = process.argv.includes("--list");

const availableDomains = [
  ...Object.keys(backendDomains).filter((name) => name !== "smoke"),
  ...Object.keys(frontendDomains).filter((name) => name !== "smoke"),
];

if (requestedDomain && !availableDomains.includes(requestedDomain)) {
  console.error(`Unknown Phase 12 domain: ${requestedDomain}`);
  console.error(`Available domains: ${availableDomains.join(", ")}`);
  process.exit(1);
}

function unique(paths) {
  return [...new Set(paths)];
}

let backendSuites;
let frontendSuites;
let mode;

if (smokeMode) {
  mode = "smoke";
  backendSuites = backendDomains.smoke;
  frontendSuites = frontendDomains.smoke;
} else if (requestedDomain) {
  mode = requestedDomain;
  backendSuites = backendDomains[requestedDomain] ?? [];
  frontendSuites = frontendDomains[requestedDomain] ?? [];
} else {
  mode = "full";
  backendSuites = unique(Object.entries(backendDomains).flatMap(([name, suites]) => (name === "smoke" ? [] : suites)));
  frontendSuites = unique(
    Object.entries(frontendDomains).flatMap(([name, suites]) => (name === "smoke" ? [] : suites)),
  );
  backendSuites = unique([...backendDomains.smoke, ...backendSuites]);
  frontendSuites = unique([...frontendDomains.smoke, ...frontendSuites]);
}

const allSuites = [...backendSuites, ...frontendSuites];
const missingSuites = allSuites.filter((suitePath) => !existsSync(suitePath));
if (missingSuites.length > 0) {
  console.error("Phase 12 business regression suite is incomplete.");
  for (const suitePath of missingSuites) console.error(`Missing: ${suitePath}`);
  process.exit(1);
}

const selection = {
  mode,
  backend: backendSuites,
  frontend: frontendSuites,
  totalFiles: allSuites.length,
};

if (listMode) {
  console.log(JSON.stringify(selection, null, 2));
  process.exit(0);
}

const vitest = "node_modules/vitest/vitest.mjs";
if (!existsSync(vitest)) {
  console.error("Vitest is not installed. Run npm install before executing Phase 12.");
  process.exit(1);
}

function runVitest(label, args) {
  if (args.length === 0) return;
  console.log(`Running Phase 12 ${mode} ${label} boundary (${args.length} files).`);
  const result = spawnSync(
    process.execPath,
    [vitest, "run", ...args, "--maxWorkers=1", "--no-file-parallelism"],
    {
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "test" },
    },
  );
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runVitest("backend", backendSuites);
runVitest(
  "frontend",
  frontendSuites.length > 0 ? ["--config", "vitest.config.frontend.ts", ...frontendSuites] : [],
);

console.log(`Phase 12 ${mode} business regression boundary passed (${allSuites.length} files).`);
