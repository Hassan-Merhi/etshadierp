#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const primitivePath = "client/src/components/operations/operations-screen.tsx";
const shellPath = "client/src/app/FactoryShell.tsx";
const source = await fs.readFile(path.join(ROOT, primitivePath), "utf8");
const shell = await fs.readFile(path.join(ROOT, shellPath), "utf8");

const required = [
  "OperationsScreen",
  "OperationsScreenHeader",
  "OperationsSectionHeading",
  "OperationsMetricCard",
  "OperationsMetricGrid",
  "OperationsStatusStrip",
  "OperationsTableShell",
  "OperationsTableScroll",
  "HorizontalScrollRegion",
  "SkipLink",
  'id="main-content"',
  'role="status"',
  'aria-atomic="true"',
  "--module-factory",
  "tabular-nums",
  "sm:grid-cols-2",
  "xl:grid-cols-4",
  "sm:flex-row",
  "text-success",
  "text-warning",
  "text-info",
];

const missing = required.filter((token) => !source.includes(token));
for (const token of [
  'id="main-content"',
  'aria-label="Factory and inventory workspace"',
  "LoadingState",
  "min-w-0 max-w-full",
  "[&_table]:w-full",
  "overscroll-y-contain",
]) {
  if (!shell.includes(token)) missing.push(`FactoryShell:${token}`);
}

if (missing.length > 0) {
  console.error(JSON.stringify({ ok: false, missing }, null, 2));
  process.exit(1);
}

const forbidden = [
  "/api/",
  "useMutation(",
  "useQuery(",
  "queryClient",
  "stockQuantity",
  "costPerKg",
  "offload",
  "allocationMutation",
];

const violations = forbidden.filter((token) => source.includes(token));
if (violations.length > 0) {
  console.error(JSON.stringify({ ok: false, violations }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, phase: "7C", scope: "all factory and inventory routes", protectedContracts: required.length + 6 }, null, 2));
