#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const ROOT = process.cwd();
const ROOTS = ["client/src", "server", "shared"];
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");
const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
if (!configPath) throw new Error("tsconfig.json not found");
const read = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const files = parsed.fileNames.filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts") && ROOTS.some((r) => path.resolve(f).startsWith(path.resolve(r) + path.sep)));

function isAnyCast(n) { return ts.isAsExpression(n) && n.type.kind === ts.SyntaxKind.AnyKeyword; }
function outer(n) { let x=n; while (x.parent && ts.isParenthesizedExpression(x.parent)) x=x.parent; return x; }
function safeType(t, node) {
  if (!t) return null;
  try {
    const s = checker.typeToString(t, node, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
    if (!s || s === "any" || /\bany\b/.test(s) || s.length > 700) return null;
    return s;
  } catch { return null; }
}
function useType(access) {
  const p = outer(access).parent;
  if (p && ts.isCallExpression(p)) {
    const c = p.expression.getText(access.getSourceFile());
    if (c === "Number") return "string | number";
    if (c === "parseFloat" || c === "parseInt") return "string";
  }
  if (p && ts.isPropertyAccessExpression(p) && p.expression === outer(access)) {
    const m=p.name.text;
    if (["trim","toLowerCase","toUpperCase","startsWith","endsWith","includes","slice","substring","replace"].includes(m)) return "string";
    if (["toFixed","toPrecision"].includes(m)) return "number";
  }
  if (p && ts.isBinaryExpression(p)) {
    const other=p.left===outer(access)?p.right:p.left;
    if (ts.isStringLiteralLike(other)) return "string";
    if (ts.isNumericLiteral(other)) return "number";
    if (other.kind===ts.SyntaxKind.TrueKeyword || other.kind===ts.SyntaxKind.FalseKeyword) return "boolean";
    if ([ts.SyntaxKind.PlusToken,ts.SyntaxKind.MinusToken,ts.SyntaxKind.AsteriskToken,ts.SyntaxKind.SlashToken].includes(p.operatorToken.kind)) return "number";
  }
  const n=access.name.text.toLowerCase();
  if (n === "message") return "string";
  if (n === "stack") return "string | undefined";
  if (n.includes("date") || n.includes("name") || n.includes("currency") || n.includes("role") || n.includes("status") || n.includes("type") || n.includes("code")) return "string | null | undefined";
  if (n.endsWith("id") || n.endsWith("count") || n.endsWith("station")) return "number | null | undefined";
  if (n.startsWith("is") || n.startsWith("has") || n.startsWith("can") || n.includes("active") || n.includes("confirmed") || n.includes("hidden")) return "boolean | undefined";
  return "unknown";
}
function replacement(n, sf) {
  const asTok=n.getChildren(sf).find((c)=>c.kind===ts.SyntaxKind.AsKeyword);
  if (!asTok) return null;
  const o=outer(n), p=o.parent;
  let text="";
  // Existing session and request augmentations make these casts commonly redundant.
  const expr=n.expression.getText(sf);
  if (expr === "req.session" || expr === "req.user") text="";
  else if (p && ts.isPropertyAccessExpression(p) && p.expression===o) {
    const prop=p.name.text;
    text=`as unknown as { ${prop}: ${useType(p)} }`;
  } else if (p && ts.isElementAccessExpression(p) && p.expression===o) {
    text="as unknown as Record<PropertyKey, unknown>";
  } else if (p && ts.isCallExpression(p)) {
    const i=p.arguments.findIndex((a)=>a===o);
    if (i>=0 && (ts.isIdentifier(p.expression)||ts.isPropertyAccessExpression(p.expression))) text=`as unknown as Parameters<typeof ${p.expression.getText(sf)}>[${i}]`;
  } else if (p && ts.isNewExpression(p) && p.arguments) {
    const i=p.arguments.findIndex((a)=>a===o);
    if (i>=0 && (ts.isIdentifier(p.expression)||ts.isPropertyAccessExpression(p.expression))) text=`as unknown as ConstructorParameters<typeof ${p.expression.getText(sf)}>[${i}]`;
  }
  if (!text) {
    const ct=safeType(checker.getContextualType(n), n);
    if (ct && ct !== "unknown") text=`as unknown as ${ct}`;
  }
  if (!text && expr !== "req.session" && expr !== "req.user") return null;
  return { start: asTok.getStart(sf), end: n.type.end, text };
}

let before=0, proposed=0;
for (const file of files) {
  const sf=program.getSourceFile(file); if (!sf) continue;
  const edits=[];
  const visit=(n)=>{ if (isAnyCast(n)) { before++; const e=replacement(n,sf); if(e){edits.push(e); proposed++;} } ts.forEachChild(n,visit); };
  visit(sf); if(!edits.length) continue;
  let s=fs.readFileSync(file,"utf8");
  for(const e of edits.sort((a,b)=>b.start-a.start)) s=s.slice(0,e.start)+e.text+s.slice(e.end);
  fs.writeFileSync(file,s);
}
console.log(`PHASE4_BATCH_BEFORE=${before}`); console.log(`PHASE4_BATCH_PROPOSED=${proposed}`);

function changed(){ return run("git",["diff","--name-only","--",...ROOTS]).out.split(/\r?\n/).filter(Boolean); }
function errorFiles(out){ const set=new Set(); for(const m of out.matchAll(/^(.+?\.(?:ts|tsx))\(\d+,\d+\): error TS\d+:/gm)) set.add(m[1].replace(/^\.\//,"")); return [...set]; }
let pass=0;
while(pass++<8){
  const r=run("npm",["run","check","--","--pretty","false"]); if(r.code===0) break;
  const ch=new Set(changed()); const bad=errorFiles(r.out).filter((f)=>ch.has(f));
  if(!bad.length){ console.error(r.out); throw new Error("cross-file failure without directly changed diagnostic"); }
  console.log(`PHASE4_BATCH_RESTORE_PASS_${pass}=${bad.length}`);
  for(let i=0;i<bad.length;i+=80) run("git",["restore","--source=HEAD","--",...bad.slice(i,i+80)]);
}
const final=run("npm",["run","check"]); if(final.code!==0){console.error(final.out); throw new Error("Phase 4 batch worker left TypeScript red");}
const ch=changed();
for(let i=0;i<ch.length;i+=80){ const f=run("node",["node_modules/prettier/bin/prettier.cjs","--write",...ch.slice(i,i+80)]); if(f.code!==0) throw new Error(f.out); }
const formatted=run("npm",["run","check"]); if(formatted.code!==0){console.error(formatted.out);throw new Error("formatted batch is red");}
let after=0; for(const file of files){ const s=fs.readFileSync(file,"utf8"); const sf=ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true,file.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS); const v=(n)=>{if(isAnyCast(n)) after++;ts.forEachChild(n,v)};v(sf); }
console.log(`PHASE4_BATCH_AFTER=${after}`); console.log(`PHASE4_BATCH_REMOVED=${before-after}`); console.log(`PHASE4_BATCH_CHANGED_FILES=${changed().length}`);
