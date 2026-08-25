#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const scope = process.env.PHASE4_SCOPE ?? "client";
const bucket = Number(process.env.PHASE4_BUCKET ?? "0");
const bucketCount = Number(process.env.PHASE4_BUCKET_COUNT ?? "1");
if (!Number.isInteger(bucket) || !Number.isInteger(bucketCount) || bucket < 0 || bucketCount < 1 || bucket >= bucketCount) {
  throw new Error(`Invalid bucket ${bucket}/${bucketCount}`);
}

const configFile = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
if (!configFile) throw new Error("tsconfig.json not found");
const rawConfig = ts.readConfigFile(configFile, ts.sys.readFile);
if (rawConfig.error) throw new Error(ts.flattenDiagnosticMessageText(rawConfig.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(rawConfig.config, ts.sys, path.dirname(configFile));
const rel = (file) => path.relative(root, file).split(path.sep).join("/");

function pathBucket(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % bucketCount;
}

const sourceFiles = parsed.fileNames.filter((file) => {
  const p = rel(file);
  if (p.endsWith(".d.ts") || !/\b(any)\b/.test(ts.sys.readFile(file) ?? "")) return false;
  const inScope =
    scope === "client"
      ? p.startsWith("client/src/")
      : scope === "server"
        ? p.startsWith("server/") || p.startsWith("shared/")
        : p.startsWith("client/src/") || p.startsWith("server/") || p.startsWith("shared/");
  return inScope && pathBucket(p) === bucket;
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
function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword));
}
function isPublicSignature(node) {
  let child = node;
  for (let current = node.parent; current; child = current, current = current.parent) {
    if ((ts.isInterfaceDeclaration(current) || ts.isTypeAliasDeclaration(current) || ts.isClassDeclaration(current)) && hasExportModifier(current)) {
      return true;
    }
    if (ts.isFunctionDeclaration(current) && hasExportModifier(current)) {
      if (current.type && child.pos >= current.type.pos && child.end <= current.type.end) return true;
      if (current.parameters.some((p) => child.pos >= p.pos && child.end <= p.end)) return true;
      return false;
    }
    if (ts.isVariableStatement(current) && hasExportModifier(current)) {
      const declaration = current.declarationList.declarations.find((d) => child.pos >= d.pos && child.end <= d.end);
      if (declaration?.type && child.pos >= declaration.type.pos && child.end <= declaration.type.end) return true;
      return false;
    }
    if (ts.isSourceFile(current)) break;
  }
  return false;
}
function isAny(node) {
  return node?.kind === ts.SyntaxKind.AnyKeyword;
}
function isAnyArray(node) {
  return Boolean(ts.isArrayTypeNode(node) && isAny(node.elementType));
}
function isArrayRefAny(node) {
  return Boolean(ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === "Array" && node.typeArguments?.length === 1 && isAny(node.typeArguments[0]));
}
function isPromiseEscape(node) {
  return Boolean(
    ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === "Promise" &&
      node.typeArguments?.length === 1 &&
      (isAny(node.typeArguments[0]) || isAnyArray(node.typeArguments[0]) || isArrayRefAny(node.typeArguments[0])),
  );
}
function isInferableEscapeType(node) {
  return isAny(node) || isAnyArray(node) || isArrayRefAny(node);
}
function typeIsUseful(checker, node) {
  const type = checker.getTypeAtLocation(node);
  return !(type.flags & ts.TypeFlags.Any) && !(type.flags & ts.TypeFlags.Unknown);
}
function annotationStart(decl) {
  const sf = decl.getSourceFile();
  const between = sf.text.slice(decl.name.end, decl.type.end);
  const colon = between.indexOf(":");
  return colon < 0 ? decl.type.pos : decl.name.end + colon;
}
function returnTypeStart(node) {
  if (!node.type) return null;
  const sf = node.getSourceFile();
  const anchor = node.parameters.end;
  const between = sf.text.slice(anchor, node.type.end);
  const colon = between.indexOf(":");
  return colon < 0 ? node.type.pos : anchor + colon;
}
function applyEdits(original, edits) {
  const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let text = original;
  for (const edit of ordered) text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  return text;
}

function collectCandidates(file) {
  const program = service.getProgram();
  const sf = program?.getSourceFile(file);
  if (!program || !sf) return [];
  const checker = program.getTypeChecker();
  const candidates = [];
  let id = 0;
  const add = (start, end, replacement, kind) => {
    if (start < end) candidates.push({ id: id++, start, end, replacement, kind });
  };

  function visit(node) {
    if (ts.isAsExpression(node) && !isPublicSignature(node)) {
      if (isAny(node.type) && typeIsUseful(checker, node.expression)) {
        add(node.getStart(sf), node.end, node.expression.getText(sf), "remove-as-any");
        return;
      }
      if ((isAnyArray(node.type) || isArrayRefAny(node.type)) && typeIsUseful(checker, node.expression)) {
        add(node.getStart(sf), node.end, node.expression.getText(sf), "remove-as-any-array");
        return;
      }
    }

    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      node.type && node.initializer && !isPublicSignature(node.type) && isInferableEscapeType(node.type)
    ) {
      if (ts.isArrayLiteralExpression(node.initializer) && node.initializer.elements.length === 0) {
        // Removing `any[]` here creates an evolving implicit-any collection rather than a real type.
      } else if (typeIsUseful(checker, node.initializer)) {
        add(annotationStart(node), node.type.end, "", "infer-initialized-declaration");
        return;
      }
    }

    if (ts.isParameter(node) && node.type && !isPublicSignature(node.type) && isInferableEscapeType(node.type)) {
      add(annotationStart(node), node.type.end, "", "infer-contextual-parameter");
      return;
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) &&
      node.type && !isPublicSignature(node.type) && (isInferableEscapeType(node.type) || isPromiseEscape(node.type))
    ) {
      const start = returnTypeStart(node);
      if (start !== null) add(start, node.type.end, "", "infer-return-type");
      return;
    }

    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && !isPublicSignature(node) && node.typeArguments?.length) {
      const args = [...node.typeArguments];
      if (args.every((arg) => isInferableEscapeType(arg))) {
        const first = args[0];
        const last = args[args.length - 1];
        const start = sf.text.lastIndexOf("<", first.getStart(sf));
        const end = sf.text.indexOf(">", last.end) + 1;
        if (start >= node.expression.end && end > last.end) {
          add(start, end, "", "infer-call-type-arguments");
          return;
        }
      }
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
let testedCandidates = 0;
const byKind = new Map();
const touched = [];

for (const file of sourceFiles) {
  const original = fs.readFileSync(file, "utf8");
  setText(file, original);
  if (!diagnosticsClean(file)) continue;
  const candidates = collectCandidates(file);
  if (candidates.length === 0) continue;
  testedCandidates += candidates.length;
  const accepted = [];

  const trySet = (extra) => {
    setText(file, applyEdits(original, [...accepted, ...extra]));
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
    const mid = Math.floor(chunk.length / 2);
    acceptChunk(chunk.slice(0, mid));
    acceptChunk(chunk.slice(mid));
  };

  acceptChunk(candidates);
  const finalText = applyEdits(original, accepted);
  setText(file, finalText);
  if (accepted.length && finalText !== original) {
    fs.writeFileSync(file, finalText);
    touchedFiles += 1;
    kept += accepted.length;
    touched.push(rel(file));
    for (const edit of accepted) byKind.set(edit.kind, (byKind.get(edit.kind) ?? 0) + 1);
  }
}

console.log(`PHASE4_BISECT scope=${scope} bucket=${bucket}/${bucketCount} tested=${testedCandidates} kept=${kept} files=${touchedFiles}`);
for (const [kind, count] of [...byKind.entries()].sort()) console.log(`  ${kind}: ${count}`);
for (const file of touched.sort()) console.log(`  FILE ${file}`);
