#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const targets = [
  {
    path: "client/src/pages/factory/FactoryInvoiceDetail.tsx",
    hookPath: "client/src/pages/factory/factoryinvoicedetail/useFactoryInvoiceDetailModel.tsx",
    hookName: "useFactoryInvoiceDetailModel",
    componentDir: "client/src/pages/factory/factoryinvoicedetail/components",
    prefix: "FactoryInvoiceDetailDialog",
  },
  {
    path: "client/src/pages/factory/BalesHistory.tsx",
    hookPath: "client/src/pages/factory/baleshistory/useBalesHistoryModel.tsx",
    hookName: "useBalesHistoryModel",
    componentDir: "client/src/pages/factory/baleshistory/components",
    prefix: "BalesHistoryDialog",
  },
  {
    path: "client/src/pages/factory/FactoryPendingInvoiceVerify.tsx",
    hookPath: "client/src/pages/factory/factorypendinginvoiceverify/useFactoryPendingInvoiceVerifyModel.tsx",
    hookName: "useFactoryPendingInvoiceVerifyModel",
    componentDir: "client/src/pages/factory/factorypendinginvoiceverify/components",
    prefix: "FactoryPendingInvoiceVerifyDialog",
  },
];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function write(rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`);
}
function bindingNames(name, out) {
  if (ts.isIdentifier(name)) out.push(name.text);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      bindingNames(element.name, out);
    }
  }
}
function referenced(text, name) {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`).test(text);
}
function tagName(node) {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return null;
}
function importsFor(sourceFile, source, bodyText) {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const kept = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause) {
      kept.push(statement);
      continue;
    }
    let defaultName;
    if (clause.name && referenced(bodyText, clause.name.text)) defaultName = clause.name;
    let namedBindings;
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        if (referenced(bodyText, clause.namedBindings.name.text)) namedBindings = clause.namedBindings;
      } else {
        const elements = clause.namedBindings.elements.filter((e) => referenced(bodyText, e.name.text));
        if (elements.length) namedBindings = ts.factory.updateNamedImports(clause.namedBindings, elements);
      }
    }
    if (!defaultName && !namedBindings) continue;
    kept.push(
      ts.factory.updateImportDeclaration(
        statement,
        statement.modifiers,
        ts.factory.updateImportClause(clause, clause.isTypeOnly, defaultName, namedBindings),
        statement.moduleSpecifier,
        statement.attributes
      )
    );
  }
  return kept.map((node) => printer.printNode(ts.EmitHint.Unspecified, node, sourceFile)).join("\n");
}
function defaultComponent(sf) {
  return sf.statements.find(
    (s) => ts.isFunctionDeclaration(s) && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
  );
}
function lineCount(rel) {
  return read(rel).split("\n").length - 1;
}

for (const target of targets) {
  let source = read(target.path);
  let sf = ts.createSourceFile(target.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let component = defaultComponent(sf);
  if (!component?.body) throw new Error(`Component missing in ${target.path}`);

  const firstVariable = component.body.statements.find((s) => ts.isVariableStatement(s));
  if (!firstVariable || !ts.isVariableStatement(firstVariable)) throw new Error(`Model declaration missing in ${target.path}`);
  const firstDecl = firstVariable.declarationList.declarations[0];
  if (!firstDecl || !ts.isObjectBindingPattern(firstDecl.name)) throw new Error(`Model destructure missing in ${target.path}`);
  const modelNames = [];
  bindingNames(firstDecl.name, modelNames);
  const initText = firstDecl.initializer?.getText(sf) ?? "";
  if (!initText.startsWith(`${target.hookName}(`)) throw new Error(`Unexpected model initializer in ${target.path}: ${initText}`);

  const oldDeclText = source.slice(firstVariable.getStart(sf), firstVariable.end);
  const bindingText = firstDecl.name.getText(sf);
  const newDeclText = `const model = ${target.hookName}();\n  const ${bindingText} = model;`;
  source = source.slice(0, firstVariable.getStart(sf)) + newDeclText + source.slice(firstVariable.end);

  sf = ts.createSourceFile(target.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  component = defaultComponent(sf);
  if (!component?.body) throw new Error(`Component missing after model rewrite in ${target.path}`);

  const localNames = [];
  for (const statement of component.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const statementText = statement.getText(sf);
    if (statementText.startsWith("const model =") || statementText.includes("= model;")) continue;
    for (const decl of statement.declarationList.declarations) bindingNames(decl.name, localNames);
  }

  const dialogs = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) && ["Dialog", "AlertDialog"].includes(tagName(node))) {
      dialogs.push(node);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(component.body);

  const replacements = [];
  const imports = [];
  let extracted = 0;
  let extractedLines = 0;
  for (const node of dialogs) {
    const text = source.slice(node.getStart(sf), node.end);
    const localRefs = localNames.filter((name) => referenced(text, name));
    if (localRefs.length) {
      console.log(`WAVE5_DIALOG_SKIP ${target.path}: locals=${localRefs.join(",")}`);
      continue;
    }
    const usedModel = modelNames.filter((name) => referenced(text, name));
    extracted += 1;
    extractedLines += text.split("\n").length;
    const componentName = `${target.prefix}${extracted}`;
    const relPath = `${target.componentDir}/${componentName}.tsx`;
    const importText = importsFor(sf, source, text);
    const hookRel = path
      .relative(path.dirname(relPath), target.hookPath)
      .replaceAll(path.sep, "/")
      .replace(/\.tsx$/, "");
    const componentSource = `${importText}\nimport type { ${target.hookName} } from "${hookRel.startsWith(".") ? hookRel : `./${hookRel}`}";\n\ntype Model = ReturnType<typeof ${target.hookName}>;\n\nexport function ${componentName}({ model }: { model: Model }) {\n  const {\n${usedModel.map((name) => `    ${name},`).join("\n")}\n  } = model;\n  return (\n${text
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n")}\n  );\n}\n`;
    write(relPath, componentSource);
    const componentRel = path.relative(path.dirname(target.path), relPath).replaceAll(path.sep, "/").replace(/\.tsx$/, "");
    imports.push(`import { ${componentName} } from "${componentRel.startsWith(".") ? componentRel : `./${componentRel}`}";`);
    replacements.push({ start: node.getStart(sf), end: node.end, text: `<${componentName} model={model} />` });
  }

  replacements.sort((a, b) => b.start - a.start);
  for (const replacement of replacements) {
    source = source.slice(0, replacement.start) + replacement.text + source.slice(replacement.end);
  }

  if (imports.length) {
    const parsed = ts.createSourceFile(target.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const comp = defaultComponent(parsed);
    if (!comp?.body) throw new Error(`Component missing after dialog replacement in ${target.path}`);
    const bodyText = source.slice(comp.body.getStart(parsed), comp.body.end);
    const filtered = importsFor(parsed, source, bodyText);
    const headerStart = comp.getStart(parsed);
    const functionText = source.slice(headerStart);
    source = `${filtered}\n${imports.join("\n")}\n\n${functionText}`;
  }

  write(target.path, source);
  console.log(
    `WAVE5_DIALOGS ${target.path}: extracted=${extracted} lines=${extractedLines} parent=${lineCount(target.path)} hook=${lineCount(target.hookPath)}`
  );
}
