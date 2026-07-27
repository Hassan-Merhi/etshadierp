import fs from "node:fs";

const requiredFiles = [
  "server/services/accounting/centralPostingEngine.ts",
  "server/services/accounting/databasePostingDependencies.ts",
  "server/services/accounting/manualJournalPosting.ts",
  "server/services/accounting/genericVoucherPosting.ts",
  "server/services/accounting/employeeBalancePosting.ts",
  "server/services/accounting/voucherLifecycleService.ts",
  "server/routes/vouchers/centralJournalCreateRoute.ts",
  "server/routes/vouchers/centralJournalLifecycleRoute.ts",
  "server/routes/vouchers/centralGenericVoucherCreateRoute.ts",
  "server/routes/voucherRoutes.ts",
  "tests/manual-journal-posting.test.ts",
  "tests/generic-voucher-posting.test.ts",
  "tests/employee-balance-posting.test.ts",
  "docs/program-2-accounting-convergence.md",
  "docs/program-2-phase-2-manual-journals-vouchers.md",
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Program 2 Phase 2 missing required file: ${file}`);
}

const read = (file) => fs.readFileSync(file, "utf8");
const engine = read("server/services/accounting/centralPostingEngine.ts");
const deps = read("server/services/accounting/databasePostingDependencies.ts");
const manual = read("server/services/accounting/manualJournalPosting.ts");
const generic = read("server/services/accounting/genericVoucherPosting.ts");
const employee = read("server/services/accounting/employeeBalancePosting.ts");
const lifecycleService = read("server/services/accounting/voucherLifecycleService.ts");
const journalCreate = read("server/routes/vouchers/centralJournalCreateRoute.ts");
const journalLifecycle = read("server/routes/vouchers/centralJournalLifecycleRoute.ts");
const genericCreate = read("server/routes/vouchers/centralGenericVoucherCreateRoute.ts");
const routeRegistry = read("server/routes/voucherRoutes.ts");
const phaseDoc = read("docs/program-2-phase-2-manual-journals-vouchers.md");

const checks = [
  [engine.includes("postBalancedVoucherTx"), "central posting entrypoint must remain available"],
  [engine.includes("replayed"), "central posting result must preserve replay status"],
  [deps.includes("createDatabasePostingDependencies"), "database ownership and idempotency adapter must remain available"],
  [manual.includes("buildManualJournalPostingRequest"), "manual journal builder must remain available"],
  [manual.includes("effectiveDate"), "manual journals must preserve effective date"],
  [generic.includes("supportsCentralGenericVoucher"), "generic voucher compatibility boundary must remain explicit"],
  [generic.includes("clientRequestId"), "generic voucher subset must require stable request identity"],
  [employee.includes("applyEmployeeBalanceDeltasTx"), "employee effects must remain transaction-owned"],
  [employee.includes("reverse"), "employee effects must support exact reversal"],
  [lifecycleService.includes("replaceVoucherTx") && lifecycleService.includes("reverseVoucherTx"), "voucher lifecycle service must preserve replace and reverse boundaries"],
  [journalCreate.includes('"/api/vouchers/journal"'), "protected manual journal route must remain mounted"],
  [journalCreate.includes("postBalancedVoucherTx"), "manual journal route must use central posting"],
  [journalCreate.includes("db.transaction"), "manual journal posting must remain transaction-owned"],
  [journalCreate.includes("if (!posted.replayed)"), "manual journal employee effects must be replay-safe"],
  [journalCreate.includes("if (!result.replayed)"), "manual journal compatibility effects must be replay-safe"],
  [journalCreate.includes("req.body?.optional === true") && journalCreate.includes("next()"), "optional journal drafts must remain on the compatibility path"],
  [genericCreate.includes('"/api/vouchers/with-entries"'), "protected generic voucher route must remain mounted"],
  [genericCreate.includes("supportsCentralGenericVoucher(req.body)"), "generic route must fail open to the legacy route outside its supported subset"],
  [genericCreate.includes("postBalancedVoucherTx"), "generic voucher subset must use central posting"],
  [genericCreate.includes("db.transaction"), "generic voucher posting must remain transaction-owned"],
  [genericCreate.includes("if (!posted.replayed)"), "generic employee and compatibility effects must remain replay-safe"],
  [genericCreate.includes("POSTING_LINKED_LEDGER_MISMATCH"), "customer linked-ledger mismatches must remain rejected"],
  [journalLifecycle.includes("isReadonlyMigratedVoucher"), "migrated vouchers must remain read-only"],
  [journalLifecycle.includes('existing.voucherType !== "Journal"'), "non-Journal lifecycle paths must remain isolated"],
  [journalLifecycle.includes("existing.optional") && journalLifecycle.includes("req.body?.optional === true"), "optional Journal transitions must remain on the legacy path"],
  [routeRegistry.indexOf("registerCentralJournalCreateRoute") < routeRegistry.indexOf("registerVoucherRoutes"), "central journal route must register before legacy voucher routes"],
  [routeRegistry.indexOf("registerCentralGenericVoucherCreateRoute") < routeRegistry.indexOf("registerVoucherRoutes"), "central generic route must register before legacy voucher routes"],
  [phaseDoc.includes("Status: complete"), "Phase 2 documentation must remain marked complete"],
  [phaseDoc.includes("No database schema or historical record changed"), "Phase 2 safety boundary must remain documented"],
];

for (const [passed, message] of checks) {
  if (!passed) throw new Error(`Program 2 Phase 2 verification failed: ${message}`);
}

console.log("Program 2 Phase 2 manual journal and generic voucher contract verified.");