import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function requireAll(relativePath, markers) {
  const source = read(relativePath);
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`${relativePath}: missing ${marker}`);
  }
  return source;
}

function forbidAll(relativePath, markers) {
  const source = read(relativePath);
  for (const marker of markers) {
    if (source.includes(marker)) failures.push(`${relativePath}: contains forbidden ${marker}`);
  }
  return source;
}

for (const retiredPath of [
  "server/routesLegacy.ts",
  "server/routes/reportsRoutesLegacy.ts",
  "server/routes/authRoutesLegacy.ts",
  "server/routes/customerRoutesLegacy.ts",
]) {
  if (fs.existsSync(path.join(root, retiredPath))) failures.push(`${retiredPath}: retired path exists`);
}

requireAll("server/routes/authRoutes.ts", [
  "registerCoreAuthRoutes(app)",
  "registerSessionRoutes(app)",
  "registerAuthAuditLogRoutes(app)",
  "registerUserAdministrationRoutes(app)",
  "registerUserAccessRoutes(app)",
  "registerCompanyAccessRoutes(app)",
  "registerUserPresenceRoutes(app)",
  "registerExchangeRateRoutes(app)",
]);
forbidAll("server/routes/authRoutes.ts", ["authRoutesLegacy", "registerLegacyAuthRoutes"]);

requireAll("server/routes/reportsRoutes.ts", [
  "registerReportsNetProfitStatementRoutes(app)",
  "registerReportsClosingStockRoutes(app)",
  "registerDashboardAccountRoutes(app)",
  "registerReportsContainerTrackingRoutes(app)",
  "registerReportsLedgerRoutes(app)",
  "registerReportsVoucherDetailRoutes(app)",
]);
forbidAll("server/routes/reportsRoutes.ts", ["reportsRoutesLegacy", "registerLegacyReportsRoutes"]);

const salesEdit = requireAll("client/src/pages/voucher-edit/SalesEditForm.tsx", [
  '<p className="text-sm font-medium leading-none">Location</p>',
  'data-testid="input-location"',
]);
if (salesEdit.includes("<FormLabel>Location</FormLabel>")) {
  failures.push("SalesEditForm.tsx: display-only Location label uses FormLabel outside FormField");
}

requireAll("scripts/audit-relative-imports.mjs", [
  'import ts from "typescript"',
  "ts.createSourceFile",
  "ts.isImportDeclaration",
  "ts.isExportDeclaration",
  "ts.SyntaxKind.ImportKeyword",
  'node.expression.text === "require"',
  "RESOLUTION_EXTENSIONS",
  "RETIRED_MODULES",
  "cannot resolve relative import",
  "imports retired module",
]);
requireAll("scripts/verify-lockfile-registry.mjs", [
  'import { auditRelativeImports } from "./audit-relative-imports.mjs"',
  "const importReport = auditRelativeImports()",
  "PRODUCTION IMPORT BOUNDARY FAILED",
]);

for (const relativePath of [
  "tests/auth-route-composition.test.ts",
  "tests/reports-route-composition.test.ts",
  "tests/customer-route-composition.test.ts",
  "tests/duplicate-route-ownership.test.ts",
  "tests/inventory-route-ownership.test.ts",
  "tests/operations-route-ownership.test.ts",
  "tests/phase2-backend-module-separation.test.ts",
  "tests/phase5-routes-legacy-extraction.test.ts",
  "scripts/verify-phase2-backend-module-separation.mjs",
  "scripts/verify-phase5-routes-legacy-extraction.mjs",
]) {
  forbidAll(relativePath, [
    "registerLegacyAuthRoutes(app)",
    "registerLegacyReportsRoutes(app)",
    "registerCustomerLegacyRoutes(app)",
    "registerLegacyRoutes(app)",
  ]);
}

for (const relativePath of [
  "tests/customer-route-composition.test.ts",
  "tests/duplicate-route-ownership.test.ts",
  "tests/inventory-route-ownership.test.ts",
  "tests/operations-route-ownership.test.ts",
  "tests/phase5-routes-legacy-extraction.test.ts",
  "scripts/verify-phase5-routes-legacy-extraction.mjs",
]) {
  requireAll(relativePath, ["existsSync"]);
}

for (const requiredFile of [
  "tests/phase9-production-boundary-contract.test.ts",
  "docs/engineering/phase9-production-boundary-cleanup.md",
]) {
  if (!fs.existsSync(path.join(root, requiredFile))) failures.push(`missing ${requiredFile}`);
}

if (failures.length > 0) {
  console.error("Phase 9 production boundary verification failed:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("Phase 9 production module and startup boundaries verified.");
