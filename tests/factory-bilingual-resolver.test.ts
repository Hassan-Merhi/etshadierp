import { describe, expect, it } from "vitest";
import {
  factorySearchValues,
  parseFactoryCatalogLanguage,
  resolveFactoryLocalizedText,
  resolveFactoryProductLanguage,
} from "../shared/factoryBilingualContract";

describe("Factory bilingual shared resolver", () => {
  it("accepts only the supported API language values", () => {
    expect(parseFactoryCatalogLanguage("ar")).toBe("ar");
    expect(parseFactoryCatalogLanguage("en")).toBe("en");
    expect(parseFactoryCatalogLanguage("AR")).toBe("en");
    expect(parseFactoryCatalogLanguage("fr")).toBe("fr");
    expect(parseFactoryCatalogLanguage("de")).toBe("en");
    expect(parseFactoryCatalogLanguage(undefined)).toBe("en");
  });

  it("uses the approved Arabic and English fallback order", () => {
    expect(
      resolveFactoryLocalizedText(
        { english: "Men Bag", arabic: "حقيبة رجالية", articleCode: "HMD10014" },
        "ar"
      )
    ).toBe("حقيبة رجالية");
    expect(
      resolveFactoryLocalizedText(
        { english: "Men Bag", arabic: null, articleCode: "HMD10014" },
        "ar"
      )
    ).toBe("Men Bag");
    expect(
      resolveFactoryLocalizedText(
        { english: null, arabic: "حقيبة رجالية", articleCode: "HMD10014" },
        "en"
      )
    ).toBe("حقيبة رجالية");
    expect(
      resolveFactoryLocalizedText(
        { english: null, arabic: null, articleCode: " hmd10014 " },
        "ar"
      )
    ).toBe("HMD10014");
  });

  it("resolves product, category, and description with one contract", () => {
    const arabic = resolveFactoryProductLanguage(
      {
        articleCode: "HMD10014",
        name: "MEN BAG CREME 20KG",
        nameAr: "حقيبة رجالية كريمي 20 كغ",
        categoryName: "BAGS & BELTS",
        categoryNameAr: "حقائب وأحزمة",
        description: "English description",
        descriptionAr: "وصف عربي",
      },
      "ar"
    );

    expect(arabic).toEqual({
      language: "ar",
      articleCode: "HMD10014",
      name: "حقيبة رجالية كريمي 20 كغ",
      categoryName: "حقائب وأحزمة",
      description: "وصف عربي",
    });
  });

  it("uses the article code when product, category, and description text are all missing", () => {
    expect(
      resolveFactoryProductLanguage(
        {
          articleCode: " 00-ab-019 ",
          name: null,
          nameAr: null,
          categoryName: null,
          categoryNameAr: null,
          description: null,
          descriptionAr: null,
        },
        "ar"
      )
    ).toEqual({
      language: "ar",
      articleCode: "00-AB-019",
      name: "00-AB-019",
      categoryName: "00-AB-019",
      description: "00-AB-019",
    });
  });

  it("keeps normalized article code and both languages searchable", () => {
    expect(
      factorySearchValues({
        articleCode: " hmd10014 ",
        name: "MEN BAG CREME 20KG",
        nameAr: "حقيبة رجالية كريمي 20 كغ",
        categoryName: "BAGS & BELTS",
        categoryNameAr: "حقائب وأحزمة",
      })
    ).toEqual([
      "HMD10014",
      "MEN BAG CREME 20KG",
      "حقيبة رجالية كريمي 20 كغ",
      "BAGS & BELTS",
      "حقائب وأحزمة",
    ]);
  });
});
