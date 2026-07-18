#!/usr/bin/env node

/**
 * Program 6C static audit for stock-item API consumers.
 *
 * The legacy /api/stock-items array contract must remain available until each
 * frontend caller is explicitly classified. This script distinguishes
 * lightweight selectors, paginated management lists, full-data management
 * callers, offline/prefetch flows, and unresolved legacy callers.
 *
 * Run with --strict to fail when selector-only callers still use the full
 * endpoint or when an unclassified legacy caller remains.
 * Run with --json to emit a stable machine-readable report for CI or follow-up
 * migration tooling.
 * Run with --fix-safe to apply only explicitly allow-listed, exact-match
 * migrations that do not alter mutations, accounting, inventory, or costing.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const CLIENT_ROOT = join(ROOT, "client", "src");
const FULL_ENDPOINT = "/api/stock-items";
const LIGHT_ENDPOINT = "/api/stock-items/light";
const STRICT = process.argv.includes("--strict");
const JSON_OUTPUT = process.argv.includes("--json");
const FIX_SAFE = process.argv.includes("--fix-safe");

const SAFE_MIGRATIONS = [
  {
    file: "client/src/pages/settings/BulkRenameTab.tsx",
    description: "Bulk Rename read-only stock-item search",
    from: 'fetch("/api/stock-items", { credentials: "include" })',
    to: 'fetch("/api/stock-items/light", { credentials: "include" })',
  },
];

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

async function applySafeMigrations() {
  const results = [];

  for (const migration of SAFE_MIGRATIONS) {
    const absolutePath = join(ROOT, migration.file);
    const source = await readFile(absolutePath, "utf8");
    const exactMatches = source.split(migration.from).length - 1;

    if (exactMatches === 0 && source.includes(migration.to)) {
      results.push({ ...migration, status: "already-migrated" });
      continue;
    }

    if (exactMatches !== 1) {
      results.push({
        ...migration,
        status: "skipped",
        reason: `expected exactly one safe source match, found ${exactMatches}`,
      });
      continue;
    }

    const updated = source.replace(migration.from, migration.to);
    await writeFile(absolutePath, updated, "utf8");
    results.push({ ...migration, status: "migrated" });
  }

  return results;
}

function classifyFullCaller(source, index, relativePath) {
  const context = source.slice(Math.max(0, index - 650), index + 1400);
  const lower = context.toLowerCase();

  if (
    /[?&](page|pagesize|limit|search|stockgroupid|gradeid|categoryid|active)=/i.test(context) ||
    lower.includes("urlsearchparams")
  ) {
    return "paginated-management";
  }

  if (
    lower.includes("sellingprice") ||
    lower.includes("openingqty") ||
    lower.includes("openingrate") ||
    lower.includes("openingvalue") ||
    lower.includes("locationprice") ||
    lower.includes("costing") ||
    lower.includes("bulk update") ||
    lower.includes("stock item management")
  ) {
    return "full-data-management";
  }

  if (lower.includes("offline") || lower.includes("prefetch") || lower.includes("sync")) {
    return "offline-or-prefetch";
  }

  // Bulk Rename only reads id, code, and name before posting selected ids to the
  // existing bulk-rename mutation. It does not read price, quantity, valuation,
  // alias, tax, or location-pricing fields, so downloading the full stock-item
  // record is unnecessary. Keep this explicit classification until the caller
  // is migrated to /api/stock-items/light, after which strict mode will stop
  // reporting it automatically.
  if (relativePath === "client/src/pages/settings/BulkRenameTab.tsx") {
    return "selector-only-migration-candidate";
  }

  if (
    lower.includes("dropdown") ||
    lower.includes("combobox") ||
    lower.includes("selector") ||
    lower.includes("selectitem") ||
    lower.includes("itemoptions") ||
    lower.includes("stockitemoptions")
  ) {
    return "selector-only-migration-candidate";
  }

  return "legacy-full-unclassified";
}

function findOccurrences(source, endpoint) {
  const occurrences = [];
  let index = source.indexOf(endpoint);
  while (index !== -1) {
    occurrences.push(index);
    index = source.indexOf(endpoint, index + endpoint.length);
  }
  return occurrences;
}

const safeMigrationResults = FIX_SAFE ? await applySafeMigrations() : [];
const files = await walk(CLIENT_ROOT);
const callers = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  const relativePath = relative(ROOT, file).replaceAll("\\", "/");

  for (const index of findOccurrences(source, LIGHT_ENDPOINT)) {
    callers.push({
      file: relativePath,
      line: source.slice(0, index).split("\n").length,
      endpoint: "light",
      classification: "lightweight-selector",
    });
  }

  for (const index of findOccurrences(source, FULL_ENDPOINT)) {
    if (source.startsWith(LIGHT_ENDPOINT, index)) continue;
    callers.push({
      file: relativePath,
      line: source.slice(0, index).split("\n").length,
      endpoint: "full",
      classification: classifyFullCaller(source, index, relativePath),
    });
  }
}

callers.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.endpoint.localeCompare(b.endpoint));

const counts = callers.reduce((acc, caller) => {
  acc[caller.classification] = (acc[caller.classification] || 0) + 1;
  return acc;
}, {});

const lightCallers = callers.filter((caller) => caller.classification === "lightweight-selector");
const migrationCandidates = callers.filter(
  (caller) =>
    caller.classification === "selector-only-migration-candidate" ||
    caller.classification === "legacy-full-unclassified",
);
const failures = [];

if (lightCallers.length === 0) {
  failures.push("no frontend caller uses /api/stock-items/light; review the Program 6C contract registration");
}
if (STRICT && migrationCandidates.length > 0) {
  failures.push("strict mode requires every selector-only or unresolved full-endpoint caller to be migrated or classified");
}
if (FIX_SAFE && safeMigrationResults.some((result) => result.status === "skipped")) {
  failures.push("one or more allow-listed safe migrations were skipped because the source no longer matched exactly");
}

const report = {
  program: "6C",
  audit: "stock-item-api-callers",
  strict: STRICT,
  fixSafe: FIX_SAFE,
  safeMigrationResults,
  callSiteCount: callers.length,
  counts,
  callers,
  migrationCandidates,
  failures,
  passed: failures.length === 0,
};

if (JSON_OUTPUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Program 6C stock-item caller audit");
  console.log(`Call sites: ${callers.length}`);

  if (FIX_SAFE) {
    console.log("\nSafe migration results:");
    for (const result of safeMigrationResults) {
      const suffix = result.reason ? ` (${result.reason})` : "";
      console.log(`  ${result.status.padEnd(18)} ${result.file}${suffix}`);
    }
  }

  console.log("");
  for (const caller of callers) {
    console.log(`${caller.classification.padEnd(35)} ${caller.file}:${caller.line}`);
  }
  console.log("");
  console.log("Classification totals:");
  for (const [classification, count] of Object.entries(counts).sort()) {
    console.log(`  ${classification}: ${count}`);
  }

  if (migrationCandidates.length > 0) {
    console.log("\nReview required before removing the legacy full-array contract:");
    for (const caller of migrationCandidates) {
      console.log(`  ${caller.file}:${caller.line} (${caller.classification})`);
    }
  }

  for (const failure of failures) {
    console.error(`\nFAIL: ${failure}.`);
  }
}

if (failures.length > 0) {
  process.exitCode = 1;
}
