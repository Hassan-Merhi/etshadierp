#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const read = (file) => fs.readFile(path.join(ROOT, file), "utf8");

const checks = [];
function requireMatch(source, regex, message) {
  checks.push({ ok: regex.test(source), message });
}

const primitive = await read("client/src/components/financial/financial-screen.tsx");
const pageState = await read("client/src/components/ui/page-state.tsx");
const responsive = await read("client/src/components/ui/responsive-accessibility.tsx");
const shell = await read("client/src/app/ErpShell.tsx");

requireMatch(primitive, /export function FinancialScreen\(/, "shared financial page container exists");
requireMatch(primitive, /export function FinancialScreenHeader/, "shared financial header exists");
requireMatch(primitive, /export function FinancialSectionHeader/, "shared financial section header exists");
requireMatch(primitive, /export function FinancialSummaryCard/, "shared financial summary card exists");
requireMatch(primitive, /export function FinancialSummaryGrid/, "responsive financial summary grid exists");
requireMatch(primitive, /export function FinancialStatusStrip/, "shared financial status strip exists");
requireMatch(primitive, /export function FinancialTableShell/, "shared financial table shell exists");
requireMatch(primitive, /HorizontalScrollRegion/, "financial tables use the accessible scroll-region contract");
requireMatch(primitive, /tabular-nums/, "financial values use tabular numerals");
requireMatch(primitive, /text-success/, "financial card supports semantic success tone");
requireMatch(primitive, /text-warning/, "financial card supports semantic warning tone");
requireMatch(primitive, /text-destructive/, "financial card supports semantic destructive tone");
requireMatch(pageState, /export function LoadingState/, "shared loading state remains available");
requireMatch(pageState, /export function EmptyState/, "shared empty state remains available");
requireMatch(pageState, /export function ErrorState/, "shared error state remains available");
requireMatch(responsive, /aria-describedby/, "wide financial tables retain horizontal-scroll instructions");
requireMatch(shell, /id="main-content"/, "ERP shell exposes the universal skip-link target");
requireMatch(shell, /aria-label="ERP workspace"/, "ERP workspace has a stable accessible name");
requireMatch(shell, /LoadingState/, "ERP route loading uses the shared accessible state");
requireMatch(shell, /min-w-0 max-w-full/, "all ERP financial screens receive overflow containment");
requireMatch(shell, /\[&_table\]:w-full/, "all ERP financial tables receive responsive width protection");
requireMatch(shell, /overscroll-y-contain/, "ERP workspace contains mobile overscroll");

const failures = checks.filter((check) => !check.ok);
if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure.message}`);
  process.exit(1);
}

console.log(JSON.stringify({ phase: "7B", scope: "all ERP financial routes", checks: checks.length, status: "ok" }, null, 2));
