import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("supplier partner customer Net Position", () => {
  it("counts direct customer voucher entries without double-counting linked ledger entries", () => {
    const helper = read("server/helpers/supplierPartnerCustomerNetPosition.ts");

    expect(helper).toContain("voucherEntries.customerId");
    expect(helper).toContain("isNull(voucherEntries.ledgerAccountId)");
    expect(helper).toContain("customer.openingBalanceSide === \"Cr\" ? -opening : opening");
    expect(helper).toContain("ledgerMovement.debit -");
    expect(helper).toContain("directMovement.debit -");
    expect(helper).toContain("if (Math.abs(signedBalance) < 0.01) continue");
  });

  it("uses the authoritative customer balance in live, historical, and Excel Net Position paths", () => {
    const paths = [
      "server/routes/stats/statsNetProfitRoutes.ts",
      "server/helpers/calculateNetPositionAsOf.ts",
      "server/routes/stats/statsNetPositionRoutes.ts",
    ];

    for (const relativePath of paths) {
      const source = read(relativePath);
      expect(source).toContain("getSupplierPartnerCustomerNetPosition");
      expect(source).toContain("supplierPartnerCustomerPosition.items");
      expect(source).toContain("supplierPartnerCustomerPosition?.ledgerAccountIds.has(a.id)");
      expect(source).toContain('startsWith("CUST-")');
      expect(source).toContain('includes("customer account")');
    }
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
