#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if ((r.status ?? 1) !== 0) {
    console.error(output);
    throw new Error(`${cmd} ${args.join(" ")} failed with exit ${r.status}`);
  }
  return output;
}

const jsonText = run("node", ["scripts/audit-type-escapes.mjs", "--json"]);
const report = JSON.parse(jsonText);
if (report.summary.asAny !== 0) {
  console.error(`PHASE4_FINALIZE_BLOCKED_AS_ANY=${report.summary.asAny}`);
  const top = report.files
    .filter((f) => f.asAny > 0)
    .sort((a, b) => b.asAny - a.asAny || a.path.localeCompare(b.path))
    .slice(0, 80);
  for (const file of top) console.error(`${file.asAny}\t${file.path}`);
  throw new Error("Phase 4 cannot finalize until every as-any assertion is removed.");
}

run("node", ["scripts/audit-type-escapes.mjs"], { UPDATE_TYPE_ESCAPE_BASELINE: "1" });
run("npm", ["run", "lint"]);
run("node", ["scripts/audit-lint-warnings.mjs"], { UPDATE_LINT_WARNING_BASELINE: "1" });

const typeConfigPath = "config/type-escape-boundaries.json";
const lintConfigPath = "config/lint-warning-ratchet.json";
const docsPath = "docs/system-quality-program.md";
const typeConfig = JSON.parse(fs.readFileSync(typeConfigPath, "utf8"));
const lintConfig = JSON.parse(fs.readFileSync(lintConfigPath, "utf8"));
const typeTotal = typeConfig.totals.typeEscapeCeiling;
const suppressions = Object.values(typeConfig.scan.baseline).reduce((sum, entry) => sum + (entry[2] ?? 0), 0);
const anyWarnings = typeTotal - suppressions;
const lintTotal = lintConfig.totals.warningCeiling;

lintConfig.notes["@typescript-eslint/no-explicit-any"] =
  `Exactly the type-escape backlog seen from ESLint: ${anyWarnings} = the ${typeTotal} in config/type-escape-boundaries.json minus its ${suppressions} suppressions, which are not an ESLint rule. The binding gate for this rule stays config/type-escape-boundaries.json, which freezes every file individually and is therefore strictly stronger than a repository total. This ceiling exists so the two cannot disagree - it must be lowered whenever the type-escape ceiling is.`;
fs.writeFileSync(lintConfigPath, `${JSON.stringify(lintConfig, null, 2)}\n`);

const fmt = (n) => Number(n).toLocaleString("en-US");
let docs = fs.readFileSync(docsPath, "utf8");
docs = docs.replace(/Type escapes \(AST\) \| [\d,]+ total/, `Type escapes (AST) | ${fmt(typeTotal)} total`);
docs = docs.replace(/ESLint warnings \| [\d,]+ total/, `ESLint warnings | ${fmt(lintTotal)} total`);
docs = docs.replace(/\*\*`totals\.warningCeiling`\*\* is the repository total, currently [\d,]+/, `**\`totals.warningCeiling\`** is the repository total, currently ${fmt(lintTotal)}`);
docs = docs.replace(/[\d,]+ of the\n  [\d,]+ warnings are `no-explicit-any`/, `${fmt(anyWarnings)} of the\n  ${fmt(lintTotal)} warnings are \`no-explicit-any\``);
docs = docs.replace(/\([\d,]+ = [\d,]+ − [\d,]+\)/, `(${fmt(anyWarnings)} = ${fmt(typeTotal)} − ${fmt(suppressions)})`);
fs.writeFileSync(docsPath, docs);

run("npm", ["run", "audit:type-escapes"]);
run("npm", ["run", "audit:lint-ratchet"]);
run("npm", ["run", "audit:doc-index"]);

console.log(`PHASE4_FINAL_TYPE_ESCAPE_CEILING=${typeTotal}`);
console.log(`PHASE4_FINAL_AS_ANY=0`);
console.log(`PHASE4_FINAL_NO_EXPLICIT_ANY_WARNINGS=${anyWarnings}`);
console.log(`PHASE4_FINAL_LINT_WARNING_CEILING=${lintTotal}`);
