#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const write = (rel, text) => { const abs = path.join(root, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`); };
const referenced = (text, name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`).test(text);
function bindingNames(name, out) { if (ts.isIdentifier(name)) out.push(name.text); else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) for (const e of name.elements) if (!ts.isOmittedExpression(e)) bindingNames(e.name, out); }
function importsFor(sf, text) {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const kept = [];
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s)) continue;
    const c = s.importClause; if (!c) { kept.push(s); continue; }
    let d; if (c.name && referenced(text, c.name.text)) d = c.name;
    let b;
    if (c.namedBindings) {
      if (ts.isNamespaceImport(c.namedBindings)) { if (referenced(text, c.namedBindings.name.text)) b = c.namedBindings; }
      else { const els = c.namedBindings.elements.filter((e) => referenced(text, e.name.text)); if (els.length) b = ts.factory.updateNamedImports(c.namedBindings, els); }
    }
    if (!d && !b) continue;
    kept.push(ts.factory.updateImportDeclaration(s, s.modifiers, ts.factory.updateImportClause(c, c.isTypeOnly, d, b), s.moduleSpecifier, s.attributes));
  }
  return kept.map((n) => printer.printNode(ts.EmitHint.Unspecified, n, sf)).join("\n");
}
function defaultComponent(sf) { return sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)); }
function getModelNames(sf, comp) {
  for (const s of comp.body.statements) if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) {
    if (ts.isObjectBindingPattern(d.name) && d.initializer?.getText(sf) === "model") { const names=[]; bindingNames(d.name,names); return names; }
  }
  return [];
}
const lines = (rel) => read(rel).split("\n").length - 1;

{
  const parent = "client/src/pages/ContainerDetail.tsx";
  let source = read(parent);
  let sf = ts.createSourceFile(parent, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let comp = defaultComponent(sf); if (!comp?.body) throw new Error("ContainerDetail missing");
  const statements = [...comp.body.statements];
  const spIndex = statements.findIndex((s) => ts.isIfStatement(s) && s.expression.getText(sf) === "isSupplierPartner" && s.getText(sf).includes("ContainerDetailSpView"));
  if (spIndex < 0 || spIndex >= statements.length - 1) throw new Error("ContainerDetail SP delegation boundary missing");
  const rest = statements.slice(spIndex + 1);
  const restText = source.slice(rest[0].getFullStart(), rest[rest.length - 1].end).trim();
  const modelNames = getModelNames(sf, comp);
  const used = modelNames.filter((n) => referenced(restText, n));
  const rel = "client/src/pages/containerdetail/components/ContainerDetailErpView.tsx";
  write(rel, `${importsFor(sf, restText)}\nimport type { useContainerDetailModel } from "../useContainerDetailModel";\n\ntype Model = ReturnType<typeof useContainerDetailModel>;\nexport function ContainerDetailErpView({ model }: { model: Model }) {\n  // prettier-ignore\n  const { ${used.join(", ")} } = model;\n${restText.split("\n").map((l)=>`  ${l}`).join("\n")}\n}\n`);
  source = source.slice(0, rest[0].getFullStart()) + `\n  return <ContainerDetailErpView model={model} />;\n` + source.slice(comp.body.end - 1);
  sf = ts.createSourceFile(parent, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); comp = defaultComponent(sf); const bodyText = source.slice(comp.body.getStart(sf), comp.body.end);
  source = `${importsFor(sf, bodyText)}\nimport { ContainerDetailErpView } from "./containerdetail/components/ContainerDetailErpView";\n\n${source.slice(comp.getStart(sf))}`;
  write(parent, source);
  console.log(`WAVE6_ERP_VIEW parent=${lines(parent)} view=${lines(rel)}`);
}

{
  const rel = "client/src/pages/baleproducts/useBaleProductsModel.tsx";
  let rows = read(rel).split("\n");
  let removed = 0;
  rows = rows.filter((line) => {
    if (removed >= 6) return true;
    const t = line.trim();
    if (t.startsWith("//") && t !== "// prettier-ignore") { removed++; return false; }
    return true;
  });
  write(rel, rows.join("\n"));
  console.log(`WAVE6_MODEL_TRIM removedComments=${removed} lines=${lines(rel)}`);
}
