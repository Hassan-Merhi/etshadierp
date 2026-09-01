#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const JSON_MODE = process.argv.includes("--json");
const STRICT_MODE = process.argv.includes("--strict");

const SCAN_ROOTS = ["client/src", "server"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".cache",
]);

const ENDPOINT_FAMILIES = [
  {
    family: "location-inventory",
    pattern: /\/api\/(?:factory\/)?(?:location-inventory|inventory\/locations?|locations?\/inventory)(?:[/?#][^"'`\s]*)?/g,
  },
  {
    family: "stock-movement-history",
    pattern: /\/api\/(?:stock|inventory|factory)[^"'`\s]*(?:movement|history|ledger|transactions?)[^"'`\s]*/g,
  },
];

function stableId(file, family, endpoint, classification) {
  return createHash("sha256")
    .update(`${file}\n${family}\n${endpoint}\n${classification}`)
    .digest("hex")
    .slice(0, 16);
}

async function listFiles(relativeDirectory) {
  const absoluteDirectory = path.join(ROOT, relativeDirectory);
  const files = [];

  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(absolutePath);
      }
    }
  }

  await walk(absoluteDirectory);
  return files;
}

function lineNumberForIndex(source, index) {
  return source.slice(0, index).split("\n").length;
}

function surroundingText(source, index, radius = 220) {
  return source.slice(Math.max(0, index - radius), Math.min(source.length, index + radius));
}

function classifyReference(file, source, index, endpoint) {
  const context = surroundingText(source, index);
  const normalizedFile = file.replaceAll(path.sep, "/");
  const isClient = normalizedFile.startsWith("client/src/");
  const isServer = normalizedFile.startsWith("server/");

  if (/invalidateQueries|removeQueries|resetQueries|cancelQueries|setQueryData|getQueryData/.test(context)) {
    return { classification: "cache-key-reference", severity: "info" };
  }

  if (isServer && /(?:app|router)\.(?:get|post|put|patch|delete)\s*\(/.test(context)) {
    const unboundedSignals = [
      !/[?&](?:page|limit|offset|cursor)=/.test(endpoint),
      !/\.(?:limit|offset)\s*\(/.test(context),
      !/Math\.min|MAX_(?:PAGE_)?SIZE|DEFAULT_(?:PAGE_)?SIZE/.test(context),
    ];
    const likelyUnbounded = unboundedSignals.every(Boolean);
    return {
      classification: likelyUnbounded ? "server-route-review-required" : "server-route-bounded-signal",
      severity: likelyUnbounded ? "high" : "review",
    };
  }

  if (isClient && /useQuery|queryFn|apiRequest|fetch\s*\(|axios|request\s*\(/.test(context)) {
    const hasServerFilter = /[?&](?:page|limit|offset|cursor|search|locationId|itemId|stockItemId|dateFrom|dateTo|from|to)=/.test(endpoint);
    return {
      classification: hasServerFilter ? "client-read-filtered-signal" : "client-read-review-required",
      severity: hasServerFilter ? "review" : "high",
    };
  }

  if (isClient && /useMutation|mutationFn|method:\s*["'`](?:POST|PUT|PATCH|DELETE)/i.test(context)) {
    return { classification: "mutation-reference", severity: "info" };
  }

  return { classification: "unclassified-reference", severity: "review" };
}

async function main() {
  const absoluteFiles = (await Promise.all(SCAN_ROOTS.map(listFiles))).flat();
  const findings = [];

  for (const absoluteFile of absoluteFiles) {
    const source = await fs.readFile(absoluteFile, "utf8");
    const file = path.relative(ROOT, absoluteFile).replaceAll(path.sep, "/");

    for (const { family, pattern } of ENDPOINT_FAMILIES) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const endpoint = match[0];
        const index = match.index ?? 0;
        const { classification, severity } = classifyReference(file, source, index, endpoint);
        findings.push({
          id: stableId(file, family, endpoint, classification),
          family,
          file,
          line: lineNumberForIndex(source, index),
          endpoint,
          classification,
          severity,
        });
      }
    }
  }

  findings.sort((a, b) =>
    a.family.localeCompare(b.family) ||
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.endpoint.localeCompare(b.endpoint),
  );

  const reviewFindings = findings.filter((finding) => finding.severity === "high" || finding.severity === "review");
  const highSeverityFindings = findings.filter((finding) => finding.severity === "high");
  const failureReasons = [];
  if (STRICT_MODE && highSeverityFindings.length > 0) {
    failureReasons.push(`${highSeverityFindings.length} high-severity inventory payload finding(s) require review`);
  }

  const report = {
    audit: "program-6c-inventory-payloads",
    generatedAt: new Date().toISOString(),
    strict: STRICT_MODE,
    filesScanned: absoluteFiles.length,
    endpointReferences: findings.length,
    reviewRequiredCount: reviewFindings.length,
    highSeverityCount: highSeverityFindings.length,
    passed: failureReasons.length === 0,
    failureReasons,
    findings,
  };

  if (JSON_MODE) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log("Program 6C inventory payload audit");
    console.log(`Files scanned: ${report.filesScanned}`);
    console.log(`Endpoint references: ${report.endpointReferences}`);
    console.log(`Review required: ${report.reviewRequiredCount}`);
    console.log(`High severity: ${report.highSeverityCount}`);

    for (const finding of findings) {
      console.log(
        `[${finding.severity}] ${finding.id} ${finding.family} ${finding.file}:${finding.line} ${finding.classification} ${finding.endpoint}`,
      );
    }

    if (failureReasons.length > 0) {
      for (const reason of failureReasons) console.error(`FAIL: ${reason}`);
    }
  }

  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
