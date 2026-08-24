#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const configFile = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
if (!configFile) throw new Error("tsconfig.json not found");
const rawConfig = ts.readConfigFile(configFile, ts.sys.readFile);
if (rawConfig.error) throw new Error(ts.flattenDiagnosticMessageText(rawConfig.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(rawConfig.config, ts.sys, path.dirname(configFile));

const serverFiles = parsed.fileNames.filter((file) => {
  const rel = path.relative(root, file).split(path.sep).join("/");
  return rel.startsWith("server/") && !rel.endsWith(".d.ts");
});

const versions = new Map(parsed.fileNames.map((file) => [file, 0]));
const overrides = new Map();
const host = {
  getScriptFileNames: () => parsed.fileNames,
  getScriptVersion: (file) => String(versions.get(file) ?? 0),
  getScriptSnapshot: (file) => {
    const text = overrides.has(file) ? overrides.get(file) : ts.sys.readFile(file);
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
  },
  getCurrentDirectory: () => root,
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry());

function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword));
}

function isInsideExportedSurface(node) {
  let child = node;
  for (let current = node.parent; current; child = current, current = current.parent) {
    if (ts.isInterfaceDeclaration(current) || ts.isTypeAliasDeclaration(current) || ts.isClassDeclaration(current)) {
      if (hasExportModifier(current)) return true;
    }
    if (ts.isFunctionDeclaration(current) && hasExportModifier(current)) {
      if (current.type && (child === current.type || child.pos >= current.type.pos)) return true;
      if (current.parameters.some((p) => child.pos >= p.pos && child.end <= p.end)) return true;
    }
    if (ts.isVariableStatement(current) && hasExportModifier(current)) return true;
  }
  return false;
}

function typeIsUseful(checker, node) {
  const type = checker.getTypeAtLocation(node);
  const flags = type.flags;
  if (flags & ts.TypeFlags.Any) return false;
  if (flags & ts.TypeFlags.Unknown) return false;
  return true;
}

function diagnosticsClean(file) {
  return service.getSyntacticDiagnostics(file).length === 0 && service.getSemanticDiagnostics(file).length === 0;
}

function setText(file, text) {
  overrides.set(file, text);
  versions.set(file, (versions.get(file) ?? 0) + 1);
}

function applyEdits(original, edits) {
  const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let text = original;
  for (const edit of ordered) text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  return text;
}

function annotationStart(decl) {
  const sf = decl.getSourceFile();
  const between = sf.text.slice(decl.name.end, decl.type.end);
  const colon = between.indexOf(":");
  return colon < 0 ? decl.type.pos : decl.name.end + colon;
}

function collectCandidates(file) {
  const program = service.getProgram();
  const sf = program?.getSourceFile(file);
  if (!program || !sf) return [];
  const checker = program.getTypeChecker();
  const candidates = [];
  let id = 0;

  function add(start, end, replacement, kind) {
    if (start >= end) return;
    candidates.push({ id: id++, start, end, replacement, kind });
  }

  function visit(node) {
    if (ts.isAsExpression(node)) {
      if (node.type.kind === ts.SyntaxKind.AnyKeyword && typeIsUseful(checker, node.expression)) {
        add(node.getStart(sf), node.end, node.expression.getText(sf), "remove-as-any");
        return;
      }
      if (
        ts.isArrayTypeNode(node.type) &&
        node.type.elementType.kind === ts.SyntaxKind.AnyKeyword &&
        typeIsUseful(checker, node.expression)
      ) {
        add(node.getStart(sf), node.end, node.expression.getText(sf), "remove-as-any-array");
        return;
      }
    }

    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      node.type &&
      node.initializer &&
      !isInsideExportedSurface(node.type)
    ) {
      const directAny = node.type.kind === ts.SyntaxKind.AnyKeyword;
      const anyArray = ts.isArrayTypeNode(node.type) && node.type.elementType.kind === ts.SyntaxKind.AnyKeyword;
      if ((directAny || anyArray) && typeIsUseful(checker, node.initializer)) {
        add(annotationStart(node), node.type.end, "", "infer-local");
        return;
      }
    }

    if (node.kind === ts.SyntaxKind.AnyKeyword && !isInsideExportedSurface(node)) {
      const parent = node.parent;
      if (ts.isAsExpression(parent) && parent.type === node) return;
      if (ts.isArrayTypeNode(parent) && ts.isAsExpression(parent.parent)) return;
      add(node.getStart(sf), node.end, "unknown", "unknown-boundary");
      return;
    }

    ts.forEachChild(node, visit);
  }
  visit(sf);

  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  const filtered = [];
  for (const candidate of candidates) {
    if (filtered.some((kept) => candidate.start < kept.end && candidate.end > kept.start)) continue;
    filtered.push(candidate);
  }
  return filtered;
}

let kept = 0;
let touchedFiles = 0;
const byKind = new Map();

for (const file of serverFiles) {
  const original = fs.readFileSync(file, "utf8");
  setText(file, original);
  if (!diagnosticsClean(file)) continue;
  const candidates = collectCandidates(file);
  if (candidates.length === 0) continue;

  const accepted = [];
  const trySet = (extra) => {
    const text = applyEdits(original, [...accepted, ...extra]);
    setText(file, text);
    return diagnosticsClean(file);
  };

  const acceptChunk = (chunk) => {
    if (chunk.length === 0) return;
    if (trySet(chunk)) {
      accepted.push(...chunk);
      return;
    }
    setText(file, applyEdits(original, accepted));
    if (chunk.length === 1) return;
    const middle = Math.floor(chunk.length / 2);
    acceptChunk(chunk.slice(0, middle));
    acceptChunk(chunk.slice(middle));
  };

  acceptChunk(candidates);
  const finalText = applyEdits(original, accepted);
  setText(file, finalText);
  if (accepted.length > 0 && finalText !== original) {
    fs.writeFileSync(file, finalText);
    touchedFiles += 1;
    kept += accepted.length;
    for (const edit of accepted) byKind.set(edit.kind, (byKind.get(edit.kind) ?? 0) + 1);
  }
}

console.log(`Phase 2.4 compiler-safe pass kept ${kept} edits across ${touchedFiles} backend files.`);
for (const [kind, count] of [...byKind.entries()].sort()) console.log(`  ${kind}: ${count}`);
