import { describe, expect, it } from "vitest";
import {
  buildFactoryBilingualProductSnapshot,
  normalizeFactoryArabicTranslationImportRow,
  normalizeFactoryArticleCode,
  parseFactoryArabicImportMode,
  parseFactoryCatalogLanguage,
  resolveFactoryCategoryName,
  resolveFactoryProductDescription,
  resolveFactoryProductName,
  resolveFactorySnapshotProductName,
} from "../shared/factoryBilingualContract";

describe("factory bilingual bale catalog contract", () => {
  const bilingualProduct = {
    articleCode: "HMD10014",
    name: "MEN BAG CREME 20KG",
    nameAr: "حقيبة رجالية كريمي 20 كغ",
    description: "Cream men's bags",
    descriptionAr: "حقائب رجالية كريمية",
  };

  it("resolves bilingual product and category names by requested language", () => {
    const category = { name: "BAGS & BELTS", nameAr: "حقائب وأحزمة" };

    expect(resolveFactoryProductName(bilingualProduct, "en")).toBe("MEN BAG CREME 20KG");
    expect(resolveFactoryProductName(bilingualProduct, "ar")).toBe("حقيبة رجالية كريمي 20 كغ");
    expect(resolveFactoryCategoryName(category, "ar")).toBe("حقائب وأحزمة");
  });

  it("uses the opposite language before the article code", () => {
    const englishOnly = { articleCode: "HMD11005", name: "ASIAN WEAR 40KG", nameAr: null };
    const arabicOnly = { articleCode: "HMD11005", name: null, nameAr: "ملابس آسيوية" };

    expect(resolveFactoryProductName(englishOnly, "ar")).toBe("ASIAN WEAR 40KG");
    expect(resolveFactoryProductName(arabicOnly, "en")).toBe("ملابس آسيوية");
  });

  it("uses the article code only when both language values are missing", () => {
    const missingNames = { articleCode: " hmd00123 ", name: " ", nameAr: null };

    expect(resolveFactoryProductName(missingNames, "ar")).toBe("HMD00123");
  });

  it("applies the same fallback contract to descriptions", () => {
    const englishOnlyDescription = {
      articleCode: "HMD10014",
      description: "English description",
      descriptionAr: null,
    };

    expect(resolveFactoryProductDescription(bilingualProduct, "ar")).toBe("حقائب رجالية كريمية");
    expect(resolveFactoryProductDescription(englishOnlyDescription, "ar")).toBe("English description");
  });

  it("normalizes article-code matching without losing leading zeroes or punctuation", () => {
    expect(normalizeFactoryArticleCode(" 00-ab-019 ")).toBe("00-AB-019");
    expect(normalizeFactoryArticleCode(123)).toBe("");
  });

  it("accepts only the supported language and import mode values", () => {
    expect(parseFactoryCatalogLanguage("ar")).toBe("ar");
    expect(parseFactoryCatalogLanguage("AR")).toBe("en");
    expect(parseFactoryCatalogLanguage("unknown", "ar")).toBe("ar");
    expect(parseFactoryArabicImportMode("replace-existing")).toBe("replace-existing");
    expect(parseFactoryArabicImportMode("overwrite")).toBe("fill-missing");
  });

  it("prefers finalized snapshots over current catalog translations", () => {
    const resolved = resolveFactorySnapshotProductName({
      language: "ar",
      snapshot: {
        articleCode: "HMD10014",
        productNameEn: "HISTORICAL ENGLISH NAME",
        productNameAr: null,
      },
      catalog: bilingualProduct,
    });

    expect(resolved).toBe("HISTORICAL ENGLISH NAME");
  });

  it("uses current catalog data only when the historical snapshot has no names", () => {
    const resolved = resolveFactorySnapshotProductName({
      language: "ar",
      snapshot: {
        articleCode: "HMD10014",
        productNameEn: null,
        productNameAr: null,
      },
      catalog: bilingualProduct,
    });

    expect(resolved).toBe("حقيبة رجالية كريمي 20 كغ");
  });

  it("builds trimmed bilingual snapshots for document persistence", () => {
    const snapshot = buildFactoryBilingualProductSnapshot({
      product: {
        articleCode: " hmd10014 ",
        name: " MEN BAG CREME 20KG ",
        nameAr: " حقيبة رجالية ",
        description: " ",
        descriptionAr: " وصف ",
      },
      category: { name: " BAGS & BELTS ", nameAr: " حقائب وأحزمة " },
    });

    expect(snapshot).toEqual({
      articleCode: "HMD10014",
      productNameEn: "MEN BAG CREME 20KG",
      productNameAr: "حقيبة رجالية",
      productNameFr: null,
      categoryNameEn: "BAGS & BELTS",
      categoryNameAr: "حقائب وأحزمة",
      categoryNameFr: null,
      descriptionEn: null,
      descriptionAr: "وصف",
      descriptionFr: null,
    });
  });

  it("normalizes Arabic translation workbook rows without modifying reference data", () => {
    const row = normalizeFactoryArabicTranslationImportRow({
      articleCode: " hmd11007 ",
      productNameAr: " حصيرة حمام 40 كغ ",
      categoryNameAr: " صيفي رقم 1 ",
      descriptionAr: " ",
    });

    expect(row).toEqual({
      articleCode: "HMD11007",
      productNameAr: "حصيرة حمام 40 كغ",
      categoryNameAr: "صيفي رقم 1",
      descriptionAr: null,
    });
  });
});
