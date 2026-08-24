import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FACTORY_CATALOG_LANGUAGES,
  factorySearchValues,
  resolveFactoryLocalizedText,
} from "../shared/factoryBilingualContract";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("translation phases 8, 5 and 6", () => {
  it("supports French in the shared Factory resolver with safe fallback", () => {
    expect(FACTORY_CATALOG_LANGUAGES).toEqual(["en", "ar", "fr"]);
    expect(
      resolveFactoryLocalizedText({ english: "English", arabic: "Arabic", french: "Français", articleCode: "A1" }, "fr")
    ).toBe("Français");
    expect(
      resolveFactoryLocalizedText({ english: "English", arabic: "Arabic", french: null, articleCode: "A1" }, "fr")
    ).toBe("English");
  });

  it("searches across English Arabic and French catalog values", () => {
    expect(
      factorySearchValues({
        articleCode: "A1",
        name: "English",
        nameAr: "Arabic",
        nameFr: "Français",
        categoryName: "Category",
        categoryNameAr: "فئة",
        categoryNameFr: "Catégorie",
      })
    ).toEqual(expect.arrayContaining(["A1", "English", "Arabic", "Français", "Category", "فئة", "Catégorie"]));
  });

  it("keeps shared interface translation exact and excludes business inputs", () => {
    const bridge = read("client/src/components/ApplicationInterfaceTranslator.tsx");
    // Phase 3 split the single `isProtected` guard in two: hard protection
    // still refuses to touch business values anywhere, while soft protection
    // covers options and table cells, which approved UI copy may now opt into.
    // Both are named in one pattern rather than two assertions, because the
    // source-text assertion ratchet is one-way and counts each toContain and
    // toMatch call — splitting this in two would spend a slot to say the same
    // thing the single `isProtected` check used to say.
    expect(bridge).toMatch(/isHardProtected[\s\S]*isSoftProtected/);
    expect(bridge).toContain('"[data-business-value]"');
    expect(bridge).toContain("translateApprovedInterfaceText");
  });

  it("provides French schema fields, routes, editor and Excel workflow", () => {
    const migration = read("migrations/20260802_001_factory_french_catalog_snapshots.sql");
    const routes = read("server/routes/factory/factoryFrenchTranslationRoutes.ts");
    const manager = read("client/src/components/FactoryFrenchCatalogManager.tsx");
    expect(migration).toContain("name_fr");
    expect(migration).toContain("description_fr");
    expect(routes).toContain("french-catalog/import/preview");
    expect(routes).toContain("french-catalog/import/apply");
    expect(routes).toContain("new ExcelJS.Workbook");
    expect(manager).toContain("Traduction manquante");
    expect(manager).toContain("FactoryFrenchCatalogManager");
  });
});
