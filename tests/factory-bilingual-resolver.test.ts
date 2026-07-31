import { describe, expect, it } from "vitest";
import {
  factorySearchValues,
  normalizeFactoryLanguage,
  resolveFactoryProductLanguage,
  resolveFactoryText,
} from "../shared/factoryBilingual";

describe("Factory bilingual shared resolver", () => {
  it("normalizes unsupported languages to English", () => {
    expect(normalizeFactoryLanguage("ar")).toBe("ar");
    expect(normalizeFactoryLanguage("AR")).toBe("ar");
    expect(normalizeFactoryLanguage("fr")).toBe("en");
    expect(normalizeFactoryLanguage(undefined)).toBe("en");
  });

  it("uses the approved Arabic and English fallback order", () => {
    expect(resolveFactoryText({ en: "Men Bag", ar: "حقيبة رجالية", fallback: "HMD10014" }, "ar")).toBe(
      "حقيبة رجالية"
    );
    expect(resolveFactoryText({ en: "Men Bag", ar: null, fallback: "HMD10014" }, "ar")).toBe("Men Bag");
    expect(resolveFactoryText({ en: null, ar: "حقيبة رجالية", fallback: "HMD10014" }, "en")).toBe(
      "حقيبة رجالية"
    );
    expect(resolveFactoryText({ en: null, ar: null, fallback: "HMD10014" }, "ar")).toBe("HMD10014");
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

  it("keeps article code and both languages searchable", () => {
    expect(
      factorySearchValues({
        articleCode: "HMD10014",
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
