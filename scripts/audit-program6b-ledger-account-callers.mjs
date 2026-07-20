#!/usr/bin/env node

/**
 * Program 6B static audit for /api/ledger-accounts consumers.
 *
 * This script is intentionally read-only. It inventories frontend callers so the
 * legacy array contract can be preserved for selectors while heavy management
 * callers migrate to bounded/list-specific contracts.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const CLIENT_ROOT = join(ROOT, "client", "src");
const ENDPOINT = "/api/ledger-accounts";

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function classify(source, index) {
  const context = source.slice(Math.max(0, index - 500), index + 900);
  const lower = context.toLowerCase();

  if (lower.includes("parent group") || lower.includes("groupoptions") || lower.includes("subtype === \"group\"")) {
    return "parent-group-selector";
  }
  if (/[?&]accountType=/.test(context) || lower.includes("accounttype")) {
    return "filtered-selector";
  }
  if (/[?&]search=/.test(context) || lower.includes("searchparams")) {
    return "search-selector";
  }
  if (lower.includes("offline") || lower.includes("prefetch")) {
    return "offline-or-prefetch";
  }
  if (lower.includes("management") || lower.includes("accounttable")) {
    return "management-list";
  }
  return "legacy-full-selector";
}

const files = await walk(CLIENT_ROOT);
const callers = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  let index = source.indexOf(ENDPOINT);
  while (index !== -1) {
    const line = source.slice(0, index).split("\n").length;
    callers.push({
      file: relative(ROOT, file).replaceAll("\\", "/"),
      line,
      classification: classify(source, index),
    });
    index = source.indexOf(ENDPOINT, index + ENDPOINT.length);
  }
}

callers.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

const counts = callers.reduce((acc, caller) => {
  acc[caller.classification] = (acc[caller.classification] || 0) + 1;
  return acc;
}, {});

console.log("Program 6B ledger-account caller audit");
console.log(`Endpoint: ${ENDPOINT}`);
console.log(`Call sites: ${callers.length}`);
console.log("");
for (const caller of callers) {
  console.log(`${caller.classification.padEnd(23)} ${caller.file}:${caller.line}`);
}
console.log("");
console.log("Classification totals:");
for (const [classification, count] of Object.entries(counts).sort()) {
  console.log(`  ${classification}: ${count}`);
}

const accountsCaller = callers.find((caller) => caller.file === "client/src/pages/Accounts.tsx");
if (!accountsCaller) {
  console.error("\nFAIL: Accounts.tsx no longer has an auditable ledger-account caller; review Program 6B assumptions.");
  process.exitCode = 1;
} else if (accountsCaller.classification !== "parent-group-selector") {
  console.error(`\nFAIL: Accounts.tsx classified as ${accountsCaller.classification}; expected parent-group-selector.`);
  process.exitCode = 1;
}

const managementCallers = callers.filter((caller) => caller.classification === "management-list");
if (managementCallers.length > 0) {
  console.error("\nFAIL: management-list callers must use a bounded paginated contract before Program 6B can complete.");
  process.exitCode = 1;
}
