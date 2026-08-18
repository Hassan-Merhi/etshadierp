const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
if (!configPath) throw new Error('tsconfig.json not found');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
const targetFiles = parsed.fileNames.filter((file) => {
  const rel = path.relative(root, file).replaceAll('\\', '/');
  return /^(client\/src|server|shared)\//.test(rel) && /\.(ts|tsx)$/.test(rel) && !rel.endsWith('.d.ts') && fs.existsSync(file);
}).sort();
const state = new Map(parsed.fileNames.filter(fs.existsSync).map((file) => [path.resolve(file), { text: fs.readFileSync(file, 'utf8'), version: 0 }]));
const host = {
  getCompilationSettings: () => parsed.options,
  getScriptFileNames: () => parsed.fileNames,
  getScriptVersion: (file) => String(state.get(path.resolve(file))?.version ?? 0),
  getScriptSnapshot: (file) => {
    const entry = state.get(path.resolve(file));
    if (entry) return ts.ScriptSnapshot.fromString(entry.text);
    if (fs.existsSync(file)) return ts.ScriptSnapshot.fromString(fs.readFileSync(file, 'utf8'));
  },
  getCurrentDirectory: () => root,
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
  realpath: ts.sys.realpath,
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry());
function setText(file, text) {
  const key = path.resolve(file);
  const entry = state.get(key) || { text: fs.readFileSync(file, 'utf8'), version: 0 };
  entry.text = text;
  entry.version += 1;
  state.set(key, entry);
}
function diagnostics(file) { return [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)]; }
function contains(outer, inner) { return outer && inner && outer.pos <= inner.pos && outer.end >= inner.end; }
function annotationStart(source, typeNode) {
  let i = typeNode.getStart() - 1;
  while (i >= 0 && /\s/.test(source[i])) i -= 1;
  return source[i] === ':' ? i : null;
}
function annotationOwner(node, sourceFile) {
  let typeNode = node;
  for (let depth = 0; depth < 7 && typeNode.parent; depth += 1) {
    const owner = typeNode.parent;
    if (owner.type === typeNode) {
      const start = annotationStart(sourceFile.text, typeNode);
      if (start === null) return null;
      if (ts.isVariableDeclaration(owner) && owner.initializer) return { start, end: typeNode.end, repl: '', label: 'infer-variable' };
      if (ts.isPropertyDeclaration(owner) && owner.initializer) return { start, end: typeNode.end, repl: '', label: 'infer-property' };
      if (ts.isFunctionDeclaration(owner) || ts.isFunctionExpression(owner) || ts.isArrowFunction(owner) || ts.isMethodDeclaration(owner) || ts.isGetAccessorDeclaration(owner) || ts.isSetAccessorDeclaration(owner)) return { start, end: typeNode.end, repl: '', label: 'infer-return' };
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
      if (sourceFile.text[start] === '<' && sourceFile.text[end - 1] === '>') return { start, end, repl: '', label: 'infer-call-typeargs' };
    }
    current = parent;
  }
  return null;
}
function collect(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const raw = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const edit = annotationOwner(node, sf) || callTypeArgument(node, sf);
      if (edit) raw.push(edit);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const unique = new Map();
  for (const edit of raw) unique.set(`${edit.start}:${edit.end}:${edit.repl}`, edit);
  const ordered = [...unique.values()].sort((a,b) => a.start-b.start || b.end-a.end);
  const selected=[]; let covered=-1;
  for (const edit of ordered) { if (edit.start < covered) continue; selected.push(edit); covered=edit.end; }
  return selected.sort((a,b) => b.start-a.start || b.end-a.end);
}
function apply(text, edits) { let next=text; for (const e of edits) next=next.slice(0,e.start)+e.repl+next.slice(e.end); return next; }
function tryEdits(file, current, edits, stats) {
  if (!edits.length) return false;
  const trial=apply(current.text, edits); setText(file, trial); stats.checks += 1;
  if (diagnostics(file).length === 0) { current.text=trial; stats.accepted += edits.length; for (const e of edits) stats.labels[e.label]=(stats.labels[e.label]||0)+1; return true; }
  setText(file, current.text); return false;
}
function splitSolve(file,current,edits,stats,depth=0) {
  if (!edits.length) return false;
  if (tryEdits(file,current,edits,stats)) return true;
  if (edits.length===1 || depth>=7) { stats.rejected += edits.length; return false; }
  const mid=Math.ceil(edits.length/2);
  const a=splitSolve(file,current,edits.slice(0,mid),stats,depth+1);
  const b=splitSolve(file,current,edits.slice(mid),stats,depth+1);
  return a||b;
}
const stats={files:0,accepted:0,rejected:0,checks:0,labels:{}};
for (const file of targetFiles) {
  const original=fs.readFileSync(file,'utf8');
  if (!/\bany\b/.test(original)) continue;
  const current={text:original};
  const edits=collect(file,current.text);
  if (!edits.length) continue;
  const before=stats.accepted;
  splitSolve(file,current,edits,stats);
  if (stats.accepted>before && current.text!==original) {
    setText(file,current.text);
    if (diagnostics(file).length===0) {
      fs.writeFileSync(file,current.text);
      stats.files += 1;
      console.log(`PHASE1_SAFE_FILE ${path.relative(root,file).replaceAll('\\','/')} accepted=${stats.accepted-before}`);
    } else setText(file,original);
  }
}
console.log(`PHASE1_SAFE_RESULT ${JSON.stringify(stats)}`);
