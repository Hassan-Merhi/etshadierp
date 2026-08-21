#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { loadESLint } from "eslint";

const patterns = ["client/src/**/*.{ts,tsx}", "server/**/*.ts", "shared/**/*.ts"];
const ESLint = await loadESLint({ useFlatConfig: true });
const touched = new Set();

{
  const eslint = new ESLint({ fix: true });
  const results = await eslint.lintFiles(patterns);
  for (const result of results) if (result.output !== undefined) touched.add(result.filePath);
  await ESLint.outputFixes(results);
}

const eslint = new ESLint();
const results = await eslint.lintFiles(patterns);
const byFile = new Map();
for (const result of results) {
  const warnings = result.messages.filter((message) => message.severity === 1 && message.ruleId === "unused-imports/no-unused-vars");
  if (warnings.length) byFile.set(result.filePath, warnings);
}

function findIdentifierAt(sourceFile, line, column) {
  let match = null;
  function visit(node) {
    if (match) return;
    if (ts.isIdentifier(node)) {
      const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      if (pos.line === line - 1 && pos.character === column - 1) { match = node; return; }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return match;
}

let renamed = 0;
for (const [filePath, warnings] of byFile) {
  let source = fs.readFileSync(filePath, "utf8");
  const kind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, kind);
  const edits = [];
  for (const warning of warnings) {
    const node = findIdentifierAt(sourceFile, warning.line, warning.column);
    if (!node) throw new Error(`Unused identifier not found at ${filePath}:${warning.line}:${warning.column}`);
    const name = node.text;
    if (name.startsWith("_")) continue;
    let replacement = `_${name}`;
    const parent = node.parent;
    if (ts.isBindingElement(parent) && parent.name === node && ts.isObjectBindingPattern(parent.parent) && !parent.propertyName) replacement = `${name}: _${name}`;
    edits.push({ start: node.getStart(sourceFile), end: node.end, replacement });
    renamed++;
  }
  edits.sort((a,b)=>b.start-a.start);
  for (const edit of edits) source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end);
  fs.writeFileSync(filePath, source);
  touched.add(filePath);
}

if (touched.size) execFileSync(process.execPath, ["node_modules/prettier/bin/prettier.cjs", "--write", ...touched], { stdio: "inherit" });
console.log(`WAVE6_LINT_FIX renamed=${renamed} files=${byFile.size} formatted=${touched.size}`);
