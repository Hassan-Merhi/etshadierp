#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const configFile = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
if (!configFile) throw new Error("tsconfig.json not found");
const rawConfig = ts.readConfigFile(configFile, ts.sys.readFile);
if (rawConfig.error) throw new Error(ts.flattenDiagnosticMessageText(rawConfig.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(rawConfig.config, ts.sys, path.dirname(configFile));
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const checker = program.getTypeChecker();

function useful(type) {
  if (!type) return false;
  const f = type.flags;
  return !(f & ts.TypeFlags.Any) && !(f & ts.TypeFlags.Unknown);
}

function anyShape(typeNode) {
  if (!typeNode) return false;
  if (typeNode.kind === ts.SyntaxKind.AnyKeyword) return true;
  return ts.isArrayTypeNode(typeNode) && typeNode.elementType.kind === ts.SyntaxKind.AnyKeyword;
}

function annotationStart(decl, sf) {
  const between = sf.text.slice(decl.name.end, decl.type.end);
  const colon = between.indexOf(":");
  return colon < 0 ? decl.type.pos : decl.name.end + colon;
}

function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword));
}

function variableIsExported(node) {
  const stmt = node.parent?.parent;
  return ts.isVariableStatement(stmt) && hasExportModifier(stmt);
}

function contextualParameterType(param) {
  const fn = param.parent;
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return undefined;
  const contextual = checker.getContextualType(fn);
  if (!contextual || !useful(contextual)) return undefined;
  const signatures = checker.getSignaturesOfType(contextual, ts.SignatureKind.Call);
  if (!signatures.length) return undefined;
  const index = fn.parameters.indexOf(param);
  for (const signature of signatures) {
    const params = signature.getParameters();
    if (!params.length) continue;
    const symbol = params[Math.min(index, params.length - 1)];
    const type = checker.getTypeOfSymbolAtLocation(symbol, param);
    if (useful(type)) return type;
  }
  return undefined;
}

function applyEdits(source, edits) {
  const ordered = edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let text = source;
  let lastStart = Infinity;
  for (const edit of ordered) {
    if (edit.end > lastStart) continue;
    text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
    lastStart = edit.start;
  }
  return text;
}

let touched = 0;
let removed = 0;
const kinds = new Map();

for (const sf of program.getSourceFiles()) {
  const rel = path.relative(root, sf.fileName).split(path.sep).join("/");
  if (!rel.startsWith("server/") || rel.endsWith(".d.ts")) continue;
  const edits = [];

  function add(start, end, replacement, kind) {
    if (start >= end) return;
    edits.push({ start, end, replacement, kind });
  }

  function visit(node) {
    if (ts.isParameter(node) && node.type && anyShape(node.type)) {
      const inferred = contextualParameterType(node);
      if (useful(inferred)) {
        add(annotationStart(node, sf), node.type.end, "", "contextual-callback");
        return;
      }
    }

    if (ts.isVariableDeclaration(node) && node.type && node.initializer && anyShape(node.type) && !variableIsExported(node)) {
      const inferred = checker.getTypeAtLocation(node.initializer);
      if (useful(inferred)) {
        add(annotationStart(node, sf), node.type.end, "", "local-inference");
        return;
      }
    }

    if (ts.isAsExpression(node)) {
      const directAny = node.type.kind === ts.SyntaxKind.AnyKeyword;
      const anyArray = ts.isArrayTypeNode(node.type) && node.type.elementType.kind === ts.SyntaxKind.AnyKeyword;
      if ((directAny || anyArray) && useful(checker.getTypeAtLocation(node.expression))) {
        add(node.getStart(sf), node.end, node.expression.getText(sf), directAny ? "redundant-as-any" : "redundant-as-any-array");
        return;
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(sf);

  if (!edits.length) continue;
  const original = fs.readFileSync(sf.fileName, "utf8");
  const next = applyEdits(original, edits);
  if (next === original) continue;
  fs.writeFileSync(sf.fileName, next);
  touched += 1;
  removed += edits.length;
  for (const edit of edits) kinds.set(edit.kind, (kinds.get(edit.kind) ?? 0) + 1);
}

console.log(`Phase 2.4 contextual inference pass removed ${removed} explicit escapes across ${touched} backend files.`);
for (const [kind, count] of [...kinds.entries()].sort()) console.log(`  ${kind}: ${count}`);
