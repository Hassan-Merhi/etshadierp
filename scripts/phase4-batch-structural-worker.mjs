#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const ROOT = process.cwd();
const SOURCE_ROOTS = ["client/src", "server", "shared"];
const SOURCE_EXT = /\.(?:ts|tsx)$/;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...opts,
  });
  return { code: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function fail(message, output = "") {
  if (output) console.error(output);
  throw new Error(message);
}

const baseline = run("npm", ["run", "check"]);
if (baseline.code !== 0) fail("Fast structural pass requires a green TypeScript baseline.", baseline.output);

const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
if (!configPath) fail("tsconfig.json not found");
const configRead = ts.readConfigFile(configPath, ts.sys.readFile);
if (configRead.error) fail(ts.flattenDiagnosticMessageText(configRead.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(configRead.config, ts.sys, path.dirname(configPath));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

const sourceFiles = parsed.fileNames
  .map((file) => path.resolve(file))
  .filter(
    (file) =>
      SOURCE_EXT.test(file) &&
      !file.endsWith(".d.ts") &&
      SOURCE_ROOTS.some((root) => file.startsWith(path.resolve(root) + path.sep))
  );

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}
function isAnyAssertion(node) {
  return ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword;
}
function outer(node) {
  let current = node;
  while (current.parent && ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return current;
}
function isQueryable(expr) {
  if (ts.isIdentifier(expr)) return true;
  if (ts.isPropertyAccessExpression(expr)) return isQueryable(expr.expression);
  return false;
}
function safeType(value) {
  if (!value || /\bany\b/.test(value) || value === "unknown") return null;
  if (value.length > 1200) return null;
  return value;
}
function printType(type, node) {
  try {
    return safeType(
      checker.typeToString(
        type,
        node,
        ts.TypeFormatFlags.NoTruncation |
          ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
          ts.TypeFormatFlags.WriteArrowStyleSignature
      )
    );
  } catch {
    return null;
  }
}
function contextual(node) {
  try {
    const type = checker.getContextualType(node);
    return type ? printType(type, node) : null;
  } catch {
    return null;
  }
}
function propertyNameText(name) {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}
function propertyKey(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}
function cleanRequired(type) {
  if (!type || /\bany\b/.test(type)) return "unknown";
  return type;
}
function enclosingFunction(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return null;
}
function returnExpressionType(node) {
  const fn = enclosingFunction(node);
  if (!fn) return null;
  try {
    if (fn.type) {
      const declared = checker.getTypeFromTypeNode(fn.type);
      if (fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
        const awaited = checker.getPromisedTypeOfPromise(declared);
        return printType(awaited ?? declared, node);
      }
      return printType(declared, node);
    }
    const sig = checker.getSignatureFromDeclaration(fn);
    if (!sig) return null;
    const returned = checker.getReturnTypeOfSignature(sig);
    if (fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
      const awaited = checker.getPromisedTypeOfPromise(returned);
      return printType(awaited ?? returned, node);
    }
    return printType(returned, node);
  } catch {
    return null;
  }
}

function requiredType(expr, sf, depth = 0) {
  if (depth > 10) return "unknown";
  const current = outer(expr);
  const parent = current.parent;
  if (!parent) return "unknown";

  if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
    const name = propertyNameText(parent.name);
    if (!name) return "Record<PropertyKey, unknown>";
    return `{ ${propertyKey(name)}: ${cleanRequired(requiredType(parent, sf, depth + 1))} }`;
  }

  if (ts.isElementAccessExpression(parent) && parent.expression === current) {
    return `Record<PropertyKey, ${cleanRequired(requiredType(parent, sf, depth + 1))}>`;
  }

  if (ts.isCallExpression(parent)) {
    if (parent.expression === current) {
      return `(...args: unknown[]) => ${cleanRequired(requiredType(parent, sf, depth + 1))}`;
    }
    const index = parent.arguments.findIndex((arg) => arg === current);
    if (index >= 0) {
      const ctx = contextual(current);
      if (ctx) return ctx;
      if (isQueryable(parent.expression)) return `Parameters<typeof ${parent.expression.getText(sf)}>[${index}]`;
    }
  }

  if (ts.isNewExpression(parent)) {
    if (parent.expression === current) {
      return `new (...args: unknown[]) => ${cleanRequired(requiredType(parent, sf, depth + 1))}`;
    }
    const index = parent.arguments?.findIndex((arg) => arg === current) ?? -1;
    if (index >= 0) {
      const ctx = contextual(current);
      if (ctx) return ctx;
      if (isQueryable(parent.expression)) return `ConstructorParameters<typeof ${parent.expression.getText(sf)}>[${index}]`;
    }
  }

  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind;
    if (op === ts.SyntaxKind.EqualsToken && parent.right === current && isQueryable(parent.left)) {
      return `typeof ${parent.left.getText(sf)}`;
    }
    if ([ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(op)) {
      return cleanRequired(requiredType(parent, sf, depth + 1));
    }
    if (
      [
        ts.SyntaxKind.MinusToken,
        ts.SyntaxKind.AsteriskToken,
        ts.SyntaxKind.SlashToken,
        ts.SyntaxKind.PercentToken,
        ts.SyntaxKind.AsteriskAsteriskToken,
        ts.SyntaxKind.LessThanLessThanToken,
        ts.SyntaxKind.GreaterThanGreaterThanToken,
        ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
        ts.SyntaxKind.AmpersandToken,
        ts.SyntaxKind.BarToken,
        ts.SyntaxKind.CaretToken,
      ].includes(op)
    ) {
      return "number";
    }
    if (op === ts.SyntaxKind.PlusToken) {
      const other = parent.left === current ? parent.right : parent.left;
      return ts.isStringLiteralLike(other) || ts.isTemplateExpression(other) || ts.isNoSubstitutionTemplateLiteral(other)
        ? "string"
        : "number";
    }
  }

  if (ts.isConditionalExpression(parent)) {
    if (parent.condition === current) return "unknown";
    return cleanRequired(requiredType(parent, sf, depth + 1));
  }

  if (ts.isPrefixUnaryExpression(parent)) {
    if ([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.TildeToken].includes(parent.operator)) return "number";
    if (parent.operator === ts.SyntaxKind.ExclamationToken) return "unknown";
  }

  if (ts.isPostfixUnaryExpression(parent)) return "number";

  if (ts.isVariableDeclaration(parent) && parent.initializer === current && parent.type) {
    return parent.type.getText(sf);
  }

  if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
    const ctx = contextual(current);
    if (ctx) return ctx;
  }

  if (ts.isReturnStatement(parent)) return returnExpressionType(parent) ?? "unknown";
  if (ts.isArrowFunction(parent) && parent.body === current) return returnExpressionType(parent) ?? "unknown";
  if (ts.isAwaitExpression(parent)) return cleanRequired(requiredType(parent, sf, depth + 1));
  if (ts.isIfStatement(parent) && parent.expression === current) return "unknown";
  if (ts.isWhileStatement(parent) && parent.expression === current) return "unknown";
  if (ts.isDoStatement(parent) && parent.expression === current) return "unknown";

  if (ts.isSpreadElement(parent)) {
    const gp = parent.parent;
    if (ts.isArrayLiteralExpression(gp) || ts.isCallExpression(gp) || ts.isNewExpression(gp)) return "Iterable<unknown>";
    return "object";
  }
  if (ts.isSpreadAssignment(parent)) return "object";
  if (ts.isForOfStatement(parent) && parent.expression === current) return "Iterable<unknown>";

  const ctx = contextual(expr);
  return ctx ?? "unknown";
}

function sourceHasProperty(node, name) {
  try {
    const type = checker.getTypeAtLocation(node.expression);
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
    return Boolean(checker.getPropertyOfType(type, name));
  } catch {
    return false;
  }
}

function combinedVariableType(name, sf) {
  let symbol;
  try {
    symbol = checker.getSymbolAtLocation(name);
  } catch {
    symbol = null;
  }
  if (!symbol) return null;

  const targets = new Set();
  const visit = (node) => {
    if (ts.isIdentifier(node) && node !== name) {
      let candidate;
      try {
        candidate = checker.getSymbolAtLocation(node);
      } catch {
        candidate = null;
      }
      if (candidate === symbol) {
        const target = safeType(requiredType(node, sf));
        if (target && target !== "unknown") targets.add(target);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!targets.size) return null;
  const values = [...targets];
  if (values.length === 1) return values[0];
  const combined = values.map((value) => `(${value})`).join(" & ");
  return combined.length <= 1800 ? combined : null;
}

function replacementFor(node, sf) {
  const asToken = node.getChildren(sf).find((child) => child.kind === ts.SyntaxKind.AsKeyword);
  if (!asToken) return null;
  const current = outer(node);
  const parent = current.parent;

  let replacement = "";
  let kind = "remove";

  if (
    parent &&
    ts.isVariableDeclaration(parent) &&
    parent.initializer === current &&
    !parent.type &&
    ts.isIdentifier(parent.name)
  ) {
    const target = combinedVariableType(parent.name, sf);
    if (target) {
      replacement = `as unknown as ${target}`;
      kind = "variable-combined-shape";
    }
  } else if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === current) {
    const name = propertyNameText(parent.name);
    if (name && sourceHasProperty(node, name)) {
      replacement = "";
      kind = "remove-known-property";
    } else if (name) {
      const valueType = cleanRequired(requiredType(parent, sf));
      replacement = `as unknown as { ${propertyKey(name)}: ${valueType} }`;
      kind = "property-shape";
    } else {
      replacement = "as unknown as Record<PropertyKey, unknown>";
      kind = "property-record";
    }
  } else if (parent && ts.isElementAccessExpression(parent) && parent.expression === current) {
    replacement = `as unknown as Record<PropertyKey, ${cleanRequired(requiredType(parent, sf))}>`;
    kind = "element-record";
  } else if (parent && ts.isCallExpression(parent) && parent.expression === current) {
    replacement = `as unknown as (...args: unknown[]) => ${cleanRequired(requiredType(parent, sf))}`;
    kind = "callable";
  } else if (parent && ts.isNewExpression(parent) && parent.expression === current) {
    replacement = `as unknown as new (...args: unknown[]) => ${cleanRequired(requiredType(parent, sf))}`;
    kind = "constructable";
  } else {
    const target = safeType(requiredType(node, sf));
    if (target && target !== "unknown") {
      replacement = `as unknown as ${target}`;
      kind = "context-target";
    }
  }

  return { start: asToken.getStart(sf), end: node.type.end, replacement, kind };
}

const changedCandidates = new Map();
let before = 0;
const kindCounts = new Map();

for (const file of sourceFiles) {
  const sf = program.getSourceFile(file);
  if (!sf) continue;
  const edits = [];
  const visit = (node) => {
    if (isAnyAssertion(node)) {
      before += 1;
      const edit = replacementFor(node, sf);
      if (edit) edits.push(edit);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) continue;

  let text = fs.readFileSync(file, "utf8");
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
    kindCounts.set(edit.kind, (kindCounts.get(edit.kind) ?? 0) + 1);
  }
  fs.writeFileSync(file, text);
  changedCandidates.set(rel(file), edits.length);
}

console.log(`PHASE4_FAST_BEFORE=${before}`);
console.log(`PHASE4_FAST_CANDIDATE_FILES=${changedCandidates.size}`);
for (const [kind, count] of [...kindCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`PHASE4_FAST_KIND ${count}\t${kind}`);
}

function changedSourceFiles() {
  return run("git", ["diff", "--name-only", "--", ...SOURCE_ROOTS]).output
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function diagnosticFiles(output) {
  const files = new Set();
  for (const match of output.matchAll(/^(.+?\.(?:ts|tsx))\(\d+,\d+\):\s+error\s+TS\d+:/gm)) {
    files.add(match[1].replace(/^\.\//, "").split(path.sep).join("/"));
  }
  return [...files];
}
function restore(files) {
  for (let i = 0; i < files.length; i += 100) {
    const result = run("git", ["restore", "--source=HEAD", "--", ...files.slice(i, i + 100)]);
    if (result.code !== 0) fail("git restore failed", result.output);
  }
}

let check = run("npm", ["run", "check"]);
let passes = 0;
while (check.code !== 0 && passes < 5) {
  passes += 1;
  const changed = new Set(changedSourceFiles());
  const direct = diagnosticFiles(check.output).filter((file) => changed.has(file));
  if (!direct.length) {
    console.log(`PHASE4_FAST_CROSS_MODULE_FAILURE_PASS=${passes}`);
    restore([...changed]);
    break;
  }
  console.log(`PHASE4_FAST_RESTORE_PASS=${passes} FILES=${direct.length}`);
  restore(direct);
  check = run("npm", ["run", "check"]);
}

check = run("npm", ["run", "check"]);
if (check.code !== 0) fail("Fast structural pass could not recover a green TypeScript tree.", check.output);

let changed = changedSourceFiles();
for (let i = 0; i < changed.length; i += 80) {
  const fmt = run("node", ["node_modules/prettier/bin/prettier.cjs", "--write", ...changed.slice(i, i + 80)]);
  if (fmt.code !== 0) fail("Prettier failed", fmt.output);
}
const formatted = run("npm", ["run", "check"]);
if (formatted.code !== 0) fail("TypeScript failed after formatting.", formatted.output);

const audit = run("node", ["scripts/audit-type-escapes.mjs", "--json"]);
let after = null;
try {
  after = JSON.parse(audit.output).summary.asAny;
} catch {
  console.error(audit.output);
}
console.log(`PHASE4_FAST_AFTER=${after ?? "unknown"}`);
console.log(`PHASE4_FAST_REMOVED=${typeof after === "number" ? before - after : "unknown"}`);
console.log(`PHASE4_FAST_CHANGED_FILES=${changedSourceFiles().length}`);
