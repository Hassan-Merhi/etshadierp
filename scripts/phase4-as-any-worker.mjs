#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const roots = ["client/src", "server", "shared"];
const exts = new Set([".ts", ".tsx"]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (exts.has(path.extname(entry.name)) && !entry.name.endsWith(".d.ts")) out.push(p.split(path.sep).join("/"));
  }
  return out;
}

const files = roots.flatMap((root) => walk(root)).sort();

function asAnySpans(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const spans = [];
  const visit = (node) => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      const asToken = node.getChildren(sf).find((child) => child.kind === ts.SyntaxKind.AsKeyword);
      if (asToken) spans.push([asToken.getStart(sf), node.type.end]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return spans;
}

function countAsAny() {
  let total = 0;
  const byFile = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const n = asAnySpans(file, source).length;
    if (n) byFile.push([file, n]);
    total += n;
  }
  byFile.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { total, byFile };
}

function stripAllInFile(file) {
  const source = fs.readFileSync(file, "utf8");
  const spans = asAnySpans(file, source);
  if (!spans.length) return 0;
  let next = source;
  for (const [start, end] of spans.sort((a, b) => b[0] - a[0])) {
    next = next.slice(0, start) + next.slice(end);
  }
  if (next !== source) fs.writeFileSync(file, next);
  return spans.length;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function changedSourceFiles() {
  const r = run("git", ["diff", "--name-only", "--", ...roots]);
  return r.output.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function restore(paths) {
  if (!paths.length) return;
  for (let i = 0; i < paths.length; i += 100) run("git", ["restore", "--source=HEAD", "--", ...paths.slice(i, i + 100)]);
}

function diagnosticsFiles(output) {
  const found = new Set();
  for (const m of output.matchAll(/^(.+?\.(?:ts|tsx))\(\d+,\d+\):\s+error\s+TS\d+:/gm)) {
    found.add(m[1].replace(/^\.\//, "").split(path.sep).join("/"));
  }
  return [...found];
}

const baseline = countAsAny();
console.log(`PHASE4_BASELINE_AS_ANY=${baseline.total}`);
console.log(`PHASE4_BASELINE_FILES=${baseline.byFile.length}`);
console.log("Top baseline files:");
for (const [file, n] of baseline.byFile.slice(0, 30)) console.log(`${n}\t${file}`);

let removedAttempted = 0;
for (const [file] of baseline.byFile) removedAttempted += stripAllInFile(file);
console.log(`Attempted to remove ${removedAttempted} AST-confirmed as-any assertions.`);

let iteration = 0;
let lastOutput = "";
while (iteration < 30) {
  iteration += 1;
  const check = run("npm", ["run", "check"]);
  lastOutput = check.output;
  if (check.code === 0) {
    console.log(`TypeScript passed after ${iteration} pass(es).`);
    break;
  }

  const changed = new Set(changedSourceFiles());
  const diag = diagnosticsFiles(check.output);
  const directlyBad = diag.filter((f) => changed.has(f));
  console.log(`TypeScript pass ${iteration} failed: ${diag.length} diagnostic files; ${directlyBad.length} changed diagnostic files.`);

  if (directlyBad.length) {
    console.log("Restoring directly failing changed files:");
    for (const f of directlyBad.slice(0, 80)) console.log(`  ${f}`);
    restore(directlyBad);
    continue;
  }

  const remainingChanged = [...changed];
  if (!remainingChanged.length) {
    console.error(check.output);
    throw new Error("Baseline TypeScript check failed with no source changes; refusing to continue.");
  }

  // Cross-module diagnostics can point at consumers rather than the changed producer.
  // Conservatively restore one directory cluster at a time, starting with the cluster
  // containing the most changed files, until diagnostics become attributable again.
  const clusters = new Map();
  for (const f of remainingChanged) {
    const parts = f.split("/");
    const key = parts.slice(0, Math.min(parts.length - 1, 4)).join("/");
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(f);
  }
  const [, cluster] = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
  console.log(`No diagnostic landed in a changed file; conservatively restoring ${cluster.length} files from the largest changed cluster.`);
  restore(cluster);
}

const finalCheck = run("npm", ["run", "check"]);
if (finalCheck.code !== 0) {
  console.error(finalCheck.output || lastOutput);
  throw new Error("TypeScript is still red after conservative restoration.");
}

const changedBeforeFormat = changedSourceFiles();
if (changedBeforeFormat.length) {
  for (let i = 0; i < changedBeforeFormat.length; i += 80) {
    const chunk = changedBeforeFormat.slice(i, i + 80);
    const fmt = run("node", ["node_modules/prettier/bin/prettier.cjs", "--write", ...chunk]);
    if (fmt.code !== 0) {
      console.error(fmt.output);
      throw new Error("Prettier failed on Phase 4 changed files.");
    }
  }
}

const postFormatCheck = run("npm", ["run", "check"]);
if (postFormatCheck.code !== 0) {
  console.error(postFormatCheck.output);
  throw new Error("TypeScript failed after formatting Phase 4 changes.");
}

const after = countAsAny();
const changedFinal = changedSourceFiles();
console.log(`PHASE4_AFTER_MECHANICAL_AS_ANY=${after.total}`);
console.log(`PHASE4_REMOVED_MECHANICALLY=${baseline.total - after.total}`);
console.log(`PHASE4_CHANGED_FILES=${changedFinal.length}`);
console.log(`PHASE4_REMAINING_FILES=${after.byFile.length}`);
console.log("Top semantic remainder files:");
for (const [file, n] of after.byFile.slice(0, 80)) console.log(`${n}\t${file}`);

if (after.total >= baseline.total) {
  console.log("No mechanically safe as-any casts were removed.");
}
