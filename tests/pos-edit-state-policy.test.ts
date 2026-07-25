import { describe, expect, it } from "vitest";
import {
  applyPosRoleRestrictions,
  resolveEditLocations,
} from "../server/services/pos/edit/validateEditSaleRequest";

describe("POS edit locked-state policy", () => {
  it("keeps the latest locked location when no replacement location is submitted", () => {
    expect(resolveEditLocations(200, undefined)).toEqual({
      oldLocationId: 200,
      targetLocationId: 200,
      locationChanged: false,
    });
  });

  it("marks an explicit replacement location as a change from the locked state", () => {
    expect(resolveEditLocations(200, "201")).toEqual({
      oldLocationId: 200,
      targetLocationId: 201,
      locationChanged: true,
    });
  });

  it("prevents a POS user from changing the location resolved from the locked voucher", () => {
    expect(applyPosRoleRestrictions("POS", "201", 200)).toEqual({
      error: {
        status: 403,
        body: { message: "POS users cannot change the location of an existing sale" },
      },
    });
    expect(applyPosRoleRestrictions("POS", "200", 200)).toEqual({ ok: true });
  });
});
