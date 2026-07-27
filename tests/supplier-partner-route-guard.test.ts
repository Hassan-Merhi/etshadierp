import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const authenticatedApp = readFileSync("client/src/app/AuthenticatedApp.tsx", "utf8");
const erpRoutes = readFileSync("client/src/routes/ErpRoutes.tsx", "utf8");

describe("Supplier Partner route boundary", () => {
  it("classifies both /sp and /sp child routes", () => {
    expect(authenticatedApp).toContain('currentLocation === "/sp" || currentLocation.startsWith("/sp/")');
  });

  it("waits for company initialization before rejecting Supplier Partner routes", () => {
    expect(authenticatedApp).toContain("const { selectedCompany, isLoading: companyLoading } = useCompany()");
    expect(authenticatedApp).toContain("if (isSupplierPartnerRoute && companyLoading) return <AppLoadingState />");
    expect(authenticatedApp).toContain("if (isSupplierPartnerRoute && !isSupplierPartnerCompany)");
    expect(authenticatedApp).toContain('<Redirect replace to="/tracking" />');
  });

  it("uses the Supplier Partner overview as the stable namespace landing page", () => {
    expect(erpRoutes).toContain('<Route path="/sp" component={SpOverview} />');
    expect(authenticatedApp).not.toContain('<Redirect replace to="/sp/reports" />');
  });
});
