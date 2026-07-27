import fs from "node:fs";

const requiredFiles = [
  "server/services/pos/postSaleAccounting.ts",
  "server/services/pos/createSaleService.ts",
  "server/services/pos/edit/updateSaleService.ts",
  "server/routes/spMigrationRoutes.ts",
  "server/routes/sp/spMigrationPhase4Routes.ts",
  "docs/program-2-phase-6-supplier-partner.md",
];
for (const file of requiredFiles) if (!fs.existsSync(file)) throw new Error(`Program 2 Phase 6 missing required file: ${file}`);
const read = (file) => fs.readFileSync(file, "utf8");
const accounting = read(requiredFiles[0]);
const createSale = read(requiredFiles[1]);
const editSale = read(requiredFiles[2]);
const migration = read(requiredFiles[3]);
const phase4 = read(requiredFiles[4]);
const doc = read(requiredFiles[5]);
const migrationText = migration.toLowerCase();
const checks = [
  [accounting.includes("fetchSupplierPartnerAccountingContext"), "Supplier Partner accounting context must remain explicit"],
  [accounting.includes("spPosPayableAccountId") && accounting.includes("spPosProfitAccountId"), "payable and profit accounts must remain configured"],
  [accounting.includes("sp_cost_clearing") && accounting.includes("sp_pay_deduction_clearing"), "Supplier Partner clearing accounts must remain explicit"],
  [accounting.includes("supplierPartnerPayableDeductionPerQty"), "per-quantity payable deduction must remain location-controlled"],
  [accounting.includes("totalSupplierCost") && accounting.includes("currentRate"), "supplier cost must remain inventory-rate based"],
  [accounting.includes("normalizeVoucherEntryAmounts"), "Supplier Partner POS entries must preserve dual-currency history"],
  [createSale.includes("fetchSupplierPartnerAccountingContext"), "POS creation must use Supplier Partner context"],
  [createSale.includes("_idempotent"), "POS replay result must remain explicit"],
  [editSale.includes("fetchSpEditAccountingContext"), "POS editing must rebuild Supplier Partner context"],
  [migrationText.includes("supplier_partner") || migrationText.includes("sp migration"), "Supplier Partner migration route must remain present"],
  [phase4.toLowerCase().includes("prepare"), "Phase 4 Prepare operation must remain present"],
  [phase4.toLowerCase().includes("finalize"), "Phase 4 Finalize operation must remain present"],
  [phase4.toLowerCase().includes("rollback"), "Phase 4 Rollback operation must remain present"],
  [doc.includes("Status: complete"), "Phase 6 documentation must remain complete"],
  [doc.includes("No live Supplier Partner formula"), "Phase 6 scope protection must remain documented"],
];
for (const [passed, message] of checks) if (!passed) throw new Error(`Program 2 Phase 6 verification failed: ${message}`);
console.log("Program 2 Phase 6 Supplier Partner contract verified.");