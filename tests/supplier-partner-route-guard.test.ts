import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const authenticatedApp = readFileSync("client/src/app/AuthenticatedApp.tsx", "utf8");
const routeGuard = readFileSync("client/src/app/authenticatedAppRouteGuard.ts", "utf8");
const erpRoutes = readFileSync("client/src/routes/ErpRoutes.tsx", "utf8");

describe("Supplier Partner route boundary", () => {
  it("keeps route policy outside the authenticated React orchestrator", () => {
    expect(authenticatedApp).toContain("resolveAuthenticatedAppRoute");
    expect(authenticatedApp).not.toContain('currentLocation === "/sp" || currentLocation.startsWith("/sp/")');
    expect(routeGuard).toContain('currentLocation === "/sp" || currentLocation.startsWith("/sp/")');
  });

  it("rejects SP routes for non-SP companies after company initialization", () => {
    expect(authenticatedApp).toContain("if (isLoading || companyLoading || !selectedCompany) return <AppLoadingState />");
    expect(routeGuard).toContain("isSupplierPartnerRoute && !isSupplierPartnerCompany");
    expect(routeGuard).toContain('decision = { kind: "redirect", to: "/tracking" }');
  });

  it("canonicalizes migration routes and unknown SP child routes", () => {
    expect(routeGuard).toContain('decision = { kind: "redirect", to: "/sp/setup?tab=migration" }');
    expect(routeGuard).toContain('decision = { kind: "redirect", to: "/sp" }');
  });

  it("uses the Supplier Partner overview as the stable namespace landing page", () => {
    expect(erpRoutes).toContain('<Route path="/sp" component={SpOverview} />');
    expect(routeGuard).not.toContain('to: "/sp/reports"');
  });
});
