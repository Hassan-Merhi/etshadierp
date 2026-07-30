#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(repoRoot, "migrations");
const journalPath = path.join(migrationsDir, "meta", "_journal.json");
const debtPath = path.join(repoRoot, "config", "migration-registry-debt.json");
const strict = process.argv.includes("--strict");
const jsonOutput = process.argv.includes("--json");

const journal = JSON.parse(await readFile(journalPath, "utf8"));
const debt = JSON.parse(await readFile(debtPath, "utf8"));
const migrationFiles = (await readdir(migrationsDir))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const migrationTags = new Set(migrationFiles.map((name) => name.slice(0, -4)));
const entries = Array.isArray(journal.entries) ? journal.entries : [];

const errors = [];
const warnings = [];
const seenIndexes = new Set();
const seenTags = new Set();

function uniqueValues(values, label) {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length > 0) errors.push(`${label} contains duplicates: ${[...new Set(duplicates)].join(", ")}`);
}

if (debt.version !== 1) errors.push(`Unsupported migration debt policy version: ${String(debt.version)}`);

const approvedLegacyTags = (debt.legacyMissingRegisteredTags ?? []).map((entry) => entry.tag);
const approvedUnregisteredFiles = (debt.approvedUnregisteredSqlFiles ?? []).map((entry) => entry.file);
uniqueValues(approvedLegacyTags, "legacyMissingRegisteredTags");
uniqueValues(approvedUnregisteredFiles, "approvedUnregisteredSqlFiles");

const approvedLegacyTagSet = new Set(approvedLegacyTags);
const approvedUnregisteredFileSet = new Set(approvedUnregisteredFiles);

if (journal.dialect !== "postgresql") {
  errors.push(`Expected PostgreSQL migration journal, found ${String(journal.dialect)}.`);
}

entries.forEach((entry, position) => {
  if (!Number.isInteger(entry.idx)) {
    errors.push(`Journal entry ${position} has an invalid idx.`);
  } else {
    if (seenIndexes.has(entry.idx)) errors.push(`Duplicate migration idx ${entry.idx}.`);
    seenIndexes.add(entry.idx);
    if (entry.idx !== position) {
      errors.push(`Journal entry ${entry.tag ?? position} has idx ${entry.idx}; expected ${position}.`);
    }
  }

  if (typeof entry.tag !== "string" || entry.tag.length === 0) {
    errors.push(`Journal entry ${position} has an invalid tag.`);
    return;
  }

  if (seenTags.has(entry.tag)) errors.push(`Duplicate migration tag ${entry.tag}.`);
  seenTags.add(entry.tag);

  const hasFile = migrationTags.has(entry.tag);
  if (!hasFile && !approvedLegacyTagSet.has(entry.tag)) {
    errors.push(`Journal tag ${entry.tag} has no matching migrations/${entry.tag}.sql file.`);
  }
  if (hasFile && approvedLegacyTagSet.has(entry.tag)) {
    errors.push(`Approved legacy gap ${entry.tag} now has a SQL file; review and remove the stale allowance.`);
  }
});

for (const approvedTag of approvedLegacyTags) {
  if (!seenTags.has(approvedTag)) {
    errors.push(`Approved legacy gap ${approvedTag} is no longer present in the journal.`);
  }
}

const unregisteredFiles = migrationFiles.filter((name) => !seenTags.has(name.slice(0, -4)));
const unapprovedUnregisteredFiles = unregisteredFiles.filter((name) => !approvedUnregisteredFileSet.has(name));
const staleApprovedFiles = approvedUnregisteredFiles.filter((name) => !unregisteredFiles.includes(name));

if (unapprovedUnregisteredFiles.length > 0) {
  errors.push(`Unapproved unregistered SQL files: ${unapprovedUnregisteredFiles.join(", ")}.`);
}
if (staleApprovedFiles.length > 0) {
  errors.push(`Migration debt manifest contains stale file allowances: ${staleApprovedFiles.join(", ")}.`);
}

const requiredTags = ["20260720_003_ledger_account_opening_balance_currency"];
for (const tag of requiredTags) {
  if (!seenTags.has(tag)) errors.push(`Required migration is not registered: ${tag}.`);
}

if (strict && warnings.length > 0) errors.push(...warnings.map((warning) => `Strict mode: ${warning}`));

const result = {
  ok: errors.length === 0,
  strict,
  registeredCount: entries.length,
  sqlFileCount: migrationFiles.length,
  approvedLegacyGaps: approvedLegacyTags,
  approvedUnregisteredFiles,
  unapprovedUnregisteredFiles,
  warnings,
  errors,
};

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  console.log(`Migration registry: ${entries.length} registered / ${migrationFiles.length} SQL files`);
  console.log(`Approved legacy journal gaps: ${approvedLegacyTags.length}`);
  console.log(`Approved standalone SQL files: ${approvedUnregisteredFiles.length}`);
  for (const warning of warnings) console.warn(`WARN: ${warning}`);
  for (const error of errors) console.error(`ERROR: ${error}`);
  console.log(result.ok ? "Migration registry verification passed." : "Migration registry verification failed.");
}

process.exitCode = result.ok ? 0 : 1;
