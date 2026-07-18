#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const read = (file) => fs.readFile(path.join(ROOT, file), "utf8");

const checks = [];
function requireMatch(source, regex, message) {
  checks.push({ ok: regex.test(source), message });
}

const primitivePath = "client/src/components/financial/financial-screen.tsx";
const pageStatePath = "client/src/components/ui/page-state.tsx";
const primitive = await read(primitivePath);
const pageState = await read(pageStatePath);

requireMatch(primitive, /export function FinancialScreenHeader/, "shared financial header exists");
requireMatch(primitive, /export function FinancialSummaryCard/, "shared financial summary card exists");
requireMatch(primitive, /export function FinancialSummaryGrid/, "responsive financial summary grid exists");
requireMatch(primitive, /export function FinancialTableShell/, "shared financial table shell exists");
requireMatch(primitive, /tabular-nums/, "financial values use tabular numerals");
requireMatch(primitive, /sm:flex-row/, "financial headers and filters retain responsive stacking");
requireMatch(primitive, /text-success/, "financial card supports semantic success tone");
requireMatch(primitive, /text-warning/, "financial card supports semantic warning tone");
requireMatch(primitive, /text-destructive/, "financial card supports semantic destructive tone");
requireMatch(pageState, /export function LoadingState/, "shared loading state remains available");
requireMatch(pageState, /export function EmptyState/, "shared empty state remains available");
requireMatch(pageState, /export function ErrorState/, "shared error state remains available");

const failures = checks.filter((check) => !check.ok);
if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure.message}`);
  process.exit(1);
}

console.log(JSON.stringify({ phase: "7B", checks: checks.length, status: "ok" }, null, 2));
