#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const SOURCE_ROOTS = ["client/src", "server", "shared"];
const EXTENSIONS = new Set([".ts", ".tsx"]);
const LINT_TARGETS = ["client/src/**/*.{ts,tsx}", "server/**/*.ts", "shared/**/*.ts"];
const eslintConfigPath = path.join(ROOT, "eslint.config.js");
const lintRatchetPath = path.join(ROOT, "config/lint-warning-ratchet.json");
const typeRatchetPath = path.join(ROOT, "config/type-escape-boundaries.json");
const reportPath = path.join(ROOT, "artifacts/lint/eslint-report.json");

function collectSourceFiles() {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory() && ["node_modules", "dist", "build"].includes(entry.name)) continue;
      const child = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith(".d.ts")) out.push(child);
    }
  };
  for (const root of SOURCE_ROOTS) walk(root);
  return out;
}

function stripDirectiveComments(source) {
  let removed = 0;
  let text = source;
  const patterns = [
    /\/\*\s*eslint-(?:disable|enable)(?:-next-line|-line)?[\s\S]*?\*\//g,
    /\/\/[^\n]*eslint-(?:disable|enable)(?:-next-line|-line)?[^\n]*/g,
  ];
  for (const pattern of patterns) {
    text = text.replace(pattern, () => {
      removed += 1;
      return "";
    });
  }
  return { text, removed };
}

let inlineRemoved = 0;
let filesChanged = 0;
for (const rel of collectSourceFiles()) {
  const file = path.join(ROOT, rel);
  const original = fs.readFileSync(file, "utf8");
  const next = stripDirectiveComments(original);
  inlineRemoved += next.removed;
  if (next.text !== original) {
    fs.writeFileSync(file, next.text);
    filesChanged += 1;
  }
}

const originalEslintConfig = fs.readFileSync(eslintConfigPath, "utf8");
const exemptionBlock = /\n  \{\n    files: \["client\/src\/pages\/factory\/WasteDispatchOptimized\.tsx"\],[\s\S]*?\n  \},(?=\n  configPrettier)/;
const exemptionMatches = originalEslintConfig.match(exemptionBlock);
const cleanedEslintConfig = originalEslintConfig.replace(exemptionBlock, "");
if (cleanedEslintConfig !== originalEslintConfig) fs.writeFileSync(eslintConfigPath, cleanedEslintConfig);
const configExemptionsRemoved = exemptionMatches ? 1 : 0;

let remainingInline = 0;
for (const rel of collectSourceFiles()) {
  const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
  remainingInline += (source.match(/eslint-(?:disable|enable)(?:-next-line|-line)?\b/g) ?? []).length;
}
const configTextAfter = fs.readFileSync(eslintConfigPath, "utf8");
const remainingConfigExemptions = /files:\s*\["client\/src\/pages\/factory\/WasteDispatchOptimized\.tsx"\]/.test(configTextAfter) ? 1 : 0;
console.log(`PHASE16_INLINE_REMOVED=${inlineRemoved}`);
console.log(`PHASE16_FILES_CHANGED=${filesChanged}`);
console.log(`PHASE16_CONFIG_EXEMPTIONS_REMOVED=${configExemptionsRemoved}`);
console.log(`PHASE16_INLINE_REMAINING=${remainingInline}`);
console.log(`PHASE16_CONFIG_EXEMPTIONS_REMAINING=${remainingConfigExemptions}`);
if (remainingInline || remainingConfigExemptions) throw new Error("Phase 16 suppression inventory is not zero");

const oldLint = JSON.parse(fs.readFileSync(lintRatchetPath, "utf8"));
const oldType = JSON.parse(fs.readFileSync(typeRatchetPath, "utf8"));
const oldWarningCeiling = oldLint.totals.warningCeiling;
const oldTypeCeiling = oldType.totals.typeEscapeCeiling;

const eslint = new ESLint({ fix: false });
const results = await eslint.lintFiles(LINT_TARGETS);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(results, null, 2)}\n`);
const warningTotal = results.reduce((sum, r) => sum + r.warningCount, 0);
const errorTotal = results.reduce((sum, r) => sum + r.errorCount, 0);
const perRule = {};
for (const result of results) {
  for (const message of result.messages) {
    if (message.severity !== 1) continue;
    const rule = message.ruleId ?? "(no-rule)";
    perRule[rule] = (perRule[rule] ?? 0) + 1;
  }
}
if (warningTotal > oldWarningCeiling) {
  throw new Error(`Phase 17 refuses to raise lint warning ceiling: measured ${warningTotal} > prior ${oldWarningCeiling}`);
}

execFileSync(process.execPath, ["scripts/audit-type-escapes.mjs"], {
  cwd: ROOT,
  env: { ...process.env, UPDATE_TYPE_ESCAPE_BASELINE: "1" },
  stdio: "inherit",
});
const newType = JSON.parse(fs.readFileSync(typeRatchetPath, "utf8"));
if (newType.totals.typeEscapeCeiling > oldTypeCeiling) {
  throw new Error(`Phase 17 refuses to raise type-escape ceiling: measured ${newType.totals.typeEscapeCeiling} > prior ${oldTypeCeiling}`);
}

const nextLint = JSON.parse(fs.readFileSync(lintRatchetPath, "utf8"));
nextLint.perRule = Object.fromEntries(Object.entries(perRule).sort((a, b) => b[1] - a[1]));
nextLint.totals = { ...nextLint.totals, warningCeiling: warningTotal };
nextLint.notes = {
  ...(nextLint.notes ?? {}),
  phase17: `Exact Phase 17 reconciliation: ${warningTotal} warning(s) measured on the Phase 16-cleaned tree; ceilings may only fall. Full error repair remains Phase 18 certification.`,
};
fs.writeFileSync(lintRatchetPath, `${JSON.stringify(nextLint, null, 2)}\n`);

const finalLint = JSON.parse(fs.readFileSync(lintRatchetPath, "utf8"));
const finalType = JSON.parse(fs.readFileSync(typeRatchetPath, "utf8"));
const baselineEntries = Object.keys(finalType.scan?.baseline ?? {}).length;
console.log(`PHASE17_LINT_WARNINGS=${warningTotal}`);
console.log(`PHASE17_LINT_ERRORS_DEFERRED=${errorTotal}`);
console.log(`PHASE17_LINT_CEILING_OLD=${oldWarningCeiling}`);
console.log(`PHASE17_LINT_CEILING_NEW=${finalLint.totals.warningCeiling}`);
console.log(`PHASE17_TYPE_ESCAPE_CEILING_OLD=${oldTypeCeiling}`);
console.log(`PHASE17_TYPE_ESCAPE_CEILING_NEW=${finalType.totals.typeEscapeCeiling}`);
console.log(`PHASE17_TYPE_BASELINE_ENTRIES=${baselineEntries}`);
console.log(`PHASE17_RULE_COUNT=${Object.keys(finalLint.perRule).length}`);
if (finalLint.totals.warningCeiling !== warningTotal) throw new Error("Lint ceiling is not exact");
if (finalType.totals.typeEscapeCeiling !== 0 || baselineEntries !== 0) throw new Error("Type-escape ratchet is not exhausted to zero");
