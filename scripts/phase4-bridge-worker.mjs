#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const ROOT = process.cwd();
const SOURCE_ROOTS = ["client/src", "server", "shared"];
const EXTS = new Set([".ts", ".tsx"]);

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  return { code: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const current = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(current, out);
    else if (EXTS.has(path.extname(entry.name)) && !entry.name.endsWith(".d.ts")) out.push(path.resolve(current));
  }
  return out;
}

const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
if (!configPath) throw new Error("tsconfig.json not found");
const configRead = ts.readConfigFile(configPath, ts.sys.readFile);
if (configRead.error) throw new Error(ts.flattenDiagnosticMessageText(configRead.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(configRead.config, ts.sys, path.dirname(configPath));
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const checker = program.getTypeChecker();
const printer = ts.createPrinter({ removeComments: true });

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function safeTypeText(text) {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 1400 || /\bany\b/.test(normalized)) return null;
  return normalized;
}

function usableType(type) {
  if (!type) return false;
  return (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) === 0;
}

function printType(type, node) {
  if (!usableType(type)) return null;
  try {
    const typeNode = checker.typeToTypeNode(
      type,
      node,
      ts.NodeBuilderFlags.NoTruncation |
        ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope |
        ts.NodeBuilderFlags.WriteTypeArgumentsOfSignature
    );
    if (!typeNode) return null;
    return safeTypeText(printer.printNode(ts.EmitHint.Unspecified, typeNode, node.getSourceFile()));
  } catch {
    return null;
  }
}

function resolvedParameterType(call, argument) {
  try {
    const signature = checker.getResolvedSignature(call);
    if (!signature || signature.parameters.length === 0) return null;
    const index = call.arguments?.indexOf(argument) ?? -1;
    if (index < 0) return null;
    const symbol = signature.parameters[Math.min(index, signature.parameters.length - 1)];
    let type = checker.getTypeOfSymbolAtLocation(symbol, call);
    if (index >= signature.parameters.length - 1 && symbol.valueDeclaration?.dotDotDotToken) {
      const indexed = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
      if (indexed) type = indexed;
    }
    return type;
  } catch {
    return null;
  }
}

function enclosingFunction(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return null;
}

function expectedTypeText(node, depth = 0) {
  if (!node || depth > 8) return null;
  try {
    const contextual = safeTypeText(printType(checker.getContextualType(node), node));
    if (contextual && contextual !== "unknown") return contextual;
  } catch {
    // Parent-derived contexts below are more reliable for assertions.
  }

  const parent = node.parent;
  if (!parent) return null;

  if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
    return printType(resolvedParameterType(parent, node), node);
  }
  if (ts.isNewExpression(parent) && parent.arguments?.includes(node)) {
    return printType(resolvedParameterType(parent, node), node);
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    if (parent.type) return safeTypeText(parent.type.getText(parent.getSourceFile()));
    return printType(checker.getTypeAtLocation(parent.name), node);
  }
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    if (parent.right === node) return printType(checker.getTypeAtLocation(parent.left), node);
    if (parent.left === node) return printType(checker.getTypeAtLocation(parent.right), node);
  }
  if (ts.isBinaryExpression(parent)) {
    const comparable = new Set([
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.LessThanToken,
      ts.SyntaxKind.LessThanEqualsToken,
      ts.SyntaxKind.GreaterThanToken,
      ts.SyntaxKind.GreaterThanEqualsToken,
      ts.SyntaxKind.PlusToken,
      ts.SyntaxKind.MinusToken,
      ts.SyntaxKind.AsteriskToken,
      ts.SyntaxKind.SlashToken,
      ts.SyntaxKind.PercentToken,
    ]);
    if (comparable.has(parent.operatorToken.kind)) {
      const other = parent.left === node ? parent.right : parent.left;
      return printType(checker.getTypeAtLocation(other), node);
    }
  }
  if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
    return "number";
  }
  if (ts.isReturnStatement(parent) && parent.expression === node) {
    const fn = enclosingFunction(parent);
    const signature = fn ? checker.getSignatureFromDeclaration(fn) : null;
    return signature ? printType(checker.getReturnTypeOfSignature(signature), node) : null;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    const nested = expectedTypeText(parent, depth + 1) ?? printType(checker.getTypeAtLocation(parent), node) ?? "unknown";
    return safeTypeText(`{ ${parent.name.text}: ${nested} }`);
  }
  if (ts.isElementAccessExpression(parent) && parent.expression === node) {
    const nested = expectedTypeText(parent, depth + 1) ?? printType(checker.getTypeAtLocation(parent), node) ?? "unknown";
    const key = parent.argumentExpression ? printType(checker.getTypeAtLocation(parent.argumentExpression), node) : null;
    return safeTypeText(key && /number/.test(key) ? `{ [key: number]: ${nested} }` : `{ [key: string]: ${nested} }`);
  }
  if (ts.isCallExpression(parent) && parent.expression === node) {
    const args = parent.arguments.map((arg, index) => `arg${index}: ${printType(checker.getTypeAtLocation(arg), node) ?? "unknown"}`);
    const result = expectedTypeText(parent, depth + 1) ?? printType(checker.getTypeAtLocation(parent), node) ?? "unknown";
    return safeTypeText(`(${args.join(", ")}) => ${result}`);
  }
  if (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isJsxExpression(parent)) {
    return expectedTypeText(parent, depth + 1);
  }
  if (ts.isConditionalExpression(parent)) return expectedTypeText(parent, depth + 1);
  if (ts.isSpreadAssignment(parent)) return "Record<string, unknown>";
  if (ts.isSpreadElement(parent)) return "Iterable<unknown>";

  return null;
}

function targetFor(node) {
  const expected = expectedTypeText(node);
  if (!expected || expected === "unknown") return null;
  const source = printType(checker.getTypeAtLocation(node.expression), node);
  if (source && source !== "never" && source !== expected) {
    const intersection = safeTypeText(`(${source}) & (${expected})`);
    if (intersection) return intersection;
  }
  return safeTypeText(expected);
}

const originals = new Map();
const candidatesByFile = new Map();
let baseline = 0;
let inferable = 0;

for (const absolute of SOURCE_ROOTS.flatMap((root) => walk(root)).sort()) {
  const file = relative(absolute);
  const sourceFile = program.getSourceFile(absolute);
  if (!sourceFile) continue;
  const source = fs.readFileSync(absolute, "utf8");
  originals.set(file, source);
  const candidates = [];
  const visit = (node) => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      baseline += 1;
      const token = node.getChildren(sourceFile).find((child) => child.kind === ts.SyntaxKind.AsKeyword);
      if (token) {
        const position = sourceFile.getLineAndCharacterOfPosition(token.getStart(sourceFile));
        const target = targetFor(node);
        if (target) inferable += 1;
        candidates.push({
          id: `${file}:${token.getStart(sourceFile)}`,
          start: token.getStart(sourceFile),
          end: node.type.end,
          line: position.line + 1,
          target,
          expr: node.expression.getText(sourceFile).replace(/\s+/g, " ").slice(0, 160),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (candidates.length) candidatesByFile.set(file, candidates);
}

const reverted = new Set();
function renderFile(file) {
  let source = originals.get(file);
  for (const candidate of [...(candidatesByFile.get(file) ?? [])].sort((a, b) => b.start - a.start)) {
    if (!candidate.target || reverted.has(candidate.id)) continue;
    source = source.slice(0, candidate.start) + `as unknown as (${candidate.target})` + source.slice(candidate.end);
  }
  fs.writeFileSync(file, source);
}
function renderAll() {
  for (const file of candidatesByFile.keys()) renderFile(file);
}

function parseDiagnostics(output) {
  const diagnostics = [];
  for (const match of output.matchAll(/^(.+?\.(?:ts|tsx))\((\d+),(\d+)\):\s+error\s+TS(\d+):/gm)) {
    diagnostics.push({
      file: match[1].replace(/^\.\//, "").split(path.sep).join("/"),
      line: Number(match[2]),
      code: Number(match[4]),
    });
  }
  return diagnostics;
}

function revertNearby(diag, radius) {
  const candidates = (candidatesByFile.get(diag.file) ?? []).filter(
    (candidate) => candidate.target && !reverted.has(candidate.id)
  );
  const nearby = candidates.filter((candidate) => Math.abs(candidate.line - diag.line) <= radius);
  for (const candidate of nearby) reverted.add(candidate.id);
  return nearby.length;
}

console.log(`PHASE4_BRIDGE_BASELINE=${baseline}`);
console.log(`PHASE4_BRIDGE_INFERABLE=${inferable}`);

let green = false;
for (let iteration = 1; iteration <= 10; iteration++) {
  renderAll();
  const check = run("npm", ["run", "check"]);
  if (check.code === 0) {
    console.log(`PHASE4_BRIDGE_TSC_PASSES=${iteration}`);
    green = true;
    break;
  }
  const diagnostics = parseDiagnostics(check.output);
  let added = 0;
  for (const diag of diagnostics) added += revertNearby(diag, 0);
  if (!added) for (const diag of diagnostics) added += revertNearby(diag, 1);
  if (!added) for (const diag of diagnostics) added += revertNearby(diag, 3);
  if (!added) {
    for (const file of [...new Set(diagnostics.map((diag) => diag.file))]) {
      for (const candidate of candidatesByFile.get(file) ?? []) {
        if (candidate.target && !reverted.has(candidate.id)) {
          reverted.add(candidate.id);
          added += 1;
        }
      }
    }
  }
  if (!added) {
    const available = [...candidatesByFile.entries()]
      .map(([file, candidates]) => [file, candidates.filter((candidate) => candidate.target && !reverted.has(candidate.id))])
      .filter(([, candidates]) => candidates.length)
      .sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));
    if (available.length) {
      const [file, candidates] = available[0];
      for (const candidate of candidates) reverted.add(candidate.id);
      added += candidates.length;
      console.log(`Pass ${iteration}: cross-module fallback reverted ${candidates.length} bridge(s) in ${file}.`);
    }
  }
  console.log(`Pass ${iteration}: diagnostics=${diagnostics.length}, reverted=${added}, reverted_total=${reverted.size}`);
  if (!added) {
    console.error(check.output);
    break;
  }
}

renderAll();
const finalCheck = run("npm", ["run", "check"]);
if (!green || finalCheck.code !== 0) {
  console.error(finalCheck.output);
  throw new Error("Concrete Phase 4 bridge pass did not reach a green TypeScript state.");
}

let remaining = 0;
const survivors = [];
for (const [file, candidates] of candidatesByFile) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      remaining += 1;
      const lc = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      survivors.push(`${file}:${lc.line + 1}\t${node.expression.getText(sf).replace(/\s+/g, " ").slice(0, 180)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

console.log(`PHASE4_BRIDGE_ACCEPTED=${inferable - reverted.size}`);
console.log(`PHASE4_BRIDGE_REVERTED=${reverted.size}`);
console.log(`PHASE4_BRIDGE_REMAINING_AS_ANY=${remaining}`);
console.log("=== PHASE4 BRIDGE SURVIVORS ===");
for (const row of survivors.slice(0, 400)) console.log(row);
