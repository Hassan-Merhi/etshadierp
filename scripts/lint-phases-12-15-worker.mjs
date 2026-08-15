#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { ESLint } from "eslint";

const ROOT = process.cwd();
const TARGETS = ["client/src/**/*.{ts,tsx}", "server/**/*.{ts,tsx}", "shared/**/*.{ts,tsx}"];

function replaceOnce(file, from, to) {
  const abs = path.join(ROOT, file);
  const text = fs.readFileSync(abs, "utf8");
  if (text.includes(to)) return;
  if (!text.includes(from)) throw new Error(`Expected pattern not found in ${file}: ${from}`);
  fs.writeFileSync(abs, text.replace(from, to));
}

// Restore the one file that received an unsafe partial write, then apply only the intended stabilization.
const posPath = "client/src/pages/pos/PosTransferOrders.tsx";
const restoredPos = execFileSync("git", ["show", `61bf019c2:${posPath}`], { encoding: "utf8" });
fs.writeFileSync(
  path.join(ROOT, posPath),
  restoredPos.replace(
    "  const myLocationIds = new Set(myLocations.map((location) => location.id));",
    "  const myLocationIds = useMemo(() => new Set(myLocations.map((location) => location.id)), [myLocations]);"
  )
);

replaceOnce(
  "client/src/pages/pos/postransferorders/components/CreateTransferDialog.tsx",
  "  const addedIds = new Set(items.map((i) => i.stockItemId));",
  "  const addedIds = useMemo(() => new Set(items.map((i) => i.stockItemId)), [items]);"
);

replaceOnce(
  "client/src/pages/pos/postransferorders/components/EditableTransferDetail.tsx",
  "  const alreadyAddedIds = new Set([...extraItems.map((e) => e.stockItemId), ...myItems.map((i) => i.stockItemId)]);",
  "  const alreadyAddedIds = useMemo(\n    () => new Set([...extraItems.map((e) => e.stockItemId), ...myItems.map((i) => i.stockItemId)]),\n    [extraItems, myItems]\n  );"
);

const voucherFile = "client/src/pages/vouchers/useVoucherQueries.ts";
const voucherAbs = path.join(ROOT, voucherFile);
let voucherText = fs.readFileSync(voucherAbs, "utf8");
const localSet = '  const PAY_FROM_LEDGER_TYPES = new Set(["Cash", "Bank", "Loans"]);\n';
if (voucherText.includes(localSet)) {
  voucherText = `const PAY_FROM_LEDGER_TYPES = new Set(["Cash", "Bank", "Loans"]);\n\n${voucherText.replace(localSet, "")}`;
  voucherText = voucherText.replace(
    "    [ledgerAccounts, bankAccounts, PAY_FROM_LEDGER_TYPES]",
    "    [ledgerAccounts, bankAccounts]"
  );
  fs.writeFileSync(voucherAbs, voucherText);
}

const eslint = new ESLint({ fix: false });
const results = await eslint.lintFiles(TARGETS);
const phase14Rules = new Set([
  "no-case-declarations", "no-empty", "no-useless-escape", "prefer-const", "no-var",
  "preserve-caught-error", "no-useless-assignment", "no-control-regex", "no-extra-boolean-cast",
]);
let p12 = 0, p13 = 0, p14 = 0;
for (const r of results) {
  for (const m of r.messages) {
    if (m.ruleId === "unused-imports/no-unused-imports" || m.ruleId === "unused-imports/no-unused-vars") p12++;
    if (m.ruleId === "react-hooks/exhaustive-deps") {
      p13++;
      console.log(`PHASE13_RESIDUAL ${path.relative(ROOT, r.filePath)}:${m.line}:${m.column} ${m.message}`);
    }
    if (phase14Rules.has(m.ruleId)) p14++;
  }
}

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config/type-escape-boundaries.json"), "utf8"));
const scan = cfg.scan;
const files = [];
function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.isDirectory() && scan.excludeDirectories.includes(e.name)) continue;
    const child = path.join(rel, e.name);
    const norm = child.split(path.sep).join("/");
    if (e.isDirectory()) walk(child);
    else if (scan.extensions.includes(path.extname(e.name)) && !scan.excludeFiles.includes(norm) && !e.name.endsWith(".d.ts")) files.push(path.join(ROOT, child));
  }
}
for (const root of scan.roots) walk(root);
let p15 = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (n) => { if (n.kind === ts.SyntaxKind.AnyKeyword) p15++; ts.forEachChild(n, visit); };
  visit(sf);
  p15 += (text.match(/@ts-(?:ignore|expect-error)\b/g) ?? []).length;
}
console.log(`PHASE12_REMAINING=${p12}`);
console.log(`PHASE13_REMAINING=${p13}`);
console.log(`PHASE14_REMAINING=${p14}`);
console.log(`PHASE15_REMAINING=${p15}`);
if (p12 || p13 || p14 || p15) process.exitCode = 2;
