#!/usr/bin/env node

/**
 * Program 6D read-only static audit for database query risks.
 *
 * This scanner does not modify application code or the database. It highlights
 * likely N+1 query loops, broad selects, and unbounded list reads for manual
 * review. Findings are intentionally conservative: they are evidence for
 * inspection, not automatic proof that a query is unsafe.
 *
 * Usage:
 *   node scripts/audit-program6d-database-query-risks.mjs
 *   node scripts/audit-program6d-database-query-risks.mjs --json
 *   node scripts/audit-program6d-database-query-risks.mjs --strict
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SERVER_ROOT = join(ROOT, "server");
const JSON_OUTPUT = process.argv.includes("--json");
const STRICT = process.argv.includes("--strict");

const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage", ".git"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (SOURCE_EXTENSIONS.test(entry.name)) files.push(path);
  }

  return files;
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function compactSnippet(source, start, end) {
  return source
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function findingId(file, category, snippet) {
  const normalizedSnippet = snippet
    .replace(/\b\d+(?:\.\d+)?\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  const digest = createHash("sha256")
    .update(`${file}\n${category}\n${normalizedSnippet}`)
    .digest("hex")
    .slice(0, 12);
  return `P6D-${digest}`;
}

function addFinding(findings, file, source, index, category, severity, message, snippetEnd = index + 300) {
  const snippet = compactSnippet(source, index, snippetEnd);
  findings.push({
    id: findingId(file, category, snippet),
    file,
    line: lineNumberAt(source, index),
    category,
    severity,
    message,
    snippet,
  });
}

function detectAwaitInsideLoops(source, file, findings) {
  const loopPattern = /\b(for\s*\([^)]*\)|for\s+await\s*\([^)]*\)|for\s*\([^)]*\)|while\s*\([^)]*\)|\.forEach\s*\([^)]*=>\s*\{)/g;
  let match;

  while ((match = loopPattern.exec(source)) !== null) {
    const windowEnd = Math.min(source.length, match.index + 2200);
    const window = source.slice(match.index, windowEnd);
    const awaitMatch = /\bawait\s+(?:db\.|tx\.|storage\.|pool\.|client\.|sql\.|[A-Za-z_$][\w$]*\.(?:select|insert|update|delete|execute|query|find|findMany|findFirst|get|list))/m.exec(window);
    if (!awaitMatch) continue;

    const absoluteIndex = match.index + awaitMatch.index;
    addFinding(
      findings,
      file,
      source,
      absoluteIndex,
      "possible-n-plus-one",
      "high",
      "Database-like await appears inside or immediately after a loop; inspect whether the reads can be batched or preloaded.",
    );
  }
}

function detectBroadSelects(source, file, findings) {
  const patterns = [
    {
      regex: /select\s*\(\s*\)\s*\.from\s*\(/g,
      category: "broad-select",
      severity: "medium",
      message: "Drizzle select() requests all mapped columns; verify the caller needs the full row shape.",
    },
    {
      regex: /select\s+\*\s+from\s+/gi,
      category: "select-star",
      severity: "high",
      message: "Raw SQL SELECT * can inflate row payloads and memory use; prefer explicit fields where behavior permits.",
    },
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(source)) !== null) {
      addFinding(findings, file, source, match.index, pattern.category, pattern.severity, pattern.message);
    }
  }
}

function detectPotentiallyUnboundedReads(source, file, findings) {
  const queryPattern = /(?:db|tx)\s*\.\s*select\s*\([^)]*\)\s*\.\s*from\s*\([^)]*\)/g;
  let match;

  while ((match = queryPattern.exec(source)) !== null) {
    const tail = source.slice(match.index, Math.min(source.length, match.index + 1200));
    const terminator = tail.search(/[;\n]\s*(?:return|const|let|var|if|for|while|res\.|reply\.|$)/);
    const chain = terminator >= 0 ? tail.slice(0, terminator) : tail;
    const hasLimit = /\.limit\s*\(/.test(chain);
    const isAggregate = /\b(count|sum|avg|min|max)\s*\(/i.test(chain);

    if (!hasLimit && !isAggregate) {
      addFinding(
        findings,
        file,
        source,
        match.index,
        "possibly-unbounded-read",
        "medium",
        "List-like select has no nearby limit; verify it is bounded by a unique predicate or intentionally small dataset.",
        match.index + chain.length,
      );
    }
  }
}

function detectSequentialIndependentReads(source, file, findings) {
  const consecutiveAwaitPattern = /await\s+[^;\n]+[;\n]\s*(?:const|let|var)?\s*[^=;\n]*=?\s*await\s+/g;
  let match;

  while ((match = consecutiveAwaitPattern.exec(source)) !== null) {
    const snippet = source.slice(match.index, Math.min(source.length, match.index + 700));
    if (!/(?:db\.|tx\.|storage\.|pool\.|client\.|\.query\(|\.select\(|\.execute\()/m.test(snippet)) continue;

    addFinding(
      findings,
      file,
      source,
      match.index,
      "sequential-query-candidate",
      "low",
      "Consecutive awaited operations may be independent; inspect whether Promise.all is safe without changing transaction semantics.",
      match.index + 700,
    );
  }
}

let files;
try {
  files = await walk(SERVER_ROOT);
} catch (error) {
  console.error(`Unable to scan ${relative(ROOT, SERVER_ROOT)}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const findings = [];
for (const absolutePath of files) {
  const source = await readFile(absolutePath, "utf8");
  const file = relative(ROOT, absolutePath).replaceAll("\\", "/");

  detectAwaitInsideLoops(source, file, findings);
  detectBroadSelects(source, file, findings);
  detectPotentiallyUnboundedReads(source, file, findings);
  detectSequentialIndependentReads(source, file, findings);
}

const deduplicated = Array.from(
  new Map(findings.map((finding) => [`${finding.file}:${finding.line}:${finding.category}`, finding])).values(),
).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.category.localeCompare(b.category));

const totals = deduplicated.reduce(
  (acc, finding) => {
    acc.byCategory[finding.category] = (acc.byCategory[finding.category] || 0) + 1;
    acc.bySeverity[finding.severity] = (acc.bySeverity[finding.severity] || 0) + 1;
    return acc;
  },
  { byCategory: {}, bySeverity: {} },
);

const highSeverityCount = totals.bySeverity.high || 0;
const failureReasons = [];
if (STRICT && highSeverityCount > 0) {
  failureReasons.push(`${highSeverityCount} high-severity query-risk candidate(s) require review.`);
}

const report = {
  program: "6D",
  scope: relative(ROOT, SERVER_ROOT).replaceAll("\\", "/"),
  filesScanned: files.length,
  findingCount: deduplicated.length,
  highSeverityCount,
  strict: STRICT,
  passed: failureReasons.length === 0,
  failureReasons,
  totals,
  findings: deduplicated,
  notes: [
    "Finding IDs are deterministic from file, category, and normalized snippet so classifications can survive unrelated line movement.",
    "This is a static heuristic audit; every finding requires manual review.",
    "Do not add indexes without query-plan evidence.",
    "Do not parallelize queries that depend on transaction ordering or shared mutable state.",
    "Do not change accounting, inventory, costing, company isolation, or historical-data semantics.",
  ],
};

if (JSON_OUTPUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Program 6D database query risk audit");
  console.log(`Files scanned: ${report.filesScanned}`);
  console.log(`Findings: ${report.findingCount}`);
  console.log(`High severity: ${report.highSeverityCount}`);
  console.log("");

  for (const finding of deduplicated) {
    console.log(`${finding.severity.padEnd(6)} ${finding.category.padEnd(30)} ${finding.file}:${finding.line} [${finding.id}]`);
    console.log(`       ${finding.message}`);
  }

  console.log("\nCategory totals:");
  for (const [category, count] of Object.entries(totals.byCategory).sort()) {
    console.log(`  ${category}: ${count}`);
  }
}

if (!report.passed) {
  for (const reason of failureReasons) {
    console.error(`\nFAIL (--strict): ${reason}`);
  }
  process.exitCode = 1;
}
