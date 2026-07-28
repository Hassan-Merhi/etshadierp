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
const ledgerRegistry = read("server/routes/ledgerRoutes.ts");
const ledgerPagination = read("server/routes/ledgerAccountPaginationRoutes.ts");
const daybookClient = read("client/src/lib/daybookPaginationClient.ts");
const daybookServer = read("server/routes/factory/factoryDaybookPaginationRoutes.ts");
const baleServer = read("server/routes/factory/factoryBalesRoutes.ts");
const inventoryServer = read("server/routes/location/commonInventoryPerformanceRoutes.ts");
const stockAllocationServer = read("server/routes/factory/factoryStockAllocationV5PaginationRoutes.ts");

assert(
  voucherRegistry.indexOf("registerVoucherPaginationRoutes(app)") < voucherRegistry.indexOf("registerVoucherQueryRoutes(app)"),
  "Native voucher pagination must register before the legacy voucher reader."
);
assert(voucherPagination.includes("count(*)::int"), "Voucher pagination must calculate the filtered SQL count.");
assert(voucherPagination.includes(".limit(limit)"), "Voucher rows must be limited in SQL.");
assert(voucherPagination.includes(".offset(offset)"), "Voucher rows must be offset in SQL.");
assert(voucherPagination.includes("eq(vouchers.companyId, companyId)"), "Voucher pagination must retain company scope.");
assert(voucherPagination.includes("userLocations.locationId"), "POS voucher pagination must retain location scope.");
assert(voucherPagination.includes("X-Default-Limit-Applied"), "Legacy voucher callers must expose the default SQL cap.");

assert(
  ledgerRegistry.indexOf("registerLedgerAccountPaginationRoutes(app)") < ledgerRegistry.indexOf("registerLegacyLedgerRoutes(app)"),
  "Native ledger pagination must register before the legacy ledger reader."
);
assert(ledgerPagination.includes("count(*)::int"), "Ledger pagination must calculate the filtered SQL count.");
assert(ledgerPagination.includes(".limit(limit)"), "Ledger rows must be limited in SQL.");
assert(ledgerPagination.includes(".offset(offset)"), "Ledger rows must be offset in SQL.");
assert(ledgerPagination.includes("eq(ledgerAccounts.companyId, companyId)"), "Ledger pagination must retain company scope.");
assert(ledgerPagination.includes("ilike(ledgerAccounts.name"), "Ledger search must remain database-side.");

assert(daybookClient.includes("const DEFAULT_LIMIT = 100;"), "Factory Daybook must default to a bounded 100-row page.");
assert(daybookClient.includes("const MAX_ACTION_LIMIT = 250;"), "Factory Daybook export paging must respect the server cap.");
assert(daybookClient.includes("const ALLOWED_LIMITS = [50, 100, 250];"), "Factory Daybook row-size controls are missing.");
assert(!daybookClient.includes("PAGINATION_UI_ENABLED = false"), "Factory Daybook pagination controls must not be hidden.");
assert(!daybookClient.includes("9999"), "Factory Daybook must not request pseudo-unbounded pages.");
assert(daybookServer.includes("LIMIT ${limitParam} OFFSET ${offsetParam}"), "Factory Daybook must retain SQL paging.");

assert(baleServer.includes(".limit(rowLimit)"), "Factory bales must retain SQL paging.");
assert(inventoryServer.includes(".limit(limit)"), "Inventory must retain SQL paging.");
assert(stockAllocationServer.includes("LIMIT ${limitParam} OFFSET ${offsetParam}"), "V5 stock allocation must retain SQL paging.");

if (failures.length > 0) {
  console.error("Phase 1 SQL pagination verification failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Phase 1 SQL pagination invariants verified.");
