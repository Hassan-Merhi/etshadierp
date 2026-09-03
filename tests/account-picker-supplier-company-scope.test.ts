import { describe, expect, it } from "vitest";

import { isSupplierVisibleToCompany } from "../server/routes/helpers/supplierBalanceHelpers";

/**
 * The account pickers (/api/accounts/all and /api/accounts/voucher-sidebar)
 * load suppliers through storage.getAllSuppliers(), which is not company-scoped.
 * They used to rely on the child-company "no activity in this company" filter to
 * keep other tenants' suppliers out of the response, but that filter is skipped
 * whenever the viewing company resolves to itself — a standalone company, or the
 * root company. A supplier owned by another tenant would then be listed by name
 * and code, and the voucher sidebar would additionally apply its opening balance.
 *
 * The company scope therefore has to be enforced independently of that filter.
 */
describe("account picker supplier company scope", () => {
  it("hides a supplier owned by another company", () => {
    expect(isSupplierVisibleToCompany({ companyId: 42 }, 7)).toBe(false);
  });

  it("shows the viewing company's own supplier", () => {
    expect(isSupplierVisibleToCompany({ companyId: 7 }, 7)).toBe(true);
  });

  it("keeps pre-migration suppliers with no company visible", () => {
    // Rows predating the company-scope migration are not owned by any tenant;
    // ownership of their opening balance is decided by isParentCompanyContext,
    // not here, so hiding them would drop legitimate historical suppliers.
    expect(isSupplierVisibleToCompany({ companyId: null }, 7)).toBe(true);
    expect(isSupplierVisibleToCompany({}, 7)).toBe(true);
  });

  it("does not filter when there is no active company context", () => {
    expect(isSupplierVisibleToCompany({ companyId: 42 }, null)).toBe(true);
    expect(isSupplierVisibleToCompany({ companyId: 42 }, undefined)).toBe(true);
  });
});
