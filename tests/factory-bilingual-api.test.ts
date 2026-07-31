import { describe, expect, it } from "vitest";
import {
  factoryProductMatchesSearch,
  filterFactoryProductsBySearch,
  resolveFactoryCategoryApiRecord,
  resolveFactoryProductApiRecord,
} from "../shared/factoryBilingualApi";

describe("factory bilingual API contract", () => {
  const product = {
    id: 14,
    companyId: 7,
    articleCode: "HMD10014",
    name: "MEN BAG CREME 20KG",
    nameAr: "حقيبة رجالية كريمي 20 كغ",
    description: "Cream men's bags",
    descriptionAr: "حقائب رجالية كريمية",
    category: {
      id: 3,
      companyId: 7,
      name: "BAGS & BELTS",
      nameAr: "حقائب وأحزمة",
    },
  };

  it("adds resolved display fields without removing existing API fields", () => {
    const resolved = resolveFactoryProductApiRecord(product, "ar");

    expect(resolved.id).toBe(14);
    expect(resolved.companyId).toBe(7);
    expect(resolved.name).toBe("MEN BAG CREME 20KG");
    expect(resolved.nameAr).toBe("حقيبة رجالية كريمي 20 كغ");
    expect(resolved.displayName).toBe("حقيبة رجالية كريمي 20 كغ");
    expect(resolved.displayDescription).toBe("حقائب رجالية كريمية");
    expect(resolved.displayCategoryName).toBe("حقائب وأحزمة");
    expect(resolved.language).toBe("ar");
  });

  it("uses English as the non-breaking default language", () => {
    const resolved = resolveFactoryProductApiRecord(product, undefined);

    expect(resolved.displayName).toBe("MEN BAG CREME 20KG");
    expect(resolved.displayCategoryName).toBe("BAGS & BELTS");
    expect(resolved.language).toBe("en");
  });

  it("resolves categories through the same shared fallback", () => {
    const resolved = resolveFactoryCategoryApiRecord(
      { id: 3, companyId: 7, name: "BAGS & BELTS", nameAr: null },
      "ar"
    );

    expect(resolved.displayName).toBe("BAGS & BELTS");
    expect(resolved.language).toBe("ar");
  });

  it("searches article code, both product languages, and both category languages", () => {
    expect(factoryProductMatchesSearch(product, "hmd10014")).toBe(true);
    expect(factoryProductMatchesSearch(product, "men bag")).toBe(true);
    expect(factoryProductMatchesSearch(product, "رجالية")).toBe(true);
    expect(factoryProductMatchesSearch(product, "belts")).toBe(true);
    expect(factoryProductMatchesSearch(product, "أحزمة")).toBe(true);
    expect(factoryProductMatchesSearch(product, "not present")).toBe(false);
  });

  it("filters without mutating the source collection", () => {
    const other = {
      ...product,
      id: 15,
      articleCode: "HMD11007",
      name: "BATH MAT 40KG",
      nameAr: "حصيرة حمام 40 كغ",
    };
    const source = [product, other] as const;
    const result = filterFactoryProductsBySearch(source, "حمام");

    expect(result).toEqual([other]);
    expect(source).toHaveLength(2);
  });
});
