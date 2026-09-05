import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("supplier partner customer Net Position", () => {
  it("excludes all customer-like ledger accounts from Supplier Partner Net Position", () => {
    const helper = read("server/helpers/supplierPartnerCustomerNetPosition.ts");

    expect(helper).toContain('account.accountType === "Customer"');
    expect(helper).toContain('account.subType === "Accounts Receivable"');
    expect(helper).toContain('startsWith("CUST-")');
    expect(helper).toContain('includes("customer account")');
    expect(helper).toContain("items: []");
    expect(helper).toContain("ledgerAccountIds: new Set(customerLedgerIds)");
  });

  it("applies the customer exclusion only through Supplier Partner Net Position paths", () => {
    const paths = [
      "server/routes/stats/statsNetProfitRoutes.ts",
      "server/helpers/calculateNetPositionAsOf.ts",
      "server/routes/stats/statsNetPositionRoutes.ts",
    ];

    for (const relativePath of paths) {
      const source = read(relativePath);
      expect(source).toContain("getSupplierPartnerCustomerNetPosition");
      expect(source).toContain("supplierPartnerCustomerPosition?.ledgerAccountIds.has(a.id)");
      expect(source).toContain("supplierPartnerCustomerPosition.items");
      expect(source).toContain("isSupplierPartner");
    }
  });

  it("does not re-add customer balances in the live Golden Coast residual-equity projection", () => {
    const source = read("server/routes/stats/goldenCoastResidualEquityProjection.ts");
    expect(source).toContain('const ASSET_TYPES = new Set(["Asset", "Current Asset", "Fixed Asset", "Bank", "Cash"]);');
    expect(source).toContain("function isCustomerNetPositionAccount");
    expect(source).toContain("if (isCustomerNetPositionAccount(account)) continue;");
    expect(source).toContain("Customer balances are excluded from this Supplier Partner Net Position view");
  });

  it("does not render zero-value cash or bank rows after current translation", () => {
    const source = read("server/routes/stats/statsMultiCurrencyRoutes.ts");
    expect(source).toContain(".filter((row) => Math.abs(Number(row.value || 0)) >= 0.005)");
  });

  it("keeps the new SP cash-account labels covered by the shared translation registry and audit", () => {
    const translations = read("client/src/i18n/phase3RemainingTranslations.part25.ts");
    const registry = read("client/src/i18n/sharedUiPhase3Translations.ts");
    const audit = read("scripts/audit-i18n-phase14.mjs");
    expect(translations).toContain('en: "Opening Cash Account"');
    expect(translations).toContain('en: "GC Sales Cash"');
    expect(registry).toContain("phase3RemainingTranslationsPart25");
    expect(audit).toContain("phase3RemainingTranslations.part25.ts");
  });
});
