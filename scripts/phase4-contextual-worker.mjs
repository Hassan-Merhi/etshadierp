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
    else if (EXTS.has(path.extname(entry.name)) && !entry.name.endsWith(".d.ts")) {
      out.push(path.resolve(current));
    }
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

function normalized(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
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
    const sf = node.getSourceFile();
    const text = printer
      .printNode(ts.EmitHint.Unspecified, typeNode, sf)
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text === "any" || text.length > 1200) return null;
    return text;
  } catch {
    return null;
  }
}

function resolvedParameterType(call, argument) {
  try {
    const signature = checker.getResolvedSignature(call);
    if (!signature) return null;
    const index = call.arguments.indexOf(argument);
    if (index < 0 || signature.parameters.length === 0) return null;
    let symbol = signature.parameters[Math.min(index, signature.parameters.length - 1)];
    let type = checker.getTypeOfSymbolAtLocation(symbol, call);
    if (index >= signature.parameters.length - 1 && symbol.valueDeclaration?.dotDotDotToken) {
      const numberIndex = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
      if (numberIndex) type = numberIndex;
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
  if (!node || depth > 6) return null;

  try {
    const contextual = checker.getContextualType(node);
    const contextualText = printType(contextual, node);
    if (contextualText) return contextualText;
  } catch {
    // Fall through to parent-derived contexts.
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
    if (parent.type) return parent.type.getText(parent.getSourceFile()).replace(/\s+/g, " ");
    return printType(checker.getTypeAtLocation(parent.name), node);
  }
  if (ts.isBinaryExpression(parent) && parent.right === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return printType(checker.getTypeAtLocation(parent.left), node);
  }
  if (ts.isBinaryExpression(parent)) {
    const comparisonKinds = new Set([
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
    if (comparisonKinds.has(parent.operatorToken.kind)) {
      const other = parent.left === node ? parent.right : parent.left;
      const otherText = printType(checker.getTypeAtLocation(other), node);
      if (otherText) return otherText;
    }
  }
  if (ts.isReturnStatement(parent) && parent.expression === node) {
    const fn = enclosingFunction(parent);
    if (fn) {
      const sig = checker.getSignatureFromDeclaration(fn);
      if (sig) return printType(checker.getReturnTypeOfSignature(sig), node);
    }
  }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    const nested = expectedTypeText(parent, depth + 1) ?? "unknown";
    return `{ ${parent.name.text}: ${nested} }`;
  }
  if (ts.isElementAccessExpression(parent) && parent.expression === node) {
    const nested = expectedTypeText(parent, depth + 1) ?? "unknown";
    const keyType = parent.argumentExpression
      ? printType(checker.getTypeAtLocation(parent.argumentExpression), node)
      : null;
    if (keyType && /number/.test(keyType)) return `{ [key: number]: ${nested} }`;
    return `{ [key: string]: ${nested} }`;
  }
  if (ts.isCallExpression(parent) && parent.expression === node) {
    const args = parent.arguments.map((arg, index) => {
      const argType = printType(checker.getTypeAtLocation(arg), node) ?? "unknown";
      return `arg${index}: ${argType}`;
    });
    const returnType = expectedTypeText(parent, depth + 1) ?? "unknown";
    return `(${args.join(", ")}) => ${returnType}`;
  }
  if (ts.isAwaitExpression(parent)) return expectedTypeText(parent, depth + 1);
  if (ts.isParenthesizedExpression(parent)) return expectedTypeText(parent, depth + 1);
  if (ts.isConditionalExpression(parent)) return expectedTypeText(parent, depth + 1);
  if (ts.isJsxExpression(parent)) return expectedTypeText(parent, depth + 1);

  return null;
}

function receiverShape(node) {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    const valueType = expectedTypeText(parent) ?? "unknown";
    return `{ ${parent.name.text}: ${valueType} }`;
  }
  if (ts.isElementAccessExpression(parent) && parent.expression === node) {
    const valueType = expectedTypeText(parent) ?? "unknown";
    const keyType = parent.argumentExpression
      ? printType(checker.getTypeAtLocation(parent.argumentExpression), node)
      : null;
    return keyType && /number/.test(keyType)
      ? `{ [key: number]: ${valueType} }`
      : `{ [key: string]: ${valueType} }`;
  }
  return null;
}

const sourceFiles = SOURCE_ROOTS.flatMap((root) => walk(root)).sort();
const originals = new Map();
const candidatesByFile = new Map();
let baseline = 0;
let inferable = 0;

for (const file of sourceFiles) {
  const sf = program.getSourceFile(file);
  if (!sf) continue;
  const source = fs.readFileSync(file, "utf8");
  originals.set(normalized(file), source);
  const candidates = [];

  const visit = (node) => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      baseline += 1;
      const asToken = node.getChildren(sf).find((child) => child.kind === ts.SyntaxKind.AsKeyword);
      if (asToken) {
        const lc = sf.getLineAndCharacterOfPosition(asToken.getStart(sf));
        let replacementType = receiverShape(node) ?? expectedTypeText(node);
        if (replacementType) {
          replacementType = replacementType.replace(/\s+/g, " ").trim();
          if (replacementType === "any" || replacementType.length > 1400) replacementType = null;
        }
        if (replacementType) inferable += 1;
        candidates.push({
          id: `${normalized(file)}:${asToken.getStart(sf)}`,
          start: asToken.getStart(sf),
          end: node.type.end,
          line: lc.line + 1,
          replacement: replacementType ? `as ${replacementType}` : null,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (candidates.length) candidatesByFile.set(normalized(file), candidates);
}

const reverted = new Set();
function renderFile(file) {
  let source = originals.get(file);
  for (const candidate of [...(candidatesByFile.get(file) ?? [])].sort((a, b) => b.start - a.start)) {
    if (!candidate.replacement || reverted.has(candidate.id)) continue;
    source = source.slice(0, candidate.start) + candidate.replacement + source.slice(candidate.end);
  }
  fs.writeFileSync(file, source);
}
function renderAll() {
  for (const file of candidatesByFile.keys()) renderFile(file);
}

function parseDiagnostics(output) {
  const rows = [];
  for (const match of output.matchAll(/^(.+?\.(?:ts|tsx))\((\d+),(\d+)\):\s+error\s+TS(\d+):/gm)) {
    rows.push({
      file: match[1].replace(/^\.\//, "").split(path.sep).join("/"),
      line: Number(match[2]),
      code: Number(match[4]),
    });
  }
  return rows;
}

function revertNearby(diag, radius) {
  const candidates = (candidatesByFile.get(diag.file) ?? []).filter(
    (candidate) => candidate.replacement && !reverted.has(candidate.id)
  );
  const nearby = candidates.filter((candidate) => Math.abs(candidate.line - diag.line) <= radius);
  for (const candidate of nearby) reverted.add(candidate.id);
  return nearby.length;
}

console.log(`PHASE4_CONTEXTUAL_BASELINE=${baseline}`);
console.log(`PHASE4_CONTEXTUAL_INFERABLE=${inferable}`);

let green = false;
for (let iteration = 1; iteration <= 12; iteration++) {
  renderAll();
  const check = run("npm", ["run", "check"]);
  if (check.code === 0) {
    console.log(`PHASE4_CONTEXTUAL_TSC_PASSES=${iteration}`);
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
        if (candidate.replacement && !reverted.has(candidate.id)) {
          reverted.add(candidate.id);
          added += 1;
        }
      }
    }
  }
  if (!added) {
    const available = [...candidatesByFile.entries()]
      .map(([file, candidates]) => [
        file,
        candidates.filter((candidate) => candidate.replacement && !reverted.has(candidate.id)),
      ])
      .filter(([, candidates]) => candidates.length)
      .sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));
    if (available.length) {
      const [file, candidates] = available[0];
      for (const candidate of candidates) reverted.add(candidate.id);
      added += candidates.length;
      console.log(`Pass ${iteration}: cross-module fallback reverted ${candidates.length} replacement(s) in ${file}.`);
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
if (finalCheck.code !== 0 || !green) {
  console.error(finalCheck.output);
  throw new Error("Contextual Phase 4 retyping did not reach a green TypeScript state.");
}

let remaining = 0;
let accepted = 0;
for (const [file, candidates] of candidatesByFile) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) remaining += 1;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  accepted += candidates.filter((candidate) => candidate.replacement && !reverted.has(candidate.id)).length;
}

console.log(`PHASE4_CONTEXTUAL_ACCEPTED=${accepted}`);
console.log(`PHASE4_CONTEXTUAL_REVERTED=${reverted.size}`);
console.log(`PHASE4_CONTEXTUAL_REMAINING_AS_ANY=${remaining}`);
