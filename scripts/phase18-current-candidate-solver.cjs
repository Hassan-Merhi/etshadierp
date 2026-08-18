const ts = require("typescript");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
if (!configPath) throw new Error("tsconfig.json not found");
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
const files = parsed.fileNames.filter((file) => {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  return /^(client\/src|server|shared)\//.test(rel) && /\.(ts|tsx)$/.test(rel) && !rel.endsWith(".d.ts") && fs.existsSync(file);
});

const state = new Map(
  parsed.fileNames.filter(fs.existsSync).map((file) => [path.resolve(file), { text: fs.readFileSync(file, "utf8"), version: 0 }])
);
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
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry());

function setText(file, text) {
  const key = path.resolve(file);
  const entry = state.get(key) || { text: fs.readFileSync(file, "utf8"), version: 0 };
  entry.text = text;
  entry.version += 1;
  state.set(key, entry);
}

function diagnostics(file) {
  return [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)];
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
      const source = sourceFile.text;
      const start = annotationStart(source, typeNode);
      if (start === null) return null;
      if (ts.isVariableDeclaration(owner) && owner.initializer) {
        return { start, end: typeNode.end, repl: "", label: "infer-variable" };
      }
      if (ts.isPropertyDeclaration(owner) && owner.initializer) {
        return { start, end: typeNode.end, repl: "", label: "infer-property" };
      }
      if (ts.isParameter(owner)) {
        return { start, end: typeNode.end, repl: "", label: "infer-parameter" };
      }
      if (
        ts.isFunctionDeclaration(owner) ||
        ts.isFunctionExpression(owner) ||
        ts.isArrowFunction(owner) ||
        ts.isMethodDeclaration(owner) ||
        ts.isGetAccessorDeclaration(owner) ||
        ts.isSetAccessorDeclaration(owner)
      ) {
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
      if (sourceFile.text.slice(start, start + 1) === "<" && sourceFile.text.slice(end - 1, end) === ">") {
        return { start, end, repl: "", label: "infer-call-typeargs" };
      }
    }
    current = parent;
  }
  return null;
}

function bestCandidate(node, sourceFile) {
  const parent = node.parent;
  if ((ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) && parent.type === node) {
    return {
      start: parent.getStart(sourceFile),
      end: parent.end,
      repl: `(${parent.expression.getText(sourceFile)})`,
      label: "remove-cast",
    };
  }
  return typeOwnerCandidate(node, sourceFile) || callTypeArgumentCandidate(node, sourceFile) || {
    start: node.getStart(sourceFile),
    end: node.end,
    repl: "unknown",
    label: "unknown",
  };
}

function collectCandidates(file, text) {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const candidates = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) candidates.push(bestCandidate(node, sourceFile));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const suppression = /@ts-(?:ignore|expect-error)\b/g;
  for (let match = suppression.exec(text); match; match = suppression.exec(text)) {
    candidates.push({ start: match.index, end: match.index + match[0].length, repl: "@ts-note", label: "remove-suppression" });
  }
  const unique = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.start}:${candidate.end}:${candidate.repl}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()].sort((a, b) => b.start - a.start || b.end - a.end);
}

function applyEdits(text, edits) {
  let next = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    next = next.slice(0, edit.start) + edit.repl + next.slice(edit.end);
  }
  return next;
}

function solveGroup(file, currentRef, group, stats) {
  if (!group.length) return;
  const trial = applyEdits(currentRef.text, group);
  setText(file, trial);
  stats.checks += 1;
  if (diagnostics(file).length === 0) {
    currentRef.text = trial;
    for (const edit of group) {
      stats.accepted += 1;
      stats.labels[edit.label] = (stats.labels[edit.label] || 0) + 1;
    }
    return;
  }
  setText(file, currentRef.text);
  if (group.length === 1) {
    stats.rejected += 1;
    return;
  }
  const midpoint = Math.ceil(group.length / 2);
  solveGroup(file, currentRef, group.slice(0, midpoint), stats);
  solveGroup(file, currentRef, group.slice(midpoint), stats);
}

const stats = { files: 0, accepted: 0, rejected: 0, checks: 0, labels: {} };
for (const file of files) {
  let original = fs.readFileSync(file, "utf8");
  let current = { text: original };
  let fileAcceptedBefore = stats.accepted;
  for (let pass = 0; pass < 3; pass += 1) {
    const candidates = collectCandidates(file, current.text);
    if (!candidates.length) break;
    const acceptedBefore = stats.accepted;
    for (let i = 0; i < candidates.length; i += 64) {
      solveGroup(file, current, candidates.slice(i, i + 64), stats);
    }
    if (stats.accepted === acceptedBefore) break;
  }
  if (stats.accepted > fileAcceptedBefore) {
    setText(file, current.text);
    if (diagnostics(file).length === 0) {
      fs.writeFileSync(file, current.text);
      stats.files += 1;
      console.log(`SOLVED ${path.relative(root, file).replaceAll("\\", "/")} ${stats.accepted - fileAcceptedBefore}`);
    } else {
      setText(file, original);
    }
  }
}
console.log(`SOLVER ${JSON.stringify(stats)}`);
