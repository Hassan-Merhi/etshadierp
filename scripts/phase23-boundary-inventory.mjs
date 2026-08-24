#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { auditTypeEscapes } from "./audit-type-escapes.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = auditTypeEscapes();

const SIGNALS = {
  http: /\b(?:fetch|axios|apiRequest|queryClient|useQuery|useMutation)\b|\b(?:req|res)\.(?:body|query|params|json|status)\b/g,
  db: /\bdb\.|\.execute\s*\(|\bsql(?:<|`)|\.rows\b|\bdrizzle\b/g,
  dto: /\b(?:interface|type)\s+\w*(?:Request|Response|DTO|Dto|Payload|Result|Error)\b/g,
  errors: /\b(?:catch\s*\(|AxiosError|error\b|errors\b)/g,
};

const PATH_BUCKETS = [
  ["server/services/", "server-service"],
  ["server/storage/", "server-storage"],
  ["server/lib/", "server-lib"],
  ["server/helpers/", "server-helper"],
  ["server/routes/", "server-route"],
  ["client/src/services/", "client-service"],
  ["client/src/lib/", "client-lib"],
  ["client/src/hooks/", "client-hook"],
  ["shared/", "shared-contract"],
];

function bucketFor(filePath) {
  return PATH_BUCKETS.find(([prefix]) => filePath.startsWith(prefix))?.[1] ?? null;
}

function countMatches(source, pattern) {
  pattern.lastIndex = 0;
  return [...source.matchAll(pattern)].length;
}

const candidates = [];
for (const file of report.files) {
  if (file.total === 0) continue;
  const bucket = bucketFor(file.path);
  if (!bucket) continue;
  const sourcePath = path.join(projectRoot, file.path);
  if (!fs.existsSync(sourcePath)) continue;
  const source = fs.readFileSync(sourcePath, "utf8");
  const signals = Object.fromEntries(
    Object.entries(SIGNALS).map(([name, pattern]) => [name, countMatches(source, pattern)])
  );
  const signalTotal = Object.values(signals).reduce((sum, value) => sum + value, 0);
  if (bucket === "server-route" && signalTotal === 0) continue;
  if ((bucket === "client-lib" || bucket === "client-hook") && signalTotal === 0) continue;

  candidates.push({
    path: file.path,
    bucket,
    explicitAny: file.explicitAny,
    asAny: file.asAny,
    suppressions: file.suppressions,
    drizzleRowCasts: file.drizzleRowCasts,
    total: file.total,
    signals,
    signalTotal,
  });
}

candidates.sort((a, b) => b.total - a.total || b.signalTotal - a.signalTotal || a.path.localeCompare(b.path));

const bucketTotals = {};
for (const candidate of candidates) {
  const current = bucketTotals[candidate.bucket] ?? { files: 0, escapes: 0, drizzleRowCasts: 0 };
  current.files += 1;
  current.escapes += candidate.total;
  current.drizzleRowCasts += candidate.drizzleRowCasts;
  bucketTotals[candidate.bucket] = current;
}

const payload = {
  generatedAt: new Date().toISOString(),
  repositorySummary: report.summary,
  candidateSummary: {
    files: candidates.length,
    escapes: candidates.reduce((sum, file) => sum + file.total, 0),
    drizzleRowCasts: candidates.reduce((sum, file) => sum + file.drizzleRowCasts, 0),
  },
  bucketTotals,
  topCandidates: candidates.slice(0, 160),
};

const json = `${JSON.stringify(payload, null, 2)}\n`;
if (process.argv.includes("--write")) {
  const outputPath = path.join(projectRoot, "artifacts/phase23-boundary-inventory.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, json);
  console.log(`Wrote ${path.relative(projectRoot, outputPath)} with ${payload.candidateSummary.escapes} candidate escapes.`);
} else {
  process.stdout.write(json);
}
