import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const authenticatedApp = readFileSync("client/src/app/AuthenticatedApp.tsx", "utf8");
const routeGuard = readFileSync("client/src/app/authenticatedAppRouteGuard.ts", "utf8");
const erpRoutes = readFileSync("client/src/routes/ErpRoutes.tsx", "utf8");

describe("Supplier Partner route boundary", () => {
  it("classifies both /sp and /sp child routes", () => {
    expect(routeGuard).toContain('currentLocation === "/sp" || currentLocation.startsWith("/sp/")');
  });

  it("waits for company initialization before rejecting Supplier Partner routes", () => {
    expect(authenticatedApp).toContain("isLoading: companyLoading");
    expect(authenticatedApp).toContain("if (companyLoading) return <AppLoadingState />;");
    expect(authenticatedApp).toContain("if (companyError || !selectedCompany)");
    expect(authenticatedApp).toContain("retryCompanyBootstrap");
    const companyGuard = authenticatedApp.indexOf("if (companyLoading) return <AppLoadingState />;");
    const routeResolution = authenticatedApp.indexOf("resolveAuthenticatedAppRoute({");
    expect(companyGuard).toBeGreaterThan(-1);
    expect(routeResolution).toBeGreaterThan(companyGuard);
    expect(routeGuard).toContain("isSupplierPartnerRoute && !isSupplierPartnerCompany");
    expect(routeGuard).toContain('decision = { kind: "redirect", to: "/tracking" }');
  });

  it("uses the Supplier Partner overview as the stable namespace landing page", () => {
    expect(erpRoutes).toContain('<Route path="/sp" component={SpOverview} />');
    expect(routeGuard).not.toContain('to: "/sp/reports"');
  });
});
