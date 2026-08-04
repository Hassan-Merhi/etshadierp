import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("global application language integration", () => {
  it("mounts one global provider without a floating language overlay", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain("<ApplicationLanguageProvider>");
    expect(app).not.toContain("GlobalLanguageSwitch");
    expect(fs.existsSync(path.join(root, "client/src/components/GlobalLanguageSwitch.tsx"))).toBe(false);
  });

  it("places language selection inside the profile menu without covering company switching", () => {
    const topBar = read("client/src/components/AppTopBar.tsx");
    const userMenu = read("client/src/components/UserMenu.tsx");
    const companySelector = read("client/src/components/CompanySelector.tsx");

    expect(topBar).toContain("<UserMenu");
    expect(topBar).toContain("<CompanySelector />");
    expect(topBar.indexOf("<UserMenu")).toBeLessThan(topBar.indexOf("<CompanySelector />"));
    expect(companySelector).toContain('data-testid="button-company-selector"');

    expect(userMenu).toContain("DropdownMenuRadioGroup");
    expect(userMenu).toContain('data-testid="button-user-menu"');
    expect(userMenu).toContain("application-language-${option.value}");
    expect(userMenu).toContain('value: "en"');
    expect(userMenu).toContain('value: "ar"');
    expect(userMenu).toContain('value: "fr"');
    expect(userMenu).not.toContain("fixed right-3 top-3");
    expect(userMenu).not.toContain("z-[70]");
  });

  it("keeps the profile trigger available at narrow widths", () => {
    const userMenu = read("client/src/components/UserMenu.tsx");
    expect(userMenu).toContain('data-testid="button-user-menu"');
    expect(userMenu).toContain('className="h-8 max-w-[15rem]');
    expect(userMenu).not.toContain('data-testid="button-user-menu"\n          className="hidden');
  });

  it("keeps the Factory compatibility component non-visual", () => {
    const factorySwitch = read("client/src/components/FactoryCatalogLanguageSwitch.tsx");
    expect(factorySwitch).toContain("return null");
    expect(factorySwitch).not.toContain("<Button");
  });

  it("registers authenticated language preference endpoints", () => {
    const authRoutes = read("server/routes/authRoutes.ts");
    const preferenceRoutes = read("server/routes/auth/languagePreferenceRoutes.ts");
    expect(authRoutes).toContain("registerLanguagePreferenceRoutes(app)");
    expect(preferenceRoutes).toContain('app.get("/api/language-preference"');
    expect(preferenceRoutes).toContain('app.put("/api/language-preference"');
    expect(preferenceRoutes).toContain("onConflictDoUpdate");
    expect(preferenceRoutes).toContain("target: userLanguagePreferences.userId");
  });
});
