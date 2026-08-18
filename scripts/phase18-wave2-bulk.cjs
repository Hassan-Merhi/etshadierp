const ts = require("typescript");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
if (!configPath) throw new Error("tsconfig.json not found");
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
const mode = process.env.PHASE18_MODE || "safe";

function rel(file) { return path.relative(root, file).replaceAll("\\", "/"); }
function eligible(file) {
  const r = rel(file);
  return /^(client\/src|server|shared)\//.test(r) && /\.(ts|tsx)$/.test(r) && !r.endsWith(".d.ts") && fs.existsSync(file);
}
function contains(outer, inner) { return outer && inner && outer.pos <= inner.pos && outer.end >= inner.end; }
function ancestor(node, predicate, limit = 8) {
  let current = node.parent;
  for (let depth = 0; current && depth < limit; depth += 1, current = current.parent) {
    if (predicate(current)) return current;
  }
  return null;
}
function annotationStart(source, typeNode) {
  let i = typeNode.getStart() - 1;
  while (i >= 0 && /\s/.test(source[i])) i -= 1;
  return source[i] === ":" ? i : null;
}
function annotationOwner(node, sourceFile) {
  let typeNode = node;
  for (let depth = 0; depth < 7 && typeNode.parent; depth += 1) {
    const owner = typeNode.parent;
    if (owner.type === typeNode) {
      const start = annotationStart(sourceFile.text, typeNode);
      if (start === null) return null;
      if (ts.isVariableDeclaration(owner) && owner.initializer) return { start, end: typeNode.end, repl: "", label: "infer-variable", risk: "safe" };
      if (ts.isPropertyDeclaration(owner) && owner.initializer) return { start, end: typeNode.end, repl: "", label: "infer-property", risk: "safe" };
      if (ts.isParameter(owner)) return { start, end: typeNode.end, repl: "", label: "infer-parameter", risk: "param" };
      if (
        ts.isFunctionDeclaration(owner) || ts.isFunctionExpression(owner) || ts.isArrowFunction(owner) ||
        ts.isMethodDeclaration(owner) || ts.isGetAccessorDeclaration(owner) || ts.isSetAccessorDeclaration(owner)
      ) return { start, end: typeNode.end, repl: "", label: "infer-return", risk: "safe" };
    }
    typeNode = owner;
  }
  return null;
}
function callTypeArgument(node, sourceFile) {
  let current = node;
  for (let depth = 0; depth < 6 && current.parent; depth += 1) {
    const parent = current.parent;
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.typeArguments?.length === 1) {
      const arg = parent.typeArguments[0];
      if (!contains(arg, node)) return null;
      const start = parent.typeArguments.pos - 1;
      const end = parent.typeArguments.end + 1;
      if (sourceFile.text[start] === "<" && sourceFile.text[end - 1] === ">") return { start, end, repl: "", label: "infer-call-typeargs", risk: "safe" };
    }
    current = parent;
  }
  return null;
}
function typeArgumentOwner(node) {
  return ancestor(node, (owner) => {
    const args = owner.typeArguments;
    return Array.isArray(args) || (args && typeof args.some === "function")
      ? [...args].some((arg) => contains(arg, node))
      : false;
  });
}
function editFor(node, sourceFile) {
  const parent = node.parent;
  if (mode === "cast") {
    if ((ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) && parent.type === node) {
      return { start: parent.getStart(sourceFile), end: parent.end, repl: `(${parent.expression.getText(sourceFile)})`, label: "remove-cast" };
    }
    return null;
  }
  if (mode === "array") {
    const owner = ancestor(node, (candidate) => ts.isArrayTypeNode(candidate) && contains(candidate.elementType, node));
    return owner ? { start: node.getStart(sourceFile), end: node.end, repl: "unknown", label: "array-unknown" } : null;
  }
  if (mode === "generic") {
    return typeArgumentOwner(node) ? { start: node.getStart(sourceFile), end: node.end, repl: "unknown", label: "generic-unknown" } : null;
  }
  if (mode === "property") {
    const owner = ancestor(node, (candidate) =>
      (ts.isPropertySignature(candidate) || ts.isIndexSignatureDeclaration(candidate)) && candidate.type && contains(candidate.type, node)
    );
    return owner ? { start: node.getStart(sourceFile), end: node.end, repl: "unknown", label: "property-unknown" } : null;
  }
  if (mode === "union") {
    return ancestor(node, (candidate) => ts.isUnionTypeNode(candidate))
      ? { start: node.getStart(sourceFile), end: node.end, repl: "unknown", label: "union-unknown" }
      : null;
  }
  if (mode === "unknown") return { start: node.getStart(sourceFile), end: node.end, repl: "unknown", label: "unknown" };
  const owner = annotationOwner(node, sourceFile);
  if (mode === "param") return owner?.risk === "param" ? owner : null;
  if (mode === "safe") {
    if (owner?.risk === "safe") return owner;
    return callTypeArgument(node, sourceFile);
  }
  return null;
}
function collect(file, text) {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const raw = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const edit = editFor(node, sourceFile);
      if (edit) raw.push(edit);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const unique = new Map();
  for (const edit of raw) {
    const key = `${edit.start}:${edit.end}:${edit.repl}`;
    if (!unique.has(key)) unique.set(key, edit);
  }
  const ordered = [...unique.values()].sort((a, b) => a.start - b.start || b.end - a.end);
  const selected = [];
  let coveredUntil = -1;
  for (const edit of ordered) {
    if (edit.start < coveredUntil) continue;
    selected.push(edit);
    coveredUntil = edit.end;
  }
  return selected.sort((a, b) => b.start - a.start || b.end - a.end);
}
function apply(text, edits) {
  let next = text;
  for (const edit of edits) next = next.slice(0, edit.start) + edit.repl + next.slice(edit.end);
  return next;
}

const state = new Map();
for (const file of parsed.fileNames) {
  if (!fs.existsSync(file)) continue;
  state.set(path.resolve(file), { text: fs.readFileSync(file, "utf8"), version: 0 });
}
const host = {
  getCompilationSettings: () => parsed.options,
  getScriptFileNames: () => parsed.fileNames,
  getScriptVersion: (file) => String(state.get(path.resolve(file))?.version ?? 0),
  getScriptSnapshot: (file) => {
    const entry = state.get(path.resolve(file));
    if (entry) return ts.ScriptSnapshot.fromString(entry.text);
    if (fs.existsSync(file)) return ts.ScriptSnapshot.fromString(fs.readFileSync(file, "utf8"));
  },
  getCurrentDirectory: () => root,
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
function setText(file, text) {
  const key = path.resolve(file);
  const entry = state.get(key) || { text: fs.readFileSync(file, "utf8"), version: 0 };
  if (entry.text === text) return;
  entry.text = text;
  entry.version += 1;
  state.set(key, entry);
}
function errorCount() {
  const program = service.getProgram();
  if (!program) throw new Error("TypeScript language service did not create a program");
  const diagnostics = ts.getPreEmitDiagnostics(program);
  return diagnostics.reduce((count, diagnostic) => count + (diagnostic.category === ts.DiagnosticCategory.Error ? 1 : 0), 0);
}

const proposals = [];
for (const file of parsed.fileNames) {
  if (!eligible(file)) continue;
  const original = fs.readFileSync(file, "utf8");
  const edits = collect(file, original);
  if (!edits.length) continue;
  const transformed = apply(original, edits);
  if (transformed === original) continue;
  proposals.push({ file, original, transformed, edits });
}

const stats = { mode, proposedFiles: proposals.length, proposedEdits: proposals.reduce((n, p) => n + p.edits.length, 0), acceptedFiles: 0, acceptedEdits: 0, rejectedFiles: 0, checks: 0, labels: {} };
const accepted = new Set();
const profiles = {
  safe: { chunk: 128, maxDepth: 7 },
  param: { chunk: 64, maxDepth: 5 },
  array: { chunk: 128, maxDepth: 7 },
  generic: { chunk: 96, maxDepth: 6 },
  property: { chunk: 64, maxDepth: 5 },
  union: { chunk: 48, maxDepth: 4 },
  cast: { chunk: 64, maxDepth: 5 },
  unknown: { chunk: 48, maxDepth: 3 },
};
const profile = profiles[mode] || profiles.unknown;

function testGroup(group, depth) {
  if (!group.length) return;
  for (const proposal of group) setText(proposal.file, proposal.transformed);
  stats.checks += 1;
  const errors = errorCount();
  if (errors === 0) {
    for (const proposal of group) accepted.add(proposal.file);
    return;
  }
  for (const proposal of group) setText(proposal.file, proposal.original);
  if (group.length === 1 || depth >= profile.maxDepth) {
    stats.rejectedFiles += group.length;
    return;
  }
  const midpoint = Math.ceil(group.length / 2);
  testGroup(group.slice(0, midpoint), depth + 1);
  testGroup(group.slice(midpoint), depth + 1);
}

for (let i = 0; i < proposals.length; i += profile.chunk) testGroup(proposals.slice(i, i + profile.chunk), 0);

for (const proposal of proposals) {
  if (!accepted.has(proposal.file)) continue;
  const text = state.get(path.resolve(proposal.file))?.text;
  if (text !== proposal.transformed) throw new Error(`Accepted proposal state drifted for ${rel(proposal.file)}`);
  fs.writeFileSync(proposal.file, proposal.transformed);
  stats.acceptedFiles += 1;
  stats.acceptedEdits += proposal.edits.length;
  for (const edit of proposal.edits) stats.labels[edit.label] = (stats.labels[edit.label] || 0) + 1;
  console.log(`GLOBAL_ACCEPT mode=${mode} ${rel(proposal.file)} edits=${proposal.edits.length}`);
}
console.log(`GLOBAL_RESULT ${JSON.stringify(stats)}`);
