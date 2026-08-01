import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  ARABIC_TRANSLATION_TEMPLATE_HEADERS,
  createArabicTranslationErrorWorkbook,
  createArabicTranslationPreviewEnvelope,
  createArabicTranslationTemplate,
  createWorkbookSha256,
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
  it("exports the exact template columns and preserves article codes as Excel text", async () => {
    const buffer = await createArabicTranslationTemplate(products);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];

    expect(
      ARABIC_TRANSLATION_TEMPLATE_HEADERS.map((_, index) =>
        String(sheet.getRow(1).getCell(index + 1).value)
      )
    ).toEqual([...ARABIC_TRANSLATION_TEMPLATE_HEADERS]);
    expect(sheet.getRow(2).getCell(1).numFmt).toBe("@");
    expect(sheet.getRow(2).getCell(1).value).toBe("00123");
    expect(sheet.getRow(2).getCell(1).protection.locked).not.toBe(false);
    expect(sheet.getRow(2).getCell(3).protection.locked).toBe(false);
  });

  it("round-trips article codes as text, preserving leading zeroes", async () => {
    const buffer = await createArabicTranslationTemplate(products);
    const rows = await parseArabicTranslationWorkbook(buffer);
    expect(rows[0]?.articleCode).toBe("00123");
  });

  it("rejects workbooks whose columns do not match the controlled template", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Wrong");
    sheet.addRow(["Barcode", "Arabic"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(parseArabicTranslationWorkbook(buffer)).rejects.toThrow("Workbook columns do not match");
  });

  it("matches by normalized exact article code only", () => {
    const preview = previewArabicTranslationImport(
      [
        {
          rowNumber: 2,
          articleCode: "00123",
          productNameAr: "حقيبة",
          categoryNameAr: "حقائب",
          descriptionAr: "",
        },
      ],
      products,
      "replace-existing"
    );
    expect(preview.matchedProducts).toBe(1);
    expect(preview.productsToUpdate).toBe(1);
    expect(preview.categoriesToUpdate).toBe(1);
    expect(preview.unknownArticleCodes).toEqual([]);
    expect(preview.rows[0]).toMatchObject({
      productId: 1,
      targetProductNameAr: "حقيبة",
      targetCategoryNameAr: "حقائب",
      changes: { productNameAr: true, categoryNameAr: true },
    });
  });

  it("blocks duplicate article codes", () => {
    const preview = previewArabicTranslationImport(
      [
        {
          rowNumber: 2,
          articleCode: "00123",
          productNameAr: "حقيبة",
          categoryNameAr: "حقائب",
          descriptionAr: "",
        },
        {
          rowNumber: 3,
          articleCode: "00123",
          productNameAr: "حقيبة أخرى",
          categoryNameAr: "حقائب",
          descriptionAr: "",
        },
      ],
      products,
      "replace-existing"
    );
    expect(preview.blocked).toBe(true);
    expect(preview.duplicateArticleCodes).toEqual(["00123"]);
    expect(preview.rows.every((row) => row.status === "duplicate")).toBe(true);
  });

  it("blocks ambiguous normalized article codes already present in the company catalog", () => {
    const preview = previewArabicTranslationImport(
      [
        {
          rowNumber: 2,
          articleCode: "abc-2",
          productNameAr: "حزام جديد",
          categoryNameAr: "حقائب",
          descriptionAr: "",
        },
      ],
      [
        ...products,
        {
          ...products[1],
          id: 3,
          articleCode: " ABC-2 ",
          name: "DUPLICATE BELT",
        },
      ],
      "replace-existing"
    );

    expect(preview.blocked).toBe(true);
    expect(preview.ambiguousArticleCodes).toEqual(["ABC-2"]);
    expect(preview.rows[0]?.status).toBe("ambiguous");
    expect(preview.rows[0]?.productId).toBeUndefined();
  });

  it("blocks conflicting translations for the same category", () => {
    const preview = previewArabicTranslationImport(
      [
        {
          rowNumber: 2,
          articleCode: "00123",
          productNameAr: "حقيبة",
          categoryNameAr: "حقائب",
          descriptionAr: "",
        },
        {
          rowNumber: 3,
          articleCode: "ABC-2",
          productNameAr: "حزام",
          categoryNameAr: "أحزمة",
          descriptionAr: "",
        },
      ],
      products,
      "replace-existing"
    );
    expect(preview.blocked).toBe(true);
    expect(preview.categoryConflicts).toBe(1);
  });

  it("is idempotent when translations already match", () => {
    const preview = previewArabicTranslationImport(
      [
        {
          rowNumber: 2,
          articleCode: "ABC-2",
          productNameAr: "حزام",
          categoryNameAr: "حقائب",
          descriptionAr: "",
        },
      ],
      products,
      "replace-existing"
    );
    expect(preview.rowsToApply).toBe(0);
    expect(preview.productsToUpdate).toBe(0);
    expect(preview.unchangedRows).toBe(1);
  });

  it("does not replace existing Arabic values in fill-missing mode", () => {
    const preview = previewArabicTranslationImport(
      [
        {
          rowNumber: 2,
          articleCode: "ABC-2",
          productNameAr: "حزام جديد",
          categoryNameAr: "حقائب جديدة",
          descriptionAr: "",
        },
      ],
      products,
      "fill-missing"
    );
    expect(preview.rowsToApply).toBe(0);
    expect(preview.productsToUpdate).toBe(0);
    expect(preview.unchangedRows).toBe(1);
  });

  it("reports unknown article codes without matching by a translated name", () => {
    const preview = previewArabicTranslationImport(
      [
        {
          rowNumber: 2,
          articleCode: "UNKNOWN",
          productNameAr: "MEN BAG",
          categoryNameAr: "",
          descriptionAr: "",
        },
      ],
      products,
      "replace-existing"
    );
    expect(preview.matchedProducts).toBe(0);
    expect(preview.unknownArticleCodes).toEqual(["UNKNOWN"]);
  });

  it("rejects empty translation rows without blocking unrelated valid rows", () => {
    const preview = previewArabicTranslationImport(
      [
        {
          rowNumber: 2,
          articleCode: "00123",
          productNameAr: "",
          categoryNameAr: "",
          descriptionAr: "",
        },
      ],
      products,
      "replace-existing"
    );
    expect(preview.blocked).toBe(false);
    expect(preview.blankOrInvalidArabicNames).toBe(1);
    expect(preview.rows[0]?.status).toBe("invalid");
  });

  it("changes the preview token when the workbook or current catalog changes", () => {
    const rows = [
      {
        rowNumber: 2,
        articleCode: "00123",
        productNameAr: "حقيبة",
        categoryNameAr: "حقائب",
        descriptionAr: "",
      },
    ];
    const preview = previewArabicTranslationImport(rows, products, "replace-existing");
    const first = createArabicTranslationPreviewEnvelope({
      companyId: 10,
      mode: "replace-existing",
      workbookSha256: createWorkbookSha256(Buffer.from("one")),
      preview,
    });
    const second = createArabicTranslationPreviewEnvelope({
      companyId: 10,
      mode: "replace-existing",
      workbookSha256: createWorkbookSha256(Buffer.from("two")),
      preview,
    });
    const changedCatalogPreview = previewArabicTranslationImport(
      rows,
      [{ ...products[0], nameAr: "قيمة حالية" }, products[1]],
      "replace-existing"
    );
    const third = createArabicTranslationPreviewEnvelope({
      companyId: 10,
      mode: "replace-existing",
      workbookSha256: createWorkbookSha256(Buffer.from("one")),
      preview: changedCatalogPreview,
    });

    expect(first.previewToken).not.toBe(second.previewToken);
    expect(first.previewToken).not.toBe(third.previewToken);
  });

  it("creates an error workbook containing rejected rows and reasons", async () => {
    const preview = previewArabicTranslationImport(
      [
        {
          rowNumber: 2,
          articleCode: "UNKNOWN",
          productNameAr: "منتج",
          categoryNameAr: "",
          descriptionAr: "",
        },
      ],
      products,
      "replace-existing"
    );
    const buffer = await createArabicTranslationErrorWorkbook(preview);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(2).getCell(2).value).toBe("UNKNOWN");
    expect(String(sheet.getRow(2).getCell(7).value)).toContain("Unknown article code");
  });
});
