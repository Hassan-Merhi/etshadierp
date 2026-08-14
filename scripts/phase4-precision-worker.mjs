#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root = process.cwd();
const cfg = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
if (cfg.error) throw new Error(ts.flattenDiagnosticMessageText(cfg.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root);
const files = parsed.fileNames.filter((f) => /\.(?:ts|tsx)$/.test(f) && !f.endsWith(".d.ts"));
const texts = new Map();
const versions = new Map();
const rel = (f) => path.relative(root, f).split(path.sep).join("/");
function read(f) { if (!texts.has(f)) texts.set(f, fs.readFileSync(f, "utf8")); return texts.get(f); }
function set(f, text) { texts.set(f, text); versions.set(f, (versions.get(f) || 0) + 1); }
const host = {
  getScriptFileNames: () => parsed.fileNames,
  getScriptVersion: (f) => String(versions.get(f) || 0),
  getScriptSnapshot: (f) => { try { return ts.ScriptSnapshot.fromString(read(f)); } catch { return undefined; } },
  getCurrentDirectory: () => root,
  getCompilationSettings: () => parsed.options,
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
const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
function diagnostics(f) { return [...ls.getSyntacticDiagnostics(f), ...ls.getSemanticDiagnostics(f)]; }
function candidates(f, source) {
  const sf = ts.createSourceFile(f, source, ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = (node) => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      const tok = node.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.AsKeyword);
      if (tok) out.push({ start: tok.getStart(sf), end: node.type.end, expr: node.expression.getText(sf).replace(/\s+/g, " ").slice(0, 100) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out.sort((a,b) => b.start-a.start);
}
let baseline = 0, removed = 0, wholeFiles = 0, precisionFiles = 0;
const survivors = [];
for (const f of files) {
  const original = read(f);
  const cs = candidates(f, original);
  if (!cs.length) continue;
  baseline += cs.length;
  let all = original;
  for (const c of cs) all = all.slice(0,c.start) + all.slice(c.end);
  set(f, all);
  if (diagnostics(f).length === 0) {
    removed += cs.length; wholeFiles += 1; continue;
  }
  set(f, original);
  precisionFiles += 1;
  let current = original;
  for (const c of cs) {
    const before = current;
    current = current.slice(0,c.start) + current.slice(c.end);
    set(f, current);
    if (diagnostics(f).length === 0) removed += 1;
    else { current = before; set(f, current); survivors.push([rel(f), c.expr]); }
  }
}
for (const f of files) if (texts.has(f) && texts.get(f) !== fs.readFileSync(f, "utf8")) fs.writeFileSync(f, texts.get(f));
console.log(`PHASE4_PRECISION_BASELINE=${baseline}`);
console.log(`PHASE4_PRECISION_REMOVED=${removed}`);
console.log(`PHASE4_PRECISION_REMAINING=${baseline-removed}`);
console.log(`PHASE4_PRECISION_WHOLE_FILES=${wholeFiles}`);
console.log(`PHASE4_PRECISION_MIXED_FILES=${precisionFiles}`);
const check = spawnSync("npm", ["run","check"], {encoding:"utf8", maxBuffer:128*1024*1024});
console.log(`${check.stdout||""}${check.stderr||""}`);
console.log("=== SURVIVOR SAMPLE ===");
for (const [file, expr] of survivors.slice(0,300)) console.log(`${file}\t${expr}`);
if ((check.status ?? 1) !== 0) process.exit(check.status ?? 1);
