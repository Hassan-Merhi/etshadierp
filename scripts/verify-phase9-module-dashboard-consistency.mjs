#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const read = (file) => fs.readFile(path.join(ROOT, file), "utf8");

const identity = await read("client/src/components/navigation/module-identity.tsx");
const dashboard = await read("client/src/components/dashboard/dashboard-shell.tsx");
const erpShell = await read("client/src/app/ErpShell.tsx");
const factoryShell = await read("client/src/app/FactoryShell.tsx");
const posShell = await read("client/src/app/PosShell.tsx");
const propertiesSidebar = await read("client/src/components/PropertiesSidebar.tsx");
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

for (const [name, source, tokens] of [
  ["ERP shell", erpShell, ["ModuleIdentity", 'moduleName="ERP"', 'tone="erp"', "selectedCompany?.name"]],
  ["Factory shell", factoryShell, ["ModuleIdentity", 'moduleName="Factory"', 'tone="factory"', "myAccess?.companyName"]],
  ["POS shell", posShell, ["ModuleIdentity", 'tone="pos"', "user.posStation", "selectedCompany?.name"]],
  ["Properties sidebar", propertiesSidebar, ['label="Business OS"', 'tagline="Properties / Rentals"', "MODULE_ACCENT.properties"]],
]) {
  for (const token of tokens) {
    if (!source.includes(token)) failures.push(`${name} adoption missing: ${token}`);
  }
}

for (const source of [erpShell, factoryShell]) {
  if (source.includes('accentColor="#')) failures.push("Module shell still uses a hard-coded top-bar accent color");
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

console.log(JSON.stringify({ phase: 9, status: "complete", protectedContracts: 49 }, null, 2));
