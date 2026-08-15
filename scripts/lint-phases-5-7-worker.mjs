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
  .map((f) => path.resolve(f))
  .filter((f) => /\.(?:ts|tsx)$/.test(f) && !f.endsWith(".d.ts") && ROOTS.some((r) => f.startsWith(path.resolve(r) + path.sep)));

const versions = new Map();
const snapshots = new Map();
const host = {
  getCompilationSettings: () => parsed.options,
  getScriptFileNames: () => parsed.fileNames,
  getScriptVersion: (f) => String(versions.get(path.resolve(f)) ?? 0),
  getScriptSnapshot: (f) => {
    const abs = path.resolve(f);
    if (snapshots.has(abs)) return snapshots.get(abs);
    if (!fs.existsSync(abs)) return undefined;
    const snap = ts.ScriptSnapshot.fromString(fs.readFileSync(abs, "utf8"));
    snapshots.set(abs, snap);
    return snap;
  },
  getCurrentDirectory: () => ROOT,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
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
function bump(file) { const abs = path.resolve(file); versions.set(abs, (versions.get(abs) ?? 0) + 1); snapshots.delete(abs); }
function write(file, text) { fs.writeFileSync(file, text); bump(file); }
function diagnosticCounts(file) {
  const out = new Map();
  for (const d of [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)]) {
    const key = `${d.code}:${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}
function noNewDiagnostics(before, after) {
  for (const [key, count] of after) if (count > (before.get(key) ?? 0)) return false;
  return true;
}
function anyKeyword(node) { return node?.kind === ts.SyntaxKind.AnyKeyword; }
function rel(file) { return path.relative(ROOT, file).split(path.sep).join("/"); }
function render(original, edits) {
  let text = original;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.replacement + text.slice(e.end);
  return text;
}

function collectCandidates(sf) {
  const out = [];
  const add = (start, end, replacement, phase, kind) => out.push({ start, end, replacement, phase, kind });
  const visit = (node) => {
    // Phase 5 — dynamic object/API shapes.
    if (ts.isTypeReferenceNode(node) && node.typeName.getText(sf) === "Record" && node.typeArguments?.length === 2 && anyKeyword(node.typeArguments[1])) {
      add(node.typeArguments[1].getStart(sf), node.typeArguments[1].end, "unknown", 5, "Record-value");
    }
    if (ts.isIndexSignatureDeclaration(node) && anyKeyword(node.type)) add(node.type.getStart(sf), node.type.end, "unknown", 5, "index-signature");

    // Phase 6 — Promise/return/generic any.
    if (ts.isFunctionLike(node) && node.type) {
      const colon = node.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.ColonToken && c.end <= node.type.getStart(sf));
      if (anyKeyword(node.type) && colon) add(colon.getStart(sf), node.type.end, "", 6, "return-infer");
      if (ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(sf) === "Promise" && node.type.typeArguments?.length === 1 && anyKeyword(node.type.typeArguments[0])) {
        if (colon) add(colon.getStart(sf), node.type.end, "", 6, "promise-return-infer");
        else add(node.type.typeArguments[0].getStart(sf), node.type.typeArguments[0].end, "unknown", 6, "Promise-value");
      }
    }
    if (ts.isTypeReferenceNode(node) && node.typeArguments?.length) {
      const name = node.typeName.getText(sf);
      if (name !== "Record" && name !== "Promise") node.typeArguments.forEach((arg) => {
        if (anyKeyword(arg)) add(arg.getStart(sf), arg.end, "unknown", 6, `generic:${name}`);
      });
    }

    // Phase 7 — arrays, interfaces and model fields.
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isParameter(node)) && node.type) {
      const anyArray = ts.isArrayTypeNode(node.type) && anyKeyword(node.type.elementType);
      const arrayAny = ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(sf) === "Array" && node.type.typeArguments?.length === 1 && anyKeyword(node.type.typeArguments[0]);
      const colon = node.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.ColonToken && c.end <= node.type.getStart(sf));
      if ((anyArray || arrayAny) && node.initializer && colon) add(colon.getStart(sf), node.type.end, "", 7, "array-infer");
      else if (anyArray) add(node.type.elementType.getStart(sf), node.type.elementType.end, "unknown", 7, "any-array");
      else if (arrayAny) add(node.type.typeArguments[0].getStart(sf), node.type.typeArguments[0].end, "unknown", 7, "Array-any");
    }
    if ((ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) && anyKeyword(node.type)) add(node.type.getStart(sf), node.type.end, "unknown", 7, "model-field");
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const seen = new Set();
  return out.filter((c) => {
    const key = `${c.start}:${c.end}:${c.replacement}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const stats = { 5: { seen: 0, accepted: 0 }, 6: { seen: 0, accepted: 0 }, 7: { seen: 0, accepted: 0 } };
const kinds = new Map();
const unresolved = [];
let filesProcessed = 0;

for (const file of sourceFiles) {
  const original = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const candidates = collectCandidates(sf);
  if (!candidates.length) continue;
  for (const c of candidates) stats[c.phase].seen++;
  const baseline = diagnosticCounts(file);
  const accepted = [];

  function tryGroup(group) {
    if (!group.length) return;
    const trialEdits = [...accepted, ...group];
    write(file, render(original, trialEdits));
    if (noNewDiagnostics(baseline, diagnosticCounts(file))) {
      accepted.push(...group);
      return;
    }
    write(file, render(original, accepted));
    if (group.length === 1) {
      const c = group[0];
      unresolved.push(`${rel(file)}\tphase${c.phase}\t${c.kind}`);
      return;
    }
    const mid = Math.floor(group.length / 2);
    tryGroup(group.slice(0, mid));
    tryGroup(group.slice(mid));
  }

  tryGroup(candidates);
  const finalText = render(original, accepted);
  write(file, finalText);
  for (const c of accepted) {
    stats[c.phase].accepted++;
    const key = `${c.phase}:${c.kind}`;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
  }
  filesProcessed++;
  if (filesProcessed % 40 === 0) console.log(`FILES_PROCESSED=${filesProcessed}`);
}

for (const p of [5, 6, 7]) console.log(`PHASE${p}_SEEN=${stats[p].seen} PHASE${p}_ACCEPTED=${stats[p].accepted} PHASE${p}_UNRESOLVED=${stats[p].seen - stats[p].accepted}`);
for (const [k, v] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`${v}\t${k}`);
fs.writeFileSync("phase5-7-unresolved.tsv", unresolved.join("\n") + (unresolved.length ? "\n" : ""));
console.log(`UNRESOLVED_TOTAL=${unresolved.length}`);
