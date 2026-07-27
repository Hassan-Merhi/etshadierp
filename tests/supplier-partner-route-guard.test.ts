import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("client/src/app/AuthenticatedApp.tsx", "utf8");

describe("Supplier Partner route boundary", () => {
  it("classifies both /sp and /sp child routes", () => {
    expect(source).toContain('currentLocation === "/sp" || currentLocation.startsWith("/sp/")');
  });

  it("blocks Supplier Partner routes for other company types with replacement history", () => {
    expect(source).toContain("if (isSupplierPartnerRoute && !isSupplierPartnerCompany)");
    expect(source).toContain('<Redirect replace to="/tracking" />');
  });

  it("provides a stable replacement-history landing route for Supplier Partner companies", () => {
    expect(source).toContain('if (isSupplierPartnerCompany && currentLocation === "/sp")');
    expect(source).toContain('<Redirect replace to="/sp/reports" />');
  });
});
