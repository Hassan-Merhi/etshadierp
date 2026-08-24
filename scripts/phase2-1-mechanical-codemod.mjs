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
const EXPRESS_TYPES = new Map([
  ["req", "import(\"express\").Request"],
  ["request", "import(\"express\").Request"],
  ["res", "import(\"express\").Response"],
  ["response", "import(\"express\").Response"],
  ["next", "import(\"express\").NextFunction"],
  ["requireAuth", "import(\"express\").RequestHandler"],
]);

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
  const signature = signatures[0];
  const symbol = signature.parameters[index];
  return symbol ? checker.getTypeOfSymbolAtLocation(symbol, param) : undefined;
}
function isFunctionNode(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
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
function annotationStart(sourceFile, typeNode, fallback) {
  const typeStart = typeNode.getStart(sourceFile);
  const colon = sourceFile.text.lastIndexOf(":", typeStart);
  return colon >= fallback ? colon : typeStart;
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
  const edits = editsByFile.get(sourceFile.fileName) ?? [];
  edits.push({ start, end, text, reason });
  editsByFile.set(sourceFile.fileName, edits);
  reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
}

for (const sourceFile of program.getSourceFiles()) {
  const relativePath = rel(sourceFile.fileName);
  if (!isTarget(relativePath)) continue;
  const expressSurface = relativePath.startsWith("server/routes/") || relativePath.startsWith("server/middleware/");

  const visit = (node) => {
    if (ts.isParameter(node) && node.type && typeNodeHasAny(node.type) && !node.questionToken) {
      const name = ts.isIdentifier(node.name) ? node.name.text : null;
      const directAny = node.type.kind === ts.SyntaxKind.AnyKeyword;
      const expressType = directAny && expressSurface && name ? EXPRESS_TYPES.get(name) : undefined;
      if (expressType) {
        addEdit(sourceFile, node.type.getStart(sourceFile), node.type.end, expressType, `express:${name}`);
      } else if (node.parent && (ts.isArrowFunction(node.parent) || ts.isFunctionExpression(node.parent))) {
        const contextual = contextualParameterType(node);
        if (contextual && !unsafeType(contextual)) {
          addEdit(sourceFile, node.name.end, node.type.end, "", "contextual-callback");
        }
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      Boolean(node.parent.flags & ts.NodeFlags.Const) &&
      node.type &&
      typeNodeHasAny(node.type) &&
      node.initializer &&
      !ts.isArrayLiteralExpression(node.initializer) &&
      !ts.isObjectLiteralExpression(node.initializer)
    ) {
      const inferred = checker.getTypeAtLocation(node.initializer);
      if (!unsafeType(inferred)) addEdit(sourceFile, node.name.end, node.type.end, "", "const-inference");
    }

    if (
      ts.isPropertyDeclaration(node) &&
      node.type &&
      typeNodeHasAny(node.type) &&
      node.initializer &&
      node.name &&
      !ts.isArrayLiteralExpression(node.initializer) &&
      !ts.isObjectLiteralExpression(node.initializer)
    ) {
      const inferred = checker.getTypeAtLocation(node.initializer);
      if (!unsafeType(inferred)) addEdit(sourceFile, node.name.end, node.type.end, "", "property-inference");
    }

    if (isFunctionNode(node) && node.type && typeNodeHasAny(node.type) && node.body) {
      const returns = collectOwnReturnExpressions(node);
      if (returns.length > 0 && returns.every((expr) => !unsafeType(checker.getTypeAtLocation(expr)))) {
        const fallback = node.parameters?.end ?? node.getStart(sourceFile);
        addEdit(sourceFile, annotationStart(sourceFile, node.type, fallback), node.type.end, "", "return-inference");
      }
    }

    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      const originalType = checker.getTypeAtLocation(node.expression);
      const contextual = checker.getContextualType(node);
      if (contextual && !unsafeType(originalType) && !unsafeType(contextual) && checker.isTypeAssignableTo(originalType, contextual)) {
        addEdit(sourceFile, node.expression.end, node.end, "", "redundant-as-any");
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

let modifiedFiles = 0;
let removedAnyKeywords = 0;
const details = [];
for (const [fileName, rawEdits] of editsByFile) {
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) continue;
  const dedup = new Map(rawEdits.map((edit) => [`${edit.start}:${edit.end}`, edit]));
  const edits = [...dedup.values()].sort((a, b) => b.start - a.start || b.end - a.end);
  let lastStart = Infinity;
  let updated = sourceFile.text;
  for (const edit of edits) {
    if (edit.end > lastStart) continue;
    updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end);
    lastStart = edit.start;
  }
  if (updated === sourceFile.text) continue;
  const before = anyKeywordCount(sourceFile);
  const reparsed = ts.createSourceFile(fileName, updated, ts.ScriptTarget.Latest, true, sourceFile.scriptKind);
  const after = anyKeywordCount(reparsed);
  if (after > before) throw new Error(`Type escape count increased in ${rel(fileName)}`);
  fs.writeFileSync(fileName, updated);
  modifiedFiles += 1;
  removedAnyKeywords += before - after;
  details.push({ path: rel(fileName), before, after, removed: before - after });
}

details.sort((a, b) => b.removed - a.removed || a.path.localeCompare(b.path));
console.log(JSON.stringify({ modifiedFiles, removedAnyKeywords, reasons: Object.fromEntries(reasons), details }, null, 2));
