import fs from "node:fs";

const requiredFiles = [
  "server/routes/factory/raw-stock/rawStockContainerRoutes.ts",
  "server/routes/factory/raw-stock/rawStockOffloadRoutes.ts",
  "server/routes/factory/suppliers/supplierCrudRoutes.ts",
  "server/routes/factory/suppliers/supplierBrokerRoutes.ts",
  "server/routes/factory/suppliers/supplierBalanceRoutes.ts",
  "server/services/factory/currencyConversion.ts",
  "docs/program-2-accounting-convergence.md",
  "docs/program-2-phase-5-containers-freight.md",
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Program 2 Phase 5 missing required file: ${file}`);
}

const read = (file) => fs.readFileSync(file, "utf8");
const container = read("server/routes/factory/raw-stock/rawStockContainerRoutes.ts");
const offload = read("server/routes/factory/raw-stock/rawStockOffloadRoutes.ts");
const supplierCrud = read("server/routes/factory/suppliers/supplierCrudRoutes.ts");
const broker = read("server/routes/factory/suppliers/supplierBrokerRoutes.ts");
const supplierBalance = read("server/routes/factory/suppliers/supplierBalanceRoutes.ts");
const currency = read("server/services/factory/currencyConversion.ts");
const phaseDoc = read("docs/program-2-phase-5-containers-freight.md");

const combined = [container, offload, supplierCrud, broker, supplierBalance].join("\n");

const checks = [
  [phaseDoc.includes("Status: complete"), "Phase 5 documentation must remain complete"],
  [phaseDoc.includes("own-account freight must not be added"), "own-account freight exclusion must remain documented"],
  [phaseDoc.includes("No database schema or historical record changed"), "historical-data safety boundary must remain documented"],
  [combined.includes("companyId") || combined.includes("company_id"), "container accounting must retain company scope"],
  [combined.includes("freight"), "freight handling must remain present"],
  [combined.includes("commission"), "commission handling must remain present"],
  [combined.includes("voucher") || combined.includes("Voucher"), "container accounting voucher linkage must remain present"],
  [combined.includes("supplier"), "supplier accounting linkage must remain present"],
  [combined.includes("currency") || combined.includes("Currency"), "container currency handling must remain present"],
  [currency.includes("resolveStoredFxRate") || currency.includes("exchangeRate"), "stored FX handling must remain explicit"],
  [broker.includes("freightPaidBy") || broker.includes("isSupplierPaidFreight") || phaseDoc.includes("supplier-paid freight"), "broker statement must distinguish freight responsibility"],
  [offload.includes("transaction") || offload.includes("db.transaction"), "offload writes must retain a transaction boundary"],
  [combined.includes("recalculate") || combined.includes("recalc"), "container recalculation boundary must remain present"],
  [phaseDoc.includes("dry-run capable") && phaseDoc.includes("fail closed"), "controlled repair requirements must remain documented"],
  [phaseDoc.includes("mix-batch consumption"), "stable supplier cost-per-kilogram boundary must remain documented"],
];

for (const [passed, message] of checks) {
  if (!passed) throw new Error(`Program 2 Phase 5 verification failed: ${message}`);
}

console.log("Program 2 Phase 5 container, freight, commission, and post-offload contract verified.");
