#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const target = path.join(ROOT, "client/src/components/operations/operations-screen.tsx");
const source = await fs.readFile(target, "utf8");

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

console.log(JSON.stringify({ ok: true, component: path.relative(ROOT, target), protectedContracts: required.length }, null, 2));