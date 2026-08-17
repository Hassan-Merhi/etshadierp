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
const files = roots.flatMap((r) => walk(r)).sort();

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  return { code: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
function diagnosticsFiles(output) {
  const found = new Set();
  for (const m of output.matchAll(/^(.+?\.(?:ts|tsx))\(\d+,\d+\):\s+error\s+TS\d+:/gm)) {
    found.add(m[1].replace(/^\.\//, "").split(path.sep).join("/"));
  }
  return [...found];
}
function changedSourceFiles() {
  return run("git", ["diff", "--name-only", "--", ...roots]).output.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
function restore(paths) {
  for (let i = 0; i < paths.length; i += 100) run("git", ["restore", "--source=HEAD", "--", ...paths.slice(i, i + 100)]);
}

function transform(file, { session = true, handled = true } = {}) {
  let source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [];
  let sessionCount = 0;
  let handledCount = 0;
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      let receiver = node.expression;
      while (ts.isParenthesizedExpression(receiver)) receiver = receiver.expression;
      if (ts.isAsExpression(receiver) && receiver.type.kind === ts.SyntaxKind.AnyKeyword) {
        const inner = receiver.expression;
        if (handled && node.name.text === "_handledGlobally") {
          edits.push([receiver.getStart(sf), receiver.end, `${inner.getText(sf)} as { _handledGlobally?: boolean }`]);
          handledCount += 1;
        } else if (
          session &&
          ts.isPropertyAccessExpression(inner) &&
          inner.name.text === "session" &&
          ts.isIdentifier(inner.expression) &&
          inner.expression.text === "req"
        ) {
          edits.push([receiver.getStart(sf), receiver.end, inner.getText(sf)]);
          sessionCount += 1;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) {
    source = source.slice(0, start) + replacement + source.slice(end);
  }
  if (edits.length) fs.writeFileSync(file, source);
  return { sessionCount, handledCount };
}

let attemptedSession = 0;
let attemptedHandled = 0;
for (const file of files) {
  const result = transform(file);
  attemptedSession += result.sessionCount;
  attemptedHandled += result.handledCount;
}
console.log(`PHASE4_FAMILY_ATTEMPTED_SESSION=${attemptedSession}`);
console.log(`PHASE4_FAMILY_ATTEMPTED_HANDLED=${attemptedHandled}`);

let check = run("npm", ["run", "check"]);
if (check.code !== 0) {
  const changed = new Set(changedSourceFiles());
  const bad = diagnosticsFiles(check.output).filter((f) => changed.has(f));
  console.log(`PHASE4_FAMILY_DIRECT_FAILURE_FILES=${bad.length}`);
  restore(bad);
  for (const file of bad) transform(file, { session: false, handled: true });
  check = run("npm", ["run", "check"]);
  if (check.code !== 0) {
    const changed2 = new Set(changedSourceFiles());
    const bad2 = diagnosticsFiles(check.output).filter((f) => changed2.has(f));
    console.log(`PHASE4_FAMILY_HANDLED_FAILURE_FILES=${bad2.length}`);
    restore(bad2);
    check = run("npm", ["run", "check"]);
  }
}
if (check.code !== 0) {
  console.error(check.output);
  throw new Error("Phase 4 family pass did not restore TypeScript to green.");
}

let remaining = 0;
let remainingFiles = 0;
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let count = 0;
  const visit = (node) => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (count) remainingFiles += 1;
  remaining += count;
}
console.log(`PHASE4_FAMILY_CHANGED_FILES=${changedSourceFiles().length}`);
console.log(`PHASE4_FAMILY_REMAINING_AS_ANY=${remaining}`);
console.log(`PHASE4_FAMILY_REMAINING_FILES=${remainingFiles}`);
