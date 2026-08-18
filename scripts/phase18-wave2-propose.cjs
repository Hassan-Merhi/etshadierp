const ts = require("typescript");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const mode = process.env.PHASE18_MODE || "safe";
const blockPath = process.env.PHASE18_BLOCKLIST || "";
const blocked = new Set(
  blockPath && fs.existsSync(blockPath)
    ? fs.readFileSync(blockPath, "utf8").split(/\r?\n/).map((v) => v.trim()).filter(Boolean)
    : []
);
const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
if (!configPath) throw new Error("tsconfig.json not found");
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));

function rel(file) { return path.relative(root, file).replaceAll("\\", "/"); }
function eligible(file) {
  const r = rel(file);
  return /^(client\/src|server|shared)\//.test(r) && /\.(ts|tsx)$/.test(r) && !r.endsWith(".d.ts") && !blocked.has(r) && fs.existsSync(file);
}
function contains(outer, inner) { return outer && inner && outer.pos <= inner.pos && outer.end >= inner.end; }
function ancestor(node, predicate, limit = 8) {
  let current = node.parent;
  for (let depth = 0; current && depth < limit; depth += 1, current = current.parent) if (predicate(current)) return current;
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
      if (ts.isFunctionDeclaration(owner) || ts.isFunctionExpression(owner) || ts.isArrowFunction(owner) || ts.isMethodDeclaration(owner) || ts.isGetAccessorDeclaration(owner) || ts.isSetAccessorDeclaration(owner)) return { start, end: typeNode.end, repl: "", label: "infer-return", risk: "safe" };
    }
    typeNode = owner;
  }
  return null;
}
function callTypeArgument(node, sourceFile) {
  let current = node;
  for (let depth = 0; depth < 6 && current.parent; depth += 1) {
    const parent = current.parent;
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.typeArguments?.length === 1 && contains(parent.typeArguments[0], node)) {
      const start = parent.typeArguments.pos - 1;
      const end = parent.typeArguments.end + 1;
      if (sourceFile.text[start] === "<" && sourceFile.text[end - 1] === ">") return { start, end, repl: "", label: "infer-call-typeargs" };
    }
    current = parent;
  }
  return null;
}
function typeArgumentOwner(node) {
  return ancestor(node, (owner) => owner.typeArguments && [...owner.typeArguments].some((arg) => contains(arg, node)));
}
function editFor(node, sourceFile) {
  const parent = node.parent;
  if (mode === "cast") {
    if ((ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) && parent.type === node) return { start: parent.getStart(sourceFile), end: parent.end, repl: `(${parent.expression.getText(sourceFile)})`, label: "remove-cast" };
    return null;
  }
  if (mode === "array") return ancestor(node, (candidate) => ts.isArrayTypeNode(candidate) && contains(candidate.elementType, node)) ? { start: node.getStart(sourceFile), end: node.end, repl: "unknown", label: "array-unknown" } : null;
  if (mode === "generic") return typeArgumentOwner(node) ? { start: node.getStart(sourceFile), end: node.end, repl: "unknown", label: "generic-unknown" } : null;
  if (mode === "property") return ancestor(node, (candidate) => (ts.isPropertySignature(candidate) || ts.isIndexSignatureDeclaration(candidate)) && candidate.type && contains(candidate.type, node)) ? { start: node.getStart(sourceFile), end: node.end, repl: "unknown", label: "property-unknown" } : null;
  if (mode === "union") return ancestor(node, (candidate) => ts.isUnionTypeNode(candidate)) ? { start: node.getStart(sourceFile), end: node.end, repl: "unknown", label: "union-unknown" } : null;
  if (mode === "unknown") return { start: node.getStart(sourceFile), end: node.end, repl: "unknown", label: "unknown" };
  const owner = annotationOwner(node, sourceFile);
  if (mode === "param") return owner?.risk === "param" ? owner : null;
  if (mode === "safe") return owner?.risk === "safe" ? owner : callTypeArgument(node, sourceFile);
  return null;
}
function collect(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const raw = [];
  const visit = (node) => { if (node.kind === ts.SyntaxKind.AnyKeyword) { const edit = editFor(node, sf); if (edit) raw.push(edit); } ts.forEachChild(node, visit); };
  visit(sf);
  const unique = new Map();
  for (const edit of raw) { const key = `${edit.start}:${edit.end}:${edit.repl}`; if (!unique.has(key)) unique.set(key, edit); }
  const ordered = [...unique.values()].sort((a, b) => a.start - b.start || b.end - a.end);
  const selected = [];
  let coveredUntil = -1;
  for (const edit of ordered) { if (edit.start < coveredUntil) continue; selected.push(edit); coveredUntil = edit.end; }
  return selected.sort((a, b) => b.start - a.start || b.end - a.end);
}
function apply(text, edits) { let next = text; for (const edit of edits) next = next.slice(0, edit.start) + edit.repl + next.slice(edit.end); return next; }

let files = 0;
let edits = 0;
const labels = {};
for (const file of parsed.fileNames) {
  if (!eligible(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  const fileEdits = collect(file, text);
  if (!fileEdits.length) continue;
  const next = apply(text, fileEdits);
  if (next === text) continue;
  fs.writeFileSync(file, next);
  files += 1;
  edits += fileEdits.length;
  for (const edit of fileEdits) labels[edit.label] = (labels[edit.label] || 0) + 1;
}
console.log(`PROPOSE_RESULT mode=${mode} files=${files} edits=${edits} blocked=${blocked.size} labels=${JSON.stringify(labels)}`);
