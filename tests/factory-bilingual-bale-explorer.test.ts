import { describe, expect, it } from "vitest";
import {
  mapFactoryLegacyCategoryEdit,
  mapFactoryLegacyProductEdit,
  presentFactoryCatalogCategories,
  presentFactoryCatalogProducts,
  suppressUnchangedFactoryArabicFallbacks,
} from "../shared/factoryBilingualCatalogPresentation";

describe("Phase 3 Factory bilingual Bale Explorer presentation", () => {
  const products = [
    {
      id: 1,
      articleCode: "HMD10001",
      name: "Men Bag Cream",
      nameAr: "حقيبة رجالية كريمي",
      description: "English description",
      descriptionAr: "وصف عربي",
      sellingPrice: "120.00",
    },
    {
      id: 2,
      articleCode: "HMD10002",
      name: "English Only Product",
      nameAr: null,
      description: null,
      descriptionAr: null,
      sellingPrice: "75.00",
    },
  ];

  it("switches displayed catalog text without changing language-neutral values", () => {
    const english = presentFactoryCatalogProducts(products, "en");
    const arabic = presentFactoryCatalogProducts(products, "ar");

    expect(english[0]).toMatchObject({
      name: "Men Bag Cream",
      nameEn: "Men Bag Cream",
      description: "English description",
      articleCode: "HMD10001",
      sellingPrice: "120.00",
    });
    expect(arabic[0]).toMatchObject({
      name: "حقيبة رجالية كريمي",
      nameEn: "Men Bag Cream",
      description: "وصف عربي",
      articleCode: "HMD10001",
      sellingPrice: "120.00",
    });
    expect(arabic[1].name).toBe("English Only Product");
  });

  it("searches English, Arabic, descriptions, and article codes regardless of display language", () => {
    expect(presentFactoryCatalogProducts(products, "en", "رجالية").map((product) => product.id)).toEqual([1]);
    expect(presentFactoryCatalogProducts(products, "ar", "english only").map((product) => product.id)).toEqual([2]);
    expect(presentFactoryCatalogProducts(products, "ar", "HMD10001").map((product) => product.id)).toEqual([1]);
    expect(presentFactoryCatalogProducts(products, "en", "وصف عربي").map((product) => product.id)).toEqual([1]);
  });

  it("routes legacy Arabic-mode product edits away from English fields", () => {
    const mapped = mapFactoryLegacyProductEdit(
      {
        name: "اسم عربي جديد",
        description: "وصف عربي جديد",
        articleCode: "HMD10001",
        sellingPrice: "150.00",
      },
      "ar"
    );

    expect(mapped.body).toEqual({ articleCode: "HMD10001", sellingPrice: "150.00" });
    expect(mapped.deferredArabic).toEqual({
      nameAr: "اسم عربي جديد",
      descriptionAr: "وصف عربي جديد",
    });
  });

  it("does not persist English or article-code fallbacks as Arabic translations", () => {
    const current = products[1];
    const safe = suppressUnchangedFactoryArabicFallbacks(
      {
        nameAr: "English Only Product",
        descriptionAr: "HMD10002",
      },
      current
    );

    expect(safe).toEqual({});
    expect(
      suppressUnchangedFactoryArabicFallbacks({ nameAr: "ترجمة عربية حقيقية" }, current)
    ).toEqual({ nameAr: "ترجمة عربية حقيقية" });
  });

  it("keeps English-mode edits on canonical English fields", () => {
    const mapped = mapFactoryLegacyProductEdit(
      { name: "Updated English", description: "Updated description", weightPerBaleKg: 45 },
      "en"
    );

    expect(mapped.body).toEqual({
      name: "Updated English",
      description: "Updated description",
      weightPerBaleKg: 45,
    });
    expect(mapped.deferredArabic).toEqual({});
  });

  it("localizes categories and maps Arabic-mode category edits to nameAr", () => {
    const categories = presentFactoryCatalogCategories(
      [{ id: 4, name: "Bags & Belts", nameAr: "الحقائب والأحزمة" }],
      "ar"
    );

    expect(categories[0]).toMatchObject({
      id: 4,
      name: "الحقائب والأحزمة",
      nameEn: "Bags & Belts",
      nameAr: "الحقائب والأحزمة",
    });
    expect(mapFactoryLegacyCategoryEdit({ name: "فئة معدلة" }, "ar")).toEqual({ nameAr: "فئة معدلة" });
  });
});
