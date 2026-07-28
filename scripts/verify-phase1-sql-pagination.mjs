#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const voucherRegistry = read("server/routes/voucherRoutes.ts");
const voucherPagination = read("server/routes/vouchers/voucherPaginationRoutes.ts");
const supplierPoPagination = read("server/routes/vouchers/supplierPurchaseOrderPaginationRoutes.ts");
const ledgerRegistry = read("server/routes/ledgerRoutes.ts");
const ledgerPagination = read("server/routes/ledgerAccountPaginationRoutes.ts");
const statementPagination = read("server/routes/accountTransactionPaginationRoutes.ts");
const statementClient = read("client/src/lib/accountStatementPaginationClient.ts");
const erpDaybookServer = read("server/routes/daybookPaginationRoutes.ts");
const erpDaybookClient = read("client/src/lib/erpDaybookPaginationClient.ts");
const factoryDaybookClient = read("client/src/lib/daybookPaginationClient.ts");
const factoryDaybookServer = read("server/routes/factory/factoryDaybookPaginationRoutes.ts");
const containerRegistry = read("server/routes/containerRoutes.ts");
const containerPagination = read("server/routes/containers/containerListPaginationRoutes.ts");
const containerClient = read("client/src/lib/containerPaginationClient.ts");
const supplierPoClient = read("client/src/lib/supplierPurchaseOrderPaginationClient.ts");
const phase1Plugin = read("build/vitePhase1PaginationPlugin.ts");
const viteConfig = read("vite.config.ts");
const mainClient = read("client/src/main.tsx");
const baleServer = read("server/routes/factory/factoryBalesRoutes.ts");
const inventoryServer = read("server/routes/location/commonInventoryPerformanceRoutes.ts");
const stockAllocationServer = read("server/routes/factory/factoryStockAllocationV5PaginationRoutes.ts");
const containerStorage = read("server/storage/containers.ts");

assert(
  voucherRegistry.indexOf("registerDaybookPaginationRoutes(app)") <
    voucherRegistry.indexOf("registerVoucherQueryRoutes(app)"),
  "ERP Daybook pagination must register before legacy voucher readers."
);
assert(
  voucherRegistry.indexOf("registerSupplierPurchaseOrderPaginationRoutes(app)") <
    voucherRegistry.indexOf("registerVoucherQueryRoutes(app)"),
  "Supplier PO pagination must register before the legacy cross-company route."
);
assert(
  voucherRegistry.indexOf("registerVoucherPaginationRoutes(app)") <
    voucherRegistry.indexOf("registerVoucherQueryRoutes(app)"),
  "Native voucher pagination must register before the legacy voucher reader."
);
assert(
  voucherPagination.includes("if (!wantsStructuredPagination(req)) return next()"),
  "Legacy voucher array callers must not be silently truncated."
);
assert(voucherPagination.includes("count(*)::int"), "Voucher pagination must calculate the SQL count.");
assert(voucherPagination.includes(".limit(limit)"), "Voucher rows must be limited in SQL.");
assert(voucherPagination.includes(".offset(offset)"), "Voucher rows must be offset in SQL.");
assert(voucherPagination.includes("userLocations.locationId"), "POS voucher location scope is missing.");

assert(
  ledgerRegistry.indexOf("registerAccountTransactionPaginationRoutes(app)") <
    ledgerRegistry.indexOf("registerLegacyLedgerRoutes(app)"),
  "Account statements must page before legacy account routes register."
);
assert(
  ledgerRegistry.indexOf("registerLedgerAccountPaginationRoutes(app)") <
    ledgerRegistry.indexOf("registerLegacyLedgerRoutes(app)"),
  "Ledger pagination must register before the legacy ledger reader."
);
assert(
  ledgerPagination.includes("if (!wantsStructuredPagination(req)) return next()"),
  "Legacy ledger selectors must not be silently truncated."
);
assert(ledgerPagination.includes("count(*)::int"), "Ledger pagination must calculate the SQL count.");
assert(ledgerPagination.includes(".limit(limit)"), "Ledger rows must be limited in SQL.");
assert(ledgerPagination.includes("ilike(ledgerAccounts.name"), "Ledger search must stay database-side.");

for (const route of ["ledger", "bank", "fixed-asset", "supplier", "employee", "customer"]) {
  assert(
    statementPagination.includes(`/api/accounts/${route}/:id/transactions`),
    `Missing paged ${route} statement route.`
  );
}
assert(statementPagination.includes("periodDebitTotal"), "Statement period debit total is missing.");
assert(statementPagination.includes("periodCreditTotal"), "Statement period credit total is missing.");
assert(statementPagination.includes("closingNetBalance"), "Statement full-period closing balance is missing.");
assert(statementPagination.includes("precedingPageNet"), "Statement page brought-forward logic is missing.");
assert(statementPagination.includes("companyScopedSuppliers"), "Supplier statement ownership check is missing.");
assert(statementPagination.includes("eq(companyScopedSuppliers.companyId, companyId)"), "Supplier statements must be company-scoped.");
assert(statementPagination.includes("LIMIT $${baseCount + 1} OFFSET $${baseCount + 2}"), "Statement SQL limit/offset is missing.");
assert(statementClient.includes("const ALLOWED_LIMITS = [50, 100, 250]"), "Statement page-size controls are missing.");
assert(statementClient.includes('query.queryKey[0] === "account-statement"'), "Statement page navigation must refetch the active statement.");

assert(erpDaybookServer.includes('app.get("/api/daybook"'), "Unified ERP Daybook endpoint is missing.");
assert(erpDaybookServer.includes("voucher_rows AS"), "ERP Daybook voucher SQL branch is missing.");
assert(erpDaybookServer.includes("offload_rows AS"), "ERP Daybook offload SQL branch is missing.");
assert(erpDaybookServer.includes("type_rank"), "ERP Daybook same-day voucher ordering is missing.");
assert(erpDaybookServer.includes("LOWER(REPLACE(v.voucher_type"), "ERP Daybook POS stock-transfer masking is missing.");
assert(erpDaybookServer.includes("LIMIT ${limitParam} OFFSET ${offsetParam}"), "ERP Daybook SQL paging is missing.");
assert(erpDaybookClient.includes("fetchAllErpDaybookRows"), "ERP Daybook complete export helper is missing.");
assert(phase1Plugin.includes("erp-daybook-page-previous"), "ERP Daybook Previous control is missing.");
assert(phase1Plugin.includes("erp-daybook-page-size"), "ERP Daybook row-size control is missing.");
assert(phase1Plugin.includes("periodDebitTotal"), "Accounts UI does not consume full-period statement totals.");
assert(phase1Plugin.includes("closingNetBalance"), "Accounts UI does not consume full-period closing balance.");
assert(viteConfig.includes("phase1PaginationPlugin()"), "Phase 1 Vite integration is not enabled.");
assert(phase1Plugin.includes('import "./lib/accountStatementPaginationClient"'), "Account statement client bootstrap transform is missing.");

assert(factoryDaybookClient.includes("const DEFAULT_LIMIT = 100;"), "Factory Daybook must default to 100 rows.");
assert(factoryDaybookClient.includes("const MAX_ACTION_LIMIT = 250;"), "Factory Daybook exports must respect the server cap.");
assert(factoryDaybookClient.includes("const ALLOWED_LIMITS = [50, 100, 250];"), "Factory Daybook controls are missing.");
assert(!factoryDaybookClient.includes("9999"), "Factory Daybook must not request pseudo-unbounded pages.");
assert(factoryDaybookServer.includes("LIMIT ${limitParam} OFFSET ${offsetParam}"), "Factory Daybook SQL paging is missing.");

assert(
  containerRegistry.indexOf("registerContainerListPaginationRoutes(app)") <
    containerRegistry.indexOf("registerContainerCrudRoutes(app)"),
  "Container pagination must register before legacy container lists."
);
for (const route of ["/api/containers", "/api/containers/active", "/api/containers/sold"]) {
  assert(containerPagination.includes(route), `Missing native pagination for ${route}.`);
}
assert(containerPagination.includes("count(*)::int"), "Container page counts must be calculated in SQL.");
assert(containerPagination.includes(".limit(limit)"), "Container rows must be limited in SQL.");
assert(containerClient.includes('params.set("limit", String(PAGE_SIZE))'), "Container client must request bounded pages.");
assert(containerClient.includes('import "./supplierPurchaseOrderPaginationClient"'), "Supplier PO paging client is not installed.");
assert(mainClient.includes('import "./lib/containerPaginationClient"'), "Container pagination client is not bootstrapped.");

assert(supplierPoPagination.includes("companyScopedSuppliers"), "Supplier PO ownership validation is missing.");
assert(supplierPoPagination.includes("eq(purchaseOrders.companyId, companyId)"), "Supplier POs must be company-scoped.");
assert(supplierPoPagination.includes(".limit(limit)"), "Supplier PO rows must be SQL-limited.");
assert(supplierPoClient.includes("PAGE_SIZE = 250"), "Supplier PO client must use bounded batches.");
assert(
  containerStorage.includes("getPurchaseOrdersByContainer") &&
    containerStorage.includes("eq(schema.purchaseOrders.containerId, containerId)"),
  "Container-detail purchase orders must remain container-scoped."
);

assert(baleServer.includes(".limit(rowLimit)"), "Factory bales must retain SQL paging.");
assert(inventoryServer.includes(".limit(limit)"), "Inventory must retain SQL paging.");
assert(
  stockAllocationServer.includes("LIMIT ${limitParam} OFFSET ${offsetParam}"),
  "V5 stock allocation must retain SQL paging."
);

if (failures.length > 0) {
  console.error("Phase 1 SQL pagination verification failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Phase 1 SQL pagination invariants verified.");
