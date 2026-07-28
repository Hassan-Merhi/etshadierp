#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(repoRoot, "migrations");
const journalPath = path.join(migrationsDir, "meta", "_journal.json");
const strict = process.argv.includes("--strict");
const jsonOutput = process.argv.includes("--json");

const journal = JSON.parse(await readFile(journalPath, "utf8"));
const migrationFiles = (await readdir(migrationsDir))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const migrationTags = new Set(migrationFiles.map((name) => name.slice(0, -4)));
const entries = Array.isArray(journal.entries) ? journal.entries : [];

// These three Drizzle journal entries predate the repository's versioned
// migration controls. Their original SQL files were never committed. Keep the
// exception explicit and bounded so every newer missing migration still fails.
const knownLegacyMissingSqlTags = new Set([
  "0000_conscious_william_stryker",
  "0001_parallel_guardian",
  "0002_married_loa",
]);

const errors = [];
const warnings = [];
const seenIndexes = new Set();
const seenTags = new Set();
const legacyMissingFiles = [];

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

  if (!migrationTags.has(entry.tag)) {
    if (knownLegacyMissingSqlTags.has(entry.tag)) {
      legacyMissingFiles.push(`${entry.tag}.sql`);
      return;
    }
    errors.push(`Journal tag ${entry.tag} has no matching migrations/${entry.tag}.sql file.`);
  }
});

if (legacyMissingFiles.length > 0) {
  warnings.push(
    `Known legacy journal entries have no committed SQL files: ${legacyMissingFiles.join(", ")}. ` +
      "Only these explicitly listed pre-versioning gaps are tolerated.",
  );
}

const unregisteredFiles = migrationFiles.filter((name) => !seenTags.has(name.slice(0, -4)));
if (unregisteredFiles.length > 0) {
  warnings.push(
    `Unregistered SQL files: ${unregisteredFiles.join(", ")}. ` +
      "These remain outside the versioned runner until deliberately registered.",
  );
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
  legacyMissingFiles,
  unregisteredFiles,
  warnings,
  errors,
};

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  console.log(`Migration registry: ${entries.length} registered / ${migrationFiles.length} SQL files`);
  for (const warning of warnings) console.warn(`WARN: ${warning}`);
  for (const error of errors) console.error(`ERROR: ${error}`);
  console.log(result.ok ? "Migration registry verification passed." : "Migration registry verification failed.");
}

process.exitCode = result.ok ? 0 : 1;
