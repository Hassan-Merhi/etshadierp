#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const configFile = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
if (!configFile) throw new Error("tsconfig.json not found");
const raw = ts.readConfigFile(configFile, ts.sys.readFile);
if (raw.error) throw new Error(ts.flattenDiagnosticMessageText(raw.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(configFile));

const counts = new Map();
const byFile = new Map();
const genericCalls = new Map();
const paramNames = new Map();
const paramNamesByRoot = new Map();
const examples = new Map();

const inc = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const addExample = (key, value) => {
  const values = examples.get(key) ?? [];
  if (values.length < 8 && !values.includes(value)) values.push(value);
  examples.set(key, values);
};

function category(node) {
  const parent = node.parent;
  if (!parent) return "orphan";
  if (ts.isParameter(parent) && parent.type === node) return "parameter-direct";
  if (ts.isPropertySignature(parent) && parent.type === node) return "interface-property-direct";
  if (ts.isPropertyDeclaration(parent) && parent.type === node) return "class-property-direct";
  if (ts.isVariableDeclaration(parent) && parent.type === node) return "variable-direct";
  if ((ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isArrowFunction(parent) || ts.isMethodDeclaration(parent)) && parent.type === node) return "return-direct";
  if (ts.isTypeAliasDeclaration(parent)) return "type-alias-direct";
  if (ts.isArrayTypeNode(parent)) return "array-element";
  if (ts.isUnionTypeNode(parent)) return "union-member";
  if (ts.isTupleTypeNode(parent)) return "tuple-member";
  if (ts.isIndexSignatureDeclaration(parent)) return "index-signature";
  if (ts.isTypeReferenceNode(parent)) {
    const name = parent.typeName.getText();
    return `type-argument:${name}`;
  }
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) return "call-type-argument";
  if (ts.isAsExpression(parent)) return "as-any";
  return `nested:${ts.SyntaxKind[parent.kind]}`;
}

for (const file of parsed.fileNames) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (rel.endsWith(".d.ts") || !(rel.startsWith("server/") || rel.startsWith("client/src/") || rel.startsWith("shared/"))) continue;
  const text = fs.readFileSync(file, "utf8");
  if (!/\bany\b/.test(text)) continue;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let fileCount = 0;
  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      fileCount += 1;
      const key = category(node);
      inc(counts, key);
      const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const line = sf.text.split(/\r?\n/)[pos.line]?.trim().slice(0, 180) ?? "";
      addExample(key, `${rel}:${pos.line + 1} ${line}`);

      const parent = node.parent;
      if (ts.isParameter(parent) && parent.type === node) {
        const name = ts.isIdentifier(parent.name) ? parent.name.text : parent.name.getText(sf);
        inc(paramNames, name);
        const rootName = rel.startsWith("server/") ? "server" : rel.startsWith("client/src/") ? "client" : "shared";
        inc(paramNamesByRoot, `${rootName}:${name}`);
      }
      if (ts.isTypeReferenceNode(parent)) inc(genericCalls, parent.typeName.getText());
      if (parent && (ts.isCallExpression(parent.parent) || ts.isNewExpression(parent.parent))) {
        inc(genericCalls, parent.parent.expression.getText(sf));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (fileCount) byFile.set(rel, fileCount);
}

console.log("PHASE4_CATEGORY_COUNTS");
for (const [key, value] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  console.log(`${value}\t${key}`);
}
console.log("PHASE4_PARAMETER_NAMES");
for (const [key, value] of [...paramNames.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 120)) {
  console.log(`${value}\t${key}`);
}
console.log("PHASE4_PARAMETER_NAMES_BY_ROOT");
for (const [key, value] of [...paramNamesByRoot.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 180)) {
  console.log(`${value}\t${key}`);
}
console.log("PHASE4_GENERIC_COUNTS");
for (const [key, value] of [...genericCalls.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 80)) {
  console.log(`${value}\t${key}`);
}
console.log("PHASE4_TOP_FILES");
for (const [key, value] of [...byFile.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 120)) {
  console.log(`${value}\t${key}`);
}
console.log("PHASE4_EXAMPLES");
for (const [key, values] of [...examples.entries()].sort((a, b) => (counts.get(b[0]) ?? 0) - (counts.get(a[0]) ?? 0)).slice(0, 30)) {
  console.log(`## ${key}`);
  for (const value of values) console.log(value);
}
