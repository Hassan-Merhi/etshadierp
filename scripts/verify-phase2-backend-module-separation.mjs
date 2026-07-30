import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (relativePath) => readFileSync(resolve(root, relativePath), "utf8");
const failures = [];

function requireText(relativePath, needle, label = needle) {
  const source = read(relativePath);
  if (!source.includes(needle)) failures.push(`${relativePath}: missing ${label}`);
  return source;
}

function forbidText(relativePath, needle, label = needle) {
  const source = read(relativePath);
  if (source.includes(needle)) failures.push(`${relativePath}: contains forbidden ${label}`);
  return source;
}

function requireInOrder(relativePath, values) {
  const source = read(relativePath);
  let previousIndex = -1;
  for (const value of values) {
    const index = source.indexOf(value);
    if (index <= previousIndex) {
      failures.push(`${relativePath}: expected ordered registration for ${value}`);
      return;
    }
    previousIndex = index;
  }
}

const rootRoutes = requireText("server/routes.ts", "registerApplicationRoutes(app)", "application route composition");
requireText("server/routes.ts", "registerOperationalMonitoringRoutes(app)", "operational monitoring registration");
if (rootRoutes.split("\n").length > 30) failures.push("server/routes.ts: composition root exceeds 30 lines");
forbidText("server/routes.ts", "registerLegacyRoutes", "legacy registry delegation");
forbidText("server/routes.ts", "app.get(", "direct GET route registration");
forbidText("server/routes.ts", "app.post(", "direct POST route registration");

for (const retiredFile of [
  "server/routesLegacy.ts",
  "server/routes/authRoutesLegacy.ts",
  "server/routes/customerRoutesLegacy.ts",
  "server/routes/reportsRoutesLegacy.ts",
]) {
  if (existsSync(resolve(root, retiredFile))) failures.push(`${retiredFile}: retired compatibility path must remain deleted`);
}

const supplierRoutes = requireText("server/routes/supplierRoutes.ts", "supplierService");
for (const forbidden of ["../db", "../storage", "@shared/schema", "drizzle-orm"]) {
  if (supplierRoutes.includes(forbidden)) failures.push(`server/routes/supplierRoutes.ts: transport layer imports ${forbidden}`);
}
requireText("server/routes/suppliers/supplierRepository.ts", "companyScopedSuppliers");
requireText("server/routes/suppliers/supplierService.ts", "getSupplierBalanceForContext");
requireText("server/routes/suppliers/supplierValidation.ts", "insertCompanyScopedSupplierSchema");

const inventoryRoutes = requireText("server/routes/inventoryRoutes.ts", "registerInventoryListRoutes");
for (const forbidden of ["../db", "../storage", "@shared/schema", "drizzle-orm"]) {
  if (inventoryRoutes.includes(forbidden)) failures.push(`server/routes/inventoryRoutes.ts: composition layer imports ${forbidden}`);
}
requireInOrder("server/routes/inventoryRoutes.ts", [
  "registerInventoryListRoutes(app)",
  "registerInventoryQuickAdjustRoutes(app)",
  "registerInventoryMovementRoutes(app)",
]);
requireText("server/routes/inventory/inventoryQueryService.ts", ".limit(filters.pageSize)");
requireText("server/routes/inventory/inventoryQuickAdjustService.ts", "Supplier Partner companies must use SP Sales");
requireText("server/routes/inventory/inventoryQuickAdjustService.ts", "db.transaction");

requireInOrder("server/routes/customerRoutes.ts", [
  "registerCustomerMasterRoutes(app)",
  "registerContainerSalesRoutes(app)",
  "registerCompanyTransferRoutes(app)",
]);
forbidText("server/routes/customerRoutes.ts", "Legacy", "legacy customer registrar");
requireText("server/routes/customers/customerBalanceQuery.ts", "historicalBaseBalance");
requireText("server/routes/customers/customerService.ts", "Accounts Receivable");
requireText("server/routes/containers/containerSalesService.ts", "db.transaction");
requireText("server/routes/containers/containerSalesService.ts", 'status: "SOLD"');

requireText("server/routes/transfers/transferRepository.ts", "listSimpleTransfers");
requireText("server/routes/transfers/interCompanyTransferService.ts", "IC-TO-");
requireText("server/routes/transfers/interCompanyTransferService.ts", "IC-FROM-");
requireText("server/routes/transfers/simpleCompanyTransferService.ts", "TRANSFER-CLEARING");
requireText("server/routes/transfers/simpleCompanyTransferService.ts", "deleteTransferVoucher");

requireInOrder("server/routes/authRoutes.ts", [
  "registerCoreAuthRoutes(app)",
  "registerSessionRoutes(app)",
  "registerAuthAuditLogRoutes(app)",
  "registerUserAdministrationRoutes(app)",
  "registerUserAccessRoutes(app)",
  "registerCompanyAccessRoutes(app)",
  "registerUserPresenceRoutes(app)",
  "registerExchangeRateRoutes(app)",
]);
forbidText("server/routes/authRoutes.ts", "authRoutesLegacy", "retired auth import");
requireText("server/routes/auth/sessionRepository.ts", "FROM session");
requireText("server/routes/auth/sessionService.ts", "ADMIN_SESSION_ROLES");
requireText("server/routes/auth/sessionRoutes.ts", '"/api/login-history"');

requireInOrder("server/routes/reportsRoutes.ts", [
  "registerReportsNetProfitStatementRoutes(app)",
  "registerReportsClosingStockRoutes(app)",
  "registerDashboardAccountRoutes(app)",
  "registerReportsContainerTrackingRoutes(app)",
  "registerReportsLedgerRoutes(app)",
  "registerReportsVoucherDetailRoutes(app)",
]);
forbidText("server/routes/reportsRoutes.ts", "reportsRoutesLegacy", "retired reports import");

for (const [relativePath, marker] of [
  ["server/routes/voucherRoutes.ts", "registerVoucherQueryRoutes"],
  ["server/routes/containerRoutes.ts", "registerContainerCrudRoutes"],
  ["server/routes/ledgerRoutes.ts", "registerLegacyLedgerRoutes"],
  ["server/routes/posRoutes.ts", "registerAllPosRoutes"],
  ["server/routes/factoryRoutes.ts", "registerFactoryStockRoutes"],
  ["server/routes/rentalRouteFactory.ts", "registerRentalUnitsContractsRoutes"],
]) {
  requireText(relativePath, marker);
}

if (failures.length > 0) {
  console.error("Phase 2 backend module separation verification failed:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("Phase 2 backend module separation contracts verified.");
