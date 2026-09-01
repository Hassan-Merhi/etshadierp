import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "server/routes/import/po-import.ts"), "utf8");

const spStart = source.indexOf("        if (isSpCompany) {");
const normalSubsidiaryStart = source.indexOf("        } else if (isSubsidiary) {");
const spBranch = source.slice(spStart, normalSubsidiaryStart);

describe("PO import linked Supplier Partner parent accounting", () => {
  it("keeps Supplier Partner OTW accounting and also posts the explicit parent-company journal", () => {
    expect(spStart).toBeGreaterThan(-1);
    expect(normalSubsidiaryStart).toBeGreaterThan(spStart);
    expect(spBranch).toContain('eq(ledgerAccounts.subType, "sp_goods_otw")');
    expect(spBranch).toContain('eq(ledgerAccounts.subType, "sp_otw_clearing")');
    expect(spBranch).toContain("if (isSubsidiary && parentCompanyId)");
    expect(spBranch).toContain('"parent-intercompany"');
    expect(spBranch).toContain("companyId: parentCompanyId");
  });

  it("credits the supplier in the parent for goods and preserves parent-paid freight splitting", () => {
    expect(spBranch).toContain("supplierId: supplierId");
    expect(spBranch).toContain("creditAmount: poIntercoTotal.toFixed(2)");
    expect(spBranch).toContain("ledgerAccountId: resolvedFreightParentAccountId");
    expect(spBranch).toContain("creditAmount: poFreight.toFixed(2)");
    expect(spBranch).toContain("debitAmount: intercoParentTotal.toFixed(2)");
  });

  it("does not run the normal subsidiary local Purchases/Parent Credit posting inside the SP branch", () => {
    expect(spBranch).not.toContain("parentCreditAccountId");
    expect(spBranch).not.toContain('getLedgerAccountByName("Purchases"');
  });
});
