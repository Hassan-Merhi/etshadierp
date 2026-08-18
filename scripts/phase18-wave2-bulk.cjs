const ts = require("typescript");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
if (!configPath) throw new Error("tsconfig.json not found");
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
const blockPath = process.env.PHASE18_BLOCKLIST || "";
const blocked = new Set(
  blockPath && fs.existsSync(blockPath)
    ? fs.readFileSync(blockPath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : []
);

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}
function contains(outer, inner) {
  return outer && inner && outer.pos <= inner.pos && outer.end >= inner.end;
}
function annotationStart(source, typeNode) {
  let i = typeNode.getStart() - 1;
  while (i >= 0 && /\s/.test(source[i])) i -= 1;
  return source[i] === ":" ? i : null;
}
function typeOwnerCandidate(node, sourceFile) {
  let typeNode = node;
  for (let depth = 0; depth < 6 && typeNode.parent; depth += 1) {
    const owner = typeNode.parent;
    if (owner.type === typeNode) {
      const start = annotationStart(sourceFile.text, typeNode);
      if (start === null) return null;
      if (ts.isVariableDeclaration(owner) && owner.initializer) return { start, end: typeNode.end, repl: "", label: "infer-variable" };
      if (ts.isPropertyDeclaration(owner) && owner.initializer) return { start, end: typeNode.end, repl: "", label: "infer-property" };
      if (ts.isParameter(owner)) return { start, end: typeNode.end, repl: "", label: "infer-parameter" };
      if (ts.isFunctionDeclaration(owner) || ts.isFunctionExpression(owner) || ts.isArrowFunction(owner) || ts.isMethodDeclaration(owner) || ts.isGetAccessorDeclaration(owner) || ts.isSetAccessorDeclaration(owner)) {
        return { start, end: typeNode.end, repl: "", label: "infer-return" };
      }
    }
    typeNode = owner;
  }
  return null;
}
function callTypeArgumentCandidate(node, sourceFile) {
  let current = node;
  for (let depth = 0; depth < 5 && current.parent; depth += 1) {
    const parent = current.parent;
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.typeArguments?.length === 1) {
      const arg = parent.typeArguments[0];
      if (!contains(arg, node)) return null;
      const start = parent.typeArguments.pos - 1;
      const end = parent.typeArguments.end + 1;
      if (sourceFile.text.slice(start, start + 1) === "<" && sourceFile.text.slice(end - 1, end) === ">") return { start, end, repl: "", label: "infer-call-typeargs" };
    }
    current = parent;
  }
  return null;
}
function bestCandidate(node, sourceFile) {
  const parent = node.parent;
  if ((ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) && parent.type === node) {
    return { start: parent.getStart(sourceFile), end: parent.end, repl: `(${parent.expression.getText(sourceFile)})`, label: "remove-cast" };
  }
  return typeOwnerCandidate(node, sourceFile) || callTypeArgumentCandidate(node, sourceFile) || { start: node.getStart(sourceFile), end: node.end, repl: "unknown", label: "unknown" };
}
function collect(file, text) {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) edits.push(bestCandidate(node, sourceFile));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const suppression = /@ts-(?:ignore|expect-error)\b/g;
  for (let match = suppression.exec(text); match; match = suppression.exec(text)) edits.push({ start: match.index, end: match.index + match[0].length, repl: "@ts-note", label: "remove-suppression" });
  const unique = new Map();
  for (const edit of edits) {
    const key = `${edit.start}:${edit.end}:${edit.repl}`;
    if (!unique.has(key)) unique.set(key, edit);
  }
  return [...unique.values()].sort((a, b) => b.start - a.start || b.end - a.end);
}
function apply(text, edits) {
  let next = text;
  for (const edit of edits) next = next.slice(0, edit.start) + edit.repl + next.slice(edit.end);
  return next;
}

let filesChanged = 0;
let editsApplied = 0;
const labels = {};
for (const file of parsed.fileNames) {
  const relative = rel(file);
  if (!/^(client\/src|server|shared)\//.test(relative) || !/\.(ts|tsx)$/.test(relative) || relative.endsWith(".d.ts") || blocked.has(relative) || !fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  const edits = collect(file, text);
  if (!edits.length) continue;
  const next = apply(text, edits);
  if (next === text) continue;
  fs.writeFileSync(file, next);
  filesChanged += 1;
  editsApplied += edits.length;
  for (const edit of edits) labels[edit.label] = (labels[edit.label] || 0) + 1;
  console.log(`BULK ${relative} ${edits.length}`);
}
console.log(`BULK_RESULT files=${filesChanged} edits=${editsApplied} blocked=${blocked.size} labels=${JSON.stringify(labels)}`);
