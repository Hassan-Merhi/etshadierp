#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const budgetPath = path.join(root, "config/critical-test-debt.json");
const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
const failures = [];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`${relativePath}: file is missing`);
    return "";
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function extractTitles(source, marker) {
  const pattern = new RegExp(`\\bit\\.${marker}\\(\\s*["'\\x60]([^"'\\x60]+)["'\\x60]`, "g");
  return [...source.matchAll(pattern)].map((match) => match[1]).sort();
}

function compareExact(relativePath, kind, expected, actual) {
  const expectedSorted = [...expected].sort();
  const missing = expectedSorted.filter((title) => !actual.includes(title));
  const unexpected = actual.filter((title) => !expectedSorted.includes(title));
  if (missing.length > 0) failures.push(`${relativePath}: missing approved ${kind}: ${missing.join(" | ")}`);
  if (unexpected.length > 0) failures.push(`${relativePath}: unapproved ${kind}: ${unexpected.join(" | ")}`);
}

for (const [relativePath, allowance] of Object.entries(budget.criticalFiles)) {
  const source = read(relativePath);
  compareExact(relativePath, "skips", allowance.skips ?? [], extractTitles(source, "skip"));
  compareExact(relativePath, "todos", allowance.todos ?? [], extractTitles(source, "todo"));
}

for (const [relativePath, requiredTitles] of Object.entries(budget.activeReplacements)) {
  const source = read(relativePath);
  const skipped = new Set([...extractTitles(source, "skip"), ...extractTitles(source, "todo")]);
  for (const title of requiredTitles) {
    if (!source.includes(`it("${title}"`) && !source.includes(`it('${title}'`)) {
      failures.push(`${relativePath}: active replacement is missing: ${title}`);
    }
    if (skipped.has(title)) failures.push(`${relativePath}: replacement is still skipped or todo: ${title}`);
  }
}

const activeReplacementCount = Object.values(budget.activeReplacements).reduce(
  (total, titles) => total + titles.length,
  0,
);
if (activeReplacementCount < 5) failures.push("critical test debt must retain at least five active replacements");

if (failures.length > 0) {
  console.error("Critical test debt verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Critical test debt budget verified across ${Object.keys(budget.criticalFiles).length} files with ${activeReplacementCount} active replacements.`,
);
