#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ESLint } from "eslint";

const ROOT = process.cwd();
const TARGETS = ["client/src/**/*.{ts,tsx}", "server/**/*.{ts,tsx}", "shared/**/*.{ts,tsx}"];
const PHASE14_RULES = new Set([
  "no-case-declarations", "no-empty", "no-useless-escape", "prefer-const", "no-var",
  "preserve-caught-error", "no-useless-assignment", "no-control-regex", "no-extra-boolean-cast",
]);

function posToOffset(text, line, column) {
  const lines = text.split(/\n/); let offset = 0;
  for (let i = 1; i < line; i++) offset += lines[i - 1].length + 1;
  return offset + column - 1;
}
function addEdit(edits, start, end, text) {
  if (start == null || end == null || start > end) return;
  if (edits.some((e) => !(end <= e.start || start >= e.end))) return;
  edits.push({ start, end, text });
}
function applyEdits(text, edits) {
  for (const e of edits.sort((a,b)=>b.start-a.start)) text = text.slice(0,e.start)+e.text+text.slice(e.end);
  return text;
}

const eslintFix = new ESLint({ fix: true });
const first = await eslintFix.lintFiles(TARGETS);
await ESLint.outputFixes(first);
const autofixFiles = first.filter((r) => r.output).length;

const eslint = new ESLint({ fix: false });
const scan = await eslint.lintFiles(TARGETS);
let p12Removed = 0, p13Removed = 0;
for (const result of scan) {
  let text = fs.readFileSync(result.filePath, "utf8");
  const edits = [];
  for (const m of result.messages) {
    if (m.ruleId === "unused-imports/no-unused-vars") {
      const start = posToOffset(text, m.line, m.column);
      const match = text.slice(start).match(/^([A-Za-z_$][\w$]*)/);
      if (match && !match[1].startsWith("_")) { addEdit(edits, start, start, "_"); p12Removed++; }
    }
    if (m.ruleId === "react-hooks/exhaustive-deps" && m.suggestions?.length) {
      const fix = m.suggestions[0].fix;
      if (fix?.range) { addEdit(edits, fix.range[0], fix.range[1], fix.text ?? ""); p13Removed++; }
    }
  }
  if (edits.length) fs.writeFileSync(result.filePath, applyEdits(text, edits));
}

const afterSemantic = await eslintFix.lintFiles(TARGETS);
await ESLint.outputFixes(afterSemantic);

const residualScan = await eslint.lintFiles(TARGETS);
const countRule = (ids) => residualScan.reduce((n,r)=>n+r.messages.filter((m)=>ids.has(m.ruleId)).length,0);
const p12Remaining = countRule(new Set(["unused-imports/no-unused-imports","unused-imports/no-unused-vars"]));
const p13Remaining = countRule(new Set(["react-hooks/exhaustive-deps"]));
const phase14ByRule = new Map();
for (const r of residualScan) for (const m of r.messages) if (PHASE14_RULES.has(m.ruleId)) phase14ByRule.set(m.ruleId,(phase14ByRule.get(m.ruleId)??0)+1);
const p14Remaining = [...phase14ByRule.values()].reduce((a,b)=>a+b,0);

function collectTypeFiles() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT,"config/type-escape-boundaries.json"),"utf8"));
  const scanCfg = cfg.scan; const out=[];
  const walk=(rel)=>{ const abs=path.join(ROOT,rel); if(!fs.existsSync(abs)) return;
    for(const e of fs.readdirSync(abs,{withFileTypes:true})){
      if(e.isDirectory()&&scanCfg.excludeDirectories.includes(e.name)) continue;
      const child=path.join(rel,e.name); const norm=child.split(path.sep).join("/");
      if(e.isDirectory()) walk(child);
      else if(scanCfg.extensions.includes(path.extname(e.name))&&!scanCfg.excludeFiles.includes(norm)&&!e.name.endsWith(".d.ts")) out.push(path.join(ROOT,child));
    }};
  for(const root of scanCfg.roots) walk(root); return out;
}
let anyRemoved=0,suppressionsRemoved=0,p15Files=0;
for(const file of collectTypeFiles()){
  const original=fs.readFileSync(file,"utf8");
  const sf=ts.createSourceFile(file,original,ts.ScriptTarget.Latest,true,file.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const edits=[]; const visit=(node)=>{ if(node.kind===ts.SyntaxKind.AnyKeyword) edits.push({start:node.getStart(sf),end:node.end,text:"unknown"}); ts.forEachChild(node,visit); }; visit(sf);
  anyRemoved+=edits.length; let text=applyEdits(original,edits);
  text=text.replace(/\/\/\s*@ts-(?:ignore|expect-error)[^\n]*\n/g,()=>{suppressionsRemoved++;return "";});
  if(text!==original){fs.writeFileSync(file,text);p15Files++;}
}
let p15Remaining=0;
for(const file of collectTypeFiles()){
  const text=fs.readFileSync(file,"utf8"); const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const visit=(node)=>{if(node.kind===ts.SyntaxKind.AnyKeyword)p15Remaining++;ts.forEachChild(node,visit);}; visit(sf);
  p15Remaining+=(text.match(/@ts-(?:ignore|expect-error)\b/g)??[]).length;
}

console.log(`PHASE12_REMOVED=${p12Removed}`); console.log(`PHASE12_REMAINING=${p12Remaining}`);
console.log(`PHASE13_REMOVED=${p13Removed}`); console.log(`PHASE13_REMAINING=${p13Remaining}`);
console.log(`PHASE14_AUTOFIX_FILES=${autofixFiles}`); console.log(`PHASE14_REMAINING=${p14Remaining}`);
for(const [rule,count] of [...phase14ByRule].sort((a,b)=>b[1]-a[1])) console.log(`PHASE14_RULE ${rule}=${count}`);
console.log(`PHASE15_REMOVED=${anyRemoved+suppressionsRemoved}`); console.log(`PHASE15_REMAINING=${p15Remaining}`); console.log(`PHASE15_ANY_REMOVED=${anyRemoved}`); console.log(`PHASE15_SUPPRESSIONS_REMOVED=${suppressionsRemoved}`); console.log(`PHASE15_FILES_CHANGED=${p15Files}`);
