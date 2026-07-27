import { describe, expect, it } from "vitest";
import {
  canManageIntercompanyCompany,
  canManageIntercompanyPair,
  ledgersMatchIntercompanyPair,
} from "../server/services/security/intercompanyConfigurationPolicy";

const adminBoth = {
  isDeveloper: false,
  companyRoles: new Map([
    [1, "Admin"],
    [2, "Admin"],
    [3, "Manager"],
  ]),
};

describe("intercompany configuration policy", () => {
  it("requires Admin management of both companies", () => {
    expect(canManageIntercompanyPair(adminBoth, 1, 2)).toBe(true);
    expect(canManageIntercompanyPair(adminBoth, 1, 3)).toBe(false);
    expect(canManageIntercompanyCompany(adminBoth, 3)).toBe(false);
  });

  it("allows Developer global configuration", () => {
    expect(
      canManageIntercompanyPair(
        { isDeveloper: true, companyRoles: new Map() },
        9,
        10
      )
    ).toBe(true);
  });

  it("rejects self-links and invalid company IDs", () => {
    expect(canManageIntercompanyPair(adminBoth, 1, 1)).toBe(false);
    expect(canManageIntercompanyPair(adminBoth, 0, 2)).toBe(false);
  });

  it("requires each ledger to belong to its stated company", () => {
    expect(ledgersMatchIntercompanyPair(1, 2, 1, 2)).toBe(true);
    expect(ledgersMatchIntercompanyPair(2, 1, 1, 2)).toBe(false);
  });
});
