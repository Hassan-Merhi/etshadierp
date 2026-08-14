#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
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

function outer(node) {
  let current = node;
  while (current.parent && ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return current;
}

function contextOf(node) {
  const wrapped = outer(node);
  const p = wrapped.parent;
  if (!p) return "root";
  if (ts.isPropertyAccessExpression(p) && p.expression === wrapped) return `property-receiver:.${p.name.text}`;
  if (ts.isElementAccessExpression(p) && p.expression === wrapped) return "element-receiver";
  if (ts.isCallExpression(p) && p.expression === wrapped) return "call-receiver";
  if (ts.isNewExpression(p) && p.expression === wrapped) return "new-receiver";
  if (ts.isCallExpression(p) && p.arguments.includes(wrapped)) return "call-argument";
  if (ts.isNewExpression(p) && p.arguments?.includes(wrapped)) return "new-argument";
  if (ts.isVariableDeclaration(p) && p.initializer === wrapped) return "variable-initializer";
  if (ts.isPropertyAssignment(p) && p.initializer === wrapped) return "object-property-initializer";
  if (ts.isJsxExpression(p)) return "jsx-expression";
  if (ts.isReturnStatement(p)) return "return-expression";
  if (ts.isArrayLiteralExpression(p)) return "array-element";
  if (ts.isSpreadElement(p)) return "spread-element";
  if (ts.isSpreadAssignment(p)) return "spread-assignment";
  if (ts.isBinaryExpression(p)) return p.right === wrapped ? `binary-rhs:${ts.tokenToString(p.operatorToken.kind) ?? p.operatorToken.kind}` : `binary-lhs:${ts.tokenToString(p.operatorToken.kind) ?? p.operatorToken.kind}`;
  if (ts.isConditionalExpression(p)) return "conditional-part";
  if (ts.isTemplateSpan(p)) return "template-span";
  if (ts.isAsExpression(p)) return `chained-as:${p.type.getText()}`;
  if (ts.isTypeAssertionExpression(p)) return "type-assertion-parent";
  if (ts.isAwaitExpression(p)) return "await-expression";
  if (ts.isPrefixUnaryExpression(p)) return `prefix:${ts.tokenToString(p.operator) ?? p.operator}`;
  return ts.SyntaxKind[p.kind] ?? `kind-${p.kind}`;
}

const files = roots.flatMap((root) => walk(root)).sort();
const contexts = new Map();
const expressionKinds = new Map();
const receiverProps = new Map();
const identifierNames = new Map();
const samples = new Map();
const perFile = [];
let total = 0;

function bump(map, key, n = 1) { map.set(key, (map.get(key) ?? 0) + n); }
function sample(key, value) {
  if (!samples.has(key)) samples.set(key, []);
  if (samples.get(key).length < 6) samples.get(key).push(value);
}

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let fileCount = 0;
  const visit = (node) => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      total += 1;
      fileCount += 1;
      const context = contextOf(node);
      bump(contexts, context);
      const kind = ts.SyntaxKind[node.expression.kind] ?? String(node.expression.kind);
      bump(expressionKinds, kind);
      if (ts.isIdentifier(node.expression)) bump(identifierNames, node.expression.text);
      const wrapped = outer(node);
      const p = wrapped.parent;
      if (p && ts.isPropertyAccessExpression(p) && p.expression === wrapped) bump(receiverProps, p.name.text);
      const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const text = node.getText(sf).replace(/\s+/g, " ").slice(0, 180);
      sample(context.split(":")[0], `${file}:${pos.line + 1}  ${text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (fileCount) perFile.push([file, fileCount]);
}

function printTop(title, map, limit = 80) {
  console.log(`\n${title}`);
  for (const [key, value] of [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit)) {
    console.log(`${value}\t${key}`);
  }
}

console.log(`PHASE4_SEMANTIC_AS_ANY=${total}`);
console.log(`PHASE4_SEMANTIC_FILES=${perFile.length}`);
printTop("CONTEXT_COUNTS", contexts, 120);
printTop("EXPRESSION_KIND_COUNTS", expressionKinds, 60);
printTop("PROPERTY_RECEIVER_NAMES", receiverProps, 120);
printTop("IDENTIFIER_EXPRESSION_NAMES", identifierNames, 100);
console.log("\nSAMPLES_BY_CONTEXT");
for (const [key, values] of [...samples.entries()].sort()) {
  console.log(`\n[${key}]`);
  for (const value of values) console.log(value);
}
console.log("\nTOP_FILES");
for (const [file, n] of perFile.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 120)) console.log(`${n}\t${file}`);
