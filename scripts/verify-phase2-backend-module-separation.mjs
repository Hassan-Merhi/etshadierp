import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const failures = [];

function requireText(path, needle, label = needle) {
  const source = read(path);
  if (!source.includes(needle)) failures.push(`${path}: missing ${label}`);
  return source;
}

function forbidText(path, needle, label = needle) {
  const source = read(path);
  if (source.includes(needle)) failures.push(`${path}: contains forbidden ${label}`);
  return source;
}

function requireOrder(path, first, second) {
  const source = read(path);
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    failures.push(`${path}: expected ${first} before ${second}`);
  }
}

const rootRoutes = requireText("server/routes.ts", "registerLegacyRoutes(app)", "legacy registry delegation");
if (rootRoutes.split("\n").length > 30) failures.push("server/routes.ts: composition root exceeds 30 lines");
forbidText("server/routes.ts", "app.get(", "direct GET route registration");
forbidText("server/routes.ts", "app.post(", "direct POST route registration");

for (const compatibilityFile of [
  "server/routesLegacy.ts",
  "server/routes/authRoutesLegacy.ts",
  "server/routes/customerRoutesLegacy.ts",
  "server/routes/reportsRoutesLegacy.ts",
]) {
  requireText(compatibilityFile, "export", "compatibility export");
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
requireText("server/routes/inventory/inventoryQueryService.ts", ".limit(filters.pageSize)");
requireText("server/routes/inventory/inventoryQuickAdjustService.ts", "Supplier Partner companies must use SP Sales");
requireText("server/routes/inventory/inventoryQuickAdjustService.ts", "db.transaction");

requireOrder("server/routes/customerRoutes.ts", "registerCustomerMasterRoutes(app)", "registerCustomerLegacyRoutes(app)");
requireOrder("server/routes/customerRoutes.ts", "registerContainerSalesRoutes(app)", "registerCustomerLegacyRoutes(app)");
requireOrder("server/routes/customerRoutes.ts", "registerCompanyTransferRoutes(app)", "registerCustomerLegacyRoutes(app)");
requireText("server/routes/customers/customerBalanceQuery.ts", "historicalBaseBalance");
requireText("server/routes/customers/customerService.ts", "Accounts Receivable");
requireText("server/routes/containers/containerSalesService.ts", "db.transaction");
requireText("server/routes/containers/containerSalesService.ts", "status: \"SOLD\"");

requireText("server/routes/transfers/transferRepository.ts", "listSimpleTransfers");
requireText("server/routes/transfers/interCompanyTransferService.ts", "IC-TO-");
requireText("server/routes/transfers/interCompanyTransferService.ts", "IC-FROM-");
requireText("server/routes/transfers/simpleCompanyTransferService.ts", "TRANSFER-CLEARING");
requireText("server/routes/transfers/simpleCompanyTransferService.ts", "deleteTransferVoucher");

requireOrder("server/routes/authRoutes.ts", "registerSessionRoutes(app)", "registerLegacyAuthRoutes(app)");
requireText("server/routes/auth/sessionRepository.ts", "FROM session");
requireText("server/routes/auth/sessionService.ts", "ADMIN_SESSION_ROLES");
requireText("server/routes/auth/sessionRoutes.ts", '"/api/login-history"');

requireOrder(
  "server/routes/reportsRoutes.ts",
  "registerReportsNetProfitStatementRoutes(app)",
  "registerLegacyReportsRoutes(app)",
);
requireOrder(
  "server/routes/reportsRoutes.ts",
  "registerReportsClosingStockRoutes(app)",
  "registerLegacyReportsRoutes(app)",
);
requireOrder(
  "server/routes/reportsRoutes.ts",
  "registerDashboardAccountRoutes(app)",
  "registerLegacyReportsRoutes(app)",
);

for (const existingComposer of [
  ["server/routes/voucherRoutes.ts", "registerVoucherQueryRoutes"],
  ["server/routes/containerRoutes.ts", "registerContainerCrudRoutes"],
  ["server/routes/ledgerRoutes.ts", "registerLegacyLedgerRoutes"],
  ["server/routes/posRoutes.ts", "registerAllPosRoutes"],
  ["server/routes/factoryRoutes.ts", "registerFactoryStockRoutes"],
  ["server/routes/rentalRouteFactory.ts", "registerRentalUnitsContractsRoutes"],
]) {
  requireText(existingComposer[0], existingComposer[1]);
}

if (failures.length > 0) {
  console.error("Phase 2 backend module separation verification failed:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("Phase 2 backend module separation contracts verified.");
