import { describe, expect, it } from "vitest";
import { chooseAuthorizedFactoryCompany } from "../server/services/security/factoryCompanyScopePolicy";

describe("factory company scope policy", () => {
  it("keeps a pinned factory only when it is assigned to the user", () => {
    expect(
      chooseAuthorizedFactoryCompany({
        pinnedFactoryId: 8,
        currentCompany: null,
        assignedFactoryIds: [8, 9],
      })
    ).toBe(8);

    expect(
      chooseAuthorizedFactoryCompany({
        pinnedFactoryId: 99,
        currentCompany: null,
        assignedFactoryIds: [8, 9],
      })
    ).toBe(8);
  });

  it("uses the current company only when it is an active assigned factory", () => {
    expect(
      chooseAuthorizedFactoryCompany({
        currentCompany: { id: 4, companyType: "factory_v2", active: true },
        assignedFactoryIds: [4, 8],
      })
    ).toBe(4);

    expect(
      chooseAuthorizedFactoryCompany({
        currentCompany: { id: 3, companyType: "erp", active: true },
        assignedFactoryIds: [8],
      })
    ).toBe(8);
  });

  it("never falls back to an unassigned global factory", () => {
    expect(
      chooseAuthorizedFactoryCompany({
        pinnedFactoryId: 99,
        currentCompany: { id: 3, companyType: "erp", active: true },
        assignedFactoryIds: [],
      })
    ).toBeNull();
  });
});
