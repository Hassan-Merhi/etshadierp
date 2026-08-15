#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ESLint } from "eslint";

const ROOT = process.cwd();
const TARGETS = ["client/src/**/*.{ts,tsx}", "server/**/*.{ts,tsx}", "shared/**/*.{ts,tsx}"];
const eslint = new ESLint({ fix: false });

function addEdit(edits, start, end, text) {
  const key = `${start}:${end}:${text}`;
  if (edits.some((e) => e.key === key)) return false;
  if (edits.some((e) => !(end <= e.start || start >= e.end))) return false;
  edits.push({ start, end, text, key });
  return true;
}
function applyEdits(text, edits) {
  for (const e of edits.sort((a,b)=>b.start-a.start)) text = text.slice(0,e.start)+e.text+text.slice(e.end);
  return text;
}
function lineOf(sf, pos) { return sf.getLineAndCharacterOfPosition(pos).line + 1; }
function findVariable(sf, name) {
  let found;
  const visit = (n) => {
    if (!found && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) found = n;
    if (!found) ts.forEachChild(n, visit);
  };
  visit(sf); return found;
}
function findFunction(sf, name) {
  let found;
  const visit = (n) => {
    if (!found && ts.isFunctionDeclaration(n) && n.name?.text === name) found = n;
    if (!found) ts.forEachChild(n, visit);
  };
  visit(sf); return found;
}
function findUseCallbackAtLine(sf, targetLine) {
  let best;
  const visit = (n) => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "useCallback" && n.arguments.length === 1) {
      const ln = lineOf(sf, n.getStart(sf));
      const d = Math.abs(ln-targetLine);
      if (!best || d < best.d) best = { node:n, d };
    }
    ts.forEachChild(n, visit);
  };
  visit(sf); return best?.node;
}
function ensureHookImports(text, names) {
  const needed = [...names].filter((n) => new RegExp(`\\b${n}\\s*\\(`).test(text));
  if (!needed.length) return text;
  const named = text.match(/import\s*\{([\s\S]*?)\}\s*from\s*["']react["'];?/);
  if (named) {
    const present = new Set(named[1].split(",").map((s)=>s.trim().split(/\s+as\s+/)[0]).filter(Boolean));
    const missing = needed.filter((n)=>!present.has(n));
    if (!missing.length) return text;
    const body = named[1].trim();
    const replacement = `import { ${body}${body ? ", " : ""}${missing.join(", ")} } from "react";`;
    return text.slice(0,named.index)+replacement+text.slice(named.index+named[0].length);
  }
  const missing = needed.filter((n)=>!new RegExp(`import[^;]*\\b${n}\\b[^;]*from\\s*["']react["']`).test(text));
  if (!missing.length) return text;
  return `import { ${missing.join(", ")} } from "react";\n` + text;
}

// Phase 13 special case: replace complex dependency expressions with stable primitive keys.
const gitPath = path.join(ROOT,"client/src/pages/GITContainers.tsx");
if (fs.existsSync(gitPath)) {
  let text = fs.readFileSync(gitPath,"utf8");
  if (!text.includes("const containerFiltersKey = containerFilters.join")) {
    const marker = "\n  useEffect(() => {\n    setPage(1);\n";
    const block = `\n  const containerFiltersKey = containerFilters.join(",");\n  const supplierFiltersKey = supplierFilters.join(",");\n  const transporterFiltersKey = transporterFilters.join(",");\n  const agentFiltersKey = agentFilters.join(",");\n  const truckFiltersKey = truckFilters.join(",");\n  const locationFiltersKey = locationFilters.join(",");\n  const etaFilterKey = etaFilter === "ALL" ? "ALL" : JSON.stringify(etaFilter);\n`;
    if (text.includes(marker)) text = text.replace(marker, block + marker);
    text = text.replace('    containerFilters.join(","),','    containerFiltersKey,')
      .replace('    supplierFilters.join(","),','    supplierFiltersKey,')
      .replace('    transporterFilters.join(","),','    transporterFiltersKey,')
      .replace('    agentFilters.join(","),','    agentFiltersKey,')
      .replace('    truckFilters.join(","),','    truckFiltersKey,')
      .replace('    locationFilters.join(","),','    locationFiltersKey,')
      .replace('    etaFilter === "ALL" ? "ALL" : JSON.stringify(etaFilter),','    etaFilterKey,');
    fs.writeFileSync(gitPath,text);
  }
}

let totalChanges = 0;
for (let pass=0; pass<6; pass++) {
  const results = await eslint.lintFiles(TARGETS);
  let passChanges = 0;
  for (const r of results) {
    const hookMessages = r.messages.filter((m)=>m.ruleId === "react-hooks/exhaustive-deps");
    if (!hookMessages.length) continue;
    const original = fs.readFileSync(r.filePath,"utf8");
    const sf = ts.createSourceFile(r.filePath,original,ts.ScriptTarget.Latest,true,r.filePath.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    const edits=[];
    for (const m of hookMessages) {
      if (m.suggestions?.length) {
        const fix = m.suggestions[0].fix;
        if (fix?.range && addEdit(edits,fix.range[0],fix.range[1],fix.text??"")) passChanges++;
        continue;
      }
      let match = m.message.match(/The '([^']+)' (?:logical expression|object construction|conditional) could make/);
      if (match) {
        const decl=findVariable(sf,match[1]);
        if (decl?.initializer && !/^useMemo\s*\(/.test(decl.initializer.getText(sf))) {
          const init=decl.initializer.getText(sf);
          if (addEdit(edits,decl.initializer.getStart(sf),decl.initializer.end,`useMemo(() => (${init}), [])`)) passChanges++;
        }
        continue;
      }
      match = m.message.match(/The '([^']+)' function makes/);
      if (match) {
        const name=match[1]; const decl=findVariable(sf,name);
        if (decl?.initializer && !/^useCallback\s*\(/.test(decl.initializer.getText(sf))) {
          const init=decl.initializer.getText(sf);
          if(addEdit(edits,decl.initializer.getStart(sf),decl.initializer.end,`useCallback(${init}, [])`)) passChanges++;
        } else {
          const fn=findFunction(sf,name);
          if(fn){const src=fn.getText(sf);if(addEdit(edits,fn.getStart(sf),fn.end,`const ${name} = useCallback(${src}, []);`))passChanges++;}
        }
        continue;
      }
      if (m.message.includes("useCallback does nothing when called with only one argument")) {
        const call=findUseCallbackAtLine(sf,m.line);
        if(call){const close=call.end-1;if(addEdit(edits,close,close,", []"))passChanges++;}
      }
    }
    if (edits.length) {
      let text=applyEdits(original,edits);
      text=ensureHookImports(text,new Set(["useMemo","useCallback"]));
      fs.writeFileSync(r.filePath,text);
    }
  }
  totalChanges += passChanges;
  if (!passChanges) break;
}

const finalScan = await eslint.lintFiles(TARGETS);
const p12Remaining=finalScan.reduce((n,r)=>n+r.messages.filter(m=>m.ruleId==="unused-imports/no-unused-imports"||m.ruleId==="unused-imports/no-unused-vars").length,0);
const p13=[];const phase14Rules=new Set(["no-case-declarations","no-empty","no-useless-escape","prefer-const","no-var","preserve-caught-error","no-useless-assignment","no-control-regex","no-extra-boolean-cast"]);let p14Remaining=0;
for(const r of finalScan)for(const m of r.messages){if(m.ruleId==="react-hooks/exhaustive-deps")p13.push(`${path.relative(ROOT,r.filePath)}:${m.line}:${m.column} ${m.message}`);if(phase14Rules.has(m.ruleId))p14Remaining++;}

let p15Remaining=0;const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,"config/type-escape-boundaries.json"),"utf8"));const sc=cfg.scan;const files=[];
const walk=rel=>{const abs=path.join(ROOT,rel);if(!fs.existsSync(abs))return;for(const e of fs.readdirSync(abs,{withFileTypes:true})){if(e.isDirectory()&&sc.excludeDirectories.includes(e.name))continue;const child=path.join(rel,e.name),norm=child.split(path.sep).join("/");if(e.isDirectory())walk(child);else if(sc.extensions.includes(path.extname(e.name))&&!sc.excludeFiles.includes(norm)&&!e.name.endsWith(".d.ts"))files.push(path.join(ROOT,child));}};for(const root of sc.roots)walk(root);
for(const file of files){const text=fs.readFileSync(file,"utf8");const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);const visit=n=>{if(n.kind===ts.SyntaxKind.AnyKeyword)p15Remaining++;ts.forEachChild(n,visit);};visit(sf);p15Remaining+=(text.match(/@ts-(?:ignore|expect-error)\b/g)??[]).length;}
console.log(`PHASE12_REMAINING=${p12Remaining}`);console.log(`PHASE13_CHANGES=${totalChanges}`);console.log(`PHASE13_REMAINING=${p13.length}`);for(const x of p13)console.log(`PHASE13_RESIDUAL ${x}`);console.log(`PHASE14_REMAINING=${p14Remaining}`);console.log(`PHASE15_REMAINING=${p15Remaining}`);
