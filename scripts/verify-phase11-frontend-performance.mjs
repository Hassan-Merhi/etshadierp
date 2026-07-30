#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function requireText(relativePath, text, label = text) {
  if (!read(relativePath).includes(text)) failures.push(`${relativePath}: missing ${label}`);
}

function forbidText(relativePath, text, label = text) {
  if (read(relativePath).includes(text)) failures.push(`${relativePath}: forbidden ${label}`);
}

function requireLineLimit(relativePath, maximum) {
  const lines = read(relativePath).split(/\r?\n/).length;
  if (lines > maximum) failures.push(`${relativePath}: ${lines} lines exceeds ${maximum}`);
}

const authenticatedApp = "client/src/app/AuthenticatedApp.tsx";
for (const marker of [
  'lazy(() => import("./PosShell")',
  'import("./PropertiesShell")',
  'lazy(() => import("./FactoryShell")',
  'lazy(() => import("./ErpShell")',
  "<Suspense fallback={<AppLoadingState />}",
  "needsFactorySettings",
]) {
  requireText(authenticatedApp, marker);
}
for (const staticImport of [
  'import { PosShell } from "./PosShell"',
  'import { PropertiesShell } from "./PropertiesShell"',
  'import { FactoryShell } from "./FactoryShell"',
  'import { ErpShell } from "./ErpShell"',
]) {
  forbidText(authenticatedApp, staticImport, "static mode-shell import");
}
requireLineLimit(authenticatedApp, 180);

const appData = "client/src/app/useAuthenticatedAppData.ts";
requireText(appData, "needsFactorySettings: boolean");
requireText(appData, "needsFactorySettings,\n}: UseAuthenticatedAppDataOptions");
requireText(appData, "enabled: userPresent && !isPOS && !!selectedCompanyId && needsFactorySettings");
requireText(appData, "staleTime: 5 * 60 * 1000");

const lazyAudit = "client/src/components/performance/LazyAuditLog.tsx";
requireText(lazyAudit, 'lazy(() =>\n  import("@/pages/settings/AuditLog")');
requireText(lazyAudit, "<Suspense");
requireLineLimit(lazyAudit, 80);

const lazyDialogs = "client/src/components/performance/LazyDaybookDialogs.tsx";
for (const marker of [
  'import("@/pages/daybook/VoucherDetailsDialog")',
  'import("@/pages/daybook/VoucherEditDialog")',
  "if (!props.open) return null",
  "<Suspense fallback={null}>",
]) {
  requireText(lazyDialogs, marker);
}
requireLineLimit(lazyDialogs, 100);

const lazyPlugin = "build/viteLazyHeavyImportsPlugin.ts";
for (const marker of [
  "AGENTS_SUFFIX",
  "DAYBOOK_SUFFIX",
  "FACTORY_DAYBOOK_SUFFIX",
  "COMBINED_STOCK_VIEW_SUFFIX",
  'await import("@/lib/excelHelper")',
  "LazyAuditLog",
  "LazyDaybookDialogs",
  "tableSummary",
  "groupSummaries",
  "locationTotals",
  "try {\\n      const workbook",
]) {
  requireText(lazyPlugin, marker);
}
forbidText(lazyPlugin, "try:\\n", "invalid try template");
requireLineLimit(lazyPlugin, 260);

const combinedRows = "client/src/pages/location-inventory/useCombinedStockRows.ts";
for (const marker of [
  "useDeferredValue",
  "const deferredSearchTerm = useDeferredValue(allStockSearchTerm)",
  "const matrixProfile = useMemo",
  "searchText:",
  "deferredSearchTerm,",
]) {
  requireText(combinedRows, marker);
}
forbidText(combinedRows, "allStockSearchTerm.toLowerCase()", "eager search filtering");
requireLineLimit(combinedRows, 190);

if (failures.length > 0) {
  console.error("Phase 11 frontend performance verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Phase 11 frontend performance boundaries verified.");
