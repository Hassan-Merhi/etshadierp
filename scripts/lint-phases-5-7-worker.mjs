#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const ROOTS = ["client/src", "server", "shared"];
const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
if (!configPath) throw new Error("tsconfig.json not found");
const configRead = ts.readConfigFile(configPath, ts.sys.readFile);
if (configRead.error) throw new Error(ts.flattenDiagnosticMessageText(configRead.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(configRead.config, ts.sys, path.dirname(configPath));
const sourceFiles = parsed.fileNames
  .map((f) => path.resolve(f))
  .filter((f) => /\.(?:ts|tsx)$/.test(f) && !f.endsWith(".d.ts") && ROOTS.some((r) => f.startsWith(path.resolve(r) + path.sep)));

function anyKeyword(node) { return node?.kind === ts.SyntaxKind.AnyKeyword; }
function render(original, edits) {
  let text = original;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.replacement + text.slice(e.end);
  return text;
}

function collect(sf) {
  const out = [];
  const seen = new Set();
  const add = (node, replacement, phase, kind) => {
    const start = node.getStart(sf);
    const end = node.end;
    const key = `${start}:${end}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ start, end, replacement, phase, kind });
  };
  const visit = (node) => {
    if (ts.isTypeReferenceNode(node) && node.typeName.getText(sf) === "Record" && node.typeArguments?.length === 2 && anyKeyword(node.typeArguments[1])) {
      add(node.typeArguments[1], "unknown", 5, "Record-value");
    }
    if (ts.isIndexSignatureDeclaration(node) && anyKeyword(node.type)) add(node.type, "unknown", 5, "index-signature");

    if (ts.isFunctionLike(node) && node.type) {
      if (anyKeyword(node.type)) add(node.type, "unknown", 6, "return-any");
      if (ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(sf) === "Promise" && node.type.typeArguments?.length === 1 && anyKeyword(node.type.typeArguments[0])) {
        add(node.type.typeArguments[0], "unknown", 6, "Promise-return");
      }
    }
    if (ts.isTypeReferenceNode(node) && node.typeArguments?.length) {
      const name = node.typeName.getText(sf);
      if (name !== "Record" && name !== "Array") {
        for (const arg of node.typeArguments) if (anyKeyword(arg)) add(arg, "unknown", 6, name === "Promise" ? "Promise-value" : `generic:${name}`);
      }
    }

    if (ts.isArrayTypeNode(node) && anyKeyword(node.elementType)) add(node.elementType, "unknown", 7, "any-array");
    if (ts.isTypeReferenceNode(node) && node.typeName.getText(sf) === "Array" && node.typeArguments?.length === 1 && anyKeyword(node.typeArguments[0])) {
      add(node.typeArguments[0], "unknown", 7, "Array-any");
    }
    if ((ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) && anyKeyword(node.type)) add(node.type, "unknown", 7, "model-field");
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const stats = { 5: 0, 6: 0, 7: 0 };
const kinds = new Map();
let changedFiles = 0;
for (const file of sourceFiles) {
  const original = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = collect(sf);
  if (!edits.length) continue;
  for (const e of edits) {
    stats[e.phase]++;
    const key = `${e.phase}:${e.kind}`;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
  }
  fs.writeFileSync(file, render(original, edits));
  changedFiles++;
}

const remaining = { 5: 0, 6: 0, 7: 0 };
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  for (const e of collect(sf)) remaining[e.phase]++;
}

console.log(`PHASE5_REMOVED=${stats[5]}`);
console.log(`PHASE6_REMOVED=${stats[6]}`);
console.log(`PHASE7_REMOVED=${stats[7]}`);
console.log(`CHANGED_FILES=${changedFiles}`);
console.log(`PHASE5_REMAINING=${remaining[5]}`);
console.log(`PHASE6_REMAINING=${remaining[6]}`);
console.log(`PHASE7_REMAINING=${remaining[7]}`);
for (const [k, v] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`${v}\t${k}`);
if (remaining[5] || remaining[6] || remaining[7]) process.exitCode = 2;
