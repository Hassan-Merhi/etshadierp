import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("historical accounting and FX repair center", () => {
  it("registers one controlled diagnostic, preview, and apply boundary", () => {
    const routes = source("server/routes/historicalCurrencyRepairCenterRoutes.ts");
    expect(routes).toContain('"/api/accounts/multi-currency/repair-center"');
    expect(routes).toContain('"/api/accounts/multi-currency/repair-center/plan"');
    expect(routes).toContain('"/api/accounts/multi-currency/repair-center/apply"');
    expect(routes).toContain("requireAuth");
    expect(routes).toContain("requireNonPOS");
    expect(routes).toContain('new Set(["Admin", "Owner", "Developer"])');
  });

  it("binds confirmation to user, company, fingerprint, count, purpose, and expiry", () => {
    const routes = source("server/routes/historicalCurrencyRepairCenterRoutes.ts");
    for (const required of [
      'purpose: "historical-currency-repair-center"',
      "companyId",
      "userId: actor.userId",
      "fingerprint: plan.fingerprint",
      "itemCount: plan.itemCount",
      "expiresAt: Date.now() + REPAIR_TOKEN_TTL_MS",
    ]) {
      expect(routes).toContain(required);
    }
    expect(routes).toContain("plan.fingerprint !== token.fingerprint");
    expect(routes).toContain('code: "STALE_REPAIR_PLAN"');
  });

  it("uses one transaction, company advisory lock, stale snapshots, and atomic audits", () => {
    const service = source("server/services/accounting/historicalCurrencyRepairCenter.ts");
    expect(service).toContain('client.query("BEGIN")');
    expect(service).toContain("pg_advisory_xact_lock");
    expect(service).toContain("current.versionTag !== item.before.versionTag");
    expect(service).toContain("await applyPlanItem");
    expect(service).toContain("await insertAudit");
    expect(service).toContain('client.query("COMMIT")');
    expect(service).toContain('client.query("ROLLBACK")');
  });

  it("covers voucher entries and every historical opening-balance entity", () => {
    const service = source("server/services/accounting/historicalCurrencyRepairCenter.ts");
    for (const kind of [
      '"voucherEntry"',
      '"ledger"',
      '"bank"',
      '"customer"',
      '"supplier"',
      '"employee"',
      '"fixedAsset"',
    ]) {
      expect(service).toContain(kind);
    }
    expect(service).toContain("normalizeVoucherEntryAmounts");
    expect(service).toContain("normalizeOpeningBalanceCurrency");
  });

  it("does not guess rates or apply unapproved bulk defaults", () => {
    const service = source("server/services/accounting/historicalCurrencyRepairCenter.ts");
    expect(service).toContain("historicalRate: input.historicalRate");
    expect(service).toContain("At least one approved repair is required");
    expect(service).toContain("Duplicate repair row");
    expect(service).not.toContain("exchange_rates ORDER BY");
    expect(service).not.toContain("COALESCE(historical_exchange_rate, 1)");
  });
});
