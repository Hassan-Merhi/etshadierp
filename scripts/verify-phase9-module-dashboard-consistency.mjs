#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const read = (file) => fs.readFile(path.join(ROOT, file), "utf8");

const identity = await read("client/src/components/navigation/module-identity.tsx");
const dashboard = await read("client/src/components/dashboard/dashboard-shell.tsx");
const failures = [];

for (const token of [
  "ModuleIdentity",
  'productName = "Business OS"',
  "moduleName",
  "companyName",
  'role="group"',
  "aria-labelledby",
  "aria-describedby",
  "--module-factory",
  "--module-pos",
  "--module-properties",
  "truncate",
  "min-w-0",
]) {
  if (!identity.includes(token)) failures.push(`Module identity contract missing: ${token}`);
}

for (const token of [
  "DashboardShell",
  "DashboardMetric",
  "DashboardMetricGrid",
  "DashboardSection",
  "ResponsiveActions",
  "ResponsiveToolbar",
  "ResponsiveGrid",
  "tabular-nums",
  "aria-labelledby",
  "break-words",
  "min-w-0",
]) {
  if (!dashboard.includes(token)) failures.push(`Dashboard consistency contract missing: ${token}`);
}

for (const forbidden of [
  "/api/",
  "useMutation(",
  "useQuery(",
  "queryClient",
  "stockQuantity",
  "saleTotal",
  "costPerKg",
  "permission",
]) {
  if (identity.includes(forbidden)) failures.push(`Module identity contains business logic: ${forbidden}`);
  if (dashboard.includes(forbidden)) failures.push(`Dashboard primitive contains business logic: ${forbidden}`);
}

if (failures.length) {
  console.error("Phase 9 module and dashboard consistency verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({ phase: 9, status: "started", protectedContracts: 31 }, null, 2));
