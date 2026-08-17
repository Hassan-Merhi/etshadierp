const ts = require("typescript");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
if (!configPath) throw new Error("tsconfig.json not found");
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const formatFlags =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
  ts.TypeFormatFlags.UseFullyQualifiedType;

const targets = new Map();
const byDecl = new Map();
const editsByFile = new Map();

const sourceOk = (sf) => {
  const rel = path.relative(root, sf.fileName).replace(/\\/g, "/");
  return (
    !sf.isDeclarationFile &&
    !rel.startsWith("node_modules/") &&
    /^(client\/src|server|shared)\//.test(rel) &&
    /\.(ts|tsx)$/.test(rel)
  );
};

const hasAny = (node) => {
  let found = false;
  const visit = (child) => {
    if (child.kind === ts.SyntaxKind.AnyKeyword) found = true;
    else if (!found) ts.forEachChild(child, visit);
  };
  if (node) visit(node);
  return found;
};

const key = (node) => (node?.getSourceFile ? `${node.getSourceFile().fileName}:${node.pos}` : "");
const resolve = (symbol) =>
  symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;

function targetForFunction(fn) {
  const arr = [];
  for (let i = 0; i < (fn.parameters?.length || 0); i++) {
    const parameter = fn.parameters[i];
    if (!parameter.type || !hasAny(parameter.type)) continue;
    const target = {
      node: parameter,
      typeNode: parameter.type,
      candidates: [],
      index: i,
      owner: fn,
    };
    targets.set(key(parameter), target);
    arr[i] = target;
  }
  if (arr.some(Boolean)) byDecl.set(key(fn), arr);
}

function targetProp(symbol) {
  symbol = resolve(symbol);
  if (!symbol) return null;
  const declaration =
    symbol.valueDeclaration ||
    symbol.declarations?.find((x) => ts.isPropertySignature(x) || ts.isPropertyDeclaration(x));
  if (
    !declaration ||
    !declaration.type ||
    !hasAny(declaration.type) ||
    !sourceOk(declaration.getSourceFile())
  ) {
    return null;
  }
  const k = key(declaration);
  let target = targets.get(k);
  if (!target) {
    target = { node: declaration, typeNode: declaration.type, candidates: [] };
    targets.set(k, target);
  }
  return target;
}

for (const sf of program.getSourceFiles()) {
  if (!sourceOk(sf)) continue;
  const walk = (node) => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node)
    ) {
      targetForFunction(node);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
}

function actualType(node) {
  if (!node) return null;
  let type = checker.getTypeAtLocation(node);
  if (type?.isLiteral?.()) type = checker.getBaseTypeOfLiteralType(type);
  return type;
}

function safeText(type, context) {
  if (!type) return null;
  const bad = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never;
  if (type.flags & bad) return null;
  if (type.isLiteral?.()) type = checker.getBaseTypeOfLiteralType(type);
  let text;
  try {
    text = checker.typeToString(type, context, formatFlags);
  } catch {
    return null;
  }
  if (
    !text ||
    text.length > 500 ||
    /(^|\W)any(\W|$)/.test(text) ||
    text.includes("__type") ||
    text.includes("/home/runner/")
  ) {
    return null;
  }
  return text;
}

function add(target, type, context) {
  if (!target || !type) return;
  const text = safeText(type, context || target.node);
  if (text && !target.candidates.includes(text)) target.candidates.push(text);
}

function declOfFunctionExpr(expr) {
  if (!expr) return null;
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return expr;
  let symbol = resolve(checker.getSymbolAtLocation(expr));
  if (!symbol) return null;
  for (const declaration of symbol.declarations || []) {
    if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) return declaration;
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
    ) {
      return declaration.initializer;
    }
    if (
      ts.isPropertyDeclaration(declaration) &&
      declaration.initializer &&
      (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
    ) {
      return declaration.initializer;
    }
  }
  return null;
}

function signatures(type) {
  if (!type) return [];
  const out = [...type.getCallSignatures()];
  if (type.isUnionOrIntersection?.()) {
    for (const part of type.types) out.push(...part.getCallSignatures());
  }
  return out;
}

function feedExpectedCallback(expr, expected) {
  if (!expr || !expected) return;
  const fn = declOfFunctionExpr(expr);
  if (!fn) return;
  const arr = byDecl.get(key(fn));
  if (!arr) return;
  for (const signature of signatures(expected)) {
    const parameters = signature.getParameters();
    for (let i = 0; i < arr.length; i++) {
      const target = arr[i];
      if (!target) continue;
      const parameter = parameters[Math.min(i, parameters.length - 1)];
      if (parameter) add(target, checker.getTypeOfSymbolAtLocation(parameter, expr), target.node);
    }
  }
}

for (const sf of program.getSourceFiles()) {
  if (!sourceOk(sf)) continue;
  const walk = (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const signature = checker.getResolvedSignature(node);
      const args = node.arguments || [];
      if (signature) {
        const declaration = signature.declaration;
        const arr = declaration && byDecl.get(key(declaration));
        if (arr) {
          for (let i = 0; i < args.length; i++) {
            const target = arr[Math.min(i, arr.length - 1)];
            if (target) add(target, actualType(args[i]), target.node);
          }
        }
        const parameters = signature.getParameters();
        for (let i = 0; i < args.length; i++) {
          const parameter = parameters[Math.min(i, parameters.length - 1)];
          if (!parameter) continue;
          feedExpectedCallback(args[i], checker.getTypeOfSymbolAtLocation(parameter, args[i]));
        }
      }
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const componentType = checker.getTypeAtLocation(node.tagName);
      const calls = componentType.getCallSignatures();
      if (calls.length && calls[0].getParameters().length) {
        const props = checker.getTypeOfSymbolAtLocation(calls[0].getParameters()[0], node);
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute) || !attribute.name || !attribute.initializer) continue;
          const name = attribute.name.text;
          const propSymbol = props.getProperty(name);
          const target = targetProp(propSymbol);
          let expr = null;
          if (ts.isStringLiteral(attribute.initializer)) expr = attribute.initializer;
          else if (ts.isJsxExpression(attribute.initializer)) expr = attribute.initializer.expression;
          if (target && expr) add(target, actualType(expr), target.node);
          if (expr && propSymbol) {
            feedExpectedCallback(expr, checker.getTypeOfSymbolAtLocation(propSymbol, expr));
          }
        }
      }
    }

    if (ts.isObjectLiteralExpression(node)) {
      const context = checker.getContextualType(node);
      if (context) {
        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
          const name =
            property.name && ts.isIdentifier(property.name)
              ? property.name.text
              : ts.isStringLiteral(property.name)
                ? property.name.text
                : null;
          if (!name) continue;
          const propSymbol = context.getProperty(name);
          const target = targetProp(propSymbol);
          const expr = ts.isPropertyAssignment(property) ? property.initializer : property.name;
          if (target) add(target, actualType(expr), target.node);
        }
      }
    }

    ts.forEachChild(node, walk);
  };
  walk(sf);
}

let edits = 0;
for (const target of targets.values()) {
  const unique = [...new Set(target.candidates)].filter(Boolean);
  if (!unique.length || unique.length > 6) continue;
  const replacement =
    unique.length === 1
      ? unique[0]
      : unique.map((x) => (x.includes("|") ? `(${x})` : x)).join(" | ");
  if (!replacement || /(^|\W)any(\W|$)/.test(replacement)) continue;
  const sf = target.node.getSourceFile();
  const rel = path.relative(root, sf.fileName).replace(/\\/g, "/");
  const list = editsByFile.get(rel) || [];
  list.push({
    start: target.typeNode.getStart(sf),
    end: target.typeNode.end,
    replacement,
  });
  editsByFile.set(rel, list);
  edits++;
}

for (const [rel, list] of editsByFile) {
  const file = path.join(root, rel);
  const sf = program.getSourceFile(file);
  let text = sf.text;
  list.sort((a, b) => b.start - a.start);
  for (const edit of list) {
    text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  }
  fs.writeFileSync(file, text);
}

fs.writeFileSync(
  "/tmp/phase18-current-inference.files",
  [...editsByFile.keys()].sort().join("\n") + (editsByFile.size ? "\n" : ""),
);
console.log(`INFERENCE_TARGETS=${targets.size} EDITS=${edits} FILES=${editsByFile.size}`);
