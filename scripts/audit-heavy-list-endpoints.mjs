#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ROUTES_ROOT = path.join(ROOT, "server", "routes");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);
const EXCLUDED_DIRS = new Set(["node_modules", "dist", "build", ".git"]);

const knownHeavyPaths = new Set([
  "/api/factory/daybook",
  "/api/stock-items",
  "/api/inventory",
  "/api/factory/bales",
  "/api/factory/v5/stock-allocation",
  "/api/factory/bales/stock-entry-history",
]);

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}

function findRouteEnd(source, startIndex) {
  const nextRoute = source.indexOf("\n  app.", startIndex + 1);
  return nextRoute === -1 ? source.length : nextRoute;
}

const files = await walk(ROUTES_ROOT);
const routePattern = /app\.get\(\s*["'`]([^"'`]+)["'`]/g;
const occurrences = [];

for (const file of files) {
  const source = await fs.readFile(file, "utf8");
  for (const match of source.matchAll(routePattern)) {
    const routePath = match[1];
    const start = match.index ?? 0;
    const end = findRouteEnd(source, start);
    const block = source.slice(start, end);
    const returnsArray = /res\.(?:json|send)\(\s*(?:rows|items|results|data|entries|merged|[a-zA-Z_$][\w$]*)\s*\)/.test(block);
    const hasDatabaseLimit = /\.limit\s*\(|\bLIMIT\s+\$?\{?|\bOFFSET\s+\$?\{?/.test(block);
    const hasPaginationContract = /\bpageSize\b|\btotalPages\b|\bhasNextPage\b|X-Total-Count/.test(block);
    const selectsAll = /\.select\(\s*\)|\.select\(\s*\{[\s\S]*?\}\s*\)/.test(block);

    occurrences.push({
      route: routePath,
      file: path.relative(ROOT, file).replaceAll(path.sep, "/"),
      line: lineNumberAt(source, start),
      returnsArray,
      selectsAll,
      hasDatabaseLimit,
      hasPaginationContract,
      nativePagination: hasDatabaseLimit && hasPaginationContract,
    });
  }
}

const nativeByRoute = new Map();
for (const occurrence of occurrences) {
  if (!occurrence.nativePagination) continue;
  const current = nativeByRoute.get(occurrence.route) ?? [];
  current.push(`${occurrence.file}:${occurrence.line}`);
  nativeByRoute.set(occurrence.route, current);
}

const findings = [];
for (const occurrence of occurrences) {
  const isKnownHeavy = knownHeavyPaths.has(occurrence.route);
  const protectedElsewhere = nativeByRoute.has(occurrence.route);
  if (!isKnownHeavy && !(occurrence.returnsArray && occurrence.selectsAll && !occurrence.hasDatabaseLimit)) continue;

  let severity = "info";
  if (!protectedElsewhere && isKnownHeavy) severity = "high";
  else if (!protectedElsewhere && !occurrence.hasDatabaseLimit) severity = "medium";

  findings.push({
    severity,
    ...occurrence,
    knownHeavy: isKnownHeavy,
    protectedElsewhere,
    nativeHandlers: nativeByRoute.get(occurrence.route) ?? [],
    compatibilityBridgeEligible: isKnownHeavy,
  });
}

findings.sort((a, b) => {
  const weight = { high: 0, medium: 1, info: 2 };
  return weight[a.severity] - weight[b.severity] || a.route.localeCompare(b.route) || a.file.localeCompare(b.file);
});

const protectedHeavyRoutes = [...knownHeavyPaths].filter((route) => nativeByRoute.has(route));
const unprotectedHeavyRoutes = [...knownHeavyPaths].filter((route) => !nativeByRoute.has(route));
const summary = {
  occurrences: findings.length,
  high: findings.filter((item) => item.severity === "high").length,
  medium: findings.filter((item) => item.severity === "medium").length,
  info: findings.filter((item) => item.severity === "info").length,
  protectedHeavyRoutes,
  unprotectedHeavyRoutes,
};

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), summary, findings }, null, 2));

if (process.env.HEAVY_API_AUDIT_FAIL === "1" && unprotectedHeavyRoutes.length > 0) {
  process.exitCode = 1;
}
