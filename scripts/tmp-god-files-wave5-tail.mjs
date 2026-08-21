#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function write(rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`);
}
function lineCount(rel) {
  return read(rel).split("\n").length - 1;
}
function referenced(text, name) {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`).test(text);
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
function tagName(node) {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return null;
}
function defaultComponent(sf) {
  return sf.statements.find(
    (s) => ts.isFunctionDeclaration(s) && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
  );
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

function pageContext(rel, hookName) {
  const source = read(rel);
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = defaultComponent(sf);
  if (!component?.body) throw new Error(`Missing default component in ${rel}`);
  const modelNames = [];
  const localNames = [];
  for (const statement of component.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const text = statement.getText(sf);
    for (const decl of statement.declarationList.declarations) {
      if (text.includes("= model;")) bindingNames(decl.name, modelNames);
      else if (!text.startsWith("const model =") && !text.includes(`${hookName}(`)) bindingNames(decl.name, localNames);
    }
  }
  return { source, sf, component, modelNames, localNames };
}

function installComponent({ rel, hookPath, hookName, componentDir, componentName, node, extraProps = [] }) {
  let { source, sf, component, modelNames } = pageContext(rel, hookName);
  const text = source.slice(node.getStart(sf), node.end);
  const usedModel = modelNames.filter((name) => referenced(text, name));
  const importText = importsFor(sf, source, text);
  const outPath = `${componentDir}/${componentName}.tsx`;
  const hookRel = path.relative(path.dirname(outPath), hookPath).replaceAll(path.sep, "/").replace(/\.tsx$/, "");
  const propType = ["model: Model", ...extraProps.map((prop) => `${prop.name}: ${prop.type}`)].join("; ");
  const propNames = ["model", ...extraProps.map((prop) => prop.name)].join(", ");
  const componentSource = `${importText}\nimport type { ${hookName} } from "${hookRel.startsWith(".") ? hookRel : `./${hookRel}`}";\n\ntype Model = ReturnType<typeof ${hookName}>;\n\nexport function ${componentName}({ ${propNames} }: { ${propType} }) {\n  const {\n${usedModel.map((name) => `    ${name},`).join("\n")}\n  } = model;\n  return (\n${text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n")}\n  );\n}\n`;
  write(outPath, componentSource);

  const componentRel = path.relative(path.dirname(rel), outPath).replaceAll(path.sep, "/").replace(/\.tsx$/, "");
  const callProps = ["model={model}", ...extraProps.map((prop) => `${prop.name}={${prop.name}}`)].join(" ");
  const replacement = `<${componentName} ${callProps} />`;
  source = source.slice(0, node.getStart(sf)) + replacement + source.slice(node.end);

  const parsed = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  component = defaultComponent(parsed);
  if (!component?.body) throw new Error(`Component disappeared while installing ${componentName}`);
  const bodyText = source.slice(component.body.getStart(parsed), component.body.end);
  const filtered = importsFor(parsed, source, bodyText);
  const functionText = source.slice(component.getStart(parsed));
  const componentImport = `import { ${componentName} } from "${componentRel.startsWith(".") ? componentRel : `./${componentRel}`}";`;
  write(rel, `${filtered}\n${componentImport}\n\n${functionText}`);
  return { outPath, extractedLines: text.split("\n").length };
}

// Invoice Detail: the only dialog deliberately skipped by the broad extractor
// depends on one render-local boolean. Pass that primitive explicitly.
{
  const rel = "client/src/pages/factory/FactoryInvoiceDetail.tsx";
  const hookPath = "client/src/pages/factory/factoryinvoicedetail/useFactoryInvoiceDetailModel.tsx";
  const hookName = "useFactoryInvoiceDetailModel";
  const ctx = pageContext(rel, hookName);
  const candidates = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) && ["Dialog", "AlertDialog"].includes(tagName(node))) {
      const text = ctx.source.slice(node.getStart(ctx.sf), node.end);
      const localRefs = ctx.localNames.filter((name) => referenced(text, name));
      candidates.push({ node, text, localRefs, lines: text.split("\n").length });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.component.body);
  const chosen = candidates
    .filter((candidate) => candidate.localRefs.length === 1 && candidate.localRefs[0] === "isFinalized")
    .sort((a, b) => b.lines - a.lines)[0];
  if (!chosen) {
    throw new Error(
      `Invoice tail dialog not found. candidates=${candidates.map((c) => `${c.lines}:${c.localRefs.join("+")}`).join(",")}`
    );
  }
  const result = installComponent({
    rel,
    hookPath,
    hookName,
    componentDir: "client/src/pages/factory/factoryinvoicedetail/components",
    componentName: "FactoryInvoiceDetailFinalizeDialog",
    node: chosen.node,
    extraProps: [{ name: "isFinalized", type: "boolean" }],
  });
  console.log(`WAVE5_TAIL_INVOICE extracted=${result.extractedLines} parent=${lineCount(rel)} component=${result.outPath}`);
}

// Pending Verify: lift the largest presentation Card that depends only on
// model bindings. No render-local derived values are moved.
{
  const rel = "client/src/pages/factory/FactoryPendingInvoiceVerify.tsx";
  const hookPath = "client/src/pages/factory/factorypendinginvoiceverify/useFactoryPendingInvoiceVerifyModel.tsx";
  const hookName = "useFactoryPendingInvoiceVerifyModel";
  const ctx = pageContext(rel, hookName);
  const candidates = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) && tagName(node) === "Card") {
      const text = ctx.source.slice(node.getStart(ctx.sf), node.end);
      const localRefs = ctx.localNames.filter((name) => referenced(text, name));
      candidates.push({ node, text, localRefs, lines: text.split("\n").length });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.component.body);
  const chosen = candidates
    .filter((candidate) => candidate.localRefs.length === 0 && candidate.lines >= 45)
    .sort((a, b) => b.lines - a.lines)[0];
  if (!chosen) {
    throw new Error(
      `Pending Verify model-only Card not found. candidates=${candidates.map((c) => `${c.lines}:${c.localRefs.join("+")}`).join(",")}`
    );
  }
  const result = installComponent({
    rel,
    hookPath,
    hookName,
    componentDir: "client/src/pages/factory/factorypendinginvoiceverify/components",
    componentName: "FactoryPendingInvoiceVerifyDetailCard",
    node: chosen.node,
  });
  console.log(`WAVE5_TAIL_PENDING extracted=${result.extractedLines} parent=${lineCount(rel)} component=${result.outPath}`);
}
