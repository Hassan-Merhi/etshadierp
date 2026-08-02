import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("global application language integration", () => {
  it("mounts one global provider and one visible global switch", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain("<ApplicationLanguageProvider>");
    expect(app).toContain("<GlobalLanguageSwitch />");
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
