import fs from "node:fs";

const requiredFiles = [
  "server/services/pos/postSaleAccounting.ts",
  "server/services/pos/createSaleService.ts",
  "server/services/pos/edit/updateSaleService.ts",
  "server/routes/spMigrationRoutes.ts",
  "server/routes/sp/spMigrationPhase4Routes.ts",
  "docs/program-2-phase-6-supplier-partner.md",
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Program 2 Phase 6 missing required file: ${file}`);
}

const read = (file) => fs.readFileSync(file, "utf8");
const accounting = read("server/services/pos/postSaleAccounting.ts");
const createSale = read("server/services/pos/createSaleService.ts");
const editSale = read("server/services/pos/edit/updateSaleService.ts");
const migration = read("server/routes/spMigrationRoutes.ts");
const phase4 = read("server/routes/sp/spMigrationPhase4Routes.ts");
const doc = read("docs/program-2-phase-6-supplier-partner.md");

const checks = [
  [accounting.includes("fetchSupplierPartnerAccountingContext"), "Supplier Partner accounting context must remain explicit"],
  [accounting.includes("spPosPayableAccountId") && accounting.includes("spPosProfitAccountId"), "payable and profit accounts must remain configured"],
  [accounting.includes("sp_cost_clearing") && accounting.includes("sp_pay_deduction_clearing"), "Supplier Partner clearing accounts must remain explicit"],
  [accounting.includes("supplierPartnerPayableDeductionPerQty"), "per-quantity payable deduction must remain location-controlled"],
  [accounting.includes("totalSupplierCost") && accounting.includes("currentRate"), "supplier cost must remain inventory-rate based"],
  [accounting.includes("normalizeVoucherEntryAmounts"), "Supplier Partner POS entries must preserve dual-currency history"],
  [createSale.includes("fetchSupplierPartnerAccountingContext"), "POS creation must use Supplier Partner context"],
  [createSale.includes("_idempotent"), "POS replay result must remain explicit"],
  [editSale.includes("fetchSupplierPartnerAccountingContext"), "POS editing must rebuild Supplier Partner context"],
  [migration.toLowerCase().includes("supplier partner"), "Supplier Partner migration route must remain present"],
  [phase4.includes("prepare") || phase4.includes("Prepare"), "Phase 4 Prepare operation must remain present"],
  [phase4.includes("finalize") || phase4.includes("Finalize"), "Phase 4 Finalize operation must remain present"],
  [phase4.includes("rollback") || phase4.includes("Rollback"), "Phase 4 Rollback operation must remain present"],
  [doc.includes("Status: complete"), "Phase 6 documentation must remain complete"],
  [doc.includes("No live Supplier Partner formula"), "Phase 6 scope protection must remain documented"],
];

for (const [passed, message] of checks) {
  if (!passed) throw new Error(`Program 2 Phase 6 verification failed: ${message}`);
}

console.log("Program 2 Phase 6 Supplier Partner contract verified.");
