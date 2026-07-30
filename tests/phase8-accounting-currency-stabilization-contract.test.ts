import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Phase 8 accounting and multi-currency stabilization", () => {
  it("uses authoritative readiness rather than an unstarted-backfill compatibility state", () => {
    const readiness = source("server/services/accounting/historicalCurrencyReadiness.ts");
    expect(readiness).toContain("schemaReady");
    expect(readiness).toContain("totalUnresolvedCount");
    expect(readiness).toContain("ready: totalUnresolvedCount === 0");
    expect(readiness).toContain("transaction_currency IS NULL");
    expect(readiness).toContain("historical_exchange_rate IS NULL");
    expect(readiness).not.toContain("has_migrated");
    expect(readiness).not.toContain("backfillWasRun");
  });

  it("classifies automatic repairs from persisted evidence only", () => {
    const recommendations = source("server/services/accounting/historicalCurrencyRepairRecommendations.ts");
    expect(recommendations).toContain('"auto-from-transaction"');
    expect(recommendations).toContain('"auto-from-base"');
    expect(recommendations).toContain('"manual-storage-mode"');
    expect(recommendations).toContain('"manual-partial-metadata"');
    expect(recommendations).not.toContain("storedMain");
    expect(recommendations).not.toContain("lte(999)");
    expect(recommendations).not.toContain("gte(50000)");
  });

  it("repairs complete vouchers atomically and keeps compatibility amounts in historical base", () => {
    const service = source("server/services/accounting/historicalCurrencyRepairCenter.ts");
    expect(service).toContain("assertCompleteVoucherCoverage");
    expect(service).toContain("must be repaired as one complete batch");
    expect(service).toContain("assertTouchedVouchersBalanced");
    expect(service).toContain("would be unbalanced");
    expect(service).toContain("debit_amount = $8, credit_amount = $9");
    expect(service).toContain("v.company_id = $11");
    expect(service).toContain("current.versionTag !== item.before.versionTag");
    expect(service).toContain("pg_advisory_xact_lock");
    expect(service).toContain("INSERT INTO audit_log");
    expect(service).toContain('client.query("ROLLBACK")');
  });

  it("offers automatic plans only for complete evidence-backed voucher groups", () => {
    const routes = source("server/routes/historicalCurrencyRepairCenterRoutes.ts");
    expect(routes).toContain("completeAutomaticRepairs");
    expect(routes).toContain("inputs.every");
    expect(routes).toContain('"/api/accounts/multi-currency/repair-center/auto-plan"');
    expect(routes).toContain('"/api/accounts/multi-currency/repair-center/reconciliation"');
    expect(routes).toContain("signRepairToken");
    expect(routes).toContain("verifyRepairToken");
  });

  it("reconciles trial balance, voucher integrity, and current cash/bank translation", () => {
    const reconciliation = source("server/services/accounting/historicalCurrencyReconciliation.ts");
    expect(reconciliation).toContain("readyForHistoricalReports");
    expect(reconciliation).toContain("readyForLiveNetPosition");
    expect(reconciliation).toContain("unbalancedVoucherCount");
    expect(reconciliation).toContain("partialMetadataEntryCount");
    expect(reconciliation).toContain("deletedVoucherEntriesExcludedFromLiveTotals: true");
  });

  it("exposes the stabilization workflow directly on Accounts", () => {
    const accounts = source("client/src/pages/Accounts.tsx");
    const panel = source("client/src/pages/accounts/HistoricalCurrencyStabilizationPanel.tsx");
    const openings = source("client/src/pages/accounts/HistoricalOpeningResolver.tsx");
    expect(accounts).toContain("<HistoricalCurrencyStabilizationPanel />");
    expect(accounts).toContain("<HistoricalOpeningResolver />");
    expect(accounts).toContain("<CashBankRevaluationPanel />");
    expect(panel).toContain("Preview complete voucher repair");
    expect(panel).toContain("Apply signed plan");
    expect(panel).toContain("rows.some((repairCase) => !repairCase.autoRepairable)");
    expect(openings).toContain("Reviewed native amount");
    expect(openings).toContain("draft.nativeAmount");
  });

  it("retires heuristic command-line repair and directs operators to Accounts", () => {
    const cli = source("scripts/backfill-voucher-entry-currency-amounts.mjs");
    const guard = source("server/routes/historicalCurrencyGuardRoutes.ts");
    expect(cli).toContain("Historical currency backfill CLI retired");
    expect(cli).toContain("Refusing --apply");
    expect(cli).not.toContain("new pg.Pool");
    expect(cli).not.toContain("storedMain");
    expect(guard).toContain("Accounts → Historical Currency Stabilization");
    expect(guard).not.toContain("backfillWasRun");
  });
});
