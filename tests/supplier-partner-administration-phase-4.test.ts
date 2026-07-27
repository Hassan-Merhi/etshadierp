import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Supplier Partner administration phase 4", () => {
  const setup = read("client/src/pages/sp/SpSetup.tsx");
  const navigation = read("client/src/lib/supplier-partner-navigation.ts");
  const overview = read("client/src/pages/sp/SpOverview.tsx");
  const panel = read("client/src/pages/sp/SpSetupPanel.tsx");
  const authenticatedApp = read("client/src/app/AuthenticatedApp.tsx");

  it("consolidates setup and migration under one URL-backed administration hub", () => {
    expect(setup).toContain('allowedValues: ADMIN_TABS');
    expect(setup).toContain('defaultValue: "setup"');
    expect(setup).toContain('<SpSetupPanel />');
    expect(setup).toContain('<GcLshiMigration />');
    expect(navigation).toContain('/sp/setup?tab=migration');
    expect(overview).toContain('/sp/setup?tab=migration');
  });

  it("limits setup to Admin or Developer and migration to Developer", () => {
    expect(setup).toContain('role === "Admin" || role === "Developer"');
    expect(setup).toContain('role === "Developer"');
    expect(setup).toContain('<Redirect replace to="/sp" />');
    expect(setup).toContain('<Redirect replace to="/sp/setup" />');
  });

  it("canonicalizes both historical migration URLs with replacement history", () => {
    expect(authenticatedApp).toContain('currentLocation === "/sp/migration"');
    expect(authenticatedApp).toContain('currentLocation === "/sp/gc-migration"');
    expect(authenticatedApp).toContain('<Redirect replace to="/sp/setup?tab=migration" />');
  });

  it("keeps the Supplier Partner overview as the real namespace landing page", () => {
    expect(authenticatedApp).not.toContain('currentLocation === "/sp") {\n    return <Redirect replace to="/sp/reports"');
  });

  it("preserves the existing setup API and repair behavior", () => {
    expect(panel).toContain('queryKey: ["/api/sp/setup/status"]');
    expect(panel).toContain('apiRequest("POST", "/api/sp/setup")');
    expect(panel).toContain('repairedSupplierVoucherLinks');
  });
});
