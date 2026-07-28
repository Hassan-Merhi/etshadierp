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

  it("classifies inventory and true factory container root resources", () => {
    expect(classifyCompanyOwnedRoute("/api/stock-items/19/prices")).toEqual({
      resourceType: "stock-item",
      resourceId: 19,
      domain: "inventory",
    });
    expect(classifyCompanyOwnedRoute("/api/containers/81")).toEqual({
      resourceType: "container",
      resourceId: 81,
      domain: "inventory",
    });
    expect(classifyCompanyOwnedRoute("/api/factory/containers/55")).toEqual({
      resourceType: "factory-container",
      resourceId: 55,
      domain: "factory",
    });
  });

  it("leaves container sub-resource routes to their dedicated route guards", () => {
    expect(classifyCompanyOwnedRoute("/api/containers/81/offload")).toBeNull();
    expect(classifyCompanyOwnedRoute("/api/factory/containers/55/reverse-offload")).toBeNull();
  });

  it("preserves historical ERP container aliases below the factory path", () => {
    expect(classifyCompanyOwnedRoute("/api/factory/containers/55/documents")).toBeNull();
    expect(classifyCompanyOwnedRoute("/api/factory/containers/55/freight")).toBeNull();
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
