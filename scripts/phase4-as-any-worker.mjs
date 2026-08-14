#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const roots = ["client/src", "server", "shared"];
const exts = new Set([".ts", ".tsx"]);
const sessionFields = new Set([
  "userId", "username", "currentCompanyId", "factoryCompanyId", "currentRole",
  "currentLocationId", "currentPOSStation", "cashAccountId", "canSellNegativeStock",
  "posViewOnly", "daybookEditDays", "canAccessCustomers", "canDeleteRecords", "passwordConfirmedAt"
]);
const skipSessionFiles = new Set();
const skipAllTargetFiles = new Set();

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (exts.has(path.extname(entry.name)) && !entry.name.endsWith(".d.ts")) out.push(p.split(path.sep).join("/"));
  }
  return out;
}
const files = roots.flatMap((root) => walk(root)).sort();

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
function changedSourceFiles() {
  const r = run("git", ["diff", "--name-only", "--", ...roots]);
  return r.output.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
function restore(paths) {
  for (let i = 0; i < paths.length; i += 100) run("git", ["restore", "--source=HEAD", "--", ...paths.slice(i, i + 100)]);
}
function diagnosticsFiles(output) {
  const found = new Set();
  for (const m of output.matchAll(/^(.+?\.(?:ts|tsx))\(\d+,\d+\):\s+error\s+TS\d+:/gm)) found.add(m[1].replace(/^\.\//, "").split(path.sep).join("/"));
  return [...found];
}
function countAsAny() {
  let total = 0;
  const byFile = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    let n = 0;
    const visit = (node) => {
      if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) n += 1;
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (n) byFile.push([file, n]);
    total += n;
  }
  byFile.sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
  return { total, byFile };
}

function targetedBlockerPass(file) {
  if (skipAllTargetFiles.has(file)) return 0;
  let source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [];
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      let receiver = node.expression;
      while (ts.isParenthesizedExpression(receiver)) receiver = receiver.expression;
      if (ts.isAsExpression(receiver) && receiver.type.kind === ts.SyntaxKind.AnyKeyword) {
        const field = node.name.text;
        const inner = receiver.expression;
        if (field === "_handledGlobally") {
          edits.push([receiver.getStart(sf), receiver.end, `${inner.getText(sf)} as { _handledGlobally?: boolean }`]);
        } else if (!skipSessionFiles.has(file) && sessionFields.has(field) && ts.isPropertyAccessExpression(inner) && inner.name.text === "session") {
          edits.push([receiver.getStart(sf), receiver.end, inner.getText(sf)]);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const [start, end, replacement] of edits.sort((a,b) => b[0]-a[0])) source = source.slice(0,start) + replacement + source.slice(end);
  if (edits.length) fs.writeFileSync(file, source);
  return edits.length;
}

function stripAllRemainingInFile(file) {
  let source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const spans = [];
  const visit = (node) => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      const asToken = node.getChildren(sf).find((child) => child.kind === ts.SyntaxKind.AsKeyword);
      if (asToken) spans.push([asToken.getStart(sf), node.type.end]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const [start,end] of spans.sort((a,b)=>b[0]-a[0])) source = source.slice(0,start) + source.slice(end);
  if (spans.length) fs.writeFileSync(file, source);
  return spans.length;
}

const before = countAsAny();
let targeted = 0;
for (const [file] of before.byFile) targeted += targetedBlockerPass(file);
console.log(`PHASE4_WAVE_BEFORE=${before.total}`);
console.log(`PHASE4_TARGETED_BLOCKERS=${targeted}`);

// Keep the targeted wins that type-check, but do not reject the whole wave because
// a few authenticated routes relied on `any` to erase optional session fields.
let targetedCheck = run("npm", ["run", "check"]);
if (targetedCheck.code !== 0) {
  const badTargetFiles = diagnosticsFiles(targetedCheck.output).filter((file) => changedSourceFiles().includes(file));
  console.log(`PHASE4_TARGETED_DIRECT_FAILURE_FILES=${badTargetFiles.length}`);
  for (const file of badTargetFiles) skipSessionFiles.add(file);
  restore(badTargetFiles);
  for (const file of badTargetFiles) targetedBlockerPass(file);
  targetedCheck = run("npm", ["run", "check"]);
  if (targetedCheck.code !== 0) {
    const stillBad = diagnosticsFiles(targetedCheck.output).filter((file) => changedSourceFiles().includes(file));
    console.log(`PHASE4_TARGETED_ALL_RESTORE_FILES=${stillBad.length}`);
    for (const file of stillBad) skipAllTargetFiles.add(file);
    restore(stillBad);
    targetedCheck = run("npm", ["run", "check"]);
  }
  if (targetedCheck.code !== 0) {
    console.error(targetedCheck.output);
    throw new Error("Targeted blocker wave still failed after restoring directly failing files.");
  }
}

let attempted = 0;
for (const [file] of countAsAny().byFile) attempted += stripAllRemainingInFile(file);
console.log(`PHASE4_WAVE_ATTEMPTED_REMAINDER=${attempted}`);

for (let iteration=1; iteration<=35; iteration++) {
  const check = run("npm", ["run", "check"]);
  if (check.code === 0) { console.log(`TypeScript passed after ${iteration} remainder pass(es).`); break; }
  const changed = new Set(changedSourceFiles());
  const diag = diagnosticsFiles(check.output);
  const direct = diag.filter((f)=>changed.has(f));
  if (direct.length) {
    restore(direct);
    for (const f of direct) targetedBlockerPass(f);
    const postRestore = run("npm", ["run", "check"]);
    if (postRestore.code !== 0) {
      const rebad = diagnosticsFiles(postRestore.output).filter((f)=>direct.includes(f));
      for (const f of rebad) { skipSessionFiles.add(f); restore([f]); targetedBlockerPass(f); }
    }
    console.log(`Pass ${iteration}: restored ${direct.length} directly failing files while preserving safe targeted substitutions.`);
    continue;
  }
  const remaining = [...changed];
  if (!remaining.length) { console.error(check.output); throw new Error("TypeScript red with no changed source."); }
  const clusters = new Map();
  for (const f of remaining) {
    const parts=f.split("/"); const key=parts.slice(0,Math.min(parts.length-1,4)).join("/");
    if(!clusters.has(key)) clusters.set(key,[]); clusters.get(key).push(f);
  }
  const [,cluster]=[...clusters.entries()].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0]))[0];
  restore(cluster);
  for (const f of cluster) targetedBlockerPass(f);
  console.log(`Pass ${iteration}: restored ${cluster.length} files from cross-module cluster while preserving safe targeted substitutions.`);
}

const finalCheck=run("npm",["run","check"]);
if(finalCheck.code!==0){console.error(finalCheck.output);throw new Error("Phase 4 blocker wave left TypeScript red.");}
const changed=changedSourceFiles();
for(let i=0;i<changed.length;i+=80){const fmt=run("node",["node_modules/prettier/bin/prettier.cjs","--write",...changed.slice(i,i+80)]);if(fmt.code!==0)throw new Error(fmt.output);}
const formattedCheck=run("npm",["run","check"]);if(formattedCheck.code!==0){console.error(formattedCheck.output);throw new Error("TypeScript failed after formatting.");}
const after=countAsAny();
console.log(`PHASE4_WAVE_AFTER=${after.total}`);
console.log(`PHASE4_WAVE_REMOVED=${before.total-after.total}`);
console.log(`PHASE4_WAVE_CHANGED_FILES=${changedSourceFiles().length}`);
console.log(`PHASE4_WAVE_REMAINING_FILES=${after.byFile.length}`);
for(const [file,n] of after.byFile.slice(0,80)) console.log(`${n}\t${file}`);