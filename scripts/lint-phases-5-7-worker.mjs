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

function bump(file) {
  const abs = path.resolve(file);
  versions.set(abs, (versions.get(abs) ?? 0) + 1);
  snapshots.delete(abs);
}
function write(file, text) { fs.writeFileSync(file, text); bump(file); }
function diagKeys(file) {
  return new Set([...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)].map((d) => `${d.code}:${d.start ?? -1}:${d.length ?? -1}`));
}
function noNewDiagnostics(before, after) {
  for (const key of after) if (!before.has(key)) return false;
  return true;
}
function anyKeyword(node) { return node?.kind === ts.SyntaxKind.AnyKeyword; }
function rel(file) { return path.relative(ROOT, file).split(path.sep).join("/"); }

function collectCandidates(sf) {
  const out = [];
  const add = (start, end, replacement, phase, kind) => out.push({ start, end, replacement, phase, kind });
  const visit = (node) => {
    // Phase 5: object/API map shapes.
    if (ts.isTypeReferenceNode(node) && node.typeName.getText(sf) === "Record" && node.typeArguments?.length === 2 && anyKeyword(node.typeArguments[1])) {
      add(node.typeArguments[1].getStart(sf), node.typeArguments[1].end, "unknown", 5, "Record-value");
    }
    if (ts.isIndexSignatureDeclaration(node) && anyKeyword(node.type)) {
      add(node.type.getStart(sf), node.type.end, "unknown", 5, "index-signature");
    }

    // Phase 6: promise/return/generic any.
    if (ts.isFunctionLike(node) && node.type) {
      if (anyKeyword(node.type)) {
        const colon = node.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.ColonToken && c.end <= node.type.getStart(sf));
        if (colon) add(colon.getStart(sf), node.type.end, "", 6, "return-infer");
      } else if (ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(sf) === "Promise" && node.type.typeArguments?.length === 1 && anyKeyword(node.type.typeArguments[0])) {
        const colon = node.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.ColonToken && c.end <= node.type.getStart(sf));
        if (colon) add(colon.getStart(sf), node.type.end, "", 6, "promise-return-infer");
        else add(node.type.typeArguments[0].getStart(sf), node.type.typeArguments[0].end, "unknown", 6, "Promise-value");
      }
    }
    if (ts.isTypeReferenceNode(node) && node.typeArguments?.length) {
      const name = node.typeName.getText(sf);
      if (name !== "Record" && name !== "Promise") {
        node.typeArguments.forEach((arg) => {
          if (anyKeyword(arg)) add(arg.getStart(sf), arg.end, "unknown", 6, `generic:${name}`);
        });
      }
    }

    // Phase 7: arrays/model fields. Prefer inference where an initializer exists.
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isParameter(node)) && node.type) {
      const isAnyArray = ts.isArrayTypeNode(node.type) && anyKeyword(node.type.elementType);
      const isArrayAny = ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(sf) === "Array" && node.type.typeArguments?.length === 1 && anyKeyword(node.type.typeArguments[0]);
      if ((isAnyArray || isArrayAny) && node.initializer) {
        const colon = node.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.ColonToken && c.end <= node.type.getStart(sf));
        if (colon) add(colon.getStart(sf), node.type.end, "", 7, "array-infer");
      } else if (isAnyArray) {
        add(node.type.elementType.getStart(sf), node.type.elementType.end, "unknown", 7, "any-array");
      } else if (isArrayAny) {
        add(node.type.typeArguments[0].getStart(sf), node.type.typeArguments[0].end, "unknown", 7, "Array-any");
      }
    }
    if ((ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) && anyKeyword(node.type)) {
      add(node.type.getStart(sf), node.type.end, "unknown", 7, "model-field");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const seen = new Set();
  return out.filter((c) => {
    const k = `${c.start}:${c.end}:${c.replacement}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).sort((a,b) => a.start - b.start);
}

const stats = { 5: { seen: 0, accepted: 0 }, 6: { seen: 0, accepted: 0 }, 7: { seen: 0, accepted: 0 } };
const kinds = new Map();
const unresolved = [];

for (const file of sourceFiles) {
  let text = fs.readFileSync(file, "utf8");
  let sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let candidates = collectCandidates(sf);
  if (!candidates.length) continue;
  const baseline = diagKeys(file);
  let offset = 0;
  for (const c0 of candidates) {
    const c = { ...c0, start: c0.start + offset, end: c0.end + offset };
    stats[c.phase].seen++;
    const trial = text.slice(0, c.start) + c.replacement + text.slice(c.end);
    write(file, trial);
    const after = diagKeys(file);
    if (noNewDiagnostics(baseline, after)) {
      offset += c.replacement.length - (c.end - c.start);
      text = trial;
      stats[c.phase].accepted++;
      kinds.set(`${c.phase}:${c.kind}`, (kinds.get(`${c.phase}:${c.kind}`) ?? 0) + 1);
    } else {
      write(file, text);
      unresolved.push(`${rel(file)}\tphase${c.phase}\t${c.kind}`);
    }
  }
  write(file, text);
}

for (const p of [5,6,7]) console.log(`PHASE${p}_SEEN=${stats[p].seen} PHASE${p}_ACCEPTED=${stats[p].accepted} PHASE${p}_UNRESOLVED=${stats[p].seen-stats[p].accepted}`);
for (const [k,v] of [...kinds].sort((a,b)=>b[1]-a[1])) console.log(`${v}\t${k}`);
fs.writeFileSync("phase5-7-unresolved.tsv", unresolved.join("\n") + (unresolved.length ? "\n" : ""));
console.log(`UNRESOLVED_TOTAL=${unresolved.length}`);
