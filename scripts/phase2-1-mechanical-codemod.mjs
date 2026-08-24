#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
if (!configPath) throw new Error("tsconfig.json not found");

const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
}
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const checker = program.getTypeChecker();

const TARGET_PREFIXES = ["server/", "shared/", "client/src/lib/"];

const EXPRESS_PARAM_TYPES = new Map([
  ["req", "import(\"express\").Request"],
  ["request", "import(\"express\").Request"],
  ["res", "import(\"express\").Response"],
  ["response", "import(\"express\").Response"],
  ["next", "import(\"express\").NextFunction"],
]);

function rel(fileName) {
  return path.relative(root, fileName).split(path.sep).join("/");
}

function isTarget(relativePath) {
  if (relativePath.endsWith(".d.ts")) return false;
  return TARGET_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function isAnyOrUnknown(type) {
  if (!type) return true;
  return Boolean(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown));
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
  const signature = signatures[0];
  const symbol = signature.parameters[index] ?? (signature.parameters.length === 1 ? signature.parameters[0] : undefined);
  if (!symbol) return undefined;
  return checker.getTypeOfSymbolAtLocation(symbol, param);
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

const editsByFile = new Map();
const reasons = new Map();

function addEdit(sourceFile, start, end, text, reason) {
  const key = sourceFile.fileName;
  const edits = editsByFile.get(key) ?? [];
  edits.push({ start, end, text });
  editsByFile.set(key, edits);
  reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
}

for (const sourceFile of program.getSourceFiles()) {
  const relativePath = rel(sourceFile.fileName);
  if (!isTarget(relativePath)) continue;

  const visit = (node) => {
    if (ts.isParameter(node) && node.type?.kind === ts.SyntaxKind.AnyKeyword && !node.questionToken) {
      const name = ts.isIdentifier(node.name) ? node.name.text : null;
      const isExpressSurface = relativePath.startsWith("server/routes/") || relativePath.startsWith("server/middleware/");
      const expressType = name && isExpressSurface ? EXPRESS_PARAM_TYPES.get(name) : undefined;
      if (expressType) {
        addEdit(sourceFile, node.type.getStart(sourceFile), node.type.end, expressType, `express:${name}`);
      } else {
        const contextual = contextualParameterType(node);
        if (contextual && !isAnyOrUnknown(contextual)) {
          addEdit(sourceFile, node.name.end, node.type.end, "", "contextual-callback");
        }
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      Boolean(node.parent.flags & ts.NodeFlags.Const) &&
      node.type?.kind === ts.SyntaxKind.AnyKeyword &&
      node.initializer &&
      !node.exclamationToken
    ) {
      const inferred = checker.getTypeAtLocation(node.initializer);
      if (!isAnyOrUnknown(inferred)) {
        addEdit(sourceFile, node.name.end, node.type.end, "", "const-inference");
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

let modifiedFiles = 0;
let removedAnyKeywords = 0;
const details = [];

for (const [fileName, edits] of editsByFile.entries()) {
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) continue;
  const original = sourceFile.text;
  const beforeCount = anyKeywordCount(sourceFile);
  const ordered = [...edits].sort((a, b) => b.start - a.start);

  let updated = original;
  let lastStart = Infinity;
  for (const edit of ordered) {
    if (edit.end > lastStart) throw new Error(`Overlapping edit in ${rel(fileName)}`);
    updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end);
    lastStart = edit.start;
  }

  if (updated === original) continue;
  const reparsed = ts.createSourceFile(fileName, updated, ts.ScriptTarget.Latest, true, sourceFile.scriptKind);
  const afterCount = anyKeywordCount(reparsed);
  if (afterCount > beforeCount) throw new Error(`Type escape count increased in ${rel(fileName)}`);

  fs.writeFileSync(fileName, updated);
  modifiedFiles += 1;
  removedAnyKeywords += beforeCount - afterCount;
  details.push({ path: rel(fileName), before: beforeCount, after: afterCount, removed: beforeCount - afterCount });
}

details.sort((a, b) => b.removed - a.removed || a.path.localeCompare(b.path));
console.log(JSON.stringify({ modifiedFiles, removedAnyKeywords, reasons: Object.fromEntries(reasons), details }, null, 2));
