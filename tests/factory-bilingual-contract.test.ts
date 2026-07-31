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
    expect(resolveFactoryProductName(bilingualProduct, "en")).toBe("MEN BAG CREME 20KG");
    expect(resolveFactoryProductName(bilingualProduct, "ar")).toBe("حقيبة رجالية كريمي 20 كغ");
    expect(resolveFactoryCategoryName({ name: "BAGS & BELTS", nameAr: "حقائب وأحزمة" }, "ar")).toBe(
      "حقائب وأحزمة"
    );
  });

  it("uses the opposite language before the article code", () => {
    expect(
      resolveFactoryProductName({ articleCode: "HMD11005", name: "ASIAN WEAR 40KG", nameAr: null }, "ar")
    ).toBe("ASIAN WEAR 40KG");
    expect(resolveFactoryProductName({ articleCode: "HMD11005", name: null, nameAr: "ملابس آسيوية" }, "en")).toBe(
      "ملابس آسيوية"
    );
  });

  it("uses the article code only when both language values are missing", () => {
    expect(resolveFactoryProductName({ articleCode: " hmd00123 ", name: " ", nameAr: null }, "ar")).toBe(
      "HMD00123"
    );
  });

  it("applies the same fallback contract to descriptions", () => {
    expect(resolveFactoryProductDescription(bilingualProduct, "ar")).toBe("حقائب رجالية كريمية");
    expect(
      resolveFactoryProductDescription(
        { articleCode: "HMD10014", description: "English description", descriptionAr: null },
        "ar"
      )
    ).toBe("English description");
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
    expect(
      resolveFactorySnapshotProductName({
        language: "ar",
        snapshot: {
          articleCode: "HMD10014",
          productNameEn: "HISTORICAL ENGLISH NAME",
          productNameAr: null,
        },
        catalog: bilingualProduct,
      })
    ).toBe("HISTORICAL ENGLISH NAME");
  });

  it("uses current catalog data only when the historical snapshot has no names", () => {
    expect(
      resolveFactorySnapshotProductName({
        language: "ar",
        snapshot: {
          articleCode: "HMD10014",
          productNameEn: null,
          productNameAr: null,
        },
        catalog: bilingualProduct,
      })
    ).toBe("حقيبة رجالية كريمي 20 كغ");
  });

  it("builds trimmed bilingual snapshots for document persistence", () => {
    expect(
      buildFactoryBilingualProductSnapshot({
        product: {
          articleCode: " hmd10014 ",
          name: " MEN BAG CREME 20KG ",
          nameAr: " حقيبة رجالية ",
          description: " ",
          descriptionAr: " وصف ",
        },
        category: { name: " BAGS & BELTS ", nameAr: " حقائب وأحزمة " },
      })
    ).toEqual({
      articleCode: "HMD10014",
      productNameEn: "MEN BAG CREME 20KG",
      productNameAr: "حقيبة رجالية",
      categoryNameEn: "BAGS & BELTS",
      categoryNameAr: "حقائب وأحزمة",
      descriptionEn: null,
      descriptionAr: "وصف",
    });
  });

  it("normalizes Arabic translation workbook rows without modifying reference data", () => {
    expect(
      normalizeFactoryArabicTranslationImportRow({
        articleCode: " hmd11007 ",
        productNameAr: " حصيرة حمام 40 كغ ",
        categoryNameAr: " صيفي رقم 1 ",
        descriptionAr: " ",
      })
    ).toEqual({
      articleCode: "HMD11007",
      productNameAr: "حصيرة حمام 40 كغ",
      categoryNameAr: "صيفي رقم 1",
      descriptionAr: null,
    });
  });
});
