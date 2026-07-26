import { describe, expect, it } from "vitest";
import { classifyCompanyOwnedRoute } from "../server/services/security/companyResourceRoutePolicy";

describe("company-owned resource route policy", () => {
  it("classifies accounting resources with numeric IDs", () => {
    expect(classifyCompanyOwnedRoute("/api/vouchers/42/with-entries")).toEqual({
      resourceType: "voucher",
      resourceId: 42,
      domain: "accounting",
    });
    expect(classifyCompanyOwnedRoute("/api/ledger-accounts/7")).toEqual({
      resourceType: "ledger-account",
      resourceId: 7,
      domain: "accounting",
    });
  });

  it("classifies inventory and container resources", () => {
    expect(classifyCompanyOwnedRoute("/api/stock-items/19/prices")).toEqual({
      resourceType: "stock-item",
      resourceId: 19,
      domain: "inventory",
    });
    expect(classifyCompanyOwnedRoute("/api/containers/81/offload")).toEqual({
      resourceType: "container",
      resourceId: 81,
      domain: "inventory",
    });
    expect(classifyCompanyOwnedRoute("/api/factory/containers/55/reverse-offload")).toEqual({
      resourceType: "factory-container",
      resourceId: 55,
      domain: "factory",
    });
  });

  it("does not mistake literal route names for record IDs", () => {
    expect(classifyCompanyOwnedRoute("/api/vouchers/payment-receipt")).toBeNull();
    expect(classifyCompanyOwnedRoute("/api/containers/refresh-etas")).toBeNull();
    expect(classifyCompanyOwnedRoute("/api/stock-items/bulk-delete")).toBeNull();
  });

  it("rejects zero and malformed resource IDs", () => {
    expect(classifyCompanyOwnedRoute("/api/customers/0")).toBeNull();
    expect(classifyCompanyOwnedRoute("/api/customers/not-a-number")).toBeNull();
  });
});
