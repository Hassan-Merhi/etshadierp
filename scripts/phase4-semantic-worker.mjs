#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const ROOT = process.cwd();
const SOURCE_ROOTS = ["client/src", "server", "shared"];
const EXTENSIONS = /\.(?:ts|tsx)$/;

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...opts,
  });
  return { code: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
if (!configPath) throw new Error("tsconfig.json not found");
const configRead = ts.readConfigFile(configPath, ts.sys.readFile);
if (configRead.error) throw new Error(ts.flattenDiagnosticMessageText(configRead.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(configRead.config, ts.sys, path.dirname(configPath));

const sourceFiles = parsed.fileNames
  .map((file) => path.resolve(file))
  .filter((file) => EXTENSIONS.test(file) && !file.endsWith(".d.ts") && SOURCE_ROOTS.some((root) => file.startsWith(path.resolve(root) + path.sep)));

const baselineCheck = run("npm", ["run", "check"]);
if (baselineCheck.code !== 0) {
  console.error(baselineCheck.output);
  throw new Error("Semantic Phase 4 pass requires a green TypeScript baseline.");
}

const initialProgram = ts.createProgram(parsed.fileNames, parsed.options);
const checker = initialProgram.getTypeChecker();
const versions = new Map();
const snapshots = new Map();
function bump(file) {
  versions.set(file, (versions.get(file) ?? 0) + 1);
  snapshots.delete(file);
}
function writeFile(file, text) {
  fs.writeFileSync(file, text);
  bump(file);
}
const host = {
  getCompilationSettings: () => parsed.options,
  getScriptFileNames: () => parsed.fileNames,
  getScriptVersion: (fileName) => String(versions.get(path.resolve(fileName)) ?? 0),
  getScriptSnapshot: (fileName) => {
    const abs = path.resolve(fileName);
    if (snapshots.has(abs)) return snapshots.get(abs);
    if (!fs.existsSync(abs)) return undefined;
    const snap = ts.ScriptSnapshot.fromString(fs.readFileSync(abs, "utf8"));
    snapshots.set(abs, snap);
    return snap;
  },
  getCurrentDirectory: () => ROOT,
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
  realpath: ts.sys.realpath,
  useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  getNewLine: () => ts.sys.newLine,
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry());
function diagnostics(file) {
  return [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)];
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}
function changedSourceFiles() {
  return run("git", ["diff", "--name-only", "--", ...SOURCE_ROOTS]).output
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function restore(paths) {
  for (let i = 0; i < paths.length; i += 100) {
    run("git", ["restore", "--source=HEAD", "--", ...paths.slice(i, i + 100)]);
  }
  for (const rel of paths) bump(path.resolve(rel));
}
function parseDiagnosticFiles(output) {
  const files = new Set();
  for (const match of output.matchAll(/^(.+?\.(?:ts|tsx))\(\d+,\d+\):\s+error\s+TS\d+:/gm)) {
    files.add(match[1].replace(/^\.\//, "").split(path.sep).join("/"));
  }
  return [...files];
}

function isAnyAssertion(node) {
  return ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword;
}
function outerExpression(node) {
  let current = node;
  while (current.parent && ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return current;
}
function isQueryable(expr) {
  if (ts.isIdentifier(expr)) return true;
  if (ts.isPropertyAccessExpression(expr)) return isQueryable(expr.expression);
  return false;
}
function cleanTypeString(value) {
  if (!value || /\bany\b/.test(value) || value === "unknown") return null;
  if (value.length > 800) return null;
  return value;
}
function contextualTypeText(node) {
  try {
    const type = checker.getContextualType(node);
    if (!type) return null;
    return cleanTypeString(
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

function usageTypeForProperty(access) {
  const prop = access.name.text;
  const lower = prop.toLowerCase();
  const usage = outerExpression(access).parent;
  if (usage && ts.isCallExpression(usage)) {
    const callee = usage.expression.getText(access.getSourceFile());
    if (callee === "parseFloat" || callee === "parseInt") return "string";
    if (callee === "Number") return "string | number";
  }
  if (usage && ts.isPropertyAccessExpression(usage) && usage.expression === outerExpression(access)) {
    const method = usage.name.text;
    if (["trim", "toLowerCase", "toUpperCase", "startsWith", "endsWith", "includes", "slice", "substring"].includes(method)) {
      return "string";
    }
    if (["toFixed", "toPrecision"].includes(method)) return "number";
  }
  if (usage && ts.isBinaryExpression(usage)) {
    const other = usage.left === outerExpression(access) ? usage.right : usage.left;
    if (ts.isStringLiteralLike(other)) return "string";
    if (ts.isNumericLiteral(other)) return "number";
    if (other.kind === ts.SyntaxKind.TrueKeyword || other.kind === ts.SyntaxKind.FalseKeyword) return "boolean";
    if ([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken].includes(usage.operatorToken.kind)) {
      return "number";
    }
  }
  if (usage && ts.isPrefixUnaryExpression(usage) && usage.operator === ts.SyntaxKind.ExclamationToken) return "boolean";

  if (prop === "_handledGlobally") return "boolean";
  if (prop === "message") return "string";
  if (prop === "stack") return "string | undefined";
  if (prop === "code") return "string | number";
  if (prop === "webkitAudioContext") return "typeof AudioContext";
  if (lower.includes("confirmed") || lower.startsWith("can") || lower.startsWith("is") || lower.startsWith("has") || ["active", "hidden"].includes(lower)) {
    return "boolean";
  }
  if (lower.endsWith("id") || lower.endsWith("count") || lower.endsWith("station")) return "number";
  if (lower.includes("date") || lower.includes("name") || lower.includes("code") || lower.includes("currency") || lower.includes("role") || lower.includes("status") || lower.includes("type")) {
    return "string";
  }
  return null;
}

function replacementOptions(node, sf) {
  const asToken = node.getChildren(sf).find((child) => child.kind === ts.SyntaxKind.AsKeyword);
  if (!asToken) return [];
  const options = [{ replacement: "", kind: "remove" }];
  const seen = new Set([""]);
  const add = (replacement, kind) => {
    if (!replacement || seen.has(replacement) || /\bany\b/.test(replacement)) return;
    seen.add(replacement);
    options.push({ replacement, kind });
  };

  const contextual = contextualTypeText(node);
  if (contextual) {
    add(`as ${contextual}`, "contextual");
    add(`as unknown as ${contextual}`, "contextual-double");
  }

  const outer = outerExpression(node);
  const parent = outer.parent;
  if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === outer) {
    const inner = node.expression;
    const prop = parent.name.text;
    const inferred = usageTypeForProperty(parent);
    const typeVariants = [inferred, "string", "number", "boolean", "string | null", "number | null", "string | number", "unknown"].filter(Boolean);
    if (isQueryable(inner)) {
      const innerText = inner.getText(sf);
      for (const type of typeVariants) {
        add(`as typeof ${innerText} & { ${prop}: ${type} }`, `property:${prop}`);
        add(`as typeof ${innerText} & { ${prop}?: ${type} }`, `property-optional:${prop}`);
      }
    } else {
      for (const type of typeVariants) add(`as { ${prop}: ${type} }`, `property-shape:${prop}`);
    }
  }

  if (parent && ts.isCallExpression(parent)) {
    const index = parent.arguments.findIndex((arg) => arg === outer);
    if (index >= 0 && isQueryable(parent.expression)) {
      const callee = parent.expression.getText(sf);
      const target = `Parameters<typeof ${callee}>[${index}]`;
      add(`as ${target}`, "call-parameter");
      add(`as unknown as ${target}`, "call-parameter-double");
    }
  }
  if (parent && ts.isNewExpression(parent) && parent.arguments) {
    const index = parent.arguments.findIndex((arg) => arg === outer);
    if (index >= 0 && isQueryable(parent.expression)) {
      const callee = parent.expression.getText(sf);
      const target = `ConstructorParameters<typeof ${callee}>[${index}]`;
      add(`as ${target}`, "constructor-parameter");
      add(`as unknown as ${target}`, "constructor-parameter-double");
    }
  }
  if (parent && ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === outer && isQueryable(parent.left)) {
    const target = `typeof ${parent.left.getText(sf)}`;
    add(`as ${target}`, "assignment-target");
    add(`as unknown as ${target}`, "assignment-target-double");
  }
  if (parent && ts.isVariableDeclaration(parent) && parent.initializer === outer && parent.type) {
    const target = parent.type.getText(sf);
    add(`as ${target}`, "declared-variable");
    add(`as unknown as ${target}`, "declared-variable-double");
  }

  return options.map((option) => ({
    ...option,
    start: asToken.getStart(sf),
    end: node.type.end,
  }));
}

function collectFileCandidates(file) {
  const sf = initialProgram.getSourceFile(file);
  if (!sf) return [];
  const out = [];
  let id = 0;
  const visit = (node) => {
    if (isAnyAssertion(node)) {
      const options = replacementOptions(node, sf);
      if (options.length) {
        const lc = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        out.push({
          id: id++,
          line: lc.line + 1,
          expr: node.expression.getText(sf).replace(/\s+/g, " ").slice(0, 140),
          options,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function render(original, edits) {
  let text = original;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  }
  return text;
}

let before = 0;
let accepted = 0;
const acceptedKinds = new Map();
const unresolved = [];
let processedFiles = 0;

for (const file of sourceFiles) {
  const candidates = collectFileCandidates(file);
  if (!candidates.length) continue;
  before += candidates.length;
  const original = fs.readFileSync(file, "utf8");
  const acceptedEdits = [];
  let stable = original;

  for (const candidate of candidates) {
    let resolved = false;
    for (const option of candidate.options) {
      const trial = render(original, [...acceptedEdits, option]);
      writeFile(file, trial);
      if (diagnostics(file).length === 0) {
        acceptedEdits.push(option);
        stable = trial;
        accepted += 1;
        acceptedKinds.set(option.kind, (acceptedKinds.get(option.kind) ?? 0) + 1);
        resolved = true;
        break;
      }
    }
    if (!resolved) {
      writeFile(file, stable);
      unresolved.push([relative(file), candidate.line, candidate.expr]);
    }
  }
  writeFile(file, stable);
  processedFiles += 1;
  if (processedFiles % 25 === 0) console.log(`semantic files processed=${processedFiles}`);
}

console.log(`PHASE4_SEMANTIC_BEFORE=${before}`);
console.log(`PHASE4_SEMANTIC_ACCEPTED=${accepted}`);
console.log(`PHASE4_SEMANTIC_UNRESOLVED=${unresolved.length}`);
for (const [kind, count] of [...acceptedKinds.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`PHASE4_SEMANTIC_KIND ${count}\t${kind}`);
}

let fullCheck = run("npm", ["run", "check"]);
if (fullCheck.code !== 0) {
  const changed = new Set(changedSourceFiles());
  const direct = parseDiagnosticFiles(fullCheck.output).filter((file) => changed.has(file));
  if (direct.length) {
    console.log(`PHASE4_SEMANTIC_RESTORE_DIRECT_FILES=${direct.length}`);
    restore(direct);
    fullCheck = run("npm", ["run", "check"]);
  }
}
if (fullCheck.code !== 0) {
  console.error(fullCheck.output);
  throw new Error("Semantic Phase 4 edits caused a cross-module TypeScript failure.");
}

let changed = changedSourceFiles();
for (let i = 0; i < changed.length; i += 80) {
  const fmt = run("node", ["node_modules/prettier/bin/prettier.cjs", "--write", ...changed.slice(i, i + 80)]);
  if (fmt.code !== 0) throw new Error(fmt.output);
}
const formattedCheck = run("npm", ["run", "check"]);
if (formattedCheck.code !== 0) {
  console.error(formattedCheck.output);
  throw new Error("Semantic Phase 4 TypeScript failed after formatting.");
}

let after = 0;
const remainder = [];
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let count = 0;
  const visit = (node) => {
    if (isAnyAssertion(node)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (count) remainder.push([relative(file), count]);
  after += count;
}
remainder.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
console.log(`PHASE4_SEMANTIC_AFTER=${after}`);
console.log(`PHASE4_SEMANTIC_REMOVED_OR_TYPED=${before - after}`);
console.log(`PHASE4_SEMANTIC_CHANGED_FILES=${changedSourceFiles().length}`);
console.log(`PHASE4_SEMANTIC_REMAINING_FILES=${remainder.length}`);
console.log("=== SEMANTIC REMAINDER TOP ===");
for (const [file, count] of remainder.slice(0, 120)) console.log(`${count}\t${file}`);
console.log("=== SEMANTIC UNRESOLVED SAMPLE ===");
for (const [file, line, expr] of unresolved.slice(0, 300)) console.log(`${file}:${line}\t${expr}`);
