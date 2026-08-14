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

const originals = new Map();
const candidatesByFile = new Map();
let baseline = 0;
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  originals.set(file, source);
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const candidates = [];
  const visit = (node) => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      const tok = node.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.AsKeyword);
      if (tok) {
        const lc = sf.getLineAndCharacterOfPosition(tok.getStart(sf));
        candidates.push({
          id: `${file}:${tok.getStart(sf)}`,
          start: tok.getStart(sf),
          end: node.type.end,
          line: lc.line + 1,
          column: lc.character + 1,
          expr: node.expression.getText(sf).replace(/\s+/g, " ").slice(0, 120),
        });
        baseline += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (candidates.length) candidatesByFile.set(file, candidates);
}

const keep = new Set();
function renderFile(file) {
  let source = originals.get(file);
  const candidates = candidatesByFile.get(file) ?? [];
  for (const c of [...candidates].sort((a, b) => b.start - a.start)) {
    if (!keep.has(c.id)) source = source.slice(0, c.start) + source.slice(c.end);
  }
  fs.writeFileSync(file, source);
}
function renderAll() {
  for (const file of candidatesByFile.keys()) renderFile(file);
}
function parseDiagnostics(output) {
  const rows = [];
  for (const m of output.matchAll(/^(.+?\.(?:ts|tsx))\((\d+),(\d+)\):\s+error\s+TS(\d+):/gm)) {
    rows.push({ file: m[1].replace(/^\.\//, "").split(path.sep).join("/"), line: Number(m[2]), column: Number(m[3]), code: Number(m[4]) });
  }
  return rows;
}
function addNearby(diag, radius) {
  const candidates = (candidatesByFile.get(diag.file) ?? []).filter((c) => !keep.has(c.id));
  if (!candidates.length) return 0;
  const nearby = candidates.filter((c) => Math.abs(c.line - diag.line) <= radius);
  if (!nearby.length) return 0;
  for (const c of nearby) keep.add(c.id);
  return nearby.length;
}

console.log(`PHASE4_DIAGNOSTIC_BASELINE=${baseline}`);
let passed = false;
for (let iteration = 1; iteration <= 14; iteration++) {
  renderAll();
  const check = run("npm", ["run", "check"]);
  if (check.code === 0) {
    console.log(`PHASE4_DIAGNOSTIC_TSC_PASSES=${iteration}`);
    passed = true;
    break;
  }
  const diagnostics = parseDiagnostics(check.output);
  let added = 0;
  for (const diag of diagnostics) added += addNearby(diag, 0);
  if (!added) for (const diag of diagnostics) added += addNearby(diag, 1);
  if (!added) for (const diag of diagnostics) added += addNearby(diag, 3);
  if (!added) {
    const diagnosticFiles = [...new Set(diagnostics.map((d) => d.file))];
    for (const file of diagnosticFiles) {
      for (const c of candidatesByFile.get(file) ?? []) {
        if (!keep.has(c.id)) { keep.add(c.id); added += 1; }
      }
    }
  }
  if (!added) {
    // Cross-module fallout: restore the smallest changed source file cluster that
    // could have exported a newly-narrowed inferred type, then continue.
    const available = [...candidatesByFile.entries()]
      .map(([file, cs]) => [file, cs.filter((c) => !keep.has(c.id))])
      .filter(([, cs]) => cs.length)
      .sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));
    if (available.length) {
      const [file, cs] = available[0];
      for (const c of cs) keep.add(c.id);
      added += cs.length;
      console.log(`Pass ${iteration}: cross-module fallback restored ${cs.length} cast(s) in ${file}.`);
    }
  }
  console.log(`Pass ${iteration}: diagnostics=${diagnostics.length}, restored=${added}, kept_total=${keep.size}`);
  if (!added) {
    console.error(check.output);
    break;
  }
}

renderAll();
const finalCheck = run("npm", ["run", "check"]);
if (finalCheck.code !== 0) {
  console.error(finalCheck.output);
  throw new Error("Diagnostic-guided Phase 4 pass did not reach a green TypeScript state.");
}

const remaining = keep.size;
console.log(`PHASE4_DIAGNOSTIC_REMOVED=${baseline - remaining}`);
console.log(`PHASE4_DIAGNOSTIC_REMAINING=${remaining}`);
console.log("=== REQUIRED CAST SAMPLE ===");
let shown = 0;
for (const [file, candidates] of candidatesByFile) {
  for (const c of candidates) {
    if (!keep.has(c.id)) continue;
    console.log(`${file}:${c.line}:${c.column}\t${c.expr}`);
    shown += 1;
    if (shown >= 300) break;
  }
  if (shown >= 300) break;
}
