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
function isFunctionNode(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}
function hasFunctionAncestor(node) {
  for (let current = node.parent; current && !ts.isSourceFile(current); current = current.parent) {
    if (isFunctionNode(current)) return true;
  }
  return false;
}
function isExported(node) {
  const statement = ts.isVariableDeclaration(node) ? node.parent?.parent : node;
  return Boolean(statement?.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword));
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
function addCandidate(sourceFile, start, end, text, reason) {
  const candidates = candidatesByFile.get(sourceFile.fileName) ?? [];
  candidates.push({ start, end, text, reason });
  candidatesByFile.set(sourceFile.fileName, candidates);
}

for (const sourceFile of program.getSourceFiles()) {
  const relativePath = rel(sourceFile.fileName);
  if (!isTarget(relativePath)) continue;

  const visit = (node) => {
    // Callback annotations are safe to remove only when a concrete contextual
    // parameter type already exists. The compiler gate below verifies body use.
    if (ts.isParameter(node) && node.type && typeNodeHasAny(node.type) && !node.questionToken) {
      if (ts.isArrowFunction(node.parent) || ts.isFunctionExpression(node.parent)) {
        const contextual = contextualParameterType(node);
        if (contextual && !unsafeType(contextual)) {
          addCandidate(sourceFile, node.name.end, node.type.end, "", "contextual-callback");
        }
      }
    }

    // Local initialized variables may drop an explicit escape when their
    // initializer already has a concrete type. Empty arrays/objects are not
    // special-cased: the per-file compiler gate rejects bad never[]/narrowing.
    if (
      ts.isVariableDeclaration(node) &&
      hasFunctionAncestor(node) &&
      node.type &&
      typeNodeHasAny(node.type) &&
      node.initializer
    ) {
      const inferred = checker.getTypeAtLocation(node.initializer);
      if (!unsafeType(inferred)) {
        addCandidate(sourceFile, annotationStart(sourceFile, node.name, node.type), node.type.end, "", "local-variable-inference");
      }
    }

    // Catch variables become unknown under the repo's strict compiler config;
    // only catches whose bodies already narrow/use that safely survive the gate.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isCatchClause(node.parent) &&
      node.type?.kind === ts.SyntaxKind.AnyKeyword
    ) {
      addCandidate(sourceFile, annotationStart(sourceFile, node.name, node.type), node.type.end, "", "catch-unknown-narrowing");
    }

    // Non-exported/local return annotations can rely on concrete inference.
    if (isFunctionNode(node) && node.type && typeNodeHasAny(node.type) && node.body && (hasFunctionAncestor(node) || !isExported(node))) {
      const returns = collectOwnReturnExpressions(node);
      if (returns.length > 0 && returns.every((expr) => !unsafeType(checker.getTypeAtLocation(expr)))) {
        const fallback = node.parameters?.end ?? node.getStart(sourceFile);
        const typeStart = node.type.getStart(sourceFile);
        const colon = sourceFile.text.lastIndexOf(":", typeStart);
        if (colon >= fallback) addCandidate(sourceFile, colon, node.type.end, "", "local-return-inference");
      }
    }

    // Remove only casts where the underlying expression itself is already
    // concrete. The compiler gate confirms the surrounding use still accepts it.
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      const originalType = checker.getTypeAtLocation(node.expression);
      if (!unsafeType(originalType)) addCandidate(sourceFile, node.expression.end, node.end, "", "redundant-as-any");
    }

    // Private initialized properties cannot alter a public API surface.
    if (
      ts.isPropertyDeclaration(node) &&
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword) &&
      node.type &&
      typeNodeHasAny(node.type) &&
      node.initializer
    ) {
      const inferred = checker.getTypeAtLocation(node.initializer);
      if (!unsafeType(inferred)) addCandidate(sourceFile, annotationStart(sourceFile, node.name, node.type), node.type.end, "", "private-property-inference");
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

// Keep a single incremental language service alive while evaluating candidates.
// This makes the codemod self-filtering: a mechanical edit is accepted only if
// the changed file remains syntactically and semantically clean.
const overrides = new Map();
const versions = new Map();
const snapshots = new Map();
const host = {
  getScriptFileNames: () => parsed.fileNames,
  getScriptVersion: (fileName) => String(versions.get(fileName) ?? 0),
  getScriptSnapshot: (fileName) => {
    if (overrides.has(fileName)) return ts.ScriptSnapshot.fromString(overrides.get(fileName));
    if (snapshots.has(fileName)) return snapshots.get(fileName);
    if (!ts.sys.fileExists(fileName)) return undefined;
    const snapshot = ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName) ?? "");
    snapshots.set(fileName, snapshot);
    return snapshot;
  },
  getCurrentDirectory: () => root,
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
  realpath: ts.sys.realpath,
};
const languageService = ts.createLanguageService(host, ts.createDocumentRegistry());

function applyEdits(original, edits) {
  let updated = original;
  let lastStart = Infinity;
  for (const edit of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    if (edit.end > lastStart) continue;
    updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end);
    lastStart = edit.start;
  }
  return updated;
}
function diagnosticsFor(fileName, text) {
  overrides.set(fileName, text);
  versions.set(fileName, (versions.get(fileName) ?? 0) + 1);
  return [
    ...languageService.getSyntacticDiagnostics(fileName),
    ...languageService.getSemanticDiagnostics(fileName),
  ];
}

let modifiedFiles = 0;
let removedAnyKeywords = 0;
let rejectedCandidates = 0;
const acceptedReasons = new Map();
const rejectedReasons = new Map();
const details = [];

for (const [fileName, rawCandidates] of candidatesByFile) {
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) continue;
  const original = sourceFile.text;
  const baselineDiagnostics = diagnosticsFor(fileName, original);
  if (baselineDiagnostics.length > 0) {
    rejectedCandidates += rawCandidates.length;
    rejectedReasons.set("preexisting-diagnostics", (rejectedReasons.get("preexisting-diagnostics") ?? 0) + rawCandidates.length);
    continue;
  }

  const unique = [...new Map(rawCandidates.map((candidate) => [`${candidate.start}:${candidate.end}`, candidate])).values()]
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const accepted = [];
  for (const candidate of unique) {
    const overlaps = accepted.some((edit) => candidate.start < edit.end && candidate.end > edit.start);
    if (overlaps) {
      rejectedCandidates += 1;
      rejectedReasons.set("overlap", (rejectedReasons.get("overlap") ?? 0) + 1);
      continue;
    }
    const trial = applyEdits(original, [...accepted, candidate]);
    const diagnostics = diagnosticsFor(fileName, trial);
    if (diagnostics.length === 0) {
      accepted.push(candidate);
      acceptedReasons.set(candidate.reason, (acceptedReasons.get(candidate.reason) ?? 0) + 1);
    } else {
      rejectedCandidates += 1;
      rejectedReasons.set(candidate.reason, (rejectedReasons.get(candidate.reason) ?? 0) + 1);
    }
  }

  const updated = applyEdits(original, accepted);
  overrides.set(fileName, updated);
  versions.set(fileName, (versions.get(fileName) ?? 0) + 1);
  if (updated === original) continue;

  const before = anyKeywordCount(sourceFile);
  const reparsed = ts.createSourceFile(fileName, updated, ts.ScriptTarget.Latest, true, sourceFile.scriptKind);
  const after = anyKeywordCount(reparsed);
  if (after > before) throw new Error(`Type escape count increased in ${rel(fileName)}`);
  fs.writeFileSync(fileName, updated);
  modifiedFiles += 1;
  removedAnyKeywords += before - after;
  details.push({ path: rel(fileName), before, after, removed: before - after, accepted: accepted.length });
}

details.sort((a, b) => b.removed - a.removed || a.path.localeCompare(b.path));
console.log(JSON.stringify({
  modifiedFiles,
  removedAnyKeywords,
  rejectedCandidates,
  acceptedReasons: Object.fromEntries(acceptedReasons),
  rejectedReasons: Object.fromEntries(rejectedReasons),
  details,
}, null, 2));
