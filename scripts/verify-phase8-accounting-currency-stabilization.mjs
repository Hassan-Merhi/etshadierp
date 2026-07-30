import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function requireAll(file, values) {
  const source = read(file);
  for (const value of values) {
    if (!source.includes(value)) failures.push(`${file}: missing ${value}`);
  }
  return source;
}

const readiness = requireAll("server/services/accounting/historicalCurrencyReadiness.ts", [
  "schemaReady",
  "totalUnresolvedCount",
  "transaction_currency IS NULL",
  "historical_exchange_rate IS NULL",
  "opening_balance_native_amount IS NULL",
  "purchase_native_amount IS NULL",
  "ready: totalUnresolvedCount === 0",
]);
for (const forbidden of ["has_migrated", "backfillWasRun", "No dual-currency rows have been migrated yet"]) {
  if (readiness.includes(forbidden)) failures.push(`readiness contains retired permissive state: ${forbidden}`);
}

const recommendations = requireAll("server/services/accounting/historicalCurrencyRepairRecommendations.ts", [
  '"auto-from-transaction"',
  '"auto-from-base"',
  '"manual-storage-mode"',
  '"manual-rate"',
  '"manual-partial-metadata"',
  "original transaction-currency debit and credit",
  "locked historical rate",
]);
for (const forbidden of ["storedMain", "lte(999)", "gte(50000)", "likely CFA", "likely USD"]) {
  if (recommendations.includes(forbidden)) failures.push(`recommendations contain heuristic classification: ${forbidden}`);
}

const service = requireAll("server/services/accounting/historicalCurrencyRepairCenter.ts", [
  "automaticRepairInput",
  "assertCompleteVoucherCoverage",
  "must be repaired as one complete batch",
  "assertTouchedVouchersBalanced",
  "would be unbalanced",
  "debit_amount = $8, credit_amount = $9",
  "v.company_id = $11",
  "pg_advisory_xact_lock",
  "INSERT INTO audit_log",
  'client.query("ROLLBACK")',
]);
if (!service.includes("current.versionTag !== item.before.versionTag")) failures.push("repair apply is missing stale-row protection");

requireAll("server/services/accounting/historicalCurrencyReconciliation.ts", [
  "readyForHistoricalReports",
  "readyForLiveNetPosition",
  "partialMetadataEntryCount",
  "unbalancedVoucherCount",
  "deletedVoucherEntriesExcludedFromLiveTotals: true",
  "globalOrphanVoucherEntryCount",
]);

requireAll("server/routes/historicalCurrencyRepairCenterRoutes.ts", [
  '"/api/accounts/multi-currency/repair-center/auto-plan"',
  '"/api/accounts/multi-currency/repair-center/reconciliation"',
  "completeAutomaticRepairs",
  "signRepairToken",
  "verifyRepairToken",
  "plan.fingerprint !== token.fingerprint",
  "getHistoricalCurrencyReconciliation",
]);

const guard = requireAll("server/routes/historicalCurrencyGuardRoutes.ts", [
  "HISTORICAL_CURRENCY_DATA_UNRESOLVED",
  "Accounts → Historical Currency Stabilization",
  "repairCenterPath",
]);
if (guard.includes("backfillWasRun")) failures.push("guard still exposes the retired backfillWasRun flag");

requireAll("client/src/pages/Accounts.tsx", [
  "HistoricalCurrencyStabilizationPanel",
  "HistoricalOpeningResolver",
  "CashBankRevaluationPanel",
  "<HistoricalCurrencyStabilizationPanel />",
  "<HistoricalOpeningResolver />",
  "<CashBankRevaluationPanel />",
]);

requireAll("client/src/pages/accounts/HistoricalCurrencyStabilizationPanel.tsx", [
  "Preview complete voucher repair",
  "Apply signed plan",
  "storedAmountMode",
  "manualVoucherGroups",
  "rows.some((repairCase) => !repairCase.autoRepairable)",
]);

requireAll("client/src/pages/accounts/HistoricalOpeningResolver.tsx", [
  "Reviewed native amount",
  "draft.nativeAmount",
  "row.historical_rate",
  "row.currency",
]);

const cli = requireAll("scripts/backfill-voucher-entry-currency-amounts.mjs", [
  "Historical currency backfill CLI retired",
  "Refusing --apply",
  "No database connection was opened",
]);
for (const forbidden of ["new pg.Pool", "storedMain", "confirmed-transaction-stored", "timingSafeEqual"]) {
  if (cli.includes(forbidden)) failures.push(`retired CLI still contains heuristic/write path: ${forbidden}`);
}

requireAll("docs/engineering/phase8-accounting-currency-stabilization.md", [
  "Authoritative readiness",
  "Evidence-only classification",
  "Complete-voucher approval",
  "Signed preview and transactional apply",
  "Reconciliation",
  "Retired heuristic CLI",
  "Verification boundary",
  "Merge boundary",
]);

if (failures.length) {
  console.error("Phase 8 accounting and currency stabilization verification failed:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("Phase 8 accounting and currency stabilization contracts verified.");
