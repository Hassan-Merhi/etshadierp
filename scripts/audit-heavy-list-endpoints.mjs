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
const findings = [];
const routePattern = /app\.get\(\s*["'`]([^"'`]+)["'`]/g;

for (const file of files) {
  const source = await fs.readFile(file, "utf8");
  for (const match of source.matchAll(routePattern)) {
    const routePath = match[1];
    const start = match.index ?? 0;
    const end = findRouteEnd(source, start);
    const block = source.slice(start, end);

    const returnsArray = /res\.(?:json|send)\(\s*(?:rows|items|results|data|entries|merged|[a-zA-Z_$][\w$]*)\s*\)/.test(block);
    const hasLimit = /\.limit\s*\(|\bLIMIT\s+\$?\d*|\bpageSize\b|\btotalPages\b|\boffset\b/.test(block);
    const selectsAll = /\.select\(\s*\)|\.select\(\s*\{[\s\S]*?\}\s*\)/.test(block);
    const isKnownHeavy = knownHeavyPaths.has(routePath);

    if (!isKnownHeavy && !(returnsArray && selectsAll && !hasLimit)) continue;

    findings.push({
      severity: isKnownHeavy && !hasLimit ? "high" : !hasLimit ? "medium" : "info",
      route: routePath,
      file: path.relative(ROOT, file).replaceAll(path.sep, "/"),
      line: lineNumberAt(source, start),
      knownHeavy: isKnownHeavy,
      returnsArray,
      routeNativePagination: hasLimit,
      compatibilityBridgeEligible: knownHeavyPaths.has(routePath),
    });
  }
}

findings.sort((a, b) => {
  const weight = { high: 0, medium: 1, info: 2 };
  return weight[a.severity] - weight[b.severity] || a.route.localeCompare(b.route);
});

const summary = findings.reduce(
  (acc, item) => {
    acc.total += 1;
    acc[item.severity] += 1;
    if (item.routeNativePagination) acc.routeNativePagination += 1;
    if (item.compatibilityBridgeEligible) acc.bridgeEligible += 1;
    return acc;
  },
  { total: 0, high: 0, medium: 0, info: 0, routeNativePagination: 0, bridgeEligible: 0 }
);

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), summary, findings }, null, 2));

if (process.env.HEAVY_API_AUDIT_FAIL === "1" && findings.some((item) => item.severity === "high")) {
  process.exitCode = 1;
}
