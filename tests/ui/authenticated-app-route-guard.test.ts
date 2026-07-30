import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/FactorySidebar", () => ({
  FACTORY_NAV_SECTIONS: [
    {
      label: "Core",
      items: [
        { url: "/factory/production-report" },
        { url: "/factory/daybook" },
        { url: "/factory/containers-hub" },
        { url: "/factory/analytics", featureFlag: "analyticsEnabled", featureFlagDefaultOn: false },
        { url: "/factory/sheets-sacks" },
      ],
    },
  ],
  FACTORY_NAV_PAGES: [
    { key: "factory/production-report" },
    { key: "factory/daybook" },
    { key: "factory/containers-hub" },
    { key: "factory/analytics" },
    { key: "factory/sheets-sacks" },
  ],
}));

import {
  computeFactoryDefaultPage,
  computeFactoryGuardRedirect,
  resolvePageKey,
  type MyAccess,
} from "@/app/factoryAccessGuard";
import { resolveAuthenticatedAppRoute } from "@/app/authenticatedAppRouteGuard";

type RouteOptions = Parameters<typeof resolveAuthenticatedAppRoute>[0];

function access(overrides: Partial<MyAccess> = {}): MyAccess {
  return {
    fullAccess: false,
    pageKeys: [],
    hasErpAccess: true,
    hasFactoryAccess: true,
    ...overrides,
  };
}

function route(overrides: Partial<RouteOptions> = {}) {
  return resolveAuthenticatedAppRoute({
    currentLocation: "/",
    companyType: "erp",
    isAdminOwner: false,
    myAccess: access(),
    myAccessLoading: false,
    myAccessError: false,
    factorySettings: {},
    ...overrides,
  });
}

describe("authenticated application route policy", () => {
  it.each([
    ["/my-settings", "/properties/my-settings"],
    ["/balance-repair", "/properties/balance-repair"],
    ["/", "/properties/daybook"],
  ])("canonicalizes Properties route %s", (currentLocation, to) => {
    expect(route({ currentLocation, companyType: "properties" }).decision).toEqual({ kind: "redirect", to });
  });

  it("allows canonical Properties routes", () => {
    expect(route({ currentLocation: "/properties/daybook", companyType: "properties" }).decision).toEqual({
      kind: "continue",
    });
  });

  it("rejects Supplier Partner routes for non-SP companies", () => {
    expect(route({ currentLocation: "/sp/reports", companyType: "erp" }).decision).toEqual({
      kind: "redirect",
      to: "/tracking",
    });
  });

  it.each(["/sp/migration", "/sp/gc-migration"])("canonicalizes legacy SP migration route %s", (currentLocation) => {
    expect(route({ currentLocation, companyType: "supplier_partner" }).decision).toEqual({
      kind: "redirect",
      to: "/sp/setup?tab=migration",
    });
  });

  it("redirects unknown Supplier Partner child routes to the SP overview", () => {
    expect(route({ currentLocation: "/sp/not-a-page", companyType: "supplier_partner" }).decision).toEqual({
      kind: "redirect",
      to: "/sp",
    });
  });

  it("allows registered Supplier Partner routes", () => {
    expect(route({ currentLocation: "/sp/reports", companyType: "supplier_partner" }).decision).toEqual({
      kind: "continue",
    });
  });

  it("waits for access restoration before redirecting a Factory company", () => {
    expect(
      route({ companyType: "factory", myAccess: undefined, myAccessLoading: true }).decision,
    ).toEqual({ kind: "loading" });
  });

  it("returns an empty boundary while Factory access is unresolved without an error", () => {
    expect(
      route({ companyType: "factory", myAccess: undefined, myAccessLoading: false, myAccessError: false }).decision,
    ).toEqual({ kind: "empty" });
  });

  it("falls back to the Factory default after an access lookup error", () => {
    expect(
      route({ companyType: "factory", myAccess: undefined, myAccessLoading: false, myAccessError: true }).decision,
    ).toEqual({ kind: "redirect", to: "/factory/production-report" });
  });

  it("sends Factory-only users from ERP routes to their first allowed Factory page", () => {
    expect(
      route({
        companyType: "erp",
        myAccess: access({ hasErpAccess: false, pageKeys: ["factory/daybook"] }),
      }).decision,
    ).toEqual({ kind: "redirect", to: "/factory/daybook" });
  });

  it("rejects Factory routes when the account has no Factory access", () => {
    expect(
      route({
        currentLocation: "/factory/daybook",
        myAccess: access({ hasFactoryAccess: false, pageKeys: ["factory/daybook"] }),
      }).decision,
    ).toEqual({ kind: "redirect", to: "/" });
  });

  it("returns ERP users to ERP when they enter a Factory route in an ERP company", () => {
    expect(
      route({
        currentLocation: "/factory/daybook",
        companyType: "erp",
        myAccess: access({ pageKeys: ["factory/daybook"] }),
      }).decision,
    ).toEqual({ kind: "redirect", to: "/" });
  });
});

describe("Factory page access policy", () => {
  it("uses the first directly allowed navigation page as the default", () => {
    expect(computeFactoryDefaultPage(access({ pageKeys: ["factory/daybook"] }))).toBe("/factory/daybook");
  });

  it("accepts legacy detail-page keys when choosing a merged hub", () => {
    expect(computeFactoryDefaultPage(access({ pageKeys: ["factory/containers"] }))).toBe(
      "/factory/containers-hub",
    );
  });

  it("uses production report for full access, unresolved access, or an empty allow-list", () => {
    expect(computeFactoryDefaultPage(undefined)).toBe("/factory/production-report");
    expect(computeFactoryDefaultPage(access({ fullAccess: true }))).toBe("/factory/production-report");
    expect(computeFactoryDefaultPage(access())).toBe("/factory/production-report");
  });

  it.each<[string, string | null]>([
    ["/factory/daybook", "factory/daybook"],
    ["/factory/daybook/2026-07-30", "factory/daybook"],
    ["/factory/containers/new", "factory/containers-hub"],
    ["/not-factory", null],
  ])("resolves %s to %s", (path, expected) => {
    expect(resolvePageKey(path)).toBe(expected);
  });

  it("redirects restricted users away from pages they do not own", () => {
    expect(
      computeFactoryGuardRedirect({
        isFactoryRoute: true,
        isAdminOwner: false,
        myAccess: access({ pageKeys: ["factory/daybook"] }),
        factorySettings: {},
        factoryDefaultPage: "/factory/daybook",
        currentLocation: "/factory/analytics",
      }),
    ).toBe("/factory/daybook");
  });

  it("allows direct and legacy access to a page", () => {
    for (const pageKeys of [["factory/containers-hub"], ["factory/containers"]]) {
      expect(
        computeFactoryGuardRedirect({
          isFactoryRoute: true,
          isAdminOwner: false,
          myAccess: access({ pageKeys }),
          factorySettings: {},
          factoryDefaultPage: "/factory/daybook",
          currentLocation: "/factory/containers/new",
        }),
      ).toBeNull();
    }
  });

  it("keeps Sheets and Sacks viewable for restricted users", () => {
    expect(
      computeFactoryGuardRedirect({
        isFactoryRoute: true,
        isAdminOwner: false,
        myAccess: access(),
        factorySettings: {},
        factoryDefaultPage: "/factory/daybook",
        currentLocation: "/factory/sheets-sacks",
      }),
    ).toBeNull();
  });

  it("enforces feature flags after page ownership", () => {
    const params = {
      isFactoryRoute: true,
      isAdminOwner: false,
      myAccess: access({ pageKeys: ["factory/analytics"] }),
      factoryDefaultPage: "/factory/daybook",
      currentLocation: "/factory/analytics",
    };
    expect(computeFactoryGuardRedirect({ ...params, factorySettings: { analyticsEnabled: false } })).toBe(
      "/factory/daybook",
    );
    expect(computeFactoryGuardRedirect({ ...params, factorySettings: { analyticsEnabled: true } })).toBeNull();
  });

  it("enforces hidden production analytics tabs", () => {
    expect(
      computeFactoryGuardRedirect({
        isFactoryRoute: true,
        isAdminOwner: false,
        myAccess: access({
          pageKeys: ["factory/production-report"],
          hiddenCostFields: ["hide_tab_production_analytics"],
        }),
        factorySettings: {},
        factoryDefaultPage: "/factory/daybook",
        currentLocation: "/factory/production-report",
      }),
    ).toBe("/factory/daybook");
  });

  it("bypasses page restrictions for admins, non-Factory routes, and unresolved access", () => {
    const base = {
      factorySettings: {},
      factoryDefaultPage: "/factory/daybook",
      currentLocation: "/factory/analytics",
    };
    expect(
      computeFactoryGuardRedirect({ ...base, isFactoryRoute: true, isAdminOwner: true, myAccess: access() }),
    ).toBeNull();
    expect(
      computeFactoryGuardRedirect({ ...base, isFactoryRoute: false, isAdminOwner: false, myAccess: access() }),
    ).toBeNull();
    expect(
      computeFactoryGuardRedirect({ ...base, isFactoryRoute: true, isAdminOwner: false, myAccess: undefined }),
    ).toBeNull();
  });
});
