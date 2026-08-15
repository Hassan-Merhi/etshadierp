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

const stats = { 5: 0, 6: 0, 7: 0 };
const kinds = new Map();
let changedFiles = 0;

for (const file of sourceFiles) {
  const original = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [];
  const seen = new Set();
  const add = (start, end, replacement, phase, kind) => {
    const key = `${start}:${end}`;
    if (seen.has(key)) return;
    seen.add(key);
    edits.push({ start, end, replacement, phase, kind });
  };

  const visit = (node) => {
    // Phase 5: dynamic object/API map shapes.
    if (ts.isTypeReferenceNode(node) && node.typeName.getText(sf) === "Record" && node.typeArguments?.length === 2 && anyKeyword(node.typeArguments[1])) {
      add(node.typeArguments[1].getStart(sf), node.typeArguments[1].end, "unknown", 5, "Record-value");
    }
    if (ts.isIndexSignatureDeclaration(node) && anyKeyword(node.type)) {
      add(node.type.getStart(sf), node.type.end, "unknown", 5, "index-signature");
    }

    // Phase 6: explicit Promise/return/generic any.
    if (ts.isFunctionLike(node) && node.type) {
      const colon = node.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.ColonToken && c.end <= node.type.getStart(sf));
      if (anyKeyword(node.type) && colon) add(colon.getStart(sf), node.type.end, "", 6, "return-infer");
      if (ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(sf) === "Promise" && node.type.typeArguments?.length === 1 && anyKeyword(node.type.typeArguments[0])) {
        if (colon) add(colon.getStart(sf), node.type.end, "", 6, "promise-return-infer");
        else add(node.type.typeArguments[0].getStart(sf), node.type.typeArguments[0].end, "unknown", 6, "Promise-value");
      }
    }
    if (ts.isTypeReferenceNode(node) && node.typeArguments?.length) {
      const name = node.typeName.getText(sf);
      if (name !== "Record" && name !== "Promise" && name !== "Array") {
        for (const arg of node.typeArguments) if (anyKeyword(arg)) add(arg.getStart(sf), arg.end, "unknown", 6, `generic:${name}`);
      }
    }

    // Phase 7: arrays, interface/model fields.
    if (ts.isArrayTypeNode(node) && anyKeyword(node.elementType)) {
      add(node.elementType.getStart(sf), node.elementType.end, "unknown", 7, "any-array");
    }
    if (ts.isTypeReferenceNode(node) && node.typeName.getText(sf) === "Array" && node.typeArguments?.length === 1 && anyKeyword(node.typeArguments[0])) {
      add(node.typeArguments[0].getStart(sf), node.typeArguments[0].end, "unknown", 7, "Array-any");
    }
    if ((ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) && anyKeyword(node.type)) {
      add(node.type.getStart(sf), node.type.end, "unknown", 7, "model-field");
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!edits.length) continue;
  for (const e of edits) {
    stats[e.phase]++;
    const key = `${e.phase}:${e.kind}`;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
  }
  fs.writeFileSync(file, render(original, edits));
  changedFiles++;
}

console.log(`PHASE5_REMOVED=${stats[5]}`);
console.log(`PHASE6_REMOVED=${stats[6]}`);
console.log(`PHASE7_REMOVED=${stats[7]}`);
console.log(`CHANGED_FILES=${changedFiles}`);
for (const [k, v] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`${v}\t${k}`);
