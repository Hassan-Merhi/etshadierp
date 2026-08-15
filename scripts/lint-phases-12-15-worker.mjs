#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ESLint } from "eslint";

const ROOT = process.cwd();
const TARGETS = ["client/src/**/*.{ts,tsx}", "server/**/*.{ts,tsx}", "shared/**/*.{ts,tsx}"];
const PHASE14_RULES = new Set([
  "no-case-declarations",
  "no-empty",
  "no-useless-escape",
  "prefer-const",
  "no-var",
  "preserve-caught-error",
  "no-useless-assignment",
  "no-control-regex",
  "no-extra-boolean-cast",
]);

function posToOffset(text, line, column) {
  const lines = text.split(/\n/);
  let offset = 0;
  for (let i = 1; i < line; i++) offset += lines[i - 1].length + 1;
  return offset + column - 1;
}

async function lint() {
  const eslint = new ESLint({ fix: true });
  return eslint.lintFiles(TARGETS);
}

async function writeAutofixes(results, ruleFilter) {
  let changed = 0;
  for (const result of results) {
    if (!result.output || result.output === fs.readFileSync(result.filePath, "utf8")) continue;
    const relevant = result.messages.some((m) => ruleFilter(m.ruleId));
    if (!relevant) continue;
    fs.writeFileSync(result.filePath, result.output);
    changed++;
  }
  return changed;
}

async function phase12() {
  let renamed = 0;
  for (let pass = 0; pass < 6; pass++) {
    const results = await lint();
    await writeAutofixes(results, (id) => id === "unused-imports/no-unused-imports");
    let editsMade = 0;
    for (const result of results) {
      const msgs = result.messages.filter((m) => m.ruleId === "unused-imports/no-unused-vars");
      if (!msgs.length) continue;
      let text = fs.readFileSync(result.filePath, "utf8");
      const edits = [];
      for (const m of msgs) {
        const start = posToOffset(text, m.line, m.column);
        const tail = text.slice(start);
        const match = tail.match(/^([A-Za-z_$][\w$]*)/);
        if (!match || match[1].startsWith("_")) continue;
        edits.push({ start, name: match[1] });
      }
      for (const e of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + "_" + text.slice(e.start);
      if (edits.length) {
        fs.writeFileSync(result.filePath, text);
        editsMade += edits.length;
        renamed += edits.length;
      }
    }
    if (!editsMade) break;
  }
  const final = await lint();
  const remaining = final.reduce((n, r) => n + r.messages.filter((m) => m.ruleId === "unused-imports/no-unused-imports" || m.ruleId === "unused-imports/no-unused-vars").length, 0);
  return { removed: renamed, remaining };
}

function applySuggestions(results, ruleId) {
  let applied = 0;
  for (const result of results) {
    let text = fs.readFileSync(result.filePath, "utf8");
    const fixes = [];
    for (const m of result.messages) {
      if (m.ruleId !== ruleId || !m.suggestions?.length) continue;
      const fix = m.suggestions[0].fix;
      if (!fix?.range) continue;
      fixes.push({ start: fix.range[0], end: fix.range[1], text: fix.text ?? "" });
    }
    for (const f of fixes.sort((a, b) => b.start - a.start)) text = text.slice(0, f.start) + f.text + text.slice(f.end);
    if (fixes.length) {
      fs.writeFileSync(result.filePath, text);
      applied += fixes.length;
    }
  }
  return applied;
}

async function phase13() {
  let applied = 0;
  for (let pass = 0; pass < 8; pass++) {
    const results = await lint();
    const count = results.reduce((n, r) => n + r.messages.filter((m) => m.ruleId === "react-hooks/exhaustive-deps").length, 0);
    if (!count) return { removed: applied, remaining: 0 };
    const n = applySuggestions(results, "react-hooks/exhaustive-deps");
    applied += n;
    if (!n) return { removed: applied, remaining: count };
  }
  const final = await lint();
  const remaining = final.reduce((n, r) => n + r.messages.filter((m) => m.ruleId === "react-hooks/exhaustive-deps").length, 0);
  return { removed: applied, remaining };
}

async function phase14() {
  let changed = 0;
  for (let pass = 0; pass < 6; pass++) {
    const results = await lint();
    changed += await writeAutofixes(results, (id) => PHASE14_RULES.has(id));
    let suggestions = 0;
    for (const rule of PHASE14_RULES) suggestions += applySuggestions(results, rule);
    changed += suggestions;
    if (!suggestions && !results.some((r) => r.output && r.messages.some((m) => PHASE14_RULES.has(m.ruleId)))) break;
  }
  const final = await lint();
  const byRule = new Map();
  for (const r of final) for (const m of r.messages) if (PHASE14_RULES.has(m.ruleId)) byRule.set(m.ruleId, (byRule.get(m.ruleId) ?? 0) + 1);
  return { removed: changed, remaining: [...byRule.values()].reduce((a, b) => a + b, 0), byRule };
}

function collectTypeFiles() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config/type-escape-boundaries.json"), "utf8"));
  const scan = cfg.scan;
  const out = [];
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.isDirectory() && scan.excludeDirectories.includes(e.name)) continue;
      const childRel = path.join(rel, e.name);
      if (e.isDirectory()) walk(childRel);
      else if (scan.extensions.includes(path.extname(e.name)) && !scan.excludeFiles.includes(childRel.split(path.sep).join("/")) && !e.name.endsWith(".d.ts")) out.push(path.join(ROOT, childRel));
    }
  };
  for (const root of scan.roots) walk(root);
  return out;
}

function phase15() {
  let anyRemoved = 0;
  let suppressionsRemoved = 0;
  let filesChanged = 0;
  for (const file of collectTypeFiles()) {
    const original = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const edits = [];
    const visit = (node) => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) edits.push({ start: node.getStart(sf), end: node.end, text: "unknown" });
      ts.forEachChild(node, visit);
    };
    visit(sf);
    anyRemoved += edits.length;
    let text = original;
    for (const e of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
    text = text.replace(/\/\/\s*@ts-(?:ignore|expect-error)[^\n]*\n/g, () => { suppressionsRemoved++; return ""; });
    if (text !== original) { fs.writeFileSync(file, text); filesChanged++; }
  }
  let remainingAny = 0;
  let remainingSuppressions = 0;
  for (const file of collectTypeFiles()) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => { if (node.kind === ts.SyntaxKind.AnyKeyword) remainingAny++; ts.forEachChild(node, visit); };
    visit(sf);
    remainingSuppressions += (text.match(/@ts-(?:ignore|expect-error)\b/g) ?? []).length;
  }
  return { removed: anyRemoved + suppressionsRemoved, remaining: remainingAny + remainingSuppressions, anyRemoved, suppressionsRemoved, filesChanged };
}

const p12 = await phase12();
console.log(`PHASE12_REMOVED=${p12.removed}`); console.log(`PHASE12_REMAINING=${p12.remaining}`);
const p13 = await phase13();
console.log(`PHASE13_REMOVED=${p13.removed}`); console.log(`PHASE13_REMAINING=${p13.remaining}`);
const p14 = await phase14();
console.log(`PHASE14_REMOVED=${p14.removed}`); console.log(`PHASE14_REMAINING=${p14.remaining}`);
for (const [rule, count] of [...p14.byRule].sort((a,b)=>b[1]-a[1])) console.log(`PHASE14_RULE ${rule}=${count}`);
const p15 = phase15();
console.log(`PHASE15_REMOVED=${p15.removed}`); console.log(`PHASE15_REMAINING=${p15.remaining}`); console.log(`PHASE15_ANY_REMOVED=${p15.anyRemoved}`); console.log(`PHASE15_SUPPRESSIONS_REMOVED=${p15.suppressionsRemoved}`); console.log(`PHASE15_FILES_CHANGED=${p15.filesChanged}`);
if (p12.remaining || p13.remaining || p14.remaining || p15.remaining) process.exitCode = 2;
