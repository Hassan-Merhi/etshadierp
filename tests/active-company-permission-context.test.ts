import { describe, expect, it } from "vitest";
import {
  chooseActiveCompanyRole,
  resolvePermissionCompanyId,
} from "../server/services/security/activeCompanyPermissionPolicy";

describe("active company permission context", () => {
  it("uses the role assigned to the active company", () => {
    expect(
      chooseActiveCompanyRole(20, [
        { companyId: 10, role: "Admin" },
        { companyId: 20, role: "POS" },
      ])
    ).toEqual({ role: "POS", developerBypass: false });
  });

  it("does not reuse an Admin role from another company", () => {
    expect(
      chooseActiveCompanyRole(20, [{ companyId: 10, role: "Admin" }])
    ).toBeNull();
  });

  it("preserves the explicit Developer all-company bypass", () => {
    expect(
      chooseActiveCompanyRole(99, [{ companyId: 10, role: "Developer" }])
    ).toEqual({ role: "Developer", developerBypass: true });
  });

  it("prefers the active company's concrete role over a Developer role elsewhere", () => {
    expect(
      chooseActiveCompanyRole(20, [
        { companyId: 10, role: "Developer" },
        { companyId: 20, role: "Manager" },
      ])
    ).toEqual({ role: "Manager", developerBypass: false });
  });

  it("uses the pinned company only for Factory and Properties routes", () => {
    expect(
      resolvePermissionCompanyId({
        path: "/api/factory/bales",
        currentCompanyId: 10,
        factoryCompanyId: 20,
      })
    ).toBe(20);
    expect(
      resolvePermissionCompanyId({
        path: "/api/properties/rental/payments",
        currentCompanyId: 10,
        factoryCompanyId: 20,
      })
    ).toBe(20);
  });

  it("keeps ERP and POS permissions on currentCompanyId across tabs", () => {
    expect(
      resolvePermissionCompanyId({
        path: "/api/pos/sales",
        currentCompanyId: 10,
        factoryCompanyId: 20,
      })
    ).toBe(10);
    expect(
      resolvePermissionCompanyId({
        path: "/api/reports/stock/export/excel",
        currentCompanyId: 10,
        factoryCompanyId: 20,
      })
    ).toBe(10);
  });
});
