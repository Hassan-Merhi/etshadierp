#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
if (!configPath) throw new Error("tsconfig.json not found");
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const checker = program.getTypeChecker();

const TARGET_PREFIXES = ["server/", "shared/", "client/src/lib/"];

function rel(fileName) {
  return path.relative(root, fileName).split(path.sep).join("/");
}
function isTarget(relativePath) {
  return !relativePath.endsWith(".d.ts") && TARGET_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}
function typeNodeHasAny(node) {
  let found = false;
  const visit = (child) => {
    if (child.kind === ts.SyntaxKind.AnyKeyword) found = true;
    if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}
function unsafeType(type, depth = 0, seen = new Set()) {
  if (!type) return true;
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return true;
  if (seen.has(type) || depth > 3) return false;
  seen.add(type);
  if (type.isUnionOrIntersection?.()) return type.types.some((part) => unsafeType(part, depth + 1, seen));
  const args = checker.getTypeArguments?.(type) ?? [];
  if (args.some((arg) => unsafeType(arg, depth + 1, seen))) return true;
  const printed = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  return /(^|[^A-Za-z0-9_$])(any|unknown)([^A-Za-z0-9_$]|$)/.test(printed);
}
function isFunctionNode(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}
function nearestFunction(node) {
  for (let current = node.parent; current && !ts.isSourceFile(current); current = current.parent) {
    if (isFunctionNode(current)) return current;
  }
  return undefined;
}
function hasModifier(node, kind) {
  return Boolean(node?.modifiers?.some((modifier) => modifier.kind === kind));
}
function variableStatementForFunction(fn) {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return undefined;
  const parent = fn.parent;
  if (!ts.isVariableDeclaration(parent)) return undefined;
  return ts.isVariableDeclarationList(parent.parent) && ts.isVariableStatement(parent.parent.parent)
    ? parent.parent.parent
    : undefined;
}
function hasPublicInferredSurface(fn) {
  if (fn.type) return false;
  if (ts.isFunctionDeclaration(fn)) return hasModifier(fn, ts.SyntaxKind.ExportKeyword) || hasModifier(fn, ts.SyntaxKind.DefaultKeyword);
  if (ts.isMethodDeclaration(fn)) {
    if (hasModifier(fn, ts.SyntaxKind.PrivateKeyword)) return false;
    const cls = fn.parent;
    return ts.isClassDeclaration(cls) && (hasModifier(cls, ts.SyntaxKind.ExportKeyword) || hasModifier(cls, ts.SyntaxKind.DefaultKeyword));
  }
  const statement = variableStatementForFunction(fn);
  return statement ? hasModifier(statement, ts.SyntaxKind.ExportKeyword) : false;
}
function localContextIsStable(node) {
  const fn = nearestFunction(node);
  return Boolean(fn && !hasPublicInferredSurface(fn));
}
function contextualParameterType(param) {
  const fn = param.parent;
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return undefined;
  const contextual = checker.getContextualType(fn);
  if (!contextual) return undefined;
  const signatures = checker.getSignaturesOfType(contextual, ts.SignatureKind.Call);
  if (signatures.length !== 1) return undefined;
  const index = fn.parameters.indexOf(param);
  if (index < 0) return undefined;
  const symbol = signatures[0].parameters[index];
  return symbol ? checker.getTypeOfSymbolAtLocation(symbol, param) : undefined;
}
function collectOwnReturnExpressions(fn) {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return [fn.body];
  if (!fn.body) return [];
  const expressions = [];
  const visit = (node) => {
    if (node !== fn && isFunctionNode(node)) return;
    if (ts.isReturnStatement(node)) {
      if (node.expression) expressions.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return expressions;
}
function isExportedFunction(fn) {
  if (ts.isFunctionDeclaration(fn)) return hasModifier(fn, ts.SyntaxKind.ExportKeyword) || hasModifier(fn, ts.SyntaxKind.DefaultKeyword);
  if (ts.isMethodDeclaration(fn)) return !hasModifier(fn, ts.SyntaxKind.PrivateKeyword);
  const statement = variableStatementForFunction(fn);
  return statement ? hasModifier(statement, ts.SyntaxKind.ExportKeyword) : false;
}
function annotationStart(sourceFile, nameNode, typeNode) {
  const typeStart = typeNode.getStart(sourceFile);
  const colon = sourceFile.text.lastIndexOf(":", typeStart);
  return colon >= nameNode.end ? colon : typeStart;
}
function anyKeywordCount(sourceFile) {
  let count = 0;
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

const candidatesByFile = new Map();
const candidateReasons = new Map();
function addCandidate(sourceFile, start, end, text, reason) {
  const candidates = candidatesByFile.get(sourceFile.fileName) ?? [];
  candidates.push({ start, end, text, reason });
  candidatesByFile.set(sourceFile.fileName, candidates);
  candidateReasons.set(reason, (candidateReasons.get(reason) ?? 0) + 1);
}

for (const sourceFile of program.getSourceFiles()) {
  const relativePath = rel(sourceFile.fileName);
  if (!isTarget(relativePath)) continue;

  const visit = (node) => {
    // Concrete context already supplies the callback parameter type. This is
    // limited to callback expressions and never touches Express route req/res
    // declarations or exported API signatures.
    if (ts.isParameter(node) && node.type && typeNodeHasAny(node.type) && !node.questionToken) {
      if (ts.isArrowFunction(node.parent) || ts.isFunctionExpression(node.parent)) {
        const contextual = contextualParameterType(node);
        if (contextual && !unsafeType(contextual) && !hasPublicInferredSurface(node.parent)) {
          addCandidate(sourceFile, node.name.end, node.type.end, "", "contextual-callback");
        }
      }
    }

    // Local initialized variables can use concrete initializer inference. The
    // workflow's full tsc pass reverts an entire file if inference is too narrow.
    if (
      ts.isVariableDeclaration(node) &&
      localContextIsStable(node) &&
      node.type &&
      typeNodeHasAny(node.type) &&
      node.initializer
    ) {
      const inferred = checker.getTypeAtLocation(node.initializer);
      if (!unsafeType(inferred)) {
        addCandidate(sourceFile, annotationStart(sourceFile, node.name, node.type), node.type.end, "", "local-variable-inference");
      }
    }

    // A catch variable without ': any' is unknown under the strict compiler.
    // Files that do not already narrow it correctly are automatically reverted.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isCatchClause(node.parent) &&
      node.type?.kind === ts.SyntaxKind.AnyKeyword &&
      localContextIsStable(node)
    ) {
      addCandidate(sourceFile, annotationStart(sourceFile, node.name, node.type), node.type.end, "", "catch-unknown-narrowing");
    }

    // Return inference is only attempted for non-exported/private function
    // surfaces, with every direct return expression already concretely typed.
    if (isFunctionNode(node) && node.type && typeNodeHasAny(node.type) && node.body && !isExportedFunction(node)) {
      const returns = collectOwnReturnExpressions(node);
      if (returns.length > 0 && returns.every((expr) => !unsafeType(checker.getTypeAtLocation(expr)))) {
        const typeStart = node.type.getStart(sourceFile);
        const colon = sourceFile.text.lastIndexOf(":", typeStart);
        if (colon >= (node.parameters?.end ?? node.getStart(sourceFile))) {
          addCandidate(sourceFile, colon, node.type.end, "", "local-return-inference");
        }
      }
    }

    // A private initialized field may rely on its concrete initializer without
    // changing a class's public surface.
    if (
      ts.isPropertyDeclaration(node) &&
      hasModifier(node, ts.SyntaxKind.PrivateKeyword) &&
      node.type &&
      typeNodeHasAny(node.type) &&
      node.initializer
    ) {
      const inferred = checker.getTypeAtLocation(node.initializer);
      if (!unsafeType(inferred)) {
        addCandidate(sourceFile, annotationStart(sourceFile, node.name, node.type), node.type.end, "", "private-property-inference");
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

let modifiedFiles = 0;
let removedAnyKeywords = 0;
const details = [];
for (const [fileName, rawCandidates] of candidatesByFile) {
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) continue;
  const candidates = [...new Map(rawCandidates.map((candidate) => [`${candidate.start}:${candidate.end}`, candidate])).values()]
    .sort((a, b) => b.start - a.start || b.end - a.end);
  let updated = sourceFile.text;
  let lastStart = Infinity;
  let accepted = 0;
  for (const candidate of candidates) {
    if (candidate.end > lastStart) continue;
    updated = updated.slice(0, candidate.start) + candidate.text + updated.slice(candidate.end);
    lastStart = candidate.start;
    accepted += 1;
  }
  if (updated === sourceFile.text) continue;
  const before = anyKeywordCount(sourceFile);
  const reparsed = ts.createSourceFile(fileName, updated, ts.ScriptTarget.Latest, true, sourceFile.scriptKind);
  const after = anyKeywordCount(reparsed);
  if (after > before) throw new Error(`Type escape count increased in ${rel(fileName)}`);
  fs.writeFileSync(fileName, updated);
  modifiedFiles += 1;
  removedAnyKeywords += before - after;
  details.push({ path: rel(fileName), before, after, removed: before - after, candidates: accepted });
}

details.sort((a, b) => b.removed - a.removed || a.path.localeCompare(b.path));
console.log(JSON.stringify({
  modifiedFiles,
  removedAnyKeywords,
  candidateReasons: Object.fromEntries(candidateReasons),
  details,
}, null, 2));
