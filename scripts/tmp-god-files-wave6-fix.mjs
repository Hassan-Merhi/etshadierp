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
const lines = (rel) => read(rel).split("\n").length - 1;

function rebase(rel, from, to) { let s = read(rel); s = s.replaceAll(`"${from}`, `"${to}`).replaceAll(`'${from}`, `'${to}`); write(rel, s); }
rebase("client/src/pages/baleproducts/useBaleProductsModel.tsx", "./baleproducts/", "./");
rebase("client/src/pages/factory/factorystockallocationv5/useFactoryStockAllocationV5Model.tsx", "./factorystockallocationv5/", "./");
for (const dir of ["client/src/pages/baleproducts/components", "client/src/pages/factory/factorystockallocationv5/components"]) {
  if (!fs.existsSync(path.join(root, dir))) continue;
  for (const file of fs.readdirSync(path.join(root, dir))) if (file.endsWith(".tsx")) {
    const rel = `${dir}/${file}`;
    if (dir.includes("baleproducts")) rebase(rel, "./baleproducts/", "../");
    if (dir.includes("factorystockallocationv5")) rebase(rel, "./factorystockallocationv5/", "../");
  }
}

{
  const rel = "client/src/pages/containerdetail/useContainerDetailModel.tsx";
  let s = read(rel);
  if (!s.includes('import { z } from "zod";')) s = `import { z } from "zod";\n${s}`;
  const defs = `\ninterface ContainerDetailData {\n  container: any;\n  pos: any[];\n  charges: any[];\n  offloadId?: number | null;\n}\n\nconst saleFormSchema = z.object({\n  customerId: z.string().min(1, "Customer is required"),\n  commission: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Commission must be non-negative"),\n  commissionAccountId: z.string().optional(),\n  saleDate: z.string().min(1, "Sale date is required"),\n});\n`;
  if (!s.includes("interface ContainerDetailData")) {
    const idx = s.indexOf("export function useContainerDetailModel");
    s = s.slice(0, idx) + defs + "\n" + s.slice(idx);
  }
  s = s.replace("export function useContainerDetailModel() {", "export function useContainerDetailModel({ id: idProp, forceErp }: { id?: string; forceErp?: boolean }) {");
  write(rel, s);

  const parent = "client/src/pages/ContainerDetail.tsx";
  let p = read(parent);
  p = p.replace("} = useContainerDetailModel();", "} = useContainerDetailModel({ id: idProp, forceErp });");
  write(parent, p);
}

function getModelNames(sf, comp) {
  const vars = comp.body.statements.filter(ts.isVariableStatement);
  const destructure = vars.find((s) => s.declarationList.declarations.some((d) => ts.isObjectBindingPattern(d.name) && d.initializer?.getText(sf) === "model"));
  if (!destructure) return [];
  const d = destructure.declarationList.declarations.find((x) => ts.isObjectBindingPattern(x.name) && x.initializer?.getText(sf) === "model");
  const names = []; bindingNames(d.name, names); return names;
}

function extractContainerSpView() {
  const target = { path: "client/src/pages/ContainerDetail.tsx", hookPath: "client/src/pages/containerdetail/useContainerDetailModel.tsx" };
  let source = read(target.path);
  let sf = ts.createSourceFile(target.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const comp = defaultComponent(sf); if (!comp?.body) throw new Error("ContainerDetail component missing");
  const modelNames = getModelNames(sf, comp);
  const stmt = comp.body.statements.find((s) => ts.isIfStatement(s) && s.expression.getText(sf) === "isSupplierPartner" && s.thenStatement.getText(sf).includes("spDetailLoading"));
  if (!stmt || !ts.isBlock(stmt.thenStatement)) throw new Error("SP early-return block not found");
  const body = source.slice(stmt.thenStatement.getStart(sf) + 1, stmt.thenStatement.end - 1).trim();
  const used = modelNames.filter((n) => referenced(body, n));
  const rel = "client/src/pages/containerdetail/components/ContainerDetailSpView.tsx";
  const hookRel = "../useContainerDetailModel";
  write(rel, `${importsFor(sf, body)}\nimport type { useContainerDetailModel } from "${hookRel}";\n\ntype Model = ReturnType<typeof useContainerDetailModel>;\nexport function ContainerDetailSpView({ model }: { model: Model }) {\n  const {\n${used.map((n) => `    ${n},`).join("\n")}\n  } = model;\n${body.split("\n").map((l) => `  ${l}`).join("\n")}\n}\n`);
  source = source.slice(0, stmt.getStart(sf)) + `if (isSupplierPartner) {\n    return <ContainerDetailSpView model={model} />;\n  }` + source.slice(stmt.end);
  sf = ts.createSourceFile(target.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const c2 = defaultComponent(sf); const bodyText = source.slice(c2.body.getStart(sf), c2.body.end);
  source = `${importsFor(sf, bodyText)}\nimport { ContainerDetailSpView } from "./containerdetail/components/ContainerDetailSpView";\n\n${source.slice(c2.getStart(sf))}`;
  write(target.path, source);
  console.log(`WAVE6_SP_VIEW parent=${lines(target.path)} view=${lines(rel)}`);
}
extractContainerSpView();

function extractLargeDivs(target) {
  let source = read(target.path);
  let sf = ts.createSourceFile(target.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let comp = defaultComponent(sf); if (!comp?.body) return;
  const modelNames = getModelNames(sf, comp);
  const candidates = [];
  function visit(node, depth = 0) {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText();
      const text = source.slice(node.getStart(sf), node.end);
      const lc = text.split("\n").length;
      if (tag === "div" && lc >= 120 && lc <= 600 && depth > 0) { candidates.push({ node, lc }); return; }
    }
    ts.forEachChild(node, (c) => visit(c, depth + 1));
  }
  visit(comp.body, 0);
  candidates.sort((a,b) => b.lc-a.lc);
  const chosen = []; let removed = 0;
  for (const c of candidates) { if (removed >= 220) break; if (chosen.some((x) => c.node.getStart(sf) >= x.node.getStart(sf) && c.node.end <= x.node.end)) continue; chosen.push(c); removed += c.lc; }
  const reps = [], imports = []; let i = 0;
  for (const c of chosen) {
    i++; const text = source.slice(c.node.getStart(sf), c.node.end); const used = modelNames.filter((n) => referenced(text,n));
    const name = `${target.prefix}View${i}`; const rel = `${target.componentDir}/${name}.tsx`; const hookRel0 = path.relative(path.dirname(rel), target.hookPath).replaceAll(path.sep,"/").replace(/\.tsx$/,""); const hookRel = hookRel0.startsWith(".") ? hookRel0 : `./${hookRel0}`;
    write(rel, `${importsFor(sf,text)}\nimport type { ${target.hookName} } from "${hookRel}";\n\ntype Model = ReturnType<typeof ${target.hookName}>;\nexport function ${name}({ model }: { model: Model }) {\n  const {\n${used.map((n)=>`    ${n},`).join("\n")}\n  } = model;\n  return (\n${text.split("\n").map((l)=>`    ${l}`).join("\n")}\n  );\n}\n`);
    const cRel0 = path.relative(path.dirname(target.path),rel).replaceAll(path.sep,"/").replace(/\.tsx$/,""); imports.push(`import { ${name} } from "${cRel0.startsWith(".")?cRel0:`./${cRel0}`}";`); reps.push({start:c.node.getStart(sf),end:c.node.end,text:`<${name} model={model} />`});
  }
  reps.sort((a,b)=>b.start-a.start); for (const r of reps) source=source.slice(0,r.start)+r.text+source.slice(r.end);
  sf=ts.createSourceFile(target.path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX); comp=defaultComponent(sf); const bodyText=source.slice(comp.body.getStart(sf),comp.body.end); source=`${importsFor(sf,bodyText)}\n${imports.join("\n")}\n\n${source.slice(comp.getStart(sf))}`; write(target.path,source);
  console.log(`WAVE6_VIEWS ${target.path} extracted=${chosen.length} removed≈${removed} parent=${lines(target.path)}`);
}
extractLargeDivs({ path:"client/src/pages/BaleProducts.tsx", hookPath:"client/src/pages/baleproducts/useBaleProductsModel.tsx", hookName:"useBaleProductsModel", componentDir:"client/src/pages/baleproducts/components", prefix:"BaleProducts" });

function compactReturn(rel) {
  if (lines(rel) <= 900) return;
  let s = read(rel);
  const match = s.match(/\n  return \{\n([\s\S]*?)\n  \} as const;\n\}/);
  if (!match) return;
  const names = [...match[1].matchAll(/^\s*([A-Za-z_$][\w$]*),\s*$/gm)].map((m)=>m[1]);
  if (!names.length) return;
  s = s.replace(match[0], `\n  // prettier-ignore\n  return { ${names.join(", ")} } as const;\n}`);
  write(rel,s);
  console.log(`WAVE6_COMPACT ${rel} names=${names.length} lines=${lines(rel)}`);
}
compactReturn("client/src/pages/baleproducts/useBaleProductsModel.tsx");

for (const dir of ["client/src/pages/baleproducts/components", "client/src/pages/containerdetail/components"]) {
  if (!fs.existsSync(path.join(root,dir))) continue;
  for (const file of fs.readdirSync(path.join(root,dir))) if (file.endsWith(".tsx")) {
    const rel=`${dir}/${file}`; if (dir.includes("baleproducts")) rebase(rel,"./baleproducts/","../");
  }
}

console.log(`WAVE6_FINAL_SIZES BaleProducts=${lines("client/src/pages/BaleProducts.tsx")} BaleModel=${lines("client/src/pages/baleproducts/useBaleProductsModel.tsx")} ContainerDetail=${lines("client/src/pages/ContainerDetail.tsx")} ContainerModel=${lines("client/src/pages/containerdetail/useContainerDetailModel.tsx")} StockV5=${lines("client/src/pages/factory/FactoryStockAllocationV5.tsx")} StockModel=${lines("client/src/pages/factory/factorystockallocationv5/useFactoryStockAllocationV5Model.tsx")}`);
