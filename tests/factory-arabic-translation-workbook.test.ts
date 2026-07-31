import { describe, expect, it } from "vitest";
import {
  createArabicTranslationTemplate,
  parseArabicTranslationWorkbook,
  previewArabicTranslationImport,
  type TranslationCatalogProduct,
} from "../server/services/factoryArabicTranslationWorkbook";

const products: TranslationCatalogProduct[] = [
  {
    id: 1,
    categoryId: 10,
    articleCode: "00123",
    name: "MEN BAG",
    nameAr: null,
    descriptionAr: null,
    categoryName: "BAGS",
    categoryNameAr: null,
  },
  {
    id: 2,
    categoryId: 10,
    articleCode: "ABC-2",
    name: "BELT",
    nameAr: "حزام",
    descriptionAr: null,
    categoryName: "BAGS",
    categoryNameAr: "حقائب",
  },
];

describe("Factory Arabic translation workbook", () => {
  it("round-trips article codes as text, preserving leading zeroes", async () => {
    const buffer = await createArabicTranslationTemplate(products);
    const rows = await parseArabicTranslationWorkbook(buffer);
    expect(rows[0]?.articleCode).toBe("00123");
  });

  it("matches by normalized exact article code only", () => {
    const preview = previewArabicTranslationImport(
      [{ rowNumber: 2, articleCode: "00123", productNameAr: "حقيبة", categoryNameAr: "حقائب", descriptionAr: "" }],
      products,
      "replace"
    );
    expect(preview.matchedProducts).toBe(1);
    expect(preview.productsToUpdate).toBe(1);
    expect(preview.unknownArticleCodes).toEqual([]);
  });

  it("blocks duplicate article codes", () => {
    const preview = previewArabicTranslationImport(
      [
        { rowNumber: 2, articleCode: "00123", productNameAr: "حقيبة", categoryNameAr: "حقائب", descriptionAr: "" },
        { rowNumber: 3, articleCode: "00123", productNameAr: "حقيبة أخرى", categoryNameAr: "حقائب", descriptionAr: "" },
      ],
      products,
      "replace"
    );
    expect(preview.blocked).toBe(true);
    expect(preview.duplicateArticleCodes).toEqual(["00123"]);
  });

  it("blocks conflicting translations for the same category", () => {
    const preview = previewArabicTranslationImport(
      [
        { rowNumber: 2, articleCode: "00123", productNameAr: "حقيبة", categoryNameAr: "حقائب", descriptionAr: "" },
        { rowNumber: 3, articleCode: "ABC-2", productNameAr: "حزام", categoryNameAr: "أحزمة", descriptionAr: "" },
      ],
      products,
      "replace"
    );
    expect(preview.blocked).toBe(true);
    expect(preview.categoryConflicts).toBe(1);
  });

  it("is idempotent when translations already match", () => {
    const preview = previewArabicTranslationImport(
      [{ rowNumber: 2, articleCode: "ABC-2", productNameAr: "حزام", categoryNameAr: "حقائب", descriptionAr: "" }],
      products,
      "replace"
    );
    expect(preview.productsToUpdate).toBe(0);
    expect(preview.unchangedRows).toBe(1);
  });

  it("does not replace existing Arabic values in fill-missing mode", () => {
    const preview = previewArabicTranslationImport(
      [{ rowNumber: 2, articleCode: "ABC-2", productNameAr: "حزام جديد", categoryNameAr: "حقائب جديدة", descriptionAr: "" }],
      products,
      "fill-missing"
    );
    expect(preview.productsToUpdate).toBe(0);
    expect(preview.unchangedRows).toBe(1);
  });

  it("reports unknown article codes without matching by name", () => {
    const preview = previewArabicTranslationImport(
      [{ rowNumber: 2, articleCode: "UNKNOWN", productNameAr: "MEN BAG", categoryNameAr: "", descriptionAr: "" }],
      products,
      "replace"
    );
    expect(preview.matchedProducts).toBe(0);
    expect(preview.unknownArticleCodes).toEqual(["UNKNOWN"]);
  });
});
