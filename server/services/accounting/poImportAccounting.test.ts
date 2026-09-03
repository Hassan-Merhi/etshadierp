import { describe, expect, it } from "vitest";
import { resolvePoImportCreditTarget } from "./poImportAccounting";

describe("PO import credit target", () => {
  it("uses the explicitly configured intercompany account for an ERP company without a parent link", () => {
    expect(
      resolvePoImportCreditTarget({
        companyType: "erp",
        configuredIntercompanyCreditAccountId: 383,
        supplierId: 71,
      })
    ).toEqual({ kind: "intercompany", ledgerAccountId: 383 });
  });

  it("keeps supplier credits for standalone ERP companies with no configured account", () => {
    expect(
      resolvePoImportCreditTarget({
        companyType: "erp",
        configuredIntercompanyCreditAccountId: null,
        supplierId: 71,
      })
    ).toEqual({ kind: "supplier", supplierId: 71 });
  });

  it("keeps supplier-partner credits on the supplier-partner path", () => {
    expect(
      resolvePoImportCreditTarget({
        companyType: "supplier_partner",
        configuredIntercompanyCreditAccountId: 383,
        supplierId: 71,
      })
    ).toEqual({ kind: "supplier", supplierId: 71 });
  });
});