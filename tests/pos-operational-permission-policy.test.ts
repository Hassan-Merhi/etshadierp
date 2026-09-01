import { describe, expect, it } from "vitest";
import {
  isPosMutationAllowed,
  isPosSaleCreate,
  parsePosSaleEditVoucherId,
  resolveExplicitPosLocation,
} from "../server/services/security/posOperationalPermissionPolicy";

describe("POS operational permission policy", () => {
  it("normalizes one explicit location", () => {
    expect(resolveExplicitPosLocation({ bodyLocationId: "12" })).toEqual({
      locationId: 12,
      conflict: false,
    });
  });

  it("accepts matching location identifiers and rejects conflicts", () => {
    expect(resolveExplicitPosLocation({ bodyLocationId: 4, queryLocationId: "4" })).toEqual({
      locationId: 4,
      conflict: false,
    });
    expect(resolveExplicitPosLocation({ bodyLocationId: 4, queryLocationId: 5 })).toEqual({
      locationId: 4,
      conflict: true,
    });
  });

  it("blocks mutations for view-only POS accounts but allows reads", () => {
    expect(isPosMutationAllowed({ method: "POST", role: "POS", posViewOnly: true })).toBe(false);
    expect(isPosMutationAllowed({ method: "GET", role: "POS", posViewOnly: true })).toBe(true);
  });

  it("recognizes sale creation and edit paths exactly", () => {
    expect(isPosSaleCreate("POST", "/api/pos/sales")).toBe(true);
    expect(isPosSaleCreate("GET", "/api/pos/sales")).toBe(false);
    expect(parsePosSaleEditVoucherId("PUT", "/api/vouchers/123/sales")).toBe(123);
    expect(parsePosSaleEditVoucherId("PATCH", "/api/vouchers/123/sales")).toBe(123);
  });
});
