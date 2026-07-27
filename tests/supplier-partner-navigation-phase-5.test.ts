import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Supplier Partner navigation phase 5", () => {
  const authenticatedApp = read("client/src/app/AuthenticatedApp.tsx");
  const appNavigation = read("client/src/app/useAppNavigation.ts");

  it("returns unknown Supplier Partner routes to the Overview with replacement history", () => {
    expect(authenticatedApp).toContain("const SUPPLIER_PARTNER_PATHS = new Set");
    expect(authenticatedApp).toContain("isSupplierPartnerRoute && !SUPPLIER_PARTNER_PATHS.has(currentLocation)");
    expect(authenticatedApp).toContain('<Redirect replace to="/sp" />');
  });

  it("uses deterministic Supplier Partner parent routes for Escape and Back", () => {
    expect(appNavigation).toContain('if (cleanPath === "/sp/reports") return "/sp"');
    expect(appNavigation).toContain('if (cleanPath === "/sp/opening-stock") return "/sp"');
    expect(appNavigation).toContain('if (cleanPath === "/sp/aliases") return "/sp"');
    expect(appNavigation).toContain('if (cleanPath === "/sp/setup") return "/sp"');
    expect(appNavigation).toContain('return "/sp/setup?tab=migration"');
    expect(appNavigation).toContain("getSupplierPartnerParent(pathname) ?? getParentRoute(pathname)");
  });

  it("keeps compatibility migration redirects replacement-based", () => {
    expect(authenticatedApp).toContain('currentLocation === "/sp/migration"');
    expect(authenticatedApp).toContain('currentLocation === "/sp/gc-migration"');
    expect(authenticatedApp).toContain('<Redirect replace to="/sp/setup?tab=migration" />');
  });
});
