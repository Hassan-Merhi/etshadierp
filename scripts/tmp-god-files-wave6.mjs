#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const targets = [
  { path: "client/src/pages/BaleProducts.tsx", hookPath: "client/src/pages/baleproducts/useBaleProductsModel.tsx", hookName: "useBaleProductsModel", componentDir: "client/src/pages/baleproducts/components", prefix: "BaleProductsDialog" },
  { path: "client/src/pages/ContainerDetail.tsx", hookPath: "client/src/pages/containerdetail/useContainerDetailModel.tsx", hookName: "useContainerDetailModel", componentDir: "client/src/pages/containerdetail/components", prefix: "ContainerDetailDialog" },
  { path: "client/src/pages/factory/FactoryStockAllocationV5.tsx", hookPath: "client/src/pages/factory/factorystockallocationv5/useFactoryStockAllocationV5Model.tsx", hookName: "useFactoryStockAllocationV5Model", componentDir: "client/src/pages/factory/factorystockallocationv5/components", prefix: "FactoryStockAllocationV5Dialog" },
];

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const write = (rel, text) => { const abs = path.join(root, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`); };
const referenced = (text, name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`).test(text);
function bindingNames(name, out) { if (ts.isIdentifier(name)) out.push(name.text); else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) for (const e of name.elements) { if (!ts.isOmittedExpression(e)) bindingNames(e.name, out); } }
function importsFor(sf, text) {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const kept = [];
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s)) continue;
    const c = s.importClause;
    if (!c) { kept.push(s); continue; }
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
function component(sf) { return sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)); }
function lines(rel) { return read(rel).split("\n").length - 1; }

function splitModel(target) {
  const source = read(target.path);
  const sf = ts.createSourceFile(target.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const comp = component(sf); if (!comp?.body || !comp.name) throw new Error(`default component missing: ${target.path}`);
  const statements = [...comp.body.statements];
  let splitIndex = statements.findIndex((s) => ts.isIfStatement(s) && /\breturn\b/.test(s.getText(sf)));
  if (splitIndex < 1) splitIndex = statements.findIndex((s) => ts.isReturnStatement(s));
  if (splitIndex < 1) throw new Error(`render boundary missing: ${target.path}`);
  const moved = statements.slice(0, splitIndex), rest = statements.slice(splitIndex);
  const movedText = source.slice(moved[0].getFullStart(), moved[moved.length - 1].end).trim();
  const restText = source.slice(rest[0].getFullStart(), comp.body.end - 1).trim();
  const declared = [];
  for (const s of moved) {
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) bindingNames(d.name, declared);
    else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name) declared.push(s.name.text);
  }
  const returned = [...new Set(declared)].filter((n) => referenced(restText, n));
  if (!returned.length) throw new Error(`no model bindings: ${target.path}`);
  write(target.hookPath, `${importsFor(sf, movedText)}\n\nexport function ${target.hookName}() {\n${movedText}\n\n  return {\n${returned.map((n) => `    ${n},`).join("\n")}\n  } as const;\n}\n`);
  const destructure = `  const {\n${returned.map((n) => `    ${n},`).join("\n")}\n  } = ${target.hookName}();`;
  const parentBody = `${destructure}\n\n  ${restText.replace(/\n/g, "\n  ")}\n`;
  const parentImports = importsFor(sf, parentBody);
  const relHook = `./${path.relative(path.dirname(target.path), target.hookPath).replaceAll(path.sep, "/").replace(/\.tsx$/, "")}`;
  const header = source.slice(comp.getStart(sf), comp.body.getStart(sf) + 1);
  write(target.path, `${parentImports}\nimport { ${target.hookName} } from "${relHook}";\n\n${header}\n${parentBody}}\n`);
  console.log(`WAVE6_MODEL ${target.path} parent=${lines(target.path)} hook=${lines(target.hookPath)} bindings=${returned.length}`);
}

function extractDialogs(target) {
  let source = read(target.path);
  let sf = ts.createSourceFile(target.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let comp = component(sf); if (!comp?.body) throw new Error(`component missing: ${target.path}`);
  const first = comp.body.statements.find(ts.isVariableStatement); if (!first) return;
  const decl = first.declarationList.declarations[0]; if (!decl || !ts.isObjectBindingPattern(decl.name)) return;
  const modelNames = []; bindingNames(decl.name, modelNames);
  const init = decl.initializer?.getText(sf) ?? ""; if (!init.startsWith(`${target.hookName}(`)) return;
  const old = source.slice(first.getStart(sf), first.end);
  source = source.slice(0, first.getStart(sf)) + `const model = ${target.hookName}();\n  const ${decl.name.getText(sf)} = model;` + source.slice(first.end);
  sf = ts.createSourceFile(target.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); comp = component(sf); if (!comp?.body) return;
  const localNames = [];
  for (const s of comp.body.statements) if (ts.isVariableStatement(s)) { const t = s.getText(sf); if (!t.startsWith("const model =") && !t.includes("= model;")) for (const d of s.declarationList.declarations) bindingNames(d.name, localNames); }
  const dialogs = [];
  const visit = (n) => { if (ts.isJsxElement(n)) { const tag = n.openingElement.tagName.getText(); if (tag === "Dialog" || tag === "AlertDialog") { dialogs.push(n); return; } } ts.forEachChild(n, visit); };
  visit(comp.body);
  const reps = [], extraImports = []; let count = 0;
  for (const node of dialogs) {
    const text = source.slice(node.getStart(sf), node.end);
    const locals = localNames.filter((n) => referenced(text, n)); if (locals.length) continue;
    const used = modelNames.filter((n) => referenced(text, n)); count++;
    const name = `${target.prefix}${count}`, rel = `${target.componentDir}/${name}.tsx`;
    const hookRel0 = path.relative(path.dirname(rel), target.hookPath).replaceAll(path.sep, "/").replace(/\.tsx$/, ""); const hookRel = hookRel0.startsWith(".") ? hookRel0 : `./${hookRel0}`;
    write(rel, `${importsFor(sf, text)}\nimport type { ${target.hookName} } from "${hookRel}";\n\ntype Model = ReturnType<typeof ${target.hookName}>;\nexport function ${name}({ model }: { model: Model }) {\n  const {\n${used.map((n) => `    ${n},`).join("\n")}\n  } = model;\n  return (\n${text.split("\n").map((l) => `    ${l}`).join("\n")}\n  );\n}\n`);
    const cRel0 = path.relative(path.dirname(target.path), rel).replaceAll(path.sep, "/").replace(/\.tsx$/, ""); extraImports.push(`import { ${name} } from "${cRel0.startsWith(".") ? cRel0 : `./${cRel0}`}";`);
    reps.push({ start: node.getStart(sf), end: node.end, text: `<${name} model={model} />` });
  }
  reps.sort((a,b) => b.start-a.start); for (const r of reps) source = source.slice(0,r.start)+r.text+source.slice(r.end);
  if (extraImports.length) { const parsed = ts.createSourceFile(target.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); const c = component(parsed); const bodyText = source.slice(c.body.getStart(parsed), c.body.end); source = `${importsFor(parsed, bodyText)}\n${extraImports.join("\n")}\n\n${source.slice(c.getStart(parsed))}`; }
  write(target.path, source);
  console.log(`WAVE6_DIALOGS ${target.path} extracted=${count} parent=${lines(target.path)} hook=${lines(target.hookPath)}`);
}

for (const target of targets) { splitModel(target); extractDialogs(target); }
for (const target of targets) {
  if (lines(target.path) > 900) console.log(`WAVE6_NEEDS_MORE parent ${target.path}=${lines(target.path)}`);
  if (lines(target.hookPath) > 900) console.log(`WAVE6_NEEDS_MORE hook ${target.hookPath}=${lines(target.hookPath)}`);
}
