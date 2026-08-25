#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const configFile = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
if (!configFile) throw new Error("tsconfig.json not found");
const rawConfig = ts.readConfigFile(configFile, ts.sys.readFile);
if (rawConfig.error) {
  throw new Error(ts.flattenDiagnosticMessageText(rawConfig.error.messageText, "\n"));
}
const parsed = ts.parseJsonConfigFileContent(rawConfig.config, ts.sys, path.dirname(configFile));

const candidateFiles = parsed.fileNames.filter((file) => {
  const rel = path.relative(root, file).split(path.sep).join("/");
  return (
    !rel.endsWith(".d.ts") &&
    (rel.startsWith("server/") || rel.startsWith("client/src/") || rel.startsWith("shared/"))
  );
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
  return Boolean(
    node.modifiers?.some(
      (modifier) =>
        modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword,
    ),
  );
}

function isExportedClassMember(node) {
  let current = node.parent;
  while (current) {
    if (ts.isClassDeclaration(current) || ts.isInterfaceDeclaration(current)) {
      return hasExportModifier(current);
    }
    if (ts.isSourceFile(current)) break;
    current = current.parent;
  }
  return false;
}

function isExportedSurface(node) {
  let child = node;
  for (let current = node.parent; current; child = current, current = current.parent) {
    if (
      (ts.isInterfaceDeclaration(current) ||
        ts.isTypeAliasDeclaration(current) ||
        ts.isClassDeclaration(current) ||
        ts.isEnumDeclaration(current)) &&
      hasExportModifier(current)
    ) {
      return true;
    }
    if (ts.isFunctionDeclaration(current) && hasExportModifier(current)) return true;
    if (ts.isVariableStatement(current) && hasExportModifier(current)) return true;
    if (ts.isSourceFile(current)) break;
  }
  return false;
}

function isAnyKeyword(node) {
  return node?.kind === ts.SyntaxKind.AnyKeyword;
}

function isAnyArrayType(node) {
  return Boolean(ts.isArrayTypeNode(node) && isAnyKeyword(node.elementType));
}

function isArrayOfAnyReference(node) {
  return Boolean(
    ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === "Array" &&
      node.typeArguments?.length === 1 &&
      isAnyKeyword(node.typeArguments[0]),
  );
}

function isPromiseOfAny(node) {
  return Boolean(
    ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === "Promise" &&
      node.typeArguments?.length === 1 &&
      (isAnyKeyword(node.typeArguments[0]) ||
        isAnyArrayType(node.typeArguments[0]) ||
        isArrayOfAnyReference(node.typeArguments[0])),
  );
}

function isDirectInferableAnyType(node) {
  return isAnyKeyword(node) || isAnyArrayType(node) || isArrayOfAnyReference(node);
}

function typeIsUseful(checker, node) {
  const type = checker.getTypeAtLocation(node);
  if (type.flags & ts.TypeFlags.Any) return false;
  if (type.flags & ts.TypeFlags.Unknown) return false;
  return true;
}

function annotationStart(declaration) {
  const sourceFile = declaration.getSourceFile();
  const between = sourceFile.text.slice(declaration.name.end, declaration.type.end);
  const colon = between.indexOf(":");
  return colon < 0 ? declaration.type.pos : declaration.name.end + colon;
}

function returnTypeStart(node) {
  if (!node.type) return null;
  const sourceFile = node.getSourceFile();
  const anchor = node.parameters.end;
  const between = sourceFile.text.slice(anchor, node.type.end);
  const colon = between.indexOf(":");
  return colon < 0 ? node.type.pos : anchor + colon;
}

function applyEdits(original, edits) {
  const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let text = original;
  for (const edit of ordered) {
    text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  }
  return text;
}

function collectCandidates(file) {
  const program = service.getProgram();
  const sourceFile = program?.getSourceFile(file);
  if (!program || !sourceFile) return [];
  const checker = program.getTypeChecker();
  const candidates = [];
  let id = 0;

  function add(start, end, replacement, kind) {
    if (start >= end) return;
    candidates.push({ id: id++, start, end, replacement, kind });
  }

  function visit(node) {
    if (ts.isAsExpression(node)) {
      if (isAnyKeyword(node.type) && typeIsUseful(checker, node.expression)) {
        add(node.getStart(sourceFile), node.end, node.expression.getText(sourceFile), "remove-as-any");
        return;
      }
      if (isAnyArrayType(node.type) && typeIsUseful(checker, node.expression)) {
        add(node.getStart(sourceFile), node.end, node.expression.getText(sourceFile), "remove-as-any-array");
        return;
      }
    }

    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      node.type &&
      node.initializer &&
      isDirectInferableAnyType(node.type) &&
      !isExportedSurface(node.type) &&
      typeIsUseful(checker, node.initializer)
    ) {
      add(annotationStart(node), node.type.end, "", "infer-initialized-declaration");
      return;
    }

    if (
      ts.isParameter(node) &&
      node.type &&
      isDirectInferableAnyType(node.type) &&
      !isExportedSurface(node.type) &&
      !isExportedClassMember(node)
    ) {
      add(annotationStart(node), node.type.end, "", "infer-contextual-parameter");
      return;
    }

    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node)) &&
      node.type &&
      (isDirectInferableAnyType(node.type) || isPromiseOfAny(node.type)) &&
      !hasExportModifier(node) &&
      !isExportedClassMember(node)
    ) {
      const start = returnTypeStart(node);
      if (start !== null) {
        add(start, node.type.end, "", "infer-return-type");
        return;
      }
    }

    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      node.typeArguments?.length &&
      node.typeArguments.every((argument) => isAnyKeyword(argument))
    ) {
      const first = node.typeArguments[0];
      const last = node.typeArguments[node.typeArguments.length - 1];
      const start = sourceFile.text.lastIndexOf("<", first.getStart(sourceFile));
      const end = sourceFile.text.indexOf(">", last.end) + 1;
      if (start >= node.expression.end && end > last.end) {
        add(start, end, "", "infer-call-type-arguments");
        return;
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
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
const touched = [];

for (const file of candidateFiles) {
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
    const relative = path.relative(root, file).split(path.sep).join("/");
    touched.push(relative);
    touchedFiles += 1;
    kept += accepted.length;
    for (const edit of accepted) {
      byKind.set(edit.kind, (byKind.get(edit.kind) ?? 0) + 1);
    }
  }
}

console.log(`Phase 4 inference pass kept ${kept} edits across ${touchedFiles} files.`);
for (const [kind, count] of [...byKind.entries()].sort()) {
  console.log(`  ${kind}: ${count}`);
}
if (touched.length > 0) {
  console.log("Touched files:");
  for (const file of touched) console.log(`  ${file}`);
}
