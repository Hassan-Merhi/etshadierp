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
    // Company loading is awaited in the shell before any route decision is
    // resolved, so Supplier Partner routes are never rejected mid-restoration.
    expect(authenticatedApp).toContain("const { selectedCompany, isLoading: companyLoading } = useCompany()");
    expect(authenticatedApp).toContain("if (isLoading || companyLoading || !selectedCompany || !user) return <AppLoadingState />");
    const companyGuard = authenticatedApp.indexOf("companyLoading || !selectedCompany");
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
