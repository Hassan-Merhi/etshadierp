#!/usr/bin/env node
// Compiler-gated Phase 2.3 transform: repair injected route boundaries first so
// Drizzle/query callback types can flow from the real database contract.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routeRoot = path.join(projectRoot, "server/routes");
const helperPath = path.join(routeRoot, "routeBoundaryTypes.ts");

const TARGET_PREFIXES = [
  "factory-intelligence/",
  "factory-payroll/",
  "factory-workers/",
  "factory-reports/",
  "container-loaded-items/",
  "supplier-profit-check/",
];

const CALLBACK_METHODS = [
  "map",
  "filter",
  "find",
  "findIndex",
  "some",
  "every",
  "forEach",
  "reduce",
  "reduceRight",
  "sort",
  "flatMap",
  "transaction",
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(absolute);
  }
  return files;
}

function importPath(fromFile, toFile) {
  let rel = path.relative(path.dirname(fromFile), toFile).replaceAll(path.sep, "/");
  rel = rel.replace(/\.ts$/, "");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

function addBoundaryImport(source, filePath) {
  if (source.includes("routeBoundaryTypes")) return source;
  const specifier = importPath(filePath, helperPath);
  const line = `import type { AppDb, AuthMiddleware } from "${specifier}";\n`;
  const importMatches = [...source.matchAll(/^import .*;\s*$/gm)];
  if (importMatches.length === 0) return `${line}${source}`;
  const last = importMatches.at(-1);
  const insertAt = last.index + last[0].length;
  return `${source.slice(0, insertAt)}\n${line}${source.slice(insertAt)}`;
}

function stripInferredCallbackAny(source) {
  const methods = CALLBACK_METHODS.join("|");
  const callbackPattern = new RegExp(
    `(\\.(?:${methods})\\(\\s*(?:async\\s*)?\\()([^)]*)(\\)\\s*=>)`,
    "g"
  );
  return source.replace(callbackPattern, (full, prefix, params, suffix) => {
    if (!params.includes(": any")) return full;
    const nextParams = params.replace(/:\s*any\b/g, "");
    return `${prefix}${nextParams}${suffix}`;
  });
}

function transformRouteFile(filePath, source) {
  let next = source;
  let dependencyTyped = false;

  const dependencyPattern = /requireAuth:\s*any\s*,\s*db:\s*any/g;
  if (dependencyPattern.test(next)) {
    next = next.replace(dependencyPattern, "requireAuth: AuthMiddleware, db: AppDb");
    dependencyTyped = true;
  }

  const compositionPattern = /requireAuth:\s*unknown\s*,\s*db:\s*unknown/g;
  if (compositionPattern.test(next)) {
    next = next.replace(compositionPattern, "requireAuth: AuthMiddleware, db: AppDb");
    dependencyTyped = true;
  }

  if (!dependencyTyped) return source;
  next = addBoundaryImport(next, filePath);
  next = stripInferredCallbackAny(next);
  return next;
}

let changed = 0;
const changedFiles = [];
for (const filePath of walk(routeRoot)) {
  const rel = path.relative(routeRoot, filePath).replaceAll(path.sep, "/");
  if (!TARGET_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
  const source = fs.readFileSync(filePath, "utf8");
  const next = transformRouteFile(filePath, source);
  if (next === source) continue;
  fs.writeFileSync(filePath, next);
  changed += 1;
  changedFiles.push(`server/routes/${rel}`);
}

console.log(`Phase 2.3 boundary autofix changed ${changed} files.`);
for (const file of changedFiles) console.log(`- ${file}`);
