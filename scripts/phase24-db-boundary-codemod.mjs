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

const targetPrefix = process.env.PHASE24_PATH_FILTER || "server/routes/";
const targetFiles = parsed.fileNames.filter((file) => {
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (!rel.startsWith(targetPrefix) || rel.endsWith(".d.ts")) return false;
  return fs.readFileSync(file, "utf8").includes("db: any");
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

function setText(file, text) {
  overrides.set(file, text);
  versions.set(file, (versions.get(file) ?? 0) + 1);
}

function diagnosticsClean(file) {
  return service.getSyntacticDiagnostics(file).length === 0 && service.getSemanticDiagnostics(file).length === 0;
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
      if (current.parameters.some((p) => child.pos >= p.pos && child.end <= p.end)) return true;
      if (current.type && child.pos >= current.type.pos && child.end <= current.type.end) return true;
    }
    if (ts.isVariableStatement(current) && hasExportModifier(current)) return true;
  }
  return false;
}

function typeIsUseful(checker, node) {
  const type = checker.getTypeAtLocation(node);
  return !(type.flags & ts.TypeFlags.Any) && !(type.flags & ts.TypeFlags.Unknown);
}

function dbTypeFor(file) {
  let spec = path.relative(path.dirname(file), path.join(root, "server/db")).split(path.sep).join("/");
  if (!spec.startsWith(".")) spec = `./${spec}`;
  return `import("${spec}").Database`;
}

let dbTyped = 0;
let inferred = 0;
let touched = 0;
const skipped = [];

for (const file of targetFiles) {
  const original = fs.readFileSync(file, "utf8");
  const dbTypedText = original.replace(/\bdb\s*:\s*any\b/g, `db: ${dbTypeFor(file)}`);
  setText(file, dbTypedText);
  if (!diagnosticsClean(file)) {
    setText(file, original);
    skipped.push(path.relative(root, file));
    continue;
  }

  const program = service.getProgram();
  const sf = program?.getSourceFile(file);
  if (!program || !sf) continue;
  const checker = program.getTypeChecker();
  const candidates = [];

  function add(start, end, replacement) {
    if (start < end) candidates.push({ start, end, replacement });
  }

  function visit(node) {
    if (ts.isAsExpression(node)) {
      if (node.type.kind === ts.SyntaxKind.AnyKeyword && typeIsUseful(checker, node.expression)) {
        add(node.getStart(sf), node.end, node.expression.getText(sf));
        return;
      }
      if (
        ts.isArrayTypeNode(node.type) &&
        node.type.elementType.kind === ts.SyntaxKind.AnyKeyword &&
        typeIsUseful(checker, node.expression)
      ) {
        add(node.getStart(sf), node.end, node.expression.getText(sf));
        return;
      }
    }

    if (ts.isParameter(node) && node.type && !isInsideExportedSurface(node.type)) {
      const directAny = node.type.kind === ts.SyntaxKind.AnyKeyword;
      const anyArray = ts.isArrayTypeNode(node.type) && node.type.elementType.kind === ts.SyntaxKind.AnyKeyword;
      if (directAny || anyArray) {
        add(annotationStart(node), node.type.end, "");
        return;
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      node.type &&
      node.initializer &&
      !isInsideExportedSurface(node.type)
    ) {
      const directAny = node.type.kind === ts.SyntaxKind.AnyKeyword;
      const anyArray = ts.isArrayTypeNode(node.type) && node.type.elementType.kind === ts.SyntaxKind.AnyKeyword;
      if ((directAny || anyArray) && typeIsUseful(checker, node.initializer)) {
        add(annotationStart(node), node.type.end, "");
        return;
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(sf);

  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  const nonOverlapping = [];
  for (const candidate of candidates) {
    if (nonOverlapping.some((kept) => candidate.start < kept.end && candidate.end > kept.start)) continue;
    nonOverlapping.push(candidate);
  }

  const accepted = [];
  const tryChunk = (chunk) => {
    setText(file, applyEdits(dbTypedText, [...accepted, ...chunk]));
    return diagnosticsClean(file);
  };
  const acceptChunk = (chunk) => {
    if (!chunk.length) return;
    if (tryChunk(chunk)) {
      accepted.push(...chunk);
      return;
    }
    setText(file, applyEdits(dbTypedText, accepted));
    if (chunk.length === 1) return;
    const mid = Math.floor(chunk.length / 2);
    acceptChunk(chunk.slice(0, mid));
    acceptChunk(chunk.slice(mid));
  };
  acceptChunk(nonOverlapping);

  const finalText = applyEdits(dbTypedText, accepted);
  setText(file, finalText);
  if (finalText !== original) {
    fs.writeFileSync(file, finalText);
    touched += 1;
    dbTyped += (original.match(/\bdb\s*:\s*any\b/g) ?? []).length;
    inferred += accepted.length;
  }
}

console.log(`Phase 2.4 DB-boundary pass touched ${touched}/${targetFiles.length} files.`);
console.log(`  db boundaries typed: ${dbTyped}`);
console.log(`  compiler-accepted inferred annotations/assertions: ${inferred}`);
if (skipped.length) console.log(`  skipped files: ${skipped.join(", ")}`);
