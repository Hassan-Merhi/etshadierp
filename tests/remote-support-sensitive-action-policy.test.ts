import { describe, expect, it } from "vitest";
import {
  isRemoteKeyboardAllowedOnRoute,
  isRemoteMouseCommandAllowedOnRoute,
  isRemoteSupportHighRiskRoute,
} from "../server/services/remoteSupportSensitiveActionPolicy";

describe("remote support sensitive action policy", () => {
  it("classifies administrative and high-consequence ERP routes as high risk", () => {
    for (const route of [
      "/settings",
      "/settings/users",
      "/admin/account-migration",
      "/roles/permission-management",
      "/security/password",
      "/accounting/period-close",
      "/factory/payroll/approve",
      "/factory/containers/offload",
      "/factory/reverse-offload",
    ]) {
      expect(isRemoteSupportHighRiskRoute(route), route).toBe(true);
    }
  });

  it("allows ordinary read-only and operational routes through the route layer", () => {
    for (const route of ["/dashboard", "/reports/sales", "/stock-query", "/daybook", "/factory/bales"]) {
      expect(isRemoteSupportHighRiskRoute(route), route).toBe(false);
      expect(isRemoteKeyboardAllowedOnRoute(route), route).toBe(true);
      expect(isRemoteMouseCommandAllowedOnRoute(route, "click"), route).toBe(true);
    }
  });

  it("blocks keyboard and clicks on high-risk routes while preserving pointer and scroll", () => {
    const route = "/admin/account-migration";
    expect(isRemoteKeyboardAllowedOnRoute(route)).toBe(false);
    expect(isRemoteMouseCommandAllowedOnRoute(route, "click")).toBe(false);
    expect(isRemoteMouseCommandAllowedOnRoute(route, "pointer-move")).toBe(true);
    expect(isRemoteMouseCommandAllowedOnRoute(route, "scroll")).toBe(true);
  });

  it("fails closed for malformed or missing routes", () => {
    expect(isRemoteSupportHighRiskRoute(null)).toBe(true);
    expect(isRemoteSupportHighRiskRoute("settings")).toBe(true);
    expect(isRemoteKeyboardAllowedOnRoute(undefined)).toBe(false);
    expect(isRemoteMouseCommandAllowedOnRoute(undefined, "click")).toBe(false);
  });
});
