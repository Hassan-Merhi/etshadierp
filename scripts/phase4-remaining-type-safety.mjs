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
const normalize = (file) => path.relative(root, file).split(path.sep).join("/");
const candidateFiles = parsed.fileNames.filter((file) => {
  const rel = normalize(file);
  return (
    !rel.endsWith(".d.ts") &&
    (rel.startsWith("server/") || rel.startsWith("client/src/") || rel.startsWith("shared/"))
  );
});

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
  for (let current = node.parent; current; current = current.parent) {
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

const isAnyKeyword = (node) => node?.kind === ts.SyntaxKind.AnyKeyword;
const isAnyArrayType = (node) => Boolean(ts.isArrayTypeNode(node) && isAnyKeyword(node.elementType));
const isArrayOfAnyReference = (node) =>
  Boolean(
    ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === "Array" &&
      node.typeArguments?.length === 1 &&
      isAnyKeyword(node.typeArguments[0]),
  );
const isPromiseOfAny = (node) =>
  Boolean(
    ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === "Promise" &&
      node.typeArguments?.length === 1 &&
      (isAnyKeyword(node.typeArguments[0]) ||
        isAnyArrayType(node.typeArguments[0]) ||
        isArrayOfAnyReference(node.typeArguments[0])),
  );
const isDirectInferableAnyType = (node) =>
  isAnyKeyword(node) || isAnyArrayType(node) || isArrayOfAnyReference(node);

function typeIsUseful(checker, node) {
  const type = checker.getTypeAtLocation(node);
  return !(type.flags & ts.TypeFlags.Any) && !(type.flags & ts.TypeFlags.Unknown);
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

let inferenceProgram = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
let checker = inferenceProgram.getTypeChecker();

function collectCandidates(sourceFile) {
  const candidates = [];
  let id = 0;
  const add = (start, end, replacement, kind) => {
    if (start < end) candidates.push({ id: id++, start, end, replacement, kind });
  };

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
      if (start !== null) add(start, node.type.end, "", "infer-return-type");
      return;
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

const originals = new Map();
const editsByFile = new Map();
let filesContainingAnyText = 0;

for (const file of candidateFiles) {
  const original = fs.readFileSync(file, "utf8");
  if (!/\bany\b/.test(original)) continue;
  filesContainingAnyText += 1;
  const sourceFile = inferenceProgram.getSourceFile(file);
  if (!sourceFile) continue;
  const candidates = collectCandidates(sourceFile);
  if (candidates.length === 0) continue;
  const edited = applyEdits(original, candidates);
  if (edited === original) continue;
  originals.set(file, original);
  editsByFile.set(file, candidates);
  fs.writeFileSync(file, edited);
}

// Candidate collection is finished. Drop the original compiler graph before
// constructing a second whole-project program for certification; retaining two
// complete graphs is enough to exhaust the runner heap on this repository.
checker = null;
inferenceProgram = null;
if (typeof global.gc === "function") global.gc();

function projectDiagnosticSummaries() {
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  return diagnostics.map((diagnostic) => ({
    fileName: diagnostic.file?.fileName ?? null,
    start: diagnostic.start ?? null,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  }));
}

let round = 0;
let certified = false;
while (editsByFile.size > 0) {
  round += 1;
  const diagnostics = projectDiagnosticSummaries();
  if (diagnostics.length === 0) {
    certified = true;
    break;
  }

  const rejected = new Set();
  const unowned = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.fileName && editsByFile.has(diagnostic.fileName)) rejected.add(diagnostic.fileName);
    else unowned.push(diagnostic);
  }

  if (rejected.size === 0) {
    for (const [file, original] of originals) fs.writeFileSync(file, original);
    const first = unowned[0] ?? diagnostics[0];
    const where = first.fileName ? `${normalize(first.fileName)}:${first.start ?? 0}` : "project";
    throw new Error(
      `Bulk Phase 4 edits caused ${diagnostics.length} diagnostic(s) outside edited files; restored the entire pass. ` +
        `First diagnostic at ${where}: ${first.message}`,
    );
  }

  console.log(
    `Compiler rejection round ${round}: restoring ${rejected.size} edited file(s) responsible for ${diagnostics.length} diagnostic(s).`,
  );
  for (const file of rejected) {
    fs.writeFileSync(file, originals.get(file));
    editsByFile.delete(file);
  }
  if (typeof global.gc === "function") global.gc();
  if (round > 20) throw new Error("Phase 4 compiler-recovery loop exceeded 20 rounds");
}

if (editsByFile.size === 0) {
  certified = true;
}
if (!certified) throw new Error("Phase 4 inference pass did not reach a compiler-clean state");

const byKind = new Map();
let kept = 0;
for (const edits of editsByFile.values()) {
  kept += edits.length;
  for (const edit of edits) byKind.set(edit.kind, (byKind.get(edit.kind) ?? 0) + 1);
}

console.log(
  `Phase 4 bulk inference kept ${kept} edits across ${editsByFile.size} files ` +
    `(${filesContainingAnyText} files contained the token any; ${originals.size - editsByFile.size} edited files were restored by compiler proof).`,
);
for (const [kind, count] of [...byKind.entries()].sort()) console.log(`  ${kind}: ${count}`);
if (editsByFile.size > 0) {
  console.log("Touched files:");
  for (const file of [...editsByFile.keys()].sort()) console.log(`  ${normalize(file)}`);
}
