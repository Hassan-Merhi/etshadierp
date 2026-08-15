#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const ROOTS = ["client/src", "server", "shared"];
const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
if (!configPath) throw new Error("tsconfig.json not found");
const configRead = ts.readConfigFile(configPath, ts.sys.readFile);
if (configRead.error) throw new Error(ts.flattenDiagnosticMessageText(configRead.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(configRead.config, ts.sys, path.dirname(configPath));
const sourceFiles = parsed.fileNames
  .map((file) => path.resolve(file))
  .filter(
    (file) =>
      /\.(?:ts|tsx)$/.test(file) &&
      !file.endsWith(".d.ts") &&
      ROOTS.some((root) => file.startsWith(path.resolve(root) + path.sep)),
  );

const anyKeyword = (node) => node?.kind === ts.SyntaxKind.AnyKeyword;
const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");

function render(original, edits) {
  let text = original;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  }
  return text;
}

function bindingNameText(name) {
  return ts.isIdentifier(name) ? name.text : "";
}

function reducerCallback(parameter) {
  const fn = parameter.parent;
  if (!fn || (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn))) return false;
  if (fn.parameters[0] !== parameter) return false;
  const call = fn.parent;
  if (!call || !ts.isCallExpression(call)) return false;
  const expr = call.expression;
  return ts.isPropertyAccessExpression(expr) && (expr.name.text === "reduce" || expr.name.text === "reduceRight");
}

function expressBoundaryFunction(parameter) {
  const fn = parameter.parent;
  if (!fn || !ts.isFunctionLike(fn)) return false;
  return fn.parameters.some((p) => {
    const name = bindingNameText(p.name).toLowerCase();
    return /^(req|request|res|response|next)$/.test(name);
  });
}

function uiParameterReplacement(parameter) {
  const name = bindingNameText(parameter.name).toLowerCase();
  if (/^(e|event)$/.test(name)) return 'import("react").SyntheticEvent';
  if (ts.isObjectBindingPattern(parameter.name)) return "Record<string, unknown>";
  if (ts.isArrayBindingPattern(parameter.name)) return "unknown[]";
  return "unknown";
}

function collect(sf, file) {
  const out = [];
  const seen = new Set();
  const normalized = rel(file);
  const isServer = normalized.startsWith("server/");
  const isClientTsx = normalized.startsWith("client/src/") && file.endsWith(".tsx");

  const add = (node, replacement, phase, kind) => {
    if (!node) return;
    const start = node.getStart(sf);
    const end = node.end;
    const key = `${start}:${end}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ start, end, replacement, phase, kind });
  };

  const visit = (node) => {
    // Phase 8 — reducer accumulators and dynamic collection type boundaries.
    if (ts.isParameter(node) && anyKeyword(node.type) && reducerCallback(node)) {
      add(node.type, "unknown", 8, "reduce-accumulator");
    }
    if (ts.isTypeReferenceNode(node) && node.typeArguments?.length) {
      const name = node.typeName.getText(sf);
      if (["Map", "Set", "WeakMap", "WeakSet", "ReadonlyMap", "ReadonlySet"].includes(name)) {
        for (const arg of node.typeArguments) {
          if (anyKeyword(arg)) add(arg, "unknown", 8, `collection:${name}`);
        }
      }
    }

    // Phase 9 — unsafe dynamic key/index boundaries.
    if (ts.isParameter(node) && anyKeyword(node.type)) {
      const name = bindingNameText(node.name);
      if (/^(key|field|column|property|prop|path|indexKey)$/i.test(name)) {
        add(node.type, "PropertyKey", 9, "dynamic-key-parameter");
      }
    }
    if (ts.isIndexedAccessTypeNode(node) && anyKeyword(node.indexType)) {
      add(node.indexType, `keyof (${node.objectType.getText(sf)})`, 9, "indexed-access-any");
    }
    if (ts.isAsExpression(node) && anyKeyword(node.type) && ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node) {
      add(node.type, "PropertyKey", 9, "element-key-cast");
    }

    // Phase 10 — Express/server request-response middleware boundaries.
    if (isServer && ts.isParameter(node) && anyKeyword(node.type) && expressBoundaryFunction(node)) {
      const name = bindingNameText(node.name).toLowerCase();
      let replacement = "unknown";
      let kind = "handler-parameter";
      if (/^(req|request)$/.test(name)) {
        replacement = 'import("express").Request';
        kind = "request";
      } else if (/^(res|response)$/.test(name)) {
        replacement = 'import("express").Response';
        kind = "response";
      } else if (name === "next") {
        replacement = 'import("express").NextFunction';
        kind = "next";
      }
      add(node.type, replacement, 10, kind);
    }

    // Phase 11 — React/UI props, events and callback data boundaries.
    if (isClientTsx && ts.isParameter(node) && anyKeyword(node.type)) {
      add(node.type, uiParameterReplacement(node), 11, ts.isObjectBindingPattern(node.name) ? "props-binding" : "ui-parameter");
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return out;
}

const stats = { 8: 0, 9: 0, 10: 0, 11: 0 };
const kinds = new Map();
let changedFiles = 0;

for (const file of sourceFiles) {
  const original = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    original,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edits = collect(sf, file);
  if (!edits.length) continue;
  for (const edit of edits) {
    stats[edit.phase]++;
    const key = `${edit.phase}:${edit.kind}`;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
  }
  fs.writeFileSync(file, render(original, edits));
  changedFiles++;
}

const remaining = { 8: 0, 9: 0, 10: 0, 11: 0 };
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  for (const edit of collect(sf, file)) remaining[edit.phase]++;
}

for (const phase of [8, 9, 10, 11]) {
  console.log(`PHASE${phase}_REMOVED=${stats[phase]}`);
  console.log(`PHASE${phase}_REMAINING=${remaining[phase]}`);
}
console.log(`CHANGED_FILES=${changedFiles}`);
for (const [kind, count] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`${count}\t${kind}`);
if (Object.values(remaining).some(Boolean)) process.exitCode = 2;
